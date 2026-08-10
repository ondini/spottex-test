import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/guards";
import { reconcileGopay, safeGopayGatewayUrl } from "@/lib/commerce/payment";
import { prisma } from "@/lib/prisma";
import { PaymentResultTracker } from "@/components/cart/PaymentResultTracker";

export const metadata: Metadata = { title: "Výsledek platby", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ payment?: string; id?: string }> }) {
  const query = await searchParams;
  const callbackQuery = new URLSearchParams();
  if (query.payment) callbackQuery.set("payment", query.payment);
  if (query.id && /^\d{1,30}$/.test(query.id)) callbackQuery.set("id", query.id);
  const session = await requireUser(`/platba/navrat?${callbackQuery.toString()}`);
  if (!query.payment) notFound();
  let payment = await prisma.payment.findFirst({ where: { id: query.payment, userId: Number(session.user.id) } });
  if (!payment) notFound();
  if (payment.provider === "GOPAY" && ["CREATED", "PENDING"].includes(payment.status)) {
    const providerPaymentId = query.id && /^\d{1,30}$/.test(query.id) ? query.id : undefined;
    try { await reconcileGopay(payment.id, providerPaymentId); } catch (error) { console.error("Payment return reconciliation failed", error); }
    payment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }
  const providerPayload = payment.providerPayload && typeof payment.providerPayload === "object" && !Array.isArray(payment.providerPayload)
    ? payment.providerPayload as Record<string, unknown>
    : {};
  const paid = payment.status === "PAID";
  const freeAccess = paid && providerPayload.freeAccess === true;
  const freeTrial = paid && payment.amountMinor === 0 && !freeAccess;
  const gatewayUrl = !paid && payment.provider === "GOPAY" ? safeGopayGatewayUrl(providerPayload.gatewayUrl) : null;
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">{paid && <PaymentResultTracker paymentId={payment.id} amountMinor={payment.amountMinor} currency={payment.currency} />}<div className="w-full max-w-lg app-card p-8 text-center sm:p-11"><span className={`mx-auto grid size-16 place-items-center rounded-full text-3xl ${paid ? "bg-success-50 text-success-600" : "bg-warning-50 text-warning-600"}`}>{paid ? "✓" : "…"}</span><h1 className="mt-6 text-3xl font-bold text-slate-950">{freeAccess ? "Bezplatný přístup je aktivní" : freeTrial ? "Bezplatné období je aktivní" : paid ? "Platba proběhla úspěšně" : "Platbu ověřujeme"}</h1><p className="mt-4 leading-7 text-slate-600">{freeAccess ? "Služba byla v testovacím provozu aktivována zdarma. Stav najdete ve svém účtu." : freeTrial ? "Služba chytrého řízení byla na 30 dní aktivována. Stav a datum platnosti najdete ve svém účtu." : paid ? "Služba byla aktivována a daňový doklad najdete ve svém účtu." : gatewayUrl ? "Platba ještě není dokončená. Můžete bezpečně pokračovat na platební bránu." : "Stav od platební brány ještě není konečný. Přehled plateb se automaticky aktualizuje po přijetí potvrzení."}</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">{gatewayUrl && <a className="app-button" href={gatewayUrl}>Pokračovat na platební bránu</a>}<Link className={gatewayUrl ? "app-button app-button-secondary" : "app-button"} href="/app/sluzba">{paid ? "Zobrazit službu" : "Zkontrolovat stav platby"}</Link></div></div></main>;
}
