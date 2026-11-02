// Volunteer sign-ups for the prototype, kept in this browser. Each sign-up
// is one volunteer on one shift. The volunteer sign-up page will write
// these; until it exists, the dashboard can add clearly marked samples.
(function () {
  "use strict";

  var KEY = "sevak.signups.v1";
  var F = window.SevakForms;

  function all() {
    var list = F.load(KEY);
    return Array.isArray(list) ? list : [];
  }

  // Confirmed sign-ups for an event, counted by shift id.
  function countsByShift(eventId) {
    var counts = {};
    all().forEach(function (s) {
      if (s.eventId !== eventId || s.status === "cancelled") return;
      counts[s.shiftId] = (counts[s.shiftId] || 0) + 1;
    });
    return counts;
  }

  // Confirmed sign-ups for an event.
  function forEvent(eventId) {
    return all().filter(function (s) { return s.eventId === eventId && s.status !== "cancelled"; });
  }

  // Sign-ups made in one form submission (a "registration").
  function forRegistration(registrationId) {
    return all().filter(function (s) { return s.registrationId === registrationId; });
  }

  // True if this email already has a confirmed place on the shift.
  function isSignedUp(email, shiftId) {
    var e = (email || "").trim().toLowerCase();
    return all().some(function (s) {
      return s.shiftId === shiftId && s.status !== "cancelled" && (s.email || "").toLowerCase() === e;
    });
  }

  // Merges fields into one sign-up, for example check-in times and hours.
  function update(id, patch) {
    return F.store(KEY, all().map(function (s) {
      return s.id === id ? Object.assign({}, s, patch, { updatedAt: new Date().toISOString() }) : s;
    }));
  }

  function cancel(id) {
    return F.store(KEY, all().map(function (s) {
      return s.id === id ? Object.assign({}, s, { status: "cancelled", cancelledAt: new Date().toISOString() }) : s;
    }));
  }

  // ---------- Hours approval ----------
  // A volunteer's logged hours ({ minutes, from, to, method, loggedAt }) wait
  // for the event's admin: status "pending", then "approved" (possibly with
  // approvedMinutes, if adjusted) or "rejected" (with a reason). Only
  // approved hours count toward certificates.

  function hoursStatus(s) {
    if (!s || !s.hours || !s.hours.minutes) return null;
    return s.hours.status === "approved" || s.hours.status === "rejected" ? s.hours.status : "pending";
  }

  // Minutes credited: the approved (or adjusted) hours, else 0.
  function creditedMinutes(s) {
    if (hoursStatus(s) !== "approved") return 0;
    return s.hours.approvedMinutes != null ? s.hours.approvedMinutes : s.hours.minutes;
  }

  // decision: { status: "approved" | "rejected", minutes, reason, by }
  function decideHours(id, decision) {
    var found = null;
    var ok = F.store(KEY, all().map(function (s) {
      if (s.id !== id || !s.hours) return s;
      var h = Object.assign({}, s.hours, {
        status: decision.status,
        approvedMinutes: decision.status === "approved" && decision.minutes != null && decision.minutes !== s.hours.minutes ? decision.minutes : undefined,
        reason: decision.status === "rejected" ? String(decision.reason || "").trim().slice(0, 300) : undefined,
        decidedAt: new Date().toISOString(),
        decidedBy: decision.by || ""
      });
      found = Object.assign({}, s, { hours: h, updatedAt: new Date().toISOString() });
      return found;
    }));
    return ok ? found : null;
  }

  // Confirmed sign-ups with hours waiting, for some events.
  function pendingHours(eventIds) {
    return all().filter(function (s) {
      return s.status !== "cancelled" && hoursStatus(s) === "pending" && eventIds.indexOf(s.eventId) !== -1;
    });
  }

  function addMany(list) {
    return F.store(KEY, all().concat(list));
  }

  function removeSamples() {
    return F.store(KEY, all().filter(function (s) { return !s.sample; }));
  }

  function hasSamples() {
    return all().some(function (s) { return s.sample; });
  }

  window.SevakSignups = {
    all: all,
    countsByShift: countsByShift,
    update: update,
    forEvent: forEvent,
    forRegistration: forRegistration,
    isSignedUp: isSignedUp,
    cancel: cancel,
    addMany: addMany,
    removeSamples: removeSamples,
    hasSamples: hasSamples,
    hoursStatus: hoursStatus,
    creditedMinutes: creditedMinutes,
    decideHours: decideHours,
    pendingHours: pendingHours
  };
})();
