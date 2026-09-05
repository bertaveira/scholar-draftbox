import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve("dist/client");
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const files = (await walk(root)).filter((f) => !f.endsWith("/phone-preview.json") && !f.endsWith("/sw.js") && !f.endsWith(".map")).sort();
const urls = files.map((f) => "/" + path.relative(root, f).split(path.sep).join("/"));
const hash = createHash("sha256");
for (const f of files) hash.update(await readFile(f));
const version = hash.digest("hex").slice(0, 16);
const runtime = await readFile("scripts/service-worker.js", "utf8");
await writeFile(
  path.join(root, "sw.js"),
  `const CACHE_NAME=${JSON.stringify("eccv-scout-shell-" + version)};\nconst PRECACHE=${JSON.stringify(urls)};\n` +
    runtime,
);
const bytes = (await Promise.all(files.map((f) => stat(f)))).reduce((sum, s) => sum + s.size, 0);
console.log(
  `Offline bundle: ${urls.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB, version ${version}`,
);
