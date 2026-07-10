// NextAuth v5 — JWT session strategy, NO database adapter.
// We manage our own User rows; Google refresh tokens are stored encrypted
// (AES-256-GCM) in EmailAccount and never persist in plaintext.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { z } from "zod";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { makeUniqueSlug } from "@/lib/slug";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const devUsernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

/** Prisma unique-constraint violation (concurrent sign-in races on email/slug). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Find-or-create the User row for a Google sign-in. Race-safe via P2002 retry. */
async function upsertGoogleUser(profile: {
  email: string;
  name: string | null;
  image: string | null;
}): Promise<{ id: string }> {
  const existing = await db.user.findUnique({ where: { email: profile.email } });
  if (existing) {
    // Keep name/image fresh; never touch slug or displayName (user-owned identity).
    return db.user.update({
      where: { id: existing.id },
      data: { name: profile.name ?? existing.name, image: profile.image ?? existing.image },
      select: { id: true },
    });
  }
  const localPart = profile.email.split("@")[0] || "royal-applicant";
  try {
    return await db.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        image: profile.image,
        displayName: profile.name,
        slug: await makeUniqueSlug(localPart),
      },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Lost a race with a concurrent sign-in for the same email or slug.
      const winner = await db.user.findUnique({
        where: { email: profile.email },
        select: { id: true },
      });
      if (winner) return winner;
      // Slug collision, not email: one retry with a fresh slug.
      return db.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          image: profile.image,
          displayName: profile.name,
          slug: await makeUniqueSlug(localPart),
        },
        select: { id: true },
      });
    }
    throw err;
  }
}

const providers: Provider[] = [];

if (process.env.GOOGLE_CLIENT_ID) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: `openid email profile ${GMAIL_READONLY_SCOPE}`,
          // Offline access + forced consent so Google reissues a refresh_token
          // on every sign-in (we have no adapter to remember the old one).
          access_type: "offline",
          prompt: "consent",
        },
      },
    })
  );
}

if (process.env.DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev Login",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "sir-rejects-a-lot" },
      },
      async authorize(credentials) {
        const parsed = devUsernameSchema.safeParse(credentials?.username);
        if (!parsed.success) return null;
        const username = parsed.data.toLowerCase();
        const email = `${username}@dev.local`;

        const existing = await db.user.findUnique({ where: { email } });
        if (existing) {
          return { id: existing.id, email: existing.email, name: existing.name, image: existing.image };
        }
        try {
          const created = await db.user.create({
            data: {
              email,
              name: username,
              displayName: username,
              slug: await makeUniqueSlug(username),
            },
          });
          return { id: created.id, email: created.email, name: created.name, image: created.image };
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            const winner = await db.user.findUnique({ where: { email } });
            if (winner) return { id: winner.id, email: winner.email, name: winner.name, image: winner.image };
          }
          throw err;
        }
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Dev credentials: authorize() already found-or-created the User row.
      if (account?.provider === "dev") return true;

      if (account?.provider === "google") {
        const email = user.email;
        if (!email) {
          console.error("[auth] Google sign-in without an email address — rejecting.");
          return false;
        }
        const dbUser = await upsertGoogleUser({
          email,
          name: user.name ?? null,
          image: user.image ?? null,
        });

        // Gmail read access is a per-scope checkbox on Google's consent screen,
        // UNCHECKED by default. If the user skipped it, sign-in still succeeds but
        // the token can't read mail — so only store it as a working connection when
        // the scope was actually granted.
        const grantedGmail =
          typeof account.scope === "string" && account.scope.includes(GMAIL_READONLY_SCOPE);

        if (grantedGmail && account.refresh_token) {
          try {
            const encrypted = encryptSecret(account.refresh_token);
            await db.emailAccount.upsert({
              where: { userId_emailAddress: { userId: dbUser.id, emailAddress: email } },
              update: { encryptedRefreshToken: encrypted },
              create: {
                userId: dbUser.id,
                emailAddress: email,
                encryptedRefreshToken: encrypted,
              },
            });
          } catch (err) {
            // Degrade gracefully: the account works, Gmail sync doesn't.
            // Loud log so a missing/bad TOKEN_ENCRYPTION_KEY is impossible to miss.
            console.error(
              "[auth] Failed to store the encrypted Gmail refresh token; sign-in continues but Gmail sync is unavailable for this user.",
              err
            );
          }
        } else if (!grantedGmail) {
          // Skipped the "Read your email" box. Ensure a token-less account row
          // exists so the dashboard shows the "reconnect and grant Gmail" prompt —
          // but never clobber a working token from a previous good connect.
          try {
            const existing = await db.emailAccount.findUnique({
              where: { userId_emailAddress: { userId: dbUser.id, emailAddress: email } },
              select: { id: true },
            });
            if (!existing) {
              await db.emailAccount.create({
                data: { userId: dbUser.id, emailAddress: email, encryptedRefreshToken: null },
              });
            }
            console.warn(
              "[auth] Google sign-in without the gmail.readonly scope — the user skipped the Gmail permission checkbox."
            );
          } catch (err) {
            console.error("[auth] Failed to record the Gmail-permission-skipped state.", err);
          }
        }
        return true;
      }

      // No other providers are configured; anything else is a misconfiguration.
      return false;
    },

    async jwt({ token, user }) {
      // On sign-in (`user` present) — or if an older token predates userId/slug —
      // stamp our DB identity onto the JWT so session lookups never hit the DB.
      const needsIdentity = Boolean(user) || !token.userId || !token.slug;
      const email = user?.email ?? token.email;
      if (needsIdentity && email) {
        const dbUser = await db.user.findUnique({
          where: { email },
          select: { id: true, slug: true },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.slug = dbUser.slug;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId ?? token.sub ?? "";
        session.user.slug = token.slug ?? "";
      }
      return session;
    },
  },
});
