// Canonical codes for the three Czech distribution system operators. Invoices
// name the distributor in free text ("ČEZ", "ČEZ Distribuce, a. s.", "EG.D"),
// while the tariff catalog keys distribution tariffs by company code; without
// one mapping the customer's own tariff is never found and the baseline curve
// silently fails with PRICE_CURVE_CURRENT_DISTRIBUTION_NOT_PUBLISHED.
export const DISTRIBUTOR_CODES = {
  CEZ: "CEZ_DISTRIBUCE",
  EGD: "EGD_DISTRIBUCE",
  PRE: "PRE_DISTRIBUCE",
} as const;

const ALIASES: Array<[RegExp, string]> = [
  [/(^|[^a-z])(čez|cez)([^a-z]|$)/i, DISTRIBUTOR_CODES.CEZ],
  [/(^|[^a-z])eg\.?\s?d([^a-z]|$)|e\.?on\s+distribuce/i, DISTRIBUTOR_CODES.EGD],
  [/pre\s*distribuce|^pre$|^pre[\s,.]/i, DISTRIBUTOR_CODES.PRE],
];

/**
 * Map free-text distributor naming to a canonical company code. Text that
 * does not name one of the three operators is returned trimmed and unchanged,
 * so an already canonical code passes through and unknown input stays visible
 * to the reviewer instead of being guessed.
 */
export function normalizeDistributorCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const known = Object.values(DISTRIBUTOR_CODES) as string[];
  if (known.includes(trimmed.toUpperCase())) return trimmed.toUpperCase();
  for (const [pattern, code] of ALIASES) {
    if (pattern.test(trimmed)) return code;
  }
  return trimmed;
}
