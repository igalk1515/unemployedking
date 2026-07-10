// lib/gmail/client.ts — raw Gmail REST client (no googleapis dependency).
//
// Privacy contract (DESIGN.md §3.4): message content is only ever held in
// memory long enough to classify it. Nothing in this module persists anything.

import { decryptSecret } from "@/lib/crypto";
import { htmlToText } from "@/lib/classifier";
import type { EmailInput } from "@/lib/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** 2 retries (3 attempts total) on 429/5xx/network failures. */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const LIST_PAGE_SIZE = 100;

/** Labels whose messages we never classify (our own mail, spam, chats…). */
const IGNORED_LABELS = new Set(["DRAFT", "SENT", "CHAT", "SPAM", "TRASH"]);

/**
 * Thrown on HTTP 401 from Gmail or on a failed/unconfigured token refresh.
 * Callers (lib/gmail/sync.ts) refresh the access token once and retry;
 * the sync route maps this to a friendly 400 ("reconnect Gmail").
 */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/** Any other Gmail API failure. `status` is the HTTP status (0 = network). */
export class GmailApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Gmail wire types (the exact subset we consume from users.messages.get?format=full)
// ---------------------------------------------------------------------------

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** Milliseconds since epoch, as a string. */
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailListResponse {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHistoryResponse {
  history?: {
    id?: string;
    messagesAdded?: { message?: { id?: string; threadId?: string; labelIds?: string[] } }[];
  }[];
  historyId?: string;
  nextPageToken?: string;
}

interface GmailProfileResponse {
  emailAddress: string;
  historyId: string;
}

// ---------------------------------------------------------------------------
// Low-level fetch with retry
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeBodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<unreadable body>";
  }
}

/**
 * GET a Gmail endpoint with a bearer token.
 * - 401 → throws GmailAuthError immediately (caller refreshes token once).
 * - 429/5xx/network → up to MAX_RETRIES retries with exponential backoff.
 * - other non-2xx → GmailApiError with status + response excerpt.
 */
async function gmailFetch(token: string, url: string): Promise<Response> {
  let lastError: GmailApiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      lastError = new GmailApiError(
        `Network error calling Gmail API: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
      continue;
    }

    if (res.ok) return res;

    if (res.status === 401) {
      throw new GmailAuthError("Gmail rejected the access token (HTTP 401).");
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = new GmailApiError(
        `Gmail API returned ${res.status}: ${await safeBodyText(res)}`,
        res.status,
      );
      continue;
    }

    // Non-retryable client error (400/403/404…)
    throw new GmailApiError(
      `Gmail API returned ${res.status}: ${await safeBodyText(res)}`,
      res.status,
    );
  }

  throw lastError ?? new GmailApiError("Gmail API request failed after retries.", 0);
}

// ---------------------------------------------------------------------------
// OAuth token refresh
// ---------------------------------------------------------------------------

/**
 * Exchange the (encrypted-at-rest) refresh token for a fresh access token via
 * oauth2.googleapis.com. Throws GmailAuthError on anything that means "the
 * user needs to reconnect Gmail" or "Google OAuth is not configured".
 */
export async function getAccessToken(acct: {
  encryptedRefreshToken: string | null;
}): Promise<string> {
  if (!acct.encryptedRefreshToken) {
    throw new GmailAuthError("No Gmail refresh token stored. Connect Gmail first.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GmailAuthError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured. Gmail sync is disabled.",
    );
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(acct.encryptedRefreshToken);
  } catch {
    throw new GmailAuthError(
      "Stored Gmail token could not be decrypted (TOKEN_ENCRYPTION_KEY changed?). Reconnect Gmail.",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }).toString();

  let lastError: GmailAuthError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      lastError = new GmailAuthError(
        `Network error refreshing Google token: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = new GmailAuthError(`Google token endpoint returned ${res.status}.`);
      continue;
    }

    let json: { access_token?: string; error?: string; error_description?: string };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new GmailAuthError("Google token endpoint returned an unparseable response.");
    }

    if (!res.ok || !json.access_token) {
      // e.g. invalid_grant when the user revoked access — needs a reconnect.
      throw new GmailAuthError(
        `Google token refresh failed (${json.error ?? res.status}): ${
          json.error_description ?? "no description"
        }. The user likely needs to reconnect Gmail.`,
      );
    }

    return json.access_token;
  }

  throw lastError ?? new GmailAuthError("Google token refresh failed after retries.");
}

// ---------------------------------------------------------------------------
// Gmail endpoints
// ---------------------------------------------------------------------------

