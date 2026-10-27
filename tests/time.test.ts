import { describe, it, expect } from "vitest";
import { analyze, validSequence, weekBounds } from "../server/time.js";
const punches = (...entries: string[]) =>
  entries.map((v, i) => {
    const [type, at] = v.split("|");
    return { id: String(i), employee_id: "1", type, at };
  });
describe("payroll calculations", () => {
  it("normal workday uses exact timestamps", () => {
    const r = analyze(
      punches("in|2026-10-26T12:00:01Z", "out|2026-10-26T20:00:03Z"),
      "2026-10-26",
    );
    expect(r.total).toBeCloseTo(8 + 2 / 3600, 9);
    expect(r.overtime).toBe(0);
  });
  it("subtracts only actual recorded lunch intervals including multiple breaks", () => {
    const r = analyze(
      punches(
        "in|2026-10-26T12:00:00Z",
        "lunch_out|2026-10-26T16:00:00Z",
        "lunch_in|2026-10-26T16:30:00Z",
        "lunch_out|2026-10-26T18:00:00Z",
        "lunch_in|2026-10-26T18:15:00Z",
        "out|2026-10-26T21:00:00Z",
      ),
      "2026-10-26",
    );
    expect(r.total).toBe(8.25);
    expect(r.lunch).toBe(0.75);
  });
  it("rejects duplicates and invalid sequence", () => {
    expect(validSequence(punches("in|2026-01-01", "in|2026-01-02"))).toBe(
      false,
    );
    expect(validSequence(punches("lunch_in|2026-01-01"))).toBe(false);
    expect(
      validSequence(
        punches("in|2026-01-01", "lunch_out|2026-01-02", "out|2026-01-03"),
      ),
    ).toBe(false);
  });
  it("splits overnight work into local days", () => {
    const r = analyze(
      punches("in|2026-10-27T02:00:00Z", "out|2026-10-27T10:00:00Z"),
      "2026-10-26",
    );
    expect(r.days[0].seconds / 3600).toBe(2);
    expect(r.days[1].seconds / 3600).toBe(6);
  });
  it("splits workweek crossing shifts and allocates overtime after 40", () => {
    const p = [];
    for (let i = 26; i <= 30; i++)
      p.push(
        ...punches(`in|2026-10-${i}T12:00:00Z`, `out|2026-10-${i}T21:00:00Z`),
      );
    const r = analyze(p, "2026-10-26");
    expect(r.regular).toBe(40);
    expect(r.overtime).toBe(5);
    expect(r.total).toBe(45);
    const cross = punches(
      "in|2026-10-26T02:00:00Z",
      "out|2026-10-26T10:00:00Z",
    );
    expect(analyze(cross, "2026-10-26").total).toBe(6);
    expect(analyze(cross, "2026-10-19").total).toBe(2);
  });
  it("flags missing punches and never invents an end time", () => {
    const r = analyze(
      punches("in|2026-10-26T12:00:00Z"),
      "2026-10-26",
      1,
      new Date("2026-10-26T20:00:00Z").getTime(),
    );
    expect(r.total).toBe(0);
    expect(r.todayHours).toBe(8);
    expect(r.flags).toContain("Incomplete shift — manager review required");
    expect(r.state).toBe("in");
  });
  it("handles spring and fall daylight saving transitions using actual elapsed time", () => {
    expect(
      analyze(
        punches(
          "in|2026-03-08T00:00:00-05:00",
          "out|2026-03-08T08:00:00-04:00",
        ),
        "2026-03-02",
      ).total,
    ).toBe(7);
    expect(
      analyze(
        punches(
          "in|2026-11-01T00:00:00-04:00",
          "out|2026-11-01T08:00:00-05:00",
        ),
        "2026-10-26",
      ).total,
    ).toBe(9);
  });
  it("configures week boundaries independently of host time zone", () => {
    expect(weekBounds("2026-10-28", 7).from.toISODate()).toBe("2026-10-25");
    expect(
      weekBounds("2026-11-01", 1).to.diff(
        weekBounds("2026-11-01", 1).from,
        "hours",
      ).hours,
    ).toBe(169);
  });
});
