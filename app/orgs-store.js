// Organizations for the prototype, kept in this browser. A person can run
// several organizations; one of them is "current" and the Organization and
// Events tabs show that one. Events and main events record their
// organization in organizationId.
//
// When signed in, you only see the organizations whose team you're on (see
// roleFor). When signed out, every organization is shown, so reviewers can
// preview the pages.
(function () {
  "use strict";

  var LIST_KEY = "sevak.organizations.v1";
  var CURRENT_KEY = "sevak.currentOrganization.v1";
  var LEGACY_KEY = "sevak.organization.v1";
  var EVENTS_KEY = "sevak.events.v1";
  var MAIN_KEY = "sevak.mainEvents.v1";
  var DOCS_KEY = "sevak.documents.v1";
  var PROFILE_KEY = "sevak.profile.v1";

  var F = window.SevakForms;

  function newId() {
    return "org-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function all() {
    var list = F.load(LIST_KEY);
    return Array.isArray(list) ? list : [];
  }

  function get(id) {
    return all().filter(function (o) { return o.id === id; })[0] || null;
  }

  // The organizations you can manage: those whose team you're on, or all of
  // them when you're signed out (a reviewer's preview).
  function accessible() {
    if (!F.session.signedIn()) return all();
    return all().filter(function (o) { return !!roleFor(o); });
  }

  function currentId() {
    var list = accessible();
    var id = F.load(CURRENT_KEY);
    if (id && list.some(function (o) { return o.id === id; })) return id;
    return list[0] ? list[0].id : null;
  }

  function current() {
    var id = currentId();
    return id ? get(id) : null;
  }

  function setCurrent(id) {
    return F.store(CURRENT_KEY, id);
  }

  // Saves an organization, giving it an id if it's new. Returns the saved
  // organization, or null if the browser wouldn't store it.
  function save(org) {
    var list = all();
    var saved = Object.assign({}, org, { id: org.id || newId() });
    var i = list.findIndex(function (o) { return o.id === saved.id; });
    // Remember who created it: the creator is an Admin (see roleFor).
    var creator = i === -1 ? (profileEmail() || undefined) : list[i].createdBy;
    if (!saved.createdBy && creator) saved.createdBy = creator;
    if (i === -1) list.push(saved); else list[i] = saved;
    return F.store(LIST_KEY, list) ? saved : null;
  }

  // ---------- Roles ----------
  // "You" are the person in My profile. You're on an organization's team
  // when its Team tab lists your email (as Admin or Coordinator), you are
  // its primary contact (Admin), or you created it (Admin). Nobody can add
  // themselves: an Admin adds you, or you create a new organization. With
  // Sevak's server, being added emails you, and you're on the team as soon as
  // you sign in with that email, before your profile is saved.

  function profile() { return F.load(PROFILE_KEY) || {}; }

  function profileEmail() {
    return String((F.session.profile() || {}).email || "").trim().toLowerCase();
  }

  function same(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  // Returns "admin", "coordinator" or null: your role (the profile saved in
  // this browser) with roleFor, anyone's by email with roleOf.
  function roleFor(org) {
    return roleOf(org, profileEmail());
  }

  function roleOf(org, email) {
    if (!org) return null;
    var roles = [];
    if (email) {
      (org.team || []).forEach(function (m) { if (same(m.email, email)) roles.push(m.role || "coordinator"); });
      if (org.primaryContact && same(org.primaryContact.email, email)) roles.push("admin");
      if (same(org.createdBy, email)) roles.push("admin");
    }
    if (roles.indexOf("admin") !== -1) return "admin";
    return roles.length ? "coordinator" : null;
  }

  function isAdmin(org) { return roleFor(org) === "admin"; }

  // Your teams when signed in: [{ org, role }], sorted by name.
  function myTeams() {
    if (!F.session.signedIn()) return [];
    return accessible().map(function (o) { return { org: o, role: roleFor(o) }; })
      .sort(function (a, b) { return (a.org.name || "").localeCompare(b.org.name || ""); });
  }

  function adminEmails(org) {
    var list = (org.team || []).filter(function (m) { return m.role === "admin"; }).map(function (m) { return m.email; });
    if (org.primaryContact) list.push(org.primaryContact.email);
    list.push(org.createdBy);
    return list.map(function (e) { return String(e || "").trim().toLowerCase(); })
      .filter(function (e, i, a) { return e && a.indexOf(e) === i; });
  }

  // Takes you off an organization's team. Refused (with a reason) when you
  // are its primary contact or its only Admin, so it's never left without one.
  function leave(id) {
    var email = profileEmail();
    var list = all();
    var i = list.findIndex(function (o) { return o.id === id; });
    if (i === -1 || !email || !roleFor(list[i])) return { ok: false, reason: "not-member" };
    var org = list[i];
    if (org.primaryContact && same(org.primaryContact.email, email)) return { ok: false, reason: "primary-contact" };
    if (roleFor(org) === "admin" && !adminEmails(org).some(function (e) { return e !== email; })) return { ok: false, reason: "only-admin" };
    org = Object.assign({}, org, { team: (org.team || []).filter(function (m) { return !same(m.email, email); }) });
    if (same(org.createdBy, email)) delete org.createdBy;
    list[i] = org;
    return { ok: F.store(LIST_KEY, list) };
  }

  // Deletes an organization with its events and main events.
  function remove(id) {
    var keep = function (x) { return x.organizationId !== id; };
    // Its documents and its events' documents go too (files are cleared
    // from IndexedDB the next time a documents tab opens).
    var owners = ["org:" + id].concat((F.load(EVENTS_KEY) || []).filter(function (e) { return !keep(e); }).map(function (e) { return "event:" + e.id; }));
    F.store(DOCS_KEY, (F.load(DOCS_KEY) || []).filter(function (d) { return owners.indexOf(d.owner) === -1; }));
    F.store(EVENTS_KEY, (F.load(EVENTS_KEY) || []).filter(keep));
    F.store(MAIN_KEY, (F.load(MAIN_KEY) || []).filter(keep));
    F.store(LIST_KEY, all().filter(function (o) { return o.id !== id; }));
    var next = accessible()[0];
    if (next) setCurrent(next.id); else F.clear(CURRENT_KEY);
  }

  // Moves data saved before multiple organizations were supported: the
  // single organization becomes the first in the list, and events and main
  // events without an organization are given the current one.
  function migrate() {
    var legacy = F.load(LEGACY_KEY);
    if (legacy && typeof legacy === "object" && !all().length) {
      var org = save(legacy);
      if (org) setCurrent(org.id);
    }
    if (legacy) F.clear(LEGACY_KEY);
    migrateProfileOrganizations();
    var id = currentId();
    if (!id) return;
    [EVENTS_KEY, MAIN_KEY].forEach(function (key) {
      var list = F.load(key);
      if (!Array.isArray(list) || list.every(function (x) { return x.organizationId; })) return;
      F.store(key, list.map(function (x) { return x.organizationId ? x : Object.assign({}, x, { organizationId: id }); }));
    });
  }

  // My profile used to let you list organizations and pick your own role.
  // Those entries now go onto the organizations' Team tabs (so you keep the
  // access you had) and the list is removed from the profile.
  function migrateProfileOrganizations() {
    var p = profile();
    if (!p || !Array.isArray(p.organizations)) return;
    var email = profileEmail();
    if (email) {
      var list = all();
      var changed = false;
      p.organizations.forEach(function (row) {
        var org = list.filter(function (o) { return same(o.name, row.name); })[0];
        if (!org || (org.team || []).some(function (m) { return same(m.email, email); })) return;
        org.team = (org.team || []).concat([{ name: [p.firstName, p.lastName].filter(Boolean).join(" ") || email, email: p.email, role: row.role === "admin" ? "admin" : "coordinator" }]);
        changed = true;
      });
      if (changed) F.store(LIST_KEY, list);
    }
    delete p.organizations;
    F.store(PROFILE_KEY, p);
  }

  // Draws the organization switcher: a picker of the person's
  // organizations and a "+ New organization" link. Switching reloads the
  // page; confirmLeave() can return false to cancel (e.g. unsaved changes).
  function renderSwitcher(container, opts) {
    opts = opts || {};
    container.innerHTML = "";
    var orgs = accessible().slice().sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    var wrap = document.createElement("div");
    wrap.className = "org-switcher";

    if (orgs.length) {
      var label = document.createElement("label");
      label.htmlFor = "org-switch";
      label.textContent = "Organization";
      var select = document.createElement("select");
      select.id = "org-switch";
      orgs.forEach(function (o) {
        var option = document.createElement("option");
        option.value = o.id;
        option.textContent = o.name || "Untitled organization";
        select.appendChild(option);
      });
      if (opts.creating) {
        var draft = document.createElement("option");
        draft.value = "";
        draft.textContent = "New organization (unsaved)";
        select.appendChild(draft);
        select.value = "";
      } else {
        select.value = currentId() || "";
      }
      var previous = select.value;
      select.addEventListener("change", function () {
        if (opts.confirmLeave && !opts.confirmLeave()) { select.value = previous; return; }
        setCurrent(select.value);
        location.href = opts.switchTo || location.pathname;
      });
      wrap.appendChild(label);
      wrap.appendChild(select);
    }

    var add = document.createElement("a");
    add.className = "btn btn-secondary btn-small";
    add.href = (opts.newHref || "organization.html") + "?new=1";
    add.textContent = "+ New organization";
    add.hidden = !!opts.creating;
    add.addEventListener("click", function (e) {
      if (opts.confirmLeave && !opts.confirmLeave()) e.preventDefault();
    });
    wrap.appendChild(add);
    container.appendChild(wrap);
  }

  // ---------- Organization header ----------

  var CHARITY_LABELS = {
    "charity": "Registered charity or nonprofit",
    "nonprofit-other": "Nonprofit or tax-exempt",
    "pending": "Registration pending",
    "none": "Not registered"
  };

  function initials(name) {
    var words = name.replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);
    return ((words[0] || "")[0] || "").concat((words[1] || "")[0] || "").toUpperCase() || "?";
  }

  function countryName(code) {
    var c = F.countries.filter(function (x) { return x.code === code; })[0];
    return c ? c.name : "";
  }

  // Fills a <section class="org-context"> with the organization's header
  // card: initials, name, place, charity status, verification and links.
  function renderHeader(box, org) {
    box.hidden = !org;
    if (!org) return;
    box.innerHTML =
      '<span class="org-avatar" id="org-avatar" aria-hidden="true"></span>' +
      '<div class="org-context-text">' +
      '<p class="org-eyebrow">Organization</p>' +
      '<p class="org-name" id="org-context-name"></p>' +
      '<p class="org-details" id="org-context-details"></p>' +
      '</div>' +
      '<div class="org-context-side">' +
      '<div class="badges" id="org-context-badges"></div>' +
      '<div class="org-links">' +
      '<a id="org-context-website" target="_blank" rel="noopener noreferrer" hidden>Website ↗</a>' +
      '<a id="org-context-verify" href="organization.html" hidden>Get verified</a>' +
      '<a href="organization.html">Edit profile</a>' +
      '</div>' +
      '</div>';
    var $ = function (id) { return box.querySelector("#" + id); };
    var name = org.name || "Your organization";
    $("org-avatar").textContent = initials(name);
    $("org-context-name").textContent = name;
    var a = org.address || {};
    var place = [a.city, countryName(a.country)].filter(Boolean).join(", ");
    $("org-context-details").textContent = [place, CHARITY_LABELS[org.taxStatus] || ""].filter(Boolean).join(" · ");
    $("org-context-details").hidden = !$("org-context-details").textContent;

    var verified = org.verificationStatus === "verified";
    var pending = org.verificationStatus === "pending";
    var badge = document.createElement("span");
    badge.className = "badge " + (verified ? "badge-published" : "badge-draft");
    badge.textContent = verified ? "Verified" : pending ? "Verification pending" : "Not verified yet";
    if (!verified) badge.title = "Public events stay private until your organization is verified.";
    $("org-context-badges").appendChild(badge);
    // Admins: a way to ask for verification (on the Organization page).
    $("org-context-verify").hidden = verified || pending || (F.session.signedIn() && !isAdmin(org));

    var site = $("org-context-website");
    site.hidden = !org.website;
    if (org.website) site.href = org.website;
  }

  migrate();

  window.SevakOrgs = {
    all: all,
    get: get,
    current: current,
    currentId: currentId,
    setCurrent: setCurrent,
    save: save,
    remove: remove,
    renderSwitcher: renderSwitcher,
    renderHeader: renderHeader,
    roleFor: roleFor,
    roleOf: roleOf,
    isAdmin: isAdmin,
    accessible: accessible,
    myTeams: myTeams,
    leave: leave
  };
})();
