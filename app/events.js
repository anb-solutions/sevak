// Events list (prototype): the organization's main events with their
// sub-events, then any other events.
(function () {
  "use strict";

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var $ = function (id) { return document.getElementById(id); };

  function renderEvents() {
    var E = window.SevakEvents;
    var org = O.current();
    var saved = !!org;
    $("create-buttons").hidden = !saved;
    $("no-org").hidden = saved;
    $("events").hidden = !saved;

    var allEvents = saved ? E.forOrg(org.id).sort(E.byDate) : [];
    // Inactive events are hidden unless asked for.
    var inactiveCount = allEvents.filter(function (e) { return !E.isActive(e); }).length;
    var showInactive = inactiveCount > 0 && $("show-inactive").checked;
    var shown = function (e) { return showInactive || E.isActive(e); };
    $("show-inactive-wrap").hidden = !inactiveCount;
    $("inactive-count").textContent = inactiveCount;
    var events = allEvents.filter(shown);
    var mains = (saved ? E.mainForOrg(org.id) : []).sort(function (a, b) {
      var ra = E.mainRange(a.id).start || "9999", rb = E.mainRange(b.id).start || "9999";
      return ra.localeCompare(rb) || (a.title || "").localeCompare(b.title || "");
    });
    var mainIds = {};
    mains.forEach(function (m) { mainIds[m.id] = true; });
    var standalone = events.filter(function (e) { return !e.mainEventId || !mainIds[e.mainEventId]; });

    $("events-empty").hidden = !saved || events.length > 0 || mains.length > 0;
    $("events-empty").textContent = inactiveCount
      ? "No active events. Create one, or show inactive events to reactivate one."
      : "No events yet. Create one to start recruiting volunteers.";
    $("events-help").hidden = !saved || mains.length > 0;

    // Main events, each with its sub-events nested underneath.
    var groups = $("main-groups");
    groups.innerHTML = "";
    mains.forEach(function (main) {
      var subs = E.subEvents(main.id).filter(shown);
      var range = E.mainRange(main.id);
      var group = document.createElement("div");
      group.className = "main-group";
      group.dataset.mainId = main.id;

      var head = document.createElement("div");
      head.className = "main-head";
      var titleWrap = document.createElement("div");
      var h3 = document.createElement("h3");
      var link = document.createElement("a");
      link.href = "main-event.html?id=" + encodeURIComponent(main.id);
      link.textContent = main.title || "Untitled main event";
      h3.appendChild(link);
      var meta = document.createElement("p");
      meta.className = "event-meta";
      meta.textContent = ["Main event", E.plural(subs.length, "sub-event"),
        range.start ? E.rangeLabel(range.start, range.end) : ""].filter(Boolean).join(" · ");
      titleWrap.appendChild(h3);
      titleWrap.appendChild(meta);
      var add = document.createElement("a");
      add.className = "btn btn-secondary btn-small";
      add.href = "event.html?main=" + encodeURIComponent(main.id);
      add.textContent = "+ Sub-event";
      add.setAttribute("aria-label", "Add a sub-event to " + (main.title || "this main event"));
      var edit = document.createElement("a");
      edit.className = "btn btn-secondary btn-small";
      edit.href = link.href;
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", "Edit " + (main.title || "this main event"));
      var actions = document.createElement("div");
      actions.className = "main-actions";
      actions.appendChild(edit);
      actions.appendChild(add);
      head.appendChild(titleWrap);
      head.appendChild(actions);
      group.appendChild(head);

      var list = document.createElement("ul");
      list.className = "event-list sub-list";
      subs.forEach(function (event) { list.appendChild(E.eventItem(event)); });
      group.appendChild(list);
      if (!subs.length) {
        var empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No sub-events yet.";
        group.appendChild(empty);
      }
      groups.appendChild(group);
    });

    // Events that aren't part of a main event.
    var list = $("event-list");
    list.innerHTML = "";
    standalone.forEach(function (event) { list.appendChild(E.eventItem(event)); });
    $("standalone-heading").hidden = !(mains.length && standalone.length);
  }

  if (!window.SevakNav.guard()) return;
  O.renderHeader($("org-context"), O.current());
  O.renderSwitcher($("org-switcher"), { switchTo: "events.html" });
  $("show-inactive").addEventListener("change", renderEvents);
  renderEvents();
})();
