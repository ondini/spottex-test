export type SupplierFulfillmentMode = "COMPARISON_ONLY" | "SPOTTEX_SUPPLIER";

export function supplierFulfillment(raw = process.env.ENERGY_SUPPLIER_MODE) {
  const mode: SupplierFulfillmentMode =
    raw === "SPOTTEX_SUPPLIER" ? "SPOTTEX_SUPPLIER" : "COMPARISON_ONLY";
  return {
    mode,
    directContractingAvailable: mode === "SPOTTEX_SUPPLIER",
    message:
      mode === "SPOTTEX_SUPPLIER"
        ? "Vybraný produkt lze poptat přímo u SpotTEXu. Simulace i její auditní stopa zůstávají stejné."
        : "Přímé sjednání dodávky u SpotTEXu připravujeme od roku 2027. Výsledek nyní slouží k informovanému vlastnímu výběru; na konkurenci vás nepřesměrováváme.",
  };
}
