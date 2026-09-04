import assert from "node:assert/strict";

import {
  assertPublicUrl,
  parseLegalDate,
  selectExactCandidate,
  selectPdfPages,
} from "../src/trust.js";

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

await test("exact lookup never falls back to the first candidate", () => {
  const result = selectExactCandidate(
    [
      { id: "wrong", nomor: "26", tahun: "2022" },
      { id: "also-wrong", nomor: "27", tahun: "2021" },
    ],
    { nomor: "27", tahun: "2022" }
  );

  assert.equal(result.status, "not_found");
  assert.equal(result.value, null);
});

await test("exact lookup returns ambiguity instead of guessing", () => {
  const result = selectExactCandidate(
    [
      { id: "a", nomor: "27", tahun: "2022" },
      { id: "b", nomor: "027", tahun: "2022" },
    ],
    { nomor: "27", tahun: "2022" }
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

await test("jenis yang sudah disebut pemanggil memilah nomor dan tahun yang bertabrakan", () => {
  // Regresi nyata: periksa_pasal("UU 27/2022") menolak dengan status ambiguous
  // karena Perbup Kabupaten Klaten 27/2022 ikut cocok pada nomor dan tahun,
  // lalu meminta pengguna menyebutkan jenis yang sebenarnya sudah ia tulis.
  const kandidat = [
    { id: "uu", jenis: "UU", nomor: "27", tahun: "2022" },
    { id: "perbup", jenis: "PERBUP KAB KLATEN", nomor: "27", tahun: "2022" },
  ];

  const cocok = selectExactCandidate(kandidat, { nomor: "27", tahun: "2022", jenis: "UU" });
  assert.equal(cocok.status, "matched");
  assert.equal(cocok.value.id, "uu");

  // Sinonim ejaan panjang harus setara, tetapi UUD tidak boleh tertukar dengan UU.
  assert.equal(
    selectExactCandidate(kandidat, { nomor: "27", tahun: "2022", jenis: "Undang-Undang" }).value.id,
    "uu"
  );
  assert.equal(
    selectExactCandidate(kandidat, { nomor: "27", tahun: "2022", jenis: "UUD" }).status,
    "ambiguous"
  );

  // Tanpa jenis, dan untuk jenis yang tidak dikenali, sifat fail-closed tetap:
  // hasilnya ambigu, bukan tebakan dan bukan pula tidak-ditemukan yang keliru.
  assert.equal(selectExactCandidate(kandidat, { nomor: "27", tahun: "2022" }).status, "ambiguous");
  assert.equal(
    selectExactCandidate(kandidat, { nomor: "27", tahun: "2022", jenis: "PERDA" }).status,
    "ambiguous"
  );
  assert.equal(
    selectExactCandidate([kandidat[1]], { nomor: "27", tahun: "2022", jenis: "UU" }).status,
    "ambiguous"
  );
});

await test("exact number matching preserves integers larger than JavaScript precision", () => {
  const result = selectExactCandidate(
    [{ id: "right", nomor: "9007199254740993", tahun: "2026" }],
    { nomor: "9007199254740992", tahun: "2026" }
  );
  assert.equal(result.status, "not_found");
});

await test("PDF keyword filtering fails closed when the phrase is absent", () => {
  const pages = [
    { halaman: 1, teks: "Ketentuan umum" },
    { halaman: 2, teks: "Pasal 1 mengatur ruang lingkup" },
  ];

  assert.deepEqual(selectPdfPages(pages, "Pasal 9999"), []);
  assert.deepEqual(selectPdfPages(pages, "Pasal 1").map((page) => page.halaman), [2]);
});

await test("legal dates reject impossible calendar dates", () => {
  assert.equal(parseLegalDate("31/02/2026"), null);
  assert.equal(parseLegalDate("31 Februari 2026"), null);
  assert.equal(parseLegalDate("2026-02-31"), null);
  assert.equal(parseLegalDate("28/02/2026")?.toISOString(), "2026-02-28T00:00:00.000Z");
});

await test("SSRF guard rejects private and IPv4-mapped addresses", async () => {
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1/a"), /internal|privat/i);
  await assert.rejects(() => assertPublicUrl("http://[::ffff:127.0.0.1]/a"), /internal|privat/i);
});

await test("SSRF guard rejects a hostname when any DNS answer is private", async () => {
  const lookup = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.20.30.40", family: 4 },
  ];

  await assert.rejects(
    () => assertPublicUrl("https://example.com/a", { lookup }),
    /internal|privat/i
  );
});

await test("SSRF guard accepts a public IPv4 address exposed through DNS64", async () => {
  const lookup = async () => [{ address: "64:ff9b::6812:249", family: 6 }];
  const url = await assertPublicUrl("https://example.com/a", { lookup });
  assert.equal(url.hostname, "example.com");
});

console.log(`\n${passed} trust-foundation checks passed.`);
