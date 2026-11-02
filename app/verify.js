// Check a certificate (prototype): verify.html?code=SVK-XXXX-XXXX.
// Shows only what proves it: the volunteer's name, the organization, the
// period, the hours, the events and when it was issued (ATT-6).
(function () {
  "use strict";

  var F = window.SevakForms;
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

  function check(code) {
    var box = $("verify-result");
    box.innerHTML = "";
    var rec = C.byCode(code);
    box.hidden = false;
    box.classList.toggle("is-genuine", !!rec);
    if (!rec) {
      box.appendChild(el("h2", "section-title", "Not found"));
      box.appendChild(el("p", null, "We couldn't find a certificate numbered " + code + ". Check the number, or ask the organization that issued it."));
      return;
    }
    var d = rec.data;
    box.appendChild(el("h2", "section-title", "✓ Genuine certificate"));
    var dl = el("dl", "verify-facts");
    [["Volunteer", d.volunteer], ["Organization", d.org.name], ["Period", day(d.from) + " – " + day(d.to)],
      ["Approved hours", C.durationLabel(d.minutes) + " over " + E.plural(d.shifts, "shift")],
      ["Events", d.events.map(function (e) { return e.title; }).join(", ")],
      ["Issued", day(rec.issuedAt.slice(0, 10)) + " · No. " + rec.code]].forEach(function (row) {
      dl.appendChild(el("dt", null, row[0]));
      dl.appendChild(el("dd", null, row[1]));
    });
    box.appendChild(dl);
  }

  function normalize(v) { return String(v || "").trim().toUpperCase().replace(/\s+/g, ""); }

  $("verify-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = normalize($("code").value);
    F.setError($("code"), code ? "" : "Enter the certificate number.");
    if (!code) { $("code").focus(); return; }
    history.replaceState(null, "", "?code=" + encodeURIComponent(code));
    check(code);
    $("verify-result").focus();
  });

  var start = normalize(new URLSearchParams(location.search).get("code"));
  if (start) {
    $("code").value = start;
    check(start);
  }
})();
