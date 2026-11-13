// The roster of one event (ATT-1, ATT-2, ATT-4): who's signed up for each
// shift, with their contact details, for the people who run the event (its
// organization's Admins, the Coordinator who is its event admin, and Sevak
// staff). On the day they check people in, add walk-ins, and check people
// out, which records their hours. The server decides who may see and change
// sign-ups (packages/core/src/signups.ts); this page only shows what it got.
(function () {
  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var E = window.SevakEvents;
  var S = window.SevakSignups;
  var $ = function (id) { return document.getElementById(id); };
  var lower = function (s) { return String(s || "").trim().toLowerCase(); };

  var eventId = new URLSearchParams(location.search).get("event") || "";
  var openForm = null; // the shift whose "Add someone" form is open

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function myEmail() { return lower((F.session.profile() || {}).email); }

  function placeText(event) {
    var loc = event.location || {};
    if (loc.type === "online") return "Online";
    if (loc.type === "later") return "Location shared with volunteers";
    return [loc.venue, loc.line1, loc.city].filter(Boolean).join(", ");
  }

  function signupLink(event) {
    return new URL("signup.html?event=" + encodeURIComponent(event.id), location.href).href;
  }

  // "HH:MM" of a moment in the event's time zone (stored hours use 24-hour
  // times, like the ones volunteers log themselves).
  function hm(iso, tz) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      var parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz || undefined }).formatToParts(d);
      var h = parts.find(function (p) { return p.type === "hour"; });
      var m = parts.find(function (p) { return p.type === "minute"; });
      return (h ? h.value : "00") + ":" + (m ? m.value : "00");
    } catch (e) {
      return d.toISOString().slice(11, 16);
    }
  }

  function duration(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return (h ? h + "h " : "") + (m || !h ? m + "m" : "").trim();
  }

  function phoneOf(s) {
    var n = s.phone && (s.phone.number || s.phone);
    return typeof n === "string" && /^\+?[0-9 ()-]{5,20}$/.test(n) ? n : "";
  }

  function shiftsByDay(event) {
    var rows = [];
    (event.roles || []).forEach(function (role) {
      (role.shifts || []).forEach(function (sh) { rows.push({ role: role, shift: sh }); });
    });
    rows.sort(function (a, b) {
      return ((a.shift.date || "") + (a.shift.start || "")).localeCompare((b.shift.date || "") + (b.shift.start || "")) ||
        String(a.role.name || "").localeCompare(String(b.role.name || ""));
    });
    var days = [];
    rows.forEach(function (r) {
      var last = days[days.length - 1];
      if (!last || last.date !== r.shift.date) days.push(last = { date: r.shift.date, rows: [] });
      last.rows.push(r);
    });
    return days;
  }

  function peopleOn(event, shiftId) {
    return S.all().filter(function (s) { return s.eventId === event.id && s.shiftId === shiftId && s.status !== "cancelled" && !s.anonymous; })
      .sort(function (a, b) { return String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")); });
  }

  // Saves a change to one sign-up; false (with the server's reason shown at
  // the bottom of the page) if it wasn't kept.
  function change(su, patch, done) {
    var ok = S.update(su.id, patch);
    $("roster-status").textContent = ok ? done : "That wasn't saved. See the message at the bottom of the page.";
    render();
    return ok;
  }

  function checkIn(event, su) {
    change(su, { checkInAt: new Date().toISOString(), checkOutAt: undefined }, (su.name || su.email) + " is checked in.");
  }

  function undoCheckIn(event, su) {
    change(su, { checkInAt: undefined, checkOutAt: undefined, hours: su.hours && su.hours.method === "check-in" ? undefined : su.hours },
      "Check-in undone for " + (su.name || su.email) + ".");
  }

  // Checking someone out records their hours from the check-in. The host
  // saw them there, so the hours are approved, except your own, which
  // another Admin approves (ATT-3).
  function checkOut(event, su) {
    var out = new Date();
    var minutes = Math.min(24 * 60, Math.max(1, Math.round((out - new Date(su.checkInAt)) / 60000)));
    var own = !!su.email && lower(su.email) === myEmail();
    var hours = { minutes: minutes, from: hm(su.checkInAt, event.timezone), to: hm(out.toISOString(), event.timezone), method: "check-in", loggedAt: out.toISOString(), status: "pending" };
    if (!own) {
      hours.status = "approved";
      hours.decidedAt = out.toISOString();
      hours.decidedBy = myEmail();
    }
    change(su, { checkOutAt: out.toISOString(), hours: hours },
      (su.name || su.email) + " is checked out: " + duration(minutes) + (own ? ", waiting for another Admin to approve." : ", approved."));
  }

  function removeFromShift(event, su, label) {
    if (!window.confirm("Take " + (su.name || su.email) + " off " + label + "?")) return;
    change(su, { status: "cancelled", cancelledAt: new Date().toISOString() }, (su.name || su.email) + " is off " + label + ". The spot is open again.");
  }

  function personRow(event, su, label) {
    var li = el("li", "roster-person");
    var who = el("div", "roster-who");
    who.appendChild(el("span", "roster-name", su.name || su.email || "Walk-in"));
    var contact = el("span", "roster-contact");
    var phone = phoneOf(su);
    if (phone) {
      var tel = el("a", null, phone);
      tel.href = "tel:" + phone.replace(/[^0-9+]/g, "");
      contact.appendChild(tel);
    }
    if (su.email) {
      var mail = el("a", null, su.email);
      mail.href = "mailto:" + encodeURIComponent(su.email).replace(/%40/g, "@");
      contact.appendChild(mail);
    }
    if (contact.childNodes.length) who.appendChild(contact);
    var state;
    if (su.checkOutAt && su.hours) {
      var h = su.hours;
      var credited = h.status === "approved" && h.approvedMinutes != null ? h.approvedMinutes : h.minutes;
      state = "Checked out · " + duration(credited) + (h.status === "approved" ? " approved" : h.status === "rejected" ? " not approved" : " waiting for approval");
    } else if (su.checkInAt) {
      state = "Checked in at " + E.timeLabel(hm(su.checkInAt, event.timezone));
    } else if (su.hours) {
      state = "Logged " + duration(su.hours.minutes) + (su.hours.status === "approved" ? " · approved" : su.hours.status === "rejected" ? " · not approved" : " · waiting for approval");
    } else {
      state = "Not checked in";
    }
    who.appendChild(el("span", "roster-state" + (su.checkInAt && !su.checkOutAt ? " is-in" : ""), state));
    li.appendChild(who);

    var actions = el("div", "roster-actions");
    var name = su.name || su.email || "this person";
    if (!su.checkInAt && !su.hours) {
      var inBtn = el("button", "btn btn-primary btn-small", "Check in");
      inBtn.type = "button";
      inBtn.setAttribute("aria-label", "Check in " + name);
      inBtn.addEventListener("click", function () { checkIn(event, su); });
      actions.appendChild(inBtn);
    } else if (su.checkInAt && !su.checkOutAt) {
      var outBtn = el("button", "btn btn-secondary btn-small", "Check out");
      outBtn.type = "button";
      outBtn.setAttribute("aria-label", "Check out " + name);
      outBtn.addEventListener("click", function () { checkOut(event, su); });
      actions.appendChild(outBtn);
      var undo = el("button", "btn btn-link", "Undo");
      undo.type = "button";
      undo.setAttribute("aria-label", "Undo check-in of " + name);
      undo.addEventListener("click", function () { undoCheckIn(event, su); });
      actions.appendChild(undo);
    }
    if (!su.checkInAt && !su.hours) {
      var remove = el("button", "btn btn-danger-link roster-remove", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", "Take " + name + " off " + label);
      remove.addEventListener("click", function () { removeFromShift(event, su, label); });
      actions.appendChild(remove);
    }
    if (actions.childNodes.length) li.appendChild(actions);
    return li;
  }

  // "Add someone": a walk-in on the day, or someone you're signing up. With
  // an email they get the confirmation and see it in My sign-ups.
  function addForm(event, role, sh, label) {
    var form = el("form", "roster-add");
    form.method = "dialog"; // personal details never go in a web address (NFR-7)
    form.noValidate = true;
    var key = sh.id;
    var fields = [
      { id: "add-name-" + key, label: "Name", type: "text", auto: "name", required: true },
      { id: "add-email-" + key, label: "Email (optional)", type: "email", auto: "email", hint: "They get the confirmation email and can see it in My sign-ups." },
      { id: "add-phone-" + key, label: "Phone (optional)", type: "tel", auto: "tel" }
    ];
    fields.forEach(function (f) {
      var wrap = el("div", "field");
      var lab = el("label", null, f.label);
      lab.htmlFor = f.id;
      var input = el("input");
      input.id = f.id;
      input.type = f.type;
      input.autocomplete = "off";
      input.maxLength = f.type === "email" ? 254 : 100;
      if (f.required) input.required = true;
      wrap.appendChild(lab);
      wrap.appendChild(input);
      if (f.hint) wrap.appendChild(el("p", "hint", f.hint));
      form.appendChild(wrap);
    });
    var err = el("p", "error");
    err.id = "add-error-" + key;
    err.setAttribute("role", "alert");
    form.appendChild(err);
    var row = el("div", "fill-row");
    var save = el("button", "btn btn-primary btn-small", "Add to this shift");
    save.type = "submit";
    var cancel = el("button", "btn btn-link", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { openForm = null; render(); });
    row.appendChild(save);
    row.appendChild(cancel);
    form.appendChild(row);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("add-name-" + key).value.trim();
      var email = lower($("add-email-" + key).value);
      var phone = $("add-phone-" + key).value.trim();
      err.textContent = "";
      if (!name) { err.textContent = "Enter their name."; $("add-name-" + key).focus(); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "That email doesn't look right."; $("add-email-" + key).focus(); return; }
      if (phone && !/^\+?[0-9 ()-]{5,20}$/.test(phone)) { err.textContent = "Use only digits, spaces, + ( ) and - in the phone number."; $("add-phone-" + key).focus(); return; }
      if (email && peopleOn(event, sh.id).some(function (s) { return lower(s.email) === email; })) {
        err.textContent = "They're already on this shift.";
        return;
      }
      var now = new Date().toISOString();
      var su = { id: E.newId("signup"), registrationId: E.newId("reg"), eventId: event.id, shiftId: sh.id, name: name, status: "confirmed", createdAt: now, addedBy: myEmail() };
      if (email) su.email = email;
      if (phone) su.phone = phone;
      if (!S.addMany([su])) {
        err.textContent = "Not added. See the message at the bottom of the page.";
        return;
      }
      openForm = null;
      $("roster-status").textContent = "Added " + name + " to " + label + "." + (email ? " A confirmation email is on its way to " + email + "." : "");
      render();
    });
    return form;
  }

  function render() {
    var event = E.get(eventId);
    var org = event && O.get(event.organizationId);
    var none = $("roster-none");
    var box = $("roster");
    box.innerHTML = "";
    if (!event || !org || !E.runsEvent(event)) {
      none.hidden = false;
      none.textContent = !event
        ? "We couldn't find that event, or you don't run it."
        : "Only the organization's Admins and this event's event admin can see its roster.";
      $("roster-summary").hidden = true;
      return;
    }
    none.hidden = true;
    document.title = "Roster: " + (event.title || "Event") + " · Sevak";
    $("roster-title").textContent = "Roster: " + (event.title || "Event");
    $("back-link").href = "events.html";
    $("edit-event").href = "event.html?id=" + encodeURIComponent(event.id);
    $("roster-summary").hidden = false;

    var totals = E.totals(event);
    var everyone = S.all().filter(function (s) { return s.eventId === event.id && s.status !== "cancelled" && !s.anonymous; });
    var here = everyone.filter(function (s) { return s.checkInAt && !s.checkOutAt; }).length;
    $("roster-totals").textContent = [E.rangeLabel(event.startDate, event.endDate), placeText(event)].filter(Boolean).join(" · ") + ". " +
      everyone.length + " of " + (totals.volunteers || 0) + " spots filled" + (here ? ", " + here + " here now" : "") + ".";

    var days = shiftsByDay(event);
    if (!days.length) {
      box.appendChild(el("p", "section hint", "This event has no shifts yet. Add tasks and shifts in the event editor."));
      return;
    }
    var today = new Date().toISOString().slice(0, 10);
    days.forEach(function (day) {
      var section = el("section", "section roster-day");
      var h = el("h2", "section-title", E.dayLabel(day.date, { year: "numeric" }) + (day.date === today ? " · Today" : ""));
      section.appendChild(h);
      day.rows.forEach(function (r) {
        var sh = r.shift;
        var people = peopleOn(event, sh.id);
        var cap = Number(sh.capacity) || 0;
        var label = (r.role.name || "Task") + ", " + E.timeLabel(sh.start) + "–" + E.timeLabel(sh.end);
        var card = el("div", "roster-shift");
        var head = el("div", "roster-shift-head");
        var title = el("h3", null, label);
        head.appendChild(title);
        head.appendChild(el("span", "roster-count", people.length + " of " + cap));
        card.appendChild(head);
        if (people.length) {
          var ul = el("ul", "roster-list");
          people.forEach(function (su) { ul.appendChild(personRow(event, su, label)); });
          card.appendChild(ul);
        } else {
          card.appendChild(el("p", "hint", "No one yet."));
        }
        if (openForm === sh.id) {
          card.appendChild(addForm(event, r.role, sh, label));
        } else if (people.length < cap) {
          var add = el("button", "btn btn-secondary btn-small roster-add-btn", "+ Add someone");
          add.type = "button";
          add.setAttribute("aria-label", "Add someone to " + label);
          add.addEventListener("click", function () {
            openForm = sh.id;
            render();
            var first = $("add-name-" + sh.id);
            if (first) first.focus();
          });
          card.appendChild(add);
        } else {
          card.appendChild(el("p", "hint", "Full."));
        }
        section.appendChild(card);
      });
      box.appendChild(section);
    });
  }

  function init() {
    $("copy-link").addEventListener("click", function () {
      var event = E.get(eventId);
      if (!event) return;
      var link = signupLink(event);
      var done = function () { $("copy-status").textContent = "Copied the sign-up link."; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, function () { $("copy-status").textContent = link; });
      } else {
        $("copy-status").textContent = link;
      }
    });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
