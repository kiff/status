// Builds the status page into public/: node build.mjs
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { incident, maintenance, page, parseDoc } from "./lib.mjs";

const read = (f) => readFileSync(f, "utf8");
const docs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => [join(dir, f), parseDoc(read(join(dir, f)), join(dir, f))])
    : [];

const { services } = JSON.parse(read("services.json"));
const ids = services.map((s) => s.id);
const checks = existsSync("checks/status.json") ? JSON.parse(read("checks/status.json")) : { services: {} };
const incidents = docs("incidents").map(([f, d]) => incident(d, f, ids));
const windows = docs("maintenance").map(([f, d]) => maintenance(d, f, ids));

mkdirSync("public", { recursive: true });
writeFileSync("public/index.html", page({ services, checks, incidents, windows, now: new Date() }));
copyFileSync("style.css", "public/style.css");
console.log(`built public/: ${services.length} services, ${incidents.length} incidents, ${windows.length} maintenance windows`);
