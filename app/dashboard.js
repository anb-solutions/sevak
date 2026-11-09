// Dashboard (prototype): the current organization's upcoming events, and
// how many volunteers have enrolled against how many each event needs.
(function () {
  "use strict";

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var E = window.SevakEvents;
  var S = window.SevakSignups;
  var $ = function (id) { return document.getElementById(id); };

  // An event "needs volunteers" when it's under half full and starts soon.
  var NEEDS_FILL_BELOW = 0.5;
  var NEEDS_WITHIN_DAYS = 14;

  // dashboard.html?demo=1 loads the demo organization and shows it.
  // Not with Sevak's server: there, only real organizations and people.
  if (new URLSearchParams(location.search).get("demo") === "1" && window.SevakDemo && !window.SevakServer) {
    window.SevakDemo.load();
    history.replaceState(null, "", location.pathname);
    window.SevakNav.render();
  }

  var org = O.current();
  var view = "chart";

  // ---------- Dates ----------

  function todayString() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function addDays(dateString, n) {
    var p = dateString.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  function daysUntil(dateString) {
    var a = Date.parse(todayString() + "T00:00:00Z"), b = Date.parse(dateString + "T00:00:00Z");
    return Math.round((b - a) / 86400000);
  }

  // ---------- Numbers ----------

  var formatNumber = new Intl.NumberFormat(undefined);
  var formatPercent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });

  // Required, enrolled and per-shift detail for one event.
  function eventStats(event) {
    var counts = S.countsByShift(event.id);
    var shifts = [];
    (event.roles || []).forEach(function (role) {
      (role.shifts || []).forEach(function (shift) {
        var required = Number(shift.capacity) || 0;
        var enrolled = Math.min(counts[shift.id] || 0, required);
        shifts.push({ role: role.name || "Role", date: shift.date, start: shift.start, end: shift.end, required: required, enrolled: enrolled });
      });
    });
    shifts.sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
    var required = shifts.reduce(function (n, s) { return n + s.required; }, 0);
    var enrolled = shifts.reduce(function (n, s) { return n + s.enrolled; }, 0);
    return { required: required, enrolled: enrolled, open: required - enrolled, ratio: required ? enrolled / required : 0, shifts: shifts };
  }

  function upcomingEvents() {
    var today = todayString();
    var range = $("range").value;
    var until = range === "all" ? null : addDays(today, Number(range));
    var status = $("status-filter").value;
    return E.forOrg(org.id).filter(function (e) {
      if (!e.startDate || !E.isActive(e)) return false;
      if ((e.endDate || e.startDate) < today) return false;
      if (until && e.startDate > until) return false;
      if (status !== "all" && (e.status || "draft") !== status) return false;
      return true;
    }).sort(E.byDate);
  }

  function needsVolunteers(event, stats) {
    return stats.required > 0 && stats.ratio < NEEDS_FILL_BELOW && daysUntil(event.startDate) <= NEEDS_WITHIN_DAYS;
  }

  // ---------- Tooltip ----------

  var tooltip = $("tooltip");

  function showTooltip(target, stats) {
    tooltip.innerHTML = "";
    var value = document.createElement("strong");
    value.textContent = formatNumber.format(stats.enrolled) + " enrolled";
    var rest = document.createElement("span");
    rest.textContent = "of " + formatNumber.format(stats.required) + " required · " + formatNumber.format(stats.open) + " open";
    tooltip.appendChild(value);
    tooltip.appendChild(rest);
    tooltip.hidden = false;
    var card = tooltip.offsetParent.getBoundingClientRect();
    var r = target.getBoundingClientRect();
    var left = Math.min(Math.max(r.left - card.left, 8), card.width - tooltip.offsetWidth - 8);
    tooltip.style.left = left + "px";
    tooltip.style.top = (r.top - card.top - tooltip.offsetHeight - 8) + "px";
  }

  function hideTooltip() { tooltip.hidden = true; }

  // ---------- Drawing ----------

  function meter(ratio, className) {
    var track = document.createElement("span");
    track.className = "meter " + (className || "");
    var fill = document.createElement("span");
    fill.className = "meter-fill";
    fill.style.width = (Math.max(0, Math.min(1, ratio)) * 100) + "%";
    track.appendChild(fill);
    return track;
  }

  function needsBadge() {
    var b = document.createElement("span");
    b.className = "status-badge";
    var icon = document.createElement("span");
    icon.className = "status-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";
    b.appendChild(icon);
    b.appendChild(document.createTextNode("Needs volunteers"));
    return b;
  }

  function barRow(event, stats) {
    var li = document.createElement("li");
    li.className = "bar-row";

    var head = document.createElement("div");
    head.className = "bar-head";
    var titleWrap = document.createElement("div");
    var main = event.mainEventId ? E.getMain(event.mainEventId) : null;
    if (main) {
      var parent = document.createElement("p");
      parent.className = "bar-parent";
      parent.textContent = main.title || "Main event";
      titleWrap.appendChild(parent);
    }
    var title = document.createElement("a");
    title.className = "bar-title";
    title.href = "event.html?id=" + encodeURIComponent(event.id);
    title.textContent = event.title || "Untitled event";
    titleWrap.appendChild(title);
    var meta = document.createElement("p");
    meta.className = "event-meta";
    meta.textContent = [E.rangeLabel(event.startDate, event.endDate), event.status === "published" ? "Published" : "Draft"].join(" · ");
    titleWrap.appendChild(meta);
    head.appendChild(titleWrap);
    if (needsVolunteers(event, stats)) head.appendChild(needsBadge());
    li.appendChild(head);

    var line = document.createElement("div");
    line.className = "bar-line";
    var bar = meter(stats.ratio, "bar");
    bar.tabIndex = 0;
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", (event.title || "Event") + ": " + stats.enrolled + " of " + stats.required + " volunteers enrolled");
    bar.addEventListener("pointerenter", function () { showTooltip(bar, stats); });
    bar.addEventListener("pointerleave", hideTooltip);
    bar.addEventListener("focus", function () { showTooltip(bar, stats); });
    bar.addEventListener("blur", hideTooltip);
    var value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = formatNumber.format(stats.enrolled) + " / " + formatNumber.format(stats.required) +
      (stats.required ? " · " + formatPercent.format(stats.ratio) : "");
    line.appendChild(bar);
    line.appendChild(value);
    li.appendChild(line);

    if (stats.shifts.length) {
      var details = document.createElement("details");
      details.className = "shift-details";
      var summary = document.createElement("summary");
      summary.textContent = "Shifts (" + stats.shifts.length + ")";
      details.appendChild(summary);
      var list = document.createElement("ul");
      list.className = "shift-bars";
      stats.shifts.forEach(function (s) {
        var item = document.createElement("li");
        var label = document.createElement("span");
        label.className = "shift-label";
        label.textContent = E.dayLabel(s.date) + " · " + E.timeLabel(s.start) + "–" + E.timeLabel(s.end) + " · " + s.role;
        var m = meter(s.required ? s.enrolled / s.required : 0, "bar bar-small");
        m.setAttribute("aria-hidden", "true");
        var v = document.createElement("span");
        v.className = "bar-value";
        v.textContent = s.enrolled + " / " + s.required;
        item.appendChild(label);
        item.appendChild(m);
        item.appendChild(v);
        list.appendChild(item);
      });
      details.appendChild(list);
      li.appendChild(details);
    } else {
      var none = document.createElement("p");
      none.className = "hint";
      none.textContent = "No shifts yet.";
      li.appendChild(none);
    }
    return li;
  }

  function tableRow(event, stats) {
    var tr = document.createElement("tr");
    var cells = [
      (event.mainEventId && E.getMain(event.mainEventId) ? E.getMain(event.mainEventId).title + " › " : "") + (event.title || "Untitled event"),
      E.rangeLabel(event.startDate, event.endDate),
      formatNumber.format(stats.required),
      formatNumber.format(stats.enrolled),
      formatNumber.format(stats.open),
      stats.required ? formatPercent.format(stats.ratio) : "–"
    ];
    cells.forEach(function (text, i) {
      var td = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) td.scope = "row";
      if (i >= 2) td.className = "num";
      td.textContent = text;
      tr.appendChild(td);
    });
    return tr;
  }

  function render() {
    hideTooltip();
    var events = upcomingEvents();
    var totals = { required: 0, enrolled: 0 };
    $("bars").innerHTML = "";
    $("table-body").innerHTML = "";

    events.forEach(function (event) {
      var stats = eventStats(event);
      totals.required += stats.required;
      totals.enrolled += stats.enrolled;
      $("bars").appendChild(barRow(event, stats));
      $("table-body").appendChild(tableRow(event, stats));
    });

    var open = totals.required - totals.enrolled;
    var ratio = totals.required ? totals.enrolled / totals.required : 0;
    $("kpi-events").textContent = formatNumber.format(events.length);
    $("kpi-required").textContent = formatNumber.format(totals.required);
    $("kpi-enrolled").textContent = formatNumber.format(totals.enrolled);
    $("kpi-open").textContent = formatNumber.format(open);
    $("fill-pct").textContent = formatPercent.format(ratio);
    $("fill-note").textContent = totals.required
      ? formatNumber.format(totals.enrolled) + " of " + formatNumber.format(totals.required) + " spots filled"
      : "No volunteer spots in these events yet";
    $("overall-fill").style.width = (ratio * 100) + "%";
    $("overall-meter").setAttribute("aria-label", "Overall fill: " + formatPercent.format(ratio));

    var empty = $("dash-empty");
    empty.hidden = events.length > 0;
    if (!events.length) {
      empty.innerHTML = "";
      empty.appendChild(document.createTextNode("No upcoming events match these filters. "));
      var link = document.createElement("a");
      link.href = "event.html";
      link.textContent = "Create an event";
      empty.appendChild(link);
    }
    $("chart-view").hidden = view !== "chart" || !events.length;
    $("table-view").hidden = view !== "table" || !events.length;
    $("remove-samples").hidden = !S.hasSamples();
  }

  // ---------- Sample sign-ups ----------

  var SAMPLE_NAMES = ["Asha", "Ben", "Chen", "Diego", "Emma", "Farah", "Grace", "Hiro", "Isla", "Jamal", "Kofi", "Lena", "Maya", "Noah", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Tara"];

  function addSamples() {
    var added = [];
    var today = todayString();
    E.forOrg(org.id).forEach(function (event) {
      if (!event.startDate || !E.isActive(event) || (event.endDate || event.startDate) < today) return;
      var counts = S.countsByShift(event.id);
      (event.roles || []).forEach(function (role) {
        (role.shifts || []).forEach(function (shift) {
          var capacity = Number(shift.capacity) || 0;
          var free = capacity - (counts[shift.id] || 0);
          // Fill somewhere between a fifth and all of the remaining spots.
          var n = Math.min(free, Math.round(free * (0.2 + Math.random() * 0.8)));
          for (var i = 0; i < n; i++) {
            var name = SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)];
            added.push({
              id: E.newId("signup"), sample: true, eventId: event.id, shiftId: shift.id,
              name: name + " (sample)", email: name.toLowerCase() + "@example.com",
              status: "confirmed", createdAt: new Date().toISOString()
            });
          }
        });
      });
    });
    if (!added.length) {
      $("sample-status").textContent = "There are no open spots in upcoming events to fill.";
      return;
    }
    S.addMany(added);
    $("sample-status").textContent = "Added " + E.plural(added.length, "sample sign-up") + ".";
    render();
  }

  // ---------- Start ----------

  if (!window.SevakNav.guard()) return;

  // Demo data and sample sign-ups are for the prototype only.
  if (window.SevakServer) document.querySelector(".sample-card").hidden = true;

  // Demo data buttons work with or without an organization.
  var D = window.SevakDemo;
  $("load-demo").textContent = D.isLoaded() ? "Reload demo data" : "Load demo data";
  $("remove-demo").hidden = !D.isLoaded();
  $("load-demo").addEventListener("click", function () {
    D.load();
    location.href = location.pathname;
  });
  $("remove-demo").addEventListener("click", function () {
    if (!window.confirm("Remove the demo organization and all its events and sign-ups?")) return;
    D.remove();
    location.href = location.pathname;
  });

  O.renderSwitcher($("org-switcher"), { switchTo: "dashboard.html" });
  O.renderHeader($("org-context"), org);
  if (!org) {
    $("no-org").hidden = false;
    return;
  }
  $("dashboard").hidden = false;

  ["range", "status-filter"].forEach(function (id) { $(id).addEventListener("change", render); });
  ["chart", "table"].forEach(function (v) {
    $("view-" + v).addEventListener("click", function () {
      view = v;
      $("view-chart").setAttribute("aria-pressed", String(v === "chart"));
      $("view-table").setAttribute("aria-pressed", String(v === "table"));
      render();
    });
  });
  $("add-samples").addEventListener("click", addSamples);
  $("remove-samples").addEventListener("click", function () {
    S.removeSamples();
    $("sample-status").textContent = "Sample sign-ups removed.";
    render();
  });

  render();
})();
