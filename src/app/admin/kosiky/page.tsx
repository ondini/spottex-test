import { requireAdmin } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/commerce/cart";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Košíky" };

export default async function AdminCartsPage() {
  await requireAdmin("/admin/kosiky");
  const rows = await prisma.cart.findMany({ include: { user: true, items: true }, orderBy: { updatedAt: "desc" }, take: 300 });
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Košíky</h1><p className="mt-1 text-sm text-gray-500">Otevřené, zaplacené i opuštěné nákupní relace.</p></header><div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Uživatel</th><th className="px-5 py-3">Položky</th><th className="px-5 py-3">Částka</th><th className="px-5 py-3">Stav</th><th className="px-5 py-3">Aktualizace</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4">{row.user.email}</td><td className="px-5 py-4">{row.items.length}</td><td className="px-5 py-4">{formatMoney(row.totalMinor, row.currency)}</td><td className="px-5 py-4">{row.status}</td><td className="px-5 py-4">{row.updatedAt.toLocaleString("cs-CZ")}</td></tr>)}</tbody></table></div></div>;
}
