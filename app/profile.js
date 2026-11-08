// User profile (prototype). Data is kept in this browser, or on Sevak's
// server when the web app serves this page (window.SevakServer, sync.js).
// A person can volunteer, be on one or more organizations' teams, or both.
// Teams aren't chosen here: you're on a team when you set up an
// organization or one of its Admins adds you (see SevakOrgs.roleFor).
(function () {
  "use strict";

  var STORAGE_KEY = "sevak.profile.v1";
  var MAX_AFFILIATIONS = 5;
  var SEEN_TEAMS_KEY = "sevak.seenTeams.v1";

  var form = document.getElementById("profile-form");
  var $ = function (id) { return document.getElementById(id); };
  var F = window.SevakForms;
  var server = window.SevakServer;

  // With the server, you sign in (by email code) before making a profile,
  // and the profile's email is the one you signed in with.
  if (server && !server.offline && !server.user) {
    location.replace("signin.html?next=profile.html");
    return;
  }
  var SAVED_WHERE = server ? "" : " on this device";

  // ---------- User types ----------

  function isVolunteer() { return $("role-volunteer").checked; }

  function applyRoles() {
    $("volunteer-fields").hidden = !isVolunteer();
    // Affiliations (on the Get to know me tab) are for volunteers.
    $("affiliations-section").hidden = !isVolunteer();
    $("affiliations-note").hidden = isVolunteer();
  }

  form.querySelectorAll('input[name="roles"]').forEach(function (box) {
    box.addEventListener("change", function () {
      applyRoles();
    });
  });

  // ---------- Validation ----------

  function messageFor(input) {
    if (input.name === "roles") return "";
    return F.basicMessage(input);
  }

  function validateForm() {
    var fields = form.querySelectorAll("#role-volunteer, input[required], input[type=tel], input[type=email], [data-postal]");
    return F.validate(fields, messageFor);
  }

  // ---------- Repeating rows ----------

  var rowCounter = 0;

  // Clones a row template, gives each control a unique id wired to its label
  // and error message, and fills in saved values.
  function makeRow(template, prefix, value) {
    var row = template.content.firstElementChild.cloneNode(true);
    rowCounter += 1;
    row.querySelectorAll(".field").forEach(function (field) {
      var control = field.querySelector("[data-key]");
      control.id = prefix + "-" + control.dataset.key + "-" + rowCounter;
      field.querySelector("label").htmlFor = control.id;
      var error = field.querySelector(".error");
      if (error) error.id = control.id + "-error";
      if (value && value[control.dataset.key] != null) control.value = value[control.dataset.key];
    });
    return row;
  }

  function readRows(container) {
    return Array.prototype.map.call(container.children, function (row) {
      var data = {};
      row.querySelectorAll("[data-key]").forEach(function (el) { data[el.dataset.key] = el.value.trim(); });
      return data;
    }).filter(function (d) { return d.name; });
  }

  // ---------- Organization teams ----------
  // A read-only list of the teams you're on, each with Manage and Leave.

  function renderTeams() {
    var O = window.SevakOrgs;
    var profile = F.session.profile();
    var teams = O.myTeams();
    var list = $("team-list");
    list.innerHTML = "";
    teams.forEach(function (t) {
      var li = document.createElement("li");
      li.className = "team-item";
      var name = document.createElement("strong");
      name.textContent = t.org.name || "Untitled organization";
      var badge = document.createElement("span");
      badge.className = "badge" + (t.role === "admin" ? " badge-published" : "");
      badge.textContent = t.role === "admin" ? "Admin" : "Coordinator";
      var manage = document.createElement("a");
      manage.href = "events.html";
      manage.textContent = "Manage";
      manage.setAttribute("aria-label", "Manage " + (t.org.name || "this organization"));
      manage.addEventListener("click", function () { O.setCurrent(t.org.id); });
      var leave = document.createElement("button");
      leave.type = "button";
      leave.className = "btn btn-danger-link";
      leave.textContent = "Leave";
      leave.setAttribute("aria-label", "Leave the team of " + (t.org.name || "this organization"));
      leave.addEventListener("click", function () { leaveTeam(t.org); });
      [name, badge, manage, leave].forEach(function (x) { li.appendChild(x); });
      list.appendChild(li);
    });
    list.hidden = !teams.length;
    $("team-empty").hidden = teams.length > 0;
    $("join-email").textContent = profile ? profile.email : "your email";
    // Setting up an organization needs a saved profile: you become its Admin.
    var row = $("setup-org-row");
    if (profile && F.session.signedIn()) {
      row.innerHTML = '<strong>Run volunteer events for a group?</strong> <a href="organization.html?new=1" id="setup-org">Set up your organization</a> and you\'ll be its Admin.';
    } else {
      row.innerHTML = "<strong>Run volunteer events for a group?</strong> Save your profile first, then you can set up your organization and be its Admin.";
    }
  }

  // ---------- Joining (see join.js) ----------
  // New people arrive from the Join page with their choice: an invitation, a
  // request to join an organization, or setting up a new one. Saving the
  // profile completes it.

  var INTENT_KEY = "sevak.joinIntent.v1";
  var M = window.SevakMembers;

  function intent() {
    var i = F.load(INTENT_KEY);
    return i && i.way ? i : null;
  }

  function noticeLink(href, text) {
    var a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    return a;
  }

  function showJoinNotice(parts) {
    var box = $("join-notice");
    box.innerHTML = "";
    var p = document.createElement("p");
    parts.forEach(function (x) { p.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
    box.appendChild(p);
    box.hidden = false;
  }

  function renderJoinNotice() {
    var i = intent();
    var org = i && i.orgId ? window.SevakOrgs.get(i.orgId) : null;
    if (F.session.signedIn() && !i) { $("join-notice").hidden = true; return; }
    if (i && i.way === "create") {
      showJoinNotice(["Create your profile first. Then you'll set up your organization and be its Admin."]);
    } else if (i && org) {
      showJoinNotice([i.way === "invite" ? "You're joining " : "You're asking to join ", (function () { var b = document.createElement("strong"); b.textContent = org.name; return b; })(),
        ". Save your profile to " + (i.way === "invite" ? "accept the invitation." : "send your request."), " ", noticeLink("join.html", "Change")]);
    } else if (!F.load(STORAGE_KEY)) {
      showJoinNotice(["To volunteer on Sevak you need an invitation from an organization, or to ask one to have you. ", noticeLink("join.html", "Choose how you're joining"), "."]);
    } else {
      $("join-notice").hidden = true;
    }
  }

  // Returns true when it moved on to another page.
  function completeJoin() {
    var i = intent();
    if (!i) return false;
    F.clear(INTENT_KEY);
    if (i.way === "create") {
      location.href = "organization.html?new=1";
      return true;
    }
    var org = window.SevakOrgs.get(i.orgId);
    if (!org) return false;
    var rec = M.isMember(org.id) ? { status: "active" } : M.request(org.id, i.note, i.way === "invite", i.code);
    var next = i.returnTo || "signup.html#my-orgs";
    if (rec && rec.status === "active") {
      showJoinNotice(["Welcome! You're now a volunteer with " + org.name + ". ", noticeLink(next, i.returnTo ? "Back to the event" : "See its opportunities")]);
    } else {
      showJoinNotice(["Request sent to " + org.name + ". You can sign up for its events once they approve you. ", noticeLink("signup.html#all-orgs", "Browse opportunities")]);
    }
    renderTeams();
    renderVolunteerOrgs();
    renderSignature();
    renderAccount();
    window.SevakNav.render();
    window.scrollTo(0, 0);
    return false;
  }

  // Organizations you volunteer with, and requests waiting.
  function renderVolunteerOrgs() {
    var list = $("volunteer-list");
    list.innerHTML = "";
    var rows = F.session.signedIn() ? M.mine().filter(function (m) { return m.status !== "invited"; }) : [];
    var labels = { active: "Volunteer", requested: "Waiting for approval", declined: "Not approved" };
    rows.forEach(function (m) {
      var org = window.SevakOrgs.get(m.orgId);
      if (!org) return;
      var li = document.createElement("li");
      li.className = "team-item";
      var name = document.createElement("strong");
      name.textContent = org.name;
      var badge = document.createElement("span");
      badge.className = "badge" + (m.status === "active" ? " badge-published" : m.status === "requested" ? " badge-draft" : "");
      badge.textContent = labels[m.status] || m.status;
      li.appendChild(name);
      li.appendChild(badge);
      var act = document.createElement("button");
      act.type = "button";
      act.className = "btn btn-danger-link";
      act.textContent = m.status === "requested" ? "Withdraw" : m.status === "active" ? "Leave" : "Remove";
      act.setAttribute("aria-label", act.textContent + " " + org.name);
      act.addEventListener("click", function () {
        var q = m.status === "active" ? "Stop volunteering with " + org.name + "? You'll need a new invitation or approval to sign up for its events again."
          : m.status === "requested" ? "Withdraw your request to join " + org.name + "?" : "Remove " + org.name + " from this list?";
        if (!window.confirm(q)) return;
        M.withdraw(org.id);
        renderVolunteerOrgs();
        window.SevakNav.render();
        $("volunteer-status").textContent = m.status === "active" ? "You've left " + org.name + "." : "Done.";
      });
      li.appendChild(act);
      list.appendChild(li);
    });
    list.hidden = !list.children.length;
    $("volunteer-empty").hidden = !!list.children.length;
  }

  // Signed in as … · Sign out (Sign out lives here, on Profile).
  function renderAccount() {
    var on = F.session.signedIn();
    $("account-line").hidden = !on;
    if (on) $("account-email").textContent = F.session.profile().email;
    // Sevak staff: a way to the verification requests.
    if (on && server && server.user && server.user.isPlatformAdmin && !$("staff-line")) {
      var line = document.createElement("p");
      line.className = "account-line";
      line.id = "staff-line";
      var waiting = window.SevakVerify ? window.SevakVerify.queue().length : 0;
      line.appendChild(document.createTextNode("You're Sevak staff. "));
      var a = document.createElement("a");
      a.href = "review.html";
      a.textContent = "Review verification requests" + (waiting ? " (" + waiting + " waiting)" : "");
      line.appendChild(a);
      $("account-line").insertAdjacentElement("afterend", line);
    }
  }

  $("sign-out").addEventListener("click", function () {
    F.session.signOut();
    window.location.href = "../";
  });

  function leaveTeam(org) {
    var name = org.name || "this organization";
    if (!window.confirm("Leave the team of " + name + "? You won't be able to manage its events until an Admin adds you again.")) return;
    var result = window.SevakOrgs.leave(org.id);
    var messages = {
      "primary-contact": "You're the primary contact of " + name + ". Change its primary contact on the Organization page first.",
      "only-admin": "You're the only Admin of " + name + ". Make someone else an Admin on its Team tab first, or delete the organization."
    };
    if (!result.ok) {
      $("team-status").textContent = messages[result.reason] || "Couldn't leave the team. Please try again.";
      return;
    }
    // If an Admin adds you again later, you'll be told about it.
    var seen = F.load(SEEN_TEAMS_KEY);
    if (Array.isArray(seen)) F.store(SEEN_TEAMS_KEY, seen.filter(function (id) { return id !== org.id; }));
    renderTeams();
    renderSignature();
    window.SevakNav.render();
    $("team-status").textContent = "You've left the team of " + name + ".";
  }

  // ---------- Affiliations ----------

  var affiliationRows = $("affiliation-rows");

  function addAffiliation(value) {
    if (affiliationRows.children.length >= MAX_AFFILIATIONS) return null;
    var row = makeRow($("affiliation-template"), "affiliation", value);
    row.querySelector(".remove").addEventListener("click", function () {
      row.remove();
      updateAffiliationButton();
      $("add-affiliation").focus();
    });
    affiliationRows.appendChild(row);
    updateAffiliationButton();
    return row.querySelector('[data-key="name"]');
  }

  function updateAffiliationButton() {
    $("add-affiliation").hidden = affiliationRows.children.length >= MAX_AFFILIATIONS;
  }

  $("add-affiliation").addEventListener("click", function () {
    var input = addAffiliation();
    if (input) input.focus();
  });

  // ---------- About me ----------

  var ABOUT_FIELDS = ["aboutMe", "passion", "certifications", "howICanHelp"];

  function updateCounters() {
    ABOUT_FIELDS.forEach(function (id) {
      form.querySelector('[data-counter-for="' + id + '"]').textContent = $(id).value.length + " / " + $(id).maxLength;
    });
  }
  ABOUT_FIELDS.forEach(function (id) { $(id).addEventListener("input", updateCounters); });

  // ---------- Services ----------
  // A set of tick boxes: choose as many as apply.

  var serviceBoxes = form.querySelectorAll('input[name="services"]');

  function services() {
    return Array.prototype.filter.call(serviceBoxes, function (b) { return b.checked; }).map(function (b) { return b.value; });
  }

  function addService(value) {
    Array.prototype.forEach.call(serviceBoxes, function (b) { if (b.value === value) b.checked = true; });
  }

  function clearServices() {
    Array.prototype.forEach.call(serviceBoxes, function (b) { b.checked = false; });
  }

  function refreshServices() { /* nothing to update: the boxes show what's chosen */ }

  // ---------- Read / fill ----------

  function readForm() {
    var v = function (id) { return $(id).value.trim(); };
    var data = {
      firstName: v("firstName"),
      lastName: v("lastName"),
      email: v("email"),
      phone: F.phoneValue($("phone")),
      gender: $("gender").value,
      roles: { volunteer: isVolunteer(), host: window.SevakOrgs.myTeams().length > 0 },
      photo: photo.get(),
      aboutMe: v("aboutMe"),
      passion: v("passion"),
      certifications: v("certifications"),
      howICanHelp: v("howICanHelp"),
      services: services(),
      updatedAt: new Date().toISOString()
    };
    if (isVolunteer()) {
      var availability = form.querySelector('input[name="availability"]:checked');
      data.address = {
        country: $("country").value,
        line1: v("addressLine1"),
        line2: v("addressLine2"),
        city: v("city"),
        state: v("state"),
        postalCode: v("postalCode")
      };
      data.affiliations = readRows(affiliationRows);
      data.availability = availability ? availability.value : "";
    }
    return data;
  }

  function fill(data) {
    var set = function (id, value) { if (value != null) $(id).value = value; };
    set("firstName", data.firstName);
    set("lastName", data.lastName);
    set("email", data.email);
    F.setPhone($("phone"), data.phone);
    set("gender", data.gender);
    photo.set(data.photo || "");
    ABOUT_FIELDS.forEach(function (id) { set(id, data[id]); });
    (data.services || []).forEach(addService);
    // Profiles saved before user types existed were volunteer profiles.
    var roles = data.roles || { volunteer: true, host: false };
    $("role-volunteer").checked = !!roles.volunteer;
    if (data.address) {
      set("addressLine1", data.address.line1);
      set("addressLine2", data.address.line2);
      set("city", data.address.city);
      set("state", data.address.state);
      set("postalCode", data.address.postalCode || data.address.zip);
      if (data.address.country) $("country").value = data.address.country;
    }
    (data.affiliations || []).forEach(addAffiliation);
    if (data.availability) {
      var radio = form.querySelector('input[name="availability"][value="' + data.availability + '"]');
      if (radio) radio.checked = true;
    }
  }

  // ---------- Events ----------

  F.clearErrorsAsYouType(form, messageFor);

  // Marks the tabs that contain errors with a dot.
  function markTabErrors() {
    ["details", "about"].forEach(function (key) {
      var bad = !!$("panel-" + key).querySelector('[aria-invalid="true"]');
      $("tab-" + key).classList.toggle("has-error", bad);
      $("tab-" + key).querySelector(".tab-alert").textContent = bad ? " (needs attention)" : "";
    });
  }
  form.addEventListener("input", function () { setTimeout(markTabErrors, 0); });
  form.addEventListener("change", function () { setTimeout(markTabErrors, 0); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var firstInvalid = validateForm();
    markTabErrors();
    if (firstInvalid) {
      // Show the tab with the first problem.
      var panel = firstInvalid.closest('[role="tabpanel"]');
      if (panel && panel.classList.contains("is-hidden")) {
        var key = tabs.show(panel.id.replace(/^panel-/, ""));
        history.replaceState(null, "", location.search + "#" + key);
      }
      $("status").textContent = "Please check the highlighted fields.";
      firstInvalid.focus();
      return;
    }
    var stored = F.store(STORAGE_KEY, readForm());
    // Saving your profile signs you in (see SevakForms.session).
    if (stored) F.session.signIn();
    if (stored) {
      // Your documents follow your email if you change it.
      var nextOwner = window.SevakDocs.profileOwner(F.load(STORAGE_KEY).email);
      window.SevakDocs.moveOwner(docsOwner, nextOwner);
      if (nextOwner !== docsOwner) { docsOwner = nextOwner; docs.setOwner(docsOwner, DOCS_BLOCKED); }
    }
    $("status").textContent = stored
      ? "Profile saved" + SAVED_WHERE + "."
      : "Couldn't save in this browser. Check that site storage is allowed.";
    if (stored) {
      M.acceptInvites();
      if (completeJoin()) return;
    }
    renderTeams();
    renderVolunteerOrgs();
    renderSignature();
    renderAccount();
    window.SevakNav.render();
  });

  $("delete-profile").addEventListener("click", function () {
    var docCount = docsOwner ? window.SevakDocs.forOwner(docsOwner).length : 0;
    if (!window.confirm("Delete your profile" + (docCount ? " and your " + (docCount === 1 ? "document" : docCount + " documents") : "") +
      " from " + (server ? "Sevak" : "this device") + "? This can't be undone.")) return;
    F.clear(STORAGE_KEY);
    window.SevakDocs.removeFor(["profile", docsOwner].filter(Boolean)).then(function () {
      docsOwner = null;
      docs.setOwner(null, DOCS_BLOCKED);
    });
    form.reset();
    if (server && server.user) $("email").value = server.user.email;
    $("role-volunteer").checked = true;
    $("country").value = F.defaultCountry();
    F.resetPhone($("phone"));
    affiliationRows.innerHTML = "";
    clearServices();
    photo.set("");
    refreshServices();
    updateCounters();
    updateAffiliationButton();
    applyRoles();
    renderTeams();
    renderVolunteerOrgs();
    renderSignature();
    renderAccount();
    renderJoinNotice();
    window.SevakNav.render();
    $("status").textContent = "Profile deleted.";
  });

  // ---------- Signature for certificates (Admins) ----------

  var C = window.SevakCerts;
  var pad = $("sig-pad");
  var padCtx = pad.getContext("2d");
  var hasInk = false;

  function isAdminSomewhere() {
    return F.session.signedIn() && window.SevakOrgs.myTeams().some(function (t) { return t.role === "admin"; });
  }

  function renderSignature() {
    var on = !!C && isAdminSomewhere();
    $("signature-section").hidden = !on;
    if (!on) return;
    var mine = C.signature(F.session.profile().email) || {};
    $("sig-title").value = mine.title || "";
    $("sig-saved").hidden = !mine.image;
    $("sig-remove").hidden = !mine.image;
    if (mine.image) $("sig-saved-img").src = mine.image;
  }

  function padPoint(e) {
    var r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height };
  }

  var last = null;
  pad.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    last = padPoint(e);
    padCtx.beginPath();
    padCtx.arc(last.x, last.y, 1.4, 0, Math.PI * 2);
    padCtx.fillStyle = "#1f2a28";
    padCtx.fill();
    hasInk = true;
  });
  pad.addEventListener("pointermove", function (e) {
    if (!last) return;
    var p = padPoint(e);
    padCtx.strokeStyle = "#1f2a28";
    padCtx.lineWidth = 3;
    padCtx.lineCap = "round";
    padCtx.lineJoin = "round";
    padCtx.beginPath();
    padCtx.moveTo(last.x, last.y);
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
    last = p;
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { pad.addEventListener(t, function () { last = null; }); });

  // The drawing, cropped to the ink (transparent background).
  function trimmedSignature() {
    var w = pad.width, h = pad.height;
    var data = padCtx.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return "";
    var padPx = 6;
    minX = Math.max(0, minX - padPx); minY = Math.max(0, minY - padPx);
    maxX = Math.min(w - 1, maxX + padPx); maxY = Math.min(h - 1, maxY + padPx);
    var out = document.createElement("canvas");
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(pad, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  function clearPad() { padCtx.clearRect(0, 0, pad.width, pad.height); hasInk = false; }

  function saveSignature() {
    var email = F.session.profile().email;
    var fields = { title: $("sig-title").value.trim() };
    var image = hasInk ? trimmedSignature() : "";
    if (image) fields.image = image;
    if (!C.setSignature(email, fields)) { $("sig-status").textContent = "Couldn't save in this browser."; return; }
    clearPad();
    renderSignature();
    $("sig-status").textContent = image ? "Title and signature saved. Certificates you issue from now on carry them." : "Title saved." + (C.signature(email).image ? "" : " Draw your signature in the box to add it too.");
  }

  $("sig-save").addEventListener("click", saveSignature);
  $("sig-title").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); saveSignature(); } });
  $("sig-clear").addEventListener("click", function () { clearPad(); $("sig-status").textContent = "Box cleared."; });
  $("sig-remove").addEventListener("click", function () {
    if (!window.confirm("Remove your saved signature? Certificates you issue will show your name in a handwriting style instead.")) return;
    C.setSignature(F.session.profile().email, { image: "" });
    renderSignature();
    $("sig-status").textContent = "Signature removed.";
    $("sig-save").focus();
  });

  // ---------- Start ----------

  F.fillCountrySelect($("country"));
  F.enhancePhone($("phone"));
  var photo = window.SevakPhoto.mount($("photo-field"));

  var existing = F.load(STORAGE_KEY);
  if (existing) fill(existing);
  else $("role-volunteer").checked = true;
  if (server && server.user) {
    $("email").value = server.user.email;
    $("email").readOnly = true;
    $("email").nextElementSibling.textContent = "The email you signed in with. Confirmations and certificates go here.";
  }
  refreshServices();
  updateCounters();
  updateAffiliationButton();
  applyRoles();
  renderTeams();
  renderVolunteerOrgs();
  renderAccount();
  renderJoinNotice();
  renderSignature();

  // Your documents are yours (by email), so certificates an organization
  // issues to you land here.
  var DOCS_BLOCKED = "Save your profile first, then you can add documents.";
  var docsOwner = existing ? window.SevakDocs.profileOwner(existing.email) : null;
  var docs = window.SevakDocs.mount($("panel-documents"), {
    owner: docsOwner,
    help: "Certificates, background checks, training records and anything else you want to keep handy. Only you can see these.",
    blockedMessage: DOCS_BLOCKED
  });
  // Documents save on their own, so the profile's Save bar isn't shown there.
  var tabs = window.SevakDocs.pageTabs($("profile-tabs"), function (key) {
    $("save-bar").hidden = key === "documents";
  });
})();
