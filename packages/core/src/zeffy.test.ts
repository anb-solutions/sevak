// Events from Zeffy: what's copied, and the key kept encrypted.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campaignSummary, eventFieldsFromCampaign, eventFromCampaign, htmlToText, seal, ticketingCampaigns, unseal } from "./zeffy";

const at = (s: string) => Math.floor(Date.parse(s) / 1000);
const festival = {
  id: "c-1",
  type: "ticketing",
  title: "Spring Seva Festival",
  url: "https://www.zeffy.com/en-US/ticketing/spring",
  description: "<p>Music &amp; dance&nbsp;all day.</p><ul><li>Lunch</li><li>Tea</li></ul><script>alert(1)</script>",
  start_date: at("2030-03-14T15:00:00Z"),
  end_date: at("2030-03-15T22:00:00Z"),
  occurrences: [
    { start: at("2030-03-15T15:00:00Z"), end: at("2030-03-15T22:00:00Z") },
    { start: at("2030-03-14T15:00:00Z"), end: at("2030-03-14T22:00:00Z") },
    { start: at("2030-03-20T15:00:00Z"), end: at("2030-03-20T22:00:00Z"), is_archived: true },
  ],
};

describe("from a Zeffy event", () => {
  it("copies the title, plain description, dates in the event's time zone, and link", () => {
    const f = eventFieldsFromCampaign(festival, "America/Chicago");
    expect(f).toMatchObject({ title: "Spring Seva Festival", startDate: "2030-03-14", endDate: "2030-03-15", zeffyUrl: festival.url });
    expect(f.description).toBe("Music & dance all day.\n• Lunch\n• Tea");
    expect(f.dates).toEqual([
      { date: "2030-03-14", start: "10:00", end: "17:00" },
      { date: "2030-03-15", start: "10:00", end: "17:00" },
    ]);
    // Late evening in Chicago is the next day in Kolkata.
    expect(eventFieldsFromCampaign({ ...festival, occurrences: [{ start: at("2030-03-14T23:00:00Z"), end: at("2030-03-15T01:00:00Z") }] }, "Asia/Kolkata").startDate).toBe("2030-03-15");
  });

  it("starts a draft, with the place, roles and shifts left to the team", () => {
    const e = eventFromCampaign(festival, { id: "event-x", org: { id: "org-1", name: "Temple" }, timeZone: "America/Chicago", by: "asha@example.com" });
    expect(e).toMatchObject({ id: "event-x", organizationId: "org-1", status: "draft", roles: [], timezone: "America/Chicago", source: { kind: "zeffy", id: "c-1" } });
  });

  it("lists only events that are still running, not donation forms", () => {
    const list = ticketingCampaigns([festival, { id: "d", type: "donation_form" }, { ...festival, id: "gone", deleted_at: 1 }, { ...festival, id: "old", is_archived: true }]);
    expect(list.map((c) => c.id)).toEqual(["c-1"]);
    expect(campaignSummary(festival, "UTC")).toMatchObject({ id: "c-1", dates: 2, startDate: "2030-03-14" });
  });

  it("only keeps an https link to the Zeffy page", () => {
    expect(eventFieldsFromCampaign({ ...festival, url: "javascript:alert(1)" }, "UTC").zeffyUrl).toBe("");
  });

  it("reads entities without letting markup through", () => {
    expect(htmlToText("&lt;b&gt;hi&lt;/b&gt; &#65;&#x42;")).toBe("<b>hi</b> AB");
  });

  it("turns typographic codes into the characters they stand for", () => {
    expect(htmlToText("1926&ndash;2026. 10:00&ndash;11:00 AM &mdash; it&rsquo;s &ldquo;free&rdquo;&hellip;")).toBe("1926–2026. 10:00–11:00 AM — it’s “free”…");
    expect(htmlToText("Caf&eacute; &Uuml;ber &ntilde; &ccedil; &szlig; &euro;10 &rupee;500")).toBe("Café Über ñ ç ß €10 ₹500");
    expect(htmlToText("10:00&amp;ndash;11:00")).toBe("10:00–11:00");
    expect(htmlToText("&unknownthing; stays")).toBe("&unknownthing; stays");
  });
});

describe("the Zeffy key", () => {
  it("is stored encrypted and only opens with the same secrets key", () => {
    const key = randomBytes(32);
    const sealed = seal(key, "zfy_live_secret");
    expect(sealed).not.toContain("zfy_live_secret");
    expect(unseal(key, sealed)).toBe("zfy_live_secret");
    expect(unseal(randomBytes(32), sealed)).toBeNull();
    expect(unseal(key, sealed.slice(0, -2) + "AA")).toBeNull();
  });
});
