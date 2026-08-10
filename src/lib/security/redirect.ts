export function safeInternalPath(value: string | undefined, fallback = "/app/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]|%5c/i.test(value)) return fallback;
  try {
    const base = new URL("https://spottex.internal");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
