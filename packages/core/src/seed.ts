// Data for the first beta event, and demo data for local and preview use.
// The event wording is copied exactly from its Zeffy page.
import { eq } from "drizzle-orm";
import { type Db, events, orgMembers, organizations, roles, shifts, users } from "@sevak/db";
import { zonedTimeToUtc } from "./time";

const TZ = "America/Chicago";
const DAY = "2026-11-14";

export const FLUTE_MALI = {
  slug: "flute-mali-centenary-celebration",
  title: "Flute Mali Centenary Celebration",
  description:
    "Join us for a morning celebrating the centenary of the legendary flute maestro T.R. Mahalingam (Mali), 1926–2026. " +
    "10:00–11:00 AM conversation with V. Sriram, moderated by Murali Santhanam. " +
    "11:00–11:45 AM flute mini recital by Dhruv Vadhiraj. " +
    "11:45 AM–1:00 PM flute concert by Srikar Satish. " +
    "This is a free event; RSVP is required. Seating is limited.\n" +
    "Venue will be shared by email with everyone who registers. Suggested donation: $10.",
  externalUrl: "https://www.zeffy.com/en-US/ticketing/flute-mali-centenary-celebration",
};

// Proposed volunteer roles and shifts (Central time). To be confirmed by the host.
const ROLES: { name: string; description: string; requirements?: string; start: string; end: string; capacity: number }[] = [
  { name: "Setup crew", description: "Set out chairs, the stage area and the welcome table.", requirements: "Comfortable shoes", start: "08:30", end: "10:00", capacity: 6 },
  { name: "Sound and stage help", description: "Help the sound team with microphones, cables and the stage between sessions.", start: "09:00", end: "13:15", capacity: 2 },
  { name: "Registration and welcome desk", description: "Greet guests and check them in against the RSVP list.", start: "09:15", end: "11:00", capacity: 4 },
  { name: "Artist hospitality", description: "Look after the artists' green room: water, snacks and timings.", start: "09:30", end: "13:15", capacity: 2 },
  { name: "Ushers and seating", description: "Guide guests to seats and keep aisles clear.", start: "09:45", end: "13:00", capacity: 4 },
  { name: "Cleanup crew", description: "Stack chairs, clear the hall and pack up.", start: "13:00", end: "14:00", capacity: 6 },
];

export async function seedBetaEvent(db: Db, opts: { demoAdminEmail?: string } = {}) {
  const [existing] = await db.select({ id: events.id }).from(events).where(eq(events.slug, FLUTE_MALI.slug));
  if (existing) return existing.id;

  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: "Roopa Arts Cultural Center",
        slug: "roopa-arts-cultural-center",
        city: "Sugar Land",
        region: "TX",
        country: "US",
        visibility: "public",
        verificationStatus: "verified",
      })
      .onConflictDoNothing()
      .returning();
    const orgId = org?.id ?? (await tx.select().from(organizations).where(eq(organizations.slug, "roopa-arts-cultural-center")))[0]!.id;

    const [event] = await tx
      .insert(events)
      .values({
        orgId,
        slug: FLUTE_MALI.slug,
        title: FLUTE_MALI.title,
        description: FLUTE_MALI.description,
        timezone: TZ,
        startDate: DAY,
        endDate: DAY,
        city: "Sugar Land",
        region: "TX",
        country: "US",
        externalUrl: FLUTE_MALI.externalUrl,
        visibility: "public",
        status: "published",
      })
      .returning({ id: events.id });

    for (const [i, r] of ROLES.entries()) {
      const [role] = await tx
        .insert(roles)
        .values({ eventId: event!.id, name: r.name, description: r.description, requirements: r.requirements ?? "", sortOrder: i })
        .returning({ id: roles.id });
      await tx.insert(shifts).values({
        eventId: event!.id,
        roleId: role!.id,
        startsAt: zonedTimeToUtc(DAY, r.start, TZ),
        endsAt: zonedTimeToUtc(DAY, r.end, TZ),
        capacity: r.capacity,
      });
    }

    // Local and preview only: a made-up Admin so the host screens can be tried.
    if (opts.demoAdminEmail) {
      const [admin] = await tx
        .insert(users)
        .values({ email: opts.demoAdminEmail, firstName: "Demo", lastName: "Admin" })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (admin) await tx.insert(orgMembers).values({ orgId, userId: admin.id, role: "admin" });
    }
    return event!.id;
  });
}
