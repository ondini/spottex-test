import "server-only";

const catalogDomains = [
  "ENERGY_SUPPLY",
  "ENERGY_DISTRIBUTION",
  "ENERGY_MARKET",
  "PV_MODULE",
  "INVERTER",
  "BATTERY",
  "PV_MOUNTING",
  "FUNDING",
] as const;

export type CostsCatalogDomain = (typeof catalogDomains)[number];

export type CostsCatalogSummary = {
  configured: boolean;
  reachable: boolean;
  asOf: string | null;
  domains: Partial<Record<CostsCatalogDomain, number>>;
  message: string;
};

const summaryCache = new Map<
  string,
  { expiresAt: number; value: Promise<CostsCatalogSummary> }
>();
const SUMMARY_CACHE_MS = Math.max(
  30_000,
  Number(process.env.COSTS_SUMMARY_CACHE_MS ?? 5 * 60_000),
);

export function configuredCostsBaseUrl(): URL | null {
  const raw = process.env.COSTS_INTERNAL_API_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export async function getCostsCatalogSummary(
  domains: CostsCatalogDomain[] = [
    "ENERGY_SUPPLY",
    "ENERGY_DISTRIBUTION",
  ],
): Promise<CostsCatalogSummary> {
  const cacheKey = [...new Set(domains)].sort().join(":");
  const cached = summaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = loadCostsCatalogSummary(domains);
  summaryCache.set(cacheKey, {
    expiresAt: Date.now() + SUMMARY_CACHE_MS,
    value,
  });
  return value;
}

async function loadCostsCatalogSummary(
  domains: CostsCatalogDomain[],
): Promise<CostsCatalogSummary> {
  const baseUrl = configuredCostsBaseUrl();
  const apiKey = process.env.COSTS_INTERNAL_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return {
      configured: false,
      reachable: false,
      asOf: null,
      domains: {},
      message: "Centrální katalog Costs zatím není na tomto serveru připojený.",
    };
  }
  const requested = [...new Set(domains)].filter((domain) =>
    catalogDomains.includes(domain),
  );
  try {
    const results = await Promise.all(
      requested.map(async (domain) => {
        const url = new URL("api/v1/catalog/products", baseUrl);
        url.searchParams.set("domain", domain);
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${apiKey}` },
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`COSTS_HTTP_${response.status}`);
        const payload = (await response.json()) as {
          snapshot?: { asOf?: string };
          items?: Array<{ versions?: unknown[] }>;
        };
        return {
          domain,
          asOf: payload.snapshot?.asOf ?? null,
          count:
            payload.items?.filter((item) => (item.versions?.length ?? 0) > 0)
              .length ?? 0,
        };
      }),
    );
    return {
      configured: true,
      reachable: true,
      asOf: results
        .map((result) => result.asOf)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      domains: Object.fromEntries(
        results.map((result) => [result.domain, result.count]),
      ),
      message:
        "Centrální katalog Costs je dostupný; Spottex používá jen publikované a verzované záznamy.",
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      asOf: null,
      domains: {},
      message:
        "Centrální katalog Costs je dočasně nedostupný. Analýza použije poslední lokálně publikovanou verzi.",
    };
  }
}
