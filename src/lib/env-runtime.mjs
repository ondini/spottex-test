const PLACEHOLDER = /replace|change-me|example|your-|doplnit|todo/i;

function required(name, minimumLength = 1) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength || PLACEHOLDER.test(value)) throw new Error(`${name} is missing or unsafe`);
  return value;
}

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const appUrl = new URL(required("APP_URL"));
  if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("APP_URL must be a credential-free HTTPS origin in production");
  }
  const authUrl = new URL(required("AUTH_URL"));
  if (authUrl.protocol !== "https:" || authUrl.origin !== appUrl.origin || authUrl.pathname !== "/" || authUrl.search || authUrl.hash) {
    throw new Error("AUTH_URL must use the APP_URL HTTPS origin in production");
  }
  const databaseUrl = new URL(required("DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol) || !databaseUrl.username || !databaseUrl.password || !databaseUrl.hostname) {
    throw new Error("DATABASE_URL must be an authenticated PostgreSQL URL");
  }
  required("AUTH_SECRET", 32);
  required("INTERNAL_JOB_TOKEN", 32);
  const encryptionKey = Buffer.from(required("APP_ENCRYPTION_KEY"), "base64");
  if (encryptionKey.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes");
  // A build always reports NODE_ENV=production, including on a shared testing
  // host where nobody can receive verification mail because its domain is not
  // set up with a mail provider. Handing out pre-verified accounts there is a
  // deliberate, per-deployment decision, so it takes its own explicit switch
  // and announces itself on every start. Production never sets it.
  if (process.env.DEV_AUTO_VERIFY_EMAIL === "true") {
    if (process.env.ALLOW_AUTO_VERIFIED_ACCOUNTS !== "true") {
      throw new Error("DEV_AUTO_VERIFY_EMAIL cannot be enabled in production");
    }
    console.warn(
      "[env] ALLOW_AUTO_VERIFIED_ACCOUNTS is on: accounts are created already verified and anyone who can reach this host can sign in without owning the address. Never enable this on a production deployment.",
    );
  }
  if (process.env.TRUST_PROXY_HEADERS !== "true") throw new Error("TRUST_PROXY_HEADERS must be true behind the production reverse proxy");
  required("EMAIL_FROM");
  if (process.env.RESEND_API_KEY) {
    required("RESEND_API_KEY");
  } else {
    required("SMTP_HOST");
    const smtpPort = Number(required("SMTP_PORT"));
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) throw new Error("SMTP_PORT is invalid");
    const implicitTls = process.env.SMTP_SECURE === "true";
    const startTls = process.env.SMTP_STARTTLS === "true";
    // A testing host delivers to a capture mailbox on its own project network,
    // where there is no transport to protect and no TLS on offer. Everywhere
    // else, mail carries verification links and personal data and must not
    // cross the network in the clear.
    if (implicitTls === startTls && process.env.ALLOW_INSECURE_SMTP !== "true") {
      throw new Error("Enable exactly one of SMTP_SECURE or SMTP_STARTTLS in production");
    }
    if (implicitTls === startTls) {
      console.warn(
        "[env] ALLOW_INSECURE_SMTP is on: mail leaves this host over an unencrypted SMTP connection. Never enable this on a production deployment.",
      );
    }
    if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together");
    if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      required("SMTP_USER");
      required("SMTP_PASSWORD");
    }
  }
  const paymentProvider = (process.env.PAYMENT_PROVIDER || "FREE").toUpperCase();
  if (!new Set(["FREE", "GOPAY"]).has(paymentProvider)) throw new Error("PAYMENT_PROVIDER must be FREE or GOPAY in production");
  if (paymentProvider === "GOPAY") {
    required("GOPAY_CLIENT_ID");
    required("GOPAY_CLIENT_SECRET");
    const goId = Number(required("GOPAY_GO_ID"));
    if (!Number.isSafeInteger(goId) || goId <= 0) throw new Error("GOPAY_GO_ID must be a positive integer");
    const gopayUrl = new URL(process.env.GOPAY_API_URL || "https://gate.gopay.cz/api");
    if (gopayUrl.protocol !== "https:" || gopayUrl.username || gopayUrl.password || !(gopayUrl.hostname.endsWith(".gopay.cz") || gopayUrl.hostname.endsWith(".gopay.com"))) {
      throw new Error("GOPAY_API_URL must use an official credential-free GoPay HTTPS host");
    }
  }
  const googleValues = [process.env.GOOGLE_CALENDAR_CLIENT_ID, process.env.GOOGLE_CALENDAR_CLIENT_SECRET, process.env.GOOGLE_CALENDAR_REDIRECT_URI];
  if (googleValues.some(Boolean)) {
    if (!googleValues.every(Boolean)) throw new Error("Google Calendar OAuth configuration is incomplete");
    const googleRedirect = new URL(required("GOOGLE_CALENDAR_REDIRECT_URI"));
    if (googleRedirect.protocol !== "https:" || googleRedirect.origin !== appUrl.origin) throw new Error("GOOGLE_CALENDAR_REDIRECT_URI must use the APP_URL HTTPS origin");
  }
  const legacyUrl = process.env.SPOTTEX_LEGACY_API_URL?.trim();
  const legacyKey = process.env.SPOTTEX_LEGACY_FERNET_KEY?.trim();
  if (Boolean(legacyUrl) !== Boolean(legacyKey)) throw new Error("SPOTTEX legacy URL and Fernet key must be configured together");
  if (legacyUrl && legacyKey) {
    const parsedLegacyUrl = new URL(legacyUrl);
    if (parsedLegacyUrl.username || parsedLegacyUrl.password) throw new Error("SPOTTEX_LEGACY_API_URL must not contain credentials");
    if (parsedLegacyUrl.protocol !== "https:" && process.env.ALLOW_INSECURE_LEGACY_HTTP !== "true") {
      throw new Error("SPOTTEX_LEGACY_API_URL must use an internal TLS endpoint in production");
    }
    if (!/^[A-Za-z0-9_-]{43}=?$/.test(legacyKey) || Buffer.from(legacyKey, "base64url").length !== 32) {
      throw new Error("SPOTTEX_LEGACY_FERNET_KEY must be a valid 32-byte Fernet key");
    }
  }
}

if (typeof process !== "undefined" && Array.isArray(process.argv) && process.argv[1]?.replaceAll("\\", "/").endsWith("/env-runtime.mjs")) {
  validateProductionEnvironment();
}
