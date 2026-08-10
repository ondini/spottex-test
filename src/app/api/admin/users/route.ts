import { NextRequest, NextResponse } from "next/server";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const take = 30;
  const where = query
    ? { OR: [{ email: { contains: query, mode: "insensitive" as const } }, { name: { contains: query, mode: "insensitive" as const } }] }
    : {};
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        energySites: { select: { id: true, name: true, status: true } },
        subscriptions: { where: { status: { in: ["ACTIVE", "TRIAL"] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    prisma.user.count({ where }),
  ]);
  return NextResponse.json({ users, pagination: { page, take, total, pages: Math.ceil(total / take) } });
}
