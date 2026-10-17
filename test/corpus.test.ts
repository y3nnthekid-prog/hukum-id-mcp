import assert from "node:assert/strict";
import test from "node:test";
import { CorpusIndex } from "../src/indexing/corpus.js";
import { createSigner, generateSigningKey, verifySignature } from "../src/core/sign.js";
import { signedPart } from "../src/core/sumber.js";
import { CorpusManifest } from "../src/indexing/manifest.js";

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
