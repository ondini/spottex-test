import type { Metadata } from "next";

import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { requireUser } from "@/lib/auth/guards";
import { getAnalysisWorkspace } from "@/lib/analysis/service";

export const metadata: Metadata = { title: "Pokročilá analýza" };

export default async function AdvancedSavingsAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await requireUser("/app/pokrocila-analyza");
  const requestedSiteId = Number((await searchParams).siteId);
  return (
    <AnalysisWorkspace
      initialWorkspace={await getAnalysisWorkspace(
        Number(session.user.id),
        requestedSiteId,
      )}
      initialSiteId={
        Number.isInteger(requestedSiteId) && requestedSiteId > 0
          ? requestedSiteId
          : undefined
      }
      advancedOnly
    />
  );
}
