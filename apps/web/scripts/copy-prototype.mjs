// Copies the static prototype (index.html, legal pages and app/) into
// public/ so the web app serves it during the beta. public/ is not committed;
// edit the originals at the repository root.
//
// It also adds prototype/sync.js to the top of each page, which keeps the
// pages' saved data on the server instead of only in the browser.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "..", "..");
const out = join(web, "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of ["index.html", "privacy.html", "terms.html"]) cpSync(join(root, file), join(out, file));
cpSync(join(root, "app"), join(out, "app"), { recursive: true });
cpSync(join(web, "prototype", "sync.js"), join(out, "app", "sync.js"));

// Before any other script, so pages start from the server's data.
const tag = '<script src="/app/sync.js"></script>';
const pages = ["index.html", ...readdirSync(join(out, "app")).filter((f) => f.endsWith(".html")).map((f) => join("app", f))];
for (const page of pages) {
  const path = join(out, page);
  const html = readFileSync(path, "utf8");
  const at = html.indexOf("<meta charset");
  const end = at === -1 ? -1 : html.indexOf(">", at) + 1;
  if (end <= 0) throw new Error(`${page} has no <meta charset>, so sync.js can't be added.`);
  writeFileSync(path, `${html.slice(0, end)}\n  ${tag}${html.slice(end)}`);
}
console.log(`Copied the prototype into apps/web/public (sync.js added to ${pages.length} pages).`);
