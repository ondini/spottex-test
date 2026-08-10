import { Prisma } from "@prisma/client";

import { prisma } from "../src/lib/prisma";

if (process.env.ALLOW_UNVERIFIED_REFERENCE_CATALOG !== "true") {
  throw new Error(
    "UNVERIFIED_REFERENCE_CATALOG_DISABLED: use scripts/sync-costs-catalog.ts with verified Costs records",
  );
}

const validFrom = new Date("2026-01-01T00:00:00.000Z");
const fixedSourceUrl =
  "https://www.cez.cz/file/edee/2025/10/x08_moo_ee_bez-zavazku.pdf";
const spotSourceUrl =
  "https://www.cez.cz/cs/nova-energetika/spotovy-produkt";
const spotSellSourceUrl =
  "https://www.cez.cz/webpublic/file/edee/2025/10/mop_ee_vykup_ee_v_trznim-rezimu_bez-licence.pdf";
const preSolarSourceUrl =
  "https://www.pre.cz/cs/linky/dokumenty-ke-stazeni/cenik/elektrina/cez/moo/pre-proud-solar/";
const preEkoSourceUrl =
  "https://www.pre.cz/ke-stazeni/cenik/2026/05/elektrina/pre/moo/pre-proud-eko/";
const eonBuySourceUrl =
  "https://www.eon.cz/getmedia/PriceLists/Domacnosti/Elektrina/2026/Akvizice/Elektrina_vyhodne_PRO_6_26/cenik--elektrina--vyhodne--pro--na--3--roky--6_26-----distribucni--uzemi--cez.pdf";
const centropolBuySourceUrl =
  "https://www.centropol.cz/wp-content/uploads/2026/02/d-mesicne-se-zmenou-01042026-d-cez-01012026.pdf";
const bezDodavateleSourceUrl =
  "https://www.bezdodavatele.cz/wp-content/uploads/2026/01/26_01_EL_Cenik_DOM_Spot_info.pdf";
const deltaBuySourceUrl =
  "https://cdn.prod.website-files.com/63072b68a235768212bfaa95/6a16ab2e98aeb497cc7b26b9_Delta%20Green%20-%20Cen%C3%ADk%20Delta%20SPOT%20-%20%C4%8CEZ%20-%20Dom%C3%A1cnosti.pdf";
const deltaSellSourceUrl =
  "https://cdn.prod.website-files.com/63072b68a235768212bfaa95/6941723f445ca41fe21c2c18_Delta%20Green%20-%20Cen%C3%ADk%20-%20V%C3%BDkup.pdf";
const mndSellSourceUrl =
  "https://prod.mnd.cz/documents/view/65388977-b62b-4cf8-b767-b42f4d01a865";
const distributionSourceUrl =
  "https://www.cezdistribuce.cz/pro-zakazniky/potrebuji-vyresit/ceny-a-podminky/podminky-pro-priznani-distribucni-sazby";

const tariffs = [
  {
    code: "D01d",
    name: "Malá spotřeba",
    eligibilityNote:
      "Jednotarifní sazba pro odběrná místa s velmi malou spotřebou; vhodnost závisí také na velikosti jističe.",
    vt: 3.22666,
    nt: 3.22666,
    breaker: 150.04,
  },
  {
    code: "D02d",
    name: "Běžná spotřeba",
    eligibilityNote: "Běžná jednotarifní sazba pro domácnosti.",
    vt: 2.51508,
    nt: 2.51508,
    breaker: 309.76,
  },
  {
    code: "D25d",
    name: "Ohřev vody · 8 hodin NT",
    eligibilityNote:
      "Vyžaduje elektrický akumulační spotřebič pro ohřev vody a splnění podmínek distributora.",
    vt: 2.72546,
    nt: 0.14097,
    breaker: 325.49,
  },
  {
    code: "D26d",
    name: "Akumulační vytápění · 8 hodin NT",
    eligibilityNote:
      "Vyžaduje elektrické akumulační vytápění a splnění technických podmínek distributora.",
    vt: 1.45449,
    nt: 0.14097,
    breaker: 438.02,
  },
  {
    code: "D27d",
    name: "Elektromobilita · 8 hodin NT",
    eligibilityNote:
      "Vyžaduje vlastnictví nebo užívání elektromobilu a splnění podmínek distributora.",
    vt: 2.72546,
    nt: 0.14097,
    breaker: 308.55,
  },
] as const;

