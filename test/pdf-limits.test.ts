import "./isolasi-cache.js";
import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfIsolated, PDF_LIMITS } from "../src/pdf.js";
import { PDF_FIXTURES } from "./fixtures/pdf/index.js";

test("PDF extraction rejects byte, page and decoded text limits in an isolated worker", async () => {
  await assert.rejects(extractPdfIsolated(new Uint8Array(101), { ...PDF_LIMITS, maxBytes: 100 }), /PDF_BYTE_LIMIT/);
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.halamanKosongDiTengah), { ...PDF_LIMITS, maxPages: 2 }), /PDF_PAGE_LIMIT/);
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.duaKolom), { ...PDF_LIMITS, maxChars: 5 }), /PDF_TEXT_LIMIT/);
  await assert.rejects(extractPdfIsolated(new Uint8Array(PDF_FIXTURES.duaKolom), { ...PDF_LIMITS, maxChars: 62 }), /PDF_TEXT_LIMIT/);
});
