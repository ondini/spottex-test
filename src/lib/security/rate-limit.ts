import type { Prisma } from "@prisma/client";

import { hashClientAddress } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  identity?: string | number;
  includeAddress?: boolean;
};

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function clientAddress(request: Pick<Request, "headers">): string {
  if (process.env.NODE_ENV !== "production") {
    const testClient = request.headers.get("x-spottex-test-client")?.trim();
    if (testClient && /^[a-zA-Z0-9_-]{8,80}$/.test(testClient))
      return `test-client:${testClient}`;
  }
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const forwarded = request.headers.get("x-forwarded-for")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return forwarded?.at(-1) || request.headers.get("x-real-ip") || "proxy-unknown";
  }
  return "direct-client";
}

export async function consumeRateLimit(
  request: Pick<Request, "headers">,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const address = options.includeAddress === false ? "identity-only" : clientAddress(request);
  const rawIdentity = `${options.scope}:${address}:${String(options.identity ?? "*").toLowerCase()}`;
  const key = hashClientAddress(rawIdentity);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.windowMs);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const current = await tx.rateLimitBucket.findUnique({ where: { key } });
    if (!current || current.expiresAt <= now) {
      await tx.rateLimitBucket.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now, expiresAt },
        update: { count: 1, windowStart: now, expiresAt },
      });
      return { allowed: true, retryAfterSeconds: Math.ceil(options.windowMs / 1000) };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000));
    if (current.count >= options.limit) return { allowed: false, retryAfterSeconds };
    await tx.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
    return { allowed: true, retryAfterSeconds };
  }, { isolationLevel: "ReadCommitted" satisfies Prisma.TransactionIsolationLevel });
}

export function rateLimitedResponse(result: RateLimitResult) {
  return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(result.retryAfterSeconds) },
  });
}
