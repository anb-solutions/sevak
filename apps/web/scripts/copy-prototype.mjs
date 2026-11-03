// Copies the static prototype (index.html, legal pages and app/) into
// public/ so the web app serves it during the beta. public/ is not committed;
// edit the originals at the repository root.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "..", "..");
const out = join(web, "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of ["index.html", "privacy.html", "terms.html"]) cpSync(join(root, file), join(out, file));
cpSync(join(root, "app"), join(out, "app"), { recursive: true });
console.log("Copied the prototype into apps/web/public.");
