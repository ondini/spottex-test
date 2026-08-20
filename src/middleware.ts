import { NextRequest, NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizedHostname(host: string | null) {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function httpsRedirect(request: NextRequest) {
  const configuredOrigin = process.env.APP_URL || process.env.AUTH_URL;
  if (!configuredOrigin) return null;

  let publicHostname: string;
  try {
    const publicUrl = new URL(configuredOrigin);
    if (publicUrl.protocol !== "https:") return null;
    publicHostname = publicUrl.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }

  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "").toLowerCase();
  if (protocol !== "http") return null;

  // Only redirect configured public hosts. Internal health checks legitimately
  // use plain HTTP on the private Compose network and must stay reachable.
  const requestHostname = normalizedHostname(request.headers.get("host") || request.nextUrl.host);
  if (requestHostname !== publicHostname) return null;

  // Assign the path separately: passing a `//host/path` pathname to the URL
  // constructor would interpret it as a protocol-relative open redirect.
  const destination = new URL(`https://${requestHostname}`);
  destination.pathname = request.nextUrl.pathname;
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}

function requestOrigin(request: NextRequest) {
  // Host is authoritative for the request handled by Next.js. A browser can
  // supply X-Forwarded-Host itself, so it must not override Host in the CSRF
  // origin comparison.
  const host = request.headers.get("host") || request.headers.get("x-forwarded-host");
  if (!host) return null;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export function middleware(request: NextRequest) {
  const redirect = httpsRedirect(request);
  if (redirect) return redirect;
  const isApi = request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/");
  if (!isApi) return NextResponse.next();
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "CROSS_SITE_REQUEST_REJECTED" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.next();
  const publicOrigin = process.env.APP_URL || process.env.AUTH_URL;
  // `request.nextUrl.origin` can be based on APP_URL/AUTH_URL in development,
  // while the browser legitimately reaches the server through another local
  // hostname (for example 127.0.0.1 instead of localhost). The Host header is
  // the origin actually serving this request and must therefore be accepted.
  const allowed = new Set([request.nextUrl.origin]);
  const currentOrigin = requestOrigin(request);
  if (currentOrigin) allowed.add(currentOrigin);
  if (publicOrigin) {
    try { allowed.add(new URL(publicOrigin).origin); } catch { /* runtime validation reports invalid configuration */ }
  }
  if (!allowed.has(origin)) return NextResponse.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
