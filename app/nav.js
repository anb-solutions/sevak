// The menu of the app pages, and who can open the "Manage" pages.
//
//   Signed out:                 Opportunities · Join · Sign in
//   Signed in:                  Opportunities · My sign-ups · Profile
//   On an organization's team:  … plus Manage: Events · Volunteers · Dashboard · Organization
//                               (Volunteers shows how many requests are waiting)
//
// The Manage links show in the menu on the Manage pages. Everywhere else
// they're tucked under a "⋯" button, so the volunteer pages stay simple.
//
// On wide screens the menu is at the top. On phones the main items move to
// a bar at the bottom of the screen (like most apps), and the Manage links
// stay at the top on the Manage pages.
//
// The Manage pages call SevakNav.guard() first. Someone signed in who isn't
// on the right team sees how to get there instead: set up an organization
// (and be its Admin), or ask an Admin to add them on the Team tab. Signed
// out, the pages open as a preview, so reviewers can look around.
(function () {
  "use strict";

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var SEEN_KEY = "sevak.seenTeams.v1";
  var SEEN_MEMBERSHIPS_KEY = "sevak.seenMemberships.v1";
  var SEEN_VERIFICATION_KEY = "sevak.seenVerification.v1";
  var SEEN_CERTS_KEY = "sevak.seenCertificates.v1";
  var M = window.SevakMembers;
  var BANNER_KEY = "sevak.bannerDismissed.v1";
  var MANAGE = { "events.html": "events", "event.html": "events", "main-event.html": "events", "volunteers.html": "volunteers", "dashboard.html": "dashboard", "organization.html": "organization" };

  var ICONS = {
    opportunities: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
    mine: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4M8.5 14.5l2.5 2.5 4.5-4.5"/>',
    profile: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.8 4.2-5.8 7.5-5.8s6.3 2 7.5 5.8"/>',
    join: '<circle cx="10" cy="8.5" r="4"/><path d="M3 20.5c1.1-3.6 3.9-5.6 7-5.6 1.4 0 2.7.4 3.8 1.1M18 13.5v6M15 16.5h6"/>',
    signin: '<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
    more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    manage: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'
  };

  function page() {
    return location.pathname.split("/").pop() || "index.html";
  }

  // Which main item is "here": the volunteer page has two views.
  function currentItem() {
    var here = page();
    if (here === "signup.html") return new URLSearchParams(location.search).get("view") === "mine" ? "mine" : "opportunities";
    if (here === "profile.html") return "profile";
    if (here === "signin.html") return "signin";
    if (here === "join.html") return "join";
    return MANAGE[here] ? "manage" : "";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(href, text, current) {
    var a = el("a", null, text);
    a.href = href;
    if (current) a.setAttribute("aria-current", "page");
    return a;
  }

  function myEmail() {
    var p = F.session.profile();
    return p ? String(p.email).trim().toLowerCase() : "";
  }

  // How many upcoming events you've signed up for (still going ahead).
  // Everything on Manage → Volunteers waiting for you: requests to join,
  // hours to approve (events you're the admin of, or any if you're an Admin)
  // and certificate requests (Admins).
  function waitingCount() {
    if (!F.session.signedIn()) return 0;
    var teams = O.myTeams();
    if (!teams.length) return 0;
    var me = String((F.session.profile() || {}).email || "").toLowerCase();
    var admin = {}, onTeam = {};
    teams.forEach(function (t) { onTeam[t.org.id] = true; if (t.role === "admin") admin[t.org.id] = true; });
    var n = M ? M.pendingForMyTeams().length : 0;
    var E = window.SevakEvents;
    if (E) {
      var mine = {};
      E.all().forEach(function (ev) {
        if (onTeam[ev.organizationId] && (admin[ev.organizationId] || String(ev.eventAdmin || "").toLowerCase() === me)) mine[ev.id] = true;
      });
      var signups = F.load("sevak.signups.v1") || [];
      n += signups.filter(function (su) {
        if (!mine[su.eventId] || su.status === "cancelled" || !su.hours || !su.hours.minutes || su.hours.status === "approved" || su.hours.status === "rejected") return false;
        // Never your own hours; an Admin's only for another Admin (ATT-3).
        var who = String(su.email || "").toLowerCase();
        if (who && who === me) return false;
        var ev = E.get(su.eventId);
        return !(who && O.roleOf(O.get(ev.organizationId), who) === "admin" && !admin[ev.organizationId]);
      }).length;
    }
    var certs = F.load("sevak.certificates.v1") || [];
    n += certs.filter(function (c) { return c.status === "requested" && admin[c.orgId]; }).length;
    return n;
  }

  function upcomingCount() {
    var email = myEmail();
    if (!email || !F.session.signedIn()) return 0;
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    var events = {};
    (F.load("sevak.events.v1") || []).forEach(function (e) { events[e.id] = e; });
    var seen = {};
    (F.load("sevak.signups.v1") || []).forEach(function (s) {
      var e = events[s.eventId];
      if (s.status === "cancelled" || String(s.email || "").trim().toLowerCase() !== email || !e) return;
      if (e.active === false || (e.endDate || e.startDate || "") < today) return;
      seen[e.id] = true;
    });
    return Object.keys(seen).length;
  }

  // The main items, as [key, href, label].
  function mainItems(signedIn) {
    return signedIn
      ? [["opportunities", "signup.html", "Opportunities"], ["mine", "signup.html?view=mine", "My sign-ups"], ["profile", "profile.html", "Profile"]]
      : [["opportunities", "signup.html", "Opportunities"], ["join", "join.html", "Join"], ["signin", "signin.html", "Sign in"]];
  }

  // ---------- Menu ----------

  function render() {
    var nav = document.getElementById("app-nav");
    if (!nav) return;
    var here = page();
    var item = currentItem();
    var signedIn = F.session.signedIn();
    var onTeam = signedIn && O.myTeams().length > 0;
    var showManage = signedIn ? onTeam : !!MANAGE[here];
    var count = upcomingCount();
    var waiting = signedIn ? waitingCount() : 0;

    nav.innerHTML = "";
    var main = el("span", "nav-group nav-main");
    mainItems(signedIn).forEach(function (m) {
      var a = link(m[1], m[2], item === m[0]);
      if (m[0] === "mine" && count) {
        var badge = el("span", "nav-count", String(count));
        badge.setAttribute("aria-label", count + " upcoming");
        a.appendChild(badge);
      }
      main.appendChild(a);
    });
    nav.appendChild(main);

    // The Manage links, with the number of requests waiting on Volunteers.
    var manageLinks = function () {
      return [["events.html", "Events", "events"], ["volunteers.html", "Volunteers", "volunteers"],
        ["dashboard.html", "Dashboard", "dashboard"], ["organization.html", "Organization", "organization"]].map(function (x) {
        var a = link(x[0], x[1], MANAGE[here] === x[2]);
        if (x[2] === "volunteers" && waiting) {
          var wb = el("span", "nav-count", String(waiting));
          wb.setAttribute("aria-label", waiting + " waiting");
          a.appendChild(wb);
        }
        return a;
      });
    };

    if (showManage && MANAGE[here]) {
      // On the Manage pages: the links themselves.
      var manage = el("span", "nav-group nav-manage");
      manage.setAttribute("role", "group");
      manage.setAttribute("aria-label", "Manage");
      manage.appendChild(el("span", "nav-label", "Manage"));
      manageLinks().forEach(function (a) { manage.appendChild(a); });
      nav.appendChild(manage);
    } else if (showManage) {
      // Elsewhere: under "⋯".
      nav.appendChild(moreMenu("nav-more", manageLinks(), waiting, false));
    }

    // Phones: the main items in a bar at the bottom, plus "More" for Manage.
    var bar = document.getElementById("tab-bar");
    if (!bar) {
      bar = el("nav", "tab-bar");
      bar.id = "tab-bar";
      bar.setAttribute("aria-label", "Main");
      document.body.appendChild(bar);
    }
    bar.innerHTML = "";
    mainItems(signedIn).forEach(function (m) {
      var a = link(m[1], "", item === m[0]);
      a.className = "tab-bar-item";
      a.innerHTML = icon(m[0]);
      a.appendChild(el("span", "tab-bar-label", m[2]));
      if (m[0] === "mine" && count) {
        var b = el("span", "nav-count", String(count));
        b.setAttribute("aria-label", count + " upcoming");
        a.appendChild(b);
      }
      bar.appendChild(a);
    });
    if (showManage) bar.appendChild(moreMenu("tab-more", manageLinks(), waiting, !!MANAGE[here]));
    document.body.classList.add("has-tab-bar");
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  // A "⋯" button that shows the Manage links (a disclosure, not an app
  // menu: Tab moves through the links; Escape or a click outside closes it).
  // In the header it's a small button; in the phone bar it's "More".
  function moreMenu(id, links, waiting, current) {
    var wrap = el("div", id === "tab-more" ? "tab-more" : "nav-more");
    var btn = el("button", id === "tab-more" ? "tab-bar-item tab-more-btn" + (current ? " is-current" : "") : "nav-more-btn");
    btn.type = "button";
    btn.id = id + "-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id + "-menu");
    btn.innerHTML = icon("more");
    if (id === "tab-more") btn.appendChild(el("span", "tab-bar-label", "More"));
    else btn.appendChild(el("span", "sr-only", "More: manage your organization"));
    if (waiting) {
      var b = el("span", "nav-count", String(waiting));
      b.setAttribute("aria-label", waiting + " waiting");
      btn.appendChild(b);
    }
    var menu = el("div", "more-menu");
    menu.id = id + "-menu";
    menu.hidden = true;
    menu.appendChild(el("p", "more-menu-label", "Manage"));
    links.forEach(function (a) { menu.appendChild(a); });
    var close = function (focusButton) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (focusButton) btn.focus();
    };
    btn.addEventListener("click", function () {
      var open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open && menu.querySelector("a")) menu.querySelector("a").focus();
    });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); close(true); }
    });
    wrap.addEventListener("focusout", function (e) {
      if (!menu.hidden && e.relatedTarget && !wrap.contains(e.relatedTarget)) close(false);
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !wrap.contains(e.target)) close(false);
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  // ---------- The prototype banner: one line, and can be dismissed ----------

  function setupBanner() {
    var banner = document.querySelector("main .banner");
    if (!banner) return;
    // With Sevak's server (sync.js), some data is saved there already.
    if (window.SevakServer && /stays in this browser\.$/.test(banner.textContent.trim())) {
      if (window.SevakServer.env === "production") { banner.remove(); return; }
      banner.innerHTML = "<strong>Staging.</strong> This is Sevak's test site: everything is saved, and emails are sent for real, so use it only for testing.";
    }
    var dismissed = false;
    try { dismissed = localStorage.getItem(BANNER_KEY) === "true"; } catch (e) { /* ignore */ }
    banner.hidden = dismissed;
    var close = el("button", "banner-close");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss this note");
    close.textContent = "✕";
    close.addEventListener("click", function () {
      banner.hidden = true;
      try { localStorage.setItem(BANNER_KEY, "true"); } catch (e) { /* ignore */ }
    });
    banner.appendChild(close);
  }

  // ---------- "You've been added to a team" ----------
  // Shown once for each team someone else added you to. (In the live app
  // this is an invitation email you accept.)

  function announceTeams() {
    if (!F.session.signedIn()) return;
    var teams = O.myTeams();
    var ids = teams.map(function (t) { return t.org.id; });
    var seen = F.load(SEEN_KEY);
    if (!Array.isArray(seen)) {
      F.store(SEEN_KEY, ids);
      return;
    }
    var email = myEmail();
    var fresh = teams.filter(function (t) {
      return seen.indexOf(t.org.id) === -1 && String(t.org.createdBy || "").toLowerCase() !== email;
    });
    F.store(SEEN_KEY, seen.concat(ids.filter(function (id) { return seen.indexOf(id) === -1; })));
    if (!fresh.length) return;

    var box = el("div", "section notice team-notice");
    box.setAttribute("role", "status");
    fresh.forEach(function (t) {
      var p = el("p");
      p.appendChild(document.createTextNode("You've been added to the team of "));
      p.appendChild(el("strong", null, t.org.name || "an organization"));
      p.appendChild(document.createTextNode(" as " + (t.role === "admin" ? "an Admin" : "a Coordinator") + ". "));
      var go = link("events.html", "Go to its events", false);
      go.addEventListener("click", function () { O.setCurrent(t.org.id); });
      p.appendChild(go);
      box.appendChild(p);
    });
    var close = el("button", "btn btn-link", "Dismiss");
    close.type = "button";
    close.addEventListener("click", function () { box.remove(); });
    box.appendChild(close);
    var banner = document.querySelector("main .banner");
    if (banner) banner.insertAdjacentElement("afterend", box);
  }

  // ---------- Volunteer memberships: invitations, approvals ----------
  // Invitations to your email are accepted when you sign in. Then, once:
  // "You're now a volunteer with X", "X approved your request", or "X
  // didn't approve your request".

  function announceMemberships() {
    if (!M || !F.session.signedIn()) return;
    var accepted = M.acceptInvites().map(function (m) { return m.id; });
    var mine = M.mine();
    var key = function (m) { return m.id + ":" + m.status; };
    var seen = F.load(SEEN_MEMBERSHIPS_KEY);
    var first = !Array.isArray(seen);
    seen = first ? [] : seen;
    var news = mine.filter(function (m) {
      if (accepted.indexOf(m.id) !== -1) return true;
      if (first || seen.indexOf(key(m)) !== -1) return false;
      return (m.status === "active" && m.how === "request") || m.status === "declined";
    });
    F.store(SEEN_MEMBERSHIPS_KEY, seen.concat(mine.map(key).filter(function (k) { return seen.indexOf(k) === -1; })));
    if (!news.length) return;
    var box = el("div", "section notice team-notice");
    box.setAttribute("role", "status");
    news.forEach(function (m) {
      var org = O.get(m.orgId);
      if (!org) return;
      var p = el("p");
      if (m.status === "declined") {
        p.appendChild(document.createTextNode(org.name + " didn't approve your request to join. "));
        p.appendChild(link("signup.html#all-orgs", "Browse other opportunities", false));
      } else {
        p.appendChild(document.createTextNode(accepted.indexOf(m.id) !== -1 ? "You're now a volunteer with " : "Good news: you're approved to volunteer with "));
        p.appendChild(el("strong", null, org.name));
        p.appendChild(document.createTextNode(". "));
        p.appendChild(link("signup.html#my-orgs", "See its opportunities", false));
      }
      box.appendChild(p);
    });
    var close = el("button", "btn btn-link", "Dismiss");
    close.type = "button";
    close.addEventListener("click", function () { box.remove(); });
    box.appendChild(close);
    var banner = document.querySelector("main .banner");
    if (banner) banner.insertAdjacentElement("afterend", box);
  }

  // When Sevak decides on a verification request, the organization's team
  // sees it once (in the live app they also get the email).
  function announceVerification() {
    if (!F.session.signedIn() || page() === "review.html") return;
    var seen = F.load(SEEN_VERIFICATION_KEY);
    seen = seen && typeof seen === "object" ? seen : {};
    var news = O.myTeams().map(function (t) { return t.org; }).filter(function (o) {
      var v = o.verification;
      return v && v.decidedAt && seen[o.id] !== v.decidedAt;
    });
    if (!news.length) return;
    news.forEach(function (o) { seen[o.id] = o.verification.decidedAt; });
    F.store(SEEN_VERIFICATION_KEY, seen);
    var box = el("div", "section notice team-notice");
    box.setAttribute("role", "status");
    news.forEach(function (o) {
      var p = el("p");
      if (o.verificationStatus === "verified") {
        p.appendChild(document.createTextNode("Good news: Sevak verified "));
        p.appendChild(el("strong", null, o.name));
        p.appendChild(document.createTextNode(". Its public events are now listed. "));
        p.appendChild(link("events.html", "See your events", false));
      } else {
        p.appendChild(document.createTextNode("Sevak couldn't verify " + o.name + (o.verification.reason ? ": " + o.verification.reason : ".") + " "));
        p.appendChild(link("organization.html", "Update and ask again", false));
      }
      box.appendChild(p);
    });
    var close = el("button", "btn btn-link", "Dismiss");
    close.type = "button";
    close.addEventListener("click", function () { box.remove(); });
    box.appendChild(close);
    var banner = document.querySelector("main .banner");
    if (banner) banner.insertAdjacentElement("afterend", box);
  }

  // A volunteer sees once when a certificate they asked for is issued or
  // declined (the email is in the outbox too).
  function announceCertificates() {
    if (!F.session.signedIn() || page() === "certificate.html") return;
    var me = String((F.session.profile() || {}).email || "").toLowerCase();
    var certs = (F.load("sevak.certificates.v1") || []).filter(function (c) {
      return String(c.email).toLowerCase() === me && (c.status === "issued" || c.status === "declined");
    });
    var seen = F.load(SEEN_CERTS_KEY);
    seen = seen && typeof seen === "object" ? seen : {};
    var news = certs.filter(function (c) { return seen[c.id] !== c.status; });
    if (!news.length) return;
    news.forEach(function (c) { seen[c.id] = c.status; });
    F.store(SEEN_CERTS_KEY, seen);
    var box = el("div", "section notice team-notice");
    box.setAttribute("role", "status");
    news.forEach(function (c) {
      var org = O.get(c.orgId);
      var name = org ? org.name : "The organization";
      var p = el("p");
      if (c.status === "issued") {
        p.appendChild(document.createTextNode("Your certificate from "));
        p.appendChild(el("strong", null, name));
        p.appendChild(document.createTextNode(" is ready. "));
        p.appendChild(link("certificate.html?id=" + encodeURIComponent(c.id), "View your certificate", false));
      } else {
        p.appendChild(document.createTextNode(name + " didn't issue the certificate you asked for" + (c.reason ? ": " + c.reason : ".") + " "));
        p.appendChild(link("signup.html?view=mine#certificates", "Your certificates", false));
      }
      box.appendChild(p);
    });
    var close = el("button", "btn btn-link", "Dismiss");
    close.type = "button";
    close.addEventListener("click", function () { box.remove(); });
    box.appendChild(close);
    var banner = document.querySelector("main .banner");
    if (banner) banner.insertAdjacentElement("afterend", box);
  }

  // ---------- Access to the Manage pages ----------

  // opts.org: the organization the page is about (for one event), if any.
  // opts.creating: setting up a new organization, which anyone signed in can do.
  // Returns true when the page may show; otherwise shows the way in instead.
  function guard(opts) {
    opts = opts || {};
    if (!F.session.signedIn()) {
      var banner = document.querySelector("main .banner");
      if (banner && !banner.querySelector(".preview-note")) {
        banner.insertBefore(el("span", "preview-note", " You're not signed in, so you're previewing this page. In the live app, only an organization's team can open it."), banner.querySelector(".banner-close"));
        banner.hidden = false;
      }
      return true;
    }
    if (opts.creating) return true;
    if (opts.org ? O.roleFor(opts.org) : O.myTeams().length) return true;
    showWayIn(opts.org);
    return false;
  }

  function showWayIn(org) {
    var main = document.querySelector("main");
    Array.prototype.forEach.call(main.children, function (child) {
      if (!child.classList.contains("banner") && !child.classList.contains("team-notice")) child.hidden = true;
    });
    var hasTeams = O.myTeams().length > 0;
    var box = el("section", "way-in");
    box.setAttribute("aria-labelledby", "way-in-title");
    var h1 = el("h1", "page-title", org ? "You're not on this team" : "Manage an organization");
    h1.id = "way-in-title";
    box.appendChild(h1);
    box.appendChild(el("p", "page-intro", org
      ? "Only the Admins and Coordinators of " + (org.name || "this organization") + " can edit its events, and you're not on its team. Volunteering with an organization doesn't include editing its events."
      : "You're not on an organization's team yet. There are two ways to start."));
    // The demo organizations: let people try the Manage pages straight away.
    var me = F.session.profile() || {};
    if (org && /^demo-/.test(org.id) && me.email) {
      var demo = el("p", "way-in-demo");
      demo.appendChild(document.createTextNode("This is a demo organization. "));
      var add = el("button", "btn btn-primary btn-small", "Add me to its team as an Admin");
      add.type = "button";
      add.addEventListener("click", function () {
        var fresh = O.get(org.id) || org;
        var team = (fresh.team || []).filter(function (m) { return String(m.email).toLowerCase() !== String(me.email).toLowerCase(); });
        team.push({ name: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email, email: me.email, role: "admin" });
        O.save(Object.assign({}, fresh, { team: team }));
        location.reload();
      });
      demo.appendChild(add);
      box.appendChild(demo);
    }

    var doors = el("div", "way-in-doors");
    var create = el("div", "section way-in-door");
    create.appendChild(el("h2", "section-title", "Start a new organization"));
    create.appendChild(el("p", "section-help", "Run volunteer events for a group? Set it up and you'll be its Admin."));
    var go = link("organization.html?new=1", "Set up your organization", false);
    go.className = "btn btn-primary";
    create.appendChild(go);
    doors.appendChild(create);

    var join = el("div", "section way-in-door");
    join.appendChild(el("h2", "section-title", "Join an existing organization"));
    var p = el("p", "section-help");
    p.appendChild(document.createTextNode("Ask one of its Admins to add "));
    p.appendChild(el("strong", null, (F.session.profile() || {}).email || "your email"));
    p.appendChild(document.createTextNode(" on their Team tab. The Manage links then appear (under ⋯ on the volunteer pages)."));
    join.appendChild(p);
    doors.appendChild(join);
    box.appendChild(doors);

    var back = el("p", "way-in-back");
    if (hasTeams) {
      back.appendChild(link("events.html", "Go to your organizations' events", false));
      back.appendChild(document.createTextNode(" · "));
    }
    back.appendChild(link("signup.html", "Back to volunteer opportunities", false));
    box.appendChild(back);
    main.appendChild(box);
    document.title = (org ? "Not on this team" : "Manage an organization") + " · Sevak";
  }

  render();
  setupBanner();
  announceTeams();
  announceMemberships();
  announceVerification();
  announceCertificates();
  if (M) render();   // invitations accepted just now change the counts

  // ---------- "Saved" after leaving a form ----------
  // Saving a form takes you back to where it belongs (staying on the form
  // makes people press Save again). The page leaving sets a one-time
  // message; the next page shows it at the top, highlights what was saved
  // and moves keyboard focus to the message so it's announced.

  var FLASH_KEY = "sevak.flash.v1";

  // message: the text; opts: { href, linkText } a link (e.g. open it again),
  // { highlight } a CSS selector for what was saved on the next page.
  function flashAndGo(url, message, opts) {
    opts = opts || {};
    try {
      sessionStorage.setItem(FLASH_KEY, JSON.stringify({ text: message, href: opts.href || "", linkText: opts.linkText || "", highlight: opts.highlight || "" }));
    } catch (e) { /* storage blocked: still go */ }
    location.href = url;
  }

  function showFlash() {
    var f = null;
    try {
      f = JSON.parse(sessionStorage.getItem(FLASH_KEY));
      sessionStorage.removeItem(FLASH_KEY);
    } catch (e) { return; }
    if (!f || !f.text) return;
    var main = document.querySelector("main");
    if (!main) return;
    var box = el("div", "section notice saved-flash");
    box.id = "saved-flash";
    box.setAttribute("role", "status");
    box.tabIndex = -1;
    var p = el("p");
    p.appendChild(el("span", "saved-flash-icon", "✓"));
    p.firstChild.setAttribute("aria-hidden", "true");
    p.appendChild(el("strong", null, f.text));
    // Only a page of this app (page.html?...), never another site or a script.
    if (f.href && /^[\w-]+\.html(\?[^#]*)?(#[\w-]*)?$/.test(f.href)) {
      p.appendChild(document.createTextNode(" "));
      p.appendChild(link(f.href, f.linkText || "Open it", false));
    }
    box.appendChild(p);
    var close = el("button", "btn btn-link", "Dismiss");
    close.type = "button";
    close.addEventListener("click", function () { box.remove(); });
    box.appendChild(close);
    var banner = main.querySelector(".banner");
    if (banner) banner.insertAdjacentElement("afterend", box);
    else main.insertBefore(box, main.firstChild);
    // After the page has drawn its content.
    document.addEventListener("DOMContentLoaded", function () {
      if (f.highlight) {
        var item = null;
        try { item = document.querySelector(f.highlight); } catch (e) { /* bad selector */ }
        if (item) item.classList.add("just-saved");
      }
      box.focus();
    });
  }

  showFlash();

  window.SevakNav = { render: render, guard: guard, flashAndGo: flashAndGo };
})();
