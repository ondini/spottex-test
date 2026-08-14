import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { EnergyError } from "./types";
import type { EnergyErrorDetail } from "./types";

/**
 * Anything that looks like a credential is stripped before a detail leaves the
 * server, even though callers are expected to pass only static upstream
 * messages. An e-mail address or a long opaque token in a user-facing error
 * body would leak a SolaX login or a discovery handle.
 */
export function sanitizeUpstreamMessage(message: string): string | undefined {
  const scrubbed = message
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[skryto]")
    .replace(/[A-Za-z0-9_-]{20,}/g, "[skryto]")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed ? scrubbed.slice(0, 200) : undefined;
}

function publicDetail(detail: EnergyErrorDetail): EnergyErrorDetail {
  const upstreamMessage = detail.upstreamMessage
    ? sanitizeUpstreamMessage(detail.upstreamMessage)
    : undefined;
  return {
    stage: detail.stage,
    ...(detail.upstreamStatus ? { upstreamStatus: detail.upstreamStatus } : {}),
    ...(upstreamMessage ? { upstreamMessage } : {}),
  };
}

/**
 * Short code printed in the API response, the server log, and the audit row, so
 * a user can quote it and an administrator can find the exact failure.
 */
export function newDiagnosticReference(): string {
  return `EN-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function energyErrorResponse(
  error: unknown,
  options?: { reference?: string },
): NextResponse {
  const reference = options?.reference ?? newDiagnosticReference();
  if (error instanceof EnergyError) {
    const detail = error.detail ? publicDetail(error.detail) : undefined;
    // Server-side record keeps the untruncated detail; the response keeps the
    // sanitized one. Both carry the same reference.
    console.error(
      `ENERGY_OPERATION_FAILED ${reference} code=${error.code} status=${error.status}`,
      { stage: error.detail?.stage, upstreamStatus: error.detail?.upstreamStatus, upstreamMessage: error.detail?.upstreamMessage },
    );
    return NextResponse.json(
      { error: error.message, code: error.code, reference, ...(detail ? { detail } : {}) },
      { status: error.status },
    );
  }
  console.error(`ENERGY_OPERATION_FAILED ${reference} code=INTERNAL_ERROR`, error);
  return NextResponse.json(
    { error: "Energetickou operaci se nepodařilo dokončit.", code: "INTERNAL_ERROR", reference },
    { status: 500 },
  );
}

export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
