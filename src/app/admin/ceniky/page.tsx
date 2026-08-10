import Link from "next/link";

import { CatalogReviewActions } from "@/components/admin/CatalogReviewActions";
import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import { getCatalogReviewQueue } from "@/lib/pricing/catalog-admin";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Katalog cen, dotací a financování" };

type Report = Awaited<
  ReturnType<typeof getCatalogReviewQueue>
>["products"][number]["report"];

function ReportView({ report }: { report: Report }) {
  if (!report.issues.length)
    return (
      <p className="text-xs font-medium text-emerald-700">
        Všechny automatické kontroly prošly.
      </p>
    );
  return (
    <ul className="space-y-1 text-xs">
      {report.issues.map((issue, index) => (
        <li
          key={`${issue.field}-${index}`}
          className={
            issue.severity === "ERROR" ? "text-red-700" : "text-amber-800"
          }
        >
          <strong>{issue.field}:</strong> {issue.message}
        </li>
      ))}
    </ul>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {value}
    </span>
  );
}

export default async function CatalogAdminPage() {
  await requireAdmin("/admin/ceniky");
  const now = new Date();
  const [queue, publishedProducts, publishedDistributions] = await Promise.all([
    getCatalogReviewQueue(),
    prisma.energyProductVersion.findMany({
      where: {
        status: "PUBLISHED",
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        product: { active: true },
      },
      include: {
        product: { include: { supplier: true } },
        sourceDocument: true,
      },
      orderBy: [
        { product: { supplier: { name: "asc" } } },
        { product: { name: "asc" } },
      ],
    }),
    prisma.distributionTariffVersion.findMany({
      where: {
        status: "PUBLISHED",
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        distributionTariff: { active: true },
      },
      include: {
        distributionTariff: { include: { distributor: true } },
        sourceDocument: true,
      },
      orderBy: { distributionTariff: { code: "asc" } },
    }),
  ]);
  const sourceBackedProducts = publishedProducts.filter(
    (version) => version.sourceDocument,
  ).length;
  const sourceBackedDistributions = publishedDistributions.filter(
    (version) => version.sourceDocument,
  ).length;
  const price = (value: { toString(): string } | number | null) =>
    value == null
      ? "—"
      : `${Number(value).toLocaleString("cs-CZ", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 3,
        })} Kč/kWh`;
  return (
    <div className="space-y-8">
      <PageHeader
        title="Katalog cen, dotací a financování"
        description="Lidská schvalovací brána mezi automatickým importem a produkčními výpočty. Agent sem ukládá pouze návrhy."
      />
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        Publikace je povolená jen z archivovaného oficiálního zdroje. Velké
        změny vyžadují výslovné potvrzení a všechny kroky se zapisují do auditu.
        Zdrojový odkaz slouží ke kontrole; samotný výpočet používá neměnnou
        uloženou verzi.
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Ceny používané ve výpočtech
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Toto je produkční lokální katalog. Fronta níže zobrazuje pouze nové
            položky čekající na kontrolu.
          </p>
        </div>
        {(sourceBackedProducts < publishedProducts.length ||
          sourceBackedDistributions < publishedDistributions.length) && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
            <strong>Chybí doložení zdrojem:</strong> archivovaný oficiální
            dokument má {sourceBackedProducts} z {publishedProducts.length}
            produktových a {sourceBackedDistributions} z{" "}
            {publishedDistributions.length} distribučních verzí. Ostatní jsou
            referenční bootstrap hodnoty a před zákaznickou prezentací je nutné
            je ověřit a nahradit verzí navázanou na dokument.
          </div>
        )}
        <div className="app-card overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Dodavatel a produkt</th>
                <th className="px-4 py-3">Nákup</th>
                <th className="px-4 py-3">Výkup</th>
                <th className="px-4 py-3">Měsíční plat</th>
                <th className="px-4 py-3">Původ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {publishedProducts.map((version) => (
                <tr key={version.id}>
                  <td className="px-4 py-3">
                    <strong className="block text-slate-900">
                      {version.product.supplier.name}
                    </strong>
                    <span className="text-slate-500">{version.product.name}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {version.buyMode === "SPOT"
                      ? `OTE + ${price(version.spotBuyFeeCzkKwh)}`
                      : `${price(version.fixedBuyVtCzkKwh)} VT · ${price(
                          version.fixedBuyNtCzkKwh ?? version.fixedBuyVtCzkKwh,
                        )} NT`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {version.sellMode === "SPOT"
                      ? `OTE − ${price(version.spotSellFeeCzkKwh)}`
                      : `${price(version.fixedSellVtCzkKwh)} VT · ${price(
                          version.fixedSellNtCzkKwh ?? version.fixedSellVtCzkKwh,
                        )} NT`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {Number(version.monthlyFeeCzk).toLocaleString("cs-CZ")} Kč
                  </td>
                  <td className="px-4 py-3">
                    {version.sourceDocument ? (
                      <Link
                        href={version.sourceDocument.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        Archivovaný dokument ↗
                      </Link>
                    ) : (
                      <span className="font-semibold text-red-700">
                        Referenční hodnota bez archivovaného zdroje
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="app-card overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Distribuční sazba</th>
                <th className="px-4 py-3">VT</th>
                <th className="px-4 py-3">NT</th>
                <th className="px-4 py-3">Systém, daň a POZE</th>
                <th className="px-4 py-3">Původ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {publishedDistributions.map((version) => (
                <tr key={version.id}>
                  <td className="px-4 py-3">
                    <strong className="block text-slate-900">
                      {version.distributionTariff.code}
                    </strong>
                    <span className="text-slate-500">
                      {version.distributionTariff.distributor.name}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {price(version.distributionVtCzkKwh)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {price(version.distributionNtCzkKwh)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {price(
                      Number(version.systemServicesCzkKwh) +
                        Number(version.electricityTaxCzkKwh) +
                        Number(version.pozeCzkKwh),
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {version.sourceDocument ? (
                      <Link
                        href={version.sourceDocument.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        Archivovaný dokument ↗
                      </Link>
                    ) : (
                      <span className="font-semibold text-red-700">
                        Referenční hodnota bez archivovaného zdroje
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Zdrojové dokumenty ({queue.sources.length})
        </h2>
        {!queue.sources.length && (
          <p className="app-card p-5 text-sm text-slate-500">
            Žádný dokument nečeká na kontrolu.
          </p>
        )}
        {queue.sources.map((source) => (
          <article
            key={source.id}
            className="app-card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-slate-900">{source.title}</h3>
                <Status value={source.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {source.company} · staženo{" "}
                {new Date(source.retrievedAt).toLocaleString("cs-CZ")}
              </p>
              <Link
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex break-all text-sm text-brand-700 hover:underline"
              >
                Otevřít oficiální zdroj ↗
              </Link>
              <div className="mt-4">
                <ReportView report={source.report} />
              </div>
            </div>
            <CatalogReviewActions
              entity="source"
              id={source.id}
              status={source.status}
              valid={source.report.valid}
              hasWarnings={source.report.issues.some(
                (issue) => issue.severity === "WARNING",
              )}
            />
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Dodavatelské produkty ({queue.products.length})
        </h2>
        {!queue.products.length && (
          <p className="app-card p-5 text-sm text-slate-500">
            Žádná verze produktu nečeká na kontrolu.
          </p>
        )}
        {queue.products.map((row) => (
          <article
            key={row.id}
            className="app-card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-slate-900">{row.title}</h3>
                <Status value={row.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Platnost od{" "}
                {new Date(row.validFrom).toLocaleDateString("cs-CZ")}
                {row.validTo
                  ? ` do ${new Date(row.validTo).toLocaleDateString("cs-CZ")}`
                  : " bez zadaného konce"}
              </p>
              <div className="mt-4">
                <ReportView report={row.report} />
              </div>
            </div>
            <CatalogReviewActions
              entity="product-version"
              id={String(row.id)}
              status={row.status}
              valid={row.report.valid}
              hasWarnings={row.report.issues.some(
                (issue) => issue.severity === "WARNING",
              )}
            />
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Distribuční sazby ({queue.distributions.length})
        </h2>
        {!queue.distributions.length && (
          <p className="app-card p-5 text-sm text-slate-500">
            Žádná distribuční verze nečeká na kontrolu.
          </p>
        )}
        {queue.distributions.map((row) => (
          <article
            key={row.id}
            className="app-card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-slate-900">{row.title}</h3>
                <Status value={row.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Platnost od{" "}
                {new Date(row.validFrom).toLocaleDateString("cs-CZ")}
                {row.validTo
                  ? ` do ${new Date(row.validTo).toLocaleDateString("cs-CZ")}`
                  : " bez zadaného konce"}
              </p>
              <div className="mt-4">
                <ReportView report={row.report} />
              </div>
            </div>
            <CatalogReviewActions
              entity="distribution-version"
              id={String(row.id)}
              status={row.status}
              valid={row.report.valid}
              hasWarnings={row.report.issues.some(
                (issue) => issue.severity === "WARNING",
              )}
            />
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Dotace a financování ({queue.funding.length})
        </h2>
        {!queue.funding.length && (
          <p className="app-card p-5 text-sm text-slate-500">
            Žádná verze dotačního nebo úvěrového programu nečeká na kontrolu.
          </p>
        )}
        {queue.funding.map((row) => (
          <article
            key={row.id}
            className="app-card grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-slate-900">{row.title}</h3>
                <Status
                  value={row.kind === "GRANT" ? "DOTACE" : "FINANCOVÁNÍ"}
                />
                <Status value={row.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Platnost od{" "}
                {new Date(row.validFrom).toLocaleDateString("cs-CZ")}
                {row.validTo
                  ? ` do ${new Date(row.validTo).toLocaleDateString("cs-CZ")}`
                  : " bez zadaného konce"}
              </p>
              <div className="mt-4">
                <ReportView report={row.report} />
              </div>
            </div>
            <CatalogReviewActions
              entity="funding-version"
              id={String(row.id)}
              status={row.status}
              valid={row.report.valid}
              hasWarnings={row.report.issues.some(
                (issue) => issue.severity === "WARNING",
              )}
            />
          </article>
        ))}
      </section>
    </div>
  );
}
