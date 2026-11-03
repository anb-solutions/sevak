// Time zone helpers. Shift times are stored in UTC and shown in the event's
// own time zone (NFR-11).

// The offset of `timeZone` from UTC at the instant `utcMs`, in milliseconds.
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// The UTC instant for a wall-clock `date` ("2026-11-14") and `time` ("08:30")
// in `timeZone`, handling daylight saving changes.
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new RangeError(`Invalid date or time: ${date} ${time}`);
  }
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  const second = offsetMs(utc, timeZone);
  if (wallAsUtc - second !== utc) utc = wallAsUtc - second;
  return new Date(utc);
}
