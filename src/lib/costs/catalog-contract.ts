type KeyedCatalogValue = {
  key: string;
};

/**
 * Costs stores specification keys in a canonical lowercase form, while older
 * publishers and consumers used camelCase or separators. Keep the wire
 * contract tolerant without weakening any of the value/provenance checks.
 */
export function normalizeCatalogKey(key: string) {
  return key
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function findCatalogValue<T extends KeyedCatalogValue>(
  values: T[],
  keys: string[],
) {
  const accepted = new Set(keys.map(normalizeCatalogKey));
  return values.find((value) => accepted.has(normalizeCatalogKey(value.key)));
}

export function latestCatalogActivity(
  importedAt: Date | null | undefined,
  attemptedAt: Date | null | undefined,
) {
  if (!importedAt) return attemptedAt ?? null;
  if (!attemptedAt) return importedAt;
  return importedAt > attemptedAt ? importedAt : attemptedAt;
}
