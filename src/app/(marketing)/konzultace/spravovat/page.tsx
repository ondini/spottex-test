import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import ManageBooking from "@/components/consultation/ManageBooking";

export const metadata: Metadata = { title: "Správa konzultace", robots: { index: false, follow: false } };

export default function ManageConsultationPage() {
  return <main className="min-h-screen bg-[#f6f8f5] px-4 py-10"><div className="mx-auto max-w-3xl"><Link href="/" className="inline-flex items-center gap-3 text-xl font-bold text-slate-950"><span className="grid size-10 place-items-center rounded-2xl bg-brand-500 text-white">S</span>Spottex</Link><h1 className="mb-8 mt-12 text-4xl font-bold tracking-tight text-slate-950">Správa konzultace</h1><Suspense fallback={<div className="app-card p-8 text-center text-slate-500">Načítám rezervaci…</div>}><ManageBooking /></Suspense></div></main>;
}

