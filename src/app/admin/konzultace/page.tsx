import type { Metadata } from "next";

import AdminConsultations from "@/components/consultation/AdminConsultations";

export const metadata: Metadata = { title: "Konzultace" };

export default function AdminConsultationsPage() {
  return <div><div className="mb-6"><h2 className="text-2xl font-bold tracking-tight text-slate-950">Konzultace</h2><p className="mt-1 text-sm text-slate-500">Správa termínů, rezervací a propojení s Google Kalendářem.</p></div><AdminConsultations /></div>;
}

