import { Activity, BadgeCheck, BarChart3, BookOpenText, CalendarDays, CreditCard, FileText, Globe2, LibraryBig, RadioTower, ScanText, ShieldCheck, ShoppingCart, UsersRound, Zap } from "lucide-react";
import Link from "next/link";

import { formatMoney, PageHeader } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const modules = [
  { label: "Uživatelé", description: "Účty, role a elektrárny", href: "/admin/uzivatele", icon: UsersRound },
  { label: "Předplatné", description: "Placené a PROMO služby", href: "/admin/predplatne", icon: BadgeCheck },
  { label: "Platby", description: "Transakce a jejich stavy", href: "/admin/platby", icon: CreditCard },
  { label: "Faktury", description: "Vystavené daňové doklady", href: "/admin/faktury", icon: FileText },
  { label: "Přijaté faktury", description: "Ruční zpracování cen a sazeb", href: "/admin/vstupni-faktury", icon: ScanText },
  { label: "Audit řízení", description: "Predikce, povely, telemetrie a ceny", href: "/admin/audit-rizeni", icon: ShieldCheck },
  { label: "Košíky", description: "Nákupní relace uživatelů", href: "/admin/kosiky", icon: ShoppingCart },
  { label: "Ceníky energií", description: "Zdroje, verze a schvalování cen", href: "/admin/ceniky", icon: LibraryBig },
  { label: "Kalendáře HDO", description: "Přesné časy podle EAN a distributora", href: "/admin/hdo", icon: RadioTower },
  { label: "Landing page", description: "Zakladatelé a reference", href: "/admin/landing", icon: Globe2 },
  { label: "Metriky", description: "Výkon webu a konverze", href: "/admin/metriky", icon: BarChart3 },
  { label: "Blog", description: "Články a publikace", href: "/admin/blog", icon: BookOpenText },
  { label: "Konzultace", description: "Termíny a rezervace", href: "/admin/konzultace", icon: CalendarDays },
];

export default async function AdminHomePage() {
  await requireAdmin("/admin");
  const now = new Date();
  const [users, sites, activeSubscriptions, paid, upcomingConsultations] = await Promise.all([
    prisma.user.count(),
    prisma.energySite.count(),
    prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIAL"] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } }),
    prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amountMinor: true } }),
    prisma.consultationBooking.count({ where: { status: "CONFIRMED", slot: { startUtc: { gte: now } } } }),
  ]);

  const stats = [
    { label: "Uživatelé", value: users.toLocaleString("cs-CZ"), icon: UsersRound, color: "bg-blue-50 text-blue-700" },
    { label: "Elektrárny", value: sites.toLocaleString("cs-CZ"), icon: Zap, color: "bg-amber-50 text-amber-700" },
    { label: "Aktivní služby", value: activeSubscriptions.toLocaleString("cs-CZ"), icon: Activity, color: "bg-brand-50 text-brand-700" },
    { label: "Uhrazeno celkem", value: formatMoney(paid._sum.amountMinor || 0), icon: CreditCard, color: "bg-violet-50 text-violet-700" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Přehled administrace" description="Centrální správa platformy Spottex, uživatelů, obsahu i konzultací." />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color }) => <article key={label} className="app-card flex items-center gap-4 p-5"><span className={`grid size-12 place-items-center rounded-2xl ${color}`}><Icon className="size-5" /></span><div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p></div></article>)}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Moduly</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(({ label, description, href, icon: Icon }) => <Link key={href} href={href} className="app-card group p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"><span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-brand-50 group-hover:text-brand-700"><Icon className="size-5" /></span><h3 className="mt-4 font-semibold text-slate-900">{label}</h3><p className="mt-1 text-sm leading-5 text-slate-500">{description}</p></Link>)}
          </div>
        </div>
        <aside>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Dnes ve Spottexu</h2>
          <div className="app-card overflow-hidden">
            <div className="border-b border-slate-100 bg-[#09121f] p-5 text-white"><CalendarDays className="size-5 text-brand-400" /><p className="mt-4 text-3xl font-semibold">{upcomingConsultations}</p><p className="mt-1 text-sm text-slate-400">nadcházejících potvrzených konzultací</p></div>
            <div className="p-5"><p className="text-sm leading-6 text-slate-500">Kalendář, dostupné termíny a rezervace spravujete v modulu Konzultace.</p><Link href="/admin/konzultace" className="mt-4 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-600">Otevřít konzultace →</Link></div>
          </div>
        </aside>
      </section>
    </div>
  );
}
