import { HistoryImportRetryButton } from "@/components/admin/HistoryImportRetryButton";
import { PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Historické importy" };

export default async function HistoryImportsAdminPage() {
  await requireAdmin("/admin/historicke-importy");
  const imports = await prisma.energyHistoryImport.findMany({
    include: { energySite: { include: { user: { select: { email: true } } } }, chunks: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <div className="space-y-6"><PageHeader title="Historické importy" description="Průběh postupného importu. Opakování zasáhne jen chybné části a nemění živé řízení." />{!imports.length ? <p className="app-card p-6 text-sm text-slate-500">Zatím nebyl spuštěn žádný historický import.</p> : <div className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Elektrárna</th><th className="px-5 py-3">Období</th><th className="px-5 py-3">Průběh</th><th className="px-5 py-3">Stav</th><th className="px-5 py-3">Poslední chyba</th><th className="px-5 py-3 text-right">Akce</th></tr></thead><tbody className="divide-y">{imports.map((item) => <tr key={item.id}><td className="px-5 py-4"><strong className="block text-slate-900">{item.energySite.name}</strong><span className="text-xs text-slate-500">{item.energySite.user.email}</span></td><td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.requestedFrom.toLocaleDateString("cs-CZ")}–{item.requestedTo.toLocaleDateString("cs-CZ")}</td><td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.succeededChunks}/{item.totalChunks} · {item.importedPoints} bodů</td><td className="px-5 py-4"><StatusBadge tone={item.status === "COMPLETED" ? "success" : ["FAILED", "PARTIAL"].includes(item.status) ? "danger" : "warning"}>{item.status}</StatusBadge></td><td className="max-w-xs px-5 py-4 text-xs text-slate-500">{item.lastError || "—"}</td><td className="px-5 py-4">{item.chunks.some((chunk) => chunk.status === "FAILED") ? <HistoryImportRetryButton importId={item.id} /> : null}</td></tr>)}</tbody></table></div>}</div>;
}
