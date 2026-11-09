// A stand-in for Zeffy's API (https://api.zeffy.com/api/docs), so the
// end-to-end tests never call the real Zeffy. run.sh starts it and points
// the app at it (ZEFFY_API_BASE). The key "zeffy-test-key" works; any other
// is refused. POST /__campaign {id, ...fields} changes a campaign, as an
// organization would on Zeffy.
const http = require("http");

const KEY = "zeffy-test-key";
const at = (s) => Math.floor(Date.parse(s) / 1000);
const campaigns = [
  {
    id: "1f0c3a52-0000-4000-8000-000000000001", object: "campaign", type: "ticketing", status: "active",
    title: "Spring Seva Festival", url: "https://www.zeffy.com/en-US/ticketing/spring-seva-festival",
    description: "<p>A day of <strong>music &amp; dance</strong>.</p><ul><li>Lunch served</li></ul>",
    start_date: at("2030-03-14T15:00:00Z"), end_date: at("2030-03-15T22:00:00Z"), deleted_at: null, is_archived: false,
    occurrences: [
      { id: "o1", object: "occurrence", start: at("2030-03-14T15:00:00Z"), end: at("2030-03-14T22:00:00Z"), is_archived: false },
      { id: "o2", object: "occurrence", start: at("2030-03-15T15:00:00Z"), end: at("2030-03-15T22:00:00Z"), is_archived: false },
    ],
  },
  { id: "1f0c3a52-0000-4000-8000-000000000002", object: "campaign", type: "donation_form", status: "active", title: "General donations", deleted_at: null },
];

const server = http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "POST" && req.url === "/__campaign") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const change = JSON.parse(body);
      Object.assign(campaigns.find((c) => c.id === change.id) || {}, change);
      send(200, { ok: true });
    });
    return;
  }
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { type: "authentication_error", code: "invalid_api_key" } });
  const url = new URL(req.url, "http://x");
  const one = url.pathname.match(/^\/api\/v1\/campaigns\/([^/]+)$/);
  if (one) {
    const c = campaigns.find((x) => x.id === one[1]);
    return c ? send(200, c) : send(404, { error: { type: "not_found" } });
  }
  if (url.pathname === "/api/v1/campaigns") return send(200, { object: "list", data: campaigns, has_more: false, next_cursor: null });
  send(404, { error: { type: "not_found" } });
});

server.listen(Number(process.env.PORT || 3199), "127.0.0.1");
