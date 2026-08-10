import PromoForm from "@/components/admin/PromoForm";
import UserAccessControl from "@/components/admin/UserAccessControl";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const metadata = { title: "Uživatelé" };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAdmin("/admin/uzivatele");
  const params = await searchParams;
  const query = (params.q || "").trim().slice(0, 100);
  const requestedPage = Number(params.page || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const take = 30;
  const where = query ? { OR: [{ email: { contains: query, mode: "insensitive" as const } }, { name: { contains: query, mode: "insensitive" as const } }] } : {};
  const [users, total] = await prisma.$transaction([prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, role: true, status: true, createdAt: true,
      energySites: { select: { id: true } },
      subscriptions: { where: { status: { in: ["ACTIVE", "TRIAL"] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, include: { product: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * take,
    take,
  }), prisma.user.count({ where })]);
  const pages = Math.max(1, Math.ceil(total / take));
  const pageHref = (value: number) => `/admin/uzivatele?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(value) })}`;
  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-semibold text-gray-900">Uživatelé</h1><p className="mt-1 text-sm text-gray-500">Účty, elektrárny a aktivní služby bez firemní a manažerské hierarchie.</p></header>
      <form className="app-card flex flex-col gap-3 p-4 sm:flex-row" action="/admin/uzivatele"><input className="app-input flex-1" type="search" name="q" defaultValue={query} maxLength={100} placeholder="Hledat podle jména nebo e-mailu" /><button className="app-button" type="submit">Hledat</button>{query && <Link className="app-button app-button-secondary" href="/admin/uzivatele">Zrušit filtr</Link>}</form>
      <div className="app-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Uživatel</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Elektrárny</th><th className="px-5 py-3">Služba</th><th className="px-5 py-3">Akce</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => <tr key={user.id}><td className="px-5 py-4"><div className="font-medium text-gray-900">{user.name || "Bez jména"}</div><div className="text-xs text-gray-500">{user.email}</div></td><td className="px-5 py-4"><UserAccessControl userId={user.id} initialRole={user.role} initialStatus={user.status} /></td><td className="px-5 py-4">{user.energySites.length}</td><td className="px-5 py-4">{user.subscriptions[0]?.product.name || "Neaktivní"}</td><td className="px-5 py-4"><PromoForm userId={user.id} /></td></tr>)}
          </tbody>
        </table>
      </div>
      <nav className="flex items-center justify-between text-sm text-slate-500" aria-label="Stránkování uživatelů"><span>{total} účtů · strana {Math.min(page, pages)} z {pages}</span><div className="flex gap-2">{page > 1 && <Link className="app-button app-button-secondary px-3 py-2" href={pageHref(page - 1)}>Předchozí</Link>}{page < pages && <Link className="app-button app-button-secondary px-3 py-2" href={pageHref(page + 1)}>Další</Link>}</div></nav>
    </div>
  );
}
