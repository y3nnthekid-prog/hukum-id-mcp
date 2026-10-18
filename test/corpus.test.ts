import assert from "node:assert/strict";
import test from "node:test";
import { CorpusIndex } from "../src/indexing/corpus.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";
import { signedPart } from "../src/core/sumber.js";
import { CorpusManifest } from "../src/indexing/manifest.js";
import { inspectKhiBooks } from "../src/indexing/import.js";

function khiFixture() {
  return [
    { halaman: 1, teks: "KOMPILASI HUKUM ISLAM\nBUKU I\nHUKUM PERKAWINAN\n" + Array.from({ length: 170 }, (_, i) => `Pasal ${i + 1}\nIsi sintetis perkawinan untuk uji.\n`).join("") },
    { halaman: 2, teks: "BUKU II\nHUKUM KEWARISAN\n" + Array.from({ length: 44 }, (_, i) => `Pasal ${i + 171}\nIsi sintetis kewarisan untuk uji.\n`).join("") },
    { halaman: 3, teks: "BUKU III\nHUKUM PERWAKAFAN\n" + Array.from({ length: 15 }, (_, i) => `Pasal ${i + 215}\nIsi sintetis perwakafan untuk uji.\n`).join("") },
    { halaman: 4, teks: "PENJELASAN\nATAS KOMPILASI\nPasal 124\nPenjelasan sintetis, bukan pengganti pasal batang tubuh.\n" },
  ];
}

test("KHI book audit accepts the complete ordered body and excludes explanation headings", () => {
  assert.deepEqual(inspectKhiBooks(khiFixture()), [{ buku: "I", halaman: 1 }, { buku: "II", halaman: 2 }, { buku: "III", halaman: 3 }]);
});

test("KHI book audit rejects missing articles even when explanation contains the number", () => {
  const pages = khiFixture(); pages[0]!.teks = pages[0]!.teks.replace("Pasal 124\nIsi sintetis perkawinan untuk uji.\n", "");
  assert.throws(() => inspectKhiBooks(pages), /KHI_ARTICLE_COVERAGE/);
  const sameLine = khiFixture(); sameLine[2]!.teks = sameLine[2]!.teks.replace("Pasal 229\nIsi sintetis perwakafan untuk uji.\n", ""); sameLine[3]!.teks = "PENJELASAN ATAS KOMPILASI HUKUM ISLAM\nPasal 229\nCukup jelas.";
  assert.throws(() => inspectKhiBooks(sameLine), /KHI_ARTICLE_COVERAGE/);
});

test("KHI book audit rejects contents-only copies, duplicated articles, and wrong book boundaries", () => {
  assert.throws(() => inspectKhiBooks([{ halaman: 1, teks: "KOMPILASI HUKUM ISLAM\nBUKU I\nBUKU II\nBUKU III\nDaftar isi saja." }]), /KHI_/);
  const duplicate = khiFixture(); duplicate[0]!.teks += "Pasal 170\nSalinan ganda.\n";
  assert.throws(() => inspectKhiBooks(duplicate), /KHI_ARTICLE_COVERAGE/);
  const shifted = khiFixture(); shifted[0]!.teks = shifted[0]!.teks.replace("Pasal 170\nIsi sintetis perkawinan untuk uji.\n", ""); shifted[1]!.teks = shifted[1]!.teks.replace("HUKUM KEWARISAN\n", "HUKUM KEWARISAN\nPasal 170\nIsi sintetis dipindah ke buku yang salah.\n");
  assert.throws(() => inspectKhiBooks(shifted), /KHI_BOOK_BOUNDARY/);
  const ocrShifted = khiFixture(); ocrShifted[0]!.teks = ocrShifted[0]!.teks.replace("Pasal 170\nIsi sintetis perkawinan untuk uji.\n", ""); ocrShifted[1]!.teks = ocrShifted[1]!.teks.replace("HUKUM KEWARISAN\n", "HUKUM KEWARISAN\nPasai 170\nIsi sintetis dipindah ke buku yang salah.\n");
  assert.throws(() => inspectKhiBooks(ocrShifted), /KHI_BOOK_BOUNDARY/);
  const contents = khiFixture(); contents[0]!.teks = "DAFTAR ISI\n" + contents[0]!.teks;
  assert.throws(() => inspectKhiBooks(contents), /KHI_CONTENTS_REVIEW/);
  const pagination = khiFixture().map(page => ({ ...page, teks: page.teks.replace(/Isi sintetis (?:perkawinan|kewarisan|perwakafan) untuk uji\./g, "12") }));
  assert.throws(() => inspectKhiBooks(pagination), /KHI_ARTICLE_COVERAGE/);
  const empty = khiFixture(); empty[0]!.teks = empty[0]!.teks.replace("Pasal 124\nIsi sintetis perkawinan untuk uji.\n", "Pasal 124\n");
  assert.throws(() => inspectKhiBooks(empty), /KHI_ARTICLE_COVERAGE/);
  for (const [page, number, content] of [[0, 170, "perkawinan"], [1, 214, "kewarisan"]] as const) {
    const boundaryEmpty = khiFixture(); boundaryEmpty[page]!.teks = boundaryEmpty[page]!.teks.replace(`Pasal ${number}\nIsi sintetis ${content} untuk uji.\n`, `Pasal ${number}\n`);
    assert.throws(() => inspectKhiBooks(boundaryEmpty), /KHI_ARTICLE_COVERAGE/);
  }
});

