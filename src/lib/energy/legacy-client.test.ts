import { Secret, Token } from "fernet";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LegacySpottexClient } from "./legacy-client";

const FERNET_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const secret = new Secret(FERNET_KEY);

function decrypt(value: string): string {
  return new Token({ secret, token: value, ttl: 0 }).decode();
}

function encryptedResponse(payload: unknown): Response {
  const encrypted = new Token({ secret }).encode(JSON.stringify(payload));
  return Response.json({ encrypted_data: encrypted });
}

describe("LegacySpottexClient transport contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encrypts SolaX credentials before calling the legacy login contract", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { email: string; password: string };
      expect(body.email).not.toBe("plant@example.test");
      expect(body.password).not.toBe("secret-password");
      expect(decrypt(body.email)).toBe("plant@example.test");
      expect(decrypt(body.password)).toBe("secret-password");
      return encryptedResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        plants: [
          {
            id: 42,
            device_id: 99,
            name: "Rodinný dům",
            optimization_running: false,
            required_info: false,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });
    await expect(client.login("plant@example.test", "secret-password")).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      plants: [{ siteId: "42", deviceId: "99", optimizationOn: false }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("discovers SolaX plants without using the legacy login contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/discover_plants");
      const body = JSON.parse(String(init?.body)) as { email: string; password: string };
      expect(decrypt(body.email)).toBe("new@example.test");
      expect(decrypt(body.password)).toBe("secret-password");
      return encryptedResponse({
        discovery_id: "discovery-token-1234567890",
        expires_in_seconds: 3600,
        plants: [
          {
            plant_id: "plant-20",
            name: "Výrobní hala",
            location: "Brno, CZ",
            pv_capacity_kwp: 49.5,
            battery_capacity_kwh: 30,
            device_coverage: {
              status: "POSSIBLY_INCOMPLETE",
              available_rated_power_kw: 20,
              expected_capacity_kwp: 49.5,
              percent: 40.4,
              warning: "SolaX zpřístupňuje jen část výkonu elektrárny.",
            },
            inverters: [
              {
                model: "X3-ULTRA",
                rated_power_kw: 50,
                serial_suffix: "123456",
              },
            ],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });
    await expect(
      client.discoverPlants("new@example.test", "secret-password"),
    ).resolves.toEqual({
      discoveryId: "discovery-token-1234567890",
      expiresInSeconds: 3600,
      plants: [
        expect.objectContaining({
          plantId: "plant-20",
          name: "Výrobní hala",
          pvCapacityKwp: 49.5,
          deviceCoverage: expect.objectContaining({
            status: "POSSIBLY_INCOMPLETE",
            availableRatedPowerKw: 20,
            expectedCapacityKwp: 49.5,
          }),
          inverters: [
            expect.objectContaining({ model: "X3-ULTRA", serialSuffix: "123456" }),
          ],
        }),
      ],
    });
  });

  it("registers the selected SolaX plants in one request", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/register_selected");
      const body = JSON.parse(String(init?.body)) as {
        email: string;
        password: string;
        plant_ids: string;
        discovery_id: string;
      };
      // The backend re-verifies the credentials against the fingerprint stored
      // during discovery, so they must travel with the selection — encrypted,
      // never in the clear.
      expect(body.email).not.toBe("plant@example.test");
      expect(decrypt(body.email)).toBe("plant@example.test");
      expect(decrypt(body.password)).toBe("plant-password");
      expect(JSON.parse(decrypt(body.plant_ids))).toEqual(["plant-20"]);
      expect(decrypt(body.discovery_id)).toBe("discovery-token-1234567890");
      return encryptedResponse({
        external_account_id: "new@example.test",
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        selected_supply_point_ids: [77],
        plants: [
          {
            id: 77,
            device_id: 88,
            name: "Výrobní hala",
            optimization_running: false,
            required_info: false,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });
    await expect(
      client.registerPlants(
        ["plant-20"],
        "discovery-token-1234567890",
        { email: "plant@example.test", password: "plant-password" },
      ),
    ).resolves.toMatchObject({
      selectedSiteIds: ["77"],
      plants: [{ siteId: "77", deviceId: "88", optimizationOn: false }],
    });
  });

  it("accepts a registration response that carries no explicit account id", async () => {
    // The backend identifies the account by the login it issued the tokens
    // for and sends no external_account_id at all. Requiring one discarded a
    // registration the backend had already committed.
    vi.stubGlobal("fetch", vi.fn(async () => encryptedResponse({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      selected_supply_point_ids: [77],
      plants: [
        {
          id: 77,
          device_id: 88,
          name: "Výrobní hala",
          optimization_running: false,
          required_info: false,
        },
      ],
    })));

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });

    await expect(
      client.registerPlants(["plant-20"], "discovery-token-1234567890", {
        email: "plant@example.test",
        password: "plant-password",
      }),
    ).resolves.toMatchObject({
      externalAccountId: "plant@example.test",
      selectedSiteIds: ["77"],
    });
  });

  it("keeps the reason a registration was rejected instead of a generic retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { error: "Missing encrypted credentials" },
      { status: 400 },
    )));

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });

    await expect(
      client.registerPlants(["plant-20"], "discovery-token-1234567890", {
        email: "plant@example.test",
        password: "plant-password",
      }),
    ).rejects.toMatchObject({
      code: "LEGACY_UNAVAILABLE",
      status: 502,
      detail: {
        stage: "register_selected",
        upstreamStatus: 400,
        upstreamMessage: "Missing encrypted credentials",
      },
    });
  });

  it("explains a plant SolaX offered but cannot register", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { error: "Selected plants have no inverter" },
      { status: 422 },
    )));

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });

    await expect(
      client.registerPlants(["plant-20"], "discovery-token-1234567890", {
        email: "plant@example.test",
        password: "plant-password",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 422,
      detail: { stage: "register_selected", upstreamStatus: 422 },
    });
  });

  it("reports invalid login credentials instead of an expired connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { success: false, message: "Invalid credentials" },
      { status: 401 },
    )));

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
    });

    await expect(client.login("missing@example.test", "wrong-password")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: "E-mail nebo heslo energetického účtu není správné.",
      status: 401,
    });
  });

  it("encrypts device ids only for command bodies and keeps read query ids numeric", async () => {
    const requests: Array<{ url: URL; body: string | null }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = typeof init?.body === "string" ? init.body : null;
      requests.push({ url, body });
      if (url.pathname.endsWith("/turnoff")) return new Response("ok");
      return encryptedResponse({
        ...(url.pathname.endsWith("/inverter") ? { optimization_running: false } : {}),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    await client.fetchOptimizationRunning("99");
    await client.issueCommand("turnoff", "99");

    expect(requests[0].url.searchParams.get("device_id")).toBe("99");
    const commandBody = JSON.parse(String(requests[1].body)) as { device_id: string };
    expect(commandBody.device_id).not.toBe("99");
    expect(decrypt(commandBody.device_id)).toBe("99");
  });

  it("returns the successful dashboard sections when the price endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/ote_price")) return Response.json({ error: "missing tariff" }, { status: 500 });
      if (url.pathname.endsWith("/inverter")) {
        return encryptedResponse({ production_kwh: 4.2, consumption_kwh: 1.4 });
      }
      return encryptedResponse({});
    }));

    const client = new LegacySpottexClient({
      baseUrl: "https://energy.example.test",
      fernetKey: FERNET_KEY,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const dashboard = await client.fetchDashboard("99");

    expect(dashboard.inverter).toEqual({ production_kwh: 4.2, consumption_kwh: 1.4 });
    expect(dashboard.price).toEqual({});
    expect(dashboard.issues).toEqual([
      expect.objectContaining({ section: "prices" }),
    ]);
  });
});
