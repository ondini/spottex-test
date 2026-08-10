import { NextResponse } from "next/server";

import { EnergyError } from "./types";

export function energyErrorResponse(error: unknown): NextResponse {
  if (error instanceof EnergyError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "Energetickou operaci se nepodařilo dokončit.", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