/** users.messages.list — one page of message ids matching a Gmail search query. */
export async function listMessageIds(
  token: string,
  q: string,
  pageToken?: string,
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q, maxResults: String(LIST_PAGE_SIZE) });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await gmailFetch(token, `${GMAIL_BASE}/messages?${params.toString()}`);
  const json = (await res.json()) as GmailListResponse;
  return {
    ids: (json.messages ?? []).map((m) => m.id).filter(Boolean),
    nextPageToken: json.nextPageToken,
  };
}

/** users.messages.get?format=full — the whole MIME tree, no raw bytes. */
export async function getMessage(token: string, id: string): Promise<GmailMessage> {
  const res = await gmailFetch(
    token,
    `${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`,
  );
  return (await res.json()) as GmailMessage;
}

/** users.getProfile — used to snapshot the history cursor before a query sync. */
export async function getProfile(
  token: string,
): Promise<{ emailAddress: string; historyId: string }> {
  const res = await gmailFetch(token, `${GMAIL_BASE}/profile`);
  const json = (await res.json()) as GmailProfileResponse;
  return { emailAddress: json.emailAddress, historyId: String(json.historyId) };
}

/**
 * users.history.list from a stored cursor. Paginates internally and returns
 * every added message id (drafts/sent/chat/spam/trash filtered out).
 * `expired: true` when Gmail answers 404 — the cursor is too old and the
 * caller must fall back to a query-based sync.
 */
export async function listHistory(
  token: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string | null; expired: boolean }> {
  const messageIds = new Set<string>();
  let newHistoryId: string | null = null;
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: String(LIST_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await gmailFetch(token, `${GMAIL_BASE}/history?${params.toString()}`);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) {
        return { messageIds: [], newHistoryId: null, expired: true };
      }
      throw err;
    }

    const json = (await res.json()) as GmailHistoryResponse;
    if (json.historyId) newHistoryId = String(json.historyId);

    for (const entry of json.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const msg = added.message;
        if (!msg?.id) continue;
        if ((msg.labelIds ?? []).some((label) => IGNORED_LABELS.has(label))) continue;
        messageIds.add(msg.id);
      }
    }

    pageToken = json.nextPageToken;
  } while (pageToken);

  return { messageIds: [...messageIds], newHistoryId, expired: false };
}

// ---------------------------------------------------------------------------
// Message → EmailInput extraction
// ---------------------------------------------------------------------------

function headerValue(headers: GmailHeader[], name: string): string {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Recursive part walk. Keeps the FIRST text/plain body and the FIRST
 * text/html body found (depth-first, matching reading order).
 */
function collectBodies(part: GmailMessagePart, acc: { plain?: string; html?: string }): void {
  const mime = (part.mimeType ?? "").toLowerCase();
  const data = part.body?.data;
  if (data) {
    if (mime.startsWith("text/plain") && acc.plain === undefined) {
      acc.plain = decodeBase64Url(data);
    } else if (mime.startsWith("text/html") && acc.html === undefined) {
      acc.html = decodeBase64Url(data);
    }
  }
  for (const child of part.parts ?? []) {
    if (acc.plain !== undefined && acc.html !== undefined) break;
    collectBodies(child, acc);
  }
}

function extractBodyText(msg: GmailMessage): string {
  const acc: { plain?: string; html?: string } = {};
  if (msg.payload) collectBodies(msg.payload, acc);
  if (acc.plain && acc.plain.trim().length > 0) return acc.plain.trim();
  if (acc.html) return htmlToText(acc.html);
  return msg.snippet ?? "";
}

/** Domain of the From address, lowercased ("Greenhouse <no-reply@x.io>" → "x.io"). */
function senderDomainOf(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : from).trim().replace(/^["']+|["'>\s]+$/g, "");
  const at = addr.lastIndexOf("@");
  if (at < 0) return "";
  return addr.slice(at + 1).trim().toLowerCase();
}

function parseReceivedAt(msg: GmailMessage, headers: GmailHeader[]): Date {
  const internal = Number(msg.internalDate);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal);
  const dateHeader = headerValue(headers, "Date");
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Flatten a full Gmail message into the classifier's input plus the linkage
 * metadata (message/thread ids, sender domain) the persistence layer needs.
 */
export function extractEmailInput(
  msg: GmailMessage,
): EmailInput & { messageId: string; threadId: string; senderDomain: string } {
  const headers = msg.payload?.headers ?? [];
  const from = headerValue(headers, "From");
  return {
    from,
    subject: headerValue(headers, "Subject"),
    bodyText: extractBodyText(msg),
    receivedAt: parseReceivedAt(msg, headers),
    messageId: msg.id,
    threadId: msg.threadId ?? "",
    senderDomain: senderDomainOf(from),
  };
}
