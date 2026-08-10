import { createHmac, timingSafeEqual } from "node:crypto";

export type StoredConsent = { a: boolean; m: boolean; v: string };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required to sign consent cookies");
  return value;
}

export function signConsentCookie(consent: StoredConsent) {
  const payload = Buffer.from(JSON.stringify(consent)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyConsentCookie(value: string | undefined): StoredConsent | null {
  if (!value) return null;
  const [payload, suppliedRaw] = value.split(".");
  if (!payload || !suppliedRaw) return null;
  const expected = Buffer.from(createHmac("sha256", secret()).update(payload).digest("base64url"));
  const supplied = Buffer.from(suppliedRaw);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<StoredConsent>;
    return typeof parsed.a === "boolean" && typeof parsed.m === "boolean" && typeof parsed.v === "string"
      ? { a: parsed.a, m: parsed.m, v: parsed.v }
      : null;
  } catch {
    return null;
  }
}
