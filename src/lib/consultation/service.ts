import { ConsultationBookingStatus, ConsultationSlotStatus, Prisma } from "@prisma/client";

import { protectEmailBody, queueEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { formatPragueDate } from "@/lib/consultation/time";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

type ConsultationEmailClient = Pick<Prisma.TransactionClient, "emailOutbox">;
type ConsultationEmail = {
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  sendAt?: Date;
};

async function queueConsultationEmail(message: ConsultationEmail, db?: ConsultationEmailClient) {
  if (!db) return queueEmail(message);
  return db.emailOutbox.upsert({
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

export function publicBaseUrl() {
  return (process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3004").replace(/\/$/, "");
}

export async function releaseExpiredConsultationHolds(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expiredBookings = await tx.consultationBooking.updateMany({
      where: {
        status: ConsultationBookingStatus.PENDING,
        slot: { status: ConsultationSlotStatus.HELD, holdExpiresAt: { lt: now } },
      },
      data: { status: ConsultationBookingStatus.EXPIRED },
    });
    const releasedSlots = await tx.consultationSlot.updateMany({
      where: { status: ConsultationSlotStatus.HELD, holdExpiresAt: { lt: now } },
      data: { status: ConsultationSlotStatus.OPEN, holdExpiresAt: null },
    });
    return { expiredBookings: expiredBookings.count, releasedSlots: releasedSlots.count };
  });
}

export async function queueBookingVerification(options: {
  bookingId: number;
  email: string;
  name?: string | null;
  startUtc: Date;
  verifyToken: string;
  db?: ConsultationEmailClient;
}) {
  const date = formatPragueDate(options.startUtc);
  const verifyUrl = `${publicBaseUrl()}/api/consultations/verify?token=${encodeURIComponent(options.verifyToken)}`;
  const greeting = options.name ? `Dobrý den ${escapeHtml(options.name)},` : "Dobrý den,";
  return queueConsultationEmail({
    idempotencyKey: `consultation:${options.bookingId}:verify`,
    to: options.email,
    subject: "Potvrďte rezervaci konzultace Spottex",
    text: `Dobrý den,\n\npro potvrzení konzultace ${date} otevřete tento odkaz: ${verifyUrl}\n\nOdkaz je platný 30 minut.`,
    html: `<p>${greeting}</p><p>pro potvrzení konzultace <strong>${escapeHtml(date)}</strong> otevřete následující odkaz:</p><p><a href="${verifyUrl}">Potvrdit rezervaci</a></p><p>Odkaz je platný 30 minut.</p>`,
  }, options.db);
}

export async function queueBookingConfirmation(options: {
  bookingId: number;
  email: string;
  name?: string | null;
  startUtc: Date;
  meetUrl?: string | null;
  manageToken: string;
  db?: ConsultationEmailClient;
}) {
  const date = formatPragueDate(options.startUtc);
  const manageUrl = `${publicBaseUrl()}/konzultace/spravovat?token=${encodeURIComponent(options.manageToken)}`;
  const meeting = options.meetUrl ? `\nOdkaz na online schůzku: ${options.meetUrl}` : "";
  const safeName = options.name ? escapeHtml(options.name) : "";
  const meetingHtml = options.meetUrl ? `<p><a href="${escapeHtml(options.meetUrl)}">Připojit se ke Google Meet</a></p>` : "";
  return queueConsultationEmail({
    idempotencyKey: `consultation:${options.bookingId}:confirmed:${options.startUtc.toISOString()}`,
    to: options.email,
    subject: "Konzultace Spottex je potvrzená",
    text: `Dobrý den${options.name ? ` ${options.name}` : ""},\n\nvaše konzultace ${date} je potvrzená.${meeting}\nRezervaci můžete spravovat zde: ${manageUrl}`,
    html: `<p>Dobrý den${safeName ? ` ${safeName}` : ""},</p><p>vaše konzultace <strong>${escapeHtml(date)}</strong> je potvrzená.</p>${meetingHtml}<p><a href="${manageUrl}">Změnit nebo zrušit rezervaci</a></p>`,
  }, options.db);
}

export async function queueHostBookingNotice(options: {
  bookingId: number;
  hostEmail: string;
  guestName?: string | null;
  guestEmail: string;
  guestPhone?: string | null;
  note?: string | null;
  startUtc: Date;
  db?: ConsultationEmailClient;
}) {
  const details = [options.guestEmail, options.guestPhone].filter(Boolean).join(" · ");
  return queueConsultationEmail({
    idempotencyKey: `consultation:${options.bookingId}:host-notice:${options.startUtc.toISOString()}`,
    to: options.hostEmail,
    subject: "Nová konzultace Spottex",
    text: `Nová konzultace ${formatPragueDate(options.startUtc)}\nZájemce: ${options.guestName || "Neuvedeno"}\nKontakt: ${details}\nPoznámka: ${options.note || "—"}`,
  }, options.db);
}

export async function queueConsultationReminder(options: {
  bookingId: number;
  email: string;
  name?: string | null;
  startUtc: Date;
  meetUrl?: string | null;
  db?: ConsultationEmailClient;
}) {
  const desiredSendAt = new Date(options.startUtc.getTime() - 24 * 60 * 60_000);
  const sendAt = desiredSendAt.getTime() > Date.now() ? desiredSendAt : new Date();
  return queueConsultationEmail({
    idempotencyKey: `consultation:${options.bookingId}:reminder:${options.startUtc.toISOString()}`,
    to: options.email,
    subject: "Připomínka konzultace Spottex",
    text: `Dobrý den${options.name ? ` ${options.name}` : ""},\n\npřipomínáme konzultaci ${formatPragueDate(options.startUtc)}.${options.meetUrl ? `\nPřipojení: ${options.meetUrl}` : ""}`,
    sendAt,
  }, options.db);
}

export async function queueConsultationMeetReady(options: {
  bookingId: number;
  revision: number;
  email: string;
  name?: string | null;
  startUtc: Date;
  meetUrl: string;
  db?: ConsultationEmailClient;
}) {
  const date = formatPragueDate(options.startUtc);
  const safeUrl = escapeHtml(options.meetUrl);
  return queueConsultationEmail({
    idempotencyKey: `consultation:${options.bookingId}:meet-ready:r${options.revision}`,
    to: options.email,
    subject: "Odkaz na Google Meet ke konzultaci Spottex",
    text: `Dobrý den${options.name ? ` ${options.name}` : ""},\n\nodkaz pro připojení ke konzultaci ${date}: ${options.meetUrl}`,
    html: `<p>Dobrý den${options.name ? ` ${escapeHtml(options.name)}` : ""},</p><p>odkaz pro připojení ke konzultaci <strong>${escapeHtml(date)}</strong> je připraven:</p><p><a href="${safeUrl}">Připojit se ke Google Meet</a></p>`,
  }, options.db);
}

export async function cancelPendingConsultationReminders(bookingId: number, db: ConsultationEmailClient = prisma) {
  return db.emailOutbox.updateMany({
    where: {
      idempotencyKey: { startsWith: `consultation:${bookingId}:reminder:` },
      status: "PENDING",
    },
    data: { status: "CANCELED" },
  });
}
