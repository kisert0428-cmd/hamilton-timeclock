import { createHmac, createHash, randomBytes, randomInt } from "node:crypto";
import argon2 from "argon2";
export function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32)
    throw new Error("APP_SECRET must contain at least 32 characters");
  return s;
}
export const lookup = (pin: string) =>
  createHmac("sha256", secret()).update(pin).digest("hex");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const hash = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id });
export const verify = (encoded: string, value: string) =>
  argon2.verify(encoded, value);
export const token = () => randomBytes(32).toString("hex");
export async function newPin(db: any) {
  for (let i = 0; i < 100; i++) {
    const pin = String(randomInt(0, 10000)).padStart(4, "0");
    if (
      !(
        await db.query("SELECT id FROM employees WHERE pin_lookup=$1", [
          lookup(pin),
        ])
      ).rows.length
    )
      return {
        pin,
        pin_hash: await hash(pin + secret()),
        pin_lookup: lookup(pin),
      };
  }
  throw new Error("Unable to allocate PIN");
}
export async function rate(db: any, key: string, max: number) {
  const r = await db.query(
    `INSERT INTO rate_limits(key,attempts,expires_at) VALUES($1,1,clock_timestamp()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN rate_limits.expires_at<clock_timestamp() THEN 1 ELSE rate_limits.attempts+1 END,expires_at=CASE WHEN rate_limits.expires_at<clock_timestamp() THEN clock_timestamp()+interval '15 minutes' ELSE rate_limits.expires_at END RETURNING attempts`,
    [key],
  );
  if (r.rows[0].attempts > max)
    throw Object.assign(
      new Error("Too many attempts. Try again in 15 minutes."),
      { status: 429 },
    );
}
export type LocationResult = {
  status: string;
  distance: number | null;
  accuracy: number | null;
};
export function locationCheck(
  settings: any,
  coords: any,
  kiosk: boolean,
  now = Date.now(),
): LocationResult {
  if (kiosk) return { status: "trusted_kiosk", distance: null, accuracy: null };
  const unavailable = { status: "unavailable", distance: null, accuracy: null };
  if (
    settings.latitude === null ||
    settings.longitude === null ||
    !coords ||
    !Number.isFinite(coords.latitude) ||
    !Number.isFinite(coords.longitude) ||
    !Number.isFinite(coords.accuracy) ||
    coords.accuracy < 0 ||
    coords.accuracy > 40075000 ||
    Math.abs(coords.latitude) > 90 ||
    Math.abs(coords.longitude) > 180 ||
    !Number.isFinite(coords.timestamp) ||
    now - coords.timestamp > 120000 ||
    coords.timestamp - now > 10000
  )
    return unavailable;
  const rad = (x: number) => (x * Math.PI) / 180;
  const a =
    Math.sin(rad(coords.latitude - settings.latitude) / 2) ** 2 +
    Math.cos(rad(settings.latitude)) *
      Math.cos(rad(coords.latitude)) *
      Math.sin(rad(coords.longitude - settings.longitude) / 2) ** 2;
  const distance =
    6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  const accuracy = coords.accuracy;
  const poor =
    accuracy === 0 ||
    accuracy > Math.min(50, settings.radius_m / 2) ||
    (distance - accuracy <= settings.radius_m &&
      distance + accuracy > settings.radius_m);
  return {
    status: poor
      ? "poor_accuracy"
      : distance + accuracy <= settings.radius_m
        ? "verified"
        : "outside",
    distance: Math.round(distance / 10) * 10,
    accuracy: Math.ceil(accuracy),
  };
}
