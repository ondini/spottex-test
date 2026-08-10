import type { Metadata } from "next";
import { BadgeCheck, CalendarClock, CreditCard, PackageOpen, ReceiptText, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";

import { EmptyState, formatDate, formatMoney, PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import { RecurringMandatePanel } from "@/components/commerce/RecurringMandatePanel";
import { ServiceOfferCard } from "@/components/commerce/ServiceOfferCard";
import { CancelSubscriptionButton } from "@/components/subscription/CancelSubscriptionButton";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Služba a vyúčtování" };

const subscriptionLabels = { ACTIVE: "Aktivní", TRIAL: "Zkušební", PAST_DUE: "Po splatnosti", CANCELED: "Zrušená", EXPIRED: "Ukončená" } as const;
const paymentLabels = { CREATED: "Vytvořena", PENDING: "Čeká na úhradu", PAID: "Zaplacena", FAILED: "Neúspěšná", CANCELED: "Zrušena", REFUNDED: "Vrácena" } as const;
const invoiceLabels = { DRAFT: "Koncept", ISSUED: "Vystaven", PAID: "Zaplacen", CANCELED: "Zrušen" } as const;

export default async function ServicePage() {
  const session = await requireUser("/app/sluzba");
  const userId = Number(session.user.id);
  const now = new Date();
  const [mandates, offers, subscriptions, payments, invoices, profile] = await Promise.all([
    prisma.recurringPaymentMandate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, provider: true, status: true, currency: true, maxAmountMinor: true,
        renewalPeriodDays: true, noticeDays: true, consentedAt: true, validUntil: true, revokedAt: true,
        renewals: { orderBy: { scheduledAt: "desc" }, take: 1, select: { status: true, amountMinor: true, scheduledAt: true, noticeSentAt: true } },
      },
    }),
    prisma.serviceOffer.findMany({ where: { userId, status: "OFFERED", validUntil: { gt: now } }, include: { energySite: { select: { name: true } }, analysisRun: { select: { confidence: true, dataFrom: true, dataTo: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.subscription.findMany({ where: { userId }, include: { product: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.invoice.findMany({ where: { userId }, orderBy: { issuedAt: "desc" }, take: 30 }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, street: true, city: true, postalCode: true, country: true, companyName: true, companyIdNumber: true, vatId: true } }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Služba a vyúčtování"
        description="Na jednom místě vidíte roční službu, automatické obnovení, platby, daňové doklady i fakturační údaje."
        action={<Link href={subscriptions.length ? "/app/analyza" : "/app/sluzba/objednavka"} className="app-button"><Sparkles className="size-4" /> {subscriptions.length ? "Spočítat novou cenu" : "Vyzkoušet službu"}</Link>}
      />

      {offers.map((offer) => <ServiceOfferCard key={offer.id} offer={{ id: offer.id, siteName: offer.energySite.name, expectedControlSavingsMinor: offer.expectedControlSavingsMinor, listPriceMinor: offer.listPriceMinor, discountMinor: offer.discountMinor, finalPriceMinor: offer.finalPriceMinor, validUntil: offer.validUntil.toISOString(), confidence: offer.analysisRun?.confidence ?? null, methodologyVersion: offer.methodologyVersion, dataFrom: offer.analysisRun?.dataFrom?.toISOString() ?? null, dataTo: offer.analysisRun?.dataTo?.toISOString() ?? null }} />)}

      <section id="stav-sluzby" className="scroll-mt-24 space-y-4">
        <div><h2 className="text-xl font-semibold text-slate-900">Stav služby</h2><p className="mt-1 text-sm text-slate-500">Aktivace chytrého řízení a konec zaplaceného období.</p></div>
        {!subscriptions.length ? (
          <EmptyState icon={PackageOpen} title="Zatím nemáte aktivní službu" description="Nejdřív dokončete analýzu úspor. Pokud je nabídka připravená, cenu uvidíte výše." action={<Link href="/app/analyza" className="app-button">Spočítat úsporu</Link>} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {subscriptions.map((subscription, index) => {
              const live = ["ACTIVE", "TRIAL"].includes(subscription.status) && (!subscription.endsAt || subscription.endsAt > now);
              return (
                <article key={subscription.id} className={`app-card overflow-hidden ${index === 0 ? "ring-1 ring-brand-500/20" : ""}`}>
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                    <div className="flex items-center gap-3"><span className={`grid size-11 shrink-0 place-items-center rounded-xl ${live ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}><BadgeCheck className="size-5" /></span><div><h3 className="font-semibold text-slate-900">{subscription.product.name}</h3><p className="mt-1 text-sm text-slate-500">{subscription.product.description}</p></div></div>
                    <StatusBadge tone={live ? "success" : subscription.status === "PAST_DUE" ? "warning" : "neutral"}>{subscriptionLabels[subscription.status]}</StatusBadge>
                  </div>
                  <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3"><div><dt className="text-xs uppercase tracking-wide text-slate-400">Aktivace</dt><dd className="mt-1 font-medium text-slate-700">{formatDate(subscription.startsAt)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-400">Platnost do</dt><dd className="mt-1 font-medium text-slate-700">{subscription.endsAt ? formatDate(subscription.endsAt) : "Bez omezení"}</dd></div><div><dt className="text-xs uppercase tracking-wide text-slate-400">Typ</dt><dd className="mt-1 font-medium text-slate-700">{subscription.source === "PROMO" ? "PROMO" : subscription.source === "PAID" ? "Placená" : "Ruční"}</dd></div></dl>
                  {live && <div className="flex items-center justify-between gap-3 bg-brand-50/60 px-5 py-3 text-xs font-medium text-brand-800"><span className="flex items-center gap-2"><CalendarClock className="size-4" /> Řízení je aktivní.</span><CancelSubscriptionButton subscriptionId={subscription.id} /></div>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div><h2 className="text-xl font-semibold text-slate-900">Roční automatické obnovení</h2><p className="mt-1 text-sm text-slate-500">Před každým stržením nejdřív vytvoříme novou analýzu a cenu oznámíme nejméně 14 dní předem.</p></div>
        <RecurringMandatePanel initialMandates={mandates.map((mandate) => ({ ...mandate, consentedAt: mandate.consentedAt.toISOString(), validUntil: mandate.validUntil?.toISOString() ?? null, revokedAt: mandate.revokedAt?.toISOString() ?? null, renewals: mandate.renewals.map((renewal) => ({ ...renewal, scheduledAt: renewal.scheduledAt.toISOString(), noticeSentAt: renewal.noticeSentAt?.toISOString() ?? null })) }))} />
      </section>

      <section id="platby" className="scroll-mt-24 space-y-4">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><CreditCard className="size-5" /></span><div><h2 className="text-xl font-semibold text-slate-900">Platby</h2><p className="text-sm text-slate-500">Poslední transakce a jejich ověřený stav.</p></div></div>
        {!payments.length ? <p className="app-card p-6 text-sm text-slate-500">Zatím nemáte žádnou platbu.</p> : <div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3.5">Datum</th><th className="px-5 py-3.5">ID</th><th className="px-5 py-3.5">Způsob</th><th className="px-5 py-3.5">Částka</th><th className="px-5 py-3.5">Stav</th></tr></thead><tbody className="divide-y divide-slate-100">{payments.map((payment) => <tr key={payment.id}><td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(payment.createdAt, true)}</td><td className="px-5 py-4 font-mono text-xs text-slate-500">{payment.id}</td><td className="px-5 py-4 text-slate-600">{payment.provider === "MOCK" ? "Testovací" : payment.provider === "BANK_TRANSFER" ? "Bankovní převod" : payment.provider}</td><td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{formatMoney(payment.amountMinor, payment.currency)}</td><td className="px-5 py-4"><StatusBadge tone={payment.status === "PAID" ? "success" : payment.status === "PENDING" ? "warning" : payment.status === "FAILED" ? "danger" : "neutral"}>{paymentLabels[payment.status]}</StatusBadge></td></tr>)}</tbody></table></div>}
      </section>

      <section id="doklady" className="scroll-mt-24 space-y-4">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><ReceiptText className="size-5" /></span><div><h2 className="text-xl font-semibold text-slate-900">Daňové doklady</h2><p className="text-sm text-slate-500">Doklad otevřete a můžete ho vytisknout nebo uložit jako PDF.</p></div></div>
        {!invoices.length ? <p className="app-card p-6 text-sm text-slate-500">Po první placené objednávce se zde objeví daňový doklad.</p> : <div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3.5">Číslo</th><th className="px-5 py-3.5">Vystaven</th><th className="px-5 py-3.5">Částka</th><th className="px-5 py-3.5">Stav</th></tr></thead><tbody className="divide-y divide-slate-100">{invoices.map((invoice) => <tr key={invoice.id}><td className="px-5 py-4 font-semibold"><Link href={`/app/faktury/${invoice.id}`} className="text-brand-700 hover:underline">{invoice.number}</Link></td><td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(invoice.issuedAt)}</td><td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{formatMoney(invoice.totalMinor, invoice.currency)}</td><td className="px-5 py-4"><StatusBadge tone={invoice.status === "PAID" ? "success" : invoice.status === "ISSUED" ? "warning" : "neutral"}>{invoiceLabels[invoice.status]}</StatusBadge></td></tr>)}</tbody></table></div>}
      </section>

      <section id="fakturace" className="app-card scroll-mt-24 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><UserRound className="size-5" /></span><div><h2 className="text-xl font-semibold text-slate-900">Fakturační údaje</h2><p className="mt-1 text-sm text-slate-500">{profile.companyName || profile.name || profile.email}</p><p className="mt-1 text-sm leading-6 text-slate-600">{[profile.street, profile.city, profile.postalCode, profile.country].filter(Boolean).join(", ") || "Adresa zatím není doplněna."}{profile.companyIdNumber ? ` · IČO ${profile.companyIdNumber}` : ""}{profile.vatId ? ` · DIČ ${profile.vatId}` : ""}</p></div></div><Link href="/app/profil" className="app-button app-button-secondary">Upravit údaje</Link></div>
      </section>
    </div>
  );
}
