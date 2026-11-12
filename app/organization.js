// Host organization profile (prototype). Data is kept in this browser only.
(function () {
  "use strict";

  var MAX_MEMBERS = 20;
  // Statuses where we ask for a registration number (always optional).
  var REGISTRATION_STATUSES = { "charity": true, "nonprofit-other": true, "pending": true };
  // Status values saved before the form became country-neutral.
  var LEGACY_STATUS = { "501c3": "charity", "501c-other": "nonprofit-other" };

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var form = document.getElementById("org-form");
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Field helpers ----------

  function normalizeUrl(value) {
    var v = value.trim();
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    return v;
  }

  function parseUrl(value) {
    try {
      var url = new URL(normalizeUrl(value));
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch (e) {
      return null;
    }
  }

  function isValidWebsite(value) {
    var url = parseUrl(value);
    return !!url && url.hostname.indexOf(".") > 0;
  }

  // Accepts WhatsApp group or community invites (chat.whatsapp.com/…),
  // channels (whatsapp.com/channel/…) and click-to-chat links (wa.me/…).
  function isValidWhatsappLink(value) {
    var url = parseUrl(value);
    if (!url) return false;
    var host = url.hostname.toLowerCase().replace(/^www\./, "");
    var path = url.pathname.replace(/\/+$/, "");
    if (host === "chat.whatsapp.com") return /^\/[A-Za-z0-9]{10,}$/.test(path);
    if (host === "whatsapp.com") return /^\/channel\/[A-Za-z0-9]{10,}$/.test(path);
    if (host === "wa.me") return /^\/\d{8,15}$/.test(path);
    return false;
  }

  function selectedTaxStatus() {
    var checked = form.querySelector('input[name="taxStatus"]:checked');
    return checked ? checked.value : "";
  }

  // Every email on the profile must be unique, so each person gets their own login.
  function allEmailInputs() {
    return [$("contactEmail")].concat(Array.prototype.slice.call(form.querySelectorAll('[data-key="email"]')));
  }

  // A city or a phone number is enough: either one, or both. The street
  // address is always optional; if it's given, so is its city.
  var ADDRESS_IDS = ["city"];

  function syncAddressOrPhone() {
    var hasStreet = !!$("addressLine1").value.trim();
    var hasCity = !!$("city").value.trim();
    var hasPhone = !!$("contactPhone").value.trim();
    $("addressLine1").required = false;
    $("city").required = hasStreet || !hasPhone;
    $("contactPhone").required = !hasCity;
  }

  function messageFor(input) {
    var v = input.value.trim();
    syncAddressOrPhone();
    var eitherOr = input.required && !v && (ADDRESS_IDS.indexOf(input.id) !== -1 || input.id === "contactPhone");
    var neither = !$("contactPhone").value.trim() && !$("city").value.trim();
    if (eitherOr && neither) {
      return input.id === "contactPhone"
        ? "Add a phone number, or the organization's city on the Address tab. One is enough."
        : "Add the organization's city, or a phone number on the Contact tab. One is enough.";
    }
    var basic = F.basicMessage(input);
    if (basic) return basic;

    if (input.id === "website" && v && !isValidWebsite(v)) {
      return "Enter a website address like example.org.";
    }
    if (input.id === "whatsappLink" && v && !isValidWhatsappLink(v)) {
      return "Enter a WhatsApp invite link (chat.whatsapp.com/…), channel link (whatsapp.com/channel/…) or wa.me link.";
    }
    if (input.id === "registrationNumber" && v && !/^[A-Za-z0-9][A-Za-z0-9 \-\/.]{2,29}$/.test(v)) {
      return "Use letters, numbers, spaces, hyphens or slashes.";
    }
    if (input.type === "email" && v) {
      var lower = v.toLowerCase();
      var others = allEmailInputs().filter(function (el) { return el !== input; });
      var duplicate = others.some(function (el) { return el.value.trim().toLowerCase() === lower; });
      if (duplicate) return "Each person needs a different email address.";
    }
    return "";
  }

  // ---------- Description counter ----------

  function updateCounter() {
    var max = $("description").maxLength;
    $("description-counter").textContent = $("description").value.length + " / " + max;
  }
  $("description").addEventListener("input", updateCounter);

  // ---------- Charity or nonprofit status ----------

  function applyTaxStatus() {
    $("registration-field").hidden = !REGISTRATION_STATUSES[selectedTaxStatus()];
  }
  form.querySelectorAll('input[name="taxStatus"]').forEach(function (r) {
    r.addEventListener("change", applyTaxStatus);
  });

  // ---------- Open links in a new tab ----------

  // Shows a link under a URL field once what's typed is valid, so the host
  // can check it opens the right page.
  function updateOpenLink(inputId, isValid) {
    var input = $(inputId);
    var link = $(inputId + "-open");
    var v = input.value.trim();
    var url = v && isValid(v) ? normalizeUrl(v) : "";
    link.hidden = !url;
    if (!url) return;
    var u = new URL(url);
    var shown = (u.hostname + u.pathname + u.search).replace(/^www\./, "").replace(/\/$/, "");
    link.href = url;
    link.textContent = shown;
    link.setAttribute("aria-label", "Open " + shown + " in a new tab");
  }

  function updateOpenLinks() {
    updateOpenLink("website", isValidWebsite);
    updateOpenLink("whatsappLink", isValidWhatsappLink);
  }

  ["website", "whatsappLink"].forEach(function (id) {
    $(id).addEventListener("input", updateOpenLinks);
    $(id).addEventListener("change", updateOpenLinks);
  });

  // ---------- Fill in from website ----------

  var COUNTRY_ALIASES = {
    "usa": "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US",
    "uk": "GB", "great britain": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "northern ireland": "GB",
    "uae": "AE"
  };

  // Matches a country code or name (English or the visitor's language) to an ISO code.
  function countryCode(value) {
    var v = (value || "").trim();
    if (!v) return "";
    var lower = v.toLowerCase();
    if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
    var english = {};
    (window.SevakCountryData || []).forEach(function (row) {
      var parts = row.split("|");
      english[parts[1].toLowerCase()] = parts[0];
    });
    if (english[lower]) return english[lower];
    var match = F.countries.filter(function (c) {
      return c.code.toLowerCase() === lower || c.name.toLowerCase() === lower;
    })[0];
    return match ? match.code : "";
  }

  function markFilled(el) {
    el.classList.add("filled");
    el.addEventListener("input", function () { el.classList.remove("filled"); }, { once: true });
    el.addEventListener("change", function () { el.classList.remove("filled"); }, { once: true });
  }

  // Fills only empty fields, so nothing the host typed is overwritten.
  // Returns the names of the fields it filled.
  function applyWebsiteDetails(details) {
    var filled = [];
    var fillText = function (id, value, label) {
      if (value && !$(id).value.trim()) {
        $(id).value = value;
        markFilled($(id));
        if (label && filled.indexOf(label) === -1) filled.push(label);
      }
    };
    fillText("description", details.description, "description");
    updateCounter();

    var a = details.address;
    var addressEmpty = ["addressLine1", "city", "state", "postalCode"].every(function (id) { return !$(id).value.trim(); });
    if (a && addressEmpty) {
      var code = countryCode(a.country);
      if (code && code !== $("country").value) {
        $("country").value = code;
        markFilled($("country"));
      }
      fillText("addressLine1", a.line1, "address");
      fillText("city", a.city, "address");
      fillText("state", a.state, "address");
      fillText("postalCode", a.postalCode, "address");
    }
    return filled;
  }

  function websiteUrl() {
    var v = $("website").value.trim();
    return v && isValidWebsite(v) ? normalizeUrl(v) : "";
  }

  function needsWebsiteDetails() {
    var addressEmpty = ["addressLine1", "city", "postalCode"].every(function (id) { return !$(id).value.trim(); });
    return !$("description").value.trim() || addressEmpty;
  }

  var lastFetched = "";

  function fillFromWebsite() {
    var url = websiteUrl();
    var status = $("fill-status");
    if (!url) return;
    lastFetched = url;
    $("fill-from-website").disabled = true;
    status.textContent = "Looking up " + new URL(url).hostname + "…";
    window.SevakWebsite.fetchDetails(url).then(function (details) {
      var filled = applyWebsiteDetails(details);
      if (filled.length) {
        status.textContent = "Filled in your " + filled.join(" and ") + " from your website. Please check them" +
          (filled.indexOf("address") !== -1 ? " (your address is on the Address tab)." : ".");
      } else if (details.description || details.address) {
        status.textContent = "Your website's details match what's already here, so nothing changed.";
      } else {
        status.textContent = "We couldn't find a description or address on that page. Please fill them in.";
      }
    }).catch(function (e) {
      status.textContent = e.reason === "timeout"
        ? "That website took too long to respond. Please fill in the details yourself."
        : "We couldn't read that website from your browser. Many sites block this, so please fill in the details yourself.";
    }).finally(function () {
      $("fill-from-website").disabled = !websiteUrl();
    });
  }

  $("website").addEventListener("input", function () {
    $("fill-from-website").disabled = !websiteUrl();
  });
  $("fill-from-website").addEventListener("click", fillFromWebsite);
  // Look the website up automatically once, when it's first entered and
  // there are still details to fill.
  $("website").addEventListener("change", function () {
    var url = websiteUrl();
    if (url && url !== lastFetched && needsWebsiteDetails()) fillFromWebsite();
  });

  // ---------- Team members ----------

  var memberRows = $("member-rows");
  var memberTemplate = $("member-template");
  var memberCounter = 0;

  function addMember(value) {
    if (memberRows.children.length >= MAX_MEMBERS) return null;
    memberCounter += 1;
    var card = memberTemplate.content.firstElementChild.cloneNode(true);

    // Give each field a unique id so labels and error messages connect.
    card.querySelectorAll(".field").forEach(function (field) {
      var control = field.querySelector("[data-key]");
      var id = "member-" + memberCounter + "-" + control.dataset.key;
      control.id = id;
      field.querySelector("label").htmlFor = id;
      var error = field.querySelector(".error");
      if (error) error.id = id + "-error";
    });

    card.querySelector(".remove").addEventListener("click", function () {
      card.remove();
      renumberMembers();
      $("add-member").focus();
    });

    memberRows.appendChild(card);
    var phone = card.querySelector('[data-key="phone"]');
    F.enhancePhone(phone);

    if (value) {
      ["name", "role", "email"].forEach(function (key) {
        if (value[key] != null) card.querySelector('[data-key="' + key + '"]').value = value[key];
      });
      F.setPhone(phone, value.phone);
    }

    renumberMembers();
    return card.querySelector('[data-key="name"]');
  }

  function renumberMembers() {
    Array.prototype.forEach.call(memberRows.children, function (card, i) {
      var title = "Team member " + (i + 1);
      card.querySelector("h3").textContent = title;
      card.querySelector(".remove").setAttribute("aria-label", "Remove " + title.toLowerCase());
    });
    $("add-member").hidden = memberRows.children.length >= MAX_MEMBERS;
  }

  function readMembers() {
    return Array.prototype.map.call(memberRows.children, function (card) {
      var get = function (key) { return card.querySelector('[data-key="' + key + '"]').value.trim(); };
      return {
        name: get("name"),
        role: get("role"),
        email: get("email"),
        phone: F.phoneValue(card.querySelector('[data-key="phone"]'))
      };
    });
  }

  $("add-member").addEventListener("click", function () {
    var input = addMember();
    if (input) input.focus();
  });

  // ---------- Read / fill ----------

  function readForm() {
    var v = function (id) { return $(id).value.trim(); };
    var status = selectedTaxStatus();
    var asks = !!REGISTRATION_STATUSES[status];
    return {
      name: v("orgName"),
      website: v("website") ? normalizeUrl(v("website")) : "",
      whatsappLink: v("whatsappLink") ? normalizeUrl(v("whatsappLink")) : "",
      description: v("description"),
      address: {
        country: $("country").value,
        line1: v("addressLine1"),
        line2: v("addressLine2"),
        city: v("city"),
        state: v("state"),
        postalCode: v("postalCode")
      },
      taxStatus: status,
      registrationNumber: asks ? v("registrationNumber") : "",
      primaryContact: {
        name: v("contactName"),
        title: v("contactTitle"),
        email: v("contactEmail"),
        phone: F.phoneValue($("contactPhone"))
      },
      team: readMembers(),
      verificationStatus: "unverified",
      updatedAt: new Date().toISOString()
    };
  }

  function fill(data) {
    var set = function (id, value) { if (value != null) $(id).value = value; };
    set("orgName", data.name);
    set("website", data.website);
    set("whatsappLink", data.whatsappLink);
    set("description", data.description);
    if (data.address) {
      if (data.address.country) $("country").value = data.address.country;
      set("addressLine1", data.address.line1);
      set("addressLine2", data.address.line2);
      set("city", data.address.city);
      set("state", data.address.state);
      set("postalCode", data.address.postalCode || data.address.zip);
    }
    var status = LEGACY_STATUS[data.taxStatus] || data.taxStatus;
    if (status) {
      var radio = form.querySelector('input[name="taxStatus"][value="' + status + '"]');
      if (radio) radio.checked = true;
    }
    set("registrationNumber", data.registrationNumber || data.ein);
    if (data.primaryContact) {
      set("contactName", data.primaryContact.name);
      set("contactTitle", data.primaryContact.title);
      set("contactEmail", data.primaryContact.email);
      F.setPhone($("contactPhone"), data.primaryContact.phone);
    }
    (data.team || []).forEach(addMember);
  }

  // ---------- Tabs ----------
  // The profile is one form split into tabs. Hidden panels keep their
  // fields, so Save checks and saves every tab.

  var tabs = Array.prototype.slice.call(form.querySelectorAll('[role="tab"]'));

  function tabKey(tab) { return tab.id.replace(/^tab-/, ""); }

  function showTab(key, opts) {
    opts = opts || {};
    var found = tabs.some(function (t) { return tabKey(t) === key; });
    if (!found) key = tabKey(tabs[0]);
    tabs.forEach(function (t) {
      var selected = tabKey(t) === key;
      t.setAttribute("aria-selected", selected ? "true" : "false");
      t.tabIndex = selected ? 0 : -1;
      $("panel-" + tabKey(t)).classList.toggle("is-hidden", !selected);
      if (selected && opts.focusTab) t.focus();
      // Keep the selected tab visible when the tab bar scrolls on small screens.
      if (selected) t.parentNode.scrollLeft = Math.max(0, t.offsetLeft - (t.parentNode.clientWidth - t.offsetWidth) / 2);
    });
    // Documents save on their own, so the profile's Save bar isn't shown there.
    $("save-bar").hidden = key === "documents" || readOnly;
    if (opts.updateUrl !== false) history.replaceState(null, "", "#" + key);
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { showTab(tabKey(tab)); });
    tab.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      showTab(tabKey(next), { focusTab: true });
    });
  });

  form.querySelectorAll(".next-tab").forEach(function (button) {
    button.addEventListener("click", function () {
      showTab(button.dataset.next);
      var panel = $("panel-" + button.dataset.next);
      var first = panel.querySelector("input:not([type=hidden]), select, textarea, button");
      if (first) first.focus();
      $("tab-" + button.dataset.next).scrollIntoView({ block: "nearest" });
    });
  });

  // Marks the tabs that contain errors. Returns them in tab order.
  function markTabErrors() {
    var withErrors = [];
    tabs.forEach(function (t) {
      var panel = $("panel-" + tabKey(t));
      // Documents has its own form and checks.
      var bad = tabKey(t) !== "documents" && !!panel.querySelector('[aria-invalid="true"]');
      t.classList.toggle("has-error", bad);
      t.querySelector(".tab-alert").textContent = bad ? " (needs attention)" : "";
      if (bad) withErrors.push(tabKey(t));
    });
    return withErrors;
  }

  // Clear a tab's dot once its last error is fixed.
  form.addEventListener("input", function () { setTimeout(markTabErrors, 0); });
  form.addEventListener("change", function () { setTimeout(markTabErrors, 0); });

  // ---------- Events ----------

  F.clearErrorsAsYouType(form, messageFor);

  ["website", "whatsappLink"].forEach(function (id) {
    $(id).addEventListener("blur", function () {
      var v = $(id).value.trim();
      if (v) $(id).value = normalizeUrl(v);
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    applyTaxStatus();
    var fields = form.querySelectorAll("input:not([type=radio]):not([type=checkbox]), select#country, textarea, input[name=taxStatus]");
    var firstInvalid = F.validate(fields, messageFor);
    var badTabs = markTabErrors();
    if (firstInvalid) {
      var panel = firstInvalid.closest('[role="tabpanel"]');
      if (panel) showTab(panel.id.replace(/^panel-/, ""));
      var names = badTabs.map(function (k) { return $("tab-" + k).firstChild.textContent; });
      $("status").textContent = "Please check " + (names.length > 1
        ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1]
        : names[0] || "the highlighted fields") + ".";
      firstInvalid.focus();
      return;
    }
    var existingOrg = orgId ? O.get(orgId) : null;
    // Keep what this form doesn't hold: the invite code, approving
    // automatically, the verification request and so on.
    var data = Object.assign({}, existingOrg || {}, readForm());
    data.id = orgId || undefined;
    data.createdAt = existingOrg && existingOrg.createdAt ? existingOrg.createdAt : data.updatedAt;
    if (existingOrg && existingOrg.verificationStatus) data.verificationStatus = existingOrg.verificationStatus;
    var saved = O.save(data);
    if (!saved) {
      $("status").textContent = "Couldn't save in this browser. Check that site storage is allowed.";
      return;
    }
    // Saved: on to its events, which say so. (Setting up an organization
    // puts you on its team, so Manage appears there.)
    var wasNew = !orgId;
    O.setCurrent(saved.id);
    dirty = false;
    var name = "“" + (saved.name || "your organization") + "”";
    window.SevakNav.flashAndGo("events.html", wasNew ? "Created " + name + ". Next, add its first event." : "Saved the profile of " + name + ".", {
      href: "organization.html",
      linkText: "Edit the organization"
    });
  });

  $("delete-org").addEventListener("click", function () {
    // Checked against the saved profile, so unsaved Team changes don't count.
    if (!O.isAdmin(O.get(orgId))) {
      applyMode();
      $("status").textContent = "Only admins can delete this organization.";
      return;
    }
    var name = $("orgName").value.trim() || "this organization";
    if (!window.confirm("Delete " + name + " and its events from this device? This can't be undone.")) return;
    O.remove(orgId);
    // Show the next organization, or an empty form if none are left.
    location.href = location.pathname;
  });

  // ---------- Several organizations ----------

  // Unsaved changes are confirmed before switching organization.
  var dirty = false;
  form.addEventListener("input", function () { dirty = true; });
  form.addEventListener("change", function () { dirty = true; });

  function confirmLeave() {
    return !dirty || window.confirm("You have unsaved changes. Leave without saving?");
  }

  function applyMode() {
    var title = creating ? "New organization" : "Organization profile";
    $("page-title").textContent = title;
    document.title = title + " · Sevak";
    // Only Admins can delete the organization (see SevakOrgs.roleFor).
    var isAdmin = !!orgId && O.isAdmin(O.get(orgId));
    $("delete-org").hidden = !isAdmin;
    $("delete-org-hint").hidden = !orgId || isAdmin;
    O.renderSwitcher($("org-switcher"), { creating: creating, confirmLeave: confirmLeave });
  }

  // ---------- Verification (ORG-3) ----------
  // An Admin asks Sevak to verify the organization, with evidence from the
  // saved profile; Sevak's staff decide (review.html in the prototype).

  var V = window.SevakVerify;
  var verifyOpen = false;
  var verifyNote = "";   // kept while the profile is saved or redrawn

  function vEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function day(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
  }

  function tabLink(key, text) {
    var a = vEl("a", null, text);
    a.href = "#" + key;
    return a;
  }

  // The details a request sends, as a short list.
  function evidenceList(ev) {
    var ul = vEl("ul", "verify-evidence");
    var item = function (label, value, missingTab) {
      var li = vEl("li");
      li.appendChild(vEl("span", "verify-label", label));
      if (value) li.appendChild(vEl("span", null, value));
      else {
        li.appendChild(vEl("span", "hint", "None added · "));
        li.appendChild(tabLink(missingTab, "add it"));
      }
      ul.appendChild(li);
    };
    item("Registration number", ev.registrationNumber ? ev.registrationNumber + " (never shown publicly)" : "", "status");
    item("Website", ev.website.replace(/^https?:\/\//, ""), "about");
    item("Contact email", ev.contactEmail ? ev.contactEmail + (ev.emailMatchesWebsite ? " · on your website's domain ✓" : ev.website ? " · not on your website's domain" : "") : "", "contact");
    return ul;
  }

  function button(text, cls, onClick) {
    var b = vEl("button", "btn " + cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function renderVerify(message) {
    var box = $("verify-box");
    var org = orgId ? O.get(orgId) : null;
    box.hidden = !org || !V;
    if (box.hidden) return;
    var st = V.status(org);
    var v = org.verification || {};
    var canAct = !F.session.signedIn() || O.isAdmin(org);
    var badge = $("verify-badge");
    badge.className = "badge " + (st === "verified" ? "badge-published" : st === "rejected" ? "badge-danger" : "badge-draft");
    badge.textContent = { verified: "Verified", pending: "Pending review", rejected: "Not approved", unverified: "Not verified yet" }[st];
    var text = $("verify-text");
    var body = $("verify-body");
    body.innerHTML = "";
    $("verify-status").textContent = message || "";

    if (st === "verified") {
      text.textContent = (v.decidedAt ? "Sevak verified " + (org.name || "this organization") + " on " + day(v.decidedAt) + ". " : "") +
        "Volunteers see the Verified badge, and your public events are listed for them to find.";
      return;
    }
    if (st === "pending") {
      text.textContent = "You asked on " + day(v.requestedAt) + (v.requestedByName ? " (" + v.requestedByName + ")" : "") +
        ". Sevak usually replies within two working days; you'll get an email. Until then, public events stay private.";
      if (v.evidence) body.appendChild(evidenceList(v.evidence));
      if (v.note) body.appendChild(vEl("p", "verify-note", "Your note: “" + v.note + "”"));
      // Who reviews it: Sevak's staff (in the prototype, anyone).
      var server = window.SevakServer;
      var staff = server && server.user && server.user.isPlatformAdmin;
      if (!server || staff) {
        var proto = vEl("p", "hint verify-proto");
        proto.appendChild(document.createTextNode(staff ? "You're Sevak staff: " : "Prototype: there are no Sevak staff here, so you can "));
        var r = vEl("a", null, staff ? "review it on the Review page" : "review the request yourself");
        r.href = "review.html";
        proto.appendChild(r);
        proto.appendChild(document.createTextNode("."));
        body.appendChild(proto);
      }
      if (canAct) {
        var row = vEl("div", "fill-row");
        row.appendChild(button("Withdraw request", "btn-secondary btn-small", function () {
          if (!window.confirm("Withdraw your verification request?")) return;
          V.withdraw(orgId);
          verifyOpen = false;
          renderVerify("Request withdrawn.");
          $("verify-title").focus();
        }));
        body.appendChild(row);
      }
      return;
    }

    // Not verified yet, or not approved
    text.textContent = st === "rejected"
      ? "Sevak couldn't verify " + (org.name || "this organization") + " on " + day(v.decidedAt) + (v.reason ? ": " + v.reason : ".") + " Update your profile and ask again."
      : "Only verified organizations list public events; until then they stay private, though you can share their links. Ask Sevak to check who you are.";
    if (!canAct) {
      body.appendChild(vEl("p", "hint", "Only Admins can ask for verification."));
      return;
    }
    if (!verifyOpen) {
      body.appendChild(button(st === "rejected" ? "Ask again" : "Request verification", "btn-primary btn-small", function () {
        verifyOpen = true;
        renderVerify();
        var first = $("verify-body").querySelector("textarea, button");
        if (first) first.focus();
      }));
      return;
    }
    var check = V.canRequest(org);
    body.appendChild(vEl("p", null, "We'll send these details from your saved profile:"));
    body.appendChild(evidenceList(V.evidence(org)));
    if (!check.ok) {
      body.appendChild(vEl("p", "notice notice-warn", check.reason));
      body.appendChild(button("Cancel", "btn-secondary btn-small", function () { verifyOpen = false; renderVerify(); }));
      return;
    }
    var field = vEl("div", "field");
    var label = vEl("label", null, "Anything else that helps? ");
    label.htmlFor = "verify-note";
    label.appendChild(vEl("span", "optional", "(optional)"));
    var note = vEl("textarea");
    note.id = "verify-note";
    note.maxLength = 500;
    note.rows = 3;
    note.placeholder = "For example a link to your entry on the charity register";
    note.value = verifyNote;
    note.addEventListener("input", function () { verifyNote = note.value; });
    field.appendChild(label);
    field.appendChild(note);
    body.appendChild(field);
    var actions = vEl("div", "fill-row");
    actions.appendChild(button("Send request", "btn-primary btn-small", function () {
      if (dirty) {
        $("verify-status").textContent = "You have unsaved changes. Save the profile first, so Sevak gets the latest details.";
        return;
      }
      if (!V.request(orgId, note.value)) {
        $("verify-status").textContent = "Couldn't send the request. Check the details above.";
        return;
      }
      verifyOpen = false;
      verifyNote = "";
      renderVerify("Request sent. Sevak will email you when it's decided." + (window.SevakServer ? "" : " (See the outbox.)"));
      window.SevakNav.render();
      $("verify-title").focus();
    }));
    actions.appendChild(button("Cancel", "btn-secondary btn-small", function () { verifyOpen = false; verifyNote = ""; renderVerify(); }));
    body.appendChild(actions);
  }

  // ---------- Start ----------

  F.fillCountrySelect($("country"));
  F.enhancePhone($("contactPhone"));

  var creating = new URLSearchParams(location.search).get("new") === "1";
  // Signed in, you need to be on an organization's team (or be setting a new one up).
  if (!window.SevakNav.guard({ creating: creating })) return;
  var orgId = creating ? null : O.currentId();
  var existing = orgId ? O.get(orgId) : null;
  if (existing) fill(existing);
  // Coordinators can look but not change the profile or its team, so nobody
  // can make themselves an Admin.
  var readOnly = !!existing && F.session.signedIn() && O.roleFor(existing) === "coordinator";
  var docs = window.SevakDocs.mount($("panel-documents"), {
    owner: existing ? "org:" + orgId : null,
    help: "Policies, insurance certificates, registration papers and anything else your team needs.",
    blockedMessage: "Save the organization profile first, then you can add documents."
  });
  applyMode();
  renumberMembers();
  applyTaxStatus();
  updateCounter();
  $("fill-from-website").disabled = !websiteUrl();
  lastFetched = websiteUrl();
  updateOpenLinks();
  if (readOnly) {
    form.querySelectorAll("input, select, textarea, button").forEach(function (c) {
      if (c.getAttribute("role") !== "tab" && !c.classList.contains("next-tab")) c.disabled = true;
    });
    $("readonly-note").hidden = false;
  }
  $("verify-title").tabIndex = -1;
  renderVerify();
  showTab(location.hash.replace("#", ""), { updateUrl: false });
  window.addEventListener("hashchange", function () { showTab(location.hash.replace("#", ""), { updateUrl: false }); });
})();
