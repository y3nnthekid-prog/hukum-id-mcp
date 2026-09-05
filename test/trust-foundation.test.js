import assert from "node:assert/strict";
import path from "node:path";

import {
  assertPublicUrl,
  parseLegalDate,
  selectExactCandidate,
  selectPdfPages,
} from "../src/trust.js";
import { resolveSafeImportPath } from "../src/khes.js";
import { buildCurlArguments, fetchTransport, followValidatedRedirects } from "../src/http.js";

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

await test("SSRF guard rejects IPv6 loopback, unique-local and link-local literals", async () => {
  for (const address of ["::1", "fc00::1", "fd12:3456:789a::1", "fe80::1"]) {
    await assert.rejects(() => assertPublicUrl(`http://[${address}]/a`), /internal|privat/i);
  }
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

await test("KHES local import rejects traversal and absolute paths outside its root", async () => {
  const root = process.cwd();
  await assert.rejects(() => resolveSafeImportPath("../../rahasia.pdf", { root }), /di luar direktori impor/i);
  await assert.rejects(() => resolveSafeImportPath("%2e%2e%2f%2e%2e%2frahasia.pdf", { root }), /di luar direktori impor/i);
  await assert.rejects(() => resolveSafeImportPath(path.resolve(root, "..", "rahasia.pdf"), { root }), /di luar direktori impor/i);
});

await test("DNS is revalidated before every redirected request", async () => {
  let lookups = 0;
  let requests = 0;
  const lookup = async () => {
    lookups += 1;
    return [{ address: lookups === 1 ? "93.184.216.34" : "10.0.0.9", family: 4 }];
  };
  const transport = async () => {
    requests += 1;
    return { status: 302, buffer: Buffer.alloc(0), location: "/next" };
  };

  await assert.rejects(
    () => followValidatedRedirects(transport, "https://example.com/start", { lookup }),
    /internal|privat/i
  );
  assert.equal(requests, 1);
  assert.equal(lookups, 2);
});

await test("redirect to a cloud metadata address is rejected before transport", async () => {
  let requests = 0;
  const transport = async () => {
    requests += 1;
    return { status: 302, buffer: Buffer.alloc(0), location: "http://169.254.169.254/latest/meta-data" };
  };

  await assert.rejects(
    () =>
      followValidatedRedirects(transport, "https://example.com/start", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    /internal|privat|diizinkan/i
  );
  assert.equal(requests, 1);
});

await test("HTTP transport rejects declared and streamed response bombs", async () => {
  const declaredBomb = async () =>
    new Response("kecil", { status: 200, headers: { "content-length": "999999" } });
  await assert.rejects(
    () => fetchTransport("https://example.com/a", { maxBytes: 32, fetchImpl: declaredBomb }),
    /melebihi batas/i
  );

  const streamedBomb = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(24));
          controller.enqueue(new Uint8Array(24));
          controller.close();
        },
      }),
      { status: 200 }
    );
  await assert.rejects(
    () => fetchTransport("https://example.com/a", { maxBytes: 32, fetchImpl: streamedBomb }),
    /melebihi batas/i
  );
});

await test("curl fallback is forbidden from following redirects itself", () => {
  const args = buildCurlArguments("https://example.com/a", undefined, 1_000, "out", "headers", 1_024);
  const option = args.indexOf("--max-redirs");
  assert.notEqual(option, -1);
  assert.equal(args[option + 1], "0");
  assert.equal(args.includes("--location"), false);
});

console.log(`\n${passed} trust-foundation checks passed.`);
