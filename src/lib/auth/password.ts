import { z } from "zod";

export const strongPasswordSchema = z.string()
  .min(10)
  .max(72)
  .regex(/[a-zá-ž]/i)
  .regex(/[A-ZÁ-Ž]/)
  .regex(/[0-9]/)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Heslo může mít nejvýše 72 bytů.",
  });
