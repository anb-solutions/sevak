// Volunteer sign-up (prototype). Four views on one page:
//   signup.html                    → volunteer opportunities (upcoming events)
//   signup.html?view=mine          → my sign-ups
//   signup.html?event=ID           → one event: pick shifts, then confirm (#confirm)
//   signup.html?registration=ID    → "manage my sign-up": see and cancel shifts
(function () {
  "use strict";

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var E = window.SevakEvents;
  var S = window.SevakSignups;
  var M = window.SevakMembers;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  // ---------- Helpers ----------

  function todayString() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function countryName(code) {
    var c = F.countries.filter(function (x) { return x.code === code; })[0];
    return c ? c.name : "";
  }

  function isVerified(org) {
    return !!org && org.verificationStatus === "verified";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Every shift of an event, with its role, sorted by day and time.
  function allShifts(event) {
    var list = [];
    (event.roles || []).forEach(function (role) {
      (role.shifts || []).forEach(function (shift) {
        list.push({ id: shift.id, date: shift.date, start: shift.start, end: shift.end, capacity: Number(shift.capacity) || 0, role: role });
      });
    });
    return list.sort(function (a, b) { return (a.date + a.start + (a.role.name || "")).localeCompare(b.date + b.start + (b.role.name || "")); });
  }

  function spotsLeft(event) {
    var counts = S.countsByShift(event.id);
    return allShifts(event).reduce(function (n, s) { return n + Math.max(0, s.capacity - (counts[s.id] || 0)); }, 0);
  }

  function shiftLabel(s) {
    return E.dayLabel(s.date) + " · " + E.timeLabel(s.start) + "–" + E.timeLabel(s.end) + " · " + (s.role.name || "Role");
  }

  function placeText(event) {
    var loc = event.location || {};
    if (loc.type === "online") return "Online";
    return [loc.venue, loc.line1, loc.city, loc.state, countryName(loc.country)].filter(Boolean).join(", ");
  }

  function showOnly(id) {
    ["discover-view", "mine-view", "event-view", "confirm-view"].forEach(function (v) { $(v).hidden = v !== id; });
  }

  function showNotice(html) {
    var n = $("notice");
    n.innerHTML = "";
    html.forEach(function (part) { n.appendChild(part); });
    n.hidden = false;
  }

  // ---------- Find events ----------

  // A short place: the venue and city, or "Online".
  function shortPlace(event) {
    var loc = event.location || {};
    if (loc.type === "online") return "Online";
    return [loc.venue, loc.city].filter(Boolean).join(", ") || placeText(event);
  }

  // "Sun, Oct 18" or "Sun, Oct 18 – Mon, Oct 19" (no year: it's soon).
  function rowDate(event) {
    if (!event.endDate || event.endDate === event.startDate) return E.dayLabel(event.startDate);
    return E.dayLabel(event.startDate) + " – " + E.dayLabel(event.endDate);
  }

  // One opportunity: the whole row is a link to the event.
  // On "All organizations": what joining looks like for this event's organization.
  function joinTag(event) {
    if (!F.session.signedIn()) return "";
    var st = M.myStatus(event.organizationId);
    if (st === "team" || st === "active") return "";
    return st === "requested" ? "Request sent" : "Join to sign up";
  }

  function oppRow(event, showOrg) {
    var li = el("li");
    var a = el("a", "opp-row");
    a.href = "signup.html?event=" + encodeURIComponent(event.id);
    var text = el("div", "opp-text");
    text.appendChild(el("h3", "opp-title", event.title || "Untitled event"));
    text.appendChild(el("p", "opp-meta", [rowDate(event), shortPlace(event)].filter(Boolean).join(" · ")));
    if (showOrg) {
      var org = O.get(event.organizationId);
      if (org) text.appendChild(el("p", "opp-org", org.name));
    }
    var tag = joinTag(event);
    if (tag) text.appendChild(el("p", "opp-join" + (tag === "Request sent" ? " is-pending" : ""), tag));
    var left = spotsLeft(event);
    a.appendChild(text);
    a.appendChild(el("span", "opp-spots" + (left ? "" : " is-full"), left ? E.plural(left, "spot") : "Full"));
    li.appendChild(a);
    return li;
  }

  // "This week" runs Monday to Sunday.
  function weekBucket(event, today) {
    var d = new Date(today + "T00:00:00");
    var monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    var iso = function (x) {
      var pad = function (n) { return String(n).padStart(2, "0"); };
      return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
    };
    var endThis = new Date(monday); endThis.setDate(monday.getDate() + 6);
    var endNext = new Date(monday); endNext.setDate(monday.getDate() + 13);
    var start = event.startDate < today ? today : event.startDate;
    if (start <= iso(endThis)) return "This week";
    if (start <= iso(endNext)) return "Next week";
    return "Later";
  }

  // Published, active, public events that haven't ended.
  function upcomingEvents() {
    var today = todayString();
    return E.all().filter(function (e) {
      return e.status === "published" && E.isActive(e) && e.visibility !== "private" && e.startDate && (e.endDate || e.startDate) >= today;
    }).sort(E.byDate);
  }

  // ---------- Filter: all, in person near me, all in person, remote ----------

  var FILTER_KEY = "sevak.opportunityFilter.v1";

  function norm(x) {
    return String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function isRemote(event) {
    return (event.location || {}).type === "online";
  }

  // "Near" has no map yet: an event is near when it's in the same city or
  // town, state or region, or postal area (first three characters) as what
  // was typed. "Austin, TX" matches on the city.
  function isNear(event, near) {
    var loc = event.location || {};
    var q = norm(near);
    if (!q || isRemote(event)) return false;
    if (q.indexOf(",") !== -1) return norm(loc.city) === norm(q.split(",")[0]);
    if (norm(loc.city) === q || norm(loc.state) === q) return true;
    var typed = q.replace(/[\s-]/g, "");
    var postal = norm(loc.postalCode).replace(/[\s-]/g, "");
    return /\d/.test(typed) && typed.length >= 3 && postal.slice(0, 3) === typed.slice(0, 3);
  }

  function matches(event, where, near) {
    if (where === "remote") return isRemote(event);
    if (where === "in-person") return !isRemote(event);
    if (where === "near") return isNear(event, near);
    return true;
  }

  function currentWhere() {
    var checked = document.querySelector('input[name="where"]:checked');
    return checked ? checked.value : "all";
  }

  function setupFilter() {
    var saved = F.load(FILTER_KEY) || {};
    var profile = F.session.profile() || {};
    var address = profile.address || {};
    var fromProfile = address.city || address.postalCode || "";
    $("near").value = saved.near != null ? saved.near : fromProfile;
    $("near-source").textContent = saved.near == null && fromProfile ? "Filled in from your profile." : "";
    var radio = document.querySelector('input[name="where"][value="' + (saved.where || "all") + '"]');
    if (radio) radio.checked = true;

    $("opp-filter").addEventListener("change", function () {
      F.store(FILTER_KEY, { where: currentWhere(), near: $("near").value });
      renderAvailable();
      if (currentWhere() === "near" && !$("near").value.trim()) $("near").focus();
    });
    $("near").addEventListener("input", function () {
      $("near-source").textContent = "";
      F.store(FILTER_KEY, { where: currentWhere(), near: $("near").value });
      renderAvailable();
    });
  }

  // ---------- My organizations / All organizations ----------

  var orgTab = "all";

  function selectOrgTab(key, focus) {
    orgTab = key;
    [["my", "tab-my-orgs"], ["all", "tab-all-orgs"]].forEach(function (t) {
      var on = t[0] === key;
      $(t[1]).setAttribute("aria-selected", String(on));
      $(t[1]).tabIndex = on ? 0 : -1;
      if (on) {
        $("discover-panel").setAttribute("aria-labelledby", t[1]);
        if (focus) $(t[1]).focus();
      }
    });
    history.replaceState(null, "", location.search + "#" + (key === "my" ? "my-orgs" : "all-orgs"));
    renderAvailable();
  }

  function setupOrgTabs() {
    var on = F.session.signedIn();
    $("org-tabs").hidden = !on;
    $("browse-hint").hidden = on;
    if (!on) { orgTab = "all"; return; }
    $("discover-panel").setAttribute("role", "tabpanel");
    var h = location.hash.replace("#", "");
    var key = h === "all-orgs" ? "all" : h === "my-orgs" ? "my" : (M.myOrgIds().length ? "my" : "all");
    var keys = ["my", "all"];
    keys.forEach(function (k, i) {
      var tab = $(k === "my" ? "tab-my-orgs" : "tab-all-orgs");
      tab.addEventListener("click", function () { selectOrgTab(k); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        selectOrgTab(keys[e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - i], true);
      });
    });
    selectOrgTab(key);
  }

  // On "My organizations": who you volunteer with, and requests waiting.
  function renderMemberStrip() {
    var strip = $("member-strip");
    strip.innerHTML = "";
    strip.hidden = orgTab !== "my";
    if (strip.hidden) return;
    var mineIds = M.myOrgIds();
    var waiting = M.mine().filter(function (m) { return m.status === "requested"; });
    var p = el("p");
    if (mineIds.length) {
      p.appendChild(document.createTextNode("You volunteer with "));
      p.appendChild(el("strong", null, mineIds.map(function (id) { return O.get(id).name; }).join(", ")));
      p.appendChild(document.createTextNode(". "));
    }
    if (waiting.length) {
      p.appendChild(document.createTextNode("Waiting for approval: " + waiting.map(function (m) { return (O.get(m.orgId) || {}).name; }).filter(Boolean).join(", ") + ". "));
    }
    var join = el("a", null, "Join an organization");
    join.href = "join.html";
    p.appendChild(join);
    strip.appendChild(p);
  }

  function emptyState(parts) {
    var box = $("discover-empty");
    box.innerHTML = "";
    parts.forEach(function (x) { box.appendChild(typeof x === "string" ? el("p", null, x) : x); });
  }

  function buttonsRow(items) {
    var p = el("p", "fill-row");
    items.forEach(function (it) {
      var b = el(it.href ? "a" : "button", "btn btn-small " + (it.primary ? "btn-primary" : "btn-secondary"), it.text);
      if (it.href) b.href = it.href; else { b.type = "button"; b.addEventListener("click", it.onClick); }
      p.appendChild(b);
    });
    return p;
  }

  function renderAvailable() {
    var where = currentWhere();
    var near = $("near").value;
    var everything = upcomingEvents();
    var all = orgTab === "my" ? everything.filter(function (e) { return M.isMember(e.organizationId); }) : everything;
    renderMemberStrip();
    ["all", "near", "in-person", "remote"].forEach(function (w) {
      var count = all.filter(function (e) { return matches(e, w, near); }).length;
      var badge = document.querySelector('[data-count="' + w + '"]');
      badge.textContent = w === "near" && !norm(near) ? "" : "(" + count + ")";
    });
    $("near-row").hidden = where !== "near";

    var events = all.filter(function (e) { return matches(e, where, near); });
    var listed = events.filter(function (e) { return isVerified(O.get(e.organizationId)); });
    var preview = events.filter(function (e) { return !isVerified(O.get(e.organizationId)); });
    // Only name the organization when the list has events from more than one.
    var orgIds = {};
    events.forEach(function (e) { orgIds[e.organizationId] = true; });
    var showOrg = Object.keys(orgIds).length > 1;

    var box = $("discover-list");
    box.innerHTML = "";
    var today = todayString();
    var groups = [["This week", []], ["Next week", []], ["Later", []]];
    listed.forEach(function (e) {
      var bucket = weekBucket(e, today);
      groups.filter(function (g) { return g[0] === bucket; })[0][1].push(e);
    });
    groups.forEach(function (g) {
      if (!g[1].length) return;
      box.appendChild(el("h2", "opp-group", g[0]));
      var ul = el("ul", "opp-list");
      g[1].forEach(function (e) { ul.appendChild(oppRow(e, showOrg)); });
      box.appendChild(ul);
    });
    if (preview.length) {
      var head = el("h2", "opp-group", "Not listed publicly yet");
      box.appendChild(head);
      box.appendChild(el("p", "hint opp-group-hint", "These organizations aren't verified yet, so their events can only be reached by link."));
      var pul = el("ul", "opp-list");
      preview.forEach(function (e) { pul.appendChild(oppRow(e, true)); });
      box.appendChild(pul);
    }

    var empty = $("discover-empty");
    empty.hidden = events.length > 0;
    var browse = { text: "Browse all organizations", onClick: function () { selectOrgTab("all", true); } };
    if (orgTab === "my" && !M.myOrgIds().length) {
      emptyState(["You're not a volunteer with any organization yet. Join one with an invitation, or ask to join.",
        buttonsRow([{ text: "Join an organization", href: "join.html", primary: true }, browse])]);
    } else if (!all.length) {
      emptyState(orgTab === "my"
        ? ["Your organizations have no upcoming opportunities right now.", buttonsRow([browse])]
        : ["There are no upcoming opportunities right now. Check back soon."]);
    } else if (where === "near" && !norm(near)) {
      emptyState(["Enter your city or town, region or postal code to see in-person events near you."]);
    } else if (where === "near") {
      emptyState(["No in-person opportunities near " + near.trim() + " right now. Try All in person."]);
    } else if (where === "remote") {
      emptyState(["No remote opportunities right now."]);
    } else if (where === "in-person") {
      emptyState(["No in-person opportunities right now."]);
    }
  }

  // ---------- My sign-ups ----------

  // ---------- Hours: check in, check out, or log them ----------
  // On the day of a shift a volunteer can check in (from an hour before it
  // starts) and check out when done; Sevak works out the hours. Or they log
  // their hours afterwards, as from–to times or as a duration. Hours are
  // kept on the sign-up as { minutes, from, to, method, loggedAt }.

  var CHECK_IN_EARLY = 60;   // minutes before a shift starts

  function pad2(n) { return String(n).padStart(2, "0"); }
  function toMin(hm) { var p = String(hm || "").split(":").map(Number); return p[0] * 60 + (p[1] || 0); }
  function fromMin(m) { return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60); }
  function localHM(iso) { var d = new Date(iso); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function nowHM() { return localHM(new Date().toISOString()); }

  function durationLabel(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + " h " + m + " min";
    return h ? h + " h" : m + " min";
  }

  // future | soon (check-in not open yet) | now (can check in) | checked-in | to-log | logged
  function hoursState(su, sh) {
    if (su.hours && su.hours.minutes) return "logged";
    if (su.checkInAt) return "checked-in";
    var today = todayString();
    if (sh.date > today) return "future";
    if (sh.date === today) {
      var now = toMin(nowHM());
      if (now < toMin(sh.start) - CHECK_IN_EARLY) return "soon";
      if (now < toMin(sh.end)) return "now";
    }
    return "to-log";
  }

  function saveHours(su, sh, patch, message) {
    if (!S.update(su.id, patch)) {
      $("mine-status").textContent = "Couldn't save in this browser. Check that site storage is allowed.";
      return;
    }
    renderMine();
    $("mine-status").textContent = message;
    var again = document.getElementById("mine-shift-" + su.id);
    if (again) again.focus();
  }

  function checkIn(su, sh) {
    saveHours(su, sh, { checkInAt: new Date().toISOString() },
      "Checked in for " + (sh.role.name || "your shift") + ". Check out when you're done.");
  }

  function checkOut(su, sh) {
    var out = new Date();
    var minutes = Math.max(1, Math.round((out - new Date(su.checkInAt)) / 60000));
    saveHours(su, sh, {
      checkOutAt: out.toISOString(),
      hours: { minutes: minutes, from: localHM(su.checkInAt), to: localHM(out.toISOString()), method: "check-in", loggedAt: out.toISOString(), status: "pending" }
    }, "Checked out. " + durationLabel(minutes) + " logged for " + (sh.role.name || "your shift") + ". Thank you! It's waiting for the event admin's approval.");
  }

  function field(label, input) {
    var f = el("div", "field");
    var l = el("label", null, label);
    l.htmlFor = input.id;
    f.appendChild(l);
    f.appendChild(input);
    return f;
  }

  function input(type, id, value, attrs) {
    var i = el("input");
    i.type = type;
    i.id = id;
    if (value != null) i.value = value;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }

  // The "Log hours" form: from–to times, or how long.
  function hoursForm(su, sh, li) {
    var id = "h-" + su.id;
    var h = su.hours || {};
    var from = h.from || (su.checkInAt ? localHM(su.checkInAt) : sh.start);
    var to = h.to || sh.end;
    var length = h.minutes || Math.max(0, toMin(sh.end) - toMin(sh.start));

    var form = el("form", "hours-form");
    form.noValidate = true;
    var mode = el("fieldset", "hours-mode");
    mode.appendChild(el("legend", null, "How do you want to enter your hours?"));
    [["times", "From and to"], ["duration", "How long"]].forEach(function (m) {
      var chip = el("label", "filter-chip");
      var r = input("radio", id + "-" + m[0], m[0], { name: id + "-mode" });
      r.checked = (h.method === "duration") === (m[0] === "duration");
      chip.appendChild(r);
      chip.appendChild(el("span", null, m[1]));
      mode.appendChild(chip);
    });
    form.appendChild(mode);

    var times = el("div", "hours-fields hours-times");
    var fromIn = input("time", id + "-from", from);
    var toIn = input("time", id + "-to", to);
    times.appendChild(field("From", fromIn));
    times.appendChild(field("To", toIn));
    form.appendChild(times);

    var dur = el("div", "hours-fields hours-duration");
    var hIn = input("number", id + "-hours", Math.floor(length / 60), { min: "0", max: "24", step: "1", inputmode: "numeric" });
    var mIn = input("number", id + "-minutes", length % 60, { min: "0", max: "59", step: "5", inputmode: "numeric" });
    dur.appendChild(field("Hours", hIn));
    dur.appendChild(field("Minutes", mIn));
    form.appendChild(dur);

    var error = el("p", "error hours-error");
    error.setAttribute("role", "alert");
    form.appendChild(error);
    var actions = el("div", "hours-actions");
    var cancel = el("button", "btn btn-secondary btn-small", "Cancel");
    cancel.type = "button";
    var save = el("button", "btn btn-primary btn-small", "Save hours");
    save.type = "submit";
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    var useDuration = function () { return form.querySelector('input[value="duration"]').checked; };
    var applyMode = function () {
      times.hidden = useDuration();
      dur.hidden = !useDuration();
      error.textContent = "";
    };
    mode.addEventListener("change", applyMode);
    applyMode();

    cancel.addEventListener("click", function () {
      form.remove();
      li.querySelector(".hours-row").hidden = false;
      var b = li.querySelector(".hours-row button");
      if (b) b.focus();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var minutes, record;
      if (useDuration()) {
        var hh = Number(hIn.value || 0), mm = Number(mIn.value || 0);
        if (!Number.isInteger(hh) || hh < 0 || !Number.isInteger(mm) || mm < 0 || mm > 59) {
          error.textContent = "Enter whole hours, and minutes from 0 to 59.";
          (mm > 59 || mm < 0 ? mIn : hIn).focus();
          return;
        }
        minutes = hh * 60 + mm;
        if (!minutes) { error.textContent = "Enter how long you volunteered."; hIn.focus(); return; }
        if (minutes > 24 * 60) { error.textContent = "That's more than 24 hours. Log each day's shift on its own."; hIn.focus(); return; }
        record = { minutes: minutes, method: "duration" };
      } else {
        if (!fromIn.value || !toIn.value) { error.textContent = "Enter both times."; (fromIn.value ? toIn : fromIn).focus(); return; }
        minutes = toMin(toIn.value) - toMin(fromIn.value);
        if (minutes <= 0) { error.textContent = "The end time must be after the start time. For a shift past midnight, use How long."; toIn.focus(); return; }
        record = { minutes: minutes, from: fromIn.value, to: toIn.value, method: "times" };
      }
      record.loggedAt = new Date().toISOString();
      record.status = "pending";   // the event's admin approves them
      saveHours(su, sh, { hours: record }, durationLabel(minutes) + " logged for " + (sh.role.name || "your shift") + " on " + E.dayLabel(sh.date) + ". It's waiting for the event admin's approval.");
    });
    return form;
  }

  function openForm(su, sh, li) {
    var old = document.querySelector(".hours-form");
    if (old) {
      old.parentNode.querySelector(".hours-row").hidden = false;
      old.remove();
    }
    var form = hoursForm(su, sh, li);
    li.querySelector(".hours-row").hidden = true;
    li.appendChild(form);
    var first = form.querySelector(".hours-fields:not([hidden]) input");
    if (first) first.focus();
  }

  function actionButton(text, cls, onClick) {
    var b = el("button", "btn " + cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  // One shift on a My sign-ups card, with its hours.
  function shiftItem(su, sh) {
    var li = el("li", "signup-shift");
    li.id = "mine-shift-" + su.id;
    li.tabIndex = -1;
    li.appendChild(el("span", "signup-shift-label", shiftLabel(sh)));
    var state = hoursState(su, sh);
    if (state === "future") return li;
    var row = el("div", "hours-row hours-" + state);
    if (state === "soon") {
      row.appendChild(el("span", "hint", "Check-in opens at " + E.timeLabel(fromMin(Math.max(0, toMin(sh.start) - CHECK_IN_EARLY))) + "."));
    } else if (state === "now") {
      row.appendChild(actionButton("Check in", "btn-primary btn-small", function () { checkIn(su, sh); }));
      row.appendChild(actionButton("Log hours", "btn-link", function () { openForm(su, sh, li); }));
    } else if (state === "checked-in") {
      row.appendChild(el("span", "hours-note", "Checked in at " + E.timeLabel(localHM(su.checkInAt))));
      row.appendChild(actionButton("Check out", "btn-primary btn-small", function () { checkOut(su, sh); }));
      row.appendChild(actionButton("Log hours instead", "btn-link", function () { openForm(su, sh, li); }));
    } else if (state === "to-log") {
      row.appendChild(el("span", "hours-note hours-ask", "How long did you volunteer?"));
      row.appendChild(actionButton("Log hours", "btn-primary btn-small", function () { openForm(su, sh, li); }));
    } else {
      var h = su.hours;
      var text = el("span", "hours-note hours-done");
      text.appendChild(el("strong", null, "✓ " + durationLabel(h.minutes)));
      text.appendChild(document.createTextNode(h.from && h.to ? " · " + E.timeLabel(h.from) + "–" + E.timeLabel(h.to) : " · logged as a duration"));
      row.appendChild(text);
      // Approval by the event's admin
      var st = S.hoursStatus(su);
      row.appendChild(st === "approved"
        ? E.badge(h.approvedMinutes != null ? "Approved as " + durationLabel(h.approvedMinutes) : "Approved", "published")
        : st === "rejected" ? E.badge("Not approved", "inactive") : E.badge("Waiting for approval", "draft"));
      var edit = actionButton("Edit", "btn-link", function () {
        if (st === "approved" && !window.confirm("These hours are approved. If you change them, they'll need approving again.")) return;
        openForm(su, sh, li);
      });
      edit.setAttribute("aria-label", "Edit hours for " + shiftLabel(sh));
      row.appendChild(edit);
      if (st === "rejected" && h.reason) {
        li.appendChild(row);
        li.appendChild(el("p", "hours-reason", "Not approved: " + h.reason + " You can edit your hours to send them again."));
        return li;
      }
    }
    li.appendChild(row);
    return li;
  }

  function signupCard(reg, kind) {
    var ev = reg.event;
    var org = ev ? O.get(ev.organizationId) : null;
    var li = el("li", "event-item my-signup" + (kind === "cancelled" ? " is-cancelled" : ""));
    var info = el("div");
    if (org) info.appendChild(el("p", "opp-org", org.name));
    var h3 = el("h3");
    if (ev) {
      var link = el("a", null, ev.title || "Untitled event");
      link.href = "signup.html?event=" + encodeURIComponent(ev.id);
      h3.appendChild(link);
    } else {
      h3.textContent = "An event that was removed";
    }
    info.appendChild(h3);
    if (ev) info.appendChild(el("p", "event-meta", [rowDate(ev), shortPlace(ev)].filter(Boolean).join(" · ")));

    var byId = {};
    if (ev) allShifts(ev).forEach(function (s) { byId[s.id] = s; });
    var items = (kind === "cancelled" ? reg.signups : reg.confirmed)
      .map(function (su) { return { su: su, sh: byId[su.shiftId] }; })
      .filter(function (x) { return x.sh; })
      .sort(function (a, b) { return (a.sh.date + a.sh.start).localeCompare(b.sh.date + b.sh.start); });
    var shiftsList = el("ul", "signup-shifts");
    var toLog = 0;
    items.forEach(function (x) {
      if (kind === "cancelled") { shiftsList.appendChild(el("li", null, shiftLabel(x.sh))); return; }
      if (hoursState(x.su, x.sh) === "to-log") toLog++;
      shiftsList.appendChild(shiftItem(x.su, x.sh));
    });
    if (shiftsList.children.length) info.appendChild(shiftsList);

    var manage = el("a", "signup-manage", (kind === "upcoming" || kind === "today") && ev ? "Manage or cancel" : "View sign-up");
    manage.href = "signup.html?registration=" + encodeURIComponent(reg.id);
    info.appendChild(manage);

    var side = el("div", "badges");
    if (kind === "cancelled") side.appendChild(E.badge("Cancelled"));
    else if (!ev) side.appendChild(E.badge("Removed"));
    else if (!E.isActive(ev)) side.appendChild(E.badge("No longer active", "inactive"));
    else if (toLog) side.appendChild(E.badge("Hours to log", "draft"));
    else if (kind === "today") side.appendChild(E.badge("Today", "published"));
    else if (kind === "past") side.appendChild(E.badge("Done"));
    else side.appendChild(E.badge(E.plural(reg.confirmed.length, "shift"), "published"));
    li.appendChild(info);
    li.appendChild(side);
    return li;
  }

  // Lists the signed-in volunteer's sign-ups (matched by email), grouped
  // into today, upcoming, past and cancelled, with their hours.
  function renderMine() {
    var profile = F.session.profile();
    var email = norm(profile && profile.email);
    var regs = {};
    var order = [];
    S.all().forEach(function (s) {
      if (!email || norm(s.email) !== email) return;
      var key = s.registrationId || s.id;
      if (!regs[key]) { regs[key] = { id: key, event: E.get(s.eventId), signups: [] }; order.push(key); }
      regs[key].signups.push(s);
    });
    var today = todayString();
    var groups = { today: [], upcoming: [], past: [], cancelled: [] };
    var logged = 0, loggedShifts = 0, toLog = 0, approved = 0, waiting = 0;
    order.forEach(function (key) {
      var r = regs[key];
      r.confirmed = r.signups.filter(function (s) { return s.status !== "cancelled"; });
      var byId = {};
      if (r.event) allShifts(r.event).forEach(function (s) { byId[s.id] = s; });
      r.confirmed.forEach(function (su) {
        var sh = byId[su.shiftId];
        if (!sh) return;
        var state = hoursState(su, sh);
        if (state === "logged") {
          logged += su.hours.minutes; loggedShifts++;
          approved += S.creditedMinutes(su);
          if (S.hoursStatus(su) === "pending") waiting++;
        }
        if (state === "to-log") toLog++;
      });
      var onToday = r.confirmed.some(function (su) { return byId[su.shiftId] && byId[su.shiftId].date === today; });
      if (!r.confirmed.length) groups.cancelled.push(r);
      else if (onToday) groups.today.push(r);
      else if (r.event && (r.event.endDate || r.event.startDate || "") < today) groups.past.push(r);
      else groups.upcoming.push(r);
    });
    var start = function (r) { return r.event ? r.event.startDate || "" : "9999"; };
    groups.upcoming.sort(function (a, b) { return start(a).localeCompare(start(b)); });
    groups.past.sort(function (a, b) { return start(b).localeCompare(start(a)); });

    // Your hours so far.
    var summary = $("hours-summary");
    summary.innerHTML = "";
    summary.hidden = !logged && !toLog;
    if (!summary.hidden) {
      var total = el("p", "hours-total");
      total.appendChild(el("span", "hours-total-label", "Hours volunteered"));
      total.appendChild(el("strong", "hours-total-value", logged ? durationLabel(logged) : "None yet"));
      summary.appendChild(total);
      var parts = [];
      if (loggedShifts) parts.push(E.plural(loggedShifts, "shift") + " logged");
      if (loggedShifts) parts.push(durationLabel(approved) + " approved");
      if (waiting) parts.push(E.plural(waiting, "shift") + " waiting for approval");
      if (toLog) parts.push(E.plural(toLog, "shift") + " waiting for hours");
      summary.appendChild(el("p", "hours-sub", parts.join(" · ")));
    }

    var box = $("mine-groups");
    box.innerHTML = "";
    [["today", "Today"], ["upcoming", "Upcoming"], ["past", "Past"], ["cancelled", "Cancelled"]].forEach(function (g) {
      if (!groups[g[0]].length) return;
      box.appendChild(el("h2", "list-heading mine-heading", g[1]));
      var ul = el("ul", "event-list");
      groups[g[0]].forEach(function (r) { ul.appendChild(signupCard(r, g[0])); });
      box.appendChild(ul);
    });
    $("mine-empty").hidden = order.length > 0;
    renderCertificates();
  }

  // ---------- Certificates: ask an organization, for a period ----------

  var C = window.SevakCerts;

  function plainDay(date) { return E.dayLabel(date, { weekday: undefined, year: "numeric" }); }

  function renderCertificates() {
    if (!C) return;
    var orgs = C.myOrgsWithHours();
    var mine = C.mine();
    var box = $("certificates");
    box.hidden = !orgs.length && !mine.length;
    if (box.hidden) return;
    var list = $("cert-list");
    list.innerHTML = "";
    mine.forEach(function (c) {
      var org = O.get(c.orgId);
      var li = el("li", "cert-item");
      var text = el("div");
      text.appendChild(el("strong", null, org ? org.name : "An organization"));
      text.appendChild(el("p", "event-meta", plainDay(c.from) + " – " + plainDay(c.to) + (c.status === "issued" && c.data ? " · " + C.durationLabel(c.data.minutes) : "")));
      if (c.status === "declined" && c.reason) text.appendChild(el("p", "hours-reason", "Not issued: " + c.reason));
      li.appendChild(text);
      var side = el("div", "cert-actions");
      if (c.status === "issued") {
        side.appendChild(E.badge("Issued", "published"));
        var view = el("a", "btn btn-secondary btn-small", "View certificate");
        view.href = "certificate.html?id=" + encodeURIComponent(c.id);
        side.appendChild(view);
      } else if (c.status === "declined") {
        side.appendChild(E.badge("Not issued", "inactive"));
      } else {
        side.appendChild(E.badge("Requested", "draft"));
        var w = el("button", "btn-link", "Withdraw");
        w.type = "button";
        w.setAttribute("aria-label", "Withdraw the request to " + (org ? org.name : "the organization"));
        w.addEventListener("click", function () {
          if (!window.confirm("Withdraw this certificate request?")) return;
          C.withdraw(c.id);
          renderCertificates();
          $("cert-status").textContent = "Request withdrawn.";
          $("certs-title").focus();
        });
        side.appendChild(w);
      }
      li.appendChild(side);
      list.appendChild(li);
    });
    $("cert-new").hidden = !orgs.length || !$("cert-form").hidden;
  }

  function certOrgInfo() {
    var id = $("cert-org").value;
    return C.myOrgsWithHours().filter(function (o) { return o.orgId === id; })[0] || null;
  }

  function setPeriod(from, to) {
    $("cert-from").value = from;
    $("cert-to").value = to;
    updateCoverage();
  }

  function preset(kind) {
    var t = todayString();
    var y = Number(t.slice(0, 4));
    var info = certOrgInfo();
    if (kind === "all" && info) setPeriod(info.first, info.last > t ? info.last : t);
    else if (kind === "year") setPeriod(y + "-01-01", t);
    else if (kind === "last-year") setPeriod((y - 1) + "-01-01", (y - 1) + "-12-31");
    else if (kind === "12m") setPeriod((y - 1) + t.slice(4), t);
  }

  function updateCoverage() {
    var from = $("cert-from").value, to = $("cert-to").value;
    var out = $("cert-coverage");
    if (!from || !to || to < from) { out.textContent = ""; return null; }
    var profile = F.session.profile();
    var cov = C.coverage(profile.email, $("cert-org").value, from, to);
    out.textContent = (cov.minutes
      ? "Covers " + C.durationLabel(cov.minutes) + " of approved hours (" + E.plural(cov.approved.length, "shift") + ")."
      : "No approved hours in this period yet.") +
      (cov.pendingShifts ? " " + C.durationLabel(cov.pendingMinutes) + " (" + E.plural(cov.pendingShifts, "shift") + ") still waiting for approval won't be included." : "");
    return cov;
  }

  function openCertForm() {
    var sel = $("cert-org");
    sel.innerHTML = "";
    C.myOrgsWithHours().forEach(function (o) {
      var opt = el("option", null, O.get(o.orgId).name);
      opt.value = o.orgId;
      sel.appendChild(opt);
    });
    $("cert-form").hidden = false;
    $("cert-new").hidden = true;
    $("cert-new").setAttribute("aria-expanded", "true");
    $("cert-note").value = "";
    $("cert-status").textContent = "";
    preset("all");
    sel.focus();
  }

  function closeCertForm() {
    $("cert-form").hidden = true;
    $("cert-new").setAttribute("aria-expanded", "false");
    renderCertificates();
  }

  if (C) {
    $("cert-new").addEventListener("click", openCertForm);
    $("cert-cancel").addEventListener("click", function () { closeCertForm(); $("cert-new").focus(); });
    $("cert-org").addEventListener("change", function () { preset("all"); });
    $("cert-from").addEventListener("input", updateCoverage);
    $("cert-to").addEventListener("input", updateCoverage);
    document.querySelectorAll(".cert-presets [data-preset]").forEach(function (b) {
      b.addEventListener("click", function () { preset(b.dataset.preset); });
    });
    $("cert-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var from = $("cert-from").value, to = $("cert-to").value;
      F.setError($("cert-from"), from ? "" : "Choose the first day.");
      F.setError($("cert-to"), !to ? "Choose the last day." : to < from ? "The last day must be on or after the first." : "");
      if (!from) { $("cert-from").focus(); return; }
      if (!to || to < from) { $("cert-to").focus(); return; }
      var cov = updateCoverage();
      if (!cov || !cov.minutes) {
        $("cert-status").textContent = "There are no approved hours in that period. Choose another period, or wait for your hours to be approved.";
        $("cert-from").focus();
        return;
      }
      var rec = C.request($("cert-org").value, from, to, $("cert-note").value);
      if (!rec) { $("cert-status").textContent = "Couldn't send the request in this browser."; return; }
      closeCertForm();
      $("cert-status").textContent = "Request sent to " + O.get(rec.orgId).name + ". Its Admin will issue your certificate; you'll get an email.";
      $("certs-title").focus();
    });
  }

  function renderOpportunities() {
    showOnly("discover-view");
    document.title = "Volunteer opportunities · Sevak";
    setupFilter();
    setupOrgTabs();
    renderAvailable();
  }

  function renderMineView() {
    showOnly("mine-view");
    document.title = "My sign-ups · Sevak";
    var on = F.session.signedIn();
    $("mine-signed-out").hidden = on;
    if (on) renderMine();
    // Links from emails: signup.html?view=mine#certificates
    if (on && location.hash === "#certificates" && !$("certificates").hidden) {
      $("certificates").scrollIntoView();
      $("certs-title").focus({ preventScroll: true });
    }
  }

  // ---------- One event: step 1, pick shifts ----------

  var event = null;
  var shifts = [];
  var canSignUp = false;
  var currentDay = "";

  function renderEventHeader() {
    var org = O.get(event.organizationId);
    var host = $("host-line");
    host.innerHTML = "";
    host.appendChild(el("span", null, org ? org.name : "An organization"));
    host.appendChild(document.createTextNode(" "));
    host.appendChild(isVerified(org) ? E.badge("Verified", "published") : E.badge("Not verified yet"));

    var main = event.mainEventId ? E.getMain(event.mainEventId) : null;
    $("main-line").hidden = !main;
    if (main) $("main-line").textContent = main.title || "Main event";
    $("event-title").textContent = event.title || "Untitled event";
    document.title = (event.title || "Event") + " · Sevak";
    $("event-facts").textContent = [E.rangeLabel(event.startDate, event.endDate), shortPlace(event)].filter(Boolean).join(" · ");

    // This is the page volunteers see. If you help run the organization,
    // say where to edit the event (drafts already say so in their notice).
    var role = F.session.signedIn() && org ? O.roleFor(org) : null;
    var hint = $("team-edit-hint");
    hint.hidden = !role || event.status !== "published";
    hint.innerHTML = "";
    if (!hint.hidden) {
      hint.appendChild(document.createTextNode("This is what volunteers see. You're " + (role === "admin" ? "an Admin" : "a Coordinator") + " here: "));
      var edit = el("a", null, "Edit this event");
      edit.href = "event.html?id=" + encodeURIComponent(event.id);
      hint.appendChild(edit);
    }

    // Everything else is folded under "About this event".
    var about = $("about-body");
    about.innerHTML = "";
    if (event.description) about.appendChild(el("p", null, event.description));
    var loc = event.location || {};
    if (loc.type === "online") {
      about.appendChild(el("p", null, "Online. The meeting link is shared with volunteers who sign up."));
    } else if (placeText(event) && placeText(event) !== shortPlace(event)) {
      about.appendChild(el("p", null, "Address: " + placeText(event)));
    }
    var local = "";
    try { local = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    if (event.timezone && event.timezone !== local) {
      about.appendChild(el("p", null, "Times are in " + event.timezone.replace(/_/g, " ") + " time."));
    }
    $("about-event").hidden = !about.children.length;
  }

  function selectedIds() {
    return Array.prototype.map.call(document.querySelectorAll('input[name="shift"]:checked'), function (b) { return b.value; });
  }

  // One shift on one line: tick, role, time, spots, and Details if the role
  // has a description or something to bring.
  function shiftRow(s, left, past, selected) {
    var closed = left === 0 || past;
    var li = el("li", "shift-line" + (closed ? " is-full" : ""));
    var label = el("label", "shift-pick");
    var box = el("input");
    box.type = "checkbox";
    box.name = "shift";
    box.value = s.id;
    box.disabled = !canSignUp || closed;
    box.checked = !box.disabled && selected.indexOf(s.id) !== -1;
    var main = el("span", "shift-main");
    main.appendChild(el("strong", "shift-role", s.role.name || "Role"));
    main.appendChild(el("span", "shift-time", E.timeLabel(s.start) + "–" + E.timeLabel(s.end)));
    label.appendChild(box);
    label.appendChild(main);
    li.appendChild(label);
    li.appendChild(el("span", "shift-spots" + (closed ? " is-full" : ""), past ? "Ended" : left === 0 ? "Full" : left + " left"));
    if (s.role.description || s.role.bring) {
      var more = el("button", "shift-more", "Details");
      more.type = "button";
      var info = el("div", "shift-info");
      info.id = "info-" + s.id;
      info.hidden = true;
      if (s.role.description) info.appendChild(el("p", null, s.role.description));
      if (s.role.bring) info.appendChild(el("p", null, "Bring or know: " + s.role.bring));
      more.setAttribute("aria-expanded", "false");
      more.setAttribute("aria-controls", info.id);
      more.setAttribute("aria-label", "Details about " + (s.role.name || "this role"));
      more.addEventListener("click", function () {
        info.hidden = !info.hidden;
        more.setAttribute("aria-expanded", String(!info.hidden));
        more.textContent = info.hidden ? "Details" : "Hide";
      });
      li.appendChild(more);
      li.appendChild(info);
    }
    return li;
  }

  function renderShifts() {
    var counts = S.countsByShift(event.id);
    var today = todayString();
    var selected = selectedIds();
    var byDay = {};
    shifts.forEach(function (s) { (byDay[s.date] = byDay[s.date] || []).push(s); });
    var days = Object.keys(byDay).sort();
    var openOn = function (date) {
      return byDay[date].some(function (s) { return s.date >= today && (counts[s.id] || 0) < s.capacity; });
    };
    if (days.indexOf(currentDay) === -1) currentDay = days.filter(openOn)[0] || days[0] || "";

    // Several days: show one day at a time, with a day picker.
    var multi = days.length > 1;
    var picker = $("day-picker");
    picker.hidden = !multi;
    picker.innerHTML = "";
    days.forEach(function (date) {
      var chip = el("button", "day-chip");
      chip.type = "button";
      chip.dataset.date = date;
      chip.setAttribute("aria-pressed", String(date === currentDay));
      chip.appendChild(el("span", null, E.dayLabel(date)));
      chip.appendChild(el("span", "day-chip-count"));
      chip.addEventListener("click", function () {
        currentDay = date;
        showDay();
      });
      picker.appendChild(chip);
    });

    var groups = $("shift-groups");
    groups.innerHTML = "";
    days.forEach(function (date) {
      var group = el("div", "day-group");
      group.dataset.date = date;
      group.appendChild(el("h3", "day-title" + (multi ? " sr-only" : ""), E.dayLabel(date, { weekday: "long", year: "numeric" })));
      var open = el("ul", "shift-lines");
      var closed = [];
      byDay[date].forEach(function (s) {
        var left = Math.max(0, s.capacity - (counts[s.id] || 0));
        var past = s.date < today;
        if (left === 0 || past) closed.push(shiftRow(s, left, past, selected));
        else open.appendChild(shiftRow(s, left, past, selected));
      });
      if (open.children.length) group.appendChild(open);
      else group.appendChild(el("p", "empty", "No open shifts on this day."));
      // Full (or ended) shifts are tucked away.
      if (closed.length) {
        var more = el("details", "full-shifts");
        more.appendChild(el("summary", null, closed.length === 1 ? "1 full shift" : closed.length + " full shifts"));
        var ul = el("ul", "shift-lines");
        closed.forEach(function (li) { ul.appendChild(li); });
        more.appendChild(ul);
        group.appendChild(more);
      }
      groups.appendChild(group);
    });
    showDay();
    updateSelection();
  }

  function showDay() {
    var multi = !$("day-picker").hidden;
    document.querySelectorAll("#shift-groups .day-group").forEach(function (g) {
      g.hidden = multi && g.dataset.date !== currentDay;
    });
    document.querySelectorAll("#day-picker .day-chip").forEach(function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.date === currentDay));
    });
  }

  // Shifts on the same day whose times overlap.
  function overlaps(ids) {
    var chosen = shifts.filter(function (s) { return ids.indexOf(s.id) !== -1; });
    var pairs = [];
    for (var i = 0; i < chosen.length; i++) {
      for (var j = i + 1; j < chosen.length; j++) {
        var a = chosen[i], b = chosen[j];
        if (a.date === b.date && a.start < b.end && b.start < a.end) pairs.push([a, b]);
      }
    }
    return pairs;
  }

  function updateSelection() {
    var ids = selectedIds();
    var n = ids.length;
    $("pick-count").textContent = n ? (n === 1 ? "1 shift picked" : n + " shifts picked") : "No shifts picked yet";
    if (n) $("shifts-error").textContent = "";
    // How many are picked on each day.
    document.querySelectorAll("#day-picker .day-chip").forEach(function (chip) {
      var onDay = shifts.filter(function (s) { return s.date === chip.dataset.date && ids.indexOf(s.id) !== -1; }).length;
      chip.querySelector(".day-chip-count").textContent = onDay ? String(onDay) : "";
      chip.classList.toggle("has-picks", onDay > 0);
    });
    var clash = overlaps(ids);
    var warning = $("overlap-warning");
    warning.hidden = !clash.length;
    if (clash.length) {
      warning.textContent = "Heads up: " + clash.map(function (p) {
        return (p[0].role.name || "Role") + " and " + (p[1].role.name || "Role") + " on " + E.dayLabel(p[0].date) + " overlap in time";
      }).join("; ") + ". You can still sign up if that's what you meant.";
    }
  }

  // ---------- One event: step 2, confirm ----------

  function showStep(step) {
    $("step-pick").hidden = step !== "pick";
    $("step-confirm").hidden = step !== "confirm";
    window.scrollTo(0, 0);
    if (step === "confirm") {
      renderPicked();
      renderGate();
      $("confirm-step-title").focus();
    }
  }

  function renderPicked() {
    var ids = selectedIds();
    $("confirm-step-event").textContent = (event.title || "Event") + " · " + E.rangeLabel(event.startDate, event.endDate) + " · " + shortPlace(event);
    var list = $("picked-list");
    list.innerHTML = "";
    shifts.filter(function (s) { return ids.indexOf(s.id) !== -1; }).forEach(function (s) {
      var li = el("li");
      li.appendChild(el("strong", null, s.role.name || "Role"));
      li.appendChild(el("span", "event-meta", E.dayLabel(s.date) + " · " + E.timeLabel(s.start) + "–" + E.timeLabel(s.end)));
      list.appendChild(li);
    });
    $("submit").textContent = ids.length > 1 ? "Confirm " + ids.length + " shifts" : "Confirm sign-up";
    $("status").textContent = "";
  }

  // Signed in: just say who's signing up (with Change). Otherwise, the form.
  function setupWho() {
    var profile = F.session.signedIn() ? F.session.profile() : null;
    if (profile) {
      $("name").value = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
      $("email").value = profile.email;
      // With the server, a sign-up is always under the email you signed in with.
      $("email").readOnly = !!window.SevakServer;
      F.setPhone($("phone"), profile.phone);
      $("who-name").textContent = $("name").value || profile.email;
      $("who-email").textContent = $("name").value ? "(" + profile.email + ")" : "";
      $("who-summary").hidden = false;
      $("details-section").hidden = true;
      $("profile-note").textContent = "From your profile. Changes here are just for this sign-up.";
      return;
    }
    $("who-summary").hidden = true;
    $("details-section").hidden = false;
    var note = $("profile-note");
    note.innerHTML = "";
    note.appendChild(document.createTextNode("No account needed. "));
    var link = el("a", null, "Sign in");
    link.href = "signin.html";
    note.appendChild(link);
    note.appendChild(document.createTextNode(" to skip this next time."));
  }

  // ---------- Membership: only volunteers with the organization sign up ----------

  // "member" | "signed-out" | "requested" | "declined" | "none"
  function membership() {
    if (!F.session.signedIn()) return "signed-out";
    var st = M.myStatus(event.organizationId);
    return st === "team" || st === "active" ? "member" : st || "none";
  }

  function orgName() {
    var org = O.get(event.organizationId);
    return org ? org.name : "this organization";
  }

  function renderMemberHint() {
    var st = membership();
    var hint = $("member-hint");
    hint.hidden = st === "member" || !canSignUp;
    hint.textContent = st === "signed-out" ? "To sign up, join Sevak with " + orgName() + "."
      : st === "requested" ? "Your request to join " + orgName() + " is waiting for approval."
      : st === "declined" ? orgName() + " didn't approve your request to join."
      : "You're not a volunteer with " + orgName() + " yet. You can ask to join after picking shifts.";
  }

  var whoReady = false;

  function renderGate(message) {
    var st = membership();
    var gate = $("join-gate");
    var member = st === "member";
    gate.hidden = member;
    $("submit").hidden = !member;
    $("submit").parentNode.hidden = !member;
    renderMemberHint();
    if (member) {
      if (!whoReady) { setupWho(); whoReady = true; }
      $("status").textContent = message || "";
      return;
    }
    $("who-summary").hidden = true;
    $("details-section").hidden = true;
    gate.innerHTML = "";
    var name = orgName();
    var add = function (node) { gate.appendChild(node); return node; };
    if (st === "signed-out") {
      add(el("h2", "section-title", "Join Sevak to sign up"));
      add(el("p", null, "Sevak is for volunteers invited by an organization or approved by one. Join with an invitation from " + name + ", or ask them to have you."));
      var row = add(el("p", "fill-row"));
      var join = el("a", "btn btn-primary", "Join " + name);
      join.href = "join.html?org=" + encodeURIComponent(event.organizationId) + "&return=" + encodeURIComponent("signup.html?event=" + event.id);
      var signin = el("a", "btn btn-secondary", "Sign in");
      signin.href = "signin.html";
      row.appendChild(join);
      row.appendChild(signin);
    } else if (st === "requested") {
      add(el("h2", "section-title", "Waiting for approval"));
      add(el("p", null, message || "Your request to join " + name + " is waiting for approval. You can sign up for its shifts once they approve you; you'll see a note on Sevak when they do."));
      var more = el("a", null, "Browse other opportunities");
      more.href = "signup.html#all-orgs";
      add(el("p")).appendChild(more);
    } else {
      add(el("h2", "section-title", "Ask to join " + name));
      add(el("p", null, st === "declined"
        ? name + " didn't approve your earlier request. You can ask again."
        : "You're not a volunteer with " + name + " yet. Ask to join: once they approve you, you can sign up."));
      var f = add(el("div", "field"));
      var label = el("label", null, "A note for them");
      label.htmlFor = "join-note";
      label.appendChild(el("span", "optional", " (optional)"));
      var note = el("textarea");
      note.id = "join-note";
      note.maxLength = 300;
      note.rows = 2;
      f.appendChild(label);
      f.appendChild(note);
      var ask = el("button", "btn btn-primary", "Request to join " + name);
      ask.type = "button";
      ask.addEventListener("click", function () {
        var rec = M.request(event.organizationId, note.value);
        window.SevakNav.render();
        if (rec && rec.status === "active") {
          renderGate("You're in! You're now a volunteer with " + name + ". Confirm your shifts below.");
          $("submit").focus();
        } else {
          renderGate("Request sent to " + name + ". You can sign up for its shifts once they approve you.");
        }
      });
      add(el("p")).appendChild(ask);
    }
  }

  function showDetails() {
    $("who-summary").hidden = true;
    $("details-section").hidden = false;
  }

  function messageFor(input) {
    return F.basicMessage(input);
  }

  function goToConfirm(e) {
    e.preventDefault();
    if (!selectedIds().length) {
      $("shifts-error").textContent = "Pick at least one shift.";
      var first = document.querySelector('#shift-groups .day-group:not([hidden]) input[name="shift"]:not(:disabled)');
      (first || $("continue")).focus();
      return;
    }
    history.pushState({ step: "confirm" }, "", location.search + "#confirm");
    showStep("confirm");
  }

  function submit(e) {
    e.preventDefault();
    if (membership() !== "member") { renderGate(); return; }
    var ids = selectedIds();
    if (!ids.length) {
      showStep("pick");
      return;
    }
    var firstInvalid = F.validate([$("name"), $("email"), $("phone")], messageFor);
    if (firstInvalid) {
      showDetails();
      $("status").textContent = "";
      firstInvalid.focus();
      return;
    }

    // Check capacity again now, in case shifts filled while the form was open.
    var counts = S.countsByShift(event.id);
    var nowFull = shifts.filter(function (s) { return ids.indexOf(s.id) !== -1 && (counts[s.id] || 0) >= s.capacity; });
    if (nowFull.length) {
      history.replaceState(null, "", location.search);
      renderShifts();
      showStep("pick");
      $("shifts-error").textContent = "Sorry, " + nowFull.map(shiftLabel).join("; ") + " just filled up. Please choose again.";
      return;
    }

    var email = $("email").value.trim();
    var already = ids.filter(function (id) { return S.isSignedUp(email, id); });
    var fresh = ids.filter(function (id) { return already.indexOf(id) === -1; });
    if (!fresh.length) {
      $("status").textContent = "You're already signed up for " + (ids.length > 1 ? "these shifts" : "this shift") + " with " + email + ".";
      return;
    }

    var registrationId = E.newId("reg");
    var phone = F.phoneValue($("phone"));
    var now = new Date().toISOString();
    var ok = S.addMany(fresh.map(function (shiftId) {
      return {
        id: E.newId("signup"), registrationId: registrationId, eventId: event.id, shiftId: shiftId,
        name: $("name").value.trim(), email: email, phone: phone, status: "confirmed", createdAt: now
      };
    }));
    if (!ok) {
      $("status").textContent = window.SevakServer
        ? "That didn't go through. See the message at the bottom of the page."
        : "Couldn't save in this browser. Check that site storage is allowed.";
      if (window.SevakServer) { renderShifts(); }
      return;
    }
    // The confirmation email (prototype: to the outbox).
    M.email(email, "You're signed up: " + (event.title || "Volunteer shift"),
      "Thanks for signing up with " + orgName() + ". Your shifts: " + shifts.filter(function (s) { return fresh.indexOf(s.id) !== -1; }).map(shiftLabel).join("; ") + ".",
      "signup.html?registration=" + encodeURIComponent(registrationId), "Manage my sign-up");
    history.replaceState(null, "", "signup.html?registration=" + encodeURIComponent(registrationId));
    renderConfirmation(registrationId, true, already.length);
    window.SevakNav.render();
    window.scrollTo(0, 0);
  }

  function renderEvent(id) {
    event = E.get(id);
    // Inactive events are hidden from volunteers, as if removed.
    if (event && !E.isActive(event)) {
      var more = el("a", null, "See all volunteer opportunities");
      more.href = "signup.html";
      showNotice([el("p", null, "This event is no longer available. "), more]);
      return;
    }
    if (!event) {
      var back = el("a", null, "See all volunteer opportunities");
      back.href = "signup.html";
      showNotice([el("p", null, "We couldn't find that event. It may have been removed. "), back]);
      return;
    }
    showOnly("event-view");
    shifts = allShifts(event);
    var ended = (event.endDate || event.startDate || "") < todayString();
    var draft = event.status !== "published";
    canSignUp = !draft && !ended && shifts.length > 0;

    if (draft) {
      var edit = el("a", null, "Edit the event");
      edit.href = "event.html?id=" + encodeURIComponent(event.id);
      showNotice([el("strong", null, "Preview. "), document.createTextNode("This event is a draft, so volunteers can't see it or sign up yet. Publish it to open sign-ups. "), edit]);
    } else if (ended) {
      showNotice([el("strong", null, "This event has ended. "), document.createTextNode("Sign-ups are closed.")]);
    } else if (!shifts.length) {
      showNotice([document.createTextNode("This event doesn't have any shifts yet. Check back soon.")]);
    }

    renderEventHeader();
    renderShifts();
    $("pick-bar").hidden = !canSignUp;
    F.enhancePhone($("phone"));
    renderMemberHint();
    F.clearErrorsAsYouType($("signup-form"), messageFor);
    $("shift-groups").addEventListener("change", updateSelection);
    $("pick-form").addEventListener("submit", goToConfirm);
    $("signup-form").addEventListener("submit", submit);
    $("who-change").addEventListener("click", function () {
      showDetails();
      $("name").focus();
    });
    $("back-to-shifts").addEventListener("click", function () {
      if (history.state && history.state.step === "confirm") history.back();
      else showStep("pick");
    });
    // The browser's Back and Forward buttons move between the two steps.
    window.addEventListener("popstate", function () {
      // Back from the confirmation page: start this event afresh.
      if (!$("confirm-view").hidden || params.get("event") !== new URLSearchParams(location.search).get("event")) {
        location.reload();
        return;
      }
      showStep(location.hash === "#confirm" && selectedIds().length ? "confirm" : "pick");
    });
    if (location.hash === "#confirm") history.replaceState(null, "", location.search);
  }

  // ---------- Confirmation and "manage my sign-up" ----------

  function icsDate(date, time) {
    return date.replace(/-/g, "") + "T" + (time || "00:00").replace(":", "") + "00";
  }

  function icsEscape(text) {
    return String(text || "").replace(/[\\;,]/g, function (c) { return "\\" + c; }).replace(/\n/g, "\\n");
  }

  function downloadCalendar(ev, list) {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var tz = ev.timezone ? ";TZID=" + ev.timezone : "";
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The ANB Group//Sevak//EN", "CALSCALE:GREGORIAN"];
    list.forEach(function (item) {
      lines.push("BEGIN:VEVENT",
        "UID:" + item.signup.id + "@sevak",
        "DTSTAMP:" + stamp,
        "DTSTART" + tz + ":" + icsDate(item.shift.date, item.shift.start),
        "DTEND" + tz + ":" + icsDate(item.shift.date, item.shift.end),
        "SUMMARY:" + icsEscape((ev.title || "Volunteer shift") + " – " + (item.shift.role.name || "Shift")),
        "LOCATION:" + icsEscape(placeText(ev)),
        "DESCRIPTION:" + icsEscape("Volunteer shift with " + ((O.get(ev.organizationId) || {}).name || "the host organization") + "."),
        "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    var blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (ev.title || "volunteer-shifts").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function renderConfirmation(registrationId, justSignedUp, skipped) {
    var signups = S.forRegistration(registrationId);
    if (!signups.length) {
      var back = el("a", null, "See all volunteer opportunities");
      back.href = "signup.html";
      showNotice([el("p", null, "We couldn't find that sign-up. "), back]);
      return;
    }
    $("notice").hidden = true;
    var ev = E.get(signups[0].eventId);
    if (!ev) {
      showNotice([el("p", null, "The event for this sign-up has been removed by its host.")]);
      return;
    }
    showOnly("confirm-view");
    if (!E.isActive(ev)) {
      showNotice([el("strong", null, "This event is no longer active. "),
        document.createTextNode("The host has taken it off Sevak for now. Your sign-up is kept; contact the organizers if you have questions.")]);
    }
    var shiftById = {};
    allShifts(ev).forEach(function (s) { shiftById[s.id] = s; });
    var items = signups.map(function (s) { return { signup: s, shift: shiftById[s.shiftId] }; })
      .filter(function (i) { return i.shift; })
      .sort(function (a, b) { return (a.shift.date + a.shift.start).localeCompare(b.shift.date + b.shift.start); });
    var confirmed = items.filter(function (i) { return i.signup.status !== "cancelled"; });

    var org = O.get(ev.organizationId);
    $("confirm-title").textContent = justSignedUp ? "You're signed up!" : confirmed.length ? "Your sign-up" : "Sign-up cancelled";
    document.title = $("confirm-title").textContent + " · Sevak";
    var who = signups[0].name + " (" + signups[0].email + ")";
    $("confirm-intro").textContent = justSignedUp
      ? "Thanks, " + signups[0].name.split(" ")[0] + ". " + (org ? org.name : "The organizers") + " will see your name on their roster. In the live app, a confirmation email goes to " + signups[0].email + "." +
        (skipped ? " You were already signed up for " + (skipped === 1 ? "one of the shifts you picked" : skipped + " of the shifts you picked") + ", so we skipped " + (skipped > 1 ? "those" : "it") + "." : "")
      : "Signed up as " + who + ".";
    $("confirm-event").textContent = (ev.title || "Event") + " · " + E.rangeLabel(ev.startDate, ev.endDate) + (placeText(ev) ? " · " + placeText(ev) : "");

    var list = $("my-shifts");
    list.innerHTML = "";
    items.forEach(function (item) {
      var li = el("li", "my-shift" + (item.signup.status === "cancelled" ? " is-cancelled" : ""));
      var text = el("div");
      text.appendChild(el("strong", null, item.shift.role.name || "Shift"));
      text.appendChild(el("span", "event-meta", E.dayLabel(item.shift.date, { year: "numeric" }) + " · " + E.timeLabel(item.shift.start) + "–" + E.timeLabel(item.shift.end)));
      li.appendChild(text);
      if (item.signup.status === "cancelled") {
        li.appendChild(E.badge("Cancelled"));
      } else {
        var cancel = el("button", "btn btn-danger-link", "Cancel");
        cancel.type = "button";
        cancel.setAttribute("aria-label", "Cancel " + shiftLabel(item.shift));
        cancel.addEventListener("click", function () {
          if (!window.confirm("Cancel your " + shiftLabel(item.shift) + " shift?")) return;
          S.cancel(item.signup.id);
          renderConfirmation(registrationId, false);
          $("confirm-status").textContent = "Shift cancelled. The organizers will see the spot is open again.";
        });
        li.appendChild(cancel);
      }
      list.appendChild(li);
    });

    $("add-calendar").hidden = !confirmed.length;
    $("add-calendar").onclick = function () { downloadCalendar(ev, confirmed); };
    $("manage-link").href = "signup.html?registration=" + encodeURIComponent(registrationId);
    $("manage-link").hidden = !justSignedUp;
    $("manage-hint").hidden = !justSignedUp;
    $("more-shifts").href = "signup.html?event=" + encodeURIComponent(ev.id);
    $("all-signups").hidden = !F.session.signedIn();
  }

  // ---------- Start ----------

  // Old links to the "My sign-ups" tab.
  if (location.hash === "#mine") {
    history.replaceState(null, "", "signup.html?view=mine");
    params = new URLSearchParams(location.search);
    window.SevakNav.render();
  }
  if (params.get("registration")) {
    renderConfirmation(params.get("registration"), false);
  } else if (params.get("event")) {
    renderEvent(params.get("event"));
  } else if (params.get("view") === "mine") {
    renderMineView();
  } else {
    renderOpportunities();
  }
})();
