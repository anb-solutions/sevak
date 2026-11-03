// Volunteer sign-up (SGN-2, SGN-4, SGN-5, SGN-6, SGN-7).
//
// A sign-up takes a spot on each picked shift with one atomic UPDATE that only
// succeeds while a spot is left, inside one transaction with the sign-up rows
// and the confirmation email. If any shift is full, nothing is saved.
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, emails, events, registrations, roles, shifts, signups, users } from "@sevak/db";
import { hashToken, newToken } from "./tokens";

export const signUpInput = z.object({
  eventId: z.string().uuid(),
  shiftIds: z.array(z.string().uuid()).min(1).max(50),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(""),
  email: z.string().trim().toLowerCase().email().max(254),
  // E.164, e.g. +14155550100 (NFR-16)
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
  optedInUpdates: z.boolean().default(false),
});
export type SignUpInput = z.input<typeof signUpInput>;

export class SignUpError extends Error {
  constructor(
    public readonly code: "event_not_open" | "unknown_shift" | "shift_full" | "shift_past" | "already_signed_up",
    message: string,
    public readonly shiftId?: string,
  ) {
    super(message);
    this.name = "SignUpError";
  }
}

export type SignUpResult = {
  registrationId: string;
  // Returned once, for the "Manage my sign-up" link; only its hash is stored.
  manageToken: string;
  signupIds: string[];
  // Shifts this person already held, which were skipped.
  skippedShiftIds: string[];
};

export async function signUp(db: Db, raw: SignUpInput, now: Date = new Date()): Promise<SignUpResult> {
  const input = signUpInput.parse(raw);
  const shiftIds = [...new Set(input.shiftIds)].sort(); // a fixed order avoids deadlocks

  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, input.eventId));
    if (!event || event.status !== "published" || !event.isActive) {
      throw new SignUpError("event_not_open", "This event isn't open for sign-ups.");
    }

    const picked = await tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.eventId, event.id), inArray(shifts.id, shiftIds)));
    if (picked.length !== shiftIds.length) {
      throw new SignUpError("unknown_shift", "One of the shifts isn't part of this event.");
    }
    const past = picked.find((s) => s.startsAt <= now);
    if (past) throw new SignUpError("shift_past", "One of the shifts has already started.", past.id);

    // Find or create the person by email. Names and phone are only filled in
    // when missing, so a sign-up can't overwrite someone else's profile.
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          firstName: sql`case when ${users.firstName} = '' then excluded.first_name else ${users.firstName} end`,
          lastName: sql`case when ${users.lastName} = '' then excluded.last_name else ${users.lastName} end`,
          phone: sql`coalesce(${users.phone}, excluded.phone)`,
        },
      })
      .returning();
    if (!user) throw new Error("Couldn't save the volunteer.");

    const held = await tx
      .select({ shiftId: signups.shiftId })
      .from(signups)
      .where(and(eq(signups.userId, user.id), eq(signups.status, "confirmed"), inArray(signups.shiftId, shiftIds)));
    const heldIds = new Set(held.map((h) => h.shiftId));
    const toTake = shiftIds.filter((id) => !heldIds.has(id));
    if (toTake.length === 0) {
      throw new SignUpError("already_signed_up", "You're already signed up for these shifts.");
    }

    const manageToken = newToken();
    const [registration] = await tx
      .insert(registrations)
      .values({
        eventId: event.id,
        userId: user.id,
        manageTokenHash: hashToken(manageToken),
        optedInUpdates: input.optedInUpdates,
      })
      .returning({ id: registrations.id });
    if (!registration) throw new Error("Couldn't save the sign-up.");

    const signupIds: string[] = [];
    for (const shiftId of toTake) {
      const taken = await tx
        .update(shifts)
        .set({ filled: sql`${shifts.filled} + 1` })
        .where(and(eq(shifts.id, shiftId), lt(shifts.filled, shifts.capacity)))
        .returning({ id: shifts.id });
      if (taken.length === 0) {
        // Throwing rolls back every spot taken so far in this transaction.
        throw new SignUpError("shift_full", "That shift just filled up. Please pick another.", shiftId);
      }
      const [row] = await tx
        .insert(signups)
        .values({ registrationId: registration.id, shiftId, userId: user.id })
        .returning({ id: signups.id });
      signupIds.push(row!.id);
    }

    await queueConfirmation(tx, { to: user.email, firstName: user.firstName || input.firstName, eventTitle: event.title });

    return { registrationId: registration.id, manageToken, signupIds, skippedShiftIds: [...heldIds] };
  });
}

// Cancels one confirmed sign-up and gives its spot back (SGN-7). Returns
// false when it was already cancelled.
export async function cancelSignup(db: Db, signupId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(signups)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(eq(signups.id, signupId), eq(signups.status, "confirmed")))
      .returning({ shiftId: signups.shiftId });
    if (!row) return false;
    await tx
      .update(shifts)
      .set({ filled: sql`${shifts.filled} - 1` })
      .where(eq(shifts.id, row.shiftId));
    return true;
  });
}

// The public view of an event: roles and shifts with spots left, never names.
export async function publicEvent(db: Db, slug: string) {
  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  if (!event || event.status !== "published" || !event.isActive) return null;
  const roleRows = await db.select().from(roles).where(eq(roles.eventId, event.id)).orderBy(asc(roles.sortOrder));
  const shiftRows = await db.select().from(shifts).where(eq(shifts.eventId, event.id)).orderBy(asc(shifts.startsAt));
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    timezone: event.timezone,
    startDate: event.startDate,
    endDate: event.endDate,
    venue: event.venue,
    city: event.city,
    region: event.region,
    country: event.country,
    externalUrl: event.externalUrl,
    roles: roleRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      requirements: r.requirements,
      shifts: shiftRows
        .filter((s) => s.roleId === r.id)
        .map((s) => ({
          id: s.id,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          capacity: s.capacity,
          spotsLeft: s.capacity - s.filled,
        })),
    })),
  };
}

// Placeholder confirmation: the full email with shift details, calendar
// invite (COM-10) and manage link is built on Day 4.
async function queueConfirmation(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  args: { to: string; firstName: string; eventTitle: string },
) {
  await tx.insert(emails).values({
    toAddress: args.to,
    subject: `You're signed up: ${args.eventTitle}`,
    text: `Hi ${args.firstName},\n\nThanks for signing up to volunteer at ${args.eventTitle}.`,
  });
}
