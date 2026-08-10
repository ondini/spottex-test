import { processEmailOutbox } from "../src/lib/email";
import { prisma } from "../src/lib/prisma";

async function main() {
  await processEmailOutbox(50);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "E-mail outbox processing failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
