import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || "";
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return decoded;
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

const BINARY_ENCRYPTION_VERSION = 1;

export function encryptBuffer(value: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([Buffer.from([BINARY_ENCRYPTION_VERSION]), iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBuffer(value: Buffer): Buffer {
  if (value.length < 30 || value[0] !== BINARY_ENCRYPTION_VERSION) throw new Error("Invalid encrypted binary value");
  const iv = value.subarray(1, 13);
  const tag = value.subarray(13, 29);
  const encrypted = value.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeTokenEqual(rawToken: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(rawToken), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashClientAddress(value: string): string {
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET || "local"}:${value}`)
    .digest("hex");
}
