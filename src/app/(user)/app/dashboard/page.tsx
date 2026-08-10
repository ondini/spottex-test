import type { Metadata } from "next";

import { EnergyDashboard } from "@/components/energy/EnergyDashboard";

export const metadata: Metadata = { title: "Energetický přehled" };

export default function DashboardPage() {
  return <EnergyDashboard />;
}
