import {
  EnergyIntervalKind,
  EnergyProvider,
  EnergySiteStatus,
  InverterStatus,
  PrismaClient,
  ProductType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const production = process.env.NODE_ENV === "production";
  const adminEmail = (process.env.ADMIN_SEED_EMAIL || (production ? "" : "admin@spottex.cz")).trim().toLowerCase();
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || (production ? "" : "Spottex-Dev-2026!");
  if (
    !adminEmail ||
    !adminPassword ||
    adminPassword.length < 14 ||
    Buffer.byteLength(adminPassword, "utf8") > 72 ||
    (production && /replace|change-me|spottex-dev/i.test(adminPassword))
  ) {
    throw new Error(
      "Set a non-placeholder ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD (14 characters, at most 72 UTF-8 bytes) before seeding",
    );
  }
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: UserRole.ADMIN, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(), passwordHash: adminPasswordHash, authVersion: { increment: 1 } },
    create: {
      email: adminEmail,
      passwordHash: adminPasswordHash,
      name: "Spottex administrátor",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  const inverterProduct = await prisma.product.upsert({
    where: { code: "INVERTER_CONTROL" },
    update: {
      name: "Chytré řízení střídače",
      description: "Roční chytré řízení. Cena je stanovena předem jako nejvýše 25 % očekávané úspory, maximálně 990 Kč za rok.",
      priceMinor: 99000,
      billingPeriodDays: 365,
      metadata: {
        pricingModel: "ANNUAL_EXPECTED_SAVINGS_SHARE_CAPPED",
        freeTrialDays: 30,
        defaultBillingOption: "YEARLY",
        yearly: { savingsSharePercent: 25, capMinor: 99000, billingPeriodDays: 365 },
      },
    },
    create: {
      code: "INVERTER_CONTROL",
      name: "Chytré řízení střídače",
      description: "Roční chytré řízení. Cena je stanovena předem jako nejvýše 25 % očekávané úspory, maximálně 990 Kč za rok.",
      type: ProductType.SUBSCRIPTION,
      priceMinor: 99000,
      billingPeriodDays: 365,
      metadata: {
        pricingModel: "ANNUAL_EXPECTED_SAVINGS_SHARE_CAPPED",
        freeTrialDays: 30,
        defaultBillingOption: "YEARLY",
        yearly: { savingsSharePercent: 25, capMinor: 99000, billingPeriodDays: 365 },
      },
    },
  });

  const adminEntitlement = await prisma.subscription.findFirst({
    where: {
      userId: admin.id,
      productId: inverterProduct.id,
      status: { in: ["ACTIVE", "TRIAL"] },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!adminEntitlement) {
    await prisma.subscription.create({
      data: {
        userId: admin.id,
        productId: inverterProduct.id,
        status: "ACTIVE",
        source: "PROMO",
        startsAt: new Date(),
        activatedByAdminId: admin.id,
        activationReason: "Seedovaný administrátorský přístup pro DEMO a provozní ověření",
      },
    });
  }

  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: {
      contactEmail: "info@spottex.cz",
      sellerCompanyName: "Spottex Energy, s.r.o.",
      sellerCompanyId: "23191627",
      sellerAddress: "Volutová 2523/14, Stodůlky, 158 00 Praha 5",
    },
    create: {
      id: 1,
      contactEmail: "info@spottex.cz",
      sellerCompanyName: "Spottex Energy, s.r.o.",
      sellerCompanyId: "23191627",
      sellerAddress: "Volutová 2523/14, Stodůlky, 158 00 Praha 5",
    },
  });

  const companyReferences = [
    {
      name: "AlmaGate, s.r.o.",
      slug: "almagate",
      description: "Certifikované vzdělávání v elektrotechnice propojené s projekční a realizační praxí: fotovoltaickými elektrárnami, nabíjecími stanicemi a elektroinstalacemi.",
      imageUrl: "/content/references/almagate-solax.jpg",
      url: "https://almagate.cz/",
      location: "FVE · elektroinstalace · vzdělávání",
      sortOrder: 10,
    },
    {
      name: "JUBELA, s.r.o.",
      slug: "jubela",
      description: "Česká vzdělávací společnost působící od roku 1999. Pořádá profesní a rekvalifikační kurzy pro firmy, jednotlivce i veřejné instituce.",
      imageUrl: "/content/references/jubela-training.png",
      url: "https://jubela.cz/",
      location: "Profesní vzdělávání od roku 1999",
      sortOrder: 20,
    },
    {
      name: "Universal Technologies s.r.o.",
      slug: "universal-technologies",
      description: "Elektromontážní a realizační společnost Jiřího Šrámka založená v roce 2012. Stojí na zkušenostech s elektroinstalacemi, projektováním elektrických zařízení a realizací technických řešení.",
      imageUrl: "/content/references/universal-technologies-jiri-sramek.jpeg",
      url: null,
      location: "Elektromontáže · projekce · realizace",
      sortOrder: 30,
    },
  ];
  for (const reference of companyReferences) {
    await prisma.referenceProject.upsert({
      where: { slug: reference.slug },
      update: { ...reference, published: true },
      create: { ...reference, published: true },
    });
  }

  await prisma.referenceProject.updateMany({
    where: {
      slug: { in: ["aqua-spp-energeticka-studie", "jublea", "frame4city"] },
    },
    data: { published: false },
  });

  const foundingTeam = [
    {
      name: "Ing. Anna Zderadičková",
      title: "Spoluzakladatelka · vývoj a datové technologie",
      bio: "Vývojářka a výzkumnice v oblasti počítačového vidění, 3D dat a rozšířené reality. Do Spottexu přináší zkušenost s automatizací návrhu fotovoltaiky a převodem výzkumu do praktického produktu.",
      photoUrl: "/content/founders/anna-zderadickova-reframed.png",
      linkedInUrl: "https://cz.linkedin.com/in/anna-zderadi%C4%8Dkov%C3%A1-15865414a/en",
      sortOrder: 10,
    },
    {
      name: "Ing. Jiří Šrámek",
      title: "Spoluzakladatel · technologie a realizace FVE",
      bio: "Elektrotechnik, projektant a realizátor se zkušeností z montáží fotovoltaických elektráren a profesního vzdělávání. Ve Spottexu odpovídá za technologii a převod chytrého řízení do bezpečné praxe.",
      photoUrl: "/content/founders/jiri-sramek.jpeg",
      linkedInUrl: null,
      sortOrder: 20,
    },
  ];
  for (const person of foundingTeam) {
    const existing = await prisma.founder.findFirst({ where: { name: person.name }, select: { id: true } });
    if (existing) {
      await prisma.founder.update({ where: { id: existing.id }, data: { ...person, published: true } });
    } else {
      await prisma.founder.create({ data: { ...person, published: true } });
    }
  }

  await prisma.founder.updateMany({
    where: { name: "Michal Polic" },
    data: { published: false },
  });

  await prisma.referenceProject.upsert({
    where: { slug: "aqua-spp-energeticka-studie" },
    update: {
      name: "AQUA SPP – energetická studie",
      description: "Vyhodnocení výroby a spotřeby, variant rozšíření FVE, bateriového úložiště, distribučních sazeb a chytrého řízení nad rokem 15minutových dat.",
      location: "Litoměřice",
      published: false,
      sortOrder: 0,
    },
    create: {
      name: "AQUA SPP – energetická studie",
      slug: "aqua-spp-energeticka-studie",
      description: "Vyhodnocení výroby a spotřeby, variant rozšíření FVE, bateriového úložiště, distribučních sazeb a chytrého řízení nad rokem 15minutových dat.",
      location: "Litoměřice",
      published: false,
      sortOrder: 0,
    },
  });

  // Deterministic local energy data keeps the dashboard useful without calling
  // the legacy vendor. Re-seeding replaces only this DEMO inverter's cache.
  const now = new Date();
  const firstHour = new Date(now);
  firstHour.setMinutes(0, 0, 0);
  firstHour.setHours(firstHour.getHours() - 23);
  const demoSite = await prisma.energySite.upsert({
    where: {
      provider_externalSiteId: { provider: EnergyProvider.DEMO, externalSiteId: "demo-admin-site" },
    },
    update: {
      userId: admin.id,
      name: "Rodinný dům – DEMO",
      status: EnergySiteStatus.ONLINE,
      optimizationOn: true,
      requiredInfo: false,
      lastSyncedAt: now,
      metadata: {
        demo: true,
        batteryCapacityKwh: 11.6,
        pvCapacityKwp: 9.9,
        cachedSavings: { todayCzk: 86, weekCzk: 612, monthCzk: 2480, yearCzk: 18420 },
      },
    },
    create: {
      userId: admin.id,
      provider: EnergyProvider.DEMO,
      externalSiteId: "demo-admin-site",
      name: "Rodinný dům – DEMO",
      status: EnergySiteStatus.ONLINE,
      optimizationOn: true,
      requiredInfo: false,
      lastSyncedAt: now,
      metadata: {
        demo: true,
        batteryCapacityKwh: 11.6,
        pvCapacityKwp: 9.9,
        cachedSavings: { todayCzk: 86, weekCzk: 612, monthCzk: 2480, yearCzk: 18420 },
      },
    },
  });
  const demoInverter = await prisma.inverter.upsert({
    where: {
      provider_externalDeviceId: {
        provider: EnergyProvider.DEMO,
        externalDeviceId: "demo-admin-inverter",
      },
    },
    update: {
      energySiteId: demoSite.id,
      status: InverterStatus.ONLINE,
      lastSeenAt: now,
    },
    create: {
      energySiteId: demoSite.id,
      provider: EnergyProvider.DEMO,
      externalDeviceId: "demo-admin-inverter",
      name: "Spottex virtuální střídač",
      manufacturer: "Spottex",
      model: "Virtual 10K",
      serialNumber: "DEMO-2026-001",
      status: InverterStatus.ONLINE,
      lastSeenAt: now,
      metadata: { demo: true },
    },
  });

  await prisma.$transaction([
    prisma.energyMeasurement.deleteMany({ where: { inverterId: demoInverter.id } }),
    prisma.energyInterval.deleteMany({ where: { inverterId: demoInverter.id } }),
    prisma.inverterSchedule.deleteMany({ where: { inverterId: demoInverter.id } }),
  ]);

  const intervals = Array.from({ length: 24 }, (_, index) => {
    const startAt = new Date(firstHour.getTime() + index * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const hour = startAt.getHours();
    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const production = Math.round(daylight * 420) / 100;
    const consumption = Math.round((0.38 + (hour >= 17 && hour <= 21 ? 0.72 : 0.14)) * 100) / 100;
    const battery = hour >= 10 && hour <= 15 ? 0.56 : hour >= 18 && hour <= 22 ? -0.44 : 0;
    const balance = production - consumption - Math.max(0, battery);
    return {
      startAt,
      endAt,
      production,
      consumption,
      battery,
      gridImport: Math.max(0, Math.round(-balance * 100) / 100),
      gridExport: Math.max(0, Math.round(balance * 100) / 100),
    };
  });
  await prisma.energyInterval.createMany({
    data: intervals.flatMap((interval) => [
      { inverterId: demoInverter.id, kind: EnergyIntervalKind.PRODUCTION, startAt: interval.startAt, endAt: interval.endAt, kwh: interval.production },
      { inverterId: demoInverter.id, kind: EnergyIntervalKind.CONSUMPTION, startAt: interval.startAt, endAt: interval.endAt, kwh: interval.consumption },
      { inverterId: demoInverter.id, kind: EnergyIntervalKind.BATTERY, startAt: interval.startAt, endAt: interval.endAt, kwh: interval.battery },
      { inverterId: demoInverter.id, kind: EnergyIntervalKind.GRID_IMPORT, startAt: interval.startAt, endAt: interval.endAt, kwh: interval.gridImport },
      { inverterId: demoInverter.id, kind: EnergyIntervalKind.GRID_EXPORT, startAt: interval.startAt, endAt: interval.endAt, kwh: interval.gridExport },
    ]),
  });

  const current = intervals.at(-1)!;
  await prisma.energyMeasurement.create({
    data: {
      inverterId: demoInverter.id,
      measuredAt: now,
      productionKw: current.production,
      consumptionKw: current.consumption,
      gridKw: current.gridImport - current.gridExport,
      batteryKw: current.battery,
      batterySocPct: 73,
      buyPriceCzk: 2.84,
      sellPriceCzk: 2.17,
      raw: { source: "DEMO_SEED" },
    },
  });

  const scheduleStart = new Date(now);
  scheduleStart.setMinutes(0, 0, 0);
  await prisma.inverterSchedule.createMany({
    data: Array.from({ length: 8 }, (_, index) => {
      const startAt = new Date(scheduleStart.getTime() + index * 60 * 60 * 1000);
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      const mode = index < 2 ? "CHARGE" : index >= 5 ? "SELL" : "AUTO";
      return {
        inverterId: demoInverter.id,
        startAt,
        endAt,
        mode,
        buyKw: mode === "CHARGE" ? 1.8 : 0,
        sellKw: mode === "SELL" ? 2.4 : 0,
        batteryKw: mode === "CHARGE" ? 1.6 : mode === "SELL" ? -1.9 : 0,
        targetSoc: mode === "CHARGE" ? 88 : mode === "SELL" ? 45 : 70,
        costCzk: mode === "CHARGE" ? 4.2 : mode === "SELL" ? -5.1 : 0,
        source: "DEMO_SEED",
      };
    }),
  });
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
