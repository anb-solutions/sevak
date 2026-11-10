// Certificates of volunteer service (prototype), kept in this browser.
//
// A signed-in volunteer asks an organization for a certificate covering a
// period (from–to dates). It counts only hours the event's admin approved
// (see SevakSignups.hoursStatus). An Admin of the organization issues it on
// demand, or declines it with a reason. Issuing:
//   - renders the certificate (organization name, a summary and the detail
//     of every approved shift, the issuing Admin's signature),
//   - saves it as a PDF in the volunteer's Documents and in the Documents of
//     each event it covers,
//   - emails the volunteer (the prototype outbox).
//
// Records (sevak.certificates.v1), one per request:
//   { id, orgId, email, name, from, to, note, status: "requested" | "issued" |
//     "declined", requestedAt, decidedAt, decidedBy, reason, code, issuedAt,
//     signer: { name, title, email, image }, data: <snapshot>, docIds }
// Signatures (sevak.signatures.v1): { "<email>": { image, title, updatedAt } }
(function () {
  "use strict";

  var KEY = "sevak.certificates.v1";
  var SIG_KEY = "sevak.signatures.v1";
  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var E = window.SevakEvents;
  var S = window.SevakSignups;

  function now() { return new Date().toISOString(); }
  function norm(x) { return String(x || "").trim().toLowerCase(); }
  function today() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function all() {
    var list = F.load(KEY);
    return Array.isArray(list) ? list : [];
  }
  function saveAll(list) { return F.store(KEY, list); }
  function get(id) { return all().filter(function (c) { return c.id === id; })[0] || null; }
  function put(rec) {
    var list = all();
    var i = list.findIndex(function (c) { return c.id === rec.id; });
    if (i === -1) list.push(rec); else list[i] = rec;
    return saveAll(list) ? rec : null;
  }

  function me() {
    var p = F.session.signedIn() ? F.session.profile() : null;
    return p ? { email: p.email, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email } : null;
  }

  function email(to, subject, body, link, linkText) {
    if (window.SevakMembers && to) window.SevakMembers.email(to, subject, body, link, linkText);
  }

  function durationLabel(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + " h " + m + " min";
    return h ? h + " h" : m + " min";
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  // ---------- Who approves and who issues ----------

  // The event's admin approves its volunteers' hours; the organization's
  // Admins can too. Signed out (previewing Manage pages in the plain
  // prototype), anyone can; with Sevak's server, never, and the server
  // checks every approval and certificate anyway.
  function canApprove(event) {
    if (!event) return false;
    if (!F.session.signedIn()) return !window.SevakServer;
    var org = O.get(event.organizationId);
    if (!org || !O.roleFor(org)) return false;
    if (O.isAdmin(org)) return true;
    var m = me();
    return !!(m && event.eventAdmin && norm(event.eventAdmin) === norm(m.email));
  }

  // Whether you may approve, adjust or not approve these hours: never your
  // own, and an Admin's only if you're an Admin too (ATT-3; the server
  // checks the same, packages/core/src/signups.ts).
  function canApproveHours(event, su) {
    if (!canApprove(event) || !su) return false;
    if (!F.session.signedIn()) return true;
    var m = me();
    var org = O.get(event.organizationId);
    if (m && norm(su.email) === norm(m.email)) return false;
    if (O.roleOf(org, su.email) === "admin") return O.isAdmin(org);
    return true;
  }

  // Admins issue certificates for their organization.
  function canIssue(org) {
    if (!org) return false;
    if (!F.session.signedIn()) return !window.SevakServer;
    return O.isAdmin(org);
  }

  // Whether this request is your own: nobody issues or declines their own
  // certificate, so an Admin's needs a different Admin (the server checks
  // the same, packages/core/src/certificates.ts).
  function isOwn(rec) {
    var m = me();
    return !!(rec && m && norm(rec.email) === norm(m.email));
  }

  // Whether you may issue (or decline) this request.
  function canIssueFor(org, rec) {
    return canIssue(org) && !!rec && !isOwn(rec);
  }

  // ---------- Hours ----------

  function shiftOf(event, shiftId) {
    var out = null;
    (event.roles || []).forEach(function (role) {
      (role.shifts || []).forEach(function (sh) { if (sh.id === shiftId) out = { shift: sh, role: role }; });
    });
    return out;
  }

  // Each logged shift of a volunteer with an organization, with its status.
  function hoursRows(volunteerEmail, orgId, from, to) {
    var e = norm(volunteerEmail);
    var rows = [];
    S.all().forEach(function (su) {
      if (norm(su.email) !== e || su.status === "cancelled" || !S.hoursStatus(su)) return;
      var ev = E.get(su.eventId);
      if (!ev || ev.organizationId !== orgId) return;
      var found = shiftOf(ev, su.shiftId);
      if (!found) return;
      var date = found.shift.date;
      if ((from && date < from) || (to && date > to)) return;
      rows.push({
        signupId: su.id,
        eventId: ev.id,
        eventTitle: ev.title || "Event",
        date: date,
        task: found.role.name || "Volunteer",
        taskDescription: found.role.description || "",
        from: su.hours.from || "",
        to: su.hours.to || "",
        loggedMinutes: su.hours.minutes,
        minutes: S.creditedMinutes(su),
        status: S.hoursStatus(su),
        adjusted: su.hours.approvedMinutes != null,
        method: su.hours.method || ""
      });
    });
    return rows.sort(function (a, b) { return (a.date + a.from).localeCompare(b.date + b.from); });
  }

  // What a certificate for this period would cover: approved hours, and
  // how much is still waiting (not included).
  function coverage(volunteerEmail, orgId, from, to) {
    var rows = hoursRows(volunteerEmail, orgId, from, to);
    var approved = rows.filter(function (r) { return r.status === "approved"; });
    var pending = rows.filter(function (r) { return r.status === "pending"; });
    var sum = function (list, k) { return list.reduce(function (n, r) { return n + (r[k] || 0); }, 0); };
    return {
      approved: approved,
      minutes: sum(approved, "minutes"),
      pendingShifts: pending.length,
      pendingMinutes: sum(pending, "loggedMinutes")
    };
  }

  // Organizations you've logged hours with, and the dates of those hours.
  function myOrgsWithHours() {
    var m = me();
    if (!m) return [];
    var byOrg = {};
    S.all().forEach(function (su) {
      if (norm(su.email) !== norm(m.email) || su.status === "cancelled" || !S.hoursStatus(su)) return;
      var ev = E.get(su.eventId);
      var found = ev && shiftOf(ev, su.shiftId);
      if (!found) return;
      var o = byOrg[ev.organizationId] || (byOrg[ev.organizationId] = { orgId: ev.organizationId, first: found.shift.date, last: found.shift.date });
      if (found.shift.date < o.first) o.first = found.shift.date;
      if (found.shift.date > o.last) o.last = found.shift.date;
    });
    return Object.keys(byOrg).map(function (k) { return byOrg[k]; })
      .filter(function (o) { return O.get(o.orgId); })
      .sort(function (a, b) { return O.get(a.orgId).name.localeCompare(O.get(b.orgId).name); });
  }

  // ---------- Requests ----------

  function adminEmails(org) {
    var list = (org.team || []).filter(function (t) { return t.role === "admin"; }).map(function (t) { return t.email; });
    if (!list.length && org.createdBy) list.push(org.createdBy);
    if (!list.length && org.primaryContact && org.primaryContact.email) list.push(org.primaryContact.email);
    return list;
  }

  function request(orgId, from, to, note) {
    var m = me();
    var org = O.get(orgId);
    if (!m || !org || !from || !to || to < from) return null;
    var rec = put({
      id: "cert-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      orgId: orgId,
      email: m.email,
      name: m.name,
      from: from,
      to: to,
      note: String(note || "").trim().slice(0, 300),
      status: "requested",
      requestedAt: now()
    });
    if (rec) {
      var period = E.dayLabel(from, { year: "numeric", weekday: undefined }) + " – " + E.dayLabel(to, { year: "numeric", weekday: undefined });
      adminEmails(org).forEach(function (to2) {
        email(to2, "Certificate request from " + m.name,
          m.name + " asked " + org.name + " for a certificate of their volunteer hours from " + period + ". Review their approved hours and issue it on the Volunteers page.",
          "volunteers.html#cert-requests", "Review the request");
      });
    }
    return rec;
  }

  function withdraw(id) {
    var rec = get(id);
    if (!rec || rec.status !== "requested") return false;
    return saveAll(all().filter(function (c) { return c.id !== id; }));
  }

  function mine() {
    var m = me();
    if (!m) return [];
    return all().filter(function (c) { return norm(c.email) === norm(m.email); })
      .sort(function (a, b) { return (b.requestedAt || "").localeCompare(a.requestedAt || ""); });
  }

  function forOrg(orgId) {
    return all().filter(function (c) { return c.orgId === orgId; })
      .sort(function (a, b) { return (a.requestedAt || "").localeCompare(b.requestedAt || ""); });
  }

  // An issued certificate by its number. With Sevak's server, the server's
  // record is the proof (it shows only what proves the certificate).
  function byCode(code) {
    var c = String(code || "").trim().toUpperCase();
    var server = window.SevakServer;
    if (server && !server.offline) {
      var res = server.call("GET", "/api/v1/certificates/verify/" + encodeURIComponent(c));
      return res.status === 200 && res.data ? res.data.certificate : null;
    }
    return all().filter(function (x) { return x.status === "issued" && x.code === c; })[0] || null;
  }

  // ---------- Signatures ----------

  function signatures() {
    var s = F.load(SIG_KEY);
    return s && typeof s === "object" ? s : {};
  }
  function signature(addr) { return signatures()[norm(addr)] || null; }
  function setSignature(addr, fields) {
    var s = signatures();
    s[norm(addr)] = Object.assign({}, s[norm(addr)] || {}, fields, { updatedAt: now() });
    return F.store(SIG_KEY, s);
  }

  // The person issuing signs: their name, the title they chose, and the
  // signature they drew (if any).
  function signerFor(org) {
    var m = me();
    if (!m) {
      var pc = (org && org.primaryContact) || {};
      return { name: pc.name || (org ? org.name + " team" : "Sevak"), title: pc.title || "", email: pc.email || "", image: "" };
    }
    var sig = signature(m.email) || {};
    var role = org ? O.roleFor(org) : null;
    var pc2 = (org && org.primaryContact) || {};
    var title = sig.title || (norm(pc2.email) === norm(m.email) && pc2.title) || (role === "admin" ? "Administrator" : role === "coordinator" ? "Volunteer Coordinator" : "");
    return { name: m.name, title: title, email: m.email, image: sig.image || "" };
  }

  // ---------- What goes on the certificate ----------

  function placeOf(org) {
    var a = (org && org.address) || {};
    return [a.city, a.state].filter(Boolean).join(", ");
  }

  function snapshot(rec, signer) {
    var org = O.get(rec.orgId) || { name: "An organization" };
    var cov = coverage(rec.email, rec.orgId, rec.from, rec.to);
    var rows = cov.approved;
    var events = {};
    var tasks = {};
    rows.forEach(function (r) {
      var ev = events[r.eventId] || (events[r.eventId] = { id: r.eventId, title: r.eventTitle, minutes: 0, shifts: 0, first: r.date, last: r.date });
      ev.minutes += r.minutes;
      ev.shifts += 1;
      if (r.date > ev.last) ev.last = r.date;
      var key = r.eventId + "|" + r.task;
      if (!tasks[key]) tasks[key] = { event: r.eventTitle, task: r.task, description: r.taskDescription, minutes: 0 };
      tasks[key].minutes += r.minutes;
    });
    return {
      org: { name: org.name, place: placeOf(org), verified: org.verificationStatus === "verified" },
      volunteer: rec.name || rec.email,
      from: rec.from,
      to: rec.to,
      minutes: cov.minutes,
      shifts: rows.length,
      events: Object.keys(events).map(function (k) { return events[k]; }),
      tasks: Object.keys(tasks).map(function (k) { return tasks[k]; }),
      firstDate: rows.length ? rows[0].date : "",
      lastDate: rows.length ? rows[rows.length - 1].date : "",
      rows: rows.map(function (r) { return { date: r.date, eventId: r.eventId, event: r.eventTitle, task: r.task, from: r.from, to: r.to, minutes: r.minutes, adjusted: r.adjusted }; }),
      signer: signer
    };
  }

  function longDate(date) { return E.dayLabel(date, { weekday: undefined, year: "numeric", month: "long" }); }
  function shortDate(date) { return E.dayLabel(date, { year: "numeric" }); }
  function plainDate(date) { return E.dayLabel(date, { weekday: undefined, year: "numeric" }); }

  // ---------- Drawing the certificate (A4, portrait) ----------

  var W = 1240, H = 1754, M = 110;
  var C = { primary: "#0f766e", text: "#1f2a28", muted: "#56625e", line: "#c9d6d2", soft: "#e6f2f0", gold: "#b7791f", paper: "#ffffff" };
  var SERIF = "Georgia, 'Times New Roman', serif";
  var SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  var SCRIPT = "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'URW Chancery L', 'Apple Chancery', cursive";

  function font(ctx, size, family, weight, style) {
    ctx.font = (style || "normal") + " " + (weight || 400) + " " + size + "px " + family;
  }

  function wrap(ctx, text, maxWidth) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function fit(ctx, text, maxWidth) {
    var t = String(text || "");
    if (ctx.measureText(t).width <= maxWidth) return t;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  }

  function frame(ctx) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 8;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(58, 58, W - 116, H - 116);
  }

  function footer(ctx, d, page, pages) {
    font(ctx, 18, SANS);
    ctx.fillStyle = C.muted;
    ctx.textAlign = "center";
    ctx.fillText("Hours approved by " + d.org.name + ". Issued through Sevak · A Service of The ANB Group" + (pages > 1 ? " · Page " + page + " of " + pages : ""), W / 2, H - 82);
  }

  // Lays out and draws every page; returns the canvases.
  function render(d, opts) {
    opts = opts || {};
    var ROW = 46;
    var pages = [];
    var newPage = function () {
      var c = document.createElement("canvas");
      c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      frame(ctx);
      pages.push(c);
      return ctx;
    };

    // ----- Page 1: the certificate itself -----
    var ctx = newPage();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    var y = 160;
    font(ctx, 46, SERIF, 700);
    ctx.fillStyle = C.primary;
    wrap(ctx, d.org.name, W - 2 * M).slice(0, 2).forEach(function (l) { ctx.fillText(l, W / 2, y); y += 54; });
    font(ctx, 22, SANS);
    ctx.fillStyle = C.muted;
    ctx.fillText([d.org.place, d.org.verified ? "Verified organization ✓" : ""].filter(Boolean).join("  ·  "), W / 2, y);
    y += 44;
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 120, y); ctx.lineTo(W / 2 + 120, y); ctx.stroke();
    y += 80;
    font(ctx, 58, SERIF, 700);
    ctx.fillStyle = C.text;
    ctx.fillText("Certificate of Volunteer Service", W / 2, y);
    y += 62;
    font(ctx, 26, SANS);
    ctx.fillStyle = C.muted;
    ctx.fillText("This certifies that", W / 2, y);
    y += 82;
    font(ctx, 64, SERIF, 700, "italic");
    ctx.fillStyle = C.primary;
    ctx.fillText(fit(ctx, d.volunteer, W - 2 * M), W / 2, y);
    y += 22;
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M + 120, y); ctx.lineTo(W - M - 120, y); ctx.stroke();
    y += 56;
    font(ctx, 26, SANS);
    ctx.fillStyle = C.text;
    var statement = "volunteered with " + d.org.name + " between " + longDate(d.from) + " and " + longDate(d.to) +
      ", giving " + durationLabel(d.minutes) + " of service over " + plural(d.shifts, "shift") +
      (d.events.length > 1 ? " at " + plural(d.events.length, "event") : " at " + (d.events[0] ? d.events[0].title : "its events")) + ".";
    wrap(ctx, statement, W - 2 * M - 40).forEach(function (l) { ctx.fillText(l, W / 2, y); y += 38; });

    // Summary: three figures
    y += 26;
    var boxW = (W - 2 * M - 40) / 3, boxH = 124;
    var figures = [
      ["Total hours", durationLabel(d.minutes)],
      ["Shifts", String(d.shifts)],
      ["Dates served", d.firstDate === d.lastDate ? plainDate(d.firstDate) : E.dayLabel(d.firstDate, { weekday: undefined }) + " – " + plainDate(d.lastDate)]
    ];
    figures.forEach(function (f, i) {
      var x = M + i * (boxW + 20);
      ctx.fillStyle = C.soft;
      ctx.fillRect(x, y, boxW, boxH);
      ctx.textAlign = "center";
      font(ctx, 20, SANS, 600);
      ctx.fillStyle = C.muted;
      ctx.fillText(f[0].toUpperCase(), x + boxW / 2, y + 40);
      font(ctx, f[1].length > 16 ? 26 : 36, SERIF, 700);
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, f[1], boxW - 24), x + boxW / 2, y + 92);
    });
    y += boxH + 56;

    // What they did
    ctx.textAlign = "left";
    font(ctx, 24, SANS, 700);
    ctx.fillStyle = C.primary;
    ctx.fillText("What they did", M, y);
    y += 36;
    var shownTasks = d.tasks.slice(0, 4);
    shownTasks.forEach(function (t) {
      font(ctx, 22, SANS, 600);
      ctx.fillStyle = C.text;
      var head = t.task + " · " + t.event + " · " + durationLabel(t.minutes);
      ctx.fillText(fit(ctx, "•  " + head, W - 2 * M), M, y);
      y += 30;
      if (t.description) {
        font(ctx, 20, SANS);
        ctx.fillStyle = C.muted;
        wrap(ctx, t.description, W - 2 * M - 30).slice(0, 2).forEach(function (l, i, arr) {
          ctx.fillText(i === arr.length - 1 && wrap(ctx, t.description, W - 2 * M - 30).length > 2 ? fit(ctx, l + " …", W - 2 * M - 30) : l, M + 30, y);
          y += 28;
        });
      }
      y += 6;
    });
    if (d.tasks.length > shownTasks.length) {
      font(ctx, 20, SANS, 400, "italic");
      ctx.fillStyle = C.muted;
      ctx.fillText("…and " + plural(d.tasks.length - shownTasks.length, "more task") + ", listed in the detail.", M + 30, y);
      y += 30;
    }
    y += 20;

    // ----- Detail table (continues on more pages if needed) -----
    var SIG_H = 270, FOOT = 130;
    var cols = [M, M + 210, W - M - 330, W - M - 120];   // date, event · task, time, hours
    var tableHead = function (ctx2, yy, cont) {
      ctx2.textAlign = "left";
      font(ctx2, 24, SANS, 700);
      ctx2.fillStyle = C.primary;
      ctx2.fillText(cont ? "Detail (continued)" : "Detail", M, yy);
      yy += 18;
      ctx2.fillStyle = C.soft;
      ctx2.fillRect(M, yy, W - 2 * M, 40);
      font(ctx2, 18, SANS, 700);
      ctx2.fillStyle = C.muted;
      ["DATE", "EVENT · TASK", "TIME", "HOURS"].forEach(function (h, i) { ctx2.fillText(h, cols[i] + 10, yy + 27); });
      return yy + 40;
    };
    y = tableHead(ctx, y, false);
    var pageIndex = 0;
    d.rows.forEach(function (r, i) {
      var isLast = i === d.rows.length - 1;
      if (y + ROW > H - FOOT) {
        ctx = newPage();
        pageIndex++;
        y = tableHead(ctx, 150, true);
      }
      font(ctx, 20, SANS);
      ctx.fillStyle = C.text;
      ctx.textAlign = "left";
      ctx.fillText(shortDate(r.date), cols[0] + 10, y + 30);
      ctx.fillText(fit(ctx, r.event + " · " + r.task, cols[2] - cols[1] - 20), cols[1] + 10, y + 30);
      ctx.fillText(r.from && r.to ? E.timeLabel(r.from) + "–" + E.timeLabel(r.to) : "—", cols[2] + 10, y + 30);
      ctx.textAlign = "right";
      ctx.fillText(durationLabel(r.minutes) + (r.adjusted ? "*" : ""), W - M - 10, y + 30);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(M, y + ROW); ctx.lineTo(W - M, y + ROW); ctx.stroke();
      y += ROW;
      if (isLast) {
        font(ctx, 20, SANS, 700);
        ctx.fillStyle = C.text;
        ctx.textAlign = "left";
        ctx.fillText("Total", cols[0] + 10, y + 32);
        ctx.textAlign = "right";
        ctx.fillText(durationLabel(d.minutes), W - M - 10, y + 32);
        y += ROW;
        if (d.rows.some(function (x) { return x.adjusted; })) {
          font(ctx, 17, SANS, 400, "italic");
          ctx.fillStyle = C.muted;
          ctx.textAlign = "left";
          ctx.fillText("* Hours adjusted by the organization when approving.", M, y + 20);
          y += 30;
        }
      }
    });

    // ----- Signature and certificate number -----
    if (y + 30 + SIG_H > H - FOOT) { ctx = newPage(); y = 160; }
    var sy = H - FOOT - SIG_H + 30;
    var sig = d.signer || {};
    ctx.textAlign = "left";
    var drawSigLine = function () {
      ctx.strokeStyle = C.text; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(M, sy + 120); ctx.lineTo(M + 440, sy + 120); ctx.stroke();
      font(ctx, 24, SANS, 700);
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, sig.name || "", 440), M, sy + 154);
      font(ctx, 20, SANS);
      ctx.fillStyle = C.muted;
      var lines = [sig.title, d.org.name].filter(Boolean);
      lines.forEach(function (l, i) { ctx.fillText(fit(ctx, l, 520), M, sy + 182 + i * 26); });
    };
    var finishRight = function () {
      ctx.textAlign = "right";
      font(ctx, 20, SANS);
      ctx.fillStyle = C.muted;
      ctx.fillText(opts.preview ? "Not issued yet" : "Issued " + longDate((d.issuedAt || now()).slice(0, 10)), W - M, sy + 120);
      font(ctx, 22, SANS, 700);
      ctx.fillStyle = C.text;
      ctx.fillText(opts.preview ? "Certificate no. —" : "Certificate no. " + (d.code || ""), W - M, sy + 154);
      font(ctx, 17, SANS);
      ctx.fillStyle = C.muted;
      if (!opts.preview && d.verifyUrl) ctx.fillText(fit(ctx, "Check it at " + d.verifyUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, ""), 560), W - M, sy + 182);
      if (opts.preview) {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-Math.PI / 6);
        ctx.textAlign = "center";
        font(ctx, 150, SANS, 800);
        ctx.fillStyle = "rgba(180, 35, 24, 0.12)";
        ctx.fillText("PREVIEW", 0, 0);
        ctx.restore();
      }
    };
    var done = function () {
      pages.forEach(function (c, i) { footer(c.getContext("2d"), d, i + 1, pages.length); });
      return pages;
    };
    if (sig.image) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(420 / img.width, 110 / img.height, 1.5);
          ctx.drawImage(img, M, sy + 112 - img.height * scale, img.width * scale, img.height * scale);
          drawSigLine(); finishRight(); resolve(done());
        };
        img.onerror = function () { scriptName(); drawSigLine(); finishRight(); resolve(done()); };
        img.src = sig.image;
      });
    }
    scriptName(); drawSigLine(); finishRight();
    return Promise.resolve(done());

    function scriptName() {
      font(ctx, 54, SCRIPT, 400, "italic");
      ctx.fillStyle = C.primary;
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, sig.name || "", 440), M + 6, sy + 104);
    }
  }

  // ---------- PDF (one JPEG image per page) ----------

  function bytesOf(dataUrl) {
    var bin = atob(dataUrl.split(",")[1]);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function pdf(canvases, title) {
    var enc = function (s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
    var chunks = [], offsets = [], length = 0;
    var push = function (part) { var b = typeof part === "string" ? enc(part) : part; chunks.push(b); length += b.length; };
    var obj = function (n, body) { offsets[n] = length; push(n + " 0 obj\n"); body(); push("\nendobj\n"); };
    var safe = String(title || "Certificate").replace(/[^\x20-\x7e]/g, "").replace(/([()\\])/g, "\\$1");
    var n = canvases.length;
    // 1 catalog, 2 pages, 3 info, then 3 objects per page
    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    obj(1, function () { push("<< /Type /Catalog /Pages 2 0 R >>"); });
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((4 + i * 3) + " 0 R");
    obj(2, function () { push("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>"); });
    obj(3, function () { push("<< /Title (" + safe + ") /Producer (Sevak) >>"); });
    canvases.forEach(function (c, i) {
      var pageN = 4 + i * 3, contentN = pageN + 1, imageN = pageN + 2;
      var jpeg = bytesOf(c.toDataURL("image/jpeg", 0.92));
      var content = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
      obj(pageN, function () { push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 " + imageN + " 0 R >> >> /Contents " + contentN + " 0 R >>"); });
      obj(contentN, function () { push("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"); });
      obj(imageN, function () {
        push("<< /Type /XObject /Subtype /Image /Width " + c.width + " /Height " + c.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n");
        push(jpeg);
        push("\nendstream");
      });
    });
    var size = 4 + n * 3;
    var xref = length;
    push("xref\n0 " + size + "\n0000000000 65535 f \n");
    for (var k = 1; k < size; k++) push(String(offsets[k]).padStart(10, "0") + " 00000 n \n");
    push("trailer\n<< /Size " + size + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(chunks, { type: "application/pdf" });
  }

  // ---------- Issue, decline ----------

  function newCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var part = function () { var s = ""; for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s; };
    return "SVK-" + part() + "-" + part();
  }

  function verifyUrl(code) {
    return location.href.replace(/[^/]*$/, "") + "verify.html?code=" + encodeURIComponent(code);
  }

  function fileName(d) {
    return ("Sevak certificate - " + d.org.name + " - " + d.volunteer + ".pdf").replace(/[\\/:*?"<>|]+/g, "-");
  }

  // What a request would look like if issued now (signed by you).
  function preview(id) {
    var rec = get(id);
    if (!rec) return null;
    return snapshot(rec, signerFor(O.get(rec.orgId)));
  }

  function issue(id) {
    var rec = get(id);
    var org = rec && O.get(rec.orgId);
    if (!rec || !org) return Promise.reject(new Error("missing"));
    if (rec.status === "issued") return Promise.resolve(rec);
    if (isOwn(rec)) return Promise.reject(new Error("own"));
    var d = snapshot(rec, signerFor(org));
    if (!d.shifts) return Promise.reject(new Error("no-hours"));
    d.code = newCode();
    d.issuedAt = now();
    d.verifyUrl = verifyUrl(d.code);
    return render(d).then(function (canvases) {
      var blob = pdf(canvases, "Certificate of Volunteer Service - " + d.volunteer);
      var D = window.SevakDocs;
      var period = plainDate(d.from) + " – " + plainDate(d.to);
      var meta = function (forEvent) {
        return {
          name: "Certificate · " + (forEvent ? d.volunteer : d.org.name),
          description: (forEvent ? "Issued to " + d.volunteer + ". " : "From " + d.org.name + ". ") + durationLabel(d.minutes) + " approved, " + period + ". No. " + d.code,
          fileName: fileName(d),
          uploadedBy: (d.signer.name || "Admin") + " (issued)",
          source: "certificate",
          orgId: rec.orgId
        };
      };
      var saves = [D.addFile(D.profileOwner(rec.email), blob, meta(false))];
      d.events.forEach(function (ev) { saves.push(D.addFile("event:" + ev.id, blob, meta(true))); });
      return Promise.all(saves).then(function (docs) {
        var done = Object.assign({}, rec, {
          status: "issued",
          code: d.code,
          issuedAt: d.issuedAt,
          decidedAt: d.issuedAt,
          decidedBy: d.signer.email || "",
          signer: d.signer,
          data: d,
          docIds: docs.map(function (x) { return x.id; })
        });
        if (!put(done)) throw new Error("storage");
        email(rec.email, "Your volunteer certificate from " + org.name,
          org.name + " issued your certificate: " + durationLabel(d.minutes) + " of approved volunteering, " + period + ". It's saved in your Documents on Sevak.",
          "certificate.html?id=" + encodeURIComponent(rec.id), "View your certificate");
        return done;
      });
    });
  }

  function decline(id, reason) {
    var rec = get(id);
    var org = rec && O.get(rec.orgId);
    if (!rec || rec.status !== "requested" || isOwn(rec)) return null;
    var m = me() || {};
    var done = put(Object.assign({}, rec, { status: "declined", decidedAt: now(), decidedBy: m.email || "", reason: String(reason || "").trim().slice(0, 300) }));
    if (done) {
      email(rec.email, "Your certificate request to " + (org ? org.name : "the organization"),
        (org ? org.name : "The organization") + " didn't issue the certificate you asked for." + (done.reason ? " Reason: " + done.reason : "") + " You can ask again for a different period.",
        "signup.html?view=mine#certificates", "Your certificates");
    }
    return done;
  }

  // The PDF of an issued certificate, made again from its saved details.
  function pdfFor(rec) {
    return render(rec.data).then(function (canvases) { return pdf(canvases, "Certificate of Volunteer Service - " + rec.data.volunteer); });
  }

  window.SevakCerts = {
    all: all,
    get: get,
    mine: mine,
    forOrg: forOrg,
    byCode: byCode,
    canApprove: canApprove,
    canApproveHours: canApproveHours,
    canIssue: canIssue,
    canIssueFor: canIssueFor,
    isOwn: isOwn,
    hoursRows: hoursRows,
    coverage: coverage,
    myOrgsWithHours: myOrgsWithHours,
    request: request,
    withdraw: withdraw,
    preview: preview,
    issue: issue,
    decline: decline,
    render: render,
    pdf: pdf,
    pdfFor: pdfFor,
    fileName: fileName,
    signature: signature,
    setSignature: setSignature,
    signerFor: signerFor,
    durationLabel: durationLabel,
    today: today
  };
})();
