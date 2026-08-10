import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "./middleware";

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
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
});
