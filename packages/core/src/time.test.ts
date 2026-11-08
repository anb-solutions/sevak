import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "./time";

describe("zonedTimeToUtc", () => {
  it("handles standard and daylight time", () => {
    expect(zonedTimeToUtc("2026-11-14", "08:30", "America/Chicago").toISOString()).toBe("2026-11-14T14:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-04", "08:30", "America/Chicago").toISOString()).toBe("2026-07-04T13:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-14", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-11-14T03:30:00.000Z");
  });
  it("rejects malformed input", () => {
    expect(() => zonedTimeToUtc("2026-11", "08:30", "UTC")).toThrow(RangeError);
  });
});
