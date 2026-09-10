import "server-only";

import { prisma } from "@/lib/prisma";

import { backendControlActivity, backendControlSavings, type BackendControlSavings } from "./backend-readonly";
import type { EnergyControlActivity } from "./types";

/**
 * Live control activity of a site's inverters as the backend recorded it.
 * Best effort: a missing or unreachable backend database yields null and the
 * page simply omits the section.
 */
export async function siteControlActivity(userId: number, siteId: number): Promise<EnergyControlActivity[] | null> {
  const site = await prisma.energySite.findFirst({
    where: { id: siteId, userId, provider: "LEGACY_SPOTTEX" },
    select: { inverters: { select: { id: true, externalDeviceId: true }, orderBy: { id: "asc" } } },
  });
  if (!site?.inverters.length) return null;
  try {
    const activity = await backendControlActivity(site.inverters.map((inverter) => inverter.externalDeviceId));
    if (!activity) return null;
    return site.inverters.flatMap((inverter) => {
      const item = activity.find((entry) => entry.deviceId === inverter.externalDeviceId);
      return item ? [{ inverterId: inverter.id, ...item }] : [];
    });
  } catch (error) {
    console.warn("[control-activity] backend read failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Measured control savings of a site's inverters. Best effort, see above. */
export async function siteControlSavings(userId: number, siteId: number, hours = 24): Promise<BackendControlSavings[] | null> {
  const site = await prisma.energySite.findFirst({
    where: { id: siteId, userId, provider: "LEGACY_SPOTTEX" },
    select: { inverters: { select: { externalDeviceId: true }, orderBy: { id: "asc" } } },
  });
  if (!site?.inverters.length) return null;
  try {
    return await backendControlSavings(site.inverters.map((inverter) => inverter.externalDeviceId), hours);
  } catch (error) {
    console.warn("[control-activity] backend savings read failed", error instanceof Error ? error.message : error);
    return null;
  }
}
