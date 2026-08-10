import Link from "next/link";
import { ArrowLeft, BatteryCharging, ChartNoAxesCombined, ShieldCheck, Sparkles } from "lucide-react";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(30rem,0.8fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#09121f] px-12 py-10 text-white lg:flex lg:flex-col xl:px-20">
        <div className="absolute -left-40 top-10 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-emerald-300/10 blur-3xl" />

        <Link href="/" className="relative z-10 inline-flex w-fit items-center gap-3" aria-label="Spottex – úvodní stránka">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-500 text-lg font-black text-white shadow-lg shadow-brand-500/20">
            S
          </span>
          <span className="text-2xl font-bold tracking-tight">Spottex</span>
        </Link>

        <div className="relative z-10 my-auto max-w-xl py-16">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 backdrop-blur">
            <Sparkles className="size-4 text-brand-400" />
            Energie pracuje ve váš prospěch
          </span>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            Spočítejte si úsporu na vlastních datech.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Aktuálně se propojujeme přímo se SolaX Cloudem. Bez dalšího hardwaru stáhneme
            historii, připravíme simulaci a řízení zapnete až po kontrole výsledku.
          </p>

          <div className="mt-10 grid max-w-lg gap-4 sm:grid-cols-3">
            {[
              { icon: ChartNoAxesCombined, label: "Výpočet zdarma" },
              { icon: BatteryCharging, label: "Bez hardwaru" },
              { icon: ShieldCheck, label: "Řízení na pokyn" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <Icon className="mb-3 size-5 text-brand-400" />
                <span className="text-sm font-medium text-slate-200">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-sm text-slate-500">© {new Date().getFullYear()} Spottex Energy s.r.o.</p>
      </section>

      <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-14 xl:px-20">
        <div className="flex items-center justify-between lg:justify-end">
          <Link href="/" className="inline-flex items-center gap-3 lg:hidden" aria-label="Spottex – úvodní stránka">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-500 font-black text-white">S</span>
            <span className="text-xl font-bold tracking-tight text-slate-900">Spottex</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900">
            <ArrowLeft className="size-4" />
            Zpět na web
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 items-center py-10">{children}</div>
      </section>
    </main>
  );
}
