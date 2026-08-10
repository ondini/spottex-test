import { z } from "zod";

export const httpsUrl = z.string().url().refine((value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "Použijte platnou HTTPS adresu.");

export const httpsMediaUrl = httpsUrl.refine((value) => {
  if (process.env.NODE_ENV !== "production" && !process.env.PUBLIC_MEDIA_HOSTS) return true;
  const allowed = new Set((process.env.PUBLIC_MEDIA_HOSTS || "spottex.cz,www.spottex.cz")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
  try { return allowed.has(new URL(value).hostname.toLowerCase()); } catch { return false; }
}, "Obrázek musí být na povoleném mediálním hostu.");
