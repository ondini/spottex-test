"use client";

import { ClipboardCheck, LoaderCircle, Minus, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";

import { formatMoney } from "@/components/app-shell/PagePrimitives";
import { trackEvent } from "@/lib/client-analytics";

type Item = { id: number; quantity: number; unitPriceMinor: number; productName: string; product: { code: string; description: string | null } };
type Cart = { id: string; totalMinor: number; currency: string; items: Item[] };
type Product = { code: string; name: string; description: string | null; priceMinor: number; currency: string };
type BillingProfile = {
  email: string; name: string | null; phone: string | null; street: string | null; city: string | null;
  postalCode: string | null; country: string; companyName: string | null; companyIdNumber: string | null; vatId: string | null;
};

export function CartClient({ initialCart, product, initialProfile }: { initialCart: Cart; product: Product | null; initialProfile: BillingProfile }) {
  const freeAccess = process.env.NEXT_PUBLIC_FREE_ACCESS_MODE === "true";
  const [cart, setCart] = useState(initialCart);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState(initialProfile);
  const [recurringConsent, setRecurringConsent] = useState(false);
  const hasProduct = product ? cart.items.some((item) => item.product.code === product.code) : false;

  async function mutate(url: string, options: RequestInit, key: string) {
    setPending(key); setError(null);
    try {
      const response = await fetch(url, options);
      const body = (await response.json().catch(() => null)) as { cart?: Cart; error?: string; redirectUrl?: string } | null;
      if (!response.ok) {
        const message = body?.error === "TRIAL_ALREADY_USED"
          ? "Bezplatné období už bylo pro tento účet využito. Kontaktujte nás pro aktivaci navazujícího tarifu."
          : body?.error === "SERVICE_OFFER_REQUIRED"
            ? "Placenou službu lze objednat až z platné nabídky vypočtené v analýze úspor."
          : body?.error === "CART_CHECKOUT_IN_PROGRESS"
            ? "Platba této objednávky už probíhá. Zkontrolujte přehled plateb."
            : body?.error || "Objednávku se nepodařilo upravit.";
        throw new Error(message);
      }
      if (body?.cart) setCart(body.cart);
      if (body?.cart) void trackEvent("CART_UPDATED", "/app/sluzba/objednavka");
      if (body?.redirectUrl) {
        await trackEvent("CHECKOUT_STARTED", "/app/sluzba/objednavka");
        window.location.assign(body.redirectUrl);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operaci se nepodařilo dokončit.");
    } finally { setPending(null); }
  }

  function billingField(name: keyof BillingProfile, label: string, options: { required?: boolean; placeholder?: string } = {}) {
    return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{label}</span><input className="app-input" value={billing[name] || ""} required={options.required} placeholder={options.placeholder} onChange={(event) => setBilling((current) => ({ ...current, [name]: event.target.value }))} /></label>;
  }

  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart.items.length) return;
    setPending("checkout");
    setError(null);
    try {
      const profileResponse = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(
          Object.entries(billing)
            .filter(([key]) => key !== "email")
            .map(([key, value]) => [key, value ?? ""]),
        )),
      });
      const profileBody = (await profileResponse.json().catch(() => null)) as { error?: string } | null;
      if (!profileResponse.ok) throw new Error(profileBody?.error || "Fakturační údaje se nepodařilo uložit.");
      const checkoutResponse = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: cart.id, ...(cart.totalMinor > 0 && recurringConsent ? { recurringConsent: true } : {}) }),
      });
      const body = (await checkoutResponse.json().catch(() => null)) as { redirectUrl?: string; error?: string } | null;
      if (!checkoutResponse.ok || !body?.redirectUrl) throw new Error(body?.error || "Platbu se nepodařilo připravit.");
      await trackEvent("CHECKOUT_STARTED", "/app/sluzba/objednavka");
      window.location.assign(body.redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Platbu se nepodařilo připravit.");
      setPending(null);
    }
  }

  return (
    <form onSubmit={checkout} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="space-y-6">
      <section className="space-y-4">
        {cart.items.length === 0 ? (
          <div className="app-card flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><ClipboardCheck className="size-7" /></span>
            <h3 className="text-lg font-semibold text-slate-900">Nemáte připravenou službu</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Vyberte roční službu chytrého řízení a pokračujte k platbě.</p>
          </div>
        ) : cart.items.map((item) => (
          <article key={item.id} className="app-card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Sparkles className="size-6" /></span>
            <div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">{item.productName}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{item.product.description}</p><p className="mt-2 text-xs text-slate-400">Množství: {item.quantity}</p></div>
            <div className="flex items-center justify-between gap-4 sm:block sm:text-right"><p className="font-semibold text-slate-900">{freeAccess ? "Zdarma" : formatMoney(item.unitPriceMinor * item.quantity, cart.currency)}</p><button onClick={() => mutate(`/api/cart?productCode=${encodeURIComponent(item.product.code)}`, { method: "DELETE" }, `remove:${item.id}`)} disabled={pending !== null} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-error-600 hover:underline disabled:opacity-50">{pending === `remove:${item.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Minus className="size-3.5" />} Odebrat</button></div>
          </article>
        ))}

        {product && !hasProduct && (
          <article className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/40 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm"><Sparkles className="size-5" /></span><div className="flex-1"><h3 className="font-semibold text-slate-900">{product.name}</h3><p className="mt-1 text-sm text-slate-500">{product.description}</p></div><div className="sm:text-right"><p className="mb-2 font-semibold text-slate-900">{freeAccess ? "Zdarma" : formatMoney(product.priceMinor, product.currency)}</p><button onClick={() => mutate("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productCode: product.code, quantity: 1 }) }, "add")} disabled={pending !== null} className="app-button min-h-9 px-3 py-2 text-sm disabled:opacity-60">{pending === "add" && <LoaderCircle className="size-4 animate-spin" />} Přidat</button></div></div>
          </article>
        )}
      </section>

      <section className="app-card p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">Fakturační údaje</h3>
        <p className="mt-1 text-sm text-slate-500">Uložíme je do profilu a použijeme na daňovém dokladu. Firemní údaje jsou volitelné.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {billingField("name", "Jméno a příjmení", { required: true })}
          <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">E-mail</span><input className="app-input bg-slate-50 text-slate-500" value={billing.email} readOnly /></label>
          <div className="md:col-span-2">{billingField("street", "Ulice a číslo", { required: cart.totalMinor > 0 })}</div>
          {billingField("city", "Město", { required: cart.totalMinor > 0 })}
          {billingField("postalCode", "PSČ", { required: cart.totalMinor > 0 })}
          {billingField("country", "Země (kód)", { required: true, placeholder: "CZ" })}
          {billingField("phone", "Telefon")}
          <div className="md:col-span-2">{billingField("companyName", "Firma")}</div>
          {billingField("companyIdNumber", "IČO")}
          {billingField("vatId", "DIČ")}
        </div>
      </section>
      </div>

      <aside className="app-card h-fit p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">Souhrn objednávky</h3>
        <dl className="mt-5 space-y-3 border-b border-slate-100 pb-5 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">Položky</dt><dd className="font-medium text-slate-700">{cart.items.reduce((sum, item) => sum + item.quantity, 0)}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Mezisoučet</dt><dd className="font-medium text-slate-700">{freeAccess ? "Zdarma" : formatMoney(cart.totalMinor, cart.currency)}</dd></div></dl>
        <div className="flex items-baseline justify-between gap-4 py-5"><span className="font-semibold text-slate-900">Celkem</span><strong className="text-2xl text-slate-900">{freeAccess ? "Zdarma" : formatMoney(cart.totalMinor, cart.currency)}</strong></div>
        {!freeAccess && cart.totalMinor > 0 && <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-5 text-slate-600"><input type="checkbox" className="mt-1 size-4 accent-brand-600" checked={recurringConsent} onChange={(event) => setRecurringConsent(event.target.checked)} /><span><strong className="block text-slate-900">Povolit roční opakovanou platbu</strong>Další cenu oznámíme nejméně 14 dní předem. Bude nejvýše 990 Kč a nikdy se bez nového souhlasu nezvýší nad nyní placenou cenu. Budoucí platby lze kdykoli zrušit v účtu.</span></label>}
        {error && <p role="alert" className="mb-4 rounded-xl bg-error-50 p-3 text-sm text-error-600">{error}</p>}
        <button type="submit" disabled={!cart.items.length || pending !== null} className="app-button w-full disabled:cursor-not-allowed disabled:opacity-50">{pending === "checkout" && <LoaderCircle className="size-5 animate-spin" />}{pending === "checkout" ? "Aktivuji…" : freeAccess ? "Aktivovat zdarma" : cart.totalMinor > 0 ? "Pokračovat k platbě" : "Aktivovat zkušební období"}</button>
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-400"><ShieldCheck className="mt-0.5 size-4 shrink-0" />{freeAccess ? " V testovacím provozu nic neplatíte a nezadáváte platební kartu." : " Platba probíhá přes zabezpečenou platební bránu."}</p>
      </aside>
    </form>
  );
}
