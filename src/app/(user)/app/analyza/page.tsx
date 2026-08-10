import type { Metadata } from "next";

import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { requireUser } from "@/lib/auth/guards";
import { getAnalysisWorkspace } from "@/lib/analysis/service";

export const metadata: Metadata = { title: "Analýza úspor" };

export default async function SavingsAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; start?: string; data?: string }>;
}) {
  const session = await requireUser("/app/analyza");
  const params = await searchParams;
  const requestedSiteId = Number(params.siteId);
  return (
    <AnalysisWorkspace
      initialWorkspace={await getAnalysisWorkspace(Number(session.user.id), requestedSiteId)}
      initialSiteId={Number.isInteger(requestedSiteId) && requestedSiteId > 0 ? requestedSiteId : undefined}
      autoStart={params.start === "1"}
      autoOpenData={params.data === "1"}
    />
  );
}
