export function publicAppUrl(pathname: string, fallbackOrigin = "http://localhost:3004") {
  const configuredOrigin = process.env.APP_URL || process.env.AUTH_URL || fallbackOrigin;
  const url = new URL(configuredOrigin);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url;
}

export function emailVerificationUrl(token: string) {
  const url = publicAppUrl("/api/auth/verify-email");
  url.searchParams.set("token", token);
  return url.toString();
}
