# Sevak: MVP Requirements

**Version:** 2.27 (sign-in by email code; profiles and organizations saved on the server) · **Updated:** 2026-11-08 · **Status:** Draft for review

This replaces the original SRS outline, which is about six months old. That outline covered a full
volunteer management system: background checks, GPS clock-in, CRM integrations and so on. This
version narrows the scope to an **MVP** built around the user journeys we just walked through, and
it favours the simplest interface that will work.

---

## 1. Introduction

### 1.1 Purpose

This document defines what the first version (MVP) of **Sevak** must do and how well it must do it.
It is written for the founding team, designers, engineers, QA and pilot organizations.

### 1.2 Product vision

> Sevak is the simplest way for an organization to fill volunteer shifts, and for a volunteer to
> find one, sign up in under a minute, and get recognized for showing up.

### 1.3 MVP scope

**In scope**

- Organization profiles that show the organization type and a verification badge
- Single-day and multi-day events with **roles** assigned to **time shifts**
- Sign-up for one or many shifts in a single form, with no account needed
- Email for everything: confirmations, event updates, reminders and certificates
- Attendance checked by the host team, then an official certificate of participation
- Discovery: a calendar and list of events filtered by city, plus a page for each organization
- Public or private events and organizations, with invitations by email, text or WhatsApp
- A **private** "My volunteering" log for each volunteer
- A responsive web app designed for phones first

