// Sign in. With Sevak's server (window.SevakServer, from the web app's
// sync.js) this emails a 6-digit code and a link: enter the code here, or
// open the link on this device. Without it (the plain prototype) it matches
// the email against the profile saved in this browser.
(function () {
  "use strict";

  var F = window.SevakForms;
  var server = window.SevakServer;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("signin-form");
  var email = $("email");

  F.clearErrorsAsYouType(form, F.basicMessage);

  if (!server) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var invalid = F.validate([email], F.basicMessage);
      if (invalid) { invalid.focus(); return; }
      var profile = F.load("sevak.profile.v1");
      var saved = profile && profile.email ? String(profile.email).trim().toLowerCase() : "";
      if (saved && saved === email.value.trim().toLowerCase()) {
        // Registered volunteers go straight to the opportunities list.
        F.session.signIn();
        window.location.href = "signup.html";
        return;
      }
      F.setError(email, "We couldn't find a profile with that email in this browser. Check it, or sign up.");
      email.focus();
    });
    return;
  }

  // ---------- With the server ----------

  var codeForm = $("code-form");
  var code = $("code");
  $("prototype-note").hidden = true;
  document.querySelector(".page-intro").textContent = "Enter your email. We'll send you a code to sign in. No password needed.";

  // Where to go next: ?next=page.html (a page in this app only), else your
  // profile if it's not filled in yet, else volunteer opportunities.
  function nextPage(hasProfile) {
    var next = new URLSearchParams(location.search).get("next") || "";
    if (/^[a-z-]+\.html$/.test(next)) return next;
    return hasProfile ? "signup.html" : "profile.html";
  }

  // Already signed in: on to your page (or your profile, if it isn't filled in).
  if (server.user) {
    location.replace(nextPage(F.session.signedIn()));
    return;
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    }, function () { return { status: 0, data: {} }; });
  }

  function busy(button, on) {
    button.disabled = on;
    button.setAttribute("aria-busy", on ? "true" : "false");
  }

  function signedIn(data) {
    location.href = nextPage(data.hasProfile);
  }

  // Continue with Google, when it's set up on the server.
  var params = new URLSearchParams(location.search);
  if (server.signIn && server.signIn.google) {
    $("google-signin").hidden = false;
    var next = params.get("next");
    if (next && /^[a-z-]+\.html$/.test(next)) $("google-button").href = "/api/v1/auth/google/start?next=" + encodeURIComponent(next);
  }
  var GOOGLE_ERRORS = {
    google_use_email: "That Google account doesn't use a Gmail or Google Workspace address, so sign in with a code sent to your email instead.",
    google_cancelled: "Google sign-in was cancelled. Try again, or use your email.",
    google_failed: "Google sign-in didn't work. Try again, or use your email.",
    google_off: "Google sign-in isn't available here yet. Use your email."
  };
  var error = GOOGLE_ERRORS[params.get("error")];
  if (error) {
    var note = document.createElement("p");
    note.className = "error";
    note.setAttribute("role", "alert");
    note.textContent = error;
    form.insertBefore(note, form.firstChild);
  }

  // Opened from the emailed link: #token=…
  var token = (location.hash.match(/token=([A-Za-z0-9_-]+)/) || [])[1];
  if (token) {
    history.replaceState(null, "", location.pathname + location.search);
    document.querySelector(".page-intro").textContent = "Signing you in…";
    post("/api/v1/auth/verify", { token: token }).then(function (res) {
      if (res.status === 200) return signedIn(res.data);
      document.querySelector(".page-intro").textContent = "That sign-in link has expired or was already used. Enter your email for a new one.";
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var invalid = F.validate([email], F.basicMessage);
    if (invalid) { invalid.focus(); return; }
    var button = $("signin-submit");
    busy(button, true);
    post("/api/v1/auth/request", { email: email.value.trim() }).then(function (res) {
      busy(button, false);
      if (res.status === 200) {
        form.hidden = true;
        codeForm.hidden = false;
        $("code-sent").textContent = "We emailed a code to " + email.value.trim() + ". Enter it here, or open the link in the email on this device.";
        code.value = "";
        code.focus();
        return;
      }
      F.setError(email, res.status === 429
        ? "Too many sign-in emails. Wait a few minutes, then try again."
        : res.status === 400 ? "Enter a valid email address."
        : "We couldn't send the email just now. Try again in a minute.");
      email.focus();
    });
  });

  code.addEventListener("input", function () {
    code.value = code.value.replace(/\D/g, "").slice(0, 6);
    F.setError(code, "");
  });

  codeForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.value)) { F.setError(code, "Enter the 6 digits from the email."); code.focus(); return; }
    var button = $("code-submit");
    busy(button, true);
    post("/api/v1/auth/verify", { email: email.value.trim(), code: code.value }).then(function (res) {
      if (res.status === 200) return signedIn(res.data);
      busy(button, false);
      F.setError(code, res.status === 429
        ? "Too many tries. Wait a few minutes, then try again."
        : "That code didn't work. Check it, or go back and get a new one.");
      code.focus();
    });
  });

  $("code-back").addEventListener("click", function () {
    codeForm.hidden = true;
    form.hidden = false;
    email.focus();
  });
})();
