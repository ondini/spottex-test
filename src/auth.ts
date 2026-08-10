import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { localSessionCookie } from "@/lib/auth/session-cookie";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const credentialsSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
});

const sessionCookie = localSessionCookie(process.env.APP_URL || process.env.AUTH_URL);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  cookies: sessionCookie ? { sessionToken: sessionCookie } : undefined,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: [
    Credentials({
      name: "E-mail a heslo",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Heslo", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const [addressLimit, accountLimit] = await Promise.all([
          consumeRateLimit(request, { scope: "auth-login-address", limit: 40, windowMs: 15 * 60_000 }),
          consumeRateLimit(request, { scope: "auth-login-account", identity: parsed.data.email, includeAddress: false, limit: 10, windowMs: 15 * 60_000 }),
        ]);
        if (!addressLimit.allowed || !accountLimit.allowed) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return null;
        if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return null;
        return { id: String(user.id), email: user.email, name: user.name, role: user.role, authVersion: user.authVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.authVersion = user.authVersion;
      } else if (token.sub) {
        const current = await prisma.user.findUnique({
          where: { id: Number(token.sub) },
          select: { email: true, name: true, role: true, status: true, authVersion: true },
        });
        if (!current || current.status !== "ACTIVE" || token.authVersion !== current.authVersion) return null;
        token.email = current.email;
        token.name = current.name;
        token.role = current.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role === "ADMIN" ? "ADMIN" : "USER";
        session.user.email = String(token.email || "");
        session.user.name = typeof token.name === "string" ? token.name : null;
      }
      return session;
    },
  },
  pages: { signIn: "/prihlaseni" },
});
