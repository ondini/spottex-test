import { enqueueAnalysis } from "../src/lib/analysis/service";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: rebuild-user-base-analyses.ts <email>");
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      energySites: {
        orderBy: { id: "asc" },
        select: { id: true, name: true },
      },
    },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const results = [];
  for (const site of user.energySites) {
    try {
      const run = await enqueueAnalysis(user.id, {
        siteId: site.id,
        kind: "BASE",
        hardwareVariants: [],
      });
      results.push({
        siteId: site.id,
        name: site.name,
        runId: run.id,
        status: run.status,
      });
    } catch (error) {
      results.push({
        siteId: site.id,
        name: site.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
