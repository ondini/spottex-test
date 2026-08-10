import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiAdmin } from "@/lib/auth/guards";
import { reviewCatalogEntity } from "@/lib/pricing/catalog-admin";

const bodySchema = z.object({
  action: z.enum(["VALIDATE", "PUBLISH", "REJECT"]),
  acceptWarnings: z.boolean().optional(),
  rejectionReason: z.string().trim().min(3).max(1_000).optional(),
}).strict();

const entitySchema = z.enum(["source", "product-version", "distribution-version", "funding-version"]);

const statusByCode: Record<string, number> = {
  CATALOG_SOURCE_NOT_FOUND: 404,
  CATALOG_VERSION_NOT_FOUND: 404,
  CATALOG_VALIDATION_FAILED: 422,
  CATALOG_WARNINGS_NOT_ACCEPTED: 409,
  CATALOG_INVALID_TRANSITION: 409,
  CATALOG_PUBLICATION_OVERLAP: 409,
  CATALOG_REJECTION_REASON_REQUIRED: 400,
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const route = await params;
  const entity = entitySchema.safeParse(route.entity);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!entity.success || !body.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    const result = await reviewCatalogEntity({ actorUserId: Number(session.user.id), entity: entity.data, id: route.id, ...body.data });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CATALOG_REVIEW_FAILED";
    return NextResponse.json({ error: code }, { status: statusByCode[code] ?? 500 });
  }
}
