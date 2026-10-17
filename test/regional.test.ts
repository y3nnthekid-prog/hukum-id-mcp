import assert from "node:assert/strict";
import test from "node:test";
import { parseAceh, parseJdihn, bukaMkBpk, kueriKatalogAceh } from "../src/sources/regional.js";
import { createSigner, generateSigningKey } from "../src/core/sign.js";

test("Aceh parser matches exact legal identity and prefers provincial duplicates without claiming current status", () => {
  const row = (id: string, title: string, province = false) => [`<a href="https://jdih.acehprov.go.id/dih/detail/${id}">${title}</a>${province ? "Provinsi Aceh" : "Kabupaten Uji"}`];
  const hasil = parseAceh({ data: [row("abc-123", "Qanun Aceh Nomor 6 Tahun 2014 tentang Hukum Jinayat"), row("def-456", "Qanun Aceh Nomor 6 Tahun 2014 tentang Hukum Jinayat", true), row("bad-123", "Rancangan Qanun Aceh Nomor 6 Tahun 2014"), row("ccc-123", "Qanun Aceh Nomor 12 Tahun 2025 tentang Perubahan", true)] });
  assert.equal(hasil.length, 2); assert.equal(hasil[0]!.id, "def-456"); assert.equal(hasil[0]!.status, null);
  assert.throws(() => parseAceh({ message: "katalog berubah" }), /Struktur katalog/);
});
test("Aceh parser recognizes the catalog's Peraturan Daerah label for Qanun 7/2013", () => {
  const result = parseAceh({ data: [[`<a href="https://jdih.acehprov.go.id/dih/detail/fe938c25-dc87-4d28-a6aa-1df884784289">Peraturan Daerah Aceh Nomor 7 Tahun 2013 tentang Hukum Acara Jinayat</a> Provinsi Aceh`]] });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.rujukan, "Qanun Aceh 7/2013");
  assert.equal(result[0]!.status, null);
  assert.equal(kueriKatalogAceh("Qanun Aceh Nomor 7 Tahun 2013"), "Nomor 7 Tahun 2013");
  assert.equal(kueriKatalogAceh("Qanun 6/2014"), "Nomor 6 Tahun 2014");
  assert.equal(kueriKatalogAceh("Hukum Acara Jinayat"), "Hukum Acara Jinayat");
});
test("JDIHN parser only yields public metadata document links", () => {
  const hasil = parseJdihn('<a href="/doc/putusan-123">Putusan uji</a><a href="/search-api/data">Jangan diikuti</a><a href="https://evil.example/doc/a">Palsu</a>');
  assert.equal(hasil.length, 1); assert.equal(hasil[0]!.tersedia, false); assert.equal(hasil[0]!.url, "https://jdihn.go.id/doc/putusan-123");
});
test("MK download adapter refuses untrusted hosts and paths before network access", async () => {
  const signer = createSigner(generateSigningKey());
  for (const url of ["https://evil.example/DownloadUjiMateri/a.pdf", "https://peraturan.bpk.go.id/Details/123", "https://peraturan.bpk.go.id/DownloadUjiMateri/a.pdf?redirect=evil"]) await assert.rejects(bukaMkBpk(url, "1/PUU-I/2003", signer), /Jalur PDF/);
});
