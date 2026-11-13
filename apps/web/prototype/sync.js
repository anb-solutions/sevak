// Connects the prototype's pages to Sevak's server. The pages keep their
// data in browser storage (localStorage); this script, which the web app
// adds to the top of every page (scripts/copy-prototype.mjs), makes some of
// those keys live on the server instead:
//
//   1. Before the page's own scripts run, it loads who you are and the
//      saved data from GET /api/v1/sync into browser storage.
//   2. When a page saves one of those keys, it sends the change to the
//      server first (POST /api/v1/sync/<key>). If the server refuses or
//      can't be reached, the save fails the way a full browser storage
//      would, and the page keeps what the server has.
//
// The server decides who may see and change what (packages/core/src/records.ts).
// Requests are synchronous on purpose: pages often save and then move to
// another page straight away, and the save has to finish first. The plain
// prototype (opened without the web app) never loads this file.
(function () {
  "use strict";

  var SYNCED = {
    "sevak.profile.v1": "object",
    "sevak.organizations.v1": "list",
    "sevak.memberships.v1": "list",
    "sevak.events.v1": "list",
    "sevak.mainEvents.v1": "list",
    "sevak.signups.v1": "list",
    "sevak.certificates.v1": "list",
    "sevak.signatures.v1": "object",
    "sevak.documents.v1": "list"
  };
  var SIGNED_OUT_KEY = "sevak.signedOut.v1";
  var PRIVATE_PAGES = {
    "events.html": true, "event.html": true, "main-event.html": true, "volunteers.html": true,
    "dashboard.html": true, "organization.html": true, "review.html": true, "outbox.html": true,
    "roster.html": true
  };

  var storage = window.localStorage;
  var proto = Object.getPrototypeOf(storage);
  var getItem = proto.getItem;
  var setItem = proto.setItem;
  var removeItem = proto.removeItem;

  function request(method, url, body) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, false);
      xhr.setRequestHeader("Accept", "application/json");
      if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body === undefined ? null : JSON.stringify(body));
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      return { status: xhr.status, data: data };
    } catch (e) {
      return { status: 0, data: null };
    }
  }

  function parse(text) {
    try { return text == null ? null : JSON.parse(text); } catch (e) { return null; }
  }

  // Same content, whatever order its keys are in.
  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort()
        .map(function (k) { return JSON.stringify(k) + ":" + stable(value[k]); }).join(",") + "}";
    }
    return JSON.stringify(value);
  }

  // The pages' demo data stays in this browser (see demo-data.js).
  // Anything belonging to demo data: its own id, or its organization's or
  // event's, starts with "demo-", or it's a dashboard sample.
  function isDemo(item) {
    if (!item) return false;
    if (item.sample) return true;
    if (/:demo-/.test(String(item.owner || ""))) return true;
    return [item.id, item.orgId, item.organizationId, item.eventId].some(function (v) {
      return String(v || "").indexOf("demo-") === 0;
    });
  }

  var REFUSED = {
    full: "Sorry, that shift just filled up. Please choose another.",
    already: "You're already signed up for that shift.",
    not_member: "Join the organization first, then you can sign up for its shifts.",
    hours_mismatch: "That certificate's hours don't match the approved hours on record. Reload the page and try again.",
    too_many: "That's more than Sevak allows for one person or organization. Contact Sevak if you need more.",
    already_asked: "That has already been asked for. Reload the page to see where it stands.",
    own_hours: "Nobody approves their own hours. An Admin's hours need a different Admin.",
    own_certificate: "Nobody issues their own certificate. An Admin's certificate needs a different Admin.",
    lead_not_member: "A task lead must be a member of the organization or on its team."
  };

  function put(key, value) {
    if (value === null || value === undefined) removeItem.call(storage, key);
    else setItem.call(storage, key, JSON.stringify(value));
  }

  // ---------- A short message at the bottom of the page ----------

  function notice(text) {
    var show = function () {
      var box = document.getElementById("sevak-sync-notice");
      if (!box) {
        box = document.createElement("p");
        box.id = "sevak-sync-notice";
        box.setAttribute("role", "status");
        box.style.cssText = "position:fixed;left:16px;right:16px;bottom:calc(88px + env(safe-area-inset-bottom));margin:0 auto;max-width:480px;z-index:1000;" +
          "padding:12px 16px;border-radius:10px;background:#17201e;color:#fff;font:15px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)";
        document.body.appendChild(box);
      }
      box.textContent = text;
      clearTimeout(box.hideTimer);
      box.hideTimer = setTimeout(function () { box.remove(); }, 6000);
    };
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  }

  // ---------- Whose browser data this is ----------
  // Everything Sevak keeps in this browser belongs to the person signed in.
  // When they sign out, or someone else signs in on the same device, it's
  // all cleared, including uploaded files, except a few display settings.

  var OWNER_KEY = "sevak.owner.v1";
  var KEEP = { "sevak.bannerDismissed.v1": true, "sevak.opportunityFilter.v1": true, "sevak.joinIntent.v1": true };

  function clearBrowserData() {
    for (var i = storage.length - 1; i >= 0; i--) {
      var k = storage.key(i);
      if (k && k.indexOf("sevak.") === 0 && !KEEP[k]) removeItem.call(storage, k);
    }
    try { if (window.indexedDB) window.indexedDB.deleteDatabase("sevak-files"); } catch (e) { /* not available */ }
  }

  function claimBrowser(email) {
    var owner = getItem.call(storage, OWNER_KEY) || "";
    if (owner !== (email || "")) {
      clearBrowserData();
      if (email) setItem.call(storage, OWNER_KEY, email);
    }
  }

  // ---------- 1. Load ----------

  var loaded = request("GET", "/api/v1/sync");
  var server = { user: null, offline: loaded.status !== 200 };
  window.SevakServer = server;

  if (!server.offline && loaded.data) {
    server.user = loaded.data.user;
    server.signIn = loaded.data.signIn || {};
    server.features = loaded.data.features || {};
    server.env = loaded.data.env || "staging";
    claimBrowser(server.user && server.user.email);
    Object.keys(SYNCED).forEach(function (key) {
      var value = loaded.data.data[key];
      if (SYNCED[key] === "list") {
        var demo = (parse(getItem.call(storage, key)) || []).filter(isDemo);
        value = (value || []).concat(demo);
      }
      put(key, value);
    });
    // The pages' own "signed out" switch follows the server's session.
    if (server.user) removeItem.call(storage, SIGNED_OUT_KEY);
    else setItem.call(storage, SIGNED_OUT_KEY, "true");
    // Pages for running organizations, and Sevak's own, need you signed in:
    // straight to sign-in (and back here afterwards) instead of a preview.
    var here = location.pathname.split("/").pop();
    if (!server.user && PRIVATE_PAGES[here]) {
      // Back to this page afterwards, with its one parameter (roster.html?event=…).
      var back = here + (/^\?[a-z]+=[A-Za-z0-9_-]{1,80}$/.test(location.search) ? location.search : "");
      location.replace("signin.html?next=" + encodeURIComponent(back));
    }
  } else {
    notice("Can't reach Sevak right now. Changes won't be saved until it's back. Try reloading in a minute.");
  }

  // ---------- 2. Save ----------

  // Sends one page save to the server, then keeps what the server has.
  // Throws (so the page's save reports failure) if nothing was saved.
  function save(key, text) {
    var kind = SYNCED[key];
    var next = parse(text);
    if (!server.user) {
      notice(server.offline ? "Can't reach Sevak right now, so this wasn't saved." : "Sign in to save this.");
      throw new Error("Not signed in");
    }
    var body;
    var localDemo = [];
    if (kind === "object") {
      body = { value: next };
    } else {
      var before = (parse(getItem.call(storage, key)) || []).filter(function (x) { return !isDemo(x); });
      var after = Array.isArray(next) ? next : [];
      localDemo = after.filter(isDemo);
      after = after.filter(function (x) { return !isDemo(x); });
      var old = {};
      before.forEach(function (x) { if (x && x.id) old[x.id] = stable(x); });
      var kept = {};
      var upsert = after.filter(function (x) {
        if (!x || !x.id) return false;
        kept[x.id] = true;
        return old[x.id] !== stable(x);
      });
      var remove = Object.keys(old).filter(function (id) { return !kept[id]; });
      if (!upsert.length && !remove.length) {
        // Nothing for the server: only demo data or order changed.
        setItem.call(storage, key, text);
        return;
      }
      body = { upsert: upsert, delete: remove };
    }

    var res = request("POST", "/api/v1/sync/" + encodeURIComponent(key), body);
    if (res.status === 200 || res.status === 403) {
      var value = res.data && "value" in res.data ? res.data.value : null;
      put(key, kind === "list" ? (value || []).concat(localDemo) : value);
      if (res.status === 403) {
        notice(REFUSED[res.data && res.data.reason] || "Some of that wasn't saved: only the organization's team can change it.");
        throw new Error("Refused");
      }
      return;
    }
    if (res.status === 401) {
      server.user = null;
      setItem.call(storage, SIGNED_OUT_KEY, "true");
      notice("You've been signed out. Sign in again to save.");
    } else if (res.status === 413) {
      notice("That's too big to save. Try a smaller photo or file.");
    } else if (res.status === 429) {
      notice("That's a lot of saving in a short time. Wait a few minutes, then try again.");
    } else {
      notice("Couldn't save to Sevak just now. Check your connection and try again.");
    }
    throw new Error("Not saved");
  }

  // For pages that call the API directly (members-store.js): a request, and
  // a way to store what the server answered without sending it back.
  server.call = function (method, url, body) { return request(method, url, body); };
  server.replace = function (key, value) {
    var demo = SYNCED[key] === "list" ? (parse(getItem.call(storage, key)) || []).filter(isDemo) : [];
    put(key, SYNCED[key] === "list" ? (value || []).concat(demo) : value);
  };

  function signOut() {
    request("POST", "/api/v1/auth/signout", {});
    server.user = null;
    claimBrowser("");
  }

  proto.setItem = function (key, value) {
    if (this === storage) {
      key = String(key);
      value = String(value);
      if (SYNCED[key]) return save(key, value);
      if (key === SIGNED_OUT_KEY && value === "true" && server.user) signOut();
    }
    return setItem.call(this, key, value);
  };

  proto.removeItem = function (key) {
    if (this === storage && SYNCED[String(key)]) {
      return save(String(key), SYNCED[String(key)] === "list" ? "[]" : "null");
    }
    return removeItem.call(this, key);
  };
})();
