import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db, emails, events, roles, shifts, signups, users } from "@sevak/db";
import { cancelSignup, publicEvent, signUp, SignUpError } from "./signup";
import { FLUTE_MALI, seedBetaEvent } from "./seed";
import { hashToken } from "./tokens";

let db: Db;
let eventId: string;
let shiftIds: string[]; // in start-time order
const BEFORE_EVENT = new Date("2026-11-10T12:00:00Z");

async function setCapacity(shiftId: string, capacity: number) {
  await db.update(shifts).set({ capacity }).where(eq(shifts.id, shiftId));
}

function volunteer(n: number, picks: string[]) {
  return { eventId, shiftIds: picks, firstName: `Vol${n}`, email: `vol${n}@example.com` };
}

beforeEach(async () => {
  db = await createMemoryDb();
  eventId = await seedBetaEvent(db);
  const rows = await db.select().from(shifts).where(eq(shifts.eventId, eventId));
  shiftIds = rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map((s) => s.id);
});

describe("seed", () => {
  it("loads the event with Zeffy's exact wording and shifts in Central time", async () => {
    const event = await publicEvent(db, FLUTE_MALI.slug);
    expect(event?.title).toBe("Flute Mali Centenary Celebration");
    expect(event?.description).toBe(FLUTE_MALI.description);
    const setup = event!.roles.find((r) => r.name === "Setup crew")!;
    // 8:30 AM CST on Nov 14, 2026 is 14:30 UTC (daylight saving ended Nov 1).
    expect(setup.shifts[0]!.startsAt).toBe("2026-11-14T14:30:00.000Z");
    expect(event!.roles).toHaveLength(6);
  });

  it("is safe to run twice", async () => {
    expect(await seedBetaEvent(db)).toBe(eventId);
    expect(await db.select().from(roles)).toHaveLength(6);
  });
});

describe("signUp", () => {
  it("takes a spot on each shift, stores only a hash of the manage token, and queues an email", async () => {
    const result = await signUp(db, volunteer(1, shiftIds.slice(0, 2)), BEFORE_EVENT);
    expect(result.signupIds).toHaveLength(2);
    const event = await publicEvent(db, FLUTE_MALI.slug);
    const left = event!.roles.flatMap((r) => r.shifts).filter((s) => shiftIds.slice(0, 2).includes(s.id));
    expect(left.every((s) => s.spotsLeft === s.capacity - 1)).toBe(true);
    const [reg] = await db.query.registrations.findMany();
    expect(reg!.manageTokenHash).toBe(hashToken(result.manageToken));
    expect(reg!.manageTokenHash).not.toBe(result.manageToken);
    expect(await db.select().from(emails)).toHaveLength(1);
  });

  it("never overbooks: the person after the last spot is refused", async () => {
    await setCapacity(shiftIds[0]!, 2);
    await signUp(db, volunteer(1, [shiftIds[0]!]), BEFORE_EVENT);
    await signUp(db, volunteer(2, [shiftIds[0]!]), BEFORE_EVENT);
    await expect(signUp(db, volunteer(3, [shiftIds[0]!]), BEFORE_EVENT)).rejects.toMatchObject({ code: "shift_full" });
    const [s] = await db.select().from(shifts).where(eq(shifts.id, shiftIds[0]!));
    expect(s!.filled).toBe(2);
  });

  it("rolls back every shift when one of several is full", async () => {
    await setCapacity(shiftIds[1]!, 1);
    await signUp(db, volunteer(1, [shiftIds[1]!]), BEFORE_EVENT);
    await expect(signUp(db, volunteer(2, [shiftIds[0]!, shiftIds[1]!]), BEFORE_EVENT)).rejects.toBeInstanceOf(SignUpError);
    const [first] = await db.select().from(shifts).where(eq(shifts.id, shiftIds[0]!));
    expect(first!.filled).toBe(0); // the spot taken on the first shift was given back
    expect(await db.select().from(users).where(eq(users.email, "vol2@example.com"))).toHaveLength(0);
    expect(await db.select().from(emails)).toHaveLength(1); // only volunteer 1's email
  });

  it("skips shifts the person already holds, and refuses a repeat of only those", async () => {
    await signUp(db, volunteer(1, [shiftIds[0]!]), BEFORE_EVENT);
    const again = await signUp(db, volunteer(1, [shiftIds[0]!, shiftIds[2]!]), BEFORE_EVENT);
    expect(again.skippedShiftIds).toEqual([shiftIds[0]]);
    expect(again.signupIds).toHaveLength(1);
    await expect(signUp(db, volunteer(1, [shiftIds[0]!]), BEFORE_EVENT)).rejects.toMatchObject({ code: "already_signed_up" });
  });

  it("matches email regardless of case and doesn't overwrite an existing name", async () => {
    await signUp(db, { ...volunteer(1, [shiftIds[0]!]), firstName: "Asha" }, BEFORE_EVENT);
    await signUp(db, { ...volunteer(1, [shiftIds[2]!]), email: "VOL1@Example.com", firstName: "Someone else" }, BEFORE_EVENT);
    const people = await db.select().from(users);
    expect(people).toHaveLength(1);
    expect(people[0]!.firstName).toBe("Asha");
  });

  it("refuses drafts, inactive events, past shifts and shifts from another event", async () => {
    await expect(signUp(db, volunteer(1, [shiftIds[0]!]), new Date("2026-11-15T00:00:00Z"))).rejects.toMatchObject({ code: "shift_past" });
    await expect(signUp(db, volunteer(1, ["00000000-0000-4000-8000-000000000000"]), BEFORE_EVENT)).rejects.toMatchObject({ code: "unknown_shift" });
    await db.update(events).set({ isActive: false }).where(eq(events.id, eventId));
    await expect(signUp(db, volunteer(1, [shiftIds[0]!]), BEFORE_EVENT)).rejects.toMatchObject({ code: "event_not_open" });
    await db.update(events).set({ isActive: true, status: "draft" }).where(eq(events.id, eventId));
    await expect(signUp(db, volunteer(1, [shiftIds[0]!]), BEFORE_EVENT)).rejects.toMatchObject({ code: "event_not_open" });
    expect(await publicEvent(db, FLUTE_MALI.slug)).toBeNull();
  });

  it("rejects bad input on the server", async () => {
    await expect(signUp(db, { ...volunteer(1, [shiftIds[0]!]), email: "not-an-email" }, BEFORE_EVENT)).rejects.toThrow();
    await expect(signUp(db, { ...volunteer(1, [shiftIds[0]!]), phone: "555-0100" }, BEFORE_EVENT)).rejects.toThrow();
  });
});

describe("cancelSignup", () => {
  it("frees the spot once, and a repeat does nothing", async () => {
    await setCapacity(shiftIds[0]!, 1);
    const { signupIds } = await signUp(db, volunteer(1, [shiftIds[0]!]), BEFORE_EVENT);
    expect(await cancelSignup(db, signupIds[0]!)).toBe(true);
    expect(await cancelSignup(db, signupIds[0]!)).toBe(false);
    const [s] = await db.select().from(shifts).where(eq(shifts.id, shiftIds[0]!));
    expect(s!.filled).toBe(0);
    await signUp(db, volunteer(2, [shiftIds[0]!]), BEFORE_EVENT); // the freed spot can be taken
    expect((await db.select().from(signups).where(eq(signups.status, "confirmed")))).toHaveLength(1);
  });
});
