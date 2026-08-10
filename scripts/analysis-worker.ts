import { processAnalysisJobs } from "../src/lib/analysis/service";
import { prisma } from "../src/lib/prisma";

const pollIntervalMs = Math.max(
  1_000,
  Number(process.env.ANALYSIS_WORKER_POLL_MS ?? 5_000),
);
let stopping = false;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

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
