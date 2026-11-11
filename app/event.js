// Event editor (prototype). An event belongs to the organization saved on
// the organization page. It has roles, and each role has shifts: a day, a
// start and end time, and how many volunteers are needed.
(function () {
  "use strict";

  var MAX_DAYS = 31;
  var MAX_ROLES = 20;
  var MAX_SHIFTS_PER_ROLE = 100;

  var F = window.SevakForms;
  var E = window.SevakEvents;
  var form = document.getElementById("event-form");
  var $ = function (id) { return document.getElementById(id); };

  var params = new URLSearchParams(location.search);
  var eventId = params.get("id");
  var existing = eventId ? E.get(eventId) : null;
  var org = existing && existing.organizationId ? window.SevakOrgs.get(existing.organizationId) : window.SevakOrgs.current();
  // Only the organization's team can manage its events.
  if (!window.SevakNav.guard({ org: existing ? org : null })) return;
  if (org && existing) window.SevakOrgs.setCurrent(org.id);
  var status = existing ? existing.status : "draft";
  var active = window.SevakEvents.isActive(existing) || !existing;
  var isAdmin = window.SevakOrgs.isAdmin(org);
  var createdAt = existing ? existing.createdAt : null;
  var counter = 0;

  // ---------- Small helpers ----------

  function eventDays() {
    return E.days($("startDate").value, $("endDate").value).slice(0, MAX_DAYS);
  }

  function locationType() {
    return form.querySelector('input[name="locationType"]:checked').value;
  }

  function visibility() {
    return form.querySelector('input[name="visibility"]:checked').value;
  }

  function isValidUrl(value) {
    try {
      var u = new URL(value);
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.indexOf(".") > 0;
    } catch (e) {
      return false;
    }
  }

  // Gives each control in a cloned template a unique id wired to its label
  // and error message.
  function wireIds(root, prefix) {
    counter += 1;
    root.querySelectorAll(".field").forEach(function (field) {
      var control = field.querySelector("[data-key]");
      if (!control) return;
      control.id = prefix + "-" + counter + "-" + control.dataset.key;
      var label = field.querySelector("label");
      if (label) label.htmlFor = control.id;
      var error = field.querySelector(".error");
      if (error) error.id = control.id + "-error";
    });
    return counter;
  }

  // ---------- Time zones ----------

  function fillTimezones(selected) {
    var zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { /* older browsers */ }
    var local = "UTC";
    try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { /* keep UTC */ }
    [local, "UTC", selected].forEach(function (z) { if (z && zones.indexOf(z) === -1) zones.push(z); });
    zones.sort();
    var select = $("timezone");
    select.innerHTML = "";
    zones.forEach(function (z) {
      var option = document.createElement("option");
      option.value = z;
      option.textContent = z.replace(/_/g, " ");
      select.appendChild(option);
    });
    select.value = selected || local;
    applyTimezone();
  }

  function applyTimezone() {
    $("tz-name").textContent = ($("timezone").value || "UTC").replace(/_/g, " ");
  }
  $("tz-change").addEventListener("click", function () {
    $("tz-line").hidden = true;
    $("tz-picker").hidden = false;
    $("timezone").focus();
  });
  $("timezone").addEventListener("change", applyTimezone);

  // ---------- Day choices ----------

  function fillDaySelect(select, current) {
    var days = eventDays();
    select.innerHTML = "";
    if (!days.length) {
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "Set the event dates first";
      select.appendChild(none);
    }
    days.forEach(function (d) {
      var option = document.createElement("option");
      option.value = d;
      option.textContent = E.dayLabel(d);
      select.appendChild(option);
    });
    if (current && days.indexOf(current) === -1) {
      var stray = document.createElement("option");
      stray.value = current;
      stray.textContent = E.dayLabel(current) + " (outside event dates)";
      select.appendChild(stray);
    }
    select.value = current || days[0] || "";
  }

  function refreshDays() {
    form.querySelectorAll('.shift-row [data-key="date"]').forEach(function (select) {
      fillDaySelect(select, select.value);
    });
    var multiDay = eventDays().length > 1;
    form.querySelectorAll(".copy-shifts").forEach(function (b) { b.hidden = !multiDay; });
    updateSummary();
  }

  // ---------- Roles and shifts ----------

  var roleList = $("role-list");

  function addRole(value) {
    if (roleList.children.length >= MAX_ROLES) return null;
    var card = $("role-template").content.firstElementChild.cloneNode(true);
    card.dataset.id = (value && value.id) || E.newId("role");
    wireIds(card, "role");
    var shiftsError = card.querySelector(".shifts-error");
    shiftsError.id = "role-" + counter + "-shifts-error";
    if (value) {
      ["name", "description", "bring"].forEach(function (k) {
        if (value[k] != null) card.querySelector('[data-key="' + k + '"]').value = value[k];
      });
    }
    fillLead(card, value && value.lead);
    card.querySelector(".remove-role").addEventListener("click", function () {
      card.remove();
      renumberRoles();
      $("add-role").focus();
    });
    card.querySelector(".add-shift").addEventListener("click", function () {
      var row = addShift(card);
      if (row) row.querySelector("select").focus();
    });
    card.querySelector(".copy-shifts").addEventListener("click", function () { copyShiftsToEveryDay(card); });
    roleList.appendChild(card);
    $("roles-error").textContent = "";

    var shifts = value && value.shifts;
    if (shifts && shifts.length) shifts.forEach(function (s) { addShift(card, s); });
    else if (!value) addShift(card);
    renumberRoles();
    refreshDays();
    return card;
  }

  function addShift(card, value) {
    var list = card.querySelector(".shift-list");
    if (list.children.length >= MAX_SHIFTS_PER_ROLE) return null;
    var row = $("shift-template").content.firstElementChild.cloneNode(true);
    row.dataset.id = (value && value.id) || E.newId("shift");
    wireIds(row, "shift");

    // A new shift starts as a copy of the role's last shift, to save typing.
    var last = list.lastElementChild;
    var base = value || (last ? readShift(last) : { date: eventDays()[0] || "", start: "09:00", end: "12:00", capacity: 5 });
    fillDaySelect(row.querySelector('[data-key="date"]'), base.date);
    row.querySelector('[data-key="start"]').value = base.start || "";
    row.querySelector('[data-key="end"]').value = base.end || "";
    row.querySelector('[data-key="capacity"]').value = base.capacity != null ? base.capacity : "";

    row.querySelector(".remove-shift").addEventListener("click", function () {
      row.remove();
      updateSummary();
      card.querySelector(".add-shift").focus();
    });
    list.appendChild(row);
    card.querySelector(".add-shift").hidden = list.children.length >= MAX_SHIFTS_PER_ROLE;
    card.querySelector(".shifts-error").textContent = "";
    updateSummary();
    return row;
  }

  function readShift(row) {
    var get = function (k) { return row.querySelector('[data-key="' + k + '"]').value.trim(); };
    return { id: row.dataset.id, date: get("date"), start: get("start"), end: get("end"), capacity: get("capacity") === "" ? "" : Number(get("capacity")) };
  }

  function readRole(card) {
    var get = function (k) { return card.querySelector('.grid [data-key="' + k + '"]').value.trim(); };
    var role = {
      id: card.dataset.id,
      name: get("name"),
      description: get("description"),
      bring: get("bring"),
      shifts: Array.prototype.map.call(card.querySelectorAll(".shift-row"), readShift)
    };
    // Only Admins choose; for anyone else the lead stays as it was (and the
    // server keeps it as it was whatever the page sends).
    var lead = canChooseLeads ? get("lead") : card.dataset.lead;
    if (lead) role.lead = lead;
    return role;
  }

  // Copies the shifts on the event's first day to every other day,
  // skipping any day that already has a shift at the same times.
  function copyShiftsToEveryDay(card) {
    var days = eventDays();
    var shifts = readRole(card).shifts;
    var first = shifts.filter(function (s) { return s.date === days[0]; });
    if (!first.length) {
      $("status").textContent = "Add a shift on " + E.dayLabel(days[0]) + " first, then copy it.";
      return;
    }
    var added = 0;
    days.slice(1).forEach(function (day) {
      first.forEach(function (s) {
        var exists = shifts.some(function (x) { return x.date === day && x.start === s.start && x.end === s.end; });
        if (!exists && addShift(card, { date: day, start: s.start, end: s.end, capacity: s.capacity })) added += 1;
      });
    });
    $("status").textContent = added
      ? "Added " + E.plural(added, "shift") + " to the other days."
      : "Every day already has these shifts.";
  }

  function renumberRoles() {
    Array.prototype.forEach.call(roleList.children, function (card, i) {
      var title = "Task " + (i + 1);
      card.querySelector("h3").textContent = title;
      card.querySelector(".remove-role").setAttribute("aria-label", "Remove " + title.toLowerCase());
    });
    $("add-role").hidden = roleList.children.length >= MAX_ROLES;
    updateSummary();
  }

  function updateSummary() {
    var t = E.totals({ roles: Array.prototype.map.call(roleList.children, readRole) });
    $("roles-summary").textContent = t.roles
      ? E.plural(t.roles, "task") + " · " + E.plural(t.shifts, "shift") + " · " + E.plural(t.volunteers, "volunteer spot")
      : "No tasks yet.";
  }

  roleList.addEventListener("input", updateSummary);

  // Common roles, to add in one tap and then adjust.
  var PRESETS = [
    { name: "Setup crew", description: "Set up tables, chairs, signs and decorations before the event.", bring: "Closed-toe shoes" },
    { name: "Greeters", description: "Welcome guests at the entrance and point them the right way." },
    { name: "Registration and check-in", description: "Check guests in, hand out passes and answer questions." },
    { name: "Ushers", description: "Help guests find their seats and keep the aisles clear." },
    { name: "Food service", description: "Serve food and drinks, and keep the serving area clean.", bring: "Closed-toe shoes; hair tied back" },
    { name: "Parking", description: "Guide cars into the parking area and keep traffic moving.", bring: "Comfortable shoes and water" },
    { name: "Cleanup crew", description: "Clear up, take out the trash and put everything away afterwards." },
    { name: "Photography", description: "Take photos and short videos of the event to share afterwards.", bring: "A camera or phone, charged" },
    { name: "Sound and tech", description: "Help with microphones, lights, the sound system and slides." },
    { name: "Kids' activities", description: "Run crafts and games for children." }
  ];

  function hasRole(name) {
    return Array.prototype.some.call(roleList.children, function (card) {
      return card.querySelector('[data-key="name"]').value.trim().toLowerCase() === name.toLowerCase();
    });
  }

  function renderPresets() {
    var box = $("role-preset-buttons");
    box.innerHTML = "";
    var full = roleList.children.length >= MAX_ROLES;
    PRESETS.forEach(function (p) {
      if (hasRole(p.name)) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-secondary btn-small";
      b.textContent = "+ " + p.name;
      b.setAttribute("aria-label", "Add the task " + p.name);
      b.disabled = full;
      b.addEventListener("click", function () {
        // Fill an empty role (a new event starts with one), or add a role.
        var card = Array.prototype.filter.call(roleList.children, function (c) {
          return ["name", "description", "bring"].every(function (k) { return !c.querySelector('[data-key="' + k + '"]').value.trim(); });
        })[0];
        if (card) {
          card.querySelector('[data-key="name"]').value = p.name;
          card.querySelector('[data-key="description"]').value = p.description;
          card.querySelector('[data-key="bring"]').value = p.bring || "";
          F.setError(card.querySelector('[data-key="name"]'), "");
          updateSummary();
        } else {
          card = addRole({ name: p.name, description: p.description, bring: p.bring || "" });
          if (!card) return;
        }
        if (!card.querySelector(".shift-row")) addShift(card);
        refreshDays();
        renderPresets();
        var first = card.querySelector('.shift-row select');
        (first || card.querySelector('[data-key="name"]')).focus();
        $("status").textContent = "Added " + p.name + ". Set its shift times and how many people you need.";
      });
      box.appendChild(b);
    });
    $("role-presets").hidden = !box.children.length;
  }
  roleList.addEventListener("input", renderPresets);
  roleList.addEventListener("click", function (e) { if (e.target.closest(".remove-role")) setTimeout(renderPresets, 0); });
  $("add-role").addEventListener("click", function () {
    var card = addRole();
    if (card) card.querySelector('[data-key="name"]').focus();
  });

  // ---------- Main event ----------

  function fillMainEvents(selected) {
    var select = $("mainEventId");
    select.innerHTML = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "No, this is a standalone event";
    select.appendChild(none);
    E.mainForOrg(org.id).sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); }).forEach(function (m) {
      var option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.title || "Untitled main event";
      select.appendChild(option);
    });
    select.value = selected && E.getMain(selected) ? selected : "";
    applyMainField();
  }

  function mainEvent() { return E.getMain($("mainEventId").value); }

  // "Sub-event" when it's part of a main event, "event" otherwise, in every
  // title and label that names it.
  function noun() { return mainEvent() ? "sub-event" : "event"; }
  function applyWording() {
    var n = noun();
    document.querySelectorAll("[data-noun]").forEach(function (el) {
      el.textContent = el.dataset.noun === "cap" ? n.charAt(0).toUpperCase() + n.slice(1) : n;
    });
    $("title").placeholder = mainEvent() ? "e.g. Rehearsal 1" : "e.g. Community Food Drive";
  }

  var mainPickerOpen = false;
  function applyMainField() {
    var main = mainEvent();
    $("main-field").hidden = !main && !E.mainForOrg(org.id).length;
    var open = !main || mainPickerOpen;
    $("main-line").hidden = open;
    $("main-picker").hidden = !open;
    if (main) $("main-line-name").textContent = main.title || "Untitled main event";
  }
  $("main-change").addEventListener("click", function () {
    mainPickerOpen = true;
    applyMainField();
    $("mainEventId").focus();
  });

  // The back link goes to the main event when there is one.
  function applyBreadcrumb() {
    var main = mainEvent();
    $("back-link").href = main ? "main-event.html?id=" + encodeURIComponent(main.id) : "events.html";
    $("org-name-crumb").textContent = main ? main.title || "Main event" : "Events";
  }
  $("mainEventId").addEventListener("change", function () {
    applyBreadcrumb();
    applyWording();
    applyStatus();
  });

  // ---------- Location and visibility ----------

  function applyLocationType() {
    var type = locationType();
    $("in-person-fields").hidden = type !== "in-person";
    $("online-fields").hidden = type !== "online";
    $("later-fields").hidden = type !== "later";
    applyAddressView();
  }

  // A filled-in address shows as one line ("Change the address" opens the
  // fields); an empty one shows its fields.
  var addressOpen = false;
  function orgAddress() { return (org && org.address) || {}; }
  function sameAsOrg() {
    var a = orgAddress();
    var same = function (x, id) { return String(x || "").trim().toLowerCase() === $(id).value.trim().toLowerCase(); };
    return !!a.line1 && same(a.line1, "addressLine1") && same(a.city, "city") && (!a.country || a.country === $("country").value);
  }
  function applyAddressView() {
    var filled = $("country").value && $("addressLine1").value.trim() && $("city").value.trim();
    var open = addressOpen || !filled;
    $("address-fields").hidden = !open;
    $("address-summary").hidden = open;
    $("use-org-address").hidden = !orgAddress().line1 || sameAsOrg();
    if (open) return;
    var country = $("country").options[$("country").selectedIndex];
    $("address-text").textContent = [$("addressLine1").value.trim(), $("city").value.trim(),
      [$("state").value.trim(), $("postalCode").value.trim()].filter(Boolean).join(" "), country ? country.textContent : ""].filter(Boolean).join(", ");
    $("address-source").hidden = !sameAsOrg();
  }
  // Before checking the step: open the fields if the address needs fixing.
  function openAddressIfInvalid() {
    if (locationType() !== "in-person" || !$("address-fields").hidden) return;
    if (["country", "addressLine1", "city", "postalCode"].some(function (id) { return messageFor($(id)); })) {
      addressOpen = true;
      applyAddressView();
    }
  }
  $("address-change").addEventListener("click", function () {
    addressOpen = true;
    applyAddressView();
    $("addressLine1").focus();
  });
  function copyOrgAddress() {
    var a = orgAddress();
    if (a.country) $("country").value = a.country;
    $("addressLine1").value = a.line1 || "";
    $("city").value = a.city || "";
    $("state").value = a.state || "";
    $("postalCode").value = a.postalCode || a.zip || "";
    ["addressLine1", "city", "postalCode"].forEach(function (id) { F.setError($(id), ""); });
  }
  form.querySelectorAll('input[name="locationType"]').forEach(function (r) { r.addEventListener("change", applyLocationType); });

  function applyVisibility() {
    var verified = org && org.verificationStatus === "verified";
    var pending = org && org.verificationStatus === "pending";
    $("unverified-note").hidden = visibility() !== "public" || verified;
    $("unverified-text").textContent = pending
      ? "Your organization's verification is waiting for Sevak's review, so this event stays private until then. You can still share its link."
      : "Your organization isn't verified yet, so this event will stay private until it is. You can still share its link.";
    $("unverified-link").textContent = pending ? "See the request" : "Get verified";
  }
  form.querySelectorAll('input[name="visibility"]').forEach(function (r) { r.addEventListener("change", applyVisibility); });

  $("use-org-address").addEventListener("click", function () {
    copyOrgAddress();
    addressOpen = false;
    applyAddressView();
    $("address-change").focus();
    $("status").textContent = "Using your organization's address.";
  });

  // ---------- Validation ----------

  function messageFor(input) {
    var v = input.value.trim();
    var basic = F.basicMessage(input);
    if (basic) return basic;

    if (input.id === "endDate" && v && $("startDate").value) {
      if (v < $("startDate").value) return "The end date can't be before the start date.";
      if (E.days($("startDate").value, v).length > MAX_DAYS) return "Events can be up to " + MAX_DAYS + " days long.";
    }
    if (input.id === "onlineUrl" && v && !isValidUrl(v)) return "Enter a full link, starting with https://.";

    var key = input.dataset.key;
    var row = input.closest(".shift-row");
    if (row && key === "date" && v && eventDays().indexOf(v) === -1) return "This day isn't within the event dates.";
    if (row && key === "end" && v) {
      var start = row.querySelector('[data-key="start"]').value;
      if (start && v <= start) return "Must be after the start time.";
    }
    if (row && key === "capacity" && v) {
      var n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 999) return "Enter a whole number from 1 to 999.";
    }
    return "";
  }

  // Roles must exist, and each needs at least one shift, before publishing.
  function structureErrors() {
    var first = null;
    var cards = roleList.children;
    $("roles-error").textContent = cards.length ? "" : "Add at least one task before publishing.";
    if (!cards.length) first = $("add-role");
    Array.prototype.forEach.call(cards, function (card) {
      var error = card.querySelector(".shifts-error");
      var empty = !card.querySelector(".shift-row");
      error.textContent = empty ? "Add at least one shift for this task." : "";
      if (empty && !first) first = card.querySelector(".add-shift");
    });
    return first;
  }

  function clearStructureErrors() {
    $("roles-error").textContent = "";
    form.querySelectorAll(".shifts-error").forEach(function (e) { e.textContent = ""; });
  }

  function stepFields(i) {
    return $("step-" + STEPS[i]).querySelectorAll("input:not([type=radio]), select:not(#timezone), textarea");
  }

  // The step on screen: its fields, and when publishing, that every role has
  // a shift.
  function checkStep(i, publishing) {
    if (STEPS[i] === "when") openAddressIfInvalid();
    var first = F.validate(stepFields(i), messageFor);
    if (STEPS[i] === "roles") {
      if (publishing) first = first || structureErrors();
      else clearStructureErrors();
    }
    return first;
  }

  // Publishing checks every step; a draft needs a name and dates. Stays on
  // the first step with something to fix.
  function validateFor(publishing) {
    var was = step;
    var steps = publishing ? [0, 1, 2, 3] : [0, 1];
    for (var k = 0; k < steps.length; k++) {
      var i = steps[k];
      showStepOnly(i);
      var first = publishing ? checkStep(i, true) : F.validate(i === 0 ? [$("title")] : [$("startDate"), $("endDate")], messageFor);
      if (first) {
        showStep(i, false);
        return first;
      }
    }
    if (!publishing) clearStructureErrors();
    showStepOnly(was);
    return null;
  }

  F.clearErrorsAsYouType(form, messageFor);
  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.getAttribute("aria-invalid") === "true" && !messageFor(t)) F.setError(t, "");
  });

  // ---------- Read / fill ----------

  function readForm() {
    var v = function (id) { return $(id).value.trim(); };
    var type = locationType();
    return {
      id: eventId || E.newId("event"),
      organizationId: org.id,
      organizationName: org.name || "",
      mainEventId: $("mainEventId").value || undefined,
      title: v("title"),
      description: v("description"),
      startDate: v("startDate"),
      endDate: v("endDate") || v("startDate"),
      timezone: $("timezone").value,
      location: type === "online"
        ? { type: "online", url: v("onlineUrl") }
        : type === "later"
        ? { type: "later", note: v("locationNote") }
        : {
            type: "in-person",
            venue: v("venue"),
            country: $("country").value,
            line1: v("addressLine1"),
            city: v("city"),
            state: v("state"),
            postalCode: v("postalCode")
          },
      roles: Array.prototype.map.call(roleList.children, readRole),
      visibility: visibility(),
      eventAdmin: $("eventAdmin").value,
      status: status,
      active: active,
      inactiveAt: active ? undefined : (existing && existing.inactiveAt) || new Date().toISOString(),
      // Where it was imported from (Zeffy), kept for Refresh.
      source: (existing && existing.source) || undefined,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  // Who approves volunteers' hours: someone on the organization's team, or
  // (by default) any of its Admins.
  // Everyone who can run the organization's events: the Team tab, its
  // primary contact and whoever set it up (both Admins), once each.
  function teamPeople() {
    var people = ((org && org.team) || []).map(function (m) { return { email: m.email, name: m.name, admin: m.role === "admin" }; });
    if (org && org.primaryContact && org.primaryContact.email) people.push({ email: org.primaryContact.email, name: org.primaryContact.name, admin: true });
    if (org && org.createdBy) people.push({ email: org.createdBy, admin: true });
    var byEmail = {};
    var order = [];
    people.forEach(function (p) {
      var key = String(p.email || "").trim().toLowerCase();
      if (!key) return;
      var known = byEmail[key];
      if (known) { known.admin = known.admin || p.admin; known.name = known.name || p.name; return; }
      byEmail[key] = { email: key, name: p.name, admin: p.admin };
      order.push(key);
    });
    return order.map(function (key) { return byEmail[key]; });
  }

  function addOption(sel, value, text) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }

  function fillEventAdmin(selected) {
    var sel = $("eventAdmin");
    sel.innerHTML = "";
    addOption(sel, "", "Any Admin of " + ((org && org.name) || "the organization"));
    var seen = {};
    teamPeople().forEach(function (p) {
      seen[p.email] = true;
      addOption(sel, p.email, (p.name || p.email) + " (" + (p.admin ? "Admin" : "Coordinator") + ")");
    });
    if (selected && !seen[String(selected).toLowerCase()]) addOption(sel, selected, selected + " (no longer on the team)");
    sel.value = selected || "";
  }

  // ---------- Task leads (EVT-21) ----------
  // An Admin chooses each task's lead from the organization's team and its
  // members. Anyone else sees the lead if they run the event, but can't
  // change it. (Signed out, previewing the plain prototype, anyone can.)
  var canChooseLeads = isAdmin || (!F.session.signedIn() && !window.SevakServer);

  function leadCandidates() {
    var list = teamPeople().map(function (p) { return { email: p.email, name: p.name, kind: p.admin ? "Admin" : "Coordinator" }; });
    var seen = {};
    list.forEach(function (p) { seen[p.email] = true; });
    var M = window.SevakMembers;
    var members = M && org ? M.forOrg(org.id).filter(function (m) { return m.status === "active"; }) : [];
    members.map(function (m) { return { email: String(m.email || "").trim().toLowerCase(), name: m.name || "", kind: "member" }; })
      .filter(function (m) { var fresh = m.email && !seen[m.email]; seen[m.email] = true; return fresh; })
      .sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); })
      .forEach(function (m) { list.push(m); });
    return list;
  }

  function fillLead(card, selected) {
    var sel = card.querySelector('.grid [data-key="lead"]');
    var hint = card.querySelector(".lead-hint");
    hint.id = sel.id + "-hint";
    sel.setAttribute("aria-describedby", hint.id);
    selected = String(selected || "").trim().toLowerCase();
    card.dataset.lead = selected;
    sel.innerHTML = "";
    var people = leadCandidates();
    var label = function (p) { return (p.name || p.email) + " (" + (p.kind === "member" ? p.email : p.kind) + ")"; };
    var known = people.filter(function (p) { return p.email === selected; })[0];
    if (!canChooseLeads) {
      sel.disabled = true;
      addOption(sel, selected, selected ? (known ? label(known) : selected) : "Chosen by an Admin");
      hint.textContent = "Only the organization's Admins choose task leads.";
      return;
    }
    addOption(sel, "", "No task lead yet");
    people.forEach(function (p) { addOption(sel, p.email, label(p)); });
    if (selected && !known) addOption(sel, selected, selected + " (no longer a member)");
    sel.value = selected;
  }

  function fill(event) {
    var set = function (id, value) { if (value != null) $(id).value = value; };
    fillEventAdmin(event.eventAdmin);
    fillMainEvents(event.mainEventId);
    set("title", event.title);
    set("description", event.description);
    set("startDate", event.startDate);
    set("endDate", event.endDate);
    fillTimezones(event.timezone);
    var loc = event.location || {};
    form.querySelector('input[name="locationType"][value="' + (loc.type === "online" || loc.type === "later" ? loc.type : "in-person") + '"]').checked = true;
    if (loc.type === "online") {
      set("onlineUrl", loc.url);
    } else if (loc.type === "later") {
      set("locationNote", loc.note);
    } else {
      set("venue", loc.venue);
      if (loc.country) $("country").value = loc.country;
      set("addressLine1", loc.line1);
      set("city", loc.city);
      set("state", loc.state);
      set("postalCode", loc.postalCode);
    }
    var vis = form.querySelector('input[name="visibility"][value="' + event.visibility + '"]');
    if (vis) vis.checked = true;
    (event.roles || []).forEach(addRole);
  }

  // ---------- Status and saving ----------

  function applyStatus() {
    var published = status === "published";
    // Link to what volunteers see (a preview while the event is a draft).
    $("volunteer-link-row").hidden = !eventId || !active;
    if (eventId) {
      $("volunteer-link").href = "signup.html?event=" + encodeURIComponent(eventId);
      $("volunteer-link-hint").textContent = published ? "Share this link with volunteers." : "Preview only until you publish.";
    }
    $("publish").textContent = published ? "Save changes" : "Publish";
    $("save-draft").textContent = published ? "Unpublish" : "Save draft";
    // Each step: Back and Next; a draft is published from the last step, a
    // published event can be saved from any (and unpublished from the last).
    var last = step === STEPS.length - 1;
    $("step-back").hidden = step === 0;
    $("step-next").hidden = last;
    $("step-next").className = "btn " + (published ? "btn-secondary" : "btn-primary");
    $("publish").hidden = !published && !last;
    $("save-draft").hidden = published && !last;
    // Only Admins can delete an event; anyone can make it inactive.
    $("manage-event").hidden = !eventId;
    $("delete-event").hidden = !eventId || !isAdmin;
    $("delete-hint").hidden = !eventId || isAdmin;
    $("deactivate").hidden = !eventId || !active;
    $("inactive-note").hidden = !eventId || active;
    $("event-tabs").hidden = !eventId;
    var title = $("title").value.trim();
    var n = noun();
    $("page-title").textContent = eventId ? (title || "Untitled " + n) : "New " + n;
    document.title = (eventId ? title || n.charAt(0).toUpperCase() + n.slice(1) : "New " + n) + " · Sevak";
  }

  // ---------- Steps (EVT-22) ----------
  // Four steps, one on screen at a time: details, when and where, roles and
  // shifts, and review. Any step opens from the step bar; Next checks the
  // one on screen first.
  var STEPS = ["details", "when", "roles", "review"];
  var STEP_HASH = { details: 0, when: 1, where: 1, roles: 2, review: 3 };
  var step = 0;

  function showStepOnly(i) {
    STEPS.forEach(function (name, n) { $("step-" + name).hidden = n !== i; });
  }

  function showStep(i, focus) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    showStepOnly(step);
    form.querySelectorAll("#stepper button").forEach(function (b) {
      var n = Number(b.dataset.step);
      if (n === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.classList.toggle("is-done", n < step);
    });
    if (STEPS[step] === "review") renderReview();
    applyStatus();
    if (!focus) return;
    $("step-" + STEPS[step]).focus({ preventScroll: true });
    var top = $("stepper").getBoundingClientRect().top + window.pageYOffset - 8;
    if (window.pageYOffset > top) window.scrollTo(0, top);
  }

  $("stepper").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-step]");
    if (!b) return;
    $("status").textContent = "";
    showStep(Number(b.dataset.step), true);
  });
  $("step-back").addEventListener("click", function () {
    $("status").textContent = "";
    showStep(step - 1, true);
  });
  $("step-next").addEventListener("click", function () {
    var first = checkStep(step, false);
    if (first) {
      $("status").textContent = "Fix what's marked, then continue.";
      first.focus();
      return;
    }
    $("status").textContent = "";
    showStep(step + 1, true);
  });

  // What's been set up, with a way back to each step.
  function renderReview() {
    var ev = readForm();
    var list = $("review-list");
    list.innerHTML = "";
    var row = function (label, text, to) {
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      var span = document.createElement("span");
      span.textContent = text;
      dd.appendChild(span);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-link";
      b.textContent = "Edit";
      b.setAttribute("aria-label", "Edit " + label.toLowerCase());
      b.addEventListener("click", function () { showStep(to, true); });
      dd.appendChild(b);
      list.appendChild(dt);
      list.appendChild(dd);
    };
    var main = mainEvent();
    row("Name", (ev.title || "Not named yet") + (main ? " · part of " + (main.title || "a main event") : ""), 0);
    row("When", ev.startDate ? E.rangeLabel(ev.startDate, ev.endDate) + " · " + String(ev.timezone || "").replace(/_/g, " ") : "No dates yet", 1);
    var loc = ev.location;
    row("Where", loc.type === "online" ? "Online" : loc.type === "later" ? "Shared later"
      : [loc.venue, loc.line1, loc.city].filter(Boolean).join(", ") || "No address yet", 1);
    var t = E.totals(ev);
    row("Tasks", t.roles ? E.plural(t.roles, "task") + " · " + E.plural(t.shifts, "shift") + " · " + E.plural(t.volunteers, "volunteer spot") : "No tasks yet", 2);
  }

  function save(publishing) {
    var firstInvalid = validateFor(publishing);
    if (firstInvalid) {
      $("status").textContent = publishing
        ? "A few things need fixing before this can be published."
        : "Add a name and dates to save a draft.";
      firstInvalid.focus();
      return;
    }
    var wasPublished = status === "published";
    status = publishing ? "published" : "draft";
    var event = readForm();
    if (!E.save(event)) {
      $("status").textContent = "Couldn't save in this browser. Check that site storage is allowed.";
      return;
    }
    // Saved: back to the Events list, which says so and highlights it.
    var privateNote = event.visibility === "public" && !(org && org.verificationStatus === "verified")
      ? " It stays private until your organization is verified." : "";
    var name = "“" + (event.title || "Untitled " + noun()) + "”";
    var main = E.getMain(event.mainEventId);
    window.SevakNav.flashAndGo(main ? "main-event.html?id=" + encodeURIComponent(main.id) : "events.html", publishing
      ? (wasPublished ? "Saved changes to " + name + "." : "Published " + name + "." + privateNote)
      : (wasPublished ? "Unpublished " + name + ". It's a draft again." : "Saved " + name + " as a draft."), {
      href: "event.html?id=" + encodeURIComponent(event.id),
      linkText: "Open it again",
      highlight: '[data-event-id="' + cssId(event.id) + '"]'
    });
  }

  function cssId(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, "");
  }

  // Enter in a field: Next, until the last step of a draft.
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (status !== "published" && step < STEPS.length - 1) { $("step-next").click(); return; }
    save(true);
  });
  $("save-draft").addEventListener("click", function () { save(false); });

  function setActive(on) {
    var saved = E.setActive(eventId, on);
    if (!saved) {
      $("status").textContent = "Couldn't save in this browser. Check that site storage is allowed.";
      return;
    }
    active = on;
    existing = saved;
    applyStatus();
    $("status").textContent = on ? "Event reactivated." : "Event made inactive. It's hidden from volunteers and lists.";
    if (on) $("deactivate").focus(); else $("reactivate").focus();
  }

  $("deactivate").addEventListener("click", function () {
    var signups = window.SevakSignups ? window.SevakSignups.forEvent(eventId).length : 0;
    if (!window.confirm("Make this event inactive? It will be hidden from volunteers, the Events list and the dashboard" +
      (signups ? ", and no one can sign up. Its " + E.plural(signups, "existing sign-up") + " will be kept" : "") +
      ". You can reactivate it at any time.")) return;
    setActive(false);
  });
  $("reactivate").addEventListener("click", function () { setActive(true); });

  $("delete-event").addEventListener("click", function () {
    if (!window.SevakOrgs.isAdmin(org)) {
      isAdmin = false;
      applyStatus();
      $("status").textContent = "Only admins can delete events. You can make it inactive instead.";
      return;
    }
    if (!window.confirm("Delete this event? This can't be undone.")) return;
    var back = $("back-link").href;
    E.remove(eventId);
    location.href = back;
  });

  // ---------- Start ----------

  function updateCounter() {
    $("description-counter").textContent = $("description").value.length + " / " + $("description").maxLength;
  }
  $("description").addEventListener("input", updateCounter);
  $("title").addEventListener("input", applyStatus);

  ["startDate", "endDate"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      // A one-day event is the common case, so the end date follows the start.
      if (id === "startDate" && (!$("endDate").value || $("endDate").value < $("startDate").value)) {
        $("endDate").value = $("startDate").value;
      }
      refreshDays();
      ["startDate", "endDate"].forEach(function (d) {
        if ($(d).getAttribute("aria-invalid") === "true" && !messageFor($(d))) F.setError($(d), "");
      });
    });
  });

  if (!org || !org.name) {
    $("no-org").hidden = false;
    form.hidden = true;
    $("event-tabs").hidden = true;
    $("back-link").hidden = true;
    $("page-title").textContent = "New event";
    return;
  }

  $("org-line").textContent = org.name;
  $("org-line").hidden = false;
  F.fillCountrySelect($("country"));
  if (org.address && org.address.country) $("country").value = org.address.country;

  if (eventId && !existing) {
    $("status").textContent = "We couldn't find that event, so this is a new one.";
    eventId = null;
    history.replaceState(null, "", location.pathname);
  }

  if (existing) {
    fill(existing);
  } else {
    fillMainEvents(params.get("main"));
    var siblings = mainEvent() ? E.subEvents(mainEvent().id).filter(function (e) { return e.timezone; }) : [];
    fillTimezones(siblings.length ? siblings[siblings.length - 1].timezone : undefined);
    fillEventAdmin("");
    if (orgAddress().line1) copyOrgAddress();
    addRole();
  }
  applyBreadcrumb();
  applyWording();

  applyLocationType();
  applyVisibility();
  updateCounter();
  refreshDays();
  renderPresets();
  // A link can open a step: event.html?id=…#roles
  var hashStep = STEP_HASH[location.hash.slice(1)];
  showStep(hashStep === undefined ? 0 : hashStep, false);

  var docs = window.SevakDocs.mount($("panel-documents"), {
    owner: eventId ? "event:" + eventId : null,
    help: "Briefings, maps, run sheets, waivers and anything else for this event.",
    blockedMessage: "Save the event first (a draft is fine), then you can add documents."
  });
  window.SevakDocs.pageTabs($("event-tabs"));
})();
