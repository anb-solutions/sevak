// The prototype outbox: every email Sevak would have sent (see
// SevakMembers.email). Newest first; links open the page the email points to.
(function () {
  "use strict";

  var F = window.SevakForms;
  var M = window.SevakMembers;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // With Sevak's server, emails are sent for real.
  if (window.SevakServer) {
    document.querySelector(".page-intro").textContent = "Sevak now sends these emails for real: invitations, approvals, sign-up confirmations, certificates and more. Nothing is kept here anymore.";
  }

  function render() {
    var mails = M.outbox();
    var list = $("mail-list");
    list.innerHTML = "";
    mails.forEach(function (m) {
      var li = el("li", "mail");
      var head = el("div", "mail-head");
      head.appendChild(el("strong", "mail-subject", m.subject));
      var sent = "";
      try { sent = new Date(m.sentAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { /* ignore */ }
      head.appendChild(el("span", "hint", sent));
      li.appendChild(head);
      li.appendChild(el("p", "mail-to", "To: " + m.to));
      li.appendChild(el("p", "mail-body", m.body));
      if (m.link) {
        var a = el("a", "btn btn-secondary btn-small", m.linkText || "Open link");
        a.href = m.link;
        li.appendChild(a);
        if (/^https?:/.test(m.link)) li.appendChild(el("p", "hint mail-link", m.link));
      }
      list.appendChild(li);
    });
    $("mail-empty").hidden = mails.length > 0;
    $("clear-outbox").hidden = !mails.length;
  }

  $("clear-outbox").addEventListener("click", function () {
    if (!window.confirm("Clear all emails from the outbox?")) return;
    F.clear("sevak.outbox.v1");
    render();
  });

  render();
})();
