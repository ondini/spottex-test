import { SMTPClient } from "emailjs";
import { Resend } from "resend";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

type EmailMessage = {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  sendAt?: Date;
};

export async function queueEmail(message: EmailMessage) {
  return prisma.emailOutbox.upsert({
    where: { idempotencyKey: message.idempotencyKey },
    update: {},
    create: {
      idempotencyKey: message.idempotencyKey,
      toEmail: message.to,
      subject: message.subject,
      textBody: protectEmailBody(message.text),
      htmlBody: message.html ? protectEmailBody(message.html) : null,
      sendAt: message.sendAt,
    },
  });
}

const ENCRYPTED_PREFIX = "encrypted:v1:";

export function protectEmailBody(value: string) {
  return `${ENCRYPTED_PREFIX}${encryptSecret(value)}`;
}

function revealEmailBody(value: string | null) {
  if (!value) return null;
  return value.startsWith(ENCRYPTED_PREFIX) ? decryptSecret(value.slice(ENCRYPTED_PREFIX.length)) : value;
}

async function deliverEmail(message: { toEmail: string; subject: string; textBody: string; htmlBody: string | null }) {
  const from = process.env.EMAIL_FROM || "Spottex <noreply@spottex.cz>";
  const textBody = revealEmailBody(message.textBody) || "";
  const htmlBody = revealEmailBody(message.htmlBody);
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({ from, to: message.toEmail, subject: message.subject, text: textBody, html: htmlBody || undefined });
    if (result.error) throw new Error(result.error.message);
    return;
  }

  const smtp = new SMTPClient({
    host: process.env.SMTP_HOST || "127.0.0.1",
    port: Number(process.env.SMTP_PORT || 1026),
    ssl: process.env.SMTP_SECURE === "true",
    tls: process.env.SMTP_STARTTLS === "true",
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
  });
  try {
    await smtp.sendAsync({
      from,
      to: message.toEmail,
      subject: message.subject,
      text: textBody,
      ...(htmlBody ? { attachment: [{ data: htmlBody, alternative: true, contentType: "text/html" }] } : {}),
    });
  } finally {
    smtp.smtp.close();
  }
}

export async function processEmailOutbox(limit = 20) {
  const staleLock = new Date(Date.now() - 10 * 60_000);
  await prisma.emailOutbox.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: staleLock }, attempts: { lt: 5 } },
    data: { status: "PENDING", lastError: "Recovered after an interrupted delivery attempt" },
  });
  await prisma.emailOutbox.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: staleLock }, attempts: { gte: 5 } },
    data: { status: "FAILED", lastError: "Delivery worker stopped repeatedly" },
  });
  const pending = await prisma.emailOutbox.findMany({
    where: { status: "PENDING", sendAt: { lte: new Date() } },
    orderBy: { sendAt: "asc" },
    take: limit,
  });
  let sent = 0;
  for (const message of pending) {
    const claimed = await prisma.emailOutbox.updateMany({
      where: { id: message.id, status: "PENDING" },
      data: { status: "RUNNING", attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    try {
      await deliverEmail(message);
      await prisma.emailOutbox.update({
        where: { id: message.id },
        data: { status: "SUCCEEDED", sentAt: new Date(), lastError: null, textBody: "[redacted after delivery]", htmlBody: null },
      });
      sent += 1;
    } catch (error) {
      await prisma.emailOutbox.update({
        where: { id: message.id },
        data: { status: message.attempts >= 4 ? "FAILED" : "PENDING", lastError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown email error" },
      });
    }
  }
  return { processed: pending.length, sent };
}
