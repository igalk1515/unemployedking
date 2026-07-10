// NextAuth v5 catch-all route: OAuth callbacks, /api/auth/session, CSRF, etc.

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
