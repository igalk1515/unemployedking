// Module augmentation: session.user carries our DB identity (id + public slug).

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Our User.id (cuid) — NOT the OAuth provider account id. */
      id: string;
      /** Public profile slug, e.g. /u/{slug}. */
      slug: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Our User.id (cuid). */
    userId?: string;
    /** Public profile slug. */
    slug?: string;
  }
}
