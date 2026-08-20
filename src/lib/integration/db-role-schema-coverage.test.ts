import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("database role grants", () => {
  it("cover every schema used by a Prisma model", () => {
    const prismaSchema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const grantScript = readFileSync(resolve("scripts/grant-db-role.ts"), "utf8");
    const modelSchemas = new Set(
      [...prismaSchema.matchAll(/@@schema\("([a-z_]+)"\)/g)].map(
        (match) => match[1],
      ),
    );
    const grantArray = grantScript.match(/const schemas = \[([\s\S]*?)\];/)?.[1] ?? "";
    const grantedSchemas = new Set(
      [...grantArray.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]),
    );

    expect([...modelSchemas].filter((schema) => !grantedSchemas.has(schema))).toEqual([]);
  });
});
