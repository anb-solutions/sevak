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
  }

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
    return {
      id: card.dataset.id,
      name: get("name"),
      description: get("description"),
      bring: get("bring"),
      shifts: Array.prototype.map.call(card.querySelectorAll(".shift-row"), readShift)
    };
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
      var title = "Role " + (i + 1);
      card.querySelector("h3").textContent = title;
      card.querySelector(".remove-role").setAttribute("aria-label", "Remove " + title.toLowerCase());
    });
    $("add-role").hidden = roleList.children.length >= MAX_ROLES;
    updateSummary();
  }

  function updateSummary() {
    var t = E.totals({ roles: Array.prototype.map.call(roleList.children, readRole) });
    $("roles-summary").textContent = t.roles
      ? E.plural(t.roles, "role") + " · " + E.plural(t.shifts, "shift") + " · " + E.plural(t.volunteers, "volunteer spot")
      : "No roles yet.";
  }

  roleList.addEventListener("input", updateSummary);
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
  }

  // The back link goes to the main event when there is one.
  function applyBreadcrumb() {
    var main = E.getMain($("mainEventId").value);
    $("back-link").href = main ? "main-event.html?id=" + encodeURIComponent(main.id) : "events.html";
    $("org-name-crumb").textContent = main ? main.title || "Main event" : "Events";
  }
  $("mainEventId").addEventListener("change", applyBreadcrumb);

  // ---------- Location and visibility ----------

  function applyLocationType() {
    var online = locationType() === "online";
    $("in-person-fields").hidden = online;
    $("online-fields").hidden = !online;
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
    var a = (org && org.address) || {};
    if (a.country) $("country").value = a.country;
    $("addressLine1").value = a.line1 || "";
    $("city").value = a.city || "";
    $("state").value = a.state || "";
    $("postalCode").value = a.postalCode || a.zip || "";
    ["addressLine1", "city", "postalCode"].forEach(function (id) { F.setError($(id), ""); });
    $("status").textContent = "Copied your organization's address.";
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
    $("roles-error").textContent = cards.length ? "" : "Add at least one role before publishing.";
    if (!cards.length) first = $("add-role");
    Array.prototype.forEach.call(cards, function (card) {
      var error = card.querySelector(".shifts-error");
      var empty = !card.querySelector(".shift-row");
      error.textContent = empty ? "Add at least one shift for this role." : "";
      if (empty && !first) first = card.querySelector(".add-shift");
    });
    return first;
  }

  function clearStructureErrors() {
    $("roles-error").textContent = "";
    form.querySelectorAll(".shifts-error").forEach(function (e) { e.textContent = ""; });
  }

  function validateFor(publishing) {
    if (!publishing) {
      clearStructureErrors();
      return F.validate([$("title"), $("startDate"), $("endDate")], messageFor);
    }
    var fields = form.querySelectorAll("input:not([type=radio]), select:not(#timezone), textarea");
    var firstField = F.validate(fields, messageFor);
    var firstStructure = structureErrors();
    return firstField || firstStructure;
  }

  F.clearErrorsAsYouType(form, messageFor);
  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.getAttribute("aria-invalid") === "true" && !messageFor(t)) F.setError(t, "");
  });

  // ---------- Read / fill ----------

  function readForm() {
    var v = function (id) { return $(id).value.trim(); };
    var online = locationType() === "online";
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
      location: online
        ? { type: "online", url: v("onlineUrl") }
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
  function fillEventAdmin(selected) {
    var sel = $("eventAdmin");
    sel.innerHTML = "";
    var add = function (value, text) {
      var o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      sel.appendChild(o);
    };
    add("", "Any Admin of " + ((org && org.name) || "the organization"));
    var team = (org && org.team) || [];
    var seen = {};
    team.forEach(function (m) {
      var key = String(m.email || "").toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      add(m.email, (m.name || m.email) + " (" + (m.role === "admin" ? "Admin" : "Coordinator") + ")");
    });
    if (selected && !seen[String(selected).toLowerCase()]) add(selected, selected + " (no longer on the team)");
    sel.value = selected || "";
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
    form.querySelector('input[name="locationType"][value="' + (loc.type === "online" ? "online" : "in-person") + '"]').checked = true;
    if (loc.type === "online") {
      set("onlineUrl", loc.url);
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
    // Only Admins can delete an event; anyone can make it inactive.
    $("delete-event").hidden = !eventId || !isAdmin;
    $("delete-hint").hidden = !eventId || isAdmin;
    $("deactivate").hidden = !eventId || !active;
    $("inactive-note").hidden = !eventId || active;
    var title = $("title").value.trim();
    $("page-title").textContent = eventId ? (title || "Untitled event") : "New event";
    document.title = (eventId ? title || "Event" : "New event") + " · Sevak";
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
    if (!eventId) {
      eventId = event.id;
      createdAt = event.createdAt;
      history.replaceState(null, "", "?id=" + encodeURIComponent(eventId) + location.hash);
      docs.setOwner("event:" + eventId);
    }
    applyStatus();
    var privateNote = event.visibility === "public" && !(org && org.verificationStatus === "verified")
      ? " It stays private until your organization is verified." : "";
    $("status").textContent = publishing
      ? (wasPublished ? "Changes saved." : "Published." + privateNote)
      : (wasPublished ? "Unpublished. The event is a draft again." : "Draft saved.");
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); save(true); });
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

  $("org-name-crumb").textContent = org.name;
  window.SevakOrgs.renderHeader($("org-context"), org);
  $("use-org-address").hidden = !(org.address && org.address.line1);
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
    fillTimezones();
    fillEventAdmin("");
    addRole();
  }
  applyBreadcrumb();

  applyLocationType();
  applyVisibility();
  applyStatus();
  updateCounter();
  refreshDays();

  var docs = window.SevakDocs.mount($("panel-documents"), {
    owner: eventId ? "event:" + eventId : null,
    help: "Briefings, maps, run sheets, waivers and anything else for this event.",
    blockedMessage: "Save the event first (a draft is fine), then you can add documents."
  });
  window.SevakDocs.pageTabs($("event-tabs"));
})();
