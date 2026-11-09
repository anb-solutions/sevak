// The welcome page: registered and signed in (a profile saved in this
// browser, and not signed out) goes straight to the volunteer
// opportunities. Loaded at the top of index.html, before it draws.
(function () {
  "use strict";
  try {
    var p = JSON.parse(localStorage.getItem("sevak.profile.v1") || "null");
    var signedOut = localStorage.getItem("sevak.signedOut.v1") === "true";
    if (p && p.email && !signedOut) location.replace("app/signup.html");
  } catch (e) { /* storage blocked: show the welcome page */ }
})();
