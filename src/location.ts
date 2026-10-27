/** A single reading, called only by the punch action (or its accuracy retry). */
export async function readPunchLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
} | null> {
  try {
    return await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            timestamp: p.timestamp,
          }),
        reject,
        { timeout: 12000, maximumAge: 0, enableHighAccuracy: true },
      ),
    );
  } catch {
    return null;
  }
}
export const locationLabels: Record<string, string> = {
  verified: "Verified at Warehouse",
  trusted_kiosk: "Trusted Warehouse Kiosk",
  outside: "Outside Geofence — Review Required",
  unavailable: "GPS Unavailable — Review Required",
  unverified: "GPS Unavailable — Review Required",
  poor_accuracy: "Poor GPS Accuracy — Review Required",
  not_required: "Legacy punch — location not checked",
};
