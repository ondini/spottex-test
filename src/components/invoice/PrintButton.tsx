"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return <button type="button" className="app-button print:hidden" onClick={() => window.print()}><Printer className="size-4" />Vytisknout / uložit PDF</button>;
}

