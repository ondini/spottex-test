import { requireAdmin } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/commerce/cart";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Faktury" };

export default async function AdminInvoicesPage() {
  await requireAdmin("/admin/faktury");
  const rows = await prisma.invoice.findMany({ include: { user: true }, orderBy: { issuedAt: "desc" }, take: 300 });
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Faktury</h1><p className="mt-1 text-sm text-gray-500">Neměnné odběratelské a dodavatelské snapshoty navázané na platby.</p></header><div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Číslo</th><th className="px-5 py-3">Odběratel</th><th className="px-5 py-3">Vystaveno</th><th className="px-5 py-3">Částka</th><th className="px-5 py-3">Stav</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4 font-medium">{row.number}</td><td className="px-5 py-4">{row.user.email}</td><td className="px-5 py-4">{row.issuedAt.toLocaleDateString("cs-CZ")}</td><td className="px-5 py-4">{formatMoney(row.totalMinor, row.currency)}</td><td className="px-5 py-4">{row.status}</td></tr>)}</tbody></table></div></div>;
}
