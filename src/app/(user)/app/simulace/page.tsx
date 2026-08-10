import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Simulace úspor" };

export default function SimulationPage() {
  redirect("/app/analyza");
}
