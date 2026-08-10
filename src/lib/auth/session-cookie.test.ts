import { describe, expect, it } from "vitest";

import { localSessionCookie } from "./session-cookie";

describe("Auth.js local session cookie isolation", () => {
  it("uses a port-specific cookie on localhost", () => {
    expect(localSessionCookie("http://localhost:3004")?.name).toBe("spottex-3004.session-token");
    expect(localSessionCookie("http://127.0.0.1:3005")?.name).toBe("spottex-3005.session-token");
  });

  it("keeps the Auth.js default on public deployments", () => {
    expect(localSessionCookie("https://spottex.cz")).toBeUndefined();
    expect(localSessionCookie(undefined)).toBeUndefined();
  });
});
