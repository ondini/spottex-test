import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, formatMoney, StatusBadge } from "@/components/app-shell/PagePrimitives";
import PrintButton from "@/components/invoice/PrintButton";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Faktura" };

function snapshot(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser("/app/faktury");
  const invoice = await prisma.invoice.findFirst({
    where: { id: (await params).id, userId: Number(session.user.id) },
    include: { items: true },
  });
  if (!invoice) notFound();

  const seller = snapshot(invoice.sellerSnapshot);
  const customer = snapshot(invoice.customerSnapshot);
  const statusLabel = invoice.status === "PAID" ? "Zaplaceno" : invoice.status === "ISSUED" ? "Vystaveno" : invoice.status;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/sluzba#doklady" className="text-sm font-semibold text-slate-500 hover:text-slate-900">← Zpět na službu a doklady</Link>
        <PrintButton />
      </div>
      <article className="app-card overflow-hidden bg-white p-6 print:border-0 print:shadow-none sm:p-10">
        <header className="flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 sm:flex-row">
          <div>
            <p className="text-sm font-bold uppercase tracking-[.2em] text-brand-700">Spottex</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-950">Faktura {invoice.number}</h2>
            <p className="mt-2 text-sm text-slate-500">Variabilní symbol: {invoice.number.replace(/\D/g, "")}</p>
          </div>
          <StatusBadge tone={invoice.status === "PAID" ? "success" : "warning"}>{statusLabel}</StatusBadge>
        </header>

        <section className="grid gap-8 border-b border-slate-200 py-8 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Dodavatel</h3>
            <p className="mt-3 font-semibold text-slate-900">{String(seller.name || "Spottex Energy s.r.o.")}</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{String(seller.address || "")}</p>
            <p className="mt-1 text-sm text-slate-600">IČO: {String(seller.companyId || "—")} · DIČ: {String(seller.vatId || "—")}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Odběratel</h3>
            <p className="mt-3 font-semibold text-slate-900">{String(customer.name || customer.email || "")}</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{String(customer.address || "")}</p>
            <p className="mt-1 text-sm text-slate-600">{String(customer.email || "")}</p>
            {Boolean(customer.companyId) && <p className="mt-1 text-sm text-slate-600">IČO: {String(customer.companyId)} · DIČ: {String(customer.vatId || "—")}</p>}
          </div>
        </section>

        <dl className="grid gap-5 border-b border-slate-200 py-6 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-400">Datum vystavení</dt><dd className="mt-1 font-semibold text-slate-800">{formatDate(invoice.issuedAt)}</dd></div>
          <div><dt className="text-slate-400">Datum splatnosti</dt><dd className="mt-1 font-semibold text-slate-800">{invoice.dueAt ? formatDate(invoice.dueAt) : "—"}</dd></div>
          <div><dt className="text-slate-400">Datum úhrady</dt><dd className="mt-1 font-semibold text-slate-800">{invoice.paidAt ? formatDate(invoice.paidAt) : "—"}</dd></div>
        </dl>

        <div className="overflow-x-auto py-7">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr><th className="py-3 font-semibold">Položka</th><th className="px-3 py-3 text-right font-semibold">Množství</th><th className="px-3 py-3 text-right font-semibold">Cena</th><th className="py-3 text-right font-semibold">Celkem</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.items.map((item) => (
                <tr key={item.id}><td className="py-4 font-medium text-slate-800">{item.description}</td><td className="px-3 py-4 text-right text-slate-600">{item.quantity}</td><td className="px-3 py-4 text-right text-slate-600">{formatMoney(item.unitPriceMinor, invoice.currency)}</td><td className="py-4 text-right font-semibold text-slate-900">{formatMoney(item.totalMinor, invoice.currency)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto max-w-sm border-t border-slate-200 pt-5">
          <div className="flex justify-between gap-6 text-sm text-slate-600"><span>Mezisoučet</span><span>{formatMoney(invoice.subtotalMinor, invoice.currency)}</span></div>
          <div className="mt-2 flex justify-between gap-6 text-sm text-slate-600"><span>DPH</span><span>{formatMoney(invoice.vatMinor, invoice.currency)}</span></div>
          <div className="mt-4 flex justify-between gap-6 text-xl font-bold text-slate-950"><span>Celkem</span><span>{formatMoney(invoice.totalMinor, invoice.currency)}</span></div>
        </div>
      </article>
    </div>
  );
}
