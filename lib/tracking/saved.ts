import { trackingSchema, type Tracking } from "./schemas";

const KEY = "tracking:saved:v1";
const MAX_SAVED = 5;

export type SavedTracking = { number: string; savedAt: string; tracking: Tracking };

/**
 * The last few lookups, kept in this browser only so a shipment can still be read without a connection.
 * Holds just the public tracking fields. Storage can be missing, full or tampered with, so every access is guarded.
 */
export function readSaved(): SavedTracking[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];

    return raw.flatMap((entry) => {
      const tracking = trackingSchema.safeParse(entry?.tracking);

      return tracking.success && typeof entry.number === "string" && typeof entry.savedAt === "string"
        ? [{ number: entry.number, savedAt: entry.savedAt, tracking: tracking.data }]
        : [];
    });
  } catch {
    return [];
  }
}

export function readSavedFor(number: string): SavedTracking | null {
  return readSaved().find((entry) => entry.number === number) ?? null;
}

export function saveTracking(number: string, tracking: Tracking, now: Date = new Date()): void {
  try {
    const others = readSaved().filter((entry) => entry.number !== number);
    const next: SavedTracking[] = [{ number, savedAt: now.toISOString(), tracking }, ...others].slice(0, MAX_SAVED);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable or full: the live result still shows, it just is not kept */
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
