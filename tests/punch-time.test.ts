import { describe, it, expect } from "vitest";
import {
  parsePunchTime,
  resolvePunchTime,
  punchTimeFields,
  punchTimeChoices,
  correctionTimePayload,
} from "../shared/punch-time.js";
describe("AM/PM correction entry", () => {
  it.each([
    ["09:00 AM", 9, 0],
    ["6:07 PM", 18, 7],
    ["12:00 AM", 0, 0],
    ["12:00 PM", 12, 0],
    [" 6:07 pm ", 18, 7],
    ["06:07PM", 18, 7],
  ])("accepts %s without requiring a timestamp", (time, hour, minute) =>
    expect(parsePunchTime(time)).toEqual({ hour, minute }),
  );
  it.each([
    "9:60 AM",
    "13:00 PM",
    "00:00 AM",
    "18:07",
    "6:7 PM",
    "6:07 PM extra",
    "",
  ])("rejects invalid entry %s", (time) =>
    expect(() => parsePunchTime(time)).toThrow("Enter a time"),
  );
  it("resolves New York summer and winter time independently of the host timezone", () => {
    expect(resolvePunchTime({ date: "2026-10-26", time: "09:00 AM" })).toBe(
      "2026-10-26T13:00:00.000Z",
    );
    expect(resolvePunchTime({ date: "2026-10-26", time: "6:07 PM" })).toBe(
      "2026-10-26T22:07:00.000Z",
    );
    expect(resolvePunchTime({ date: "2026-01-05", time: "09:00 AM" })).toBe(
      "2026-01-05T14:00:00.000Z",
    );
  });
  it("handles local midnight and noon on the selected day", () => {
    expect(resolvePunchTime({ date: "2026-10-26", time: "12:00 AM" })).toBe(
      "2026-10-26T04:00:00.000Z",
    );
    expect(resolvePunchTime({ date: "2026-10-26", time: "12:00 PM" })).toBe(
      "2026-10-26T16:00:00.000Z",
    );
  });
  it("rejects invalid dates and nonexistent spring-transition times rather than shifting them", () => {
    expect(() =>
      resolvePunchTime({ date: "2026-02-30", time: "09:00 AM" }),
    ).toThrow("valid punch date");
    expect(() =>
      resolvePunchTime({ date: "2026-03-08", time: "02:30 AM" }),
    ).toThrow("does not exist");
  });
  it("requires a choice for the repeated fall hour and resolves both occurrences correctly", () => {
    const fields = { date: "2026-11-01", time: "01:30 AM" };
    expect(punchTimeChoices(fields.date, fields.time)).toHaveLength(2);
    expect(() => resolvePunchTime(fields)).toThrow("occurs twice");
    expect(resolvePunchTime({ ...fields, occurrence: "earlier" })).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(resolvePunchTime({ ...fields, occurrence: "later" })).toBe(
      "2026-11-01T06:30:00.000Z",
    );
  });
  it("prefills existing records in New York and keeps their exact seconds when unchanged", () => {
    const original = "2026-10-26T22:07:42.871Z";
    expect(punchTimeFields(original)).toEqual({
      date: "2026-10-26",
      time: "06:07 PM",
    });
    expect(
      correctionTimePayload(original, { date: "2026-10-26", time: "6:07 pm" }),
    ).toEqual({ at: original });
    const changed = { date: "2026-10-26", time: "6:08 PM" };
    expect(correctionTimePayload(original, changed)).toEqual(changed);
  });
  it("preserves the selected occurrence and seconds of existing fall-transition punches", () => {
    const original = "2026-11-01T06:30:27.123Z";
    const fields = punchTimeFields(original);
    expect(fields).toEqual({
      date: "2026-11-01",
      time: "01:30 AM",
      occurrence: "later",
    });
    expect(correctionTimePayload(original, fields)).toEqual({ at: original });
    expect(
      correctionTimePayload(original, { ...fields, occurrence: "earlier" }),
    ).not.toHaveProperty("at");
  });
});
