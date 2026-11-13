// Where sign-in may send you afterwards: a page of this app, optionally with
// one simple parameter, and never anywhere else.
import { describe, expect, it } from "vitest";
import { safeNext } from "./google";

describe("safeNext", () => {
  it("keeps a page of this app, with one simple parameter", () => {
    expect(safeNext("events.html")).toBe("events.html");
    expect(safeNext("roster.html?event=event-mx81k2abc")).toBe("roster.html?event=event-mx81k2abc");
  });

  it("refuses anything else", () => {
    for (const bad of [
      "https://evil.example/x.html",
      "//evil.example/x.html",
      "/app/events.html",
      "../index.html",
      "roster.html?event=a&next=https://evil.example",
      "roster.html?event=<script>",
      "roster.html?event=" + "a".repeat(81),
      "roster.html?Event=x",
      "javascript:alert(1)",
      "events.html#x",
      42,
      null,
    ]) {
      expect(safeNext(bad)).toBe("");
    }
  });
});
