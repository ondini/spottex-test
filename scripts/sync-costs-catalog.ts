import { syncCostsEnergyCatalog } from "../src/lib/costs/catalog-sync";
import { prisma } from "../src/lib/prisma";

async function run() {
  const result = await syncCostsEnergyCatalog({ force: true });
  console.log(JSON.stringify(result, null, 2));
  if (!result.configured) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "COSTS_SYNC_FAILED");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