const rateProducts = {
  D01d: {
    cezVt: 3.86,
    cezNt: 3.86,
    cezMonthly: 163.35,
    preVt: 4.2713,
    preNt: 4.2713,
    eonVt: 2.09693,
    eonNt: 2.09693,
  },
  D02d: {
    cezVt: 3.86,
    cezNt: 3.86,
    cezMonthly: 163.35,
    preVt: 4.2713,
    preNt: 4.2713,
    eonVt: 2.09693,
    eonNt: 2.09693,
  },
  D25d: {
    cezVt: 3.96,
    cezNt: 3.7,
    cezMonthly: 146.41,
    preVt: 4.1503,
    preNt: 3.9083,
    eonVt: 2.19131,
    eonNt: 1.9723,
  },
  D26d: {
    cezVt: 3.96,
    cezNt: 3.7,
    cezMonthly: 146.41,
    preVt: 4.1503,
    preNt: 3.9083,
    eonVt: 2.19131,
    eonNt: 1.9723,
  },
  D27d: {
    cezVt: 3.96,
    cezNt: 3.65,
    cezMonthly: 146.41,
    preVt: 4.1503,
    preNt: 3.9083,
    eonVt: 2.19131,
    eonNt: 1.9723,
  },
} as const;

const allDistributionCodes = tariffs.map((tariff) =>
  tariff.code.toUpperCase(),
);

