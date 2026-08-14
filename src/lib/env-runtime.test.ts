import { afterEach, describe, expect, it, vi } from "vitest";

import { validateProductionEnvironment } from "./env";

function validProductionEnvironment() {
  const values: Record<string, string> = {
    NODE_ENV: "production",
    APP_URL: "https://spottex.cz",
    AUTH_URL: "https://spottex.cz",
    DATABASE_URL: "postgresql://spottex_app:a-strong-runtime-password@db:5432/spottex",
    AUTH_SECRET: "auth-secret-with-more-than-thirty-two-characters",
    INTERNAL_JOB_TOKEN: "job-token-with-more-than-thirty-two-characters",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    DEV_AUTO_VERIFY_EMAIL: "false",
    TRUST_PROXY_HEADERS: "true",
    EMAIL_FROM: "Spottex <noreply@spottex.cz>",
    RESEND_API_KEY: "",
    SMTP_HOST: "smtp.spottex.cz",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_STARTTLS: "false",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "mailer-password-with-safe-length",
    PAYMENT_PROVIDER: "GOPAY",
    GOPAY_API_URL: "https://gate.gopay.cz/api",
    GOPAY_CLIENT_ID: "merchant-client-id",
    GOPAY_CLIENT_SECRET: "merchant-client-secret",
    GOPAY_GO_ID: "123456789",
    GOOGLE_CALENDAR_CLIENT_ID: "",
    GOOGLE_CALENDAR_CLIENT_SECRET: "",
    GOOGLE_CALENDAR_REDIRECT_URI: "",
    SPOTTEX_LEGACY_API_URL: "",
    SPOTTEX_LEGACY_FERNET_KEY: "",
    ALLOW_INSECURE_LEGACY_HTTP: "false",
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("production environment validation", () => {
  it("accepts the hardened production baseline", () => {
    validProductionEnvironment();
    expect(() => validateProductionEnvironment()).not.toThrow();
  });

  it("accepts free production operation without GoPay credentials", () => {
    validProductionEnvironment();
    vi.stubEnv("PAYMENT_PROVIDER", "FREE");
    vi.stubEnv("GOPAY_CLIENT_ID", "");
    vi.stubEnv("GOPAY_CLIENT_SECRET", "");
    vi.stubEnv("GOPAY_GO_ID", "");
    expect(() => validateProductionEnvironment()).not.toThrow();
  });

  it("keeps pre-verified accounts out of production unless explicitly allowed", () => {
    validProductionEnvironment();
    vi.stubEnv("DEV_AUTO_VERIFY_EMAIL", "true");
    expect(() => validateProductionEnvironment()).toThrow(/DEV_AUTO_VERIFY_EMAIL/);

    // A testing host whose domain cannot send mail says so on purpose, and the
    // start announces it so the relaxation cannot go unnoticed.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ALLOW_AUTO_VERIFIED_ACCOUNTS", "true");
    expect(() => validateProductionEnvironment()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ALLOW_AUTO_VERIFIED_ACCOUNTS"));
    warn.mockRestore();
  });

  it("rejects non-origin application URLs and untrusted GoPay hosts", () => {
    validProductionEnvironment();
    vi.stubEnv("APP_URL", "https://spottex.cz/nested");
    expect(() => validateProductionEnvironment()).toThrow(/APP_URL/);

    validProductionEnvironment();
    vi.stubEnv("GOPAY_API_URL", "https://gopay.cz.attacker.test/api");
    expect(() => validateProductionEnvironment()).toThrow(/GOPAY_API_URL/);
  });

  it("allows a capture mailbox without TLS only when explicitly permitted", () => {
    validProductionEnvironment();
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_STARTTLS", "false");
    expect(() => validateProductionEnvironment()).toThrow(/exactly one/);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ALLOW_INSECURE_SMTP", "true");
    expect(() => validateProductionEnvironment()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ALLOW_INSECURE_SMTP"));
    warn.mockRestore();
  });

  it("requires exactly one SMTP TLS mode and a positive GoPay id", () => {
    validProductionEnvironment();
    vi.stubEnv("SMTP_STARTTLS", "true");
    expect(() => validateProductionEnvironment()).toThrow(/exactly one/);

    validProductionEnvironment();
    vi.stubEnv("GOPAY_GO_ID", "not-a-number");
    expect(() => validateProductionEnvironment()).toThrow(/GOPAY_GO_ID/);
  });

  it("rejects partial Google OAuth and incomplete legacy adapter configuration", () => {
    validProductionEnvironment();
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "google-client");
    expect(() => validateProductionEnvironment()).toThrow(/Google Calendar OAuth/);

    validProductionEnvironment();
    vi.stubEnv("SPOTTEX_LEGACY_API_URL", "https://legacy.internal.spottex.cz");
    expect(() => validateProductionEnvironment()).toThrow(/configured together/);
  });
});
