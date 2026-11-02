// One certificate (prototype): certificate.html?id=<request id>.
// Issued: the volunteer and the organization's team can see, download and
// print it. Requested: the organization's team sees a preview (signed by
// whoever is looking) and its Admins can issue it from here.
(function () {
  "use strict";

  var F = window.SevakForms;
  var O = window.SevakOrgs;
  var E = window.SevakEvents;
  var C = window.SevakCerts;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function day(date) { return E.dayLabel(date, { weekday: undefined, year: "numeric" }); }
  function stop(message) {
    $("cert-intro").textContent = message;
    $("cert-tools").hidden = true;
  }

  var id = new URLSearchParams(location.search).get("id");
  var rec = id ? C.get(id) : null;
  var org = rec ? O.get(rec.orgId) : null;
  var signedIn = F.session.signedIn();
  var me = signedIn ? F.session.profile() : null;
  var isVolunteer = !!(rec && me && String(me.email).toLowerCase() === String(rec.email).toLowerCase());
  var onTeam = !!(rec && org && signedIn && O.roleFor(org));

  if (onTeam && !isVolunteer) {
    $("cert-back").href = "volunteers.html#cert-requests";
    $("cert-back").textContent = "‹ Volunteers";
  }

  if (!rec) { stop("We couldn't find that certificate. It may have been withdrawn."); return; }
  if (!signedIn) {
    stop("Sign in to see this certificate. Only the volunteer and the organization's team can. Anyone can check one is genuine with its number on the Check a certificate page.");
    return;
  }
  if (!isVolunteer && !onTeam) {
    stop("Only the volunteer and " + (org ? org.name : "the organization") + "'s team can see this certificate.");
    return;
  }

  // ---------- Showing it ----------

  function textVersion(d) {
    var body = $("cert-text-body");
    body.innerHTML = "";
    body.appendChild(el("p", null, d.org.name + " certifies that " + d.volunteer + " volunteered between " + day(d.from) + " and " + day(d.to) +
      ", giving " + C.durationLabel(d.minutes) + " of service over " + E.plural(d.shifts, "shift") + "."));
    if (d.tasks.length) {
      body.appendChild(el("h3", "subhead", "What they did"));
      var ul = el("ul");
      d.tasks.forEach(function (t) { ul.appendChild(el("li", null, t.task + " · " + t.event + " · " + C.durationLabel(t.minutes) + (t.description ? ". " + t.description : ""))); });
      body.appendChild(ul);
    }
    body.appendChild(el("h3", "subhead", "Detail"));
    var table = el("table", "cert-table");
    var head = el("tr");
    ["Date", "Event", "Task", "Time", "Hours"].forEach(function (h) { var th = el("th", null, h); th.scope = "col"; head.appendChild(th); });
    var thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    d.rows.forEach(function (r) {
      var tr = el("tr");
      [E.dayLabel(r.date, { year: "numeric" }), r.event, r.task, r.from && r.to ? E.timeLabel(r.from) + "–" + E.timeLabel(r.to) : "—", C.durationLabel(r.minutes) + (r.adjusted ? " (adjusted)" : "")]
        .forEach(function (v) { tr.appendChild(el("td", null, v)); });
      tbody.appendChild(tr);
    });
    var total = el("tr", "cert-total");
    total.appendChild(el("th", null, "Total"));
    total.firstChild.scope = "row";
    total.firstChild.colSpan = 4;
    total.appendChild(el("td", null, C.durationLabel(d.minutes)));
    tbody.appendChild(total);
    table.appendChild(tbody);
    body.appendChild(table);
    var s = d.signer || {};
    body.appendChild(el("p", null, "Signed by " + [s.name, s.title].filter(Boolean).join(", ") + (d.code ? ". Certificate no. " + d.code + "." : ".")));
    $("cert-text").hidden = false;
  }

  function show(d, opts) {
    $("cert-pages").innerHTML = "";
    return C.render(d, opts).then(function (canvases) {
      canvases.forEach(function (c, i) {
        var img = el("img", "cert-page");
        img.src = c.toDataURL("image/png");
        img.alt = "Certificate" + (canvases.length > 1 ? ", page " + (i + 1) + " of " + canvases.length : "") + ". The text version is below.";
        $("cert-pages").appendChild(img);
      });
      textVersion(d);
      return canvases;
    });
  }

  if (rec.status === "issued") {
    var d = rec.data;
    document.title = "Certificate · " + d.volunteer + " · Sevak";
    $("cert-title").textContent = "Certificate of Volunteer Service";
    $("cert-intro").textContent = "Issued to " + d.volunteer + " by " + d.org.name + " on " + day(rec.issuedAt.slice(0, 10)) + ". No. " + rec.code + ". " +
      (isVolunteer ? "It's also saved in your Documents." : "It's also saved in the volunteer's Documents and the event's Documents.");
    $("cert-tools").hidden = false;
    show(d);
    $("cert-download").addEventListener("click", function () {
      $("cert-status").textContent = "Making the PDF…";
      C.pdfFor(rec).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = C.fileName(d);
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        $("cert-status").textContent = "Downloaded " + C.fileName(d) + ".";
      });
    });
    $("cert-print").addEventListener("click", function () {
      document.body.classList.add("printing-cert");
      window.print();
      setTimeout(function () { document.body.classList.remove("printing-cert"); }, 500);
    });
    window.addEventListener("beforeprint", function () { document.body.classList.add("printing-cert"); });
    window.addEventListener("afterprint", function () { document.body.classList.remove("printing-cert"); });
    return;
  }

  if (rec.status === "declined") {
    $("cert-title").textContent = "Certificate request";
    stop((org ? org.name : "The organization") + " didn't issue this certificate" + (rec.reason ? ": " + rec.reason : ".") + " " + (isVolunteer ? "You can ask again for a different period." : ""));
    return;
  }

  // Requested
  if (!onTeam) {
    $("cert-title").textContent = "Certificate request";
    stop("Your request to " + (org ? org.name : "the organization") + " for " + day(rec.from) + " – " + day(rec.to) + " is waiting for its Admin to issue it. You'll get an email.");
    return;
  }
  var preview = C.preview(rec.id);
  $("cert-title").textContent = "Preview: certificate for " + (rec.name || rec.email);
  document.title = "Preview certificate · Sevak";
  if (!preview.shifts) {
    stop("There are no approved hours between " + day(rec.from) + " and " + day(rec.to) + " yet. Approve the volunteer's hours on the Volunteers page first.");
    return;
  }
  var canIssue = C.canIssue(org);
  $("cert-intro").textContent = "Not issued yet. This is how it will look" + (canIssue ? ", signed by you." : " when an Admin issues it.") +
    " It covers " + C.durationLabel(preview.minutes) + " of approved hours between " + day(rec.from) + " and " + day(rec.to) + ".";
  $("cert-tools").hidden = false;
  $("cert-download").hidden = true;
  $("cert-print").hidden = true;
  $("cert-issue").hidden = !canIssue;
  show(preview, { preview: true });
  $("cert-issue").addEventListener("click", function () {
    $("cert-issue").disabled = true;
    $("cert-status").textContent = "Issuing…";
    C.issue(rec.id).then(function () {
      window.SevakNav.render();
      location.reload();
    }, function () {
      $("cert-issue").disabled = false;
      $("cert-status").textContent = "Couldn't issue the certificate in this browser.";
    });
  });
})();
