import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const webRoot = normalize(join(import.meta.dirname, "..", "web", "out"));

const document = {
  id: "fixture:uu-21-2008",
  jurisdiction: "ID",
  authority: "Republik Indonesia",
  documentType: "undang_undang",
  number: "21",
  year: "2008",
  title: "Undang-Undang Nomor 21 Tahun 2008 tentang Perbankan Syariah",
  status: "berlaku",
  effectiveFrom: null,
  effectiveTo: null,
  canonicalUrl: "https://peraturan.bpk.go.id/Details/39655/uu-no-21-tahun-2008",
};

createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    data: { documents: [document], nextCursor: null, warnings: [] },
    meta: { traceId: "00000000-0000-4000-8000-000000000001", nextCursor: null },
  }));
}).listen(3001, "127.0.0.1", () => console.log("fixture API: http://localhost:3001"));

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = normalize(join(webRoot, requested));
  const filePath = candidate.startsWith(webRoot) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(webRoot, "404.html");
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  response.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
  createReadStream(filePath).pipe(response);
}).listen(3000, "127.0.0.1", () => console.log("web fixture: http://localhost:3000"));
