// Events from Zeffy (EVT-20), when the app runs on Sevak's server:
//   - Manage → Events: "From Zeffy" connects the organization (an Admin
//     pastes its Zeffy API key) and lists its Zeffy events to start from.
//   - An event started from Zeffy: "Refresh from Zeffy" shows what changed
//     there (title, description, dates) and fills it in, to save as usual.
// The key stays on the server; this page never sees it again.
(function () {
  "use strict";

  var server = window.SevakServer;
  if (!server || !server.user) return; // the prototype on its own has no Zeffy
  var $ = function (id) { return document.getElementById(id); };
  var EVENTS_KEY = "sevak.events.v1";
  var browserZone = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } })();

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(text, cls, onClick) {
    var b = el("button", "btn btn-small " + (cls || "btn-secondary"), text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data || {} }; });
    }, function () { return { status: 0, data: {} }; });
  }

  var MESSAGES = {
    bad_key: "Zeffy didn't accept that key. Check you copied all of it, from Settings → Integrations → API in Zeffy.",
    not_connected: "This organization isn't connected to Zeffy.",
    not_found: "That event isn't on Zeffy any more, or it isn't an event.",
    unavailable: "Couldn't reach Zeffy just now. Try again in a minute.",
    rate_limited: "That's a lot of requests to Zeffy. Wait a few minutes, then try again.",
    not_set_up: "Zeffy import isn't set up on this Sevak yet.",
    too_many: "This organization has as many events as Sevak allows.",
    forbidden: "Only the organization's team can do that."
  };
  function problem(res) { return MESSAGES[res.data.error] || "Something went wrong. Try again."; }

  function day(d) { return d && window.SevakEvents ? window.SevakEvents.dayLabel(d, { year: "numeric" }) : d || ""; }

  // ---------- Manage → Events ----------

  function eventsPage() {
    var open = $("zeffy-open");
    var panel = $("zeffy-panel");
    var org = window.SevakOrgs && window.SevakOrgs.current();
    if (!open || !panel || !org) return;
    var base = "/api/v1/organizations/" + encodeURIComponent(org.id) + "/zeffy";
    open.hidden = false;

    function status(text) {
      var p = el("p", "status", text);
      p.setAttribute("role", "status");
      return p;
    }

    function show(nodes) {
      panel.textContent = "";
      var head = el("div", "section-head");
      head.appendChild(el("h3", "list-heading", "Start an event from Zeffy"));
      head.appendChild(button("Close", "btn-secondary", function () { panel.hidden = true; open.setAttribute("aria-expanded", "false"); open.focus(); }));
      panel.appendChild(head);
      nodes.forEach(function (n) { panel.appendChild(n); });
    }

    function connectForm(state) {
      var intro = el("p", null, "Connect " + (org.name || "your organization") + "'s Zeffy account, then pick a Zeffy event to start from. Sevak copies its title, description, dates and link; you add the place, roles and shifts.");
      if (!state.canConnect) return [intro, el("p", null, "Ask an Admin of " + (org.name || "the organization") + " to connect Zeffy.")];
      var field = el("div", "field");
      var label = el("label", null, "Zeffy API key");
      label.htmlFor = "zeffy-key";
      var input = el("input");
      input.id = "zeffy-key";
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-describedby", "zeffy-key-hint");
      var hint = el("p", "hint", "In Zeffy, open Settings → Integrations → API and create a key. Sevak keeps it encrypted, only uses it to read your events, and never shows it again.");
      hint.id = "zeffy-key-hint";
      field.appendChild(label);
      field.appendChild(input);
      field.appendChild(hint);
      var msg = status("");
      var go = button("Connect Zeffy", "btn-primary", function () {
        var key = input.value.trim();
        if (!key) { msg.textContent = "Paste your Zeffy API key."; input.focus(); return; }
        go.disabled = true;
        msg.textContent = "Checking the key with Zeffy…";
        api("PUT", base, { apiKey: key }).then(function (res) {
          go.disabled = false;
          if (res.status !== 200) { msg.textContent = problem(res); input.focus(); return; }
          input.value = "";
          listEvents(res.data);
        });
      });
      var row = el("p", "fill-row");
      row.appendChild(go);
      return [intro, field, row, msg];
    }

    function listEvents(state) {
      var line = el("p", "hint", "Connected to Zeffy (key ending " + state.last4 + ").");
      if (state.canConnect) {
        line.appendChild(document.createTextNode(" "));
        var off = button("Disconnect", "btn-secondary", function () {
          if (!window.confirm("Disconnect Zeffy? Sevak forgets the key. Events you imported stay.")) return;
          api("DELETE", base).then(function (res) { if (res.status === 200) load(); });
        });
        line.appendChild(off);
      }
      var msg = status("Loading your Zeffy events…");
      show([line, msg]);
      api("GET", base + "/events?tz=" + encodeURIComponent(browserZone)).then(function (res) {
        if (res.status !== 200) { msg.textContent = problem(res); return; }
        var events = res.data.events || [];
        msg.textContent = events.length ? "" : "No events on Zeffy yet. Donation forms aren't listed; only events with tickets.";
        var list = el("ul", "event-list");
        events.forEach(function (ev) {
          var li = el("li", "event-item");
          var info = el("div");
          info.appendChild(el("h4", null, ev.title || "Untitled event"));
          var when = ev.startDate ? day(ev.startDate) + (ev.endDate && ev.endDate !== ev.startDate ? " – " + day(ev.endDate) : "") : "No date yet";
          info.appendChild(el("p", "event-meta", when + (ev.dates > 1 ? " · " + ev.dates + " dates" : "")));
          li.appendChild(info);
          var actions = el("div", "fill-row");
          if (ev.importedAs) {
            var a = el("a", "btn btn-secondary btn-small", "Open in Sevak");
            a.href = "event.html?id=" + encodeURIComponent(ev.importedAs);
            actions.appendChild(a);
          } else {
            var b = button("Start from this", "btn-primary", function () {
              b.disabled = true;
              msg.textContent = "Copying " + (ev.title || "the event") + " from Zeffy…";
              api("POST", base + "/events", { campaignId: ev.id, timezone: browserZone }).then(function (r) {
                if (r.status !== 200) { b.disabled = false; msg.textContent = problem(r); return; }
                server.replace(EVENTS_KEY, r.data[EVENTS_KEY]);
                location.href = "event.html?id=" + encodeURIComponent(r.data.eventId) + "&from=zeffy";
              });
            });
            b.setAttribute("aria-label", "Start a Sevak event from " + (ev.title || "this Zeffy event"));
            actions.appendChild(b);
          }
          li.appendChild(actions);
          list.appendChild(li);
        });
        panel.appendChild(list);
      });
    }

    function load() {
      show([status("Checking Zeffy…")]);
      api("GET", base).then(function (res) {
        if (res.status !== 200) { show([status(problem(res))]); return; }
        if (!res.data.available) { show([el("p", null, MESSAGES.not_set_up)]); return; }
        if (res.data.connected) listEvents(res.data);
        else show(connectForm(res.data));
      });
    }

    open.addEventListener("click", function () {
      var opening = panel.hidden;
      panel.hidden = !opening;
      open.setAttribute("aria-expanded", String(opening));
      if (opening) {
        load();
        panel.setAttribute("tabindex", "-1");
        panel.focus();
      }
    });
  }

  // ---------- An event started from Zeffy ----------

  function eventPage() {
    var box = $("zeffy-source");
    if (!box || !window.SevakEvents) return;
    var id = new URLSearchParams(location.search).get("id");
    var event = id && window.SevakEvents.get(id);
    var source = event && event.source;
    if (!source || source.kind !== "zeffy" || !source.id) return;
    var base = "/api/v1/organizations/" + encodeURIComponent(event.organizationId) + "/zeffy/events/" + encodeURIComponent(source.id);

    var intro = el("p");
    intro.appendChild(el("strong", null, "Started from a Zeffy event. "));
    intro.appendChild(document.createTextNode(new URLSearchParams(location.search).get("from") === "zeffy"
      ? "Its title, description, dates and link are filled in. Add where it is, check the time zone, then add roles and shifts for volunteers."
      : "Refresh to bring in changes made on Zeffy. Roles, shifts and sign-ups stay as they are."));
    box.appendChild(intro);
    var row = el("p", "fill-row");
    if (source.url) {
      var link = el("a", null, "View it on Zeffy ↗");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.appendChild(link);
    }
    var msg = el("p", "status");
    msg.setAttribute("role", "status");
    var changes = el("div");
    var refresh = button("Refresh from Zeffy", "btn-secondary", function () {
      refresh.disabled = true;
      changes.textContent = "";
      msg.textContent = "Checking Zeffy…";
      var tz = ($("timezone") && $("timezone").value) || event.timezone || browserZone;
      api("GET", base + "?tz=" + encodeURIComponent(tz)).then(function (res) {
        refresh.disabled = false;
        if (res.status !== 200) { msg.textContent = res.data.gone ? "This event isn't on Zeffy any more (or it was archived)." : problem(res); return; }
        showChanges(res.data.fields || {});
      });
    });
    row.appendChild(refresh);
    box.appendChild(row);
    box.appendChild(msg);
    box.appendChild(changes);
    box.hidden = false;

    var FIELDS = [["title", "Title"], ["description", "Description"], ["startDate", "Starts"], ["endDate", "Ends"]];
    function showChanges(fields) {
      var diff = FIELDS.filter(function (f) { return fields[f[0]] != null && $(f[0]) && $(f[0]).value.trim() !== String(fields[f[0]]).trim(); });
      if (!diff.length) { msg.textContent = "Up to date with Zeffy."; return; }
      msg.textContent = "";
      changes.appendChild(el("p", null, "Changed on Zeffy:"));
      var list = el("ul", "zeffy-changes");
      diff.forEach(function (f) {
        var now = String(fields[f[0]]);
        var shown = f[0] === "description" ? (now.length > 140 ? now.slice(0, 139) + "…" : now) : f[0].indexOf("Date") > 0 ? day(now) : now;
        list.appendChild(el("li", null, f[1] + ": " + (shown || "(empty)")));
      });
      changes.appendChild(list);
      changes.appendChild(el("p", "fill-row")).appendChild(button("Use these", "btn-primary", function () {
        diff.forEach(function (f) {
          var input = $(f[0]);
          input.value = String(fields[f[0]]);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        changes.textContent = "";
        var outside = document.querySelectorAll('.shift-row [data-key="date"] option:checked');
        var stray = Array.prototype.some.call(outside, function (o) { return /outside event dates/.test(o.textContent); });
        msg.textContent = "Filled in from Zeffy. Save to keep the changes." + (stray ? " Some shifts are now outside the event's dates; check them." : "");
      }));
    }
  }

  document.addEventListener("DOMContentLoaded", function () { eventsPage(); eventPage(); });
})();
