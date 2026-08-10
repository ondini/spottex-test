import type { Metadata } from "next";
import Link from "next/link";

import { hashToken } from "@/lib/crypto";
import { formatPragueDate } from "@/lib/consultation/time";
import { prisma } from "@/lib/prisma";
import ConfirmConsultationForm from "./ConfirmConsultationForm";

export const metadata: Metadata = {
  title: "Potvrzení konzultace",
  robots: { index: false, follow: false },
};

type ConfirmationQuery = {
  booking?: string | string[];
  error?: string | string[];
  token?: string | string[];
};

export default async function ConsultationConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<ConfirmationQuery>;
}) {
  const query = await searchParams;
  const bookingId = Array.isArray(query.booking) ? query.booking[0] : query.booking;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  const validToken = typeof token === "string" && token.length > 0 && token.length <= 200;
  const pendingBooking = validToken
    ? await prisma.consultationBooking.findUnique({
      where: { verifyTokenHash: hashToken(token) },
      select: {
        status: true,
        slot: { select: { startUtc: true, status: true, holdExpiresAt: true } },
      },
    })
    : null;
  const canConfirm = Boolean(
    pendingBooking?.status === "PENDING"
      && pendingBooking.slot.status === "HELD"
      && pendingBooking.slot.holdExpiresAt
      && pendingBooking.slot.holdExpiresAt > new Date(),
  );
  const success = Boolean(bookingId || pendingBooking?.status === "CONFIRMED");
  const expired = error === "expired" || (validToken && pendingBooking && !canConfirm && !success);
  const calendarUnavailable = error === "calendar";
  const slotConflict = error === "slot-conflict";
  const showConfirmation = canConfirm && !error;

  const title = showConfirmation
    ? "Potvrďte rezervaci konzultace"
    : success
      ? "Rezervace je potvrzená"
      : expired
        ? "Platnost odkazu vypršela"
        : slotConflict
          ? "Termín už není k dispozici"
          : calendarUnavailable
            ? "Potvrzení se nyní nepodařilo"
            : "Odkaz není platný";

  const description = showConfirmation
    ? `Kliknutím potvrďte konzultaci ${formatPragueDate(pendingBooking!.slot.startUtc)}. Teprve poté termín závazně rezervujeme.`
    : success
      ? "Podrobnosti a odkaz pro správu rezervace jsme poslali e-mailem. Těšíme se na setkání."
      : calendarUnavailable
        ? "Kalendář nyní nelze bezpečně ověřit. Zkuste potvrzení za chvíli znovu stejným odkazem."
        : "Vyberte si prosím nový volný termín a rezervaci dokončete do 30 minut.";

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8f5] px-4 py-12">
      <div className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5 sm:p-12">
        <span className={`mx-auto grid size-16 place-items-center rounded-full text-3xl ${showConfirmation || success ? "bg-brand-50 text-brand-700" : "bg-error-50 text-error-600"}`}>
          {success ? "✓" : showConfirmation ? "?" : "!"}
        </span>
        <h1 className="mt-6 text-3xl font-bold text-slate-950">{title}</h1>
        <p className="mt-4 leading-7 text-slate-600">{description}</p>
        {showConfirmation && token ? (
          <ConfirmConsultationForm token={token} />
        ) : (
          <Link className="app-button mt-7" href={success || calendarUnavailable ? (calendarUnavailable ? `/api/consultations/verify?token=${encodeURIComponent(token || "")}` : "/") : "/konzultace"}>
            {success ? "Zpět na Spottex" : calendarUnavailable ? "Zkusit potvrzení znovu" : "Vybrat nový termín"}
          </Link>
        )}
      </div>
    </main>
  );
}
