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
export function analyze(
  punches: Punch[],
  date: string,
  start = 1,
  now = Date.now(),
) {
  const { from, to } = weekBounds(date, start);
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: from.plus({ days: i }).toISODate()!,
    seconds: 0,
    lunch: 0,
  }));
  let shift: Punch[] = [];
  const shifts: any[] = [];
  let state = "out";
  let lastWork: number | null = null;
  let lastLunch: number | null = null;
  let clockIn: number | null = null;
  let todaySeconds = 0;
  const today = DateTime.fromMillis(now, { zone: ZONE }).startOf("day");
  function allocate(a: number, b: number, kind: "seconds" | "lunch") {
    for (const day of days) {
      const lo = DateTime.fromISO(day.date, { zone: ZONE }).toMillis(),
        hi = DateTime.fromISO(day.date, { zone: ZONE })
          .plus({ days: 1 })
          .toMillis();
      day[kind] += Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / 1000;
    }
    if (kind === "seconds")
      todaySeconds +=
        Math.max(0, Math.min(b, now) - Math.max(a, today.toMillis())) / 1000;
  }
  for (const p of [...punches].sort((a, b) => instant(a.at) - instant(b.at))) {
    const t = instant(p.at);
    if (p.type === "in") {
      shift = [p];
      clockIn = t;
      lastWork = t;
      state = "in";
    } else {
      shift.push(p);
      if (p.type === "lunch_out") {
        if (lastWork !== null) allocate(lastWork, t, "seconds");
        lastWork = null;
        lastLunch = t;
        state = "lunch";
      }
      if (p.type === "lunch_in") {
        if (lastLunch !== null) allocate(lastLunch, t, "lunch");
        lastLunch = null;
        lastWork = t;
        state = "in";
      }
      if (p.type === "out") {
        if (lastWork !== null) allocate(lastWork, t, "seconds");
        lastWork = null;
        state = "out";
        shifts.push({ punches: shift, open: false });
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
    lunch: days.reduce((n, d) => n + d.lunch, 0) / 3600,
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
