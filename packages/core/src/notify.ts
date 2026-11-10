// The emails Sevak sends when something happens, written here on the server
// (never by a page, so nobody can use Sevak to email whoever they like). The
// write rules (memberships.ts, certificates.ts, signups.ts, records.ts) add
// them to their results; the API route sends them (apps/web/src/lib/mail.ts).
//
// Links are paths in the app ("signup.html#my-orgs"); the route makes them
// full addresses. "@staff" means Sevak's staff (SEVAK_PLATFORM_ADMINS).
import { type Json, lower } from "./records";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  link?: string;
  linkText?: string;
  // The organization it's on behalf of, for its sending limit (limits.ts).
  orgId?: string;
}

export const STAFF = "@staff";

// Who to tell about an organization: its Admins, primary contact and creator.
export function adminEmails(org: Json): string[] {
  const team = Array.isArray(org.team) ? (org.team as Json[]) : [];
  const list = team.filter((m) => m?.role === "admin").map((m) => lower(m.email));
  list.push(lower((org.primaryContact as Json | undefined)?.email), lower(org.createdBy));
  return [...new Set(list.filter((e) => e.includes("@")))];
}

// Names people typed go into subjects and text: one line, no control
// characters, not too long.
export function clean(value: unknown, max = 80): string {
  const s = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const name = (org: Json | undefined) => clean(org?.name) || "the organization";
const of = (org: Json | undefined) => (org?.id ? { orgId: String(org.id) } : {});

// ---------- Joining ----------

export function invited(org: Json, to: string): Mail {
  const code = typeof org.inviteCode === "string" ? org.inviteCode : "";
  return {
    to,
    subject: `You're invited to volunteer with ${name(org)}`,
    text: `${name(org)} has invited you to volunteer with them on Sevak. Use the link to join. If you already use Sevak, just sign in with this email.`,
    link: code ? `join.html?code=${encodeURIComponent(code)}` : "join.html",
    linkText: `Join ${name(org)}`,
    ...of(org),
  };
}

export function welcome(org: Json, to: string): Mail {
  return {
    to,
    subject: `Welcome to ${name(org)}`,
    text: `You're now a volunteer with ${name(org)} on Sevak. You can sign up for its events.`,
    link: "signup.html#my-orgs",
    linkText: "See its opportunities",
    ...of(org),
  };
}

export function askedToJoin(org: Json, rawWho: string): Mail[] {
  const who = clean(rawWho);
  return adminEmails(org).map((to) => ({
    to,
    subject: `${who} asked to volunteer with ${name(org)}`,
    text: `${who} asked to volunteer with ${name(org)}. Approve or decline them on the Volunteers page.`,
    link: "volunteers.html",
    linkText: "Review the request",
    ...of(org),
  }));
}

export function decided(org: Json, to: string, approved: boolean): Mail {
  return { ...decidedMail(org, to, approved), ...of(org) };
}

function decidedMail(org: Json, to: string, approved: boolean): Mail {
  return approved
    ? {
        to,
        subject: `${name(org)} approved your request`,
        text: `Good news: ${name(org)} approved your request to volunteer. You can now sign up for its events on Sevak.`,
        link: "signup.html#my-orgs",
        linkText: "See its opportunities",
      }
    : {
        to,
        subject: `Your request to join ${name(org)}`,
        text: `${name(org)} isn't able to approve your request right now. You can still browse other organizations on Sevak.`,
        link: "signup.html#all-orgs",
        linkText: "Browse opportunities",
      };
}

export function addedToTeam(org: Json, to: string, role: string): Mail {
  return {
    to,
    subject: `You're on the team of ${name(org)}`,
    text: `You've been added to the team of ${name(org)} on Sevak as ${role === "admin" ? "an Admin" : "a Coordinator"}. Sign in with this email to manage its events and volunteers.`,
    link: "events.html",
    linkText: "Open Sevak",
    ...of(org),
  };
}

// ---------- Verification ----------

export function verificationRequested(org: Json): Mail {
  return {
    to: STAFF,
    subject: `Verification request: ${name(org)}`,
    text: `${name(org)} asked to be verified. Check its registration number, website and contact email on the Review page.`,
    link: "review.html",
    linkText: "Review it",
  };
}

export function verificationDecided(org: Json, verified: boolean, reason: string): Mail[] {
  return adminEmails(org).map((to) => ({
    ...(verified
      ? { to, subject: `${name(org)} is verified`, text: `Sevak verified ${name(org)}. Its public events are now listed for everyone.`, link: "organization.html", linkText: "Your organization" }
      : {
          to,
          subject: `Your verification request for ${name(org)}`,
          text: `Sevak couldn't verify ${name(org)} yet.${reason ? ` Reason: ${clean(reason, 300)}` : ""} You can update its profile and ask again.`,
          link: "organization.html",
          linkText: "Your organization",
        }),
    ...of(org),
  }));
}

// ---------- Sign-ups ----------

export function signedUp(event: Json, to: string, shiftLabels: string[]): Mail {
  return {
    to,
    subject: `You're signed up: ${clean(event.title) || "Volunteer shift"}`,
    text: `Thanks for signing up${event.organizationName ? ` with ${clean(event.organizationName)}` : ""}. Your shift${shiftLabels.length > 1 ? "s" : ""}: ${shiftLabels.join("; ")}.`,
    link: "signup.html?view=mine",
    linkText: "My sign-ups",
    ...(event.organizationId ? { orgId: String(event.organizationId) } : {}),
  };
}

// "Sat, Jan 10, 9:00–12:00 · Setup"
export function shiftLabel(event: Json, shiftId: unknown): string {
  for (const role of (event.roles as Json[] | undefined) ?? []) {
    for (const s of (role?.shifts as Json[] | undefined) ?? []) {
      if (s?.id !== shiftId) continue;
      const day = String(s.date ?? "");
      let date = day;
      try {
        date = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      } catch {
        /* keep the plain date */
      }
      return `${clean(date, 20)}, ${clean(s.start, 8)}–${clean(s.end, 8)}${role.name ? ` · ${clean(role.name)}` : ""}`;
    }
  }
  return "your shift";
}

// ---------- Certificates ----------

export function certificateRequested(org: Json, rawWho: string): Mail[] {
  const who = clean(rawWho);
  return adminEmails(org).map((to) => ({
    to,
    subject: `Certificate request from ${who}`,
    text: `${who} asked ${name(org)} for a certificate of their volunteer hours. Review their approved hours and issue it on the Volunteers page.`,
    link: "volunteers.html#cert-requests",
    linkText: "Review the request",
    ...of(org),
  }));
}

export function certificateIssued(org: Json, to: string, id: string): Mail {
  return {
    to,
    subject: `Your volunteer certificate from ${name(org)}`,
    text: `${name(org)} issued your certificate of volunteer service. It's saved in your Documents on Sevak.`,
    link: `certificate.html?id=${encodeURIComponent(id)}`,
    linkText: "View your certificate",
    ...of(org),
  };
}

export function certificateDeclined(org: Json, to: string, reason: string): Mail {
  return {
    to,
    subject: `Your certificate request to ${name(org)}`,
    text: `${name(org)} didn't issue the certificate you asked for.${reason ? ` Reason: ${clean(reason, 300)}` : ""} You can ask again for a different period.`,
    link: "signup.html?view=mine#certificates",
    linkText: "Your certificates",
    ...of(org),
  };
}
