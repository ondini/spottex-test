import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { SubscriptionActions } from "@/components/admin/SubscriptionActions";

export const metadata = { title: "Předplatné" };

export default async function AdminSubscriptionsPage() {
  await requireAdmin("/admin/predplatne");
  const rows = await prisma.subscription.findMany({ include: { user: true, product: true, activatedByAdmin: true }, orderBy: { createdAt: "desc" }, take: 300 });
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Předplatné</h1><p className="mt-1 text-sm text-gray-500">Placené, ruční a PROMO aktivace služby řízení střídače.</p></header><div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Uživatel</th><th className="px-5 py-3">Produkt</th><th className="px-5 py-3">Zdroj</th><th className="px-5 py-3">Stav</th><th className="px-5 py-3">Platnost</th><th className="px-5 py-3">Akce</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4">{row.user.email}</td><td className="px-5 py-4">{row.product.name}</td><td className="px-5 py-4">{row.source}</td><td className="px-5 py-4">{row.status}</td><td className="px-5 py-4">{row.startsAt.toLocaleDateString("cs-CZ")} – {row.endsAt?.toLocaleDateString("cs-CZ") || "bez konce"}</td><td className="px-5 py-4"><SubscriptionActions id={row.id} active={["ACTIVE", "TRIAL"].includes(row.status)} /></td></tr>)}</tbody></table></div></div>;
}