**Out of scope for the MVP** (see [§10 Roadmap](#10-roadmap) for what comes later)

- Native iOS or Android apps
- Background checks and certification document uploads
- GPS, QR or kiosk clock-in and clock-out
- Skills, interests and availability matching
- CRM, SSO and other third-party integrations
- Sending SMS or WhatsApp messages from the platform (hosts share links instead)
- Payments, donations and payroll
- Gamification, points and rewards
- Importing events from ticketing platforms or social media
- Languages other than English

### 1.4 What changed from the original spec

| Original spec | MVP decision | Why |
|---|---|---|
| Rich volunteer profile (skills, availability, certifications) | Optional profile that only stores contact details for one-click sign-up | Friction at sign-up is the biggest problem. A profile is nice to have, not a must. |
| Opportunities and shifts | Kept, restructured as **Event → Role → Shift**, with multi-day support | This is how hosts actually think about staffing an event. |
| Clock in/out (manual, QR, GPS) and hour approval | The host marks each person *Attended* or *No-show* on the roster. Hours default to shift length and can be adjusted. | This is the simplest reliable proof of participation. QR check-in comes later. |
| Engagement and impact reports | Roster CSV export plus a short per-event summary | This is enough for pilots. |
| Background checks, disclosures, policy acknowledgements | Deferred, except an optional waiver checkbox (Should) | Background check vendors are expensive and differ by organization. |
| Targeted messages, communication history, feedback, recognition | Event updates by email (to everyone or by role or shift) with a message history. Recognition is the certificate. | This covers the core loop without a separate engagement suite. |
| *(not in original)* | Organization verification and type, private events and organizations, invite links, calendar discovery by city, private volunteer log, branded certificates, SEO-ready public pages | These came out of the updated user journeys. |
| CRM, background check and SSO integrations | Later | None are needed to prove the core loop. |
| iOS and Android apps | Later. The web app is designed for phones first. | Web plus email reaches everyone and ships faster. |
| 2FA for all administrators | Required for platform admins, recommended (Should) for hosts. Everyone signs in with a passwordless email link by default. | Keeps security high without adding friction for volunteers. |

---

## 2. Users and roles

| Role | Who they are | What they need | Account |
|---|---|---|---|
| **Host (Owner)** | The person who creates and runs the organization's presence | Full control of the organization profile, events, team and certificates | Email sign-in link |
| **Host (Admin)** | Senior team members | Everything an Owner can do: edit the organization profile and manage the team | Email sign-in link |
| **Host (Coordinator)** | Event team members | Manage rosters, mark attendance and send updates, but no organization settings | Email sign-in link |
| **Volunteer (guest)** | Anyone signing up, often a first-time visitor arriving from a shared link | Find a shift and sign up in under a minute | **None.** They manage sign-ups through a secure link in their email. |
| **Volunteer (signed in)** | A returning volunteer | Pre-filled sign-up and a private log of their history, hours and certificates | Email sign-in link, no password |
| **Platform admin** | Us | Verify organizations and remove abusive content | Email sign-in link plus 2FA |

**One person, several roles:** a person can be a volunteer and a host team member at the same time, and can be a host team member for several organizations with a different role in each (VOL-13).

**Assumptions about users:** Hosts are busy and often not technical. Many are volunteers
themselves. Volunteers are mostly on phones and may arrive cold from a WhatsApp or text message.

---

## 3. Core concepts

```
Organization ──< Main event (optional) ──< Event ──< Role ──< Shift ──< Sign-up ──> Attendance ──> Certificate
                   │                              │
                   └── Updates (messages)         └── Volunteer (identified by email)
```

- **Organization:** the host. It has a type, a verification status and a visibility setting.
- **Event:** something happening on one or more days at a place, or online. It has a visibility
  setting.
- **Role:** a job at the event, such as *Setup crew* or *Registration desk*, with a description and
  what to bring.
- **Shift:** one role in one time window on one day, with a **capacity** (how many volunteers are
  needed).
- **Sign-up:** one volunteer on one shift. A single form submission can create several sign-ups.
- **Attendance:** the host team's record that the volunteer showed up, plus the hours credited.
- **Certificate:** branded proof of participation, emailed after attendance is checked, with a
  verification link.

**Example:** *Community Food Drive (Sat–Sun)*

| Day | Role | Time | Capacity |
|---|---|---|---|
| Sat | Setup crew | 8:00–10:00 AM | 6 |
| Sat | Sorting & packing | 10:00 AM–1:00 PM | 12 |
| Sun | Distribution | 9:00 AM–12:00 PM | 10 |

---

## 4. Functional requirements

Priority key: **Must** means required for MVP launch. **Should** means build it in the MVP if time
allows, or right after launch. **Later** means post-MVP.

### 4.0 Updated user journeys: where each one is covered

| # | User journey (from the updated brief) | Covered by |
|---|---|---|
| 1 | As an event host, I want to publish single- or multi-day event opportunities with specific volunteer roles defined against time shifts. | EVT-1 to EVT-8 |
| 2 | As a prospective volunteer, I want to very easily sign up for one or more time shifts. | SGN-1 to SGN-8 |
| 3 | As an event host, I want to send confirmation emails to those who signed up, and after my team has checked that they volunteered, send an official certificate or branded email confirming their participation. | COM-1, COM-2, ATT-1 to ATT-6 |
| 4 | As an event host, I want to send regular communications and event updates to volunteers. | COM-3 to COM-6 |
| 5 | As a volunteer, I'd like a profile so future sign-ups are one click (not a must). | VOL-2 (Should) |
| 6 | As an event host, I want a trusted, vetted profile for my organization that shows what type of organization it is, plus clean event pages. | ORG-1 to ORG-5, EVT-7, EVT-8 |
| 7 | As a volunteer, I want to see all available events on a calendar, filtered by city and/or by organization. | DSC-1 to DSC-4 |
| 8 | As an event host, I want to restrict visibility for private events or organizations while still inviting volunteers by email, text or WhatsApp. | ORG-6, PRV-1 to PRV-5 |
| 9 | As a volunteer, I want to join private events and keep my own log of them that isn't public, like private Venmo transactions. | VOL-1, VOL-3, VOL-4, §5 |
| 10 | *(Deferred, 2026-10-05)* Rules for under-age volunteers, such as a minimum age and parents signing up children. | §4.10 (Later) |

### 4.1 Organization profile and trust

| ID | Requirement | Priority |
|---|---|---|
| ORG-1 | A host can create an **organization profile**, shown as **tabs** (About · Address · Status · Contact · Team) that share one Save. If something is missing, Save opens the first tab with a problem and marks every tab that needs attention. Each tab ends with a "Next" button, and a link can open a specific tab (for example `#team`). The profile is grouped as: **About** (name, an optional website, an optional WhatsApp group, community or channel link (ORG-9), and an optional description of up to 1,000 characters), **Primary address** (country, street, optional suite, city or town, and a state or region and postal code where the country uses them), **Charity or nonprofit status** (ORG-8), **Primary contact** (name, optional title, email, phone; this person is the organization's Owner and receives volunteers' replies), and **Team members** (ORG-5). The type (ORG-2) and a logo are also part of the profile but aren't in the prototype yet. *(Prototype: `app/organization.html`.)* | Must |
| ORG-2 | The organization type is picked from a list: *Nonprofit / charity, School or university, Community group, Faith-based, Government / public agency, Business (CSR), Other*. | Must |
| ORG-3 | **Verification.** An organization's **Admin** asks for verification from a *Verification* box at the top of the Organization page. The request sends evidence from the saved profile: the charity or tax registration number (such as a US EIN or a UK charity number), the official website, and whether the contact email is on the website's domain, plus an optional note. A request needs a registration number or a website. A platform admin approves it or rejects it with a reason the organization sees (ADM-1); the Admin can withdraw a waiting request, and ask again after a rejection. Statuses: *Not verified yet*, *Pending review*, *Verified*, *Not approved*. The organization gets an email at each step and its team sees a one-time notice when it's decided. Verified organizations show a **Verified** badge everywhere they appear. **Only verified organizations can list events publicly.** Unverified organizations can still create and run private events, and the event editor and organization header link to the request (*Get verified*). Coordinators see the status but can't ask. *(Prototype: `app/verify-store.js`; emails go to the outbox.)* | Must |
| ORG-4 | Each public organization has a clean page at `/o/{slug}` showing its description, type, badge and upcoming public events (as a calendar or list). | Must |
| ORG-5 | The profile lists up to 20 **team members**, each with a name, email, optional phone and a role. **Coordinators** manage rosters, mark attendance and send updates. **Admins** can also edit the organization profile, manage the team, and delete events and main events (EVT-19) and the organization itself. Only Admins see **Delete organization**; others are told only admins can delete it. Each person needs their own email address, because it becomes their login. Team members are invited by email. | Must |
| ORG-8 | **Charity or nonprofit status** works in any country. It is one of: registered charity or nonprofit (for example a US 501(c)(3), a UK registered charity or a Canadian registered charity), another nonprofit or tax-exempt organization, registration pending, or not registered. An optional **registration number** from the charity regulator or tax authority can be added for any status except "not registered". Adding one speeds up verification. It's used only for verification (ORG-3) and is never shown publicly. Organizations that aren't registered can still use Sevak. | Must |
| ORG-9 | An organization can add a **WhatsApp link** to its profile: a group or community invite (`chat.whatsapp.com/…`), a channel (`whatsapp.com/channel/…`) or a click-to-chat number (`wa.me/…`). Other links are rejected. Volunteers can tap it from the organization page to join. | Should |
| ORG-6 | Organization visibility is either **Public** (listed and indexed by search engines) or **Private** (no public page, and every event is private). An organization can only become public once it is verified (ORG-3). Until then it works as private. | Must |
| ORG-10 | **Fill in from website.** When a host enters their website, Sevak reads the page and fills in the **description** and **primary address** if those are still empty. The host can also run this with a "Fill in from website" button. It never overwrites what the host typed, and it only fills an address that is completely empty. Filled fields are highlighted until the host edits them, and the host is asked to check them. Sources, in order: schema.org `Organization` or `NGO` data (JSON-LD), then the Open Graph or meta description; for the address, schema.org `PostalAddress` (JSON-LD or microdata), with the country matched by code or name. **Prototype limitation:** browsers only allow reading sites that permit it (CORS), and most don't, so the prototype often shows "couldn't read that website". In Phase 2 the page is fetched by Sevak's server, with a timeout, size limit and protection against requests to internal addresses. *(Prototype: `app/website-import.js`.)* | Should |
| ORG-11 | **Several organizations per person.** A person can create and manage more than one organization. An **organization switcher** at the top of the Organization and Events tabs picks the current organization, and **+ New organization** starts a blank profile. Each organization has its own profile, team, events and main events, and the Events tab and event editors only show the current organization's events. Opening an event switches to its organization. The Events tab, the event editor and the main event editor all open with an **organization header** (name, place, charity status, verification badge, website and "Edit profile" links), so it's always clear which organization an event is for. Unsaved changes are confirmed before switching. Deleting an organization deletes only its own events. *(Prototype: `app/orgs-store.js`. In the live app, the organizations shown are the ones the person is an Owner, Admin or Coordinator of, per OrgMember.)* | Must |
| ORG-12 | **Documents.** An organization profile has a **Documents** tab where Admins and Coordinators upload files (policies, insurance certificates, registration papers and so on). Each document has a **name** (filled in from the file name), an optional **brief description**, and records **when it was uploaded, by whom, and its size**. The documents grid shows those five things, can be sorted by name, upload date, uploader or size, and offers Download, Edit (rename, change the description or replace the file) and Delete. Files are up to **10 MB** each. Documents are saved as soon as they are added, separately from the profile's Save button, and are only available once the organization has been saved. Deleting an organization deletes its documents and its events' documents. The same Documents tab is on events (EVT-18) and personal profiles (VOL-14). *(Prototype: `app/documents.js`; files are kept in the browser's IndexedDB. In the live app they go to private object storage and are only visible to the organization's team.)* | Should |
| ORG-13 | **Joining a team, and who sees what.** There are two ways onto an organization's team: **set up a new organization** (you become its Admin), or be **added by one of its Admins** on its Team tab, as Admin or Coordinator (in the live app this sends an invitation to accept; the prototype shows a one-time *"You've been added to the team of X as a Coordinator"* notice). The primary contact is also an Admin. **Coordinators** can open the organization profile but not change it or its team; they can add documents, and run events and the dashboard. When signed in, the organization switcher only lists your teams. Someone signed in who isn't on the team opening a Manage page (Events, an event, a main event, Dashboard, Organization) sees *"Manage an organization"* or *"You're not on this team"* with the two ways in, instead of the page. *(Prototype: signed out, these pages open as a preview for reviewers. Loading the demo data while signed in makes you an Admin of the demo organization.)* | Must |
| ORG-7 | Automated verification checks, such as a charity registry lookup or an email-domain match. | Later |

### 4.2 Events, roles and shifts

| ID | Requirement | Priority |
|---|---|---|
| EVT-1 | A host can create an event with a title, description, cover image, location (address and city, or online), time zone, and a start and end date. The event can be single-day or multi-day. | Must |
| EVT-2 | A host can define roles with a name, a description, and what to bring or requirements. | Must |
| EVT-3 | A host can define shifts for each role on each day, with a start time, end time and capacity. The shift builder has a **"copy to other days"** shortcut so multi-day events are fast to set up. | Must |
| EVT-4 | An event moves through *Draft → Published → Completed*, or *Cancelled*. Only published events accept sign-ups. | Must |
| EVT-5 | A host can edit a published event. If a time or location changes, the host is prompted to notify the affected volunteers and sees a preview of the email. | Must |
| EVT-6 | Cancelling an event or a shift emails the affected volunteers. | Must |
| EVT-7 | Each event has a clean, shareable page at `/e/{slug}` showing what, when, where, the organization and its badge, the roles, open shifts, and a sign-up button. | Must |
| EVT-8 | Public event pages include structured data (schema.org `Event`), Open Graph and link-preview tags, and a canonical URL, so they look good when shared and rank well in search. | Must |
| EVT-14 | **Events belong to an organization** and have their own **Events** tab, separate from the Organization tab. The Events tab lists the organization's main events with their sub-events nested underneath, then other events, all by date. Each event shows its dates, location, number of shifts and volunteer spots, and whether it is a Draft or Published and Public or Private. **+ Event** and **+ Main event** buttons appear once the organization profile is saved; until then the tab asks for it. Deleting an organization deletes its events. *(Prototype: `app/events.html`, `app/event.html`.)* | Must |
| EVT-15 | **Event editor rules.** Events last 1–31 days. The end date follows the start date for one-day events. The time zone defaults to the host's browser. In-person events need a country, street and city, and the host can copy the organization's address in one click. Online events take an optional meeting link, shown only to volunteers who sign up. Each shift has a day within the event dates, a start time, an end time after the start, and 1–999 volunteers. A new shift copies the role's previous shift. "Copy first day's shifts to every day" skips days that already have the same shift. If the dates change, any shift left outside them is flagged. **Save draft** needs only a name and dates. **Publish** needs everything complete, including at least one role with at least one shift. A published event can be **unpublished** back to a draft. Overnight shifts that end after midnight are a later addition. | Must |
| EVT-16 | If an organization isn't verified yet, a **public** event stays private until it is (ORG-3, PRV-1), and the editor says so. | Must |
| EVT-17 | **Main events and sub-events.** An organization can create a **main event** (for example *Arudra*) with a name and an optional description, to group related events called **sub-events** (for example *Arudra*, *Arudra Rehearsal 1* and *Arudra Rehearsal 2*). Each sub-event is a normal event with its own dates, location, roles, shifts, visibility and draft or published status. The main event's dates run from its first sub-event to its last. Main events are optional, so one-off events stay standalone. An event can be put into, moved between, or taken out of a main event from the event editor. The Events tab shows each main event with its sub-events nested underneath, then any other events. Deleting a main event keeps its sub-events as standalone events. *(Prototype: `app/main-event.html`.)* | Must |
| EVT-18 | **Event documents.** The event editor has two tabs, **Event details** and **Documents**. The Documents tab works exactly like the organization's (ORG-12), for briefings, maps, run sheets and waivers. It is available once the event has been saved (a draft is enough). Deleting an event deletes its documents. Sharing event documents with signed-up volunteers is future work. | Should |
| EVT-19 | **Inactive events, and who can delete.** Only an organization **Admin** can delete an event or a main event; Coordinators don't see the Delete button and are told only admins can delete. Instead, anyone running the organization's events can **make an event inactive**. An inactive event is kept, with its sign-ups and documents, but is **hidden**: volunteers can't find it or sign up (its sign-up link says it's no longer available), it's left out of the dashboard and of its main event's dates, and the Events tab and main event page hide it unless **Show inactive events** is ticked, where it has an *Inactive* badge. The editor shows an *inactive* notice with **Reactivate event**, which restores it as it was (draft or published). Volunteers already signed up keep their sign-up, and their manage page says the event is no longer active. *(Prototype: "you" are the person in My profile. You are an Admin of an organization if its Team tab lists your email as Admin, you are its primary contact, you created it, or My profile lists it with the Admin role.)* | Must |
| EVT-9 | A host can duplicate an event, for example to repeat it next month. | Should |
| EVT-10 | A host can add custom sign-up questions to an event, such as T-shirt size or emergency contact. | Should |
| EVT-11 | A host can add a waiver or policy checkbox that links to the host's own document. | Should |
| EVT-12 | Recurring event series, host approval of sign-ups, and waitlists. | Later |

### 4.3 Volunteer sign-up

| ID | Requirement | Priority |
|---|---|---|
| SGN-1 | The event page lists shifts grouped by day and then by role, with times and **spots left**. Full shifts are marked *Full*. | Must |
| SGN-2 | A volunteer can tick **one or more shifts** and confirm them together. Signing up needs a profile and **membership of the event's organization** (MEM-1); volunteers who aren't members are offered a way to join instead (MEM-5). *(Changed: signing up without an account was removed.)* | Must |
| SGN-3 | Target: a first-time volunteer can finish signing up on a phone in **under 60 seconds and no more than two screens**. | Must |
| SGN-4 | The form warns the volunteer if the shifts they picked overlap in time. | Must |
| SGN-5 | Capacity is checked when the form is submitted, so a shift is never overbooked even when many people sign up at the same moment. | Must |
| SGN-6 | The volunteer sees an instant confirmation screen and gets a confirmation email (COM-1) with a secure **"Manage my sign-up"** link for viewing, adding or cancelling shifts. | Must |
| SGN-7 | A volunteer can cancel a shift through that link, and the cancellation shows up on the host's roster. | Must |
| SGN-8 | The sign-up form has bot and spam protection (an invisible challenge plus rate limits). | Must |
| SGN-9 | The confirmation screen and email include **Add to calendar** (an .ics file and a Google Calendar link). | Should |
| SGN-10 | The form has an opt-in checkbox: *"Keep me posted about future opportunities from {Organization}."* | Should |
| SGN-14 | **Prototype of the volunteer sign-up page** (`app/signup.html`), covering SGN-1 to SGN-9 and DSC-1:

- **Find events:** lists published, upcoming, public events with spots left. Verified organizations come first. Unverified organizations' events appear in a labeled *Preview: not listed publicly yet* section, per EVT-16. Private events, drafts and past events are never listed.
- **Event page:** shows the host and its verification, dates, place, time zone (when it differs from the visitor's) and description. Shifts are grouped by day with spots left, and full or past shifts can't be picked.
- **Signing up:** a volunteer ticks several shifts, gets an overlap warning when times clash, and fills in their details (pre-filled from their saved profile, with the phone in international form). Capacity is re-checked on submit. The same email can't take the same shift twice.
- **Confirmation:** lists the shifts and offers **Add to calendar** (.ics in the event's time zone) and a **Manage my sign-up** link, where shifts can be cancelled and the spots open up again.
- **Drafts and the editor:** drafts show a host preview with sign-up closed. The event editor links to the volunteer page, and the volunteer page links back: Admins and Coordinators of the organization see *"This is what volunteers see. You're an Admin here: Edit this event"*. Events are edited at **Manage → Events → the event**. Someone not on the team who opens the editor is told only the organization's Admins and Coordinators can edit its events (volunteering doesn't include editing); for the demo organizations there's a one-click *Add me to its team as an Admin*.

Sign-ups appear on the host dashboard right away. | Must |
| SGN-11 | Waitlists for full shifts, and a host-approval sign-up mode. In the MVP every sign-up is **confirmed automatically** (decision Q3). | Later |

### 4.3a Joining: invitations and requests

| ID | Requirement | Priority |
|---|---|---|
| MEM-1 | **Volunteers join organizations.** A new volunteer needs an **invitation** from an organization, or to **request to join** one, naming the organization. Membership has a status: *invited* → *active*, or *requested* → *active* (approved) or *declined*. Only active volunteers, and the organization's team (Admins and Coordinators), can sign up for its shifts. | Must |
| MEM-2 | **The Join page.** *Sign up* opens **Join Sevak** with two choices: **I have an invitation** (paste the invite link or type its code; Sevak shows which organization it's from) or **Request to join an organization** (search the organizations by name or city, pick one, add an optional note). New people then fill in their profile, and saving it completes the join. A third route, *Setting up a new organization?*, leads through the profile to creating the organization. Signed-in people use the same page to join another organization. | Must |
| MEM-3 | **Invitations.** Admins and Coordinators invite people from **Manage → Volunteers**: an **invite link** with a short code (which they can replace, so the old one stops working), or **email invitations** to a list of addresses. People who join with the link become volunteers straight away; an email invitation is accepted as soon as that person signs in with the invited email, with a one-time notice. Pending invitations can be cancelled. | Must |
| MEM-4 | **Approving requests.** **Manage → Volunteers** lists requests with the person's photo, name, email, note and the services they offer, with **Approve** and **Decline**; the menu shows how many are waiting. Declined requests can still be approved later. An organization's Admins can choose to **approve requests automatically**. The page also lists the organization's volunteers (long lists start short, with *Show all*) with **Remove**. The volunteer gets a one-time notice when approved or declined. | Must |
| MEM-5 | **Joining from an event.** A volunteer who isn't a member sees a note on the event page and, at the confirm step, **Ask to join {organization}** (with an optional note) instead of *Confirm*; if the organization approves automatically they can confirm straight away. Signed out, the confirm step offers **Join {organization}** (the Join page with that organization picked, coming back to the event afterwards) or **Sign in**. A pending request shows *Waiting for approval*. | Must |
| MEM-6 | **My organizations and All organizations.** Signed in, the opportunities page has two tabs: **My organizations** (events of organizations you volunteer with or help run, with a line naming them and any requests waiting) and **All organizations** (every public event; those from organizations you haven't joined say *Join to sign up* or *Request sent*). It opens on My organizations once you belong to one. Signed out, anyone can browse all opportunities, with a note that signing up needs joining. | Must |
| MEM-7 | **Your organizations on Profile.** Profile lists the organizations you volunteer with (*Volunteer*, *Waiting for approval* or *Not approved*), with **Leave**, **Withdraw** or **Remove**, and a link to join another. | Should |
| MEM-8 | **Prototype outbox.** Until email is connected, every email Sevak would send (invitations, welcome, approval, decline and sign-up confirmations) is kept on an **Outbox** page with its links, so the flows can be tested. | Should |
### 4.4 Volunteer profile and private log

| ID | Requirement | Priority |
|---|---|---|
| VOL-1 | Any volunteer who has signed up can **sign in with their email** using a one-time link or a 6-digit code from the same email, with no password. The email address is their identity. A new person signs in first, then fills in their profile. *(Web app: `app/signin.html` with `packages/core/src/auth.ts`.)* | Must |
| VOL-2 | A signed-in volunteer can keep a **profile** so future sign-ups are pre-filled and take one click. The profile holds: first and last name, email, mobile phone (NFR-16), an optional **gender** (a drop-down: *Woman, Man, Non-binary, Another gender, Prefer not to say*; shared only with organizations whose events the person signs up for), an optional address (country, street, city or town, and a state or region and postal code where used), optional **affiliations** (up to 5, each with a type such as school, Scouting, faith community, workplace or club, plus a name), and **usual availability** (weekends only, weekdays, evenings only, or anytime). Organizations never see the street address. *(Prototype: `app/profile.html`. In the web app the profile is saved on the server and its email is the one the person signed in with.)* | Should |
| VOL-3 | A signed-in volunteer has a **"My volunteering"** page showing upcoming and past shifts across all organizations, **including private events**, with hours credited and certificates. | Must |
| VOL-4 | The log is **private to the volunteer.** Hosts only ever see records for their own organization's events. Nothing about a private event appears on any public page, in search, or to other volunteers. | Must |
| VOL-5 | A volunteer can download a summary of their hours as a PDF or CSV, for example for school or employer service-hour requirements. | Should |
| VOL-6 | A volunteer can export or delete their account and data (see open question Q9 on what the organization keeps). | Must |
| VOL-7 | An optional public volunteer profile or shareable badge. Entries from private events would never be shown on it. | Later |
| VOL-13 | In their profile, a person ticks **I volunteer** if they sign up for shifts (ticked by default); this shows the volunteer-only fields (address, availability, affiliations). Below it, **Organization teams** is a read-only list of the teams they're on, with their role (Admin or Coordinator), a *Manage* link and **Leave**. A person can't add themselves to a team or pick their own role (ORG-13). Leaving is refused for an organization's primary contact or its only Admin, so an organization always keeps an Admin. The section also offers *Set up your organization* (once the profile is saved) and explains how to join an existing one. *(Prototype: "Host team member" and the editable "My organizations" list were removed; roles people had typed there were moved onto the organizations' Team tabs.)* | Must |
| VOL-14 | **Personal documents.** A person's profile has three tabs, **My details**, **Get to know me** (VOL-15) and **Documents**, where they can keep their own files (certificates, background checks, training records), with the same grid and actions as ORG-12. Only they can see these. Deleting the profile deletes them. | Should |
| VOL-15 | **Get to know me, and services.** A profile has an optional **Get to know me** section, on its own **Get to know me** tab together with **Affiliations** (VOL-2; shown to volunteers only, with a note for others) with four free-text fields: **About me** (up to 1,000 characters), **My passion**, **My certifications** and **How I can help** (up to 500 each), with character counters. A **Services I can provide** section has a drop-down of service types: *General help, AV system help, Food service, Website maintenance, Telemarketing, Fundraising, Accounting, Office help*. Each pick is added to a list of removable chips, so a person can offer several; a service already chosen can't be picked twice. Organizations see these when the person signs up for their events. Matching services to roles is future work (VOL-8). | Should |
| VOL-16 | **Profile photo.** A profile can have an optional photo, at the top of *My details*. A person can **take a photo with their camera** (a live preview in a window, mirrored like a mirror, with a circle guide; on devices without a live preview, the phone's camera app opens), **drag and drop** a picture onto the photo area, or **choose a file**. Pictures are cropped to a centred square and reduced to 400 × 400 pixels (JPEG), so they stay small. Non-images, unreadable images and files over 15 MB are refused with a message. If camera access is blocked or there is no camera, the window says so and offers *Choose a file instead*. The photo can be retaken or removed, and is saved with the profile. Organizations see it when the person signs up for their events, to recognise them on the day. | Should |
| VOL-17 | **Registered volunteers land on the opportunities.** Someone who is registered and signed in goes straight from the home page to **Available volunteer opportunities**, and the Sevak logo on every page takes them there too. Signing in also lands there. The opportunities page shows *Signed in as {name} · My profile · Sign out*; signing out returns to the Welcome Volunteer page, which then stays put. *(Prototype: "registered" means a profile is saved in this browser; saving the profile or signing in counts as signing in.)* | Must |
| VOL-18 | **My sign-ups.** Signed-in volunteers have a **My sign-ups** page (in the menu, with a count of upcoming events). It lists their sign-ups (matched by email) grouped into **Upcoming**, **Past** and **Cancelled**, each with the event, date, place (venue and city) and their shifts, and a *Manage or cancel* (or *View sign-up*) link. Events made inactive or removed are labelled. With none, it offers *Browse opportunities*; signed out, it asks you to sign in. The confirmation page links to *All my sign-ups*. This is a first step towards VOL-3. *(Replaces the earlier two tabs on the opportunities page.)* | Must |
| VOL-19 | **Location filter.** Available opportunities can be filtered: **All** (the default), **In person near me**, **All in person** and **Remote** (online events), each with a count. *Near me* uses a *Near* box (city or town, state or region, or postal code), filled in from the profile address when there is one; an event is near when it's in the same city, region or postal area (first three characters), and "City, Region" matches on the city. The choice is remembered in the browser. Distance-based search ("within 25 km") needs map data and comes with the live app. | Should |
| VOL-20 | **The menu depends on who you are.** Signed out: *Opportunities · Join · Sign in*. Signed in: **Opportunities · My sign-ups · Profile** (Sign out is on Profile). Anyone on an organization's team also gets the **Manage** links: **Events · Volunteers · Dashboard · Organization** (Volunteers shows how many requests are waiting). On the Manage pages these links show in the header after a divider; on every other page they are tucked under a **"⋯" button** (labelled "More: manage your organization" for screen readers) so volunteers' pages stay uncluttered. The "⋯" menu opens below the button, closes with Escape (focus returns to the button), a click outside or tabbing away, and shows the waiting-requests count on the button. On phones the main items sit in a **bar at the bottom of the screen**, with **More** as a fourth item for team members that opens the same Manage links above the bar; on the Manage pages the links also show at the top and scroll sideways if the screen is narrow. The Manage links appear as soon as you set up an organization or are added to a team, and go when you leave your last team. | Must |
| VOL-21 | **A clean opportunities list.** One compact row per event: its name, the date (no year) and a short place (venue and city, or *Online*), with the spots left on the right; the whole row opens the event. Rows are grouped into **This week**, **Next week** and **Later** (weeks run Monday to Sunday), with unverified organizations' events under *Not listed publicly yet*. The organization's name only appears when the list has events from more than one organization. The location filter (VOL-19) is a single row of chips that scrolls sideways on phones. | Must |
| VOL-22 | **Signing up in two short steps.** **Step 1, pick shifts:** a compact header (organization and badge, main event, title, date and place) with everything else folded under *About this event*. Multi-day events have a **day picker** that shows one day at a time, with a count of shifts picked on each day. Each shift is one line (tick, role, time, spots left), with *Details* for the role description and what to bring; full or ended shifts are folded under *N full shifts*. A bar fixed to the bottom shows *N shifts picked* and **Continue**. **Step 2, confirm:** the chosen shifts, then either *Signing up as {name} ({email}) · Change* for signed-in volunteers or the name, email and phone form, and **Confirm**. The browser's Back and Forward buttons move between the steps; *‹ Shifts* goes back too. If a shift fills while confirming, the volunteer is taken back to step 1 with a message. | Must |
| VOL-23 | **Smaller touches.** Event and confirmation pages start with a clear *‹ Opportunities* back link. The prototype note is one short line and can be dismissed (remembered in the browser); it comes back on Manage pages previewed while signed out, to say so. | Should |
| VOL-8 | Skills and interests, and **matching** shifts to a volunteer's availability (VOL-2 collects availability now). | Later |

### 4.5 Discovery

| ID | Requirement | Priority |
|---|---|---|
| DSC-1 | A **Discover** page lists published public events that still have open shifts. | Must |
| DSC-2 | Filters for **city** and **date range**, which can be combined with an **organization** filter. | Must |
| DSC-3 | The page has a **month calendar** view and a **list (agenda)** view. The list view is the default on phones. | Must |
| DSC-4 | An organization's page reuses the same calendar and list component for its own events. | Must |
| DSC-5 | Filters for organization type and cause or category, plus keyword search and a "Near me" option. | Should |
| DSC-6 | Private events and private organizations never appear in Discover, the organization directory, the sitemap or search engines (they are marked `noindex`). | Must |
| DSC-7 | A map view and personalized recommendations. | Later |

### 4.6 Private events and invitations

| ID | Requirement | Priority |
|---|---|---|
| PRV-1 | Event visibility is either **Public** (listed and indexed) or **Private** (unlisted, not indexed, and reachable only through its private link). Every event in a private or unverified organization is private. | Must |
| PRV-2 | A host can copy the private link, or share it directly to **WhatsApp, text message or email** through the phone's own share options, with a pre-written message. The platform does not pay for messaging. | Must |
| PRV-3 | A host can paste a list of email addresses to send **email invitations** from the app, and can see who was invited and who signed up. | Must |
| PRV-4 | A host can regenerate the private link, which stops the old link working. | Should |
| PRV-5 | An **invite-only** option: only invited email addresses can sign up. Anyone else sees a "request access" message. | Should |
| PRV-6 | Sending SMS or WhatsApp messages directly from the platform (for example through Twilio or the WhatsApp Business API). | Later |

### 4.7 Communications

| ID | Requirement | Priority |
|---|---|---|
| COM-1 | Every sign-up triggers an automatic **confirmation email** listing the volunteer's shifts, role details, location, the organization's contact details, and the manage link. | Must |
| COM-2 | A host can send a **confirmation or final-details email** to all or selected volunteers, for example *"You're confirmed. Here's parking info."* | Must |
| COM-3 | A host can send an **event update** to everyone on an event, or only to certain days, roles or shifts. The update goes out by email and also appears in an *Updates* feed that signed-up volunteers can see. | Must |
| COM-4 | The app keeps a **message history** for each event and each volunteer: what was sent, to whom, and when. | Must |
| COM-5 | A host can send **organization-wide messages** to past volunteers who opted in (SGN-10). Each message has an unsubscribe link. | Should |
| COM-6 | An automatic **reminder email** goes out before each shift (24 hours before by default). This is strongly recommended because it cuts no-shows. | Should |
| COM-7 | Every email carries the organization's branding (name, logo, colour). It is sent as *"{Organization} via Sevak"*, and replies go to the organization's contact email. | Must |
| COM-8 | Emails meet deliverability and legal basics: SPF, DKIM and DMARC; a plain-text version; the organization's contact details; and an unsubscribe link on anything that isn't transactional. | Must |
| COM-9 | Scheduled sends, SMS or WhatsApp delivery, and a custom sending domain for each organization. | Later |

### 4.8 Attendance and certificates

| ID | Requirement | Priority |
|---|---|---|
| ATT-1 | A **roster** for each event and each shift shows every volunteer's name, contact details, shift and status. It is easy to use on a phone on the day. | Must |
| ATT-2 | The host team can mark each sign-up **Attended** or **No-show**, with a bulk "mark all attended" option for each shift. | Must |
| ATT-3 | **Hours are approved by the event admin.** Hours a volunteer logs (ATT-12) wait for approval. Each event has an **event admin** (chosen in the event editor from the organization's team; by default any Admin), who approves them on **Manage → Volunteers → Hours to approve**: **Approve**, **Adjust…** (approve a different amount, marked on the certificate), or **Don't approve…** with a reason the volunteer sees. **Approve all** handles a batch. The organization's Admins can approve any event's hours. Changing approved hours sends them for approval again. Only approved hours count toward certificates. The Volunteers menu link counts everything waiting. *(Prototype: `app/signups-store.js`, `app/volunteers.js`.)* | Must |
| ATT-4 | A host can add a walk-in volunteer to a shift on the day. | Should |
| ATT-5 | **Certificates on request, for a period.** A signed-in volunteer asks an organization for a certificate from **My sign-ups → Certificates**: they choose the organization and the **period** (from–to dates, or *All my hours*, *This year*, *Last year*, *Last 12 months*) and see how many **approved** hours it covers (hours still waiting aren't included; a request needs some approved hours). It is **not issued automatically**: the organization's Admins see it under **Certificate requests** on Manage → Volunteers, can **Preview** it, then **Issue** it on demand or **Decline…** with a reason. The certificate (A4 PDF) uses a template with the **organization's name** (and place and verification), *Certificate of Volunteer Service*, the volunteer's name, a **summary** (total approved hours, shifts, dates served, the events), **what they did** (each task with its description and hours) and the **detail** (every shift: date, event and task, time, hours, with adjusted hours marked), **signed by the Admin who issues it** (their drawn signature, ATT-7, or their name in a handwriting style; their title; the organization), the issue date, a **certificate number** and where to check it (ATT-6). Issuing saves the PDF in the **volunteer's Documents** and in the **Documents of each event** it covers, and emails the volunteer; they also see a one-time notice. The volunteer and the organization's team can view, download and print it; nobody else can. Coordinators can preview but not issue. *(Prototype: `app/certificates.js`, `app/certificate.html`; emails go to the outbox; the PDF is made in the browser.)* | Must |
| ATT-6 | A **certificate check page** confirms a certificate is genuine from its number and shows only the volunteer's name, the organization, the period, the approved hours, the events and the issue date. *(Prototype: `app/verify.html?code=…`, for certificates issued in this browser; live: `/verify/{code}`.)* | Must |
| ATT-7 | **Signatures.** An Admin sets, on My profile, the **title** printed under their name and **draws their signature** once (finger, stylus or mouse); it is used on every certificate they issue. Customizing the certificate wording is for later. | Should |
| ATT-8 | A host can **export the roster as CSV**, including sign-ups and attendance. | Must |
| ATT-9 | Each event has a summary showing shifts filled against capacity, the attendance rate and total hours. | Should |
| ATT-11 | **Host dashboard** for the current organization. Filters (date range: next 7, 30 or 90 days or all upcoming; status: published, drafts or both) scope everything on the page. It shows headline numbers (upcoming events, volunteers required, enrolled, spots still open) and an overall fill meter. A required-vs-enrolled bar for each event is labeled "enrolled / required · %", with a tooltip on hover or keyboard focus and a breakdown by shift. A **table view** shows the same numbers. Events that are under half full and start within 14 days are flagged **Needs volunteers** (icon and label, never color alone). Past events, cancelled sign-ups and other organizations' events are excluded. *(Prototype: `app/dashboard.html`. Until volunteer sign-up exists, a clearly marked "Add sample sign-ups" button fills in made-up numbers.)* | Must |
| ATT-12 | **Volunteers record their hours on My sign-ups.** Each shift shows what to do next. **On the day**, from an hour before the shift starts: **Check in**, then **Check out** when the task is done; Sevak works out the hours from the two times. **After the shift** (or instead of checking in): **Log hours**, either as **From and to** times (defaulting to the check-in time or the shift's times) or as **How long** (hours and minutes). The end must be after the start, and a shift can't be more than 24 hours (a shift past midnight is logged as a duration). Logged hours show on the shift (*✓ 3 h 15 min · 9:00 AM–12:15 PM*) with **Edit**. A **Today** group comes first, and a summary shows the total **hours volunteered** and how many shifts are still waiting for hours; cards with missing hours say *Hours to log*. These are the volunteer's **reported** hours: each shift shows *Waiting for approval*, *Approved* (or *Approved as …* if adjusted) or *Not approved* with the reason, and the summary shows how much is approved (ATT-3). Only approved hours go on certificates (ATT-5). *(Prototype: times use the device's clock. Loading the demo while signed in signs you up for a shift today and one in the past, to try this.)* | Must |
| ATT-10 | QR code self check-in at the venue, and GPS check-in. (Volunteers can already check in and out from My sign-ups, ATT-12.) | Later |

### 4.9 Platform administration

| ID | Requirement | Priority |
|---|---|---|
| ADM-1 | A queue for reviewing and approving or rejecting organization verification requests: each request shows the organization, who asked and when, the evidence (with the website to open and whether the email domain matches) and the note. Rejecting needs a reason. Decided requests are listed below. *(Prototype: `app/review.html`, open to anyone so both sides can be tried in one browser; in the live app only platform admins.)* | Must |
| ADM-2 | Admins can unpublish events or organizations and suspend accounts that are abusive. | Must |
| ADM-3 | A "Report this event" link on public pages. | Should |
| ADM-4 | Basic platform metrics: organizations, events, sign-ups, and emails sent or bounced. | Should |

---

### 4.10 Future: under-age volunteers

*Deferred on 2026-10-05.* The MVP does not collect date of birth and does not have age-based rules.
The requirements below are kept here for a future release.

| ID | Requirement | Priority |
|---|---|---|
| EVT-13 | A host can set a **minimum age** (for example 16+ or 18+) for the whole event or for a single role. | Later |
| SGN-12 | A person signing up for themselves confirms they are **at least 13**, or older if the event or role requires it (EVT-13). If they are too young, the form explains why and offers the parent option where it is allowed. | Later |
| SGN-13 | A **parent or guardian can sign up a child** by choosing "I'm signing up my child" and entering the child's name and age. They confirm they are the child's parent or guardian and give consent. **This is the only way a child under 13 can take part.** The parent's email and phone are used for every message. The child's name appears on the roster and the certificate. The child's age is checked against the event's minimum age. | Later |
| VOL-11 | **Profiles for volunteers aged 13–17** also need a parent or guardian's name, relationship, email and phone. The guardian's email must be different from the teen's. The teen confirms their guardian knows they're volunteering. The guardian is then emailed to confirm before the teen can sign up for shifts, and gets copies of the teen's confirmations. Teens give only a city, never a home address, and their own phone is optional. | Later |
| VOL-12 | **Anyone under 13 cannot create a profile.** The form explains that a parent or guardian must create a profile and add the child under *My children* (VOL-10). | Later |
| VOL-9 | A parent's "My volunteering" log also shows the shifts, hours and certificates of children they signed up, grouped by child. Children under 13 never have their own login. | Later |
| VOL-10 | A signed-in adult can add children under 18 to their profile (name, date of birth, and an optional school or group) after confirming they are the parent or legal guardian and consenting to storage. They can then sign a child up in one click. | Later |
| FUT-1 | Collect **date of birth** (or an age confirmation) to support EVT-13 and the rules above. Under-age data handling must follow COPPA. | Later |
| FUT-2 | A **parent / guardian** user role: an adult who signs up and manages shifts on behalf of a child. All emails go to the parent, and the child never has a login. | Later |

## 5. Visibility and privacy model

| Data | Who can see it |
|---|---|
| Public organization page and public events | Everyone. Indexed by search engines. |
| Private organization and private events | Only people with the private link (or on the invite list, if invite-only) and the organization's team. Never listed or indexed. |
| Who has signed up for a shift | The organization's team only. Public pages show counts (*"4 of 6 spots left"*), never names. |
| A volunteer's contact details | The volunteer, and the team of any organization whose event they signed up for, for that organization's events only. |
| "My volunteering" log | The volunteer only. |
| Certificate | The volunteer and the issuing organization. Anyone with the verification link sees only the name, event, organization and hours. |

---

## 6. Screens for the front-end build

This is the list of screens to build in Phase 1 with mock data.

**Public and volunteer**

| # | Screen | Notes |
|---|---|---|
| P1 | Home or landing | The coming-soon page now. A marketing home page later. |
| P2 | Discover | Calendar and list views, with city, date and organization filters |
| P3 | Organization page | Profile, badge and upcoming events |
| P4 | **Event page and shift picker** | **The most important screen.** Shifts grouped by day, tick several |
| P5 | Sign-up form and confirmation | Name, email and phone, then done |
| P6 | Manage my sign-up | Opened from the email link: view, add or cancel shifts |
| P7 | Sign in | Email address, then a one-time sign-in link |
| P8 | My volunteering | Private log, hours and certificates |
| P9 | Certificate verification | Public, shows minimal data |

**Host**

| # | Screen | Notes |
|---|---|---|
| H1 | Organization setup and settings | Includes the verification request |
| H2 | Host dashboard | Events split into Drafts, Upcoming and Past, plus volunteers required vs enrolled. *(Prototype: the Events tab, `app/events.html`, and the Dashboard tab, `app/dashboard.html`.)* |
| H3 | **Event editor** *(prototype: `app/event.html`)* | Details → Roles → Shifts (grid with "copy to other days") → Visibility → Publish |
| H4 | Share and invite | Copy link, WhatsApp, text and email invitations |
| H5 | Roster and attendance | Designed for phones, used on the day |
| H6 | Compose an update, and message history | Choose the audience by day, role or shift |
| H7 | Issue certificates | Preview, then send |
| H8 | Team | Invite and remove team members |

**Admin:** A1, the verification queue and moderation tools.

**UX principles**

1. **Phone first.** The path from event page to sign-up to confirmation must work one-handed on a
   phone.
2. **No account walls** for volunteers. Ask only for a name and email, plus an optional phone
   number.
3. **One main action per screen**, in plain language (*shift*, *spots left*, *sign up*).
4. **Clean, trustworthy pages.** The organization's brand leads, and the verification badge is
   always visible.
5. **Accessible.** Meets WCAG 2.1 AA.

---

## 7. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Performance | Public event and Discover pages reach Largest Contentful Paint in **under 2 seconds** on a mid-range phone over 4G (75th percentile). |
| NFR-2 | Capacity | Sized for about **200 organizations and 20,000 volunteers** in the MVP. A single event must handle **500 sign-ups within 10 minutes** without errors or overbooking. |
| NFR-3 | Availability | A 99.5% monthly uptime target. Failed email sends are retried. |
| NFR-4 | Authentication | Everyone signs in with a passwordless one-time email link. **Platform admins must use 2FA.** 2FA for hosts is a Should. |
| NFR-5 | Data protection | TLS everywhere, encryption at rest, and no secrets in the repository. An organization's data is only visible to that organization's team. |
| NFR-6 | Abuse prevention | Rate limits and bot protection on public forms. Private and manage links use long tokens that can't be guessed. |
| NFR-7 | Privacy | Collect as little data as possible. Meet GDPR and CCPA basics: a privacy policy, consent for non-transactional email, and data export and deletion. Volunteer data is never sold or shared. |
| NFR-8 | Minors | Deferred (see §4.10). The MVP collects no date of birth or age information. Under-age support must comply with COPPA when it is built. |
| NFR-9 | Accessibility | WCAG 2.1 AA: fully usable by keyboard, with labelled controls and enough colour contrast. |
| NFR-10 | SEO | Public pages are rendered on the server or pre-rendered, with meta tags, Open Graph tags, schema.org `Event` data and a sitemap. Private content is marked `noindex`. |
| NFR-11 | Time zones | Each event has its own time zone, and times are shown in the event's local time. Multi-day events handle daylight saving changes correctly. |
| NFR-12 | Browsers | The latest two versions of Chrome, Safari (including iOS), Firefox and Edge. |
| NFR-13 | Maintainability | The front end and back end are separated by an API. The code is typed. Automated tests cover the core flows (sign-up, capacity, attendance, certificates), and local setup is one command. |
| NFR-14 | Global use | Sevak is built for use **in any country**, and nothing assumes the US. Addresses have a country and use country-neutral fields ("State, province or region", "Postal code"), with postal-code formats checked for some countries and a lenient check elsewhere. Country names show in the visitor's language, and the country defaults from their browser settings. The interface is English-only for the MVP, with dates and times formatted for the user's locale. |
| NFR-16 | Phone numbers and WhatsApp | Every phone number is entered with a **country code** (a country picker plus the number, or a number typed with a leading +). It is stored in international **E.164** form (for example +14155550100 or +447911123456), dropping a national leading 0 or a US/Canada leading 1. Each number can be marked **"on WhatsApp"**, which gives it a `wa.me` link so hosts and volunteers can message it directly. |
| NFR-15 | Email deliverability | Sending from an authenticated domain, with bounce and complaint handling and suppression of bounced addresses. |

---

## 8. Data model (MVP)

| Entity | Key fields | Relationships |
|---|---|---|
| **User** | id, email (unique), first_name, last_name, phone (E.164), phone_country, phone_whatsapp, gender (optional: `woman`/`man`/`non-binary`/`another`/`prefer-not`), is_volunteer, is_host, address (country, line1, line2, city, state, postal_code; optional, volunteers only), availability (`weekends`/`weekdays`/`evenings`/`anytime`), is_platform_admin, created_at | One user can be a volunteer, a host team member, or both. A host team member can belong to several Organizations with a different role in each (through OrgMember). |
| **Affiliation** | id, user_id, type (`school`/`scouting`/`faith`/`workplace`/`club`/`other`), name | Up to 5 per User |
| **Organization** | id, name, slug, type, description, logo_url, website, whatsapp_link, address (country, line1, line2, city, state, postal_code), charity_status (`charity`/`nonprofit-other`/`pending`/`none`), registration_number (private), primary_contact_user_id, contact_title, visibility (`public`/`private`), verification_status (`unverified`/`pending`/`verified`/`rejected`), invite_code (replaceable), auto_approve | Has many OrgMembers and Events |
| **OrgMember** | org_id, user_id (or invited email), role (`owner`/`admin`/`coordinator`/`volunteer`), status (`invited`/`requested`/`active`/`declined`), note, invited_by, invited_at, requested_at, decided_by, decided_at. Unique per (org_id, user_id). | Links a User to an Organization: as a team member, or as a volunteer (MEM-1) |
| **VerificationRequest** | id, org_id, evidence, status, reviewed_by, reviewed_at | Belongs to an Organization |
| **MainEvent** | id, org_id, title, description, created_at | Belongs to an Organization. Has many Events (its sub-events) |
| **Event** | id, org_id, main_event_id (optional), title, slug, description, cover_url, venue, address, city, is_online, timezone, start_date, end_date, visibility (`public`/`private`), invite_only, private_token, status (`draft`/`published`/`completed`/`cancelled`) | Belongs to an Organization. Has many Roles, Shifts, Messages and Invites |
| **Role** | id, event_id, name, description, requirements | Belongs to an Event. Has many Shifts |
| **Shift** | id, event_id, role_id, starts_at, ends_at (stored in UTC), capacity | Belongs to a Role. Has many Signups |
| **Registration** | id, event_id, user_id, manage_token, opted_in_updates, answers (JSON), created_at | One form submission. Has many Signups |
| **Signup** | id, registration_id, shift_id, status (`confirmed`/`cancelled`), check_in_at, check_out_at, reported_minutes, reported_from, reported_to, report_method (`check-in`/`times`/`duration`), reported_at, attendance (`unmarked`/`attended`/`no_show`), hours_credited | One volunteer on one Shift. *Reported* hours come from the volunteer (ATT-12); hours *credited* are confirmed by the host (ATT-3). |
| **Invite** | id, event_id, email, sent_at, registration_id (set once they sign up) | Belongs to an Event |
| **Message** | id, org_id, event_id (optional), audience_filter, subject, body, sent_by, sent_at | Has many MessageDeliveries (recipient, status) |
| **Certificate** | id, registration_id, verification_code, hours, pdf_url, issued_by, issued_at | One per volunteer per event |
| **Document** | id, owner_type (`organization`/`event`/`user`), owner_id, name, description, file_name, content_type, size_bytes, storage_key, uploaded_by (user_id), uploaded_at, updated_at | Belongs to one Organization, Event or User |

---

## 9. External services (MVP)

| Need | Example options | Priority |
|---|---|---|
| Transactional email | Postmark, Resend, Amazon SES, SendGrid | Must |
| Bot protection | Cloudflare Turnstile, hCaptcha | Must |
| File storage (logos, covers, PDFs) | Any S3-compatible storage | Must |
| PDF generation (certificates) | Server-side HTML-to-PDF rendering | Must |
| Address and city autocomplete | A places or geocoding API | Should (the MVP can use typed address and city fields) |

---

## 10. Roadmap

| Phase | Goal | Output |
|---|---|---|
| **0: Now** | Vet requirements and claim a public URL | This document and a coming-soon landing page on GitHub Pages |
| **1: Front end** | Get feedback on the experience before building the back end | Every MVP screen (§6) built as a clickable prototype with mock data, deployed to GitHub Pages and reviewed with 2–3 pilot organizations |
| **2: Back end and email** | Make it real | Data model, email sign-in, sign-up with capacity checks, emails and certificates, deployed on a very simple architecture (to be designed) |
| **3: Pilot** | Prove the core loop | A handful of organizations in one or two cities, measured against §11 |

**Long term (post-MVP)**

- **One source of truth for event information.** Automatically import or sync events from
  ticketing platforms (Eventbrite, Luma, Meetup) and social media (Facebook and Instagram events),
  so public events show the same details everywhere. This fixes a common problem where different
  sites list different information, and the canonical event page builds consistent SEO.
- Native mobile apps (iOS and Android)
- SMS and WhatsApp messages sent from the platform, scheduled sends, and custom sending domains
- QR code self check-in, waitlists, host-approved sign-ups and recurring event series
- Skills and availability matching, recommendations, and a map view
- Public volunteer profiles and badges
- Integrations with CRM (such as Salesforce), SSO and background check vendors
- More languages

---

## 11. Pilot success metrics

- Median time for a volunteer to sign up: **under 60 seconds**
- Time for a host to create a two-day event with three roles: **under 10 minutes**
- Share of shift capacity filled on pilot events: **80% or more**
- No-show rate: measure a baseline, then bring it down with reminders (COM-6)
- Share of completed events where the host issued certificates

---

## 12. Decisions and open questions

### 12.1 Decisions (2026-09-30)

| # | Question | Decision |
|---|---|---|
| Q1 | What is the product name? | **Sevak.** The domain is still to be chosen. |
| Q2 | Does an organization have to be verified before it can list **public** events? | **Yes.** Unverified organizations can still run **private** events (ORG-3, ORG-6, PRV-1). The MVP uses manual review of a charity or tax registration number (such as a US EIN or a UK charity number), a website, or an email on the organization's domain. |
| Q3 | Should sign-ups be confirmed automatically, or should hosts approve each one? | **Automatic.** COM-2 lets hosts send a "you're confirmed" email. Host approval stays in Later (SGN-11). |
| Q4 | What is the policy for minors? | **Deferred (2026-10-05).** The MVP doesn't collect date of birth and has no age rules. The earlier proposal (a minimum age of 13, parents signing up younger children, and event minimum ages) is kept as future requirements in §4.10. |
| Q10 | Hosting | **Front end only for now, hosted on GitHub Pages.** Server rendering for SEO (NFR-10) gets revisited when we design the Phase 2 back end and deployment. |

### 12.2 Still open

| # | Question | Recommendation |
|---|---|---|
| Q5 | Should public pages show the first names of people who signed up? | No. Show counts only. |
| Q6 | What goes on the certificate (hours, signer, logo)? Does "official" require sending from the organization's own email domain? | Include hours, the signer's name and title, and a verification link. Send as *"{Organization} via Sevak"* in the MVP, with custom domains later. |
| Q7 | Where do we launch first? | Sevak is built for any country (NFR-14). Choose one or two pilot cities, which don't have to be in the US. |
| Q8 | What does it cost? | Free during the pilot. Decide on pricing afterwards. |
| Q9 | How long do organizations keep a volunteer's records after the volunteer deletes their account? | Keep the attendance records and certificates the organization issued. Remove the volunteer's profile and login. |

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Sevak** | The product name |
| **MVP** | Minimum viable product: the smallest version that proves the core loop |
| **Host** | An organization, and its team, that publishes events |
| **Volunteer** | A person who signs up for shifts |
| **Event** | A single-day or multi-day activity that needs volunteers |
| **Role** | A job at an event, such as *Setup crew* |
| **Shift** | One role in one time window, with a capacity |
| **Capacity** | The number of volunteers a shift needs |
| **Registration** | One sign-up form submission, which can cover several shifts |
| **Roster** | The list of volunteers signed up for an event or shift |
| **Attendance** | The host's record of *Attended* or *No-show* for a sign-up |
| **Certificate** | Branded proof of participation that can be verified |
| **Public / Private** | Visibility levels. Private content is reachable only by link or invitation and is never indexed. |
| **Invite-only** | A private event where only invited email addresses can sign up |
| **One-time sign-in link** | Passwordless sign-in: a single-use link sent by email |
| **Verified** | An organization whose identity a platform admin has reviewed. Required before it can list public events. |
| **Parent / guardian** | *(Future, §4.10)* An adult who signs up and manages shifts on behalf of a child |
| **SEO** | Search engine optimization |
| **2FA** | Two-factor authentication |
| **BGC** | Background check (post-MVP) |
| **SPF / DKIM / DMARC** | Email authentication standards that help email reach the inbox |
| **WCAG** | Web Content Accessibility Guidelines |
