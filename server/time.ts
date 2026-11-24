import { DateTime } from "luxon";
export const ZONE = "America/New_York";
export const labels: Record<string, string> = {
  in: "Clock in",
  lunch_out: "Start lunch",
  lunch_in: "End lunch",
  out: "Clock out",
};
export type Punch = {
  id: string;
  employee_id: string;
  type: string;
  at: string | Date;
  location_check?: string;
  review_decision?: string;
};
export function validSequence(punches: Punch[]) {
  let state = "out";
  for (const p of punches) {
    if (state === "out" && p.type === "in") state = "in";
    else if (state === "in" && p.type === "lunch_out") state = "lunch";
    else if (state === "lunch" && p.type === "lunch_in") state = "in";
    else if (state === "in" && p.type === "out") state = "out";
    else return false;
  }
  return true;
}
export const instant = (at: string | Date) => new Date(at).getTime();
export function weekBounds(date: string, start = 1) {
  const d = DateTime.fromISO(date, { zone: ZONE });
  if (!d.isValid) throw new Error("Invalid week");
  const from = d.startOf("day").minus({ days: (d.weekday - start + 7) % 7 });
  return { from, to: from.plus({ days: 7 }) };
}
export type LunchPolicy = {
  id: string;
  enabled: boolean;
  effective_at: string | Date;
  deduction_minutes: number;
  minimum_shift_minutes: number;
};
export type LunchException = { clock_in_id: string; waived: boolean };
export function analyze(
  punches: Punch[],
  date: string,
  start = 1,
  now = Date.now(),
  lunchPolicies: LunchPolicy[] = [],
  lunchExceptions: LunchException[] = [],
) {
  const { from, to } = weekBounds(date, start);
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: from.plus({ days: i }).toISODate()!,
    seconds: 0,
    lunch: 0,
    autoLunch: 0,
  }));
  let shift: Punch[] = [];
  const shifts: any[] = [];
  let state = "out";
  let lastWork: number | null = null;
  let lastLunch: number | null = null;
  let clockIn: number | null = null;
  let todaySeconds = 0;
  let workSegments: [number, number][] = [];
  let recordedLunchSeconds = 0;
  const exceptions = new Map(
    lunchExceptions.map((e) => [e.clock_in_id, e.waived]),
  );
  const today = DateTime.fromMillis(now, { zone: ZONE }).startOf("day");
  function allocate(
    a: number,
    b: number,
    kind: "seconds" | "lunch" | "autoLunch",
  ) {
    for (const day of days) {
      const lo = DateTime.fromISO(day.date, { zone: ZONE }).toMillis(),
        hi = DateTime.fromISO(day.date, { zone: ZONE })
          .plus({ days: 1 })
          .toMillis();
      const seconds = Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / 1000;
      day[kind] += seconds;
      if (kind === "autoLunch") day.seconds -= seconds;
    }
    if (kind === "seconds" || kind === "autoLunch")
      todaySeconds +=
        ((kind === "autoLunch" ? -1 : 1) *
          Math.max(0, Math.min(b, now) - Math.max(a, today.toMillis()))) /
        1000;
  }
  for (const p of [...punches].sort((a, b) => instant(a.at) - instant(b.at))) {
    const t = instant(p.at);
    if (p.type === "in") {
      shift = [p];
      workSegments = [];
      recordedLunchSeconds = 0;
      clockIn = t;
      lastWork = t;
      state = "in";
    } else {
      shift.push(p);
      if (p.type === "lunch_out") {
        if (lastWork !== null) {
          allocate(lastWork, t, "seconds");
          workSegments.push([lastWork, t]);
        }
        lastWork = null;
        lastLunch = t;
        state = "lunch";
      }
      if (p.type === "lunch_in") {
        if (lastLunch !== null) {
          allocate(lastLunch, t, "lunch");
          recordedLunchSeconds += (t - lastLunch) / 1000;
        }
        lastLunch = null;
        lastWork = t;
        state = "in";
      }
      if (p.type === "out") {
        if (lastWork !== null) {
          allocate(lastWork, t, "seconds");
          workSegments.push([lastWork, t]);
        }
        lastWork = null;
        state = "out";
        const policy = [...lunchPolicies]
          .reverse()
          .find((l) => instant(l.effective_at) <= clockIn!);
        const elapsedSeconds = (t - clockIn!) / 1000;
        const eligible =
          !!policy?.enabled &&
          elapsedSeconds >= policy.minimum_shift_minutes * 60;
        const scheduledAutomaticLunchSeconds = eligible
          ? Math.min(
              workSegments.reduce((n, [a, b]) => n + (b - a) / 1000, 0),
              Math.max(0, policy.deduction_minutes * 60 - recordedLunchSeconds),
            )
          : 0;
        const lunchWaived = exceptions.get(shift[0].id) === true;
        const automaticLunchSeconds = lunchWaived
          ? 0
          : scheduledAutomaticLunchSeconds;
        let remaining = automaticLunchSeconds;
        // Allocate the adjustment against the final recorded work intervals, including week/midnight splits.
        for (const [a, b] of [...workSegments].reverse()) {
          if (remaining <= 0) break;
          const seconds = Math.min(remaining, (b - a) / 1000);
          allocate(b - seconds * 1000, b, "autoLunch");
          remaining -= seconds;
        }
        shifts.push({
          punches: shift,
          open: false,
          elapsedSeconds,
          recordedLunchSeconds,
          scheduledAutomaticLunchSeconds,
          automaticLunchSeconds,
          lunchWaived,
          lunchPolicyId: policy?.id || null,
        });
        shift = [];
        clockIn = null;
      }
    }
  }
  if (shift.length) shifts.push({ punches: shift, open: true });
  // Open work/lunch segments are shown live only; payroll contains recorded intervals only.
  const liveToday =
    todaySeconds +
    (lastWork !== null
      ? Math.max(0, now - Math.max(lastWork, today.toMillis())) / 1000
      : 0);
  const total = days.reduce((n, d) => n + d.seconds, 0) / 3600;
  return {
    days,
    total,
    regular: Math.min(40, total),
    overtime: Math.max(0, total - 40),
    lunch: days.reduce((n, d) => n + d.lunch + d.autoLunch, 0) / 3600,
    recordedLunch: days.reduce((n, d) => n + d.lunch, 0) / 3600,
    automaticLunch: days.reduce((n, d) => n + d.autoLunch, 0) / 3600,
    state,
    clockIn,
    todayHours: liveToday / 3600,
    shifts,
    flags: shifts
      .filter(
        (s) =>
          s.open ||
          s.punches.some(
            (p: Punch) =>
              [
                "unverified",
                "outside",
                "unavailable",
                "poor_accuracy",
              ].includes(p.location_check || "") &&
              p.review_decision !== "approved",
          ),
      )
      .filter(
        (s) =>
          s.open ||
          s.punches.some(
            (p: Punch) =>
              instant(p.at) >= from.toMillis() && instant(p.at) < to.toMillis(),
          ),
      )
      .map((s) =>
        s.open
          ? "Incomplete shift — manager review required"
          : "Location requires review",
      ),
  };
}
