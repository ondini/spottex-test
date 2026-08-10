import { prisma } from "../src/lib/prisma";
import { syncBackendMarketPrices } from "../src/lib/pricing/backend-market-source";

async function run() {
  const result = await syncBackendMarketPrices({ force: true });
  console.log(JSON.stringify(result, null, 2));
  if (!result.configured || result.status === "EMPTY") process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "MARKET_SYNC_FAILED");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
