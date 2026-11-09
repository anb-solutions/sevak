// Shared helpers for prototype forms: browser storage, field validation,
// countries, international phone numbers and WhatsApp links.
(function () {
  "use strict";

  // ---------- Storage ----------

  function load(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function store(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ---------- Countries ----------

  var displayNames = null;
  try {
    displayNames = new Intl.DisplayNames(navigator.languages || [navigator.language], { type: "region" });
  } catch (e) { /* older browsers fall back to English names */ }

  var COUNTRIES = (window.SevakCountryData || []).map(function (row) {
    var parts = row.split("|");
    var name = parts[1];
    try {
      var local = displayNames && displayNames.of(parts[0]);
      if (local && local !== parts[0]) name = local;
    } catch (e) { /* keep English name */ }
    return { code: parts[0], name: name, dial: parts[2] };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  var BY_CODE = {};
  COUNTRIES.forEach(function (c) { BY_CODE[c.code] = c; });

  // Best guess at the visitor's country from their browser language
  // (for example "en-GB" → GB). Empty if the browser doesn't say.
  function defaultCountry() {
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var match = /[-_]([A-Za-z]{2})\b/.exec(langs[i] || "");
      if (match && BY_CODE[match[1].toUpperCase()]) return match[1].toUpperCase();
    }
    return "";
  }

  function fillCountrySelect(select, labelFor) {
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose…";
    select.appendChild(placeholder);
    COUNTRIES.forEach(function (c) {
      var option = document.createElement("option");
      option.value = c.code;
      option.textContent = labelFor(c);
      select.appendChild(option);
    });
    select.value = defaultCountry();
  }

  // ---------- Postal codes ----------

  // Formats for some countries; everywhere else gets a lenient check.
  // Some countries don't use postal codes, so the field is never required.
  var POSTAL_FORMATS = {
    US: [/^\d{5}(-\d{4})?$/, "a 5-digit ZIP code, like 94110"],
    CA: [/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, "a postal code like K1A 0B1"],
    GB: [/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/, "a postcode like SW1A 1AA"],
    IN: [/^\d{6}$/, "a 6-digit PIN code"],
    AU: [/^\d{4}$/, "a 4-digit postcode"],
    DE: [/^\d{5}$/, "a 5-digit postcode"],
    FR: [/^\d{5}$/, "a 5-digit postal code"]
  };

  function postalMessage(country, value) {
    var format = POSTAL_FORMATS[country];
    if (format) return format[0].test(value) ? "" : "Enter " + format[1] + ".";
    return /^[A-Za-z0-9][A-Za-z0-9 \-]{1,11}$/.test(value) ? "" : "Enter a valid postal code.";
  }

  // ---------- Phone numbers ----------

  // Countries where the leading 0 is part of the international number.
  var KEEP_LEADING_ZERO = { IT: true, VA: true, SM: true };

  function countrySelectFor(input) {
    return document.getElementById(input.id + "-country");
  }

  // Turns what the person typed into international (E.164) form, e.g.
  // "07911 123456" with GB → "+447911123456". Returns "" if it can't.
  function toE164(country, raw) {
    var v = (raw || "").trim();
    var digits = v.replace(/\D/g, "");
    if (!digits) return "";
    if (v.charAt(0) === "+") return "+" + digits;
    var c = BY_CODE[country];
    if (!c) return "";
    if (c.dial === "1" && digits.length === 11 && digits.charAt(0) === "1") {
      digits = digits.slice(1);
    } else if (!KEEP_LEADING_ZERO[country]) {
      digits = digits.replace(/^0+/, "");
    }
    return "+" + c.dial + digits;
  }

  function phoneMessage(input) {
    var v = input.value.trim();
    if (!v) return "";
    if (!/^\+?[0-9().\-\s]+$/.test(v)) return "Use only digits, spaces and + ( ) - .";
    if (v.charAt(0) === "+") {
      var all = v.replace(/\D/g, "").length;
      return all >= 8 && all <= 15 ? "" : "Enter a full international number, like +44 7911 123456.";
    }
    var select = countrySelectFor(input);
    var country = select ? select.value : "";
    if (!country) return "Choose a country code.";
    var e164 = toE164(country, v);
    var dial = BY_CODE[country].dial;
    var national = e164.length - 1 - dial.length;
    if (dial === "1" && national !== 10) return "Enter a 10-digit number.";
    if (national < 4 || e164.length - 1 > 15) return "Enter a valid phone number.";
    return "";
  }

  function whatsappLink(e164) {
    return "https://wa.me/" + e164.replace(/\D/g, "");
  }

  function updateWhatsappLink(input) {
    var box = document.getElementById(input.id + "-whatsapp");
    var link = document.getElementById(input.id + "-walink");
    if (!box || !link) return;
    var select = countrySelectFor(input);
    var e164 = phoneMessage(input) ? "" : toE164(select ? select.value : "", input.value);
    var show = box.checked && !!e164;
    link.hidden = !show;
    if (show) {
      link.href = whatsappLink(e164);
      link.textContent = "wa.me/" + e164.slice(1);
    }
  }

  // Adds a country-code picker before a phone input and a "This number is
  // on WhatsApp" option after it. The input needs an id.
  function enhancePhone(input) {
    var group = document.createElement("div");
    group.className = "phone-group";
    var select = document.createElement("select");
    select.id = input.id + "-country";
    select.autocomplete = "tel-country-code";
    var label = document.querySelector('label[for="' + input.id + '"]');
    var labelText = label ? label.textContent.replace(/\(optional\)/, "").trim() : "Phone";
    select.setAttribute("aria-label", "Country code for " + labelText.toLowerCase());
    fillCountrySelect(select, function (c) { return c.name + " (+" + c.dial + ")"; });
    input.parentNode.insertBefore(group, input);
    group.appendChild(select);
    var numberWrap = document.createElement("span");
    numberWrap.className = "phone-number";
    var prefix = document.createElement("span");
    prefix.className = "phone-prefix";
    prefix.id = input.id + "-prefix";
    prefix.setAttribute("aria-hidden", "true");
    numberWrap.appendChild(prefix);
    numberWrap.appendChild(input);
    group.appendChild(numberWrap);
    input.placeholder = "Phone number";
    input.autocomplete = input.autocomplete === "tel" ? "tel-national" : input.autocomplete;

    var wa = document.createElement("div");
    wa.className = "whatsapp";
    wa.innerHTML =
      '<label><input type="checkbox" id="' + input.id + '-whatsapp"> This number is on WhatsApp</label>' +
      '<a id="' + input.id + '-walink" target="_blank" rel="noopener" hidden></a>';
    group.parentNode.insertBefore(wa, group.nextSibling);

    var refresh = function () {
      var c = BY_CODE[select.value];
      prefix.textContent = c ? "+" + c.dial : "+";
      updateWhatsappLink(input);
    };
    refresh();
    select.addEventListener("change", function () {
      refresh();
      if (input.getAttribute("aria-invalid") === "true" && !phoneMessage(input)) setError(input, "");
    });
    input.addEventListener("input", refresh);
    wa.querySelector("input").addEventListener("change", refresh);
  }

  // Reads an enhanced phone input. Returns null when it's empty.
  function phoneValue(input) {
    var select = countrySelectFor(input);
    var e164 = toE164(select ? select.value : "", input.value);
    if (!e164) return null;
    var box = document.getElementById(input.id + "-whatsapp");
    return { country: select ? select.value : "", number: e164, whatsapp: !!(box && box.checked) };
  }

  // Fills an enhanced phone input from a saved value. Older saves stored
  // the number as plain text, which is shown as typed.
  function setPhone(input, value) {
    if (!value) return;
    var select = countrySelectFor(input);
    if (typeof value === "string") {
      input.value = value;
    } else {
      if (select && value.country) {
        select.value = value.country;
        select.dispatchEvent(new Event("change"));
      }
      var c = BY_CODE[value.country];
      var prefix = c ? "+" + c.dial : "";
      input.value = prefix && value.number.indexOf(prefix) === 0 ? value.number.slice(prefix.length) : value.number;
      var box = document.getElementById(input.id + "-whatsapp");
      if (box) box.checked = !!value.whatsapp;
    }
    updateWhatsappLink(input);
  }

  function resetPhone(input) {
    var select = countrySelectFor(input);
    if (select) {
      select.value = defaultCountry();
      select.dispatchEvent(new Event("change"));
    }
  }

  // ---------- Validation ----------

  // Shows or clears the message in the element with id "<field id>-error"
  // (or "<field name>-error" for radio groups).
  function setError(input, message) {
    var errorEl = document.getElementById(input.id + "-error") ||
      document.getElementById(input.name + "-error");
    if (message) {
      input.setAttribute("aria-invalid", "true");
      if (errorEl) {
        errorEl.textContent = message;
        input.setAttribute("aria-describedby", errorEl.id);
      }
    } else {
      input.removeAttribute("aria-invalid");
      if (errorEl) errorEl.textContent = "";
    }
  }

  // Checks shared by every form: required fields, radio groups, email,
  // phone and postal code.
  function basicMessage(input) {
    var v = input.value.trim();

    if (input.type === "radio") {
      var group = input.form.querySelectorAll('input[name="' + input.name + '"]');
      var picked = Array.prototype.some.call(group, function (r) { return r.checked; });
      return picked ? "" : "Choose one option.";
    }
    if (input.required && !v) {
      return input.tagName === "SELECT" ? "Choose an option." : "This field is required.";
    }
    if (!v) return "";
    if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return "Enter an email address like name@example.com.";
    }
    if (input.type === "tel") return phoneMessage(input);
    if (input.dataset.postal !== undefined) {
      var countrySelect = document.getElementById(input.dataset.country);
      return postalMessage(countrySelect ? countrySelect.value : "", v);
    }
    return "";
  }

  // Validates the given inputs with messageFor, shows errors, and returns the
  // first invalid input (or null). Hidden inputs are skipped and cleared.
  function validate(inputs, messageFor) {
    var firstInvalid = null;
    var seenRadio = {};
    Array.prototype.forEach.call(inputs, function (input) {
      if (input.closest("[hidden]")) { setError(input, ""); return; }
      if (input.type === "radio") {
        if (seenRadio[input.name]) return;
        seenRadio[input.name] = true;
      }
      var msg = messageFor(input);
      setError(input, msg);
      if (msg && !firstInvalid) firstInvalid = input;
    });
    return firstInvalid;
  }

  // Clears a field's error as soon as it becomes valid.
  function clearErrorsAsYouType(form, messageFor) {
    form.addEventListener("input", function (e) {
      var t = e.target;
      if (t.getAttribute("aria-invalid") === "true" && !messageFor(t)) setError(t, "");
    });
    form.addEventListener("change", function (e) {
      var t = e.target;
      if (t.type === "radio") {
        var errorEl = document.getElementById(t.name + "-error");
        if (errorEl) errorEl.textContent = "";
      }
    });
  }

  // ---------- Simple page tabs ----------
  // For pages split into a few views (for example details and documents).
  // Panels are found by aria-controls; the selected tab is kept in the URL
  // hash. Without one, `defaultKey` (or the first tab) is shown.

  function pageTabs(tablist, onChange, defaultKey) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var key = function (t) { return t.id.replace(/^tab-/, ""); };
    function show(k, focus) {
      var known = function (x) { return tabs.some(function (t) { return key(t) === x; }); };
      if (!known(k)) k = known(defaultKey) ? defaultKey : key(tabs[0]);
      tabs.forEach(function (t) {
        var on = key(t) === k;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).classList.toggle("is-hidden", !on);
        if (on && focus) t.focus();
      });
      if (onChange) onChange(k);
      return k;
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () {
        history.replaceState(null, "", location.search + "#" + show(key(t)));
      });
      t.addEventListener("keydown", function (e) {
        var n = null;
        if (e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
        else if (e.key === "ArrowLeft") n = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === "Home") n = tabs[0];
        else if (e.key === "End") n = tabs[tabs.length - 1];
        if (!n) return;
        e.preventDefault();
        history.replaceState(null, "", location.search + "#" + show(key(n), true));
      });
    });
    show(location.hash.replace("#", ""));
    window.addEventListener("hashchange", function () { show(location.hash.replace("#", "")); });
    return { show: show };
  }

  // ---------- Sign-in (prototype) ----------
  // There is no server yet. You count as registered when a profile is saved
  // in this browser, and as signed in until you choose Sign out. The index
  // page has its own copy of signedIn() so it can redirect before it draws.

  var PROFILE_KEY = "sevak.profile.v1";
  var SIGNED_OUT_KEY = "sevak.signedOut.v1";

  // On Sevak's server (sync.js sets window.SevakServer), you're signed in
  // when the server says so, even before your profile is saved; until then
  // your profile is just your email.
  var serverUser = function () { return window.SevakServer ? window.SevakServer.user || null : undefined; };

  var session = {
    // Your saved profile, if any.
    saved: function () {
      var p = load(PROFILE_KEY);
      return p && p.email ? p : null;
    },
    profile: function () {
      var p = session.saved();
      var user = serverUser();
      if (!p && user && user.email) return { email: user.email };
      return p;
    },
    signedIn: function () {
      var user = serverUser();
      if (user !== undefined) return !!user;
      return !!session.profile() && load(SIGNED_OUT_KEY) !== true;
    },
    signIn: function () { clear(SIGNED_OUT_KEY); },
    signOut: function () { store(SIGNED_OUT_KEY, true); }
  };

  window.SevakForms = {
    load: load,
    store: store,
    clear: clear,
    countries: COUNTRIES,
    defaultCountry: defaultCountry,
    fillCountrySelect: function (select) { fillCountrySelect(select, function (c) { return c.name; }); },
    enhancePhone: enhancePhone,
    phoneValue: phoneValue,
    setPhone: setPhone,
    resetPhone: resetPhone,
    toE164: toE164,
    whatsappLink: whatsappLink,
    setError: setError,
    basicMessage: basicMessage,
    validate: validate,
    clearErrorsAsYouType: clearErrorsAsYouType,
    session: session,
    pageTabs: pageTabs
  };
})();
