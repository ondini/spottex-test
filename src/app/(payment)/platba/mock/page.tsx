import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { formatMoney } from "@/components/app-shell/PagePrimitives";
import MockPaymentClient from "@/components/cart/MockPaymentClient";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Testovací platba", robots: { index: false, follow: false } };

export default async function MockPaymentPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const query = await searchParams;
  const session = await requireUser(`/platba/mock?payment=${encodeURIComponent(query.payment || "")}`);
  if (!query.payment || process.env.NODE_ENV === "production") notFound();
  const payment = await prisma.payment.findFirst({
    where: { id: query.payment, userId: Number(session.user.id), provider: "MOCK" },
    include: { cart: { include: { items: true } } },
  });
  if (!payment) notFound();
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-lg app-card p-7 sm:p-9"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-warning-600">Pouze vývojové prostředí</p><h1 className="mt-2 text-2xl font-bold text-slate-950">Simulace platební brány</h1></div><span className="rounded-xl bg-warning-50 px-3 py-2 text-sm font-bold text-warning-600">MOCK</span></div><div className="my-6 border-y border-slate-100 py-5"><ul className="space-y-2 text-sm text-slate-600">{payment.cart?.items.map((item) => <li key={item.id} className="flex justify-between gap-4"><span>{item.productName} × {item.quantity}</span><strong>{formatMoney(item.unitPriceMinor * item.quantity, payment.currency)}</strong></li>)}</ul><div className="mt-5 flex items-baseline justify-between gap-4 text-slate-950"><span className="font-semibold">Celkem</span><strong className="text-2xl">{formatMoney(payment.amountMinor, payment.currency)}</strong></div></div>{payment.status === "PAID" ? <Link className="app-button w-full" href="/app/sluzba">Platba už byla dokončena</Link> : <MockPaymentClient paymentId={payment.id} />}<Link href="/app/sluzba/objednavka" className="mt-4 block text-center text-sm text-slate-500 hover:underline">Zpět k objednávce</Link></div></main>;
}
