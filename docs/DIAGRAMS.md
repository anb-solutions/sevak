# Sevak: UML Diagrams

**For discussion** · **Updated:** 2026-11-02 · Based on [`REQUIREMENTS.md`](REQUIREMENTS.md) and the
prototype in [`app/`](../app/)

These diagrams are a starting point for discussion, not a final design. Each one says whether it
shows **what the prototype does today** or **the proposed back end** from
[`ARCHITECTURE.md`](ARCHITECTURE.md). IDs such as SGN-5 refer to the requirements.

GitHub draws these diagrams automatically. To edit one, change its text and the picture updates.

1. [Who uses Sevak and what they do](#1-who-uses-sevak-and-what-they-do) (use cases)
2. [Data model](#2-data-model) (class diagram)
3. [Life of an event](#3-life-of-an-event) (state diagram)
4. [Life of a sign-up](#4-life-of-a-sign-up) (state diagram)
   - [Verifying an organization](#4a-verifying-an-organization) (state diagram)
5. [A volunteer signs up](#5-a-volunteer-signs-up) (sequence diagram)
6. [Signing in by email](#6-signing-in-by-email) (sequence diagram)
7. [Joining an organization's team](#7-joining-an-organizations-team) (activity diagram)
   - [Joining as a volunteer](#7a-joining-as-a-volunteer) (activity diagram)
8. [How the system fits together](#8-how-the-system-fits-together) (component and deployment diagram)

---

## 1. Who uses Sevak and what they do

*Today and planned.* Actors on the left and right; the things they do in the middle. A person can be
a volunteer and a host team member at the same time (VOL-13). Items marked *(planned)* aren't in the
prototype yet.

```mermaid
flowchart LR
    V(["👤 Volunteer"])
    C(["👤 Coordinator"])
    A(["👤 Admin / Owner"])
    P(["👤 Platform admin"])

    subgraph Volunteer side
        UC0["Join an organization<br/>(invitation or request)"]
        UC1["Find opportunities<br/>(My organizations / All)"]
        UC2["Sign up for shifts"]
        UC3["Manage or cancel a sign-up"]
        UC4["View My sign-ups,<br/>check in and log hours"]
        UC5["Keep a profile, photo<br/>and personal documents"]
    end

    subgraph Running events
        UC6["Create and edit events,<br/>roles and shifts"]
        UC7["Group events under<br/>a main event"]
        UC8["Publish, unpublish or<br/>make an event inactive"]
        UC9["View the dashboard"]
        UC10["Upload organization<br/>and event documents"]
        UC11["Mark attendance and<br/>issue certificates (planned)"]
        UC12["Send updates (planned)"]
    end

    subgraph Organization admin
        UC13["Edit the organization profile"]
        UC14["Add team members"]
        UC19["Approve requests, invite<br/>and remove volunteers"]
        UC15["Delete events or<br/>the organization"]
        UC16["Request verification (planned)"]
    end

    subgraph Platform
        UC17["Approve verification (planned)"]
        UC18["Moderate content (planned)"]
    end

    V --- UC0 & UC1 & UC2 & UC3 & UC4 & UC5
    C --- UC6 & UC7 & UC8 & UC9 & UC10 & UC11 & UC12 & UC19
    A -. "can also do everything<br/>a Coordinator can" .-> C
    A --- UC13 & UC14 & UC15 & UC16
    UC17 & UC18 --- P
```

An Admin can do everything a Coordinator can, plus the *Organization admin* items (ORG-5, ORG-13,
EVT-19).

**To discuss:** should Coordinators be able to add team members, or only Admins (today: only
Admins)?

---

## 2. Data model

*Proposed back end.* The entities from §8 of the requirements, plus what the prototype has added
since: documents (ORG-12, EVT-18, VOL-14), the profile's photo and *Get to know me* fields (VOL-15,
VOL-16), services, and inactive events (EVT-19). Only the main fields are shown.

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
        invited_at
        requested_at
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
        private_token «hashed»
    }
    class Role {
        name
        description
        requirements
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
        attendance : unmarked | attended | no_show
        hours_credited
    }
    class Certificate {
        period_from
        period_to
        status : requested | issued | declined
        verification_code «unique»
        hours
        signed_by
        pdf_url
    }
    class Document {
        owner_type : organization | event | user
        name
        description
        size_bytes
        storage_key
        uploaded_by
    }
    class Message {
        audience_filter
        subject
        body
        sent_at
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
    Event "1" -- "*" Registration
    User "1" -- "*" Registration
    Registration "1" -- "1..*" Signup
    Shift "1" -- "*" Signup
    Registration "1" -- "0..1" Certificate
    Organization "1" -- "*" Message
    Organization "1" -- "*" Document
    Event "1" -- "*" Document
    User "1" -- "*" Document
```

Not shown: VerificationRequest, Invite and MessageDelivery. This is the shape of the data, not a
choice of database.

**To discuss:**
- `Document` points at its owner with `owner_type` + `owner_id`. The alternative is three link
  tables, which lets the database enforce the link but adds tables.
- Should a guest volunteer (no account) still get a `User` row, keyed by email? The proposal says
  yes: it keeps *My sign-ups* simple when they sign in later.

---

## 3. Life of an event

*Today (prototype) and planned.* An event's **status** (EVT-4, EVT-15) and its **inactive** flag
(EVT-19) are separate: making an event inactive hides it without losing its status, and
**Reactivate** puts it back exactly as it was. That's why there are two inactive boxes. Any team
member can make an event inactive; only Admins can delete one, from any state.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Draft : Save draft<br/>(name and dates only)
    Draft --> Published : Publish<br/>(roles and shifts complete)
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
| Draft | No (host preview only) | No | Yes, if the filter includes drafts |
| Published | Yes, if public and the organization is verified | Yes | Yes |
| Inactive | No (its link says it's no longer available) | No | No |
| Completed / Cancelled | No | No | No (past or cancelled) |

**To discuss:** can a published event with sign-ups be deleted, or only made inactive or cancelled?

---

## 4. Life of a sign-up

*Today (prototype) and planned.* One `Signup` is one volunteer on one shift. On the day the
volunteer can check in and out, or log their hours afterwards (ATT-12); those are *reported* hours.
The event admin approves them, possibly adjusted, or doesn't (ATT-3). Only approved hours count
toward a certificate, which the volunteer requests for a period and an Admin issues (ATT-5).
Marking attendance and no-shows on a roster (ATT-2) is planned.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Confirmed : Sign up<br/>(spot taken, email sent)
    Confirmed --> Cancelled : Volunteer cancels via manage link<br/>or host cancels the shift<br/>(spot freed)
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

*Today (prototype) and planned.* An Admin asks; Sevak's staff decide (ORG-3, ADM-1). In the
prototype the review queue is `app/review.html` and emails go to the outbox.

```mermaid
stateDiagram-v2
    [*] --> Unverified : organization saved
    Unverified --> Pending : Admin requests<br/>(registration number or website)
    Pending --> Unverified : Admin withdraws
    Pending --> Verified : Sevak verifies
    Pending --> Rejected : Sevak rejects, with a reason
    Rejected --> Pending : Admin asks again
    Verified --> [*]
    note right of Verified : Verified badge.<br/>Public events are listed.
    note right of Unverified : Public events stay private,<br/>reachable by link.
```

---

## 5. A volunteer signs up

*Proposed back end.* The most important flow (SGN-2, SGN-5, SGN-6, COM-1). Everything inside the
transaction happens together or not at all, so a shift can never be overbooked and an email is
never sent for a sign-up that failed.

```mermaid
sequenceDiagram
    autonumber
    actor V as Volunteer (phone)
    participant W as Web app
    participant T as Turnstile
    participant DB as Database
    participant Q as Job queue
    participant E as Email (Postmark)

    V->>W: Open /e/food-drive (from a WhatsApp link)
    W->>DB: Event, roles, shifts, spots left
    W-->>V: Page with shifts grouped by day

    V->>W: Tick shifts, enter name and email, Sign up
    W->>T: Check bot token
    T-->>W: OK

    rect rgba(120, 160, 255, 0.15)
        Note over W,DB: One transaction
        W->>DB: Find or create User by email
        W->>DB: Create Registration (manage token, stored hashed)
        loop Each shift, in id order
            W->>DB: Take a spot only if one is left<br/>(a single atomic step)
            alt Spot taken
                W->>DB: Insert Signup (confirmed)
            else Shift is full
                W->>DB: Roll back everything
                W-->>V: "Setup crew Sat 8am just filled up. Pick another?"
            end
        end
        W->>Q: Queue confirmation email
    end

    W-->>V: Confirmation screen, Add to calendar, manage link
    Q->>E: Send confirmation (shifts, details, manage link)
    E-->>V: Email arrives
    Q->>Q: Schedule reminder 24 hours before each shift
```

---

## 6. Signing in by email

*Proposed back end.* Passwordless sign-in (VOL-1, NFR-4). The email has both a **link** and a
**6-digit code**: on iPhone, an app added to the home screen doesn't share sign-in with Safari, so
the code lets people finish signing in inside the installed app.

```mermaid
sequenceDiagram
    autonumber
    actor U as Person
    participant W as Web app
    participant DB as Database
    participant E as Email

    U->>W: Enter email on Sign in
    W->>DB: Save token and code (hashed), expires in 15 min
    W->>E: Send "Your Sevak sign-in link" (link + code)
    W-->>U: "Check your email"

    alt Taps the link
        U->>W: Open /signin/verify?token=…
    else Types the code
        U->>W: Enter 6-digit code
    end

    W->>DB: Check hash, not expired, not used, then mark used
    W->>DB: Create session
    W-->>U: Set session cookie → Available opportunities<br/>(or the page they were on)

    opt Platform admin
        W-->>U: Ask for authenticator (TOTP) code
    end
```

---

## 7. Joining an organization's team

*Today (prototype) and planned.* The two ways onto a team (ORG-13). In the prototype, being added
shows a one-time notice; in the live app it sends an invitation to accept.

```mermaid
flowchart TD
    S([Signed-in person opens a Manage page]) --> Q{On this<br/>organization's team?}
    Q -- Yes --> R{Role?}
    R -- Admin --> PA[Full access:<br/>profile, team, delete]
    R -- Coordinator --> PC[Run events, dashboard, documents.<br/>Profile is read-only, no delete]
    Q -- No --> N["'You're not on this team'<br/>with the two ways in"]
    N --> W1[Set up a new organization]
    W1 --> AD[You become its Admin]
    N --> W2[Ask an Admin to add you]
    W2 --> INV["Admin adds your email on the Team tab<br/>(as Admin or Coordinator)"]
    INV --> EM["Invitation email (planned)"]
    EM --> ACC[Accept]
    ACC --> R
    AD --> R
```

---

## 7a. Joining as a volunteer

*Today (prototype) and planned.* A volunteer can sign up for an organization's shifts only once
they're one of its volunteers: by invitation, or by asking to join and being approved (MEM-1 to
MEM-8). In the prototype, emails go to the outbox page instead of being sent.

```mermaid
flowchart TD
    S([Person wants to volunteer]) --> H{How?}
    H -- "Invite link or code" --> I[Join page: enter link or code]
    H -- "Emailed invitation" --> E[Sign in or make a profile<br/>with the invited email]
    H -- "Ask to join" --> Q[Join page: pick the organization,<br/>add a note]
    I --> P{Has a profile?}
    Q --> P
    P -- No --> NP[Make a profile;<br/>the choice is kept]
    P -- Yes --> J
    NP --> J{Invitation or<br/>auto-approve?}
    E --> ACT
    J -- Yes --> ACT[Active volunteer<br/>+ welcome email]
    J -- No --> REQ[Request waiting]
    REQ --> D{Admin or Coordinator<br/>on the Volunteers page}
    D -- Approve --> ACT
    D -- Decline --> DEC[Declined + email;<br/>can be approved later]
    ACT --> SU[Sign up for its shifts]
```

---

## 8. How the system fits together

*Today vs proposed.* Today everything runs in the browser. The proposal (from `ARCHITECTURE.md`,
updated for the cheaper single-service setup on Railway that we discussed) adds one app server and
one database.

**Today: static prototype**

```mermaid
flowchart LR
    B["Browser<br/>(phone or desktop)"] -- HTTPS --> GP["GitHub Pages<br/>sevak.theanbgroup.com"]
    GP -. "HTML, CSS, JS" .-> B
    B <--> LS[("localStorage<br/>this browser only")]
```

**Proposed: pilot back end**

```mermaid
flowchart LR
    subgraph Phone["Phone or desktop"]
        PWA["Sevak web app (PWA)<br/>service worker, offline roster"]
    end

    subgraph CF["Cloudflare"]
        DNS["DNS, TLS, cache"]
        TS["Turnstile"]
    end

    subgraph RW["Railway project"]
        APP["App server (Next.js)<br/>pages + /api/v1 + background jobs"]
        PG[("Database<br/>(choice not made yet)")]
    end

    R2[("Cloudflare R2<br/>photos, documents, PDFs")]

    SVC["Postmark (email)<br/>Sentry (errors)"]
    GH["GitHub<br/>code + CI"]

    PWA -- HTTPS --> DNS --> APP
    PWA -. bot check .-> TS
    APP --> PG
    APP --> R2
    APP --> SVC
    GH -- "deploy on merge to main" --> APP
    PG -. "nightly backup" .-> R2
```

**To discuss:** the stack, the database and the host (Railway) aren't confirmed yet.
`ARCHITECTURE.md` still describes Render with a separate worker, and gets updated once this is
agreed.
