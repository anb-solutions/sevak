// Manage → Volunteers (prototype): requests to join, invitations and the
// organization's volunteers. Admins and Coordinators can approve, decline,
// invite and remove; only Admins change "approve automatically".
(function () {
  "use strict";

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var M = window.SevakMembers;
  var $ = function (id) { return document.getElementById(id); };
  // With Sevak's server, emails are sent for real: no outbox to look at.
  if (window.SevakServer) $("outbox-link").hidden = true;

  if (!window.SevakNav.guard()) return;
  var org = O.current();
  O.renderSwitcher($("org-switcher"), { switchTo: "volunteers.html" });
  O.renderHeader($("org-context"), org);
  if (!org) {
    $("vol-status").textContent = "Set up your organization first.";
    return;
  }
  var isAdmin = !F.session.signedIn() || O.isAdmin(org);

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function when(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch (e) { return ""; }
  }

  var SERVICE_NAMES = { general: "General help", av: "AV system help", food: "Food service", website: "Website maintenance", telemarketing: "Telemarketing", fundraising: "Fundraising", accounting: "Accounting", office: "Office help" };

  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
  }

  // One person: photo (or initials), name, email and details, then actions.
  function person(m, details, actions) {
    var li = el("li", "person");
    li.id = "person-" + m.id;
    li.tabIndex = -1;
    var pic = el("span", "person-pic");
    if (m.photo) {
      var img = el("img");
      img.src = m.photo;
      img.alt = "";
      pic.appendChild(img);
    } else {
      pic.textContent = initials(m.name || m.email);
    }
    pic.setAttribute("aria-hidden", "true");
    li.appendChild(pic);
    var text = el("div", "person-text");
    text.appendChild(el("strong", null, m.name || m.email));
    if (m.name) text.appendChild(el("span", "hint", m.email));
    details.filter(Boolean).forEach(function (d) { text.appendChild(el("p", "person-detail", d)); });
    li.appendChild(text);
    var act = el("div", "person-actions");
    actions.forEach(function (a) {
      var b = el("button", "btn " + a.cls, a.text);
      b.type = "button";
      b.setAttribute("aria-label", a.label || a.text + " " + (m.name || m.email));
      b.addEventListener("click", a.onClick);
      act.appendChild(b);
    });
    li.appendChild(act);
    return li;
  }
  var personItem = person;

  // After an action: redraw, update the menu count, say what happened, and
  // keep keyboard focus nearby (the item may have moved to another list).
  function after(message) {
    render();
    window.SevakNav.render();
    $("vol-status").textContent = message;
    $("requests-title").tabIndex = -1;
    $("requests-title").focus();
  }

  var expanded = false;
  var S = window.SevakSignups;
  var E = window.SevakEvents;
  var C = window.SevakCerts;

  function duration(min) { return C.durationLabel(min); }
  function plainDay(date) { return E.dayLabel(date, { weekday: undefined, year: "numeric" }); }

  function shiftOf(ev, shiftId) {
    var out = null;
    (ev.roles || []).forEach(function (r) { (r.shifts || []).forEach(function (sh) { if (sh.id === shiftId) out = { shift: sh, role: r }; }); });
    return out;
  }

  function photoFor(addr) {
    var m = M.forOrg(org.id).filter(function (x) { return String(x.email).toLowerCase() === String(addr).toLowerCase(); })[0];
    return m ? m.photo : "";
  }

  // A small form under an item: adjust hours, or give a reason.
  function inlineForm(li, opts) {
    var old = li.querySelector(".inline-form");
    if (old) { old.remove(); return; }
    var form = el("form", "inline-form");
    form.noValidate = true;
    var id = li.id + "-" + opts.kind;
    var fieldsBox = el("div", "inline-fields");
    var inputs = [];
    opts.fields.forEach(function (f, i) {
      var wrap = el("div", "field");
      var label = el("label", null, f.label);
      label.htmlFor = id + "-" + i;
      var input = el(f.type === "textarea" ? "textarea" : "input");
      input.id = id + "-" + i;
      if (f.type !== "textarea") input.type = f.type;
      Object.keys(f.attrs || {}).forEach(function (k) { input.setAttribute(k, f.attrs[k]); });
      if (f.value != null) input.value = f.value;
      wrap.appendChild(label);
      wrap.appendChild(input);
      fieldsBox.appendChild(wrap);
      inputs.push(input);
    });
    form.appendChild(fieldsBox);
    var err = el("p", "error");
    err.id = id + "-error";
    inputs.forEach(function (x) { x.setAttribute("aria-describedby", err.id); });
    form.appendChild(err);
    var row = el("div", "fill-row");
    var ok = el("button", "btn " + (opts.danger ? "btn-danger" : "btn-primary") + " btn-small", opts.submit);
    ok.type = "submit";
    var cancel = el("button", "btn btn-secondary btn-small", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { form.remove(); });
    row.appendChild(ok);
    row.appendChild(cancel);
    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var problem = opts.onSubmit(inputs.map(function (x) { return x.value; }));
      if (problem) { err.textContent = problem; inputs[0].setAttribute("aria-invalid", "true"); inputs[0].focus(); }
    });
    li.appendChild(form);
    inputs[0].focus();
  }

  function afterIn(titleId, message) {
    render();
    window.SevakNav.render();
    $("vol-status").textContent = message;
    $(titleId).focus();
  }

  // ---------- Hours to approve ----------

  function renderHours() {
    var events = E.forOrg(org.id);
    var waiting = S.pendingHours(events.map(function (ev) { return ev.id; }));
    var list = waiting.filter(function (su) { return C.canApproveHours(E.get(su.eventId), su); })
      .map(function (su) {
        var ev = E.get(su.eventId);
        var found = shiftOf(ev, su.shiftId);
        return found ? { su: su, ev: ev, shift: found.shift, role: found.role } : null;
      }).filter(Boolean)
      .sort(function (a, b) { return (a.shift.date + a.shift.start).localeCompare(b.shift.date + b.shift.start); });
    $("hours-section").hidden = !waiting.length;
    $("hours-title").textContent = list.length ? "Hours to approve (" + list.length + ")" : "Hours to approve";
    $("hours-bulk").hidden = list.length < 2;
    $("approve-all").textContent = "Approve all " + list.length;
    // Your own hours wait for someone else: a different Admin, if you're one.
    var own = waiting.filter(function (su) { return me() && String(su.email).toLowerCase() === me().toLowerCase(); });
    var others = waiting.length - list.length - own.length;
    var notes = [];
    if (own.length) {
      notes.push("Your own hours (" + E.plural(own.length, "shift") + ") need " + (O.isAdmin(org) ? "another Admin" : "the event admin or an Admin") + " to approve them" +
        (O.isAdmin(org) && !otherAdmins() ? ". " + ONLY_ADMIN : "."));
    }
    if (others > 0) notes.push(E.plural(others, "shift") + " more " + (others === 1 ? "is" : "are") + " waiting for " + (O.isAdmin(org) ? "an Admin or their event admin" : "their event admin or an Admin") + ".");
    $("hours-others").hidden = !notes.length;
    $("hours-others").textContent = notes.join(" ");
    var ul = $("hours-list");
    ul.innerHTML = "";
    list.forEach(function (x) {
      var h = x.su.hours;
      var how = h.method === "check-in" ? "checked in and out" : h.method === "duration" ? "as a duration" : "";
      var person = { id: "hours-" + x.su.id, name: x.su.name, email: x.su.email, photo: photoFor(x.su.email) };
      var who = x.su.name || x.su.email;
      var li = personItem(person, [
        x.ev.title + " · " + (x.role.name || "Shift"),
        E.dayLabel(x.shift.date, { year: "numeric" }) + " · shift " + E.timeLabel(x.shift.start) + "–" + E.timeLabel(x.shift.end),
        "Logged " + duration(h.minutes) + " (" + [h.from && h.to ? E.timeLabel(h.from) + "–" + E.timeLabel(h.to) : "", how].filter(Boolean).join(", ") + ")"
      ], [
        { text: "Approve", cls: "btn-primary btn-small", label: "Approve " + duration(h.minutes) + " for " + who, onClick: function () {
          S.decideHours(x.su.id, { status: "approved", by: me() });
          afterIn("hours-title", "Approved " + duration(h.minutes) + " for " + who + ".");
        } },
        { text: "Adjust…", cls: "btn-secondary btn-small", label: "Adjust hours for " + who, onClick: function () {
          inlineForm(li, { kind: "adjust", submit: "Approve these hours", fields: [
            { label: "Hours", type: "number", value: Math.floor(h.minutes / 60), attrs: { min: "0", max: "24", step: "1", inputmode: "numeric" } },
            { label: "Minutes", type: "number", value: h.minutes % 60, attrs: { min: "0", max: "59", step: "1", inputmode: "numeric" } }
          ], onSubmit: function (v) {
            var hh = Number(v[0] || 0), mm = Number(v[1] || 0);
            if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || mm < 0 || mm > 59) return "Enter whole hours, and minutes from 0 to 59.";
            var minutes = hh * 60 + mm;
            if (!minutes || minutes > 24 * 60) return "Enter between 1 minute and 24 hours.";
            S.decideHours(x.su.id, { status: "approved", minutes: minutes, by: me() });
            afterIn("hours-title", "Approved " + duration(minutes) + " for " + who + " (logged " + duration(h.minutes) + ").");
          } });
        } },
        { text: "Don't approve…", cls: "btn-danger-link", label: "Don't approve hours for " + who, onClick: function () {
          inlineForm(li, { kind: "reject", submit: "Don't approve", danger: true, fields: [
            { label: "Reason (the volunteer sees this)", type: "textarea", attrs: { rows: "2", maxlength: "300" } }
          ], onSubmit: function (v) {
            if (!v[0].trim()) return "Say why, so the volunteer can correct it.";
            S.decideHours(x.su.id, { status: "rejected", reason: v[0], by: me() });
            afterIn("hours-title", "Hours for " + who + " not approved. They'll see your reason.");
          } });
        } }
      ]);
      ul.appendChild(li);
    });
  }

  function me() {
    var p = F.session.signedIn() ? F.session.profile() : null;
    return p ? p.email : "";
  }

  // How many Admins the organization has besides you.
  function otherAdmins() {
    var seen = {};
    var mine = String(me() || "").toLowerCase();
    return (org.team || []).map(function (t) { return t.email; })
      .concat([org.primaryContact && org.primaryContact.email, org.createdBy])
      .map(function (e) { return String(e || "").trim().toLowerCase(); })
      .filter(function (e) { var fresh = e && !seen[e]; seen[e] = true; return fresh && e !== mine && O.roleOf(org, e) === "admin"; }).length;
  }
  var ONLY_ADMIN = "You're the only Admin, so add another on the Organization page's Team tab.";

  $("approve-all").addEventListener("click", function () {
    var list = S.pendingHours(E.forOrg(org.id).map(function (ev) { return ev.id; }))
      .filter(function (su) { return C.canApproveHours(E.get(su.eventId), su); });
    if (!list.length || !window.confirm("Approve all " + list.length + " as logged?")) return;
    list.forEach(function (su) { S.decideHours(su.id, { status: "approved", by: me() }); });
    afterIn("hours-title", "Approved " + E.plural(list.length, "shift") + ".");
  });

  // ---------- Certificate requests ----------

  function renderCertRequests() {
    var all = C.forOrg(org.id);
    var waiting = all.filter(function (c) { return c.status === "requested"; });
    var issued = all.filter(function (c) { return c.status === "issued"; }).reverse();
    var canIssue = C.canIssue(org);
    // Your own request is listed (to preview) but waits for another Admin.
    var forYou = waiting.filter(function (c) { return !C.isOwn(c); }).length;
    $("cert-requests").hidden = !all.length;
    $("certreq-title").textContent = forYou ? "Certificate requests (" + forYou + ")" : "Certificate requests";
    $("certreq-empty").hidden = waiting.length > 0;
    $("certreq-hint").hidden = canIssue || !waiting.length;
    var ul = $("certreq-list");
    ul.innerHTML = "";
    waiting.forEach(function (c) {
      var cov = C.coverage(c.email, c.orgId, c.from, c.to);
      var who = c.name || c.email;
      var person = { id: "certreq-" + c.id, name: c.name, email: c.email, photo: photoFor(c.email) };
      var actions = [];
      actions.push({ text: "Preview", cls: "btn-secondary btn-small", label: "Preview the certificate for " + who, onClick: function () { location.href = "certificate.html?id=" + encodeURIComponent(c.id); } });
      var own = C.isOwn(c);
      if (canIssue && !own) {
        actions.push({ text: "Issue", cls: "btn-primary btn-small", label: "Issue the certificate for " + who, onClick: function (e) {
          if (!cov.minutes) { $("vol-status").textContent = "There are no approved hours in that period yet. Approve their hours first."; return; }
          e.target.disabled = true;
          C.issue(c.id).then(function () {
            afterIn("certreq-title", "Certificate issued to " + who + ": " + duration(cov.minutes) + ". Saved in their Documents and the event's Documents." + (window.SevakServer ? "" : " (Email in the outbox.)"));
          }, function () {
            e.target.disabled = false;
            $("vol-status").textContent = "Couldn't issue the certificate in this browser.";
          });
        } });
        actions.push({ text: "Decline…", cls: "btn-danger-link", label: "Decline the certificate request from " + who, onClick: function () {
          inlineForm(li, { kind: "decline", submit: "Decline request", danger: true, fields: [
            { label: "Reason (the volunteer sees this)", type: "textarea", attrs: { rows: "2", maxlength: "300" } }
          ], onSubmit: function (v) {
            if (!v[0].trim()) return "Say why, so the volunteer knows what to do.";
            C.decline(c.id, v[0]);
            afterIn("certreq-title", "Certificate request from " + who + " declined.");
          } });
        } });
      }
      var li = personItem(person, [
        "Period: " + plainDay(c.from) + " – " + plainDay(c.to),
        cov.minutes ? "Approved hours in this period: " + duration(cov.minutes) + " (" + E.plural(cov.approved.length, "shift") + ")" : "No approved hours in this period yet",
        cov.pendingShifts ? E.plural(cov.pendingShifts, "shift") + " (" + duration(cov.pendingMinutes) + ") still waiting for approval, not included" : "",
        c.note ? "“" + c.note + "”" : "",
        "Asked " + when(c.requestedAt),
        own && canIssue ? "Your own request: nobody issues their own certificate, so another Admin issues it" + (otherAdmins() ? "." : ". " + ONLY_ADMIN) : ""
      ], actions);
      ul.appendChild(li);
    });
    var il = $("issued-list");
    il.innerHTML = "";
    issued.forEach(function (c) {
      var person = { id: "issued-" + c.id, name: c.name, email: c.email, photo: photoFor(c.email) };
      var li = personItem(person, [
        plainDay(c.from) + " – " + plainDay(c.to) + " · " + duration((c.data || {}).minutes || 0),
        "Issued " + when(c.issuedAt) + " · No. " + c.code
      ], [{ text: "View", cls: "btn-secondary btn-small", label: "View the certificate for " + (c.name || c.email), onClick: function () { location.href = "certificate.html?id=" + encodeURIComponent(c.id); } }]);
      il.appendChild(li);
    });
    $("issued-box").hidden = !issued.length;
    $("issued-summary").textContent = issued.length === 1 ? "1 certificate issued" : issued.length + " certificates issued";
  }

  function render() {
    renderHours();
    renderCertRequests();
    var list = M.forOrg(org.id);
    var by = function (status) { return list.filter(function (m) { return m.status === status; }); };

    // Requests
    var requests = by("requested").sort(function (a, b) { return (a.requestedAt || "").localeCompare(b.requestedAt || ""); });
    var rl = $("request-list");
    rl.innerHTML = "";
    requests.forEach(function (m) {
      var services = (m.services || []).map(function (s) { return SERVICE_NAMES[s] || s; }).join(", ");
      rl.appendChild(person(m, [
        m.note ? "“" + m.note + "”" : "",
        services ? "Can help with: " + services : "",
        "Asked " + when(m.requestedAt)
      ], [
        { text: "Approve", cls: "btn-primary btn-small", onClick: function () { M.approve(m.id); after((m.name || m.email) + " is now a volunteer." + (window.SevakServer ? "" : " (Approval email in the outbox.)")); } },
        { text: "Decline", cls: "btn-secondary btn-small", onClick: function () {
          if (!window.confirm("Decline " + (m.name || m.email) + "'s request?")) return;
          M.decline(m.id);
          after("Request declined.");
        } }
      ]));
    });
    $("requests-empty").hidden = requests.length > 0;
    $("requests-title").textContent = requests.length ? "Requests to join (" + requests.length + ")" : "Requests to join";

    // Approve automatically (Admins)
    $("auto-approve").checked = !!org.autoApprove;
    $("auto-approve").disabled = !isAdmin;
    $("auto-hint").hidden = isAdmin;
    $("auto-hint").textContent = isAdmin ? "" : "Only Admins can change this.";

    // Invite link
    var code = M.inviteCode(org.id);
    org = O.get(org.id);
    $("invite-link").value = M.inviteLink(code);
    $("invite-code").textContent = code;

    // Invited
    var invited = by("invited");
    var il = $("invited-list");
    il.innerHTML = "";
    invited.forEach(function (m) {
      il.appendChild(person(m, ["Invited " + when(m.invitedAt)], [
        { text: "Cancel invitation", cls: "btn-danger-link", onClick: function () { M.remove(m.id); after("Invitation cancelled."); } }
      ]));
    });
    $("invited-title").hidden = !invited.length;

    // Volunteers
    var active = by("active").sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
    var ml = $("member-list");
    ml.innerHTML = "";
    // A long list starts short.
    var SHORT = 8;
    var showAll = $("show-all-members");
    if (!showAll) {
      showAll = el("button", "btn btn-secondary btn-small", "");
      showAll.type = "button";
      showAll.id = "show-all-members";
      showAll.addEventListener("click", function () { expanded = true; render(); ml.children[SHORT] && ml.children[SHORT].focus(); });
      ml.insertAdjacentElement("afterend", showAll);
    }
    var shown = expanded ? active : active.slice(0, SHORT);
    showAll.hidden = expanded || active.length <= SHORT;
    showAll.textContent = "Show all " + active.length + " volunteers";
    var how = { invitation: "Joined by invitation", "auto-approved": "Joined (approved automatically)", request: "Approved" };
    shown.forEach(function (m) {
      ml.appendChild(person(m, [(how[m.how] || "Joined") + " " + when(m.decidedAt || m.createdAt)], [
        { text: "Remove", cls: "btn-danger-link", onClick: function () {
          if (!window.confirm("Remove " + (m.name || m.email) + " from your volunteers? They'd need a new invitation or approval to sign up again.")) return;
          M.remove(m.id);
          after("Removed.");
        } }
      ]));
    });
    $("members-empty").hidden = active.length > 0;
    $("members-title").textContent = active.length ? "Volunteers (" + active.length + ")" : "Volunteers";

    // Declined
    var declined = by("declined");
    $("declined-box").hidden = !declined.length;
    $("declined-summary").textContent = declined.length === 1 ? "1 declined request" : declined.length + " declined requests";
    var dl = $("declined-list");
    dl.innerHTML = "";
    declined.forEach(function (m) {
      dl.appendChild(person(m, [m.note ? "“" + m.note + "”" : "", "Declined " + when(m.decidedAt)], [
        { text: "Approve after all", cls: "btn-secondary btn-small", onClick: function () { M.approve(m.id); after((m.name || m.email) + " is now a volunteer."); } }
      ]));
    });
  }

  // ---------- Invite ----------

  $("copy-link").addEventListener("click", function () {
    var input = $("invite-link");
    input.select();
    var done = function () { $("vol-status").textContent = "Invite link copied."; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, function () { document.execCommand("copy"); done(); });
    else { document.execCommand("copy"); done(); }
  });

  $("reset-link").addEventListener("click", function () {
    if (!window.confirm("Make a new invite link? The old link and code stop working.")) return;
    M.resetInviteCode(org.id);
    org = O.get(org.id);
    render();
    $("vol-status").textContent = "New invite link made. The old one no longer works.";
  });

  $("send-invites").addEventListener("click", function () {
    var raw = $("invite-emails").value;
    var emails = raw.split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    var bad = emails.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
    var input = $("invite-emails");
    if (!emails.length) { F.setError(input, "Enter at least one email."); input.focus(); return; }
    if (bad.length) { F.setError(input, "Check " + (bad.length === 1 ? "this email: " : "these emails: ") + bad.join(", ")); input.focus(); return; }
    F.setError(input, "");
    var r = M.invite(org.id, emails);
    input.value = "";
    render();
    $("vol-status").textContent = (r.sent.length ? "Invitation sent to " + r.sent.join(", ") + "." + (window.SevakServer ? "" : " (See the outbox.)") : "") +
      (r.skipped.length ? " Already a volunteer or invited: " + r.skipped.join(", ") + "." : "");
  });

  $("auto-approve").addEventListener("change", function () {
    M.setAutoApprove(org.id, $("auto-approve").checked);
    org = O.get(org.id);
    $("vol-status").textContent = org.autoApprove ? "New requests will be approved automatically." : "You'll approve each request.";
  });

  render();
})();
