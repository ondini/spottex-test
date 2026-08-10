import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientAddress } from "./rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("rate-limit client identity", () => {
  it("isolates local E2E processes without weakening the production address key", () => {
    const request = new Request("http://localhost", {
      headers: { "x-spottex-test-client": "e2e_client_12345678" },
    });
    vi.stubEnv("NODE_ENV", "development");
    expect(clientAddress(request)).toBe("test-client:e2e_client_12345678");
    vi.stubEnv("NODE_ENV", "production");
    expect(clientAddress(request)).toBe("direct-client");
  });
});