const products = [
  ...Object.entries(rateProducts).flatMap(([code, price]) => [
    {
      supplierCode: "CEZ_PRODEJ",
      code: `BUY_CEZ_NO_COMMITMENT_${code.toUpperCase()}_2026`,
      name: `Elektřina bez závazku · ${code}`,
      direction: "BUY" as const,
      referenceBaseline: code === "D01d",
      validFrom,
      distributionCodes: [code.toUpperCase()],
      buyMode: "FIX" as const,
      sellMode: "FIX" as const,
      monthlyFeeCzk: price.cezMonthly,
      fixedBuyVtCzkKwh: price.cezVt,
      fixedBuyNtCzkKwh: price.cezNt,
      fixedSellVtCzkKwh: null,
      fixedSellNtCzkKwh: null,
      spotBuyFeeCzkKwh: null,
      spotSellFeeCzkKwh: null,
      sourceUrl: fixedSourceUrl,
      availabilityNote: "Smlouva na dobu neurčitou, bez fixace ceny.",
    },
    {
      supplierCode: "PRE",
      code: `BUY_PRE_EKO_${code.toUpperCase()}_2026`,
      name: `PRE PROUD EKO · ${code}`,
      direction: "BUY" as const,
      referenceBaseline: false,
      validFrom: new Date("2026-05-01T00:00:00.000Z"),
      distributionCodes: [code.toUpperCase()],
      buyMode: "FIX" as const,
      sellMode: "FIX" as const,
      monthlyFeeCzk: 156.09,
      fixedBuyVtCzkKwh: price.preVt,
      fixedBuyNtCzkKwh: price.preNt,
      fixedSellVtCzkKwh: null,
      fixedSellNtCzkKwh: null,
      spotBuyFeeCzkKwh: null,
      spotSellFeeCzkKwh: null,
      sourceUrl: preEkoSourceUrl,
      availabilityNote: "Garance ceny do 31. 3. 2028.",
    },
    {
      supplierCode: "EON",
      code: `BUY_EON_VYHODNE_PRO_${code.toUpperCase()}_2026`,
      name: `Elektřina výhodně PRO na 3 roky · ${code}`,
      direction: "BUY" as const,
      referenceBaseline: false,
      validFrom: new Date("2026-06-17T00:00:00.000Z"),
      distributionCodes: [code.toUpperCase()],
      buyMode: "FIX" as const,
      sellMode: "FIX" as const,
      monthlyFeeCzk: 168.19,
      fixedBuyVtCzkKwh: price.eonVt,
      fixedBuyNtCzkKwh: price.eonNt,
      fixedSellVtCzkKwh: null,
      fixedSellNtCzkKwh: null,
      spotBuyFeeCzkKwh: null,
      spotSellFeeCzkKwh: null,
      sourceUrl: eonBuySourceUrl,
      availabilityNote:
        "Akční cena pro rok 2026; od 1. 1. 2027 je cena podle ceníku vyšší.",
    },
    {
      supplierCode: "CENTROPOL",
      code: `BUY_CENTROPOL_MONTHLY_${code.toUpperCase()}_2026`,
      name: `Měsíčně se změnou · ${code}`,
      direction: "BUY" as const,
      referenceBaseline: false,
      validFrom: new Date("2026-04-01T00:00:00.000Z"),
      distributionCodes: [code.toUpperCase()],
      buyMode: "FIX" as const,
      sellMode: "FIX" as const,
      monthlyFeeCzk: 157.3,
      fixedBuyVtCzkKwh: 3.25269,
      fixedBuyNtCzkKwh: 3.25269,
      fixedSellVtCzkKwh: null,
      fixedSellNtCzkKwh: null,
      spotBuyFeeCzkKwh: null,
      spotSellFeeCzkKwh: null,
      sourceUrl: centropolBuySourceUrl,
      availabilityNote: "Cena se může měnit každý měsíc.",
    },
  ]),
  {
    supplierCode: "CEZ_PRODEJ",
    code: "BUY_CEZ_SPOT_2026",
    name: "ČEZ SPOT · nákup",
    direction: "BUY" as const,
    referenceBaseline: false,
    validFrom,
    distributionCodes: allDistributionCodes,
    buyMode: "SPOT" as const,
    sellMode: "FIX" as const,
    monthlyFeeCzk: 154.88,
    fixedBuyVtCzkKwh: null,
    fixedBuyNtCzkKwh: null,
    fixedSellVtCzkKwh: null,
    fixedSellNtCzkKwh: null,
    spotBuyFeeCzkKwh: 0.48279,
    spotSellFeeCzkKwh: null,
    sourceUrl: spotSourceUrl,
    availabilityNote: "Denní trh OTE + poplatek obchodníka.",
  },
  {
    supplierCode: "DELTA_GREEN",
    code: "BUY_DELTA_SPOT_2026",
    name: "Delta SPOT · nákup",
    direction: "BUY" as const,
    referenceBaseline: false,
    validFrom: new Date("2026-06-01T00:00:00.000Z"),
    distributionCodes: allDistributionCodes,
    buyMode: "SPOT" as const,
    sellMode: "FIX" as const,
    monthlyFeeCzk: 192.39,
    fixedBuyVtCzkKwh: null,
    fixedBuyNtCzkKwh: null,
    fixedSellVtCzkKwh: null,
    fixedSellNtCzkKwh: null,
    spotBuyFeeCzkKwh: 0.363,
    spotSellFeeCzkKwh: null,
    sourceUrl: deltaBuySourceUrl,
    availabilityNote: "Denní trh OTE + 0,363 Kč/kWh.",
  },
  ...tariffs.map((tariff) => ({
    supplierCode: "BEZDODAVATELE",
    code: `BUY_BEZDODAVATELE_SPOT_${tariff.code.toUpperCase()}_2026`,
    name: `bezDodavatele SPOT · ${tariff.code}`,
    direction: "BUY" as const,
    referenceBaseline: false,
    validFrom,
    distributionCodes: [tariff.code.toUpperCase()],
    buyMode: "SPOT" as const,
    sellMode: "FIX" as const,
    monthlyFeeCzk: ["D01D", "D02D"].includes(tariff.code.toUpperCase())
      ? (3.27 * 365) / 12
      : (5.06 * 365) / 12,
    fixedBuyVtCzkKwh: null,
    fixedBuyNtCzkKwh: null,
    fixedSellVtCzkKwh: null,
    fixedSellNtCzkKwh: null,
    spotBuyFeeCzkKwh: 0.4719,
    spotSellFeeCzkKwh: null,
    sourceUrl: bezDodavateleSourceUrl,
    availabilityNote:
      "Denní trh OTE + standardní poplatek; sleva za podporované chytré řízení není započtena.",
  })),
  {
    supplierCode: "CEZ_PRODEJ",
    code: "SELL_CEZ_SPOT_2026",
    name: "Výkup v tržním režimu bez licence",
    direction: "SELL" as const,
    referenceBaseline: true,
    validFrom,
    distributionCodes: allDistributionCodes,
    buyMode: "FIX" as const,
    sellMode: "SPOT" as const,
    monthlyFeeCzk: 0,
    fixedBuyVtCzkKwh: null,
    fixedBuyNtCzkKwh: null,
    fixedSellVtCzkKwh: null,
    fixedSellNtCzkKwh: null,
    spotBuyFeeCzkKwh: null,
    spotSellFeeCzkKwh: 0.35,
    sourceUrl: spotSellSourceUrl,
    availabilityNote: "Cena denního trhu OTE − 0,35 Kč/kWh.",
  },
  {
    supplierCode: "DELTA_GREEN",
    code: "SELL_DELTA_SPOT_2026",
    name: "Výkup SPOT",
    direction: "SELL" as const,
    referenceBaseline: false,
    validFrom: new Date("2025-12-16T00:00:00.000Z"),
    distributionCodes: allDistributionCodes,
    buyMode: "FIX" as const,
    sellMode: "SPOT" as const,
    monthlyFeeCzk: 0,
    fixedBuyVtCzkKwh: null,
    fixedBuyNtCzkKwh: null,
    fixedSellVtCzkKwh: null,
    fixedSellNtCzkKwh: null,
    spotBuyFeeCzkKwh: null,
    spotSellFeeCzkKwh: 0.6,
    sourceUrl: deltaSellSourceUrl,
    availabilityNote:
      "Cena denního trhu OTE − 0,60 Kč/kWh; varianta se sdílením dat má nižší poplatek.",
  },
  {
    supplierCode: "MND",
    code: "SELL_MND_SOLAR_ACCOUNT_BASIC_2026",
    name: "Solární účet · základní sazba",
    direction: "SELL" as const,
    referenceBaseline: false,
    validFrom: new Date("2026-07-10T00:00:00.000Z"),
    distributionCodes: allDistributionCodes,
    buyMode: "FIX" as const,
    sellMode: "FIX" as const,
    monthlyFeeCzk: 60,
    fixedBuyVtCzkKwh: null,
    fixedBuyNtCzkKwh: null,
    fixedSellVtCzkKwh: 0.5,
    fixedSellNtCzkKwh: 0.5,
    spotBuyFeeCzkKwh: null,
    spotSellFeeCzkKwh: null,
    sourceUrl: mndSellSourceUrl,
    availabilityNote:
      "Samostatná základní sazba 0,50 Kč/kWh; bonus pro souběžný odběr MND není započten.",
  },
];

