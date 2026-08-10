import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="app-card flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon className="size-7" />
      </span>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function StatusBadge({ tone = "neutral", children }: { tone?: "success" | "warning" | "danger" | "neutral" | "brand"; children: React.ReactNode }) {
  const colors = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    warning: "bg-amber-50 text-amber-700 ring-amber-600/10",
    danger: "bg-error-50 text-error-600 ring-error-600/10",
    neutral: "bg-slate-100 text-slate-600 ring-slate-500/10",
    brand: "bg-brand-50 text-brand-800 ring-brand-700/10",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${colors[tone]}`}>{children}</span>;
}

export function formatMoney(amountMinor: number, currency = "CZK") {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(amountMinor / 100);
}

export function formatDate(date: Date, includeTime = false) {
  return new Intl.DateTimeFormat("cs-CZ", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

