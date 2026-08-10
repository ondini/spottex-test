import type { Metadata } from "next";

import { TechnicalProfileWorkspace } from "@/components/energy/TechnicalProfileWorkspace";
import { requireUser } from "@/lib/auth/guards";
import { getTechnicalProfileWorkspace } from "@/lib/energy/technical-profile";

export const metadata: Metadata = { title: "Moje elektrárna" };

export default async function EnergySitePage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await requireUser("/app/elektrarna");
  const requestedSiteId = Number((await searchParams).siteId);
  const workspace = await getTechnicalProfileWorkspace(
    Number(session.user.id),
    Number.isInteger(requestedSiteId) && requestedSiteId > 0
      ? requestedSiteId
      : undefined,
  );
  return <TechnicalProfileWorkspace initialWorkspace={workspace} />;
}
