import "./isolasi-cache.js";
import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfIsolated, halamanPdf, PDF_LIMITS } from "../src/pdf.js";
import { PDF_FIXTURES } from "./fixtures/pdf/index.js";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("PDF browser and engine profiles pin the same parser and line-join bytes", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["pdfjs-dist"], "6.4.299");
  const profile = JSON.parse(readFileSync(new URL("../pdf-profile.json", import.meta.url), "utf8"));
  assert.equal(profile.pdfjs, "6.4.299");
  assert.equal(profile.textOptions.isEvalSupported, false);
  const source = readFileSync(new URL("../src/pdf-text.js", import.meta.url));
  assert.equal(createHash("sha256").update(source).digest("hex"), profile.lineJoinSha256);
  const sibling = new URL("../../pasla/src/lib/pdf-text.js", import.meta.url);
  if (existsSync(sibling)) assert.deepEqual(readFileSync(sibling), source);
});

test("build profile verification rejects parser, source and sibling option drift", async () => {
  const { verifyPdfProfile } = await import("../scripts/verifikasi-profil-pdf.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "pasla-pdf-profile-"));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  try {
    const sibling = path.join(root, "sibling"); const source = "export const fixture = true;\n";
    const profile = { pdfjs: "6.4.299", lineJoinSha256: createHash("sha256").update(source).digest("hex"), textOptions: { isEvalSupported: false } };
    for (const dir of ["src", "node_modules/pdfjs-dist", "sibling/src/lib"]) await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, "src/pdf-text.js"), source); await writeFile(path.join(sibling, "src/lib/pdf-text.js"), source);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { "pdfjs-dist": "6.4.299" } }));
    await writeFile(path.join(root, "node_modules/pdfjs-dist/package.json"), JSON.stringify({ version: "6.4.299" }));
    for (const dir of [root, sibling]) await writeFile(path.join(dir, "pdf-profile.json"), JSON.stringify(profile));
    await verifyPdfProfile(root, sibling);
    await writeFile(path.join(root, "src/pdf-text.js"), source + "// drift\n");
    await assert.rejects(verifyPdfProfile(root, sibling), /profil/i);
    await writeFile(path.join(root, "src/pdf-text.js"), source);
    await writeFile(path.join(sibling, "pdf-profile.json"), JSON.stringify({ ...profile, textOptions: { isEvalSupported: true } }));
    await assert.rejects(verifyPdfProfile(root, sibling), /profil/i);
    await writeFile(path.join(sibling, "pdf-profile.json"), JSON.stringify(profile));
    await writeFile(path.join(root, "node_modules/pdfjs-dist/package.json"), JSON.stringify({ version: "4.10.38" }));
    await assert.rejects(verifyPdfProfile(root, sibling), /profil/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PDF extraction rejects byte, page and decoded text limits in an isolated worker", async () => {
  await assert.rejects(extractPdfIsolated(new Uint8Array(101), { ...PDF_LIMITS, maxBytes: 100 }), /PDF_BYTE_LIMIT/);
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.halamanKosongDiTengah), { ...PDF_LIMITS, maxPages: 2 }), /PDF_PAGE_LIMIT/);
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.duaKolom), { ...PDF_LIMITS, maxChars: 5 }), /PDF_TEXT_LIMIT/);
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.duaKolom), { ...PDF_LIMITS, maxChars: 62 }), /PDF_TEXT_LIMIT/);
});

test("an isolated worker exiting without a result rejects instead of losing its deadline", { timeout: 5000 }, async () => {
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.duaKolom), { ...PDF_LIMITS, timeoutMs: 2000 }, new URL("./fixtures/pdf/exit-without-result.mjs", import.meta.url)), /PDF_WORKER_EXIT/);
});

test("a supplied PDF buffer takes precedence over an earlier URL extraction cache", async () => {
  const url_pdf = "https://peraturan.bpk.go.id/Download/fixture-buffer-precedence.pdf";
  const first = await halamanPdf({ url_pdf, buffer: new Uint8Array(PDF_FIXTURES.duaKolom) });
  assert.equal(first.total_halaman, 1);
  const second = await halamanPdf({ url_pdf, buffer: new Uint8Array(PDF_FIXTURES.halamanKosongDiTengah) });
  assert.equal(second.total_halaman, 3);
});
