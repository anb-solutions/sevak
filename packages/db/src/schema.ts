// Sevak's database schema. Change it here, then run `pnpm db:generate` and
// commit the migration it creates. See docs/REQUIREMENTS.md §8 for the model.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- People ----------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Always stored lowercased and trimmed; it's the person's identity (VOL-1).
    email: text("email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    phone: text("phone"), // E.164 (NFR-16)
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

// ---------- Organizations ----------

export const verificationStatus = pgEnum("verification_status", ["unverified", "pending", "verified", "rejected"]);
export const visibility = pgEnum("visibility", ["public", "private"]);
export const memberRole = pgEnum("member_role", ["owner", "admin", "coordinator"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    website: text("website"),
    city: text("city"),
    region: text("region"),
    country: text("country"), // ISO 3166-1 alpha-2
    visibility: visibility("visibility").notNull().default("private"),
    verificationStatus: verificationStatus("verification_status").notNull().default("unverified"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("organizations_slug_key").on(t.slug)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("org_members_user_idx").on(t.userId)],
);

// ---------- Events, roles and shifts ----------

export const eventStatus = pgEnum("event_status", ["draft", "published", "completed", "cancelled"]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    timezone: text("timezone").notNull(), // IANA, e.g. America/Chicago (NFR-11)
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    isOnline: boolean("is_online").notNull().default(false),
    venue: text("venue"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    // A link to the event's own page elsewhere, e.g. its Zeffy or Eventbrite page.
    externalUrl: text("external_url"),
    visibility: visibility("visibility").notNull().default("public"),
    status: eventStatus("status").notNull().default("draft"),
    isActive: boolean("is_active").notNull().default(true), // EVT-19
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_slug_key").on(t.slug), index("events_org_idx").on(t.orgId)],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    requirements: text("requirements").notNull().default(""), // what to bring
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("roles_event_idx").on(t.eventId)],
);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), // UTC
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    // Confirmed sign-ups. Only changed by the atomic update in @sevak/core (SGN-5).
    filled: integer("filled").notNull().default(0),
  },
  (t) => [
    index("shifts_event_idx").on(t.eventId),
    check("shifts_capacity_range", sql`${t.capacity} between 1 and 999`),
    check("shifts_filled_range", sql`${t.filled} >= 0 and ${t.filled} <= ${t.capacity}`),
    check("shifts_time_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

// ---------- Sign-ups ----------

export const signupStatus = pgEnum("signup_status", ["confirmed", "cancelled"]);
export const attendance = pgEnum("attendance", ["unmarked", "attended", "no_show"]);

// One sign-up form submission, which can cover several shifts.
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the "Manage my sign-up" token; the token itself is never stored (NFR-6).
    manageTokenHash: text("manage_token_hash").notNull(),
    optedInUpdates: boolean("opted_in_updates").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("registrations_manage_token_key").on(t.manageTokenHash), index("registrations_user_idx").on(t.userId)],
);

// One volunteer on one shift.
export const signups = pgTable(
  "signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: signupStatus("status").notNull().default("confirmed"),
    attendance: attendance("attendance").notNull().default("unmarked"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    hoursCredited: numeric("hours_credited", { precision: 5, scale: 2 }),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    index("signups_shift_idx").on(t.shiftId),
    index("signups_user_idx").on(t.userId),
    // A person can hold at most one confirmed spot on a shift.
    uniqueIndex("signups_one_confirmed_per_person").on(t.shiftId, t.userId).where(sql`${t.status} = 'confirmed'`),
  ],
);

// ---------- Sign-in ----------

export const loginTokens = pgTable(
  "login_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(), // for the emailed link
    codeHash: text("code_hash").notNull(), // for the 6-digit code
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("login_tokens_token_key").on(t.tokenHash), index("login_tokens_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the session cookie value.
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------- Email ----------

export const emailStatus = pgEnum("email_status", ["queued", "sent", "failed", "logged"]);

// Every email Sevak sends, written in the same transaction as the change that
// caused it. In local and preview environments emails are only "logged" here.
export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    ics: text("ics"), // calendar invite attachment (COM-10)
    status: emailStatus("status").notNull().default("queued"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("emails_status_idx").on(t.status)],
);
