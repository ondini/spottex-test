import {
  getActiveAnalysisJobId,
  processAnalysisJobs,
  recoverStaleAnalysisJobs,
} from "../src/lib/analysis/service";
import { prisma } from "../src/lib/prisma";

const pollIntervalMs = Math.max(
  1_000,
  Number(process.env.ANALYSIS_WORKER_POLL_MS ?? 5_000),
);
let stopping = false;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// A deploy recreates this container mid-scenario. Without this the claimed
// job stayed locked until the stale-lock recovery an hour later; handing it
// back immediately lets the next worker resume the run within seconds.
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  const jobId = getActiveAnalysisJobId();
  if (jobId) {
    try {
      const result = await recoverStaleAnalysisJobs(new Date(), [jobId], { force: true });
      console.log(JSON.stringify({ event: "analysis-worker-released", signal, jobId, ...result }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "analysis-worker-release-failed",
          signal,
          jobId,
          message: error instanceof Error ? error.message : "RELEASE_FAILED",
        }),
      );
    }
  }
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function main() {
  while (!stopping) {
    try {
      const result = await processAnalysisJobs({ limit: 1 });
      if (result.succeeded || result.failed) {
        console.log(
          JSON.stringify({
            event: "analysis-worker-cycle",
            ...result,
          }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "analysis-worker-error",
          message:
            error instanceof Error ? error.message : "ANALYSIS_WORKER_ERROR",
        }),
      );
    }
    if (!stopping) await wait(pollIntervalMs);
  }
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
