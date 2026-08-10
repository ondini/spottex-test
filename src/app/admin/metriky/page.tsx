import { Activity, BarChart3, CheckCircle2, Eye, MousePointerClick, Settings2, UsersRound } from "lucide-react";

import { PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import SiteSettingsForm, { type SiteSettingsRecord } from "@/components/admin/SiteSettingsForm";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Metriky" };
export const dynamic = "force-dynamic";

const conversionTypes = ["SIGNUP_COMPLETED", "CONSULTATION_BOOKED", "TRIAL_ACTIVATED", "PAYMENT_COMPLETED"] as const;

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function comparison(current: number, previous: number) {
  if (previous === 0) return current > 0 ? "Nová data" : "Beze změny";
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent > 0 ? "+" : ""}${percent} % oproti předchozím 30 dnům`;
}

export default async function AdminMetricsPage() {
  await requireAdmin("/admin/metriky");
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const previousFrom = new Date(now.getTime() - 60 * 86_400_000);
  const currentWhere = { occurredAt: { gte: from, lt: now } };
  const previousWhere = { occurredAt: { gte: previousFrom, lt: from } };

  const [
    storedSettings,
    events,
    previousEvents,
    pageViews,
    previousPageViews,
    sessionGroups,
    previousSessionGroups,
    conversions,
    previousConversions,
    eventGroups,
    pathGroups,
    recentEvents,
    analyticsAccepted,
    marketingAccepted,
    analyticsDeclined,
  ] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: 1 } }),
    prisma.analyticsEvent.count({ where: currentWhere }),
    prisma.analyticsEvent.count({ where: previousWhere }),
    prisma.analyticsEvent.count({ where: { ...currentWhere, type: "PAGE_VIEW" } }),
    prisma.analyticsEvent.count({ where: { ...previousWhere, type: "PAGE_VIEW" } }),
    prisma.analyticsEvent.groupBy({ by: ["sessionId"], where: currentWhere }),
    prisma.analyticsEvent.groupBy({ by: ["sessionId"], where: previousWhere }),
    prisma.analyticsEvent.count({ where: { ...currentWhere, type: { in: [...conversionTypes] } } }),
    prisma.analyticsEvent.count({ where: { ...previousWhere, type: { in: [...conversionTypes] } } }),
    prisma.analyticsEvent.groupBy({
      by: ["type"],
      where: currentWhere,
      _count: { _all: true },
      orderBy: { _count: { type: "desc" } },
      take: 10,
    }),
    prisma.analyticsEvent.groupBy({
      by: ["path"],
      where: { ...currentWhere, type: "PAGE_VIEW", path: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: 10,
    }),
    prisma.analyticsEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: 15,
      include: { user: { select: { email: true } } },
    }),
    prisma.consentRecord.count({ where: { category: "ANALYTICS", granted: true, createdAt: { gte: from } } }),
    prisma.consentRecord.count({ where: { category: "MARKETING", granted: true, createdAt: { gte: from } } }),
    prisma.consentRecord.count({ where: { category: "ANALYTICS", granted: false, createdAt: { gte: from } } }),
  ]);

  const initialSettings: SiteSettingsRecord = storedSettings
    ? {
        id: storedSettings.id,
        metaPixelId: storedSettings.metaPixelId,
        metaPixelEnabled: storedSettings.metaPixelEnabled,
        analyticsEnabled: storedSettings.analyticsEnabled,
        consultationLead: storedSettings.consultationLead,
        contactEmail: storedSettings.contactEmail,
        sellerCompanyName: storedSettings.sellerCompanyName,
        sellerCompanyId: storedSettings.sellerCompanyId,
        sellerVatId: storedSettings.sellerVatId,
        sellerAddress: storedSettings.sellerAddress,
      }
    : {
        id: 1,
        metaPixelId: null,
        metaPixelEnabled: false,
        analyticsEnabled: true,
        consultationLead: null,
        contactEmail: null,
        sellerCompanyName: "Spottex Energy s.r.o.",
        sellerCompanyId: null,
        sellerVatId: null,
        sellerAddress: null,
      };

  const cards = [
    { label: "Zobrazení stránek", value: pageViews, detail: comparison(pageViews, previousPageViews), icon: Eye, color: "bg-blue-50 text-blue-700" },
    { label: "Unikátní relace", value: sessionGroups.length, detail: comparison(sessionGroups.length, previousSessionGroups.length), icon: UsersRound, color: "bg-violet-50 text-violet-700" },
    { label: "Všechny události", value: events, detail: comparison(events, previousEvents), icon: Activity, color: "bg-amber-50 text-amber-700" },
    { label: "Konverzní události", value: conversions, detail: comparison(conversions, previousConversions), icon: MousePointerClick, color: "bg-brand-50 text-brand-700" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Metriky a nastavení webu" description="Interní analytika Spottexu za posledních 30 dní, souhlasy návštěvníků a konfigurace Meta Pixelu." />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon, color }) => (
          <article key={label} className="app-card p-5">
            <div className="flex items-start justify-between gap-3">
              <span className={`grid size-11 place-items-center rounded-2xl ${color}`}><Icon className="size-5" /></span>
              <span className="text-xs text-slate-400">30 dní</span>
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">{value.toLocaleString("cs-CZ")}</p>
            <p className="mt-1 text-sm font-medium text-slate-600">{label}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)]">
        <div className="app-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="font-semibold text-slate-900">Nejčastější události</h2><p className="mt-0.5 text-xs text-slate-500">Události zachycené interní analytikou</p></div>
            <BarChart3 className="size-5 text-slate-300" />
          </div>
          {eventGroups.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-400">Zatím nebyly zaznamenány žádné události.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {eventGroups.map((event) => {
                const ratio = events > 0 ? Math.max(3, Math.round((event._count._all / events) * 100)) : 0;
                return (
                  <div key={event.type} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-4 text-sm"><span className="font-mono text-xs font-semibold text-slate-700">{event.type}</span><span className="font-semibold text-slate-900">{event._count._all.toLocaleString("cs-CZ")}</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${ratio}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="app-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Souhlasy za 30 dní</h2></div>
            <div className="grid grid-cols-3 divide-x divide-slate-100 p-5 text-center">
              <div><p className="text-2xl font-semibold text-slate-900">{analyticsAccepted}</p><p className="mt-1 text-xs text-slate-500">Analytika</p></div>
              <div><p className="text-2xl font-semibold text-slate-900">{marketingAccepted}</p><p className="mt-1 text-xs text-slate-500">Marketing</p></div>
              <div><p className="text-2xl font-semibold text-slate-900">{analyticsDeclined}</p><p className="mt-1 text-xs text-slate-500">Odmítnuto</p></div>
            </div>
          </div>
          <div className="app-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Stav měření</h2><Settings2 className="size-4 text-slate-300" /></div>
            <div className="space-y-3 p-5 text-sm">
              <div className="flex items-center justify-between gap-4"><span className="text-slate-600">Interní analytika</span><StatusBadge tone={initialSettings.analyticsEnabled ? "success" : "neutral"}>{initialSettings.analyticsEnabled ? "Zapnuto" : "Vypnuto"}</StatusBadge></div>
              <div className="flex items-center justify-between gap-4"><span className="text-slate-600">Meta Pixel</span><StatusBadge tone={initialSettings.metaPixelEnabled && initialSettings.metaPixelId ? "success" : "neutral"}>{initialSettings.metaPixelEnabled && initialSettings.metaPixelId ? "Připraven" : "Vypnuto"}</StatusBadge></div>
              {initialSettings.metaPixelId && <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">ID: {initialSettings.metaPixelId}</div>}
            </div>
          </div>
          <div className="app-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Nejnavštěvovanější stránky</h2></div>
            {pathGroups.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">Zatím bez dat.</p> : <div className="divide-y divide-slate-100">{pathGroups.map((path) => <div key={path.path} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span className="min-w-0 truncate font-mono text-xs text-slate-600">{path.path}</span><span className="font-semibold text-slate-900">{path._count._all}</span></div>)}</div>}
          </div>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Poslední události</h2><p className="mt-0.5 text-xs text-slate-500">Kontrolní výpis nejnovějších událostí napříč webem a aplikací</p></div><CheckCircle2 className="size-5 text-brand-500" /></div>
        {recentEvents.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">Žádné události.</p> : <div className="overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Čas</th><th className="px-5 py-3">Událost</th><th className="px-5 py-3">Cesta</th><th className="px-5 py-3">Relace / uživatel</th></tr></thead><tbody className="divide-y divide-slate-100">{recentEvents.map((event) => <tr key={String(event.id)}><td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatDate(event.occurredAt)}</td><td className="px-5 py-3 font-mono text-xs font-semibold text-slate-700">{event.type}</td><td className="max-w-xs truncate px-5 py-3 font-mono text-xs text-slate-500">{event.path || "—"}</td><td className="px-5 py-3 text-xs text-slate-500">{event.user?.email || `${event.sessionId.slice(0, 8)}…`}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="space-y-5 pt-2">
        <div><h2 className="text-xl font-semibold text-slate-900">Nastavení webu</h2><p className="mt-1 text-sm text-slate-500">Změny se ukládají do centrální konfigurace Spottexu.</p></div>
        <SiteSettingsForm initialSettings={initialSettings} />
      </section>
    </div>
  );
}
