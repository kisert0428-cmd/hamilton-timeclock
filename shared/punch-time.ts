import { DateTime } from "luxon";
export const PUNCH_ZONE = "America/New_York";
export type Occurrence = "earlier" | "later";
export type PunchTimeFields = {
  date: string;
  time: string;
  occurrence?: Occurrence;
};
export function parsePunchTime(value: string) {
  const match = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(value.trim());
  if (!match) throw new Error("Enter a time like 09:00 AM or 6:07 PM.");
  const hour =
      (Number(match[1]) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0),
    minute = Number(match[2]);
  return { hour, minute };
}
export function punchTimeChoices(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Choose a valid punch date.");
  const day = DateTime.fromISO(date, { zone: PUNCH_ZONE });
  if (!day.isValid || day.toISODate() !== date)
    throw new Error("Choose a valid punch date.");
  const { hour, minute } = parsePunchTime(time);
  const local = DateTime.fromObject(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour,
      minute,
      second: 0,
      millisecond: 0,
    },
    { zone: PUNCH_ZONE },
  );
  if (
    !local.isValid ||
    local.toISODate() !== date ||
    local.hour !== hour ||
    local.minute !== minute
  )
    throw new Error(
      "This time does not exist in New York because the clocks move forward. Choose another time.",
    );
  return local
    .getPossibleOffsets()
    .sort((a, b) => a.toMillis() - b.toMillis())
    .map((dt, i) => ({
      at: dt.toUTC().toISO()!,
      offset: dt.offset,
      occurrence: (i === 0 ? "earlier" : "later") as Occurrence,
      label: `${i === 0 ? "First" : "Second"} occurrence (${dt.offsetNameShort}, UTC${dt.toFormat("ZZ")})`,
    }));
}
export function resolvePunchTime(fields: PunchTimeFields) {
  const choices = punchTimeChoices(fields.date, fields.time);
  if (choices.length > 1 && !fields.occurrence)
    throw new Error(
      "This time occurs twice in New York when the clocks move back. Choose the first or second occurrence.",
    );
  return choices[choices.length > 1 && fields.occurrence === "later" ? 1 : 0]
    .at;
}
export function punchTimeFields(at: string | Date): PunchTimeFields {
  const dt = DateTime.fromJSDate(new Date(at), { zone: PUNCH_ZONE }).setLocale(
    "en-US",
  );
  if (!dt.isValid) throw new Error("Invalid recorded punch time.");
  const fields: PunchTimeFields = {
    date: dt.toISODate()!,
    time: dt.toFormat("hh:mm a"),
  };
  const choices = punchTimeChoices(fields.date, fields.time);
  if (choices.length > 1)
    fields.occurrence = choices.find((c) => c.offset === dt.offset)!.occurrence;
  return fields;
}
/** Leaving the displayed minute unchanged must not round away recorded seconds. */
export function correctionTimePayload(
  originalAt: string | undefined,
  fields: PunchTimeFields,
): { at: string } | PunchTimeFields {
  const resolved = resolvePunchTime(fields);
  if (originalAt) {
    const originalFields = punchTimeFields(originalAt);
    if (resolved === resolvePunchTime(originalFields))
      return { at: originalAt };
  }
  return fields;
}
