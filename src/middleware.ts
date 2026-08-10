import { NextRequest, NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return null;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export function middleware(request: NextRequest) {
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

export const config = { matcher: "/api/:path*" };
