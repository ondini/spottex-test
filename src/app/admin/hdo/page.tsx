import { HdoCalendarImportForm } from "@/components/admin/HdoCalendarImportForm";
import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export default async function HdoAdminPage() {
  await requireAdmin("/admin/hdo");
  const [sites, calendars] = await Promise.all([
    prisma.energySite.findMany({ where: { ean: { not: null }, technicalProfile: { distributorCode: { not: null } } }, include: { technicalProfile: true }, orderBy: { id: "desc" }, take: 500 }),
    prisma.energyHdoCalendar.findMany({ include: { energySite: true, _count: { select: { intervals: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return <div className="space-y-6"><PageHeader title="Kalendáře HDO" description="Přesné časy se ukládají ke konkrétnímu EAN, distributorovi a období. Přijímáme pouze doložený oficiální zdroj; chybějící kalendář v analýze zůstává přiznaným modelem." /><HdoCalendarImportForm sites={sites.map((site) => ({ id: site.id, label: `${site.name} · ${site.ean} · ${site.technicalProfile!.distributorCode}` }))} /><section className="app-card overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Elektrárna</th><th className="px-5 py-3">Identita</th><th className="px-5 py-3">Platnost</th><th className="px-5 py-3">Zdroj</th></tr></thead><tbody className="divide-y divide-slate-100">{calendars.map((calendar) => <tr key={calendar.id}><td className="px-5 py-4 font-medium">{calendar.energySite.name}</td><td className="px-5 py-4 text-slate-600">{calendar.eanSnapshot || "—"} · {calendar.distributorCode || "—"} · {calendar._count.intervals} intervalů</td><td className="px-5 py-4 text-slate-600">{calendar.validFrom.toLocaleDateString("cs-CZ")}–{calendar.validTo.toLocaleDateString("cs-CZ")}</td><td className="px-5 py-4">{calendar.sourceReference ? <a className="text-brand-700 hover:underline" href={calendar.sourceReference} target="_blank" rel="noreferrer">Oficiální zdroj</a> : calendar.source}</td></tr>)}</tbody></table></section></div>;
}
