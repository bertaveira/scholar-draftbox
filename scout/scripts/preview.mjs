import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist/client");
const port = Number(process.env.PORT || 3000);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".rsc": "text/x-component",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let name = decodeURIComponent(url.pathname);
      if (name.includes("\0")) throw Error("Invalid path");
      const rsc = req.headers.rsc === "1" || req.headers.accept?.includes("text/x-component");
      if (rsc && !name.endsWith(".rsc"))
        name = name === "/" ? "/index.rsc" : name.replace(/\/$/, "") + ".rsc";
      else if (name === "/" || name.endsWith("/")) name += "index.html";
      else if (!path.extname(name)) name += ".html";
      const file = path.resolve(root, "." + name);
      if (!file.startsWith(root + path.sep)) throw Error("Invalid path");
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": name.startsWith("/_next/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(path.join(root, "404.html")).catch(() => Buffer.from("Not found")));
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`ECCV Scout production preview: http://localhost:${port}/`),
  );
