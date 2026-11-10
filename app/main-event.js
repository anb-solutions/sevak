// Main event editor (prototype). A main event, such as a festival, groups
// sub-events, such as the performance and its rehearsals.
(function () {
  "use strict";

  var F = window.SevakForms;
  var E = window.SevakEvents;
  var form = document.getElementById("main-form");
  var $ = function (id) { return document.getElementById(id); };

  var mainId = new URLSearchParams(location.search).get("id");
  var existing = mainId ? E.getMain(mainId) : null;
  var org = existing && existing.organizationId ? window.SevakOrgs.get(existing.organizationId) : window.SevakOrgs.current();
  // Only the organization's team can manage its events.
  if (!window.SevakNav.guard({ org: existing ? org : null })) return;
  if (org && existing) window.SevakOrgs.setCurrent(org.id);

  function messageFor(input) {
    return F.basicMessage(input);
  }

  function updateCounter() {
    $("description-counter").textContent = $("description").value.length + " / " + $("description").maxLength;
  }

  function renderSubEvents() {
    var list = $("sub-list");
    list.innerHTML = "";
    $("add-sub").hidden = !mainId;
    $("subs-hint").hidden = !!mainId;
    // Only Admins can delete.
    var isAdmin = window.SevakOrgs.isAdmin(org);
    $("delete-main").hidden = !mainId || !isAdmin;
    $("delete-hint").hidden = !mainId || isAdmin;
    if (!mainId) {
      $("subs-summary").textContent = "";
      return;
    }
    $("add-sub").href = "event.html?main=" + encodeURIComponent(mainId);
    var allSubs = E.subEvents(mainId);
    // Inactive sub-events are hidden unless asked for.
    var inactive = allSubs.filter(function (e) { return !E.isActive(e); }).length;
    $("show-inactive-wrap").hidden = !inactive;
    $("inactive-count").textContent = inactive;
    var showInactive = inactive > 0 && $("show-inactive").checked;
    var subs = allSubs.filter(function (e) { return showInactive || E.isActive(e); });
    subs.forEach(function (event) { list.appendChild(E.eventItem(event)); });
    if (!allSubs.length) {
      $("subs-summary").textContent = "No sub-events yet. Add the first one, for example a rehearsal or the main performance.";
      return;
    }
    var activeSubs = allSubs.filter(E.isActive);
    var range = E.mainRange(mainId);
    var published = activeSubs.filter(function (e) { return e.status === "published"; }).length;
    $("subs-summary").textContent = [
      E.plural(activeSubs.length, "active sub-event"),
      range.start ? E.rangeLabel(range.start, range.end) : "",
      published + " published",
      inactive ? inactive + " inactive" : ""
    ].filter(Boolean).join(" · ");
  }

  function applyTitle() {
    var title = $("title").value.trim();
    $("page-title").textContent = mainId ? title || "Untitled main event" : "New main event";
    document.title = (mainId ? title || "Main event" : "New main event") + " · Sevak";
  }

  F.clearErrorsAsYouType(form, messageFor);
  $("description").addEventListener("input", updateCounter);
  $("title").addEventListener("input", applyTitle);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var firstInvalid = F.validate([$("title")], messageFor);
    if (firstInvalid) {
      $("status").textContent = "";
      firstInvalid.focus();
      return;
    }
    var now = new Date().toISOString();
    var main = {
      id: mainId || E.newId("main"),
      organizationId: org.id,
      organizationName: org.name || "",
      title: $("title").value.trim(),
      description: $("description").value.trim(),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    if (!E.saveMain(main)) {
      $("status").textContent = "Couldn't save in this browser. Check that site storage is allowed.";
      return;
    }
    // Saved: back to the Events list, which says so and highlights it.
    var isNew = !mainId;
    var id = window.CSS && CSS.escape ? CSS.escape(main.id) : main.id;
    window.SevakNav.flashAndGo("events.html",
      "Saved the main event “" + main.title + "”." + (isNew ? " Add its sub-events with + Sub-event." : ""), {
        href: "main-event.html?id=" + encodeURIComponent(main.id),
        linkText: "Open it again",
        highlight: '[data-main-id="' + id + '"]'
      });
  });

  $("delete-main").addEventListener("click", function () {
    if (!window.SevakOrgs.isAdmin(org)) { renderSubEvents(); return; }
    var count = E.subEvents(mainId).length;
    var message = count
      ? "Delete this main event? Its " + E.plural(count, "sub-event") + " will be kept as separate events."
      : "Delete this main event? This can't be undone.";
    if (!window.confirm(message)) return;
    E.removeMain(mainId);
    location.href = "events.html";
  });

  // ---------- Start ----------

  if (!org || !org.name) {
    $("no-org").hidden = false;
    form.hidden = true;
    $("back-link").hidden = true;
    return;
  }
  $("org-name-crumb").textContent = "Events";
  window.SevakOrgs.renderHeader($("org-context"), org);

  if (mainId && !existing) {
    $("status").textContent = "We couldn't find that main event, so this is a new one.";
    mainId = null;
    history.replaceState(null, "", location.pathname);
  }
  if (existing) {
    $("title").value = existing.title || "";
    $("description").value = existing.description || "";
  }
  updateCounter();
  applyTitle();
  renderSubEvents();
  $("show-inactive").addEventListener("change", renderSubEvents);
})();
