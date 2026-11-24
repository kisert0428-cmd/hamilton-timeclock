import { describe, it, expect } from "vitest";
import { analyze, type LunchPolicy, type Punch } from "../server/time.js";
const policy: LunchPolicy = {
  id: "policy",
  enabled: true,
  effective_at: "2026-01-01T00:00:00Z",
  deduction_minutes: 30,
  minimum_shift_minutes: 360,
};
const ps = (...entries: string[]): Punch[] =>
  entries.map((e, i) => {
    const [type, at] = e.split("|");
    return { id: String(i), employee_id: "test", type, at };
  });
const run = (
  p: Punch[],
  date = "2026-11-23",
  policies = [policy],
  exceptions: any[] = [],
) =>
  analyze(
    p,
    date,
    1,
    new Date("2026-11-24T23:00:00Z").getTime(),
    policies,
    exceptions,
  );
describe("automatic 30-minute lunch", () => {
  it("deducts 30 minutes once on an eligible completed shift, without inventing punch records", () => {
    const p = ps("in|2026-11-23T14:00:00Z", "out|2026-11-23T22:00:00Z");
    const r = run(p);
    expect(r.total).toBe(7.5);
    expect(r.automaticLunch).toBe(0.5);
    expect(r.lunch).toBe(0.5);
    expect(r.recordedLunch).toBe(0);
    expect(r.shifts[0].punches).toEqual(p);
  });
  it("uses an exact inclusive six-hour elapsed threshold with no punch rounding", () => {
    const start = "in|2026-11-23T14:00:00Z";
    expect(run(ps(start, "out|2026-11-23T19:59:59.999Z")).automaticLunch).toBe(
      0,
    );
    expect(run(ps(start, "out|2026-11-23T20:00:00Z")).total).toBe(5.5);
  });
  it.each([
    [0, 0.5, 7.5],
    [10, 1 / 3, 7.5],
    [20, 1 / 6, 7.5],
    [30, 0, 7.5],
    [45, 0, 7.25],
  ])(
    "tops up a recorded %i minute lunch, never double-deducting",
    (minutes, auto, total) => {
      const p =
        minutes === 0
          ? ps("in|2026-11-23T14:00:00Z", "out|2026-11-23T22:00:00Z")
          : ps(
              "in|2026-11-23T14:00:00Z",
              "lunch_out|2026-11-23T17:00:00Z",
              `lunch_in|2026-11-23T17:${String(minutes).padStart(2, "0")}:00Z`,
              "out|2026-11-23T22:00:00Z",
            );
      const r = run(p);
      expect(r.automaticLunch).toBeCloseTo(auto, 10);
      expect(r.total).toBe(total);
    },
  );
  it("counts multiple recorded lunch intervals toward the same 30-minute total", () => {
    const r = run(
      ps(
        "in|2026-11-23T14:00:00Z",
        "lunch_out|2026-11-23T17:00:00Z",
        "lunch_in|2026-11-23T17:10:00Z",
        "lunch_out|2026-11-23T19:00:00Z",
        "lunch_in|2026-11-23T19:10:00Z",
        "out|2026-11-23T22:00:00Z",
      ),
    );
    expect(r.total).toBe(7.5);
    expect(r.automaticLunch).toBeCloseTo(1 / 6);
    expect(r.recordedLunch).toBeCloseTo(1 / 3);
  });
  it("does not deduct automatically from open shifts or incomplete lunches", () => {
    for (const p of [
      ps("in|2026-11-23T14:00:00Z"),
      ps("in|2026-11-23T14:00:00Z", "lunch_out|2026-11-23T21:00:00Z"),
    ]) {
      const r = run(p);
      expect(r.automaticLunch).toBe(0);
      expect(r.flags).toContain("Incomplete shift — manager review required");
    }
  });
  it("bases eligibility on total shift length including the recorded lunch", () => {
    const r = run(
      ps(
        "in|2026-11-23T14:00:00Z",
        "lunch_out|2026-11-23T17:00:00Z",
        "lunch_in|2026-11-23T17:20:00Z",
        "out|2026-11-23T20:00:00Z",
      ),
    );
    expect(r.total).toBe(5.5);
    expect(r.automaticLunch).toBeCloseTo(1 / 6);
  });
  it("does not combine two short split shifts into an eligible shift", () => {
    const r = run(
      ps(
        "in|2026-11-23T13:00:00Z",
        "out|2026-11-23T17:00:00Z",
        "in|2026-11-23T18:00:00Z",
        "out|2026-11-23T22:00:00Z",
      ),
    );
    expect(r.total).toBe(8);
    expect(r.automaticLunch).toBe(0);
  });
  it("calculates regular/overtime from payable time after deductions", () => {
    const p: Punch[] = [];
    for (let d = 23; d <= 27; d++)
      p.push(...ps(`in|2026-11-${d}T13:00:00Z`, `out|2026-11-${d}T22:00:00Z`));
    const r = run(p);
    expect(r.total).toBe(42.5);
    expect(r.regular).toBe(40);
    expect(r.overtime).toBe(2.5);
    expect(r.automaticLunch).toBe(2.5);
  });
  it("allocates an overnight week-crossing deduction only against actual worked segments", () => {
    const p = ps("in|2026-11-23T04:00:00Z", "out|2026-11-23T10:00:00Z");
    const previous = run(p, "2026-11-16"),
      current = run(p);
    expect(previous.total).toBe(1);
    expect(previous.automaticLunch).toBe(0);
    expect(current.total).toBe(4.5);
    expect(current.automaticLunch).toBe(0.5);
    expect(previous.total + current.total).toBe(5.5);
  });
  it("can split the adjustment across midnight without negative daily hours", () => {
    const p = ps("in|2026-11-23T23:10:00Z", "out|2026-11-24T05:10:00Z");
    const r = run(p);
    expect(r.days[0].seconds / 3600).toBe(5.5);
    expect(r.days[1].seconds).toBe(0);
    expect(r.days[0].autoLunch).toBe(1200);
    expect(r.days[1].autoLunch).toBe(600);
  });
  it("uses actual elapsed hours across daylight saving changes", () => {
    const p = ps(
      "in|2026-11-01T00:00:00-04:00",
      "out|2026-11-01T05:00:00-05:00",
    );
    const r = run(p, "2026-10-26");
    expect(r.total).toBe(5.5);
    expect(r.automaticLunch).toBe(0.5);
    const spring = run(
      ps("in|2026-03-08T00:00:00-05:00", "out|2026-03-08T06:00:00-04:00"),
      "2026-03-02",
    );
    expect(spring.total).toBe(5);
    expect(spring.automaticLunch).toBe(0);
  });
  it("retains prior policies and exempts shifts starting before activation", () => {
    const p = ps("in|2026-11-23T14:00:00Z", "out|2026-11-23T22:00:00Z");
    expect(
      run(p, "2026-11-23", [
        { ...policy, effective_at: "2026-11-23T15:00:00Z" },
      ]).total,
    ).toBe(8);
    const disabled = {
      ...policy,
      id: "disabled",
      enabled: false,
      effective_at: "2026-11-24T00:00:00Z",
    };
    expect(run(p, "2026-11-23", [policy, disabled]).total).toBe(7.5);
    expect(
      run(
        ps("in|2026-11-24T14:00:00Z", "out|2026-11-24T22:00:00Z"),
        "2026-11-23",
        [policy, disabled],
      ).total,
    ).toBe(8);
  });
  it("supports a manager waiver and restoration without changing recorded lunches", () => {
    const p = ps(
      "in|2026-11-23T14:00:00Z",
      "lunch_out|2026-11-23T17:00:00Z",
      "lunch_in|2026-11-23T17:10:00Z",
      "out|2026-11-23T22:00:00Z",
    );
    const waived = { clock_in_id: "0", waived: true };
    expect(run(p, "2026-11-23", [policy], [waived]).total).toBeCloseTo(
      7 + 50 / 60,
    );
    expect(run(p, "2026-11-23", [policy], [waived]).recordedLunch).toBeCloseTo(
      1 / 6,
    );
    expect(
      run(p, "2026-11-23", [policy], [waived, { ...waived, waived: false }])
        .total,
    ).toBe(7.5);
  });
});
