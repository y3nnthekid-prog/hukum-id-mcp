import assert from "node:assert/strict";
import test from "node:test";

import { findQuote } from "../src/core/canonical.js";
import { ayatAt, findArticle, pageAt, segmentPages } from "../src/core/passages.js";

const law = [
  { halaman: 1, teks: "UNDANG-UNDANG NOMOR 1 TAHUN 1974\nMenimbang : bahwa sesuai dengan Pasal 10 ..." },
  { halaman: 4, teks: "BAB II\nSYARAT-SYARAT PERKAWINAN\nPasal 6\n(1) Perkawinan harus didasarkan atas persetujuan.\nPasal 7\n(1) Perkawinan hanya diizinkan" },
  { halaman: 5, teks: "PRESIDEN\nREPUBLIK INDONESIA\n- 5 -\napabila pria sudah mencapai umur 19 tahun.\n(2) Dalam hal penyimpangan dapat minta dispensasi.\nPasal 8\nPerkawinan dilarang antara dua orang" },
  { halaman: 30, teks: "PENJELASAN\nATAS UNDANG-UNDANG NOMOR 1 TAHUN 1974\nPasal 7\nAyat (1)\nUntuk menjaga kesehatan suami-isteri." },
];

test("spaced numeric article headings retain raw text and resolve exact article identities", () => {
  const passages = segmentPages("fixture-spaced", [{ halaman: 9, teks: "Pasal 10\nIsi sepuluh.\nPasal 1 1\nIsi sebelas. Rujukan Pasal 1 2 ayat (1) tetap teks.\nPasal 1 14\nIsi seratus empat belas.\nPENJELASAN\nPasal 1 1\nPenjelasan sebelas." }]);
  assert.equal(findArticle(passages, "Pasal 1").norma.length, 0);
  assert.match(findArticle(passages, "Pasal 11").norma[0]!.text, /^Pasal 1 1\nIsi sebelas/);
  assert.equal(findArticle(passages, "Pasal 11").penjelasan.length, 1);
  assert.match(findArticle(passages, "Pasal 114").norma[0]!.text, /Isi seratus empat belas/);
  assert.equal(findArticle(passages, "Pasal 12").norma.length, 0);
});

test("articles are cut at standalone headings and continue across pages", () => {
  const passages = segmentPages("bpk:47406", law);
  const { norma, penjelasan } = findArticle(passages, "Pasal 7");
  assert.equal(norma.length, 1);
  assert.equal(norma[0]!.locator.halamanAwal, 4);
  assert.equal(norma[0]!.locator.halamanAkhir, 5);
  assert.ok(!norma[0]!.text.includes("Perkawinan dilarang"));
  assert.equal(penjelasan.length, 1);
  assert.equal(penjelasan[0]!.locator.halamanAwal, 30);
  // "Pasal 10" in the preamble does not create an article passage.
  assert.equal(findArticle(passages, "Pasal 10").norma.length, 0);
});

test("a quote is located on the right page and ayat even across a page header", () => {
  const [passage] = findArticle(segmentPages("bpk:47406", law), "Pasal 7").norma;
  const match = findQuote(passage!.text, "Perkawinan hanya diizinkan apabila pria sudah mencapai umur 19 tahun");
  assert.ok(match);
  assert.equal(pageAt(passage!, match.start), 4);
  assert.equal(ayatAt(passage!, match.start), "1");
  const second = findQuote(passage!.text, "dapat minta dispensasi");
  assert.equal(pageAt(passage!, second!.start), 5);
  assert.equal(ayatAt(passage!, second!.start), "2");
});

test("articles quoted inside an omnibus amendment belong to the amended law", () => {
  const omnibus = [
    { halaman: 158, teks: "Bagian Ketiga\nPerbankan Syariah\nPasal 15\nBeberapa ketentuan dalam Undang-Undang Nomor 2l Tahun 2OO8 tentang Perbankan Syariah diubah sebagai berikut:\n1. Ketentuan Pasal 26 diubah sehingga berbunyi sebagai berikut:\nPasal 26\n(1) Kegiatan usaha wajib tunduk kepada Prinsip Syariah." },
    { halaman: 180, teks: "Bagian Keempat\nPasar Modal\nPasal 16\nKetentuan umum pasar modal." },
  ];
  const passages = segmentPages("bpk:240203", omnibus);
  assert.equal(findArticle(passages, "Pasal 26").norma.length, 0);
  const amended = findArticle(passages, "Pasal 26", "UU 21/2008").norma;
  assert.equal(amended.length, 1);
  assert.equal(amended[0]!.locator.mengubah, "UU 21/2008");
  assert.equal(findArticle(passages, "Pasal 15").norma.length, 1);
  assert.equal(findArticle(passages, "Pasal 16").norma.length, 1);
});

test("passage ids are stable and content addressed", () => {
  const first = segmentPages("bpk:47406", law).map((passage) => passage.id);
  const second = segmentPages("bpk:47406", law).map((passage) => passage.id);
  assert.deepEqual(first, second);
  assert.ok(first.every((id) => /^ps_[a-f0-9]{24}$/.test(id)));
  assert.equal(new Set(first).size, first.length);
});

test("identical repeated article text has distinct stable occurrence ids", () => {
  const pages = [{ halaman: 1, teks: "Pasal 1\nTeks sama.\nPasal 1\nTeks sama.\nPasal 2\nAkhir." }, { halaman: 2, teks: "Pasal 1\nTeks sama.\nPasal 2\nAkhir." }];
  const passages = segmentPages("fixture-duplicate", pages);
  assert.equal(new Set(passages.map(p => p.id)).size, passages.length);
  assert.deepEqual(passages.map(p => p.id), segmentPages("fixture-duplicate", pages).map(p => p.id));
});

test("amending laws with Roman articles, and OCR-misread headings, are segmented correctly", () => {
  const pages = [
    { halaman: 2, teks: "Pasal I\nBeberapa ketentuan dalam Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan diubah sebagai berikut:\n1. Ketentuan Pasal 7 diubah sehingga berbunyi sebagai berikut:\nPasal 7\n(1) Perkawinan hanya diizinkan apabila pria dan wanita sudah mencapai umur 19 tahun." },
    { halaman: 3, teks: "Pasal II\nUndang-Undang ini mulai berlaku pada tanggal diundangkan.\nPasai 1O\nTeks pasal sepuluh yang terbaca salah." },
  ];
  const passages = segmentPages("bpk:122740", pages);
  assert.equal(findArticle(passages, "Pasal I").norma.length, 1);
  assert.equal(findArticle(passages, "Pasal II").norma.length, 1);
  assert.equal(findArticle(passages, "Pasal 7", "UU 1/1974").norma.length, 1);
  assert.equal(findArticle(passages, "Pasal 7").norma.length, 0);
  assert.equal(findArticle(passages, "Pasal 10").norma.length, 1);
});
