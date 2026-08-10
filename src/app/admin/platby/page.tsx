import { requireAdmin } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/commerce/cart";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Platby" };

export default async function AdminPaymentsPage() {
  await requireAdmin("/admin/platby");
  const rows = await prisma.payment.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 300 });
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Platby</h1><p className="mt-1 text-sm text-gray-500">Jednotný stav plateb bez ohledu na poskytovatele. Stav CREATE_REVIEW_REQUIRED vyžaduje dohledání objednávky podle interního ID v GoPay.</p></header><div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Vytvořeno</th><th className="px-5 py-3">ID / uživatel</th><th className="px-5 py-3">Poskytovatel</th><th className="px-5 py-3">Částka</th><th className="px-5 py-3">Stav</th><th className="px-5 py-3">Stav brány</th></tr></thead><tbody className="divide-y">{rows.map((row) => {
    const payload = row.providerPayload && typeof row.providerPayload === "object" && !Array.isArray(row.providerPayload)
      ? row.providerPayload as Record<string, unknown>
      : {};
    const providerState = typeof payload.state === "string" ? payload.state : "—";
    return <tr key={row.id} className={providerState === "CREATE_REVIEW_REQUIRED" ? "bg-warning-50" : undefined}><td className="px-5 py-4">{row.createdAt.toLocaleString("cs-CZ")}</td><td className="px-5 py-4"><span className="block font-mono text-xs text-slate-500">{row.id}</span><span>{row.user.email}</span></td><td className="px-5 py-4">{row.provider}<span className="block font-mono text-xs text-slate-400">{row.providerPaymentId || "bez ID brány"}</span></td><td className="px-5 py-4">{formatMoney(row.amountMinor, row.currency)}</td><td className="px-5 py-4">{row.status}</td><td className="px-5 py-4 font-medium">{providerState}</td></tr>;
  })}</tbody></table></div></div>;
}