test("CLI manifest preserves reviewed status and completeness instead of silently dropping them", () => {
  const manifest = { id: "qanun-uji", jenis: "qanun", judul: "Judul sintetis", rujukan: "Qanun Aceh 7/2013", sourceUrl: "https://jdih.acehprov.go.id/uji.pdf", retrievedAt: "2026-10-16T00:00:00Z", importedBy: "fixture", file: "uji.pdf", status: "Berlaku", complete: false };
  assert.deepEqual(CorpusManifest.parse(manifest), manifest);
  assert.throws(() => CorpusManifest.parse({ ...manifest, complete: "true" }));
  assert.throws(() => CorpusManifest.parse({ ...manifest, typo_status: "Berlaku" }));
});

test("FTS indexes originals, normalizes Arabic, binds hostile queries, and signs only stored text", () => {
  const corpus = new CorpusIndex(":memory:");
  try {
    corpus.replace({ id: "khi-uji", jenis: "khi", judul: "Korpus sintetis", rujukan: "KHI", sourceUrl: "https://bphn.go.id/uji.pdf", fileHash: "a".repeat(64), retrievedAt: "2026-10-16T00:00:00.000Z", importedBy: "fixture", complete: true }, [{ halaman: 1, teks: "BUKU I\nPasal 1\nTeks sintetis perkawinan dan lafaz الضَّرَرُ يُزَالُ untuk pengujian." }]);
    assert.equal(corpus.search("الضرر يزال").hasil.length, 1);
    assert.doesNotThrow(() => corpus.search('" OR 1=1; DROP TABLE passages; --'));
    assert.equal(corpus.search("perkawinan").hasil.length, 1);
    const signer = createSigner(generateSigningKey());
    const opened = corpus.open({ jenis: "khi", pasal: "Pasal 1" }, signer);
    assert.equal(opened.status, "dibuka");
    assert.deepEqual(opened.potongan[0]!.lapisan, ["pedoman"]);
    assert.ok(verifySignature(signedPart(opened.potongan[0]!), opened.potongan[0]!.tanda, [signer.publicKeyPem]));
    assert.equal(corpus.byHash("b".repeat(64)), null);
    assert.ok(corpus.byHash("a".repeat(64)));
    assert.equal(corpus.open({ jenis: "khi", pasal: "Pasal 9999" }, signer).status, "tidak_ditemukan");
  } finally { corpus.close(); }
});

test("reviewed amendment relationships survive manifest import and are covered by the passage signature", () => {
  const manifest = CorpusManifest.parse({ id: "qanun-relasi", jenis: "qanun", judul: "Naskah sintetis historis", rujukan: "Qanun Aceh 6/2014", sourceUrl: "https://jdih.acehprov.go.id/uji.pdf", retrievedAt: "2026-10-18T00:00:00Z", importedBy: "fixture", file: "uji.pdf", status: "Diubah", diubahDengan: ["Qanun Aceh 12/2025"], dicabutDengan: [] });
  assert.deepEqual(manifest.diubahDengan, ["Qanun Aceh 12/2025"]);
  const corpus = new CorpusIndex(":memory:"); const signer = createSigner(generateSigningKey());
  try {
    const { file: _file, ...meta } = manifest;
    corpus.replace({ ...meta, fileHash: "e".repeat(64) }, [{ halaman: 1, teks: "Pasal 1\nTeks asli, belum dikonsolidasikan." }]);
    const opened = corpus.open({ jenis: "qanun", rujukan: "Qanun Aceh 6/2014", pasal: "Pasal 1" }, signer);
    const passage = opened.potongan[0]!;
    assert.deepEqual(passage.sumber.diubahDengan, ["Qanun Aceh 12/2025"]);
    assert.ok(verifySignature(signedPart(passage), passage.tanda, [signer.publicKeyPem]));
    passage.sumber.diubahDengan = [];
    assert.equal(verifySignature(signedPart(passage), passage.tanda, [signer.publicKeyPem]), false);
  } finally { corpus.close(); }
});

test("partial extraction cannot prove absence and a regulation cannot be opened as a decision", () => {
  const corpus = new CorpusIndex(":memory:");
  const signer = createSigner(generateSigningKey());
  try {
    corpus.replace({ id: "partial", jenis: "khi", judul: "Uji", rujukan: "KHI", sourceUrl: "https://bphn.go.id/uji", fileHash: "d".repeat(64), retrievedAt: new Date().toISOString(), importedBy: "fixture", complete: false }, [{ halaman: 1, teks: "Pasal 1\nTeks yang terbaca sebagian" }]);
    assert.equal(corpus.open({ jenis: "khi", pasal: "Pasal 2" }, signer).status, "tidak_dapat_diperiksa");
    assert.equal(corpus.open({ jenis: "putusan", id: "partial" }, signer).status, "tidak_dapat_diperiksa");
  } finally { corpus.close(); }
});

test("corpus replacement is atomic and removes old FTS rows", () => {
  const corpus = new CorpusIndex(":memory:");
  const meta = { id: "uji", jenis: "peraturan" as const, judul: "Uji", rujukan: "Uji", sourceUrl: "https://peraturan.bpk.go.id/uji.pdf", fileHash: "c".repeat(64), retrievedAt: new Date().toISOString(), importedBy: "fixture" };
  try {
    corpus.replace(meta, [{ halaman: 1, teks: "Pasal 1\nIsi pertama" }]);
    corpus.replace(meta, [{ halaman: 1, teks: "Pasal 1\nIsi kedua" }]);
    assert.equal(corpus.search("pertama").hasil.length, 0);
    assert.equal(corpus.search("kedua").hasil.length, 1);
    assert.throws(() => corpus.replace(meta, [{ halaman: 1, teks: "" }]), /teks|pasal/i);
    assert.equal(corpus.search("kedua").hasil.length, 1);
  } finally { corpus.close(); }
});
