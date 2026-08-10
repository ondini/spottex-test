"use client";

import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BarChart3,
  BatteryCharging,
  BookOpenText,
  CalendarDays,
  Calculator,
  ChevronDown,
  CircleUserRound,
  ExternalLink,
  FileText,
  Gauge,
  RadioTower,
  History,
  Globe2,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Menu,
  SlidersHorizontal,
  Settings2,
  ShieldCheck,
  ScanText,
  ShoppingCart,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

type ShellUser = {
  name?: string | null;
  email: string;
  role: "USER" | "ADMIN";
};

type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type ShellSite = {
  id: number;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ONBOARDING" | "ERROR";
  optimizationOn: boolean;
  requiredInfo: boolean;
};

const userNavigation: NavigationItem[] = [
  { label: "Přehled", href: "/app/dashboard", icon: LayoutDashboard },
  { label: "Moje elektrárna", href: "/app/elektrarna", icon: BatteryCharging },
  { label: "Analýza úspor", href: "/app/analyza", icon: Calculator },
  { label: "Pokročilá analýza", href: "/app/pokrocila-analyza", icon: SlidersHorizontal },
  { label: "Řízení", href: "/app/rizeni", icon: Zap },
  { label: "Služba a vyúčtování", href: "/app/sluzba", icon: BadgeCheck },
  { label: "Profil", href: "/app/profil", icon: UserRound },
];

const adminNavigation: NavigationItem[] = [
  { label: "Přehled", href: "/admin", icon: Gauge },
  { label: "Uživatelé", href: "/admin/uzivatele", icon: UsersRound },
  { label: "Předplatné", href: "/admin/predplatne", icon: BadgeCheck },
  { label: "Platby", href: "/admin/platby", icon: WalletCards },
  { label: "Faktury", href: "/admin/faktury", icon: FileText },
  { label: "Přijaté faktury", href: "/admin/vstupni-faktury", icon: ScanText },
  { label: "Historické importy", href: "/admin/historicke-importy", icon: History },
  { label: "Audit řízení", href: "/admin/audit-rizeni", icon: ShieldCheck },
  { label: "Košíky", href: "/admin/kosiky", icon: ShoppingCart },
  { label: "Ceníky energií", href: "/admin/ceniky", icon: LibraryBig },
  { label: "Kalendáře HDO", href: "/admin/hdo", icon: RadioTower },
  { label: "Landing page", href: "/admin/landing", icon: Globe2 },
  { label: "Metriky", href: "/admin/metriky", icon: BarChart3 },
  { label: "Blog", href: "/admin/blog", icon: BookOpenText },
  { label: "Konzultace", href: "/admin/konzultace", icon: CalendarDays },
];

