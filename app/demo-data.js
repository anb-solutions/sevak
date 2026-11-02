// Demo data for testing the prototype: one organization with main events,
// sub-events, roles, shifts and sign-ups, dated relative to today. It is
// kept apart from real data (its own organization, ids starting "demo-")
// so loading and removing it never touches anything else.
(function () {
  "use strict";

  var ORG_ID = "demo-org";
  var ORG2_ID = "demo-org-2";
  var MEMBERS_KEY = "sevak.memberships.v1";
  var NAMES_BY_ORG = { "demo-org": "Riverside Community Arts (demo)", "demo-org-2": "Eastside Food Pantry (demo)" };
  var EVENTS_KEY = "sevak.events.v1";
  var MAIN_KEY = "sevak.mainEvents.v1";
  var SIGNUPS_KEY = "sevak.signups.v1";
  var CERTS_KEY = "sevak.certificates.v1";
  var DOCS_KEY = "sevak.documents.v1";
  var F = window.SevakForms;
  var O = window.SevakOrgs;

  var NAMES = ["Asha Rao", "Ben Carter", "Chen Wei", "Diego Alvarez", "Emma Novak", "Farah Haddad", "Grace Kim", "Hiro Tanaka",
    "Isla Murphy", "Jamal Brooks", "Kofi Mensah", "Lena Fischer", "Maya Patel", "Noah Levi", "Omar Aziz", "Priya Shah",
    "Quinn Doyle", "Rosa Lima", "Sam Okafor", "Tara Singh", "Uma Iyer", "Victor Hugo", "Wen Li", "Yara Saleh", "Zoe Martin"];

  function day(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    var pad = function (x) { return String(x).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function timezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
  }

  // Each shift is [day offset, start, end, capacity, how many have signed up].
  var PLAN = {
    mains: [
      { id: "demo-main-arudra", title: "Arudra Dance Festival", description: "Our annual classical dance festival, with rehearsals in the weeks before." },
      { id: "demo-main-food", title: "Winter Food Drive", description: "Collecting, sorting and handing out groceries for families this winter." }
    ],
    events: [
      { id: "demo-ev-reh1", main: "demo-main-arudra", title: "Arudra Rehearsal 1", days: [6, 6], status: "published", venue: "Studio B, Natya Center",
        roles: [
          { name: "Stage crew", description: "Set up the stage and lights", bring: "Closed-toe shoes", shifts: [[6, "17:00", "21:00", 6, 5]] },
          { name: "Refreshments", description: "Water and snacks for dancers", shifts: [[6, "18:00", "20:00", 2, 2]] }] },
      { id: "demo-ev-reh2", main: "demo-main-arudra", title: "Arudra Rehearsal 2", days: [13, 13], status: "published", venue: "Studio B, Natya Center",
        roles: [
          { name: "Stage crew", description: "Set up the stage and lights", bring: "Closed-toe shoes", shifts: [[13, "17:00", "21:00", 6, 3]] },
          { name: "Refreshments", shifts: [[13, "18:00", "20:00", 2, 1]] }] },
      { id: "demo-ev-dress", main: "demo-main-arudra", title: "Arudra Dress Rehearsal", days: [20, 20], status: "draft", venue: "Riverside Theatre",
        roles: [
          { name: "Stage crew", shifts: [[20, "15:00", "22:00", 8, 0]] },
          { name: "Costume helpers", description: "Help dancers with costumes and make-up", shifts: [[20, "16:00", "20:00", 4, 0]] }] },
      { id: "demo-ev-fest", main: "demo-main-arudra", title: "Arudra Festival Weekend", days: [27, 28], status: "published", venue: "Riverside Theatre",
        description: "Two evenings of performances. We need help front-of-house and backstage.",
        roles: [
          { name: "Ushers", description: "Greet guests and show them to their seats", shifts: [[27, "17:00", "21:30", 10, 8], [28, "17:00", "21:30", 10, 4]] },
          { name: "Ticket desk", description: "Check tickets and handle the guest list", bring: "Smartphone", shifts: [[27, "16:30", "19:30", 3, 3], [28, "16:30", "19:30", 3, 1]] },
          { name: "Stage crew", shifts: [[27, "14:00", "22:30", 8, 6], [28, "14:00", "22:30", 8, 5]] },
          { name: "Hospitality", description: "Look after performers and guests in the green room", shifts: [[27, "18:00", "22:00", 4, 2], [28, "18:00", "22:00", 4, 0]] }] },
      { id: "demo-ev-collect", main: "demo-main-food", title: "Food Drive: Collection Day", days: [3, 3], status: "published", venue: "Eastside Community Center",
        roles: [
          { name: "Donation greeters", description: "Welcome donors and take their bags", shifts: [[3, "09:00", "12:00", 8, 2], [3, "12:00", "15:00", 8, 1]] },
          { name: "Drivers", description: "Pick up donations from local shops", bring: "A car and driving licence", shifts: [[3, "10:00", "14:00", 4, 1]] }] },
      { id: "demo-ev-sort", main: "demo-main-food", title: "Food Drive: Sorting", days: [10, 11], status: "published", venue: "Eastside Community Center",
        roles: [
          { name: "Sorters", description: "Check dates and sort food into boxes", shifts: [[10, "09:00", "13:00", 12, 9], [11, "09:00", "13:00", 12, 6]] },
          { name: "Packers", shifts: [[10, "13:00", "17:00", 8, 4], [11, "13:00", "17:00", 8, 2]] }] },
      { id: "demo-ev-dist", main: "demo-main-food", title: "Food Drive: Distribution", days: [17, 17], status: "published", venue: "Eastside Community Center",
        roles: [
          { name: "Distribution line", shifts: [[17, "10:00", "14:00", 15, 7]] },
          { name: "Check-in desk", bring: "Smartphone", shifts: [[17, "09:30", "14:00", 3, 3]] },
          { name: "Carry-out helpers", description: "Help families carry boxes to their cars", shifts: [[17, "10:00", "14:00", 6, 2]] }] },
      { id: "demo-ev-garden", title: "Community Garden Workday", days: [0, 0], status: "published", venue: "Eastside Community Garden",
        description: "Weeding, watering and planting winter vegetables. Tools provided.",
        roles: [{ name: "Garden helpers", description: "Weed, water and plant", bring: "Gloves and a water bottle", shifts: [[0, "08:00", "11:00", 8, 3], [0, "13:00", "16:00", 8, 2]] }] },
      { id: "demo-ev-park", title: "Riverside Park Clean-up", days: [4, 4], status: "published", venue: "Riverside Park",
        description: "Help us clear litter along the river trail. Gloves and bags provided.",
        roles: [
          { name: "Litter pickers", bring: "Sturdy shoes", shifts: [[4, "08:30", "11:30", 20, 7]] },
          { name: "Check-in desk", shifts: [[4, "08:00", "10:00", 2, 2]] }] },
      { id: "demo-ev-calls", title: "Donor Thank-You Calls", days: [8, 8], status: "published", online: "https://meet.example.org/thank-you-calls",
        description: "Call our donors from home to say thank you. We'll send you a short script and the list.",
        roles: [{ name: "Callers", description: "Friendly phone calls, about 3 minutes each", bring: "A phone and a quiet spot", shifts: [[8, "18:00", "20:00", 6, 2]] }] },
      { id: "demo-ev-books", title: "San Antonio Book Drive", days: [15, 15], status: "published", venue: "Central Library Annex",
        line1: "600 Soledad Street", city: "San Antonio", postal: "78205",
        roles: [{ name: "Book sorters", description: "Sort donated books by age group", shifts: [[15, "10:00", "13:00", 8, 3]] }] },
      { id: "demo-ev-restock", org: "demo-org-2", title: "Pantry Restock Night", days: [9, 9], status: "published", venue: "Eastside Food Pantry",
        line1: "48 Cesar Chavez Street", postal: "78702",
        roles: [{ name: "Shelf stockers", description: "Unpack deliveries and fill the shelves", shifts: [[9, "18:00", "20:00", 6, 1]] }] },
      { id: "demo-ev-packing", org: "demo-org-2", title: "Holiday Meal Packing", days: [24, 24], status: "published", venue: "Eastside Food Pantry",
        line1: "48 Cesar Chavez Street", postal: "78702",
        roles: [{ name: "Packers", description: "Pack holiday meal boxes for families", shifts: [[24, "09:00", "12:00", 12, 4]] }] },
      { id: "demo-ev-reading", title: "Library Reading Hour", days: [40, 40], status: "draft", venue: "Central Library",
        roles: [{ name: "Readers", description: "Read picture books to children", shifts: [[40, "10:00", "11:00", 4, 0]] }] },
      { id: "demo-ev-dinner", title: "Volunteer Appreciation Dinner", days: [35, 35], status: "published", visibility: "private", venue: "Natya Center Hall",
        roles: [{ name: "Set-up helpers", shifts: [[35, "16:00", "18:00", 5, 3]] }] },
      { id: "demo-ev-fair", title: "Summer Fair", days: [-20, -20], status: "published", venue: "Riverside Park",
        roles: [{ name: "Stall helpers", shifts: [[-20, "10:00", "16:00", 10, 10]] }] }
    ]
  };

  // If you're signed in, the demo makes you one of its Admins so you can try
  // the Manage pages. Leave its team (My profile) to see the volunteer view.
  function demoTeam() {
    var p = F.session.signedIn() ? F.session.profile() : null;
    if (!p) return [];
    return [{ name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email, email: p.email, role: "admin" }];
  }

  // If you're signed in, the demo also signs you up for today's garden
  // morning shift and the (past) Summer Fair, so you can try checking in
  // and logging your hours on My sign-ups.
  function yourSignups() {
    var p = F.session.signedIn() ? F.session.profile() : null;
    if (!p) return [];
    var name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;
    var now = new Date().toISOString();
    return [["demo-ev-garden", "demo-ev-garden-shift-0-0"], ["demo-ev-fair", "demo-ev-fair-shift-0-0"]].map(function (x, i) {
      return { id: "demo-you-" + i, demo: true, registrationId: "demo-reg-you-" + i, eventId: x[0], shiftId: x[1], name: name, email: p.email, phone: p.phone, status: "confirmed", createdAt: now };
    });
  }

  // Everyone who signed up is a volunteer with that organization. Riverside
  // also has two requests waiting and an invitation not yet taken up.
  function memberships(signups, events, now) {
    var orgOf = {};
    events.forEach(function (e) { orgOf[e.id] = e.organizationId; });
    var you = F.session.signedIn() ? String(F.session.profile().email).toLowerCase() : "";
    var seen = {};
    var list = [];
    signups.forEach(function (s) {
      var orgId = orgOf[s.eventId];
      var key = orgId + "|" + s.email;
      if (!orgId || seen[key] || String(s.email).toLowerCase() === you) return;
      seen[key] = true;
      list.push({ id: "demo-mem-" + list.length, orgId: orgId, email: s.email, name: s.name, status: "active", how: "request", createdAt: now, decidedAt: now });
    });
    list.push(
      { id: "demo-mem-req-1", orgId: ORG_ID, email: "priya.nair@example.com", name: "Priya Nair", status: "requested", how: "request",
        note: "I'm a sound engineer and would love to help with the festival's AV.", services: ["av", "general"], requestedAt: now, createdAt: now },
      { id: "demo-mem-req-2", orgId: ORG_ID, email: "tom.becker@example.com", name: "Tom Becker", status: "requested", how: "request",
        note: "Retired accountant, happy to help with the books or the ticket desk.", services: ["accounting", "office"], requestedAt: now, createdAt: now },
      { id: "demo-mem-inv-1", orgId: ORG_ID, email: "jordan.lee@example.com", name: "", status: "invited", invitedAt: now, createdAt: now }
    );
    return list;
  }

  function isLoaded() {
    return !!O.get(ORG_ID);
  }

  function remove() {
    var isDemo = function (x) { return String(x.id || "").indexOf("demo-") !== 0; };
    F.store(EVENTS_KEY, (F.load(EVENTS_KEY) || []).filter(isDemo));
    F.store(MAIN_KEY, (F.load(MAIN_KEY) || []).filter(isDemo));
    F.store(SIGNUPS_KEY, (F.load(SIGNUPS_KEY) || []).filter(function (s) { return String(s.eventId || "").indexOf("demo-") !== 0; }));
    F.store(MEMBERS_KEY, (F.load(MEMBERS_KEY) || []).filter(function (m) { return String(m.orgId || "").indexOf("demo-") !== 0; }));
    F.store(CERTS_KEY, (F.load(CERTS_KEY) || []).filter(function (c) { return String(c.orgId || "").indexOf("demo-") !== 0; }));
    // Certificates saved in the demo events' Documents go with them.
    F.store(DOCS_KEY, (F.load(DOCS_KEY) || []).filter(function (d) { return String(d.owner || "").indexOf("event:demo-") !== 0; }));
    if (O.get(ORG_ID)) O.remove(ORG_ID);
    if (O.get(ORG2_ID)) O.remove(ORG2_ID);
  }

  // Loads (or reloads) the demo and makes it the current organization.
  // Returns counts of what was created.
  function load() {
    remove();
    var now = new Date().toISOString();
    O.save({
      id: ORG_ID,
      name: "Riverside Community Arts (demo)",
      website: "https://example.org",
      description: "A demo organization for testing Sevak. Its events, roles and sign-ups are made up.",
      address: { country: "US", line1: "200 Elm Street", city: "Austin", state: "TX", postalCode: "78701" },
      taxStatus: "charity",
      primaryContact: { name: "Demo Coordinator", title: "Volunteer Coordinator", email: "coordinator@example.org", phone: { country: "US", number: "+15125550100" } },
      team: demoTeam(),
      verificationStatus: "verified",
      inviteCode: "RIVER7",
      createdAt: now,
      updatedAt: now
    });
    // A second organization you're not part of, to try joining.
    O.save({
      id: ORG2_ID,
      name: "Eastside Food Pantry (demo)",
      description: "A second demo organization. Join it with the code PANTRY, or ask to join.",
      address: { country: "US", line1: "48 Cesar Chavez Street", city: "Austin", state: "TX", postalCode: "78702" },
      taxStatus: "charity",
      primaryContact: { name: "Pantry Lead", title: "Volunteer Lead", email: "lead@pantry.example.org", phone: { country: "US", number: "+15125550142" } },
      team: [],
      createdBy: "lead@pantry.example.org",
      verificationStatus: "verified",
      inviteCode: "PANTRY",
      createdAt: now,
      updatedAt: now
    });
    O.setCurrent(ORG_ID);

    var mains = PLAN.mains.map(function (m) {
      return { id: m.id, organizationId: ORG_ID, organizationName: "Riverside Community Arts (demo)", title: m.title, description: m.description, createdAt: now, updatedAt: now };
    });
    var events = [];
    var signups = [];
    var nameIndex = 0;
    PLAN.events.forEach(function (p) {
      var roles = p.roles.map(function (r, ri) {
        return {
          id: p.id + "-role-" + ri,
          name: r.name,
          description: r.description || "",
          bring: r.bring || "",
          shifts: r.shifts.map(function (s, si) {
            var shiftId = p.id + "-shift-" + ri + "-" + si;
            for (var i = 0; i < s[4]; i++) {
              var name = NAMES[nameIndex++ % NAMES.length];
              signups.push({
                id: shiftId + "-su-" + i, demo: true, registrationId: "demo-reg-" + shiftId + "-" + i,
                eventId: p.id, shiftId: shiftId, name: name,
                email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com",
                status: "confirmed", createdAt: now
              });
            }
            return { id: shiftId, date: day(s[0]), start: s[1], end: s[2], capacity: s[3] };
          })
        };
      });
      var orgId = p.org || ORG_ID;
      events.push({
        id: p.id, organizationId: orgId, organizationName: NAMES_BY_ORG[orgId], mainEventId: p.main,
        title: p.title, description: p.description || "",
        startDate: day(p.days[0]), endDate: day(p.days[1]), timezone: timezone(),
        location: p.online
          ? { type: "online", url: p.online }
          : { type: "in-person", venue: p.venue, country: "US", line1: p.line1 || "200 Elm Street", city: p.city || "Austin", state: "TX", postalCode: p.postal || "78701" },
        roles: roles, visibility: p.visibility || "public", status: p.status, createdAt: now, updatedAt: now
      });
    });
    // Hours at the (past) Summer Fair: three volunteers' are approved, two
    // are waiting for approval. The first asked for a certificate.
    var fair = signups.filter(function (su) { return su.shiftId === "demo-ev-fair-shift-0-0"; });
    var fairDay = day(-20);
    fair.forEach(function (su, i) {
      if (i < 3) su.hours = { minutes: 360, from: "10:00", to: "16:00", method: "times", loggedAt: now, status: "approved", decidedAt: now, decidedBy: "coordinator@example.org" };
      else if (i === 3) su.hours = { minutes: 360, from: "10:00", to: "16:00", method: "times", loggedAt: now, status: "pending" };
      else if (i === 4) su.hours = { minutes: 330, from: "10:05", to: "15:35", method: "check-in", loggedAt: now, status: "pending" };
    });
    if (fair[0]) {
      var start = new Date(); start.setDate(start.getDate() - 90);
      F.store(CERTS_KEY, (F.load(CERTS_KEY) || []).concat([{
        id: "demo-cert-1", orgId: ORG_ID, email: fair[0].email, name: fair[0].name,
        from: start.toISOString().slice(0, 10), to: fairDay > day(0) ? fairDay : day(0),
        note: "For my school's community service record.", status: "requested", requestedAt: now
      }]));
    }
    signups = signups.concat(yourSignups());
    F.store(MEMBERS_KEY, (F.load(MEMBERS_KEY) || []).concat(memberships(signups, events, now)));
    F.store(MAIN_KEY, (F.load(MAIN_KEY) || []).concat(mains));
    F.store(EVENTS_KEY, (F.load(EVENTS_KEY) || []).concat(events));
    F.store(SIGNUPS_KEY, (F.load(SIGNUPS_KEY) || []).concat(signups));
    return { mainEvents: mains.length, events: events.length, signups: signups.length };
  }

  window.SevakDemo = { load: load, remove: remove, isLoaded: isLoaded, orgId: ORG_ID };
})();
