import { EnergyInvoiceReviewForm } from "@/components/admin/EnergyInvoiceReviewForm";
import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { getEnergyInvoiceReviewQueue } from "@/lib/energy/invoice-review";

export const metadata = { title: "Přijaté faktury energií" };

export default async function EnergyInvoicesPage() {
  await requireAdmin("/admin/vstupni-faktury");
  const requests = await getEnergyInvoiceReviewQueue();
  return <div className="space-y-6">
    <PageHeader title="Přijaté faktury energií" description="Ruční zpracování zašifrovaných uploadů a faktur zaslaných na contact@spottex.cz. Každý přístup i verze vytěžených údajů se auditují; nejde o daňové doklady Spottexu." />
    {!requests.length && <p className="app-card p-6 text-sm text-slate-500">Zatím nepřišel žádný požadavek na zpracování faktury.</p>}
    {requests.map((row) => <article key={row.id} className="app-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-900">{row.referenceCode} · {row.site.name}</h2><p className="mt-1 text-sm text-slate-500">{row.user.name || row.user.email} · {row.user.email} · vytvořeno {new Date(row.createdAt).toLocaleString("cs-CZ")}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{row.status}</span></div>
      <EnergyInvoiceReviewForm row={row} />
    </article>)}
  </div>;
}
