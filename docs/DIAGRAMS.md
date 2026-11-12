# Sevak: UML Diagrams

**Updated:** 2026-11-12 · Based on [`REQUIREMENTS.md`](REQUIREMENTS.md),
[`ARCHITECTURE.md`](ARCHITECTURE.md) and the code

Each diagram shows what Sevak does now, on staging. Anything not built yet is marked *(planned)*.
IDs such as SGN-5 refer to the requirements. GitHub draws these diagrams from their text: change
the text and the picture updates.

1. [Who uses Sevak and what they do](#1-who-uses-sevak-and-what-they-do) (use cases)
2. [Data model](#2-data-model) (class diagram)
3. [Life of an event](#3-life-of-an-event) (state diagram)
4. [Life of a sign-up](#4-life-of-a-sign-up) (state diagram)
   - [Verifying an organization](#4a-verifying-an-organization) (state diagram)
5. [A volunteer signs up](#5-a-volunteer-signs-up) (sequence diagram)
6. [Signing in](#6-signing-in) (sequence diagram)
7. [Joining an organization's team](#7-joining-an-organizations-team) (activity diagram)
   - [Joining as a volunteer](#7a-joining-as-a-volunteer) (activity diagram)
8. [How the system fits together](#8-how-the-system-fits-together) (deployment diagram)

---

## 1. Who uses Sevak and what they do

A person can be a volunteer and on organizations' teams at the same time (VOL-13). Coordinator and
Admin are roles in the whole organization (ORG-13); a Task lead is a volunteer chosen for one task
(EVT-21); the event admin is the Admin or Coordinator who approves an event's hours (ATT-3).

```mermaid
flowchart LR
    V(["👤 Volunteer"])
    L(["👤 Task lead"])
    C(["👤 Coordinator"])
    A(["👤 Admin"])
    P(["👤 Sevak staff"])

    subgraph Volunteer side
        UC0["Join an organization<br/>(invitation, code or request)"]
        UC1["Find opportunities<br/>(My organizations / All)"]
        UC2["Sign up for shifts"]
        UC3["Cancel a sign-up"]
        UC4["Check in and out,<br/>or log hours"]
        UC5["Request a certificate"]
        UC6["Keep a profile and<br/>personal documents"]
        UC7["See the roster of<br/>a task they lead"]
    end

    subgraph Running events
        UC8["Create and edit events,<br/>tasks and shifts (4 steps)"]
        UC9["Group events under<br/>a main event"]
        UC10["Publish, unpublish or<br/>make an event inactive"]
        UC11["View the dashboard"]
        UC12["Add organization<br/>and event documents"]
        UC13["Approve hours<br/>(as event admin)"]
        UC14["Roster, attendance,<br/>updates (planned)"]
    end

    subgraph Organization admin
        UC15["Edit the organization<br/>profile and team"]
        UC16["Approve, invite and<br/>remove volunteers"]
        UC17["Choose task leads"]
        UC18["Issue certificates"]
        UC19["Delete events or<br/>the organization"]
        UC20["Request verification"]
    end

    subgraph Platform
        UC21["Verify or reject<br/>organizations"]
        UC22["Moderate content (planned)"]
    end

    V --- UC0 & UC1 & UC2 & UC3 & UC4 & UC5 & UC6
    L --- UC7
    L -. "is a volunteer" .-> V
    C --- UC8 & UC9 & UC10 & UC11 & UC12 & UC13 & UC14
    A -. "can also do everything<br/>a Coordinator can" .-> C
    A --- UC15 & UC16 & UC17 & UC18 & UC19 & UC20
    UC21 & UC22 --- P
```

Nobody approves their own hours or issues their own certificate; an Admin's own need another
Admin or Sevak staff. Sevak staff can also do what an organization's Admins do.

---

## 2. Data model

The target model from §8 of the requirements: the tables in `packages/db/src/schema.ts` follow
it. Until each screen moves to them, the pages' data is kept as JSON in the `records` table, one
collection per kind ([`ARCHITECTURE.md`](ARCHITECTURE.md) §6). Only the main fields are shown.

```mermaid
classDiagram
    direction LR

    class User {
        id
        email «unique»
        first_name
        last_name
        phone «E.164»
        photo_url
        about_me
        is_volunteer
        is_host
        availability
        is_platform_admin
    }
    class Affiliation {
        type
        name
    }
    class UserService {
        service_type
    }
    class Organization {
        id
        name
        slug «unique»
        type
        charity_status
        registration_number «private»
        visibility
        verification_status
        invite_code «unique»
        auto_approve
    }
    class OrgMember {
        role : owner | admin | coordinator | volunteer
        status : invited | requested | active | declined
        how : invitation | request | auto-approved
        note
        decided_at
        decided_by
    }
    class MainEvent {
        title
        description
    }
    class Event {
        title
        slug «unique»
        timezone
        start_date
        end_date
        visibility
        status
        is_active
        event_admin
        private_token «hashed»
    }
    class Role {
        «shown as Task»
        name
        description
        requirements
        lead «a member's email»
    }
    class Shift {
        starts_at «UTC»
        ends_at «UTC»
        capacity
        filled
    }
    class Registration {
        manage_token «hashed»
        opted_in_updates
        answers «JSON»
    }
    class Signup {
        status : confirmed | cancelled
        check_in_at
        check_out_at
        reported_minutes
        report_method : check-in | times | duration
        hours_credited
    }
    class Certificate {
        period_from
        period_to
        status : requested | issued | declined
        verification_code «unique»
        hours
        signed_by
    }
    class Document {
        owner_type : organization | event | user
        name
        size_bytes
        storage_key
        uploaded_by
    }

    User "1" -- "0..5" Affiliation
    User "1" -- "*" UserService
    User "1" -- "*" OrgMember
    Organization "1" -- "1..*" OrgMember
    Organization "1" -- "*" MainEvent
    Organization "1" -- "*" Event
    MainEvent "0..1" -- "*" Event : groups
    Event "1" -- "*" Role
    Role "1" -- "*" Shift
    User "0..1" -- "*" Role : leads
    Event "1" -- "*" Registration
    User "1" -- "*" Registration
    Registration "1" -- "1..*" Signup
    Shift "1" -- "*" Signup
    User "1" -- "*" Certificate
    Organization "1" -- "*" Certificate
    Organization "1" -- "*" Document
    Event "1" -- "*" Document
    User "1" -- "*" Document
```

Not shown: VerificationRequest, Invite, and Message with MessageDelivery (event updates,
*planned*). A certificate covers a period and can include several events' approved hours (ATT-5).

---

## 3. Life of an event

An event's **status** (EVT-4, EVT-15) and its **inactive** flag (EVT-19) are separate: making an
event inactive hides it without losing its status, and **Reactivate** puts it back exactly as it
was. Any team member can make an event inactive; only Admins can delete one, from any state.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Draft : Save draft<br/>(name and dates)
    Draft --> Published : Publish<br/>(every step complete,<br/>tasks with shifts)
    Published --> Draft : Unpublish
    Published --> Completed : End date passes<br/>(planned)
    Draft --> Cancelled : Cancel (planned)
    Published --> Cancelled : Cancel and email<br/>volunteers (planned)

    Draft --> InactiveDraft : Make inactive
    InactiveDraft --> Draft : Reactivate
    Published --> InactivePublished : Make inactive
    InactivePublished --> Published : Reactivate

    state "Inactive (was a draft)" as InactiveDraft
    state "Inactive (was published)" as InactivePublished

    Completed --> [*]
    Cancelled --> [*]
```

| State | Volunteers can find it | Volunteers can sign up | On the dashboard |
|---|---|---|---|
| Draft | No (the team only) | No | Yes, if the filter includes drafts |
| Published | Its organization's volunteers; everyone, if public and the organization is verified | Members (SGN-2) | Yes |
| Inactive | No (its link says it's no longer available) | No | No |

---

## 4. Life of a sign-up

One sign-up is one volunteer on one shift. On the day the volunteer can check in and out, or log
their hours afterwards (ATT-12); those are *reported* hours. The event admin approves them,
possibly adjusted, or doesn't (ATT-3). Only approved hours count toward a certificate, which the
volunteer requests for a period and an Admin issues (ATT-5). Marking no-shows on a roster (ATT-2)
is *planned*.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Confirmed : Sign up<br/>(spot taken, email sent)
    Confirmed --> Cancelled : Volunteer cancels<br/>on My sign-ups (spot freed)
    Cancelled --> [*]

    state Confirmed {
        direction LR
        [*] --> Booked
        Booked --> CheckedIn : Volunteer checks in<br/>(from 1 hour before)
        CheckedIn --> HoursReported : Volunteer checks out
        Booked --> HoursReported : Volunteer logs hours<br/>(from–to or duration)
        HoursReported --> HoursReported : Volunteer edits hours
        HoursReported --> Approved : Event admin approves<br/>(or adjusts)
        HoursReported --> NotApproved : Event admin doesn't approve<br/>(with a reason)
        NotApproved --> HoursReported : Volunteer corrects hours
        Approved --> HoursReported : Volunteer changes hours
        Approved --> OnCertificate : An Admin issues a certificate<br/>for a period that includes it
        Booked --> NoShow : Host marks no-show (planned)
    }
```

---

## 4a. Verifying an organization

An Admin asks; Sevak's staff decide on `app/review.html` (ORG-3, ADM-1). Both sides are emailed.

```mermaid
stateDiagram-v2
    [*] --> Unverified : organization saved
    Unverified --> Pending : Admin requests<br/>(registration number or website)
    Pending --> Unverified : Admin withdraws
    Pending --> Verified : Sevak verifies
    Pending --> Rejected : Sevak rejects, with a reason
    Rejected --> Pending : Admin asks again
    Verified --> Pending : Admin changes the name, website,<br/>registration number or tax status
    note right of Verified : Verified badge.<br/>Public events are listed.
    note right of Unverified : Public events stay private,<br/>reachable by link.
```

---

## 5. A volunteer signs up

The most important flow (SGN-2, SGN-5, COM-1). The page saves sign-ups like any other data, and
the server decides (`packages/core/src/signups.ts`). Everything in the transaction happens
together or not at all, so a shift is never overbooked.

```mermaid
sequenceDiagram
    autonumber
    actor V as Volunteer (phone)
    participant P as Page (signup.html + sync.js)
    participant W as API (/api/v1)
    participant DB as Database
    participant E as Email (Resend)

    V->>P: Open the event (from a shared link)
    P->>W: GET /api/v1/sync
    W->>DB: What this person may see
    W-->>P: Events, spots taken (no names), their own sign-ups
    P-->>V: Shifts grouped by day and task, spots left

    V->>P: Tick shifts, Confirm
    P->>W: POST /api/v1/sync/sevak.signups.v1

    rect rgba(120, 160, 255, 0.15)
        Note over W,DB: One transaction
        W->>DB: Lock the events involved
        W->>DB: Check membership and published event
        loop Each new sign-up
            W->>DB: Count the shift's active sign-ups
            alt Spot left
                W->>DB: Save the sign-up
            else Shift is full
                W-->>P: Refused ("full"), with the server's copy
            end
        end
    end

    W-->>P: Saved
    P-->>V: Confirmation, Add to calendar (.ics and Google)
    W->>E: Confirmation email listing the shifts (best effort)
    E-->>V: Email arrives
    Note over W,E: Reminders before each shift (COM-6) are planned
```

---

## 6. Signing in

Passwordless (VOL-1, NFR-4). The email has both a **link** and a **6-digit code**: on iPhone, an app
added to the home screen doesn't share sign-in with Safari, so the code lets people finish signing
in inside the installed app. The link carries its token after `#`, so it never reaches a server
log. **Continue with Google** is the other way in, where the environment has it set up.

```mermaid
sequenceDiagram
    autonumber
    actor U as Person
    participant P as signin.html
    participant W as API (/api/v1/auth)
    participant DB as Database
    participant E as Email (Resend)

    U->>P: Enter email
    P->>W: POST /auth/request {email}
    W->>DB: Count the try (rate limits), save token and code (hashed, 15 min)
    W->>E: "123456 is your Sevak sign-in code" (code + link)
    W-->>P: "Check your email"

    alt Taps the link (signin.html#token=…)
        P->>W: POST /auth/verify {token}
    else Types the code
        P->>W: POST /auth/verify {email, code}
    end

    W->>DB: Check hash, not expired, not used, tries left, then mark used
    W->>DB: Create session (stored hashed)
    W-->>P: __Host- session cookie
    P-->>U: The page they were on, or opportunities<br/>(someone new: their profile first)

    opt Sevak staff (planned)
        W-->>U: Ask for an authenticator (TOTP) code
    end
```

---

## 7. Joining an organization's team

The two ways onto a team (ORG-13). Being added takes effect straight away; the email tells the
person to sign in.

```mermaid
flowchart TD
    S([Signed-in person opens a Manage page]) --> Q{On this<br/>organization's team?}
    Q -- Yes --> R{Role?}
    R -- Admin --> PA[Full access:<br/>profile, team, volunteers,<br/>task leads, certificates, delete]
    R -- Coordinator --> PC[Run events, dashboard, documents.<br/>Profile read-only; no volunteers list]
    Q -- No --> N["'You're not on this team'<br/>with the two ways in"]
    N --> W1[Set up a new organization]
    W1 --> AD[You become its Admin]
    N --> W2[Ask an Admin to add you]
    W2 --> INV["Admin adds your email on the Team tab<br/>(as Admin or Coordinator)"]
    INV --> EM["Email: You're on the team of X"]
    EM --> R
    AD --> R
```

---

## 7a. Joining as a volunteer

A volunteer can sign up for an organization's shifts only once they're one of its volunteers: by
invitation, by its invite code, or by asking to join and being approved (MEM-1 to MEM-5). Only
the organization's Admins (and Sevak staff) see and decide requests.

```mermaid
flowchart TD
    S([Person wants to volunteer]) --> H{How?}
    H -- "Invite link or code" --> I[Join page: link or code<br/>checked by the server]
    H -- "Emailed invitation" --> E[Sign in with the invited email]
    H -- "Ask to join" --> Q[Join page: find the organization,<br/>add a note]
    I --> P{Has a profile?}
    Q --> P
    P -- No --> NP[Make a profile;<br/>the choice is kept]
    P -- Yes --> J
    NP --> J{Code, or the organization<br/>approves automatically?}
    E --> ACT
    J -- Yes --> ACT[Active volunteer<br/>+ welcome email]
    J -- No --> REQ[Request waiting<br/>+ email to the Admins]
    REQ --> D{An Admin, on<br/>Manage → Volunteers}
    D -- Approve --> ACT
    D -- Decline --> DEC[Declined + email;<br/>can be approved later]
    ACT --> SU[Sign up for its shifts]
```

---

## 8. How the system fits together

One app service and one database per environment, on Google Cloud. Staging deploys on every merge
into `staging`; production only from `main`, which only the owner updates
([`ARCHITECTURE.md`](ARCHITECTURE.md) §1–§2, [`ENVIRONMENTS.md`](ENVIRONMENTS.md)).

```mermaid
flowchart LR
    subgraph Device["Phone or desktop"]
        B["The pages (app/)<br/>+ sync.js"]
        LS[("localStorage<br/>a copy, cleared on sign-out")]
    end

    subgraph GCP["Google Cloud project (one per environment)"]
        RUN["Cloud Run: sevak-web<br/>Next.js, /api/v1"]
        JOB["Cloud Run job: sevak-tasks<br/>migrations before each deploy"]
        SQL[("Cloud SQL<br/>PostgreSQL 18")]
        GCS[("Cloud Storage<br/>uploaded files, private")]
        SM["Secret Manager"]
        MON["Uptime alert,<br/>Error Reporting, budget alert"]
    end

    RES["Resend (email)"]
    GOO["Google sign-in"]
    ZEF["Zeffy (event import)"]
    GH["GitHub: CI, then deploy<br/>(Workload Identity, no stored keys)"]

    B <--> LS
    B -- HTTPS --> RUN
    RUN --> SQL
    RUN --> GCS
    RUN --> SM
    JOB --> SQL
    RUN --> RES
    RUN --> GOO
    RUN --> ZEF
    GH -- "image, migrations, new revision" --> RUN
    GH --> JOB
    SQL -. "nightly backups" .-> SQL
```

`sevak.theanbgroup.com` still shows the last prototype published to GitHub Pages until production
launches there.
