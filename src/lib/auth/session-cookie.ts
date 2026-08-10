type SessionCookieOption = {
  name: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: "/";
    secure: false;
  };
};

/**
 * Cookies are shared by hostname, not port. Give local SpotTEX instances a
 * port-specific Auth.js session name so another localhost app cannot feed us a
 * JWT encrypted with a different secret. Public HTTPS deployments keep the
 * Auth.js default and therefore do not invalidate existing production sessions.
 */
export function localSessionCookie(appUrl: string | undefined): SessionCookieOption | undefined {
  if (!appUrl) return undefined;
  try {
    const url = new URL(appUrl);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return undefined;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return {
      name: `spottex-${port}.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    };
  } catch {
    return undefined;
  }
}