function initials(user: ShellUser) {
  const source = user.name?.trim() || user.email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  user,
  mode,
  sites = [],
}: {
  children: React.ReactNode;
  user: ShellUser;
  mode: "user" | "admin";
  sites?: ShellSite[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigation = mode === "admin" ? adminNavigation : userNavigation;
  const requestedSiteId = Number(searchParams.get("siteId"));
  const selectedSite = sites.find((site) => site.id === requestedSiteId) ?? sites[0] ?? null;

  const pageTitle = useMemo(
    () => navigation.find((item) => isActive(pathname, item.href))?.label || (mode === "admin" ? "Administrace" : "Můj Spottex"),
    [mode, navigation, pathname],
  );

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  function switchSite(siteId: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("siteId", String(siteId));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {mobileOpen && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Zavřít navigaci"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-slate-200 bg-white transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[73px] shrink-0 items-center justify-between border-b border-slate-100 px-6">
          <Link href={mode === "admin" ? "/admin" : "/app/dashboard"} className="inline-flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-brand-500 text-base font-black text-white shadow-sm shadow-brand-500/30">S</span>
            <span>
              <span className="block text-xl font-bold leading-5 tracking-tight text-slate-900">Spottex</span>
              {mode === "admin" && <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700">Administrace</span>}
            </span>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Zavřít menu">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {mode === "admin" ? "Správa Spottex" : "Můj účet"}
          </p>
          <nav className="space-y-1" aria-label={mode === "admin" ? "Administrace" : "Uživatelská zóna"}>
            {navigation.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={
                    mode === "user" && selectedSite
                      ? `${item.href}?siteId=${selectedSite.id}`
                      : item.href
                  }
                  aria-current={active ? "page" : undefined}
                  className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <Icon className={`size-5 shrink-0 ${active ? "text-brand-600" : "text-slate-400 transition group-hover:text-slate-600"}`} />
                  {item.label}
                  {active && <span className="ml-auto size-1.5 rounded-full bg-brand-500" />}
                </Link>
              );
            })}
          </nav>

          <div className="my-6 border-t border-slate-100" />
          <Link
            href={mode === "admin" ? "/app/dashboard" : "/"}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
          >
            {mode === "admin" ? <LayoutDashboard className="size-5 text-slate-400" /> : <Globe2 className="size-5 text-slate-400" />}
            {mode === "admin" ? "Uživatelský přehled" : "Veřejný web"}
            <ExternalLink className="ml-auto size-3.5 text-slate-300" />
          </Link>
          {mode === "user" && user.role === "ADMIN" && (
            <Link href="/admin" className="mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">
              <ShieldCheck className="size-5 text-slate-400" />
              Administrace
            </Link>
          )}
        </div>

        {mode === "user" && (
          <div className="mx-4 mb-4 rounded-2xl bg-[#09121f] p-4 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-brand-400" /> Chytré řízení
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">Aktivaci a stav služby najdete ve svém předplatném.</p>
            <Link href="/app/sluzba" className="mt-3 inline-flex text-xs font-semibold text-brand-400 hover:text-brand-300">
              Zobrazit stav →
            </Link>
          </div>
        )}
      </aside>

      <div className="min-h-screen lg:pl-[280px]">
        <header className="sticky top-0 z-30 flex h-[73px] items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden"
            aria-label="Otevřít navigaci"
          >
            <Menu className="size-5" />
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{mode === "admin" ? "Administrace" : "Spottex účet"}</p>
            <h1 className="text-base font-semibold text-slate-900">{pageTitle}</h1>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {mode === "user" && (
              sites.length > 0 && (
                <label className="relative hidden sm:block">
                  <span className="sr-only">Aktivní elektrárna</span>
                  <select
                    className="h-10 max-w-52 appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm font-semibold text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand-500"
                    value={selectedSite?.id ?? ""}
                    onChange={(event) => switchSite(Number(event.target.value))}
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                        {site.optimizationOn ? " · řízení" : ""}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`pointer-events-none absolute left-3 top-1/2 size-2 -translate-y-1/2 rounded-full ${
                      selectedSite?.status === "ONLINE" ? "bg-brand-500" : "bg-slate-300"
                    }`}
                  />
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                </label>
              )
            )}
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-1.5 pr-2 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                <span className="grid size-9 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">{initials(user)}</span>
                <span className="hidden max-w-40 text-left md:block">
                  <span className="block truncate text-sm font-semibold text-slate-800">{user.name || "Uživatel Spottex"}</span>
                  <span className="block truncate text-xs text-slate-400">{user.email}</span>
                </span>
                <ChevronDown className="hidden size-4 text-slate-400 transition group-open:rotate-180 md:block" />
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.6rem)] w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
                <div className="border-b border-slate-100 px-3 py-2 md:hidden">
                  <p className="truncate text-sm font-semibold text-slate-800">{user.name || "Uživatel Spottex"}</p>
                  <p className="truncate text-xs text-slate-400">{user.email}</p>
                </div>
                <Link href="/app/profil" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                  <CircleUserRound className="size-4.5 text-slate-400" /> Upravit profil
                </Link>
                {user.role === "ADMIN" && mode === "user" && (
                  <Link href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                    <Settings2 className="size-4.5 text-slate-400" /> Administrace
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/prihlaseni" })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-error-600 hover:bg-error-50"
                >
                  <LogOut className="size-4.5" /> Odhlásit se
                </button>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
