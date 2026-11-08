// Volunteer memberships (prototype), kept in this browser, or on Sevak's
// server when the web app serves the page (window.SevakServer, sync.js).
// There, invite codes are checked by the server, which never sends them
// to people outside the organization's team.
//
// Joining Sevak as a volunteer takes an invitation or a request to join a
// particular organization:
//   invited   → an Admin or Coordinator invited this email (or shared the
//               invite link); becomes active as soon as that person signs in
//   requested → the person asked to join; the organization approves or
//               declines (or approves automatically, if it chose to)
//   active    → a volunteer with the organization: can sign up for shifts
//   declined  → the request wasn't approved
// People on an organization's team (Admins, Coordinators) count as members.
//
// Also the prototype outbox: there is no email yet, so every email Sevak
// would send is recorded here and shown on outbox.html.
(function () {
  "use strict";

  var KEY = "sevak.memberships.v1";
  var OUTBOX_KEY = "sevak.outbox.v1";
  var ORGS_KEY = "sevak.organizations.v1";
  var F = window.SevakForms;
  var O = window.SevakOrgs;

  function all() {
    var list = F.load(KEY);
    return Array.isArray(list) ? list : [];
  }

  function norm(x) { return String(x || "").trim().toLowerCase(); }
  function now() { return new Date().toISOString(); }
  function newId(prefix) { return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function save(list) { return F.store(KEY, list); }

  function forOrg(orgId) {
    return all().filter(function (m) { return m.orgId === orgId; });
  }

  function myEmail() {
    var p = F.session.signedIn() ? F.session.profile() : null;
    return p ? norm(p.email) : "";
  }

  function mine() {
    var email = myEmail();
    return email ? all().filter(function (m) { return norm(m.email) === email; }) : [];
  }

  function findMine(orgId) {
    return mine().filter(function (m) { return m.orgId === orgId; })[0] || null;
  }

  // "team" | "active" | "requested" | "invited" | "declined" | null
  function myStatus(orgId) {
    var org = O.get(orgId);
    if (org && F.session.signedIn() && O.roleFor(org)) return "team";
    var m = findMine(orgId);
    return m ? m.status : null;
  }

  function isMember(orgId) {
    var s = myStatus(orgId);
    return s === "team" || s === "active";
  }

  // Organizations you volunteer with (or help run), as ids.
  function myOrgIds() {
    if (!F.session.signedIn()) return [];
    return O.all().filter(function (o) { return isMember(o.id); }).map(function (o) { return o.id; });
  }

  // What the organization sees about you: a snapshot of your profile.
  function snapshot() {
    var p = F.session.profile() || {};
    return {
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email,
      email: p.email,
      photo: p.photo || "",
      services: p.services || [],
      aboutMe: p.aboutMe || ""
    };
  }

  function upsert(orgId, email, fields) {
    var list = all();
    var i = list.findIndex(function (m) { return m.orgId === orgId && norm(m.email) === norm(email); });
    var rec = Object.assign({}, i === -1 ? { id: newId("mem"), orgId: orgId, email: email, createdAt: now() } : list[i], fields, { updatedAt: now() });
    if (i === -1) list.push(rec); else list[i] = rec;
    return save(list) ? rec : null;
  }

  // ---------- Invite links ----------

  function code() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = "";
    for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function writeOrg(id, patch) {
    var list = F.load(ORGS_KEY) || [];
    list = list.map(function (o) { return o.id === id ? Object.assign({}, o, patch) : o; });
    return F.store(ORGS_KEY, list);
  }

  function inviteCode(orgId) {
    var org = O.get(orgId);
    if (!org) return "";
    if (org.inviteCode) return org.inviteCode;
    var c = code();
    writeOrg(orgId, { inviteCode: c });
    return c;
  }

  function resetInviteCode(orgId) {
    var c = code();
    writeOrg(orgId, { inviteCode: c });
    return c;
  }

  var codeCache = {};

  function orgByCode(c) {
    var want = norm(c).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!want) return null;
    var local = O.all().filter(function (o) { return o.inviteCode && o.inviteCode === want; })[0] || null;
    var server = window.SevakServer;
    if (local || !server || server.offline || want.length < 4) return local;
    if (!(want in codeCache)) {
      var res = server.call("GET", "/api/v1/organizations/by-code/" + encodeURIComponent(want));
      codeCache[want] = res.status === 200 && res.data ? res.data.organization : null;
    }
    return codeCache[want] && (O.get(codeCache[want].id) || codeCache[want]);
  }

  // The join link for a code, relative to the app folder.
  function inviteLink(c) {
    var base = location.href.replace(/[^/]*$/, "");
    return base + "join.html?code=" + encodeURIComponent(c);
  }

  function setAutoApprove(orgId, on) {
    return writeOrg(orgId, { autoApprove: !!on });
  }

  // ---------- Outbox (prototype) ----------

  function outbox() {
    var list = F.load(OUTBOX_KEY);
    return Array.isArray(list) ? list : [];
  }

  function email(to, subject, body, link, linkText) {
    var list = outbox();
    list.unshift({ id: newId("mail"), to: to, subject: subject, body: body, link: link || "", linkText: linkText || "", sentAt: now() });
    F.store(OUTBOX_KEY, list.slice(0, 200));
  }

  function orgName(orgId) {
    var o = O.get(orgId);
    return o ? o.name : "an organization";
  }

  // ---------- Volunteer actions ----------

  // Ask to join an organization (or join straight away with an invite
  // link, or when the organization approves automatically).
  // code: the invitation code, when joining with one (the server checks it).
  function request(orgId, note, viaInvite, code) {
    var org = O.get(orgId);
    var me = snapshot();
    if (!org || !me.email) return null;
    var current = findMine(orgId);
    if (current && current.status === "active") return current;
    var server = window.SevakServer;
    if (server && viaInvite && code) {
      var res = server.call("POST", "/api/v1/memberships/join", { code: code, note: String(note || "").trim().slice(0, 300) });
      if (res.status !== 200 || !res.data) return null;
      server.replace(KEY, res.data.value);
      return findMine(orgId);
    }
    var auto = viaInvite || org.autoApprove || (current && current.status === "invited");
    var rec = upsert(orgId, me.email, Object.assign({}, me, {
      status: auto ? "active" : "requested",
      note: String(note || "").trim().slice(0, 300),
      requestedAt: now(),
      decidedAt: auto ? now() : undefined,
      how: viaInvite || (current && current.status === "invited") ? "invitation" : auto ? "auto-approved" : "request"
    }));
    if (rec && auto) {
      email(me.email, "Welcome to " + org.name, "You're now a volunteer with " + org.name + " on Sevak. You can sign up for its events.", "signup.html#my-orgs", "See its opportunities");
    }
    // The server may have approved it straight away (or refused it).
    return server ? findMine(orgId) : rec;
  }

  function withdraw(orgId) {
    var m = findMine(orgId);
    if (!m) return false;
    return save(all().filter(function (x) { return x.id !== m.id; }));
  }

  // Invitations to your email become memberships once you're signed in.
  function acceptInvites() {
    var email = myEmail();
    if (!email) return [];
    var me = snapshot();
    var accepted = [];
    var list = all().map(function (m) {
      if (norm(m.email) !== email || m.status !== "invited") return m;
      accepted.push(m);
      return Object.assign({}, m, me, { status: "active", how: "invitation", decidedAt: now(), updatedAt: now() });
    });
    if (accepted.length) save(list);
    return accepted;
  }

  // ---------- Organization actions ----------

  function decide(id, status) {
    var list = all();
    var m = list.filter(function (x) { return x.id === id; })[0];
    if (!m) return null;
    var me = F.session.profile() || {};
    m = Object.assign({}, m, { status: status, decidedAt: now(), decidedBy: me.email || "", updatedAt: now() });
    save(list.map(function (x) { return x.id === id ? m : x; }));
    var name = orgName(m.orgId);
    if (status === "active") {
      email(m.email, name + " approved your request", "Good news: " + name + " approved your request to volunteer. You can now sign up for its events on Sevak.", "signup.html#my-orgs", "See its opportunities");
    } else if (status === "declined") {
      email(m.email, "Your request to join " + name, name + " isn't able to approve your request right now. You can still browse other organizations on Sevak.", "signup.html#all-orgs", "Browse opportunities");
    }
    return m;
  }

  function approve(id) { return decide(id, "active"); }
  function decline(id) { return decide(id, "declined"); }

  function remove(id) {
    return save(all().filter(function (x) { return x.id !== id; }));
  }

  // Invite people by email. Skips anyone already a member or invited.
  function invite(orgId, emails) {
    var org = O.get(orgId);
    if (!org) return { sent: [], skipped: [] };
    var link = inviteLink(inviteCode(orgId));
    var sent = [], skipped = [];
    emails.forEach(function (addr) {
      var e = norm(addr);
      var existing = forOrg(orgId).filter(function (m) { return norm(m.email) === e; })[0];
      var onTeam = (org.team || []).some(function (t) { return norm(t.email) === e; });
      if (onTeam || (existing && (existing.status === "active" || existing.status === "invited"))) { skipped.push(addr); return; }
      upsert(orgId, addr.trim(), { status: "invited", name: existing ? existing.name : "", invitedAt: now(), invitedBy: (F.session.profile() || {}).email || "" });
      email(addr.trim(), "You're invited to volunteer with " + org.name, org.name + " has invited you to volunteer with them on Sevak. Use the link to join; if you already have a profile, just sign in with this email.", link, "Join " + org.name);
      sent.push(addr);
    });
    return { sent: sent, skipped: skipped };
  }

  // Requests waiting, across the organizations whose team you're on.
  function pendingForMyTeams() {
    var ids = O.myTeams().map(function (t) { return t.org.id; });
    return all().filter(function (m) { return m.status === "requested" && ids.indexOf(m.orgId) !== -1; });
  }

  window.SevakMembers = {
    all: all,
    forOrg: forOrg,
    mine: mine,
    myStatus: myStatus,
    isMember: isMember,
    myOrgIds: myOrgIds,
    request: request,
    withdraw: withdraw,
    acceptInvites: acceptInvites,
    approve: approve,
    decline: decline,
    remove: remove,
    invite: invite,
    inviteCode: inviteCode,
    resetInviteCode: resetInviteCode,
    inviteLink: inviteLink,
    orgByCode: orgByCode,
    setAutoApprove: setAutoApprove,
    pendingForMyTeams: pendingForMyTeams,
    outbox: outbox,
    email: email
  };
})();
