import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_MS = 15 * 60_000;

export type GoogleOAuthState = {
  userId: number;
  issuedAt: number;
  disconnectEpoch: number;
};

function signingSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required for Google Calendar OAuth");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function signOAuthState(userId: number, disconnectEpoch: number, now = Date.now()): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid OAuth user");
  if (!Number.isSafeInteger(disconnectEpoch) || disconnectEpoch < 0) throw new Error("Invalid OAuth disconnect epoch");
  const payload = Buffer.from(JSON.stringify({ userId, issuedAt: now, disconnectEpoch })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyOAuthState(value: string, now = Date.now()): GoogleOAuthState | null {
  const [payload, suppliedSignature] = value.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId?: unknown;
      issuedAt?: unknown;
      disconnectEpoch?: unknown;
    };
    if (!Number.isSafeInteger(decoded.userId) || Number(decoded.userId) <= 0 || typeof decoded.issuedAt !== "number") return null;
    if (!Number.isSafeInteger(decoded.disconnectEpoch) || Number(decoded.disconnectEpoch) < 0) return null;
    if (decoded.issuedAt > now + 60_000 || now - decoded.issuedAt > MAX_AGE_MS) return null;
    return {
      userId: Number(decoded.userId),
      issuedAt: decoded.issuedAt,
      disconnectEpoch: Number(decoded.disconnectEpoch),
    };
  } catch {
    return null;
  }
}
