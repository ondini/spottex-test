CREATE TYPE "general"."EnergyHistoryImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELED');
CREATE TYPE "general"."EnergyHistoryChunkStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "general"."energy_history_import" (
  "id" TEXT NOT NULL,
  "energySiteId" INTEGER NOT NULL,
  "inverterId" INTEGER NOT NULL,
  "requestedFrom" TIMESTAMP(3) NOT NULL,
  "requestedTo" TIMESTAMP(3) NOT NULL,
  "status" "general"."EnergyHistoryImportStatus" NOT NULL DEFAULT 'QUEUED',
  "totalChunks" INTEGER NOT NULL,
  "succeededChunks" INTEGER NOT NULL DEFAULT 0,
  "failedChunks" INTEGER NOT NULL DEFAULT 0,
  "importedPoints" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "energy_history_import_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_history_import_window" CHECK ("requestedTo" > "requestedFrom"),
  CONSTRAINT "energy_history_import_counts" CHECK ("totalChunks" > 0 AND "succeededChunks" >= 0 AND "failedChunks" >= 0 AND "importedPoints" >= 0)
);

CREATE TABLE "general"."energy_history_import_chunk" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "chunkFrom" TIMESTAMP(3) NOT NULL,
  "chunkTo" TIMESTAMP(3) NOT NULL,
  "status" "general"."EnergyHistoryChunkStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 4,
  "importedPoints" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "energy_history_import_chunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_history_chunk_window" CHECK ("chunkTo" > "chunkFrom"),
  CONSTRAINT "energy_history_chunk_counts" CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "importedPoints" >= 0)
);

CREATE INDEX "energy_history_import_energySiteId_status_createdAt_idx" ON "general"."energy_history_import"("energySiteId", "status", "createdAt");
CREATE INDEX "energy_history_import_inverterId_createdAt_idx" ON "general"."energy_history_import"("inverterId", "createdAt");
CREATE UNIQUE INDEX "energy_history_import_chunk_importId_chunkFrom_key" ON "general"."energy_history_import_chunk"("importId", "chunkFrom");
CREATE INDEX "energy_history_import_chunk_status_updatedAt_idx" ON "general"."energy_history_import_chunk"("status", "updatedAt");

ALTER TABLE "general"."energy_history_import" ADD CONSTRAINT "energy_history_import_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "general"."energy_history_import" ADD CONSTRAINT "energy_history_import_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "general"."energy_history_import_chunk" ADD CONSTRAINT "energy_history_import_chunk_importId_fkey" FOREIGN KEY ("importId") REFERENCES "general"."energy_history_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;
