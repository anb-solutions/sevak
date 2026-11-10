// Events for the prototype, kept in this browser. Shared by the event
// editor and the organization page.
(function () {
  "use strict";

  var KEY = "sevak.events.v1";
  var MAIN_KEY = "sevak.mainEvents.v1";
  var DOCS_KEY = "sevak.documents.v1";
  var F = window.SevakForms;

  function all() {
    var list = F.load(KEY);
    return Array.isArray(list) ? list : [];
  }

  function get(id) {
    return all().filter(function (e) { return e.id === id; })[0] || null;
  }

  function save(event) {
    var list = all();
    var i = list.findIndex(function (e) { return e.id === event.id; });
    if (i === -1) list.push(event); else list[i] = event;
    return F.store(KEY, list);
  }

  // ---------- Inactive events ----------
  // Making an event inactive hides it from volunteers, the Events list (unless
  // inactive events are shown), main event dates and the dashboard, without
  // deleting it. Only Admins can delete events; anyone running events can
  // make one inactive and reactivate it.

  function isActive(event) {
    return !!event && event.active !== false;
  }

  function setActive(id, active) {
    var event = get(id);
    if (!event) return null;
    event = Object.assign({}, event, { active: !!active, updatedAt: new Date().toISOString() });
    if (active) delete event.inactiveAt; else event.inactiveAt = event.updatedAt;
    return save(event) ? event : null;
  }

  function remove(id) {
    F.store(DOCS_KEY, (F.load(DOCS_KEY) || []).filter(function (d) { return d.owner !== "event:" + id; }));
    return F.store(KEY, all().filter(function (e) { return e.id !== id; }));
  }

  // ---------- Main events ----------
  // A main event (for example a festival) groups related events, called
  // sub-events (for example the performance and its rehearsals). Events
  // point to their main event with mainEventId; standalone events have none.

  function allMain() {
    var list = F.load(MAIN_KEY);
    return Array.isArray(list) ? list : [];
  }

  function getMain(id) {
    return allMain().filter(function (m) { return m.id === id; })[0] || null;
  }

  function saveMain(main) {
    var list = allMain();
    var i = list.findIndex(function (m) { return m.id === main.id; });
    if (i === -1) list.push(main); else list[i] = main;
    return F.store(MAIN_KEY, list);
  }

  // Deleting a main event keeps its sub-events, as standalone events.
  function removeMain(id) {
    var events = all().map(function (e) {
      if (e.mainEventId === id) { e = Object.assign({}, e); delete e.mainEventId; }
      return e;
    });
    F.store(KEY, events);
    return F.store(MAIN_KEY, allMain().filter(function (m) { return m.id !== id; }));
  }

  function byDate(a, b) {
    return (a.startDate || "9999").localeCompare(b.startDate || "9999");
  }

  function subEvents(mainId) {
    return all().filter(function (e) { return e.mainEventId === mainId; }).sort(byDate);
  }

  // The main event's dates run from its first active sub-event to its last.
  function mainRange(mainId) {
    var subs = subEvents(mainId).filter(function (e) { return e.startDate && isActive(e); });
    if (!subs.length) return { start: "", end: "" };
    var end = subs.reduce(function (max, e) { var d = e.endDate || e.startDate; return d > max ? d : max; }, "");
    return { start: subs[0].startDate, end: end };
  }

  // ---------- List items ----------

  function badge(text, kind) {
    var span = document.createElement("span");
    span.className = "badge" + (kind ? " badge-" + kind : "");
    span.textContent = text;
    return span;
  }

  // A list item linking to an event, with its dates, place, size and badges.
  function eventItem(event) {
    var t = totals(event);
    var li = document.createElement("li");
    li.className = "event-item";
    li.dataset.eventId = event.id;

    var info = document.createElement("div");
    var h3 = document.createElement("h3");
    var link = document.createElement("a");
    link.href = "event.html?id=" + encodeURIComponent(event.id);
    link.textContent = event.title || "Untitled event";
    h3.appendChild(link);
    var meta = document.createElement("p");
    meta.className = "event-meta";
    var loc = event.location || {};
    var where = loc.type === "online" ? "Online" : loc.type === "later" ? "Location shared later" : loc.venue || loc.city || "";
    meta.textContent = [rangeLabel(event.startDate, event.endDate), where,
      plural(t.shifts, "shift") + ", " + plural(t.volunteers, "volunteer spot")].filter(Boolean).join(" · ");
    info.appendChild(h3);
    info.appendChild(meta);
    // Tasks without a lead (EVT-21), for the Admins who choose them.
    var O = window.SevakOrgs;
    var unled = (event.roles || []).filter(function (r) { return r && !r.lead; }).length;
    if (unled && O && O.isAdmin(O.get(event.organizationId))) {
      var leads = document.createElement("p");
      leads.className = "event-meta lead-missing";
      leads.textContent = plural(unled, "task") + " without a task lead";
      info.appendChild(leads);
    }

    var badges = document.createElement("div");
    badges.className = "badges";
    if (!isActive(event)) {
      li.classList.add("is-inactive");
      badges.appendChild(badge("Inactive", "inactive"));
    }
    badges.appendChild(event.status === "published" ? badge("Published", "published") : badge("Draft", "draft"));
    badges.appendChild(badge(event.visibility === "private" ? "Private" : "Public"));

    li.appendChild(info);
    li.appendChild(badges);
    return li;
  }

  // Events and main events of one organization.
  function forOrg(orgId) {
    return all().filter(function (e) { return e.organizationId === orgId; });
  }

  function mainForOrg(orgId) {
    return allMain().filter(function (m) { return m.organizationId === orgId; });
  }

  function newId(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Dates ----------
  // Dates are "YYYY-MM-DD" strings for the event's own calendar days, so
  // they are handled in UTC to avoid the visitor's time zone shifting them.

  function parse(date) {
    var p = (date || "").split("-").map(Number);
    return p.length === 3 && p.every(function (n) { return !isNaN(n); }) ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : null;
  }

  function toString(d) {
    return d.toISOString().slice(0, 10);
  }

  // Every calendar day from start to end, inclusive.
  function days(start, end) {
    var s = parse(start), e = parse(end);
    if (!s || !e || e < s) return [];
    var out = [];
    for (var d = s; d <= e && out.length < 400; d = new Date(d.getTime() + 86400000)) out.push(toString(d));
    return out;
  }

  function dayLabel(date, opts) {
    var d = parse(date);
    if (!d) return date;
    return new Intl.DateTimeFormat(undefined, Object.assign({ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }, opts || {})).format(d);
  }

  function rangeLabel(start, end) {
    if (!start) return "Dates not set";
    var withYear = { year: "numeric" };
    if (!end || end === start) return dayLabel(start, withYear);
    return dayLabel(start) + " – " + dayLabel(end, withYear);
  }

  function timeLabel(time) {
    var p = (time || "").split(":").map(Number);
    if (p.length < 2 || p.some(isNaN)) return time;
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
      .format(new Date(Date.UTC(2000, 0, 1, p[0], p[1])));
  }

  function totals(event) {
    var roles = event.roles || [];
    var shifts = 0, volunteers = 0;
    roles.forEach(function (r) {
      (r.shifts || []).forEach(function (s) {
        shifts += 1;
        volunteers += Number(s.capacity) || 0;
      });
    });
    return { roles: roles.length, shifts: shifts, volunteers: volunteers };
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  window.SevakEvents = {
    all: all,
    get: get,
    allMain: allMain,
    getMain: getMain,
    saveMain: saveMain,
    removeMain: removeMain,
    subEvents: subEvents,
    mainRange: mainRange,
    byDate: byDate,
    forOrg: forOrg,
    mainForOrg: mainForOrg,
    eventItem: eventItem,
    badge: badge,
    save: save,
    remove: remove,
    isActive: isActive,
    setActive: setActive,
    newId: newId,
    days: days,
    dayLabel: dayLabel,
    rangeLabel: rangeLabel,
    timeLabel: timeLabel,
    totals: totals,
    plural: plural
  };
})();
