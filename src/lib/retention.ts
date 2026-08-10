import { prisma } from "@/lib/prisma";
import { purgeExpiredEnergyInvoiceDocuments } from "@/lib/energy/invoice-document";

function days(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 3_650) : fallback;
}

const before = (retentionDays: number) => new Date(Date.now() - retentionDays * 86_400_000);

export async function runDataRetention() {
  const expiredRateLimits = await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const lastRun = await prisma.auditLog.findFirst({
    where: { action: "DATA_RETENTION_COMPLETED", createdAt: { gt: new Date(Date.now() - 23 * 60 * 60_000) } },
    select: { id: true },
  });
  if (lastRun) return { skipped: true, expiredRateLimits: expiredRateLimits.count };

  return prisma.$transaction(async (tx) => {
    const [events, consents, deliveredEmails, failedEmails, passwordResets, emailVerifications, auditLogs, energyInvoiceDocuments] = await Promise.all([
      tx.analyticsEvent.deleteMany({ where: { occurredAt: { lt: before(days("ANALYTICS_RETENTION_DAYS", 395)) } } }),
      tx.consentRecord.deleteMany({ where: { createdAt: { lt: before(days("CONSENT_RETENTION_DAYS", 1_825)) } } }),
      tx.emailOutbox.deleteMany({ where: { status: { in: ["SUCCEEDED", "CANCELED"] }, updatedAt: { lt: before(days("EMAIL_OUTBOX_RETENTION_DAYS", 7)) } } }),
      tx.emailOutbox.deleteMany({ where: { status: "FAILED", updatedAt: { lt: before(days("FAILED_EMAIL_RETENTION_DAYS", 30)) } } }),
      tx.passwordReset.deleteMany({ where: { OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }], createdAt: { lt: before(7) } } }),
      tx.emailVerification.deleteMany({ where: { OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date() } }], createdAt: { lt: before(7) } } }),
      tx.auditLog.deleteMany({ where: { createdAt: { lt: before(days("AUDIT_RETENTION_DAYS", 730)) } } }),
      purgeExpiredEnergyInvoiceDocuments(tx),
    ]);
    const consultationCutoff = before(days("CONSULTATION_PII_RETENTION_DAYS", 730));
    const anonymizedConsultations = await tx.$executeRaw`
      UPDATE consultation.consultation_booking
      SET "guestName" = NULL,
          "guestEmail" = 'anonymized+' || id::text || '@invalid.local',
          "guestPhone" = NULL,
          note = NULL,
          "clientIpHash" = NULL,
          "manageTokenHash" = 'anonymized-manage-' || id::text,
          "verifyTokenHash" = 'anonymized-verify-' || id::text,
          "manageTokenExpiresAt" = now(),
          metadata = jsonb_build_object('anonymized', true),
          "updatedAt" = now()
      WHERE status IN ('CANCELED', 'EXPIRED', 'COMPLETED', 'NO_SHOW')
        AND "updatedAt" < ${consultationCutoff}
        AND "guestEmail" NOT LIKE 'anonymized+%@invalid.local'
    `;
    const metadata = {
      analyticsEvents: events.count,
      consents: consents.count,
      deliveredEmails: deliveredEmails.count,
      failedEmails: failedEmails.count,
      passwordResets: passwordResets.count,
      emailVerifications: emailVerifications.count,
      auditLogs: auditLogs.count,
      anonymizedConsultations,
      expiredRateLimits: expiredRateLimits.count,
      energyInvoiceDocuments,
    };
    await tx.auditLog.create({ data: { action: "DATA_RETENTION_COMPLETED", entityType: "System", metadata } });
    return { skipped: false, ...metadata };
  });
}
