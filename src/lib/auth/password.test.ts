import { describe, expect, it } from "vitest";

import { strongPasswordSchema } from "@/lib/auth/password";

describe("strongPasswordSchema", () => {
  it("accepts a strong password below bcrypt's byte limit", () => {
    expect(strongPasswordSchema.safeParse("Bezpecne-Heslo-2026").success).toBe(true);
  });

  it("rejects values that bcrypt would silently truncate", () => {
    expect(strongPasswordSchema.safeParse(`A1${"ž".repeat(36)}`).success).toBe(false);
    expect(strongPasswordSchema.safeParse(`A1${"x".repeat(71)}`).success).toBe(false);
  });
});
