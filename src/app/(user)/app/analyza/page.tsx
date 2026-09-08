import type { Metadata } from "next";
import { after } from "next/server";

import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { requireUser } from "@/lib/auth/guards";
import { getAnalysisWorkspace } from "@/lib/analysis/service";
import { markSiteViewed, refreshSiteHistoryIfSparse } from "@/lib/energy/history-import";

export const metadata: Metadata = { title: "Analýza úspor" };

export default async function SavingsAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; start?: string; data?: string }>;
}) {
  const session = await requireUser("/app/analyza");
  const params = await searchParams;
  const requestedSiteId = Number(params.siteId);
  const userId = Number(session.user.id);
  const workspace = await getAnalysisWorkspace(userId, requestedSiteId);
  // The workspace is narrowed to the selected plant, so its first site is the one being viewed.
  const viewedSiteId = workspace.sites[0]?.id;
  if (viewedSiteId) {
    // A visit is the signal that the history matters now: remember it (it
    // drives the hourly retry cadence) and, if the history is sparse, ask for
    // the missing windows once the page has been sent.
    after(async () => {
      try {
        await markSiteViewed(userId, viewedSiteId);
        await refreshSiteHistoryIfSparse(userId, viewedSiteId, "VISIT");
      } catch {
        /* best effort; the page must not depend on it */
      }
    });
  }
  return (
    <AnalysisWorkspace
      initialWorkspace={workspace}
      initialSiteId={Number.isInteger(requestedSiteId) && requestedSiteId > 0 ? requestedSiteId : undefined}
      autoStart={params.start === "1"}
      autoOpenData={params.data === "1"}
    />
  );
}
