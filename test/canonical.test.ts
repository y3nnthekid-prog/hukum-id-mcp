import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, findQuote } from "../src/core/canonical.js";

test("line-break hyphenation, OCR spacing, and running headers do not break an exact quote", () => {
  const raw =
    "Pasal 7\n(1) Perkawinan hanya diizinkan apabila pria dan wanita sudah\nmencapai umur 19 (sembilan belas) tahun.\nPRESIDEN\nREPUBLIK INDONESIA\n- 3 -\n(2) Dalam hal terjadi penyim-\npangan terhadap ketentuan umur, Undang- Undang ini";
  const quote =
    "sudah mencapai umur 19 (sembilan belas) tahun. (2) Dalam hal terjadi penyimpangan terhadap ketentuan umur, Undang-Undang ini";
  const match = findQuote(raw, quote);
  assert.ok(match);
  assert.equal(raw.slice(match.start, match.start + 5), "sudah");
  assert.ok(raw.slice(match.start, match.end).endsWith("Undang ini"));
});

test("a quote with a changed number or negation is not found", () => {
  const raw = "Pemberitahuan wajib dilakukan paling lambat 3 x 24 jam.";
  assert.equal(findQuote(raw, "paling lambat 7 x 24 jam"), null);
  assert.equal(findQuote(raw, "tidak wajib dilakukan"), null);
  assert.ok(findQuote(raw, "WAJIB dilakukan paling lambat 3 x 24 jam"));
});

test("curly quotes and dashes are normalised on both sides", () => {
  const raw = "yang dimaksud dengan “Bank Syariah” adalah bank—yang menjalankan";
  assert.ok(findQuote(raw, 'dengan "Bank Syariah" adalah'));
});

test("Arabic harakat, tatweel and letter variants do not block a match", () => {
  const raw = "وَأَحَلَّ اللَّهُ الْبَيْعَ وَحَرَّمَ الرِّبَا";
  assert.ok(findQuote(raw, "واحل الله البيع وحرم الربا"));
  assert.equal(canonicalize("إِلَى").text, canonicalize("الي").text);
});

test("canonical map points every character back into the raw text", () => {
  const raw = "  Pasal\n  46 ­ayat";
  const canonical = canonicalize(raw);
  assert.equal(canonical.text, "pasal 46 ayat");
  assert.equal(canonical.text.length, canonical.map.length);
  assert.ok(canonical.map.every((index) => index >= 0 && index < raw.length));
});

test("stray spaces from the PDF text layer and gazette page footers do not block a quote", () => {
  const raw = "(2) Dalam hal tanggal jatuh pada hari libur , pelaksanaan pembayara n Upah\ndiatur dalam Perjanjian Kerja.\nb. sesudah hari kedelapan ditambah 1% (satu persen) untuk setiap hari keterlambatan\n2021, No.46\n- 30 -\ndengan ketentuan 1 (satu) bulan tidak boleh melebihi 50% (lima puluh persen) dari ya ng seharusnya";
  const match = findQuote(raw, "jatuh pada hari libur, pelaksanaan pembayaran Upah diatur dalam Perjanjian Kerja.");
  assert.ok(match);
  assert.equal(raw.slice(match.start, match.end), "jatuh pada hari libur , pelaksanaan pembayara n Upah\ndiatur dalam Perjanjian Kerja.");
  assert.ok(findQuote(raw, "untuk setiap hari keterlambatan dengan ketentuan 1 (satu) bulan tidak boleh melebihi 50% (lima puluh persen) dari yang seharusnya"));
  // Angka yang berbeda tetap ditolak walau spasi diabaikan.
  assert.equal(findQuote(raw, "tidak boleh melebihi 60% (enam puluh persen)"), null);
});