async function main() {
  const distributor = await prisma.energyCompany.upsert({
    where: { code: "CEZ_DISTRIBUCE" },
    update: {
      name: "ČEZ Distribuce, a.s.",
      roles: { set: ["DISTRIBUTOR"] },
      active: true,
    },
    create: {
      code: "CEZ_DISTRIBUCE",
      name: "ČEZ Distribuce, a.s.",
      roles: ["DISTRIBUTOR"],
      active: true,
    },
  });
  const supplierDefinitions = [
    ["CEZ_PRODEJ", "ČEZ Prodej, a.s."],
    ["PRE", "Pražská energetika, a.s."],
    ["EON", "E.ON Energie, a.s."],
    ["CENTROPOL", "CENTROPOL ENERGY, a.s."],
    ["BEZDODAVATELE", "bezDodavatele a.s."],
    ["DELTA_GREEN", "Delta Green s.r.o."],
    ["MND", "MND Energie a.s."],
  ] as const;
  const suppliers = new Map(
    await Promise.all(
      supplierDefinitions.map(async ([code, name]) => {
        const supplier = await prisma.energyCompany.upsert({
          where: { code },
          update: {
            name,
            roles: { set: ["SUPPLIER"] },
            active: true,
          },
          create: {
            code,
            name,
            roles: ["SUPPLIER"],
            active: true,
          },
        });
        return [code, supplier] as const;
      }),
    ),
  );

  await prisma.distributionTariff.updateMany({
    where: {
      distributorId: distributor.id,
      code: "D57d",
      customerSegment: "HOUSEHOLD",
    },
    data: { active: false },
  });
  await prisma.energyProduct.updateMany({
    where: {
      OR: [
        { code: { contains: "D57D" } },
        { code: { startsWith: "CEZ_REFERENCE_" } },
        { code: { startsWith: "PRE_SOLAR_" } },
      ],
    },
    data: { active: false },
  });

  for (const tariff of tariffs) {
    const item = await prisma.distributionTariff.upsert({
      where: {
        distributorId_code_customerSegment: {
          distributorId: distributor.id,
          code: tariff.code,
          customerSegment: "HOUSEHOLD",
        },
      },
      update: {
        name: tariff.name,
        eligibilityNote: tariff.eligibilityNote,
        active: true,
      },
      create: {
        distributorId: distributor.id,
        code: tariff.code,
        name: tariff.name,
        eligibilityNote: tariff.eligibilityNote,
      },
    });
    await prisma.distributionTariffVersion.upsert({
      where: {
        distributionTariffId_validFrom: {
          distributionTariffId: item.id,
          validFrom,
        },
      },
      update: {
        status: "PUBLISHED",
        vatIncluded: true,
        distributionVtCzkKwh: tariff.vt,
        distributionNtCzkKwh: tariff.nt,
        systemServicesCzkKwh: 0.19873,
        electricityTaxCzkKwh: 0.03424,
        pozeCzkKwh: 0,
        monthlyMeterFeeCzk: 15.57,
        breakerFees: { "3x25": tariff.breaker },
        eligibility: {
          modeledHdo: ["D01d", "D02d"].includes(tariff.code) ? 0 : 8,
          sourceUrl: distributionSourceUrl,
        },
      },
      create: {
        distributionTariffId: item.id,
        validFrom,
        status: "PUBLISHED",
        vatIncluded: true,
        distributionVtCzkKwh: tariff.vt,
        distributionNtCzkKwh: tariff.nt,
        systemServicesCzkKwh: 0.19873,
        electricityTaxCzkKwh: 0.03424,
        pozeCzkKwh: 0,
        monthlyMeterFeeCzk: 15.57,
        breakerFees: { "3x25": tariff.breaker },
        eligibility: {
          modeledHdo: ["D01d", "D02d"].includes(tariff.code) ? 0 : 8,
          sourceUrl: distributionSourceUrl,
        },
      },
    });
  }

  for (const product of products) {
    const productSupplier = suppliers.get(
      product.supplierCode as (typeof supplierDefinitions)[number][0],
    );
    if (!productSupplier)
      throw new Error(`CATALOG_SUPPLIER_MISSING:${product.supplierCode}`);
    const item = await prisma.energyProduct.upsert({
      where: {
        supplierId_code: {
          supplierId: productSupplier.id,
          code: product.code,
        },
      },
      update: {
        name: product.name,
        active: true,
        metadata: {
          distributionCodes: product.distributionCodes,
          sourceUrl: product.sourceUrl,
          direction: product.direction,
          referenceBaseline: product.referenceBaseline,
          availabilityNote: product.availabilityNote,
          referenceOnly: true,
        },
      },
      create: {
        supplierId: productSupplier.id,
        code: product.code,
        name: product.name,
        metadata: {
          distributionCodes: product.distributionCodes,
          sourceUrl: product.sourceUrl,
          direction: product.direction,
          referenceBaseline: product.referenceBaseline,
          availabilityNote: product.availabilityNote,
          referenceOnly: true,
        },
      },
    });
    await prisma.energyProductVersion.upsert({
      where: {
        productId_validFrom: {
          productId: item.id,
          validFrom: product.validFrom,
        },
      },
      update: {
        status: "PUBLISHED",
        vatIncluded: true,
        buyMode: product.buyMode,
        sellMode: product.sellMode,
        monthlyFeeCzk: product.monthlyFeeCzk,
        fixedBuyVtCzkKwh: product.fixedBuyVtCzkKwh,
        fixedBuyNtCzkKwh: product.fixedBuyNtCzkKwh,
        fixedSellVtCzkKwh: product.fixedSellVtCzkKwh,
        fixedSellNtCzkKwh: product.fixedSellNtCzkKwh,
        spotBuyFeeCzkKwh: product.spotBuyFeeCzkKwh,
        spotSellFeeCzkKwh: product.spotSellFeeCzkKwh,
        formula: {
          sourceUrl: product.sourceUrl,
          direction: product.direction,
          availabilityNote: product.availabilityNote,
          referenceOnly: true,
        },
      },
      create: {
        productId: item.id,
        validFrom: product.validFrom,
        status: "PUBLISHED",
        vatIncluded: true,
        buyMode: product.buyMode,
        sellMode: product.sellMode,
        monthlyFeeCzk: product.monthlyFeeCzk,
        fixedBuyVtCzkKwh: product.fixedBuyVtCzkKwh,
        fixedBuyNtCzkKwh: product.fixedBuyNtCzkKwh,
        fixedSellVtCzkKwh: product.fixedSellVtCzkKwh,
        fixedSellNtCzkKwh: product.fixedSellNtCzkKwh,
        spotBuyFeeCzkKwh: product.spotBuyFeeCzkKwh,
        spotSellFeeCzkKwh: product.spotSellFeeCzkKwh,
        formula: {
          sourceUrl: product.sourceUrl,
          direction: product.direction,
          availabilityNote: product.availabilityNote,
          referenceOnly: true,
        },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      action: "ANALYSIS_REFERENCE_CATALOG_BOOTSTRAPPED",
      entityType: "EnergyCompany",
      entityId: String(distributor.id),
      metadata: {
        tariffs: tariffs.map((tariff) => tariff.code),
        products: products.map((product) => product.code),
        fixedSourceUrl,
        spotSourceUrl,
        spotSellSourceUrl,
        preSolarSourceUrl,
        preEkoSourceUrl,
        eonBuySourceUrl,
        centropolBuySourceUrl,
        bezDodavateleSourceUrl,
        deltaBuySourceUrl,
        deltaSellSourceUrl,
        mndSellSourceUrl,
        distributionSourceUrl,
      } as Prisma.InputJsonValue,
    },
  });

  console.log(
    JSON.stringify({
      distributor: distributor.code,
      tariffs: tariffs.length,
      products: products.length,
    }),
  );
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
