// Verification requests (prototype): stands in for Sevak's staff review
// queue (ADM-1). Approve, or reject with a reason the organization sees.
(function () {
  "use strict";

  var O = window.SevakOrgs;
  var V = window.SevakVerify;
  var $ = function (id) { return document.getElementById(id); };

  // With Sevak's server, only Sevak staff (SEVAK_PLATFORM_ADMINS) review;
  // the server refuses anyone else's decisions anyway.
  var server = window.SevakServer;
  if (server) {
    var banner = document.querySelector("main .banner");
    if (banner) banner.innerHTML = "<strong>Sevak staff only.</strong> Verifying or rejecting emails the organization's Admins.";
    if (!server.user || !server.user.isPlatformAdmin) {
      Array.prototype.forEach.call(document.querySelector("main").children, function (c) { c.hidden = true; });
      var note = document.createElement("section");
      note.className = "section";
      note.innerHTML = "<h1 class=\"page-title\">Verification requests</h1><p class=\"page-intro\">Only Sevak's staff can review verification requests. If you asked for your organization to be verified, you'll hear back by email.</p><p class=\"hint\">Sevak staff: if you signed in with an emailed code, sign out and sign in again with Continue with Google.</p><p><a class=\"btn btn-secondary btn-small\" href=\"organization.html\">Back to your organization</a></p>";
      document.querySelector("main").appendChild(note);
      return;
    }
  }

  var CHARITY = {
    "charity": "Registered charity or nonprofit",
    "nonprofit-other": "Other nonprofit or tax-exempt organization",
    "pending": "Registration pending",
    "none": "Not registered"
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function day(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
  }

  function place(o) {
    var a = o.address || {};
    return [a.city, a.state, a.country].filter(Boolean).join(", ");
  }

  function evidence(ev) {
    var ul = el("ul", "verify-evidence");
    var row = function (label, node) {
      var li = el("li");
      li.appendChild(el("span", "verify-label", label));
      li.appendChild(node);
      ul.appendChild(li);
    };
    row("Charity status", el("span", null, CHARITY[ev.taxStatus] || "Not given"));
    row("Registration number", el("span", ev.registrationNumber ? null : "hint", ev.registrationNumber || "None given"));
    if (ev.website) {
      var a = el("a", null, ev.website.replace(/^https?:\/\//, "") + " ↗");
      a.href = ev.website;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      row("Website", a);
    } else {
      row("Website", el("span", "hint", "None given"));
    }
    row("Contact email", el("span", null, (ev.contactEmail || "None given") +
      (ev.contactEmail && ev.website ? (ev.emailMatchesWebsite ? " · on the website's domain ✓" : " · a different domain") : "")));
    return ul;
  }

  function header(o, li) {
    var h = el("h3", null, o.name || "Unnamed organization");
    h.id = "review-" + o.id;
    h.tabIndex = -1;
    li.appendChild(h);
    if (place(o)) li.appendChild(el("p", "hint", place(o)));
  }

  function after(message) {
    render();
    $("review-status").textContent = message;
    $("queue-title").focus();
  }

  function render() {
    // Waiting
    var queue = V.queue();
    var ql = $("queue-list");
    ql.innerHTML = "";
    queue.forEach(function (o) {
      var v = o.verification || {};
      var li = el("li", "review-item");
      header(o, li);
      li.appendChild(el("p", "hint", "Asked " + day(v.requestedAt) + (v.requestedByName ? " by " + v.requestedByName : "") + (v.requestedBy ? " (" + v.requestedBy + ")" : "")));
      li.appendChild(evidence(v.evidence || V.evidence(o)));
      if (v.note) li.appendChild(el("p", "verify-note", "“" + v.note + "”"));

      var actions = el("div", "review-actions");
      var approve = el("button", "btn btn-primary btn-small", "Verify");
      approve.type = "button";
      approve.setAttribute("aria-label", "Verify " + o.name);
      approve.addEventListener("click", function () {
        V.approve(o.id);
        after(o.name + " is verified. Its public events are now listed." + (server ? " Its Admins have been emailed." : " (Email in the outbox.)"));
      });
      var reject = el("button", "btn btn-secondary btn-small", "Reject…");
      reject.type = "button";
      reject.setAttribute("aria-label", "Reject " + o.name);
      reject.setAttribute("aria-expanded", "false");
      actions.appendChild(approve);
      actions.appendChild(reject);
      li.appendChild(actions);

      // Rejecting needs a reason the organization will see.
      var box = el("div", "review-reject");
      box.hidden = true;
      var id = "reason-" + o.id;
      box.id = id + "-box";
      reject.setAttribute("aria-controls", box.id);
      var label = el("label", null, "Reason (the organization sees this)");
      label.htmlFor = id;
      var reason = el("textarea");
      reason.id = id;
      reason.rows = 3;
      reason.maxLength = 500;
      reason.placeholder = "For example: we couldn't find this registration number on the charity register";
      var err = el("p", "error");
      err.id = id + "-error";
      reason.setAttribute("aria-describedby", err.id);
      var confirm = el("button", "btn btn-danger btn-small", "Reject request");
      confirm.type = "button";
      confirm.addEventListener("click", function () {
        if (!reason.value.trim()) {
          err.textContent = "Say why, so the organization knows what to fix.";
          reason.setAttribute("aria-invalid", "true");
          reason.focus();
          return;
        }
        V.reject(o.id, reason.value);
        after("Request from " + o.name + " rejected." + (server ? " Its Admins have been emailed." : " (Email in the outbox.)"));
      });
      reason.addEventListener("input", function () { err.textContent = ""; reason.removeAttribute("aria-invalid"); });
      var field = el("div", "field");
      field.appendChild(label);
      field.appendChild(reason);
      field.appendChild(err);
      box.appendChild(field);
      box.appendChild(confirm);
      li.appendChild(box);
      reject.addEventListener("click", function () {
        box.hidden = !box.hidden;
        reject.setAttribute("aria-expanded", String(!box.hidden));
        if (!box.hidden) reason.focus();
      });
      ql.appendChild(li);
    });
    $("queue-empty").hidden = queue.length > 0;
    $("queue-title").textContent = queue.length ? "Waiting for review (" + queue.length + ")" : "Waiting for review";

    // Decided
    var decided = V.decided();
    var dl = $("decided-list");
    dl.innerHTML = "";
    decided.forEach(function (o) {
      var v = o.verification;
      var li = el("li", "review-item");
      header(o, li);
      var verified = V.status(o) === "verified";
      var line = el("p");
      var badge = el("span", "badge " + (verified ? "badge-published" : "badge-danger"), verified ? "Verified" : "Not approved");
      line.appendChild(badge);
      line.appendChild(document.createTextNode(" " + day(v.decidedAt) + (!verified && v.reason ? ": " + v.reason : "")));
      li.appendChild(line);
      dl.appendChild(li);
    });
    $("decided-section").hidden = !decided.length;
  }

  render();
})();
