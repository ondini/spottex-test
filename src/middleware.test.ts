import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, describe, expect, it } from "vitest";

import { config, middleware } from "./middleware";

const originalAppUrl = process.env.APP_URL;
const originalAuthUrl = process.env.AUTH_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;
});

describe("public HTTPS enforcement", () => {
  it("matches non-API pages", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "https://spottex.cz/prihlaseni" })).toBe(true);
  });

  it("permanently redirects a configured public host and preserves path and query", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("http://spottex.cz/prihlaseni?next=%2Fapp", {
      headers: {
        host: "spottex.cz",
        "x-forwarded-proto": "http",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://spottex.cz/prihlaseni?next=%2Fapp");
  });

  it("keeps private Compose health checks on HTTP", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("http://app:3004/api/health", {
      headers: {
        host: "app:3004",
        "x-forwarded-proto": "http",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps private HTTP job requests reachable", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("http://app:3004/api/internal/jobs/run", {
      method: "POST",
      headers: {
        host: "app:3004",
        "x-forwarded-proto": "http",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not redirect an already-secure public request", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("https://spottex.cz/prihlaseni", {
      headers: {
        host: "spottex.cz",
        "x-forwarded-proto": "https",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps a protocol-relative-looking path on the configured host", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("http://spottex.cz//attacker.example/path", {
      headers: {
        host: "spottex.cz",
        "x-forwarded-proto": "http",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://spottex.cz//attacker.example/path");
  });
});

describe("API origin protection", () => {
  it("accepts the origin from the actual request host", () => {
    process.env.APP_URL = "http://localhost:3004";
    const request = new NextRequest("http://localhost:3004/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3004",
        origin: "http://127.0.0.1:3004",
      },
    });

    expect(middleware(request).status).toBe(200);
  });

  it("rejects an origin unrelated to the request host or public URL", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("https://spottex.cz/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        host: "spottex.cz",
        origin: "https://attacker.example",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(403);
  });

  it("does not let a client-supplied forwarded host replace Host", () => {
    process.env.APP_URL = "https://spottex.cz";
    const request = new NextRequest("https://spottex.cz/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        host: "spottex.cz",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
        origin: "https://attacker.example",
      },
    });

    expect(middleware(request).status).toBe(403);
  });
});
