import { describe, expect, it } from "vitest";

import {
  calendarDisconnectEpoch,
  isCalendarDisconnectOperation,
  isCurrentCalendarOAuthState,
  stableCalendarMetadata,
  stageCalendarDisconnect,
} from "./calendar-state";

describe("Google Calendar disconnect generation", () => {
  const now = new Date("2026-07-14T10:00:00Z");

  it("permanently invalidates states issued before a disconnect even after a network rollback", () => {
    const before = { customSetting: "kept", oauthDisconnectEpoch: 4 };
    const staged = stageCalendarDisconnect(before, "operation-a", now);

    expect(staged.disconnectEpoch).toBe(5);
    expect(isCalendarDisconnectOperation(staged.metadata, "operation-a")).toBe(true);
    expect(isCurrentCalendarOAuthState(staged.metadata, 4)).toBe(false);

    const afterNetworkFailure = stableCalendarMetadata(staged.metadata);
    expect(afterNetworkFailure).toEqual({ customSetting: "kept", oauthDisconnectEpoch: 5 });
    expect(isCurrentCalendarOAuthState(afterNetworkFailure, 4)).toBe(false);
    expect(isCurrentCalendarOAuthState(afterNetworkFailure, 5)).toBe(true);
  });

  it("reuses a staged operation after a crash instead of advancing its epoch again", () => {
    const first = stageCalendarDisconnect({}, "operation-a", now);
    const retried = stageCalendarDisconnect(
      first.metadata,
      "operation-b",
      new Date("2026-07-14T10:05:00Z"),
    );

    expect(retried.operationId).toBe("operation-a");
    expect(retried.disconnectEpoch).toBe(1);
    expect(retried.metadata).toEqual(first.metadata);
    expect(calendarDisconnectEpoch(retried.metadata)).toBe(1);
  });

  it("normalizes malformed persisted epoch values without accepting them", () => {
    expect(calendarDisconnectEpoch({ oauthDisconnectEpoch: -1 })).toBe(0);
    expect(calendarDisconnectEpoch({ oauthDisconnectEpoch: 1.5 })).toBe(0);
    expect(calendarDisconnectEpoch({ oauthDisconnectEpoch: "2" })).toBe(0);
  });
});
