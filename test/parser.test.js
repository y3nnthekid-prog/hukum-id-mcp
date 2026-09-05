// Uji parser tanpa jaringan.
//
// Risiko terbesar proyek ini bukan salah logika, melainkan situs sumber yang
// berganti tampilan. Ketika itu terjadi, parser rusak diam-diam: tool tetap
// menjawab, tetapi isinya kosong atau keliru — dan itu jauh lebih berbahaya
// daripada galat yang terlihat.
//
// Uji ini menahan hal itu dengan menjalankan parser terhadap salinan HTML nyata
// yang disimpan di test/fixtures/. Tidak ada permintaan jaringan sama sekali,
// sehingga uji ini juga menjadi deteksi dini: bila suatu saat parser diubah dan
// uji ini gagal, penyebabnya ada pada kode, bukan pada koneksi.
//
// Dua jalur diuji:
//   1. Parser murni, dipanggil langsung dengan isi fixture.
//   2. Jalur gabungan, dengan cara menyemai cache memakai fixture lalu memanggil
//      fungsi sungguhan. Fixture adalah tangkapan asli dari URL yang sama, jadi
//      menyemainya tidak mencemari cache dengan isi palsu.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseRelasi, parseSlug, cariPeraturan } from "../src/bpk.js";
import { parseHalaman, parseTabelProduk } from "../src/dsn.js";
import { parseDaftar, detailPutusan } from "../src/ma.js";
import { cariPutusanMK } from "../src/mk.js";
import { cariPerma } from "../src/perma.js";
import { simpan } from "../src/cache.js";
import { ekstrakTeksPdf, halamanPdf } from "../src/pdf.js";
import { PDF_FIXTURES } from "./fixtures/pdf/index.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
let lulus = 0;
let gagal = 0;

function ok(label, syarat, keterangan = "") {
  if (syarat) {
    lulus++;
    console.log(`PASS  ${label}${keterangan ? "  — " + keterangan : ""}`);
  } else {
    gagal++;
    console.log(`FAIL  ${label}${keterangan ? "  — " + keterangan : ""}`);
  }
}

const fixture = (nama) => readFile(path.join(DIR, "fixtures", nama), "utf8");

// --- 1. Parser murni --------------------------------------------------------

const slug = parseSlug("uu-no-27-tahun-2022");
ok(
  "parseSlug menguraikan jenis, nomor, tahun",
  slug.jenis === "UU" && slug.nomor === "27" && slug.tahun === "2022",
  JSON.stringify(slug)
);

const detailHtml = await fixture("bpk-detail-relasi.html");
const relasi = parseRelasi(detailHtml);
const labelRelasi = Object.keys(relasi);
ok(
  "parseRelasi menemukan blok relasi antarperaturan",
  labelRelasi.length >= 2,
  labelRelasi.slice(0, 4).join(", ")
);
const adaMencabut = labelRelasi.some((l) => /mencabut|diubah|dicabut|mengubah/i.test(l));
ok("parseRelasi mengenali label relasi yang bermakna", adaMencabut, labelRelasi.join(" | ").slice(0, 70));

const satuRelasi = (() => {
  const v = relasi[labelRelasi[0]];
  return Array.isArray(v) ? v[0] : v?.ditampilkan?.[0];
})();
ok(
  "parseRelasi mengembalikan id, nama peraturan, dan URL",
  Boolean(satuRelasi?.id && satuRelasi?.peraturan && satuRelasi?.url),
  satuRelasi?.peraturan
);

const fatwaHtml = await fixture("dsn-fatwa.html");
const fatwa = parseHalaman(fatwaHtml);
ok("parseHalaman membaca tabel fatwa DSN", fatwa.length >= 5, `${fatwa.length} fatwa pada satu halaman`);
ok(
  "setiap fatwa punya nomor berpola DSN dan tautan",
  fatwa.every((f) => /DSN/i.test(f.nomor)) && fatwa.some((f) => f.url_pdf),
  fatwa[0]?.nomor
);

const pedomanHtml = await fixture("dsn-pedoman.html");
const pedoman = parseTabelProduk(pedomanHtml);
ok(
  "parseTabelProduk membaca pedoman implementasi",
  pedoman.length >= 3 && pedoman.every((d) => /DSN/i.test(d.nomor)),
  `${pedoman.length} dokumen — ${pedoman[0]?.nomor}`
);
ok(
  "parseTabelProduk tidak tertukar dengan kolom nomor urut",
  pedoman.every((d) => !/^\d{1,2}$/.test(d.nomor)),
  "nomor dokumen, bukan nomor baris"
);

const maHtml = await fixture("ma-kategori.html");
const putusan = parseDaftar(maHtml, 10);
ok("parseDaftar membaca daftar putusan MA", putusan.length >= 3, `${putusan.length} putusan`);
ok(
  "putusan MA membawa id, judul, dan URL",
  putusan.every((p) => p.id && p.judul && p.url),
  putusan[0]?.judul?.slice(0, 45)
);
ok(
  "tanggal putus dibersihkan dari sisa markup",
  putusan.every((p) => !p.tanggal_putus || !/[—–]/.test(p.tanggal_putus)),
  putusan[0]?.tanggal_putus || "(tanpa tanggal)"
);

// --- 2. Jalur gabungan lewat cache yang disemai ------------------------------

const bpkUrl =
  "https://peraturan.bpk.go.id/Search?" +
  new URLSearchParams({ keywords: "tindak pidana korupsi", tentang: "", nomor: "", jenis: "", entitas: "" }).toString();
await simpan(bpkUrl, Buffer.from(await fixture("bpk-search.html"), "utf8"));
const hasilBpk = await cariPeraturan({ keywords: "tindak pidana korupsi", limit: 5 });
ok(
  "cariPeraturan memarsing hasil pencarian tanpa jaringan",
  hasilBpk.hasil.length === 5 && hasilBpk.hasil.every((h) => h.id && h.judul && h.url),
  hasilBpk.hasil[0]?.judul?.slice(0, 45)
);
ok(
  "hasil pencarian membawa jenis, nomor, tahun dari slug",
  hasilBpk.hasil.filter((h) => h.jenis && h.nomor && h.tahun).length >= 4,
  hasilBpk.hasil.map((h) => `${h.jenis} ${h.nomor}/${h.tahun}`).slice(0, 2).join("; ")
);
ok("total halaman terbaca dari pagination", hasilBpk.total_halaman > 1, `${hasilBpk.total_halaman} halaman`);

const mkUrl = "https://www.mkri.id/perkara/persidangan/putusan?" + new URLSearchParams({ search: "pemilu" }).toString();
await simpan(mkUrl, Buffer.from(await fixture("mk-putusan.html"), "utf8"));
const hasilMk = await cariPutusanMK({ query: "pemilu", limit: 5 });
ok(
  "cariPutusanMK memarsing rekaman JSON pada halaman MK",
  hasilMk.hasil.length >= 3 && hasilMk.hasil.every((h) => h.nomor_perkara && h.amar_putusan),
  hasilMk.hasil[0]?.nomor_perkara
);
ok(
  "putusan MK membawa tautan salinan",
  hasilMk.hasil.some((h) => h.berkas_putusan || h.berkas_pendukung),
  hasilMk.hasil[0]?.berkas_putusan?.slice(-28)
);

const permaUrl =
  "https://jdih.mahkamahagung.go.id/dokumen?" +
  new URLSearchParams({ jenis: "puu", search: "ekonomi syariah" }).toString();
await simpan(permaUrl, Buffer.from(await fixture("jdihma-search.html"), "utf8"));
const hasilPerma = await cariPerma({ query: "ekonomi syariah", limit: 5 });
ok(
  "cariPerma memarsing daftar produk hukum MA",
  hasilPerma.hasil.length >= 2 && hasilPerma.hasil.every((h) => h.judul),
  hasilPerma.hasil.map((h) => h.judul).slice(0, 2).join(" | ")
);
ok(
  "produk hukum MA membawa tautan PDF",
  hasilPerma.hasil.some((h) => h.url_pdf),
  hasilPerma.hasil.find((h) => h.url_pdf)?.url_pdf?.split("/").pop()
);

const maDetailUrl = "https://putusan3.mahkamahagung.go.id/direktori/putusan/11f1a51d7a4105208c01313632323234.html";
await simpan(maDetailUrl, Buffer.from(await fixture("ma-putusan-detail.html"), "utf8"));
const detailMa = await detailPutusan(maDetailUrl);
ok(
  "detailPutusan memarsing metadata putusan MA",
  Boolean(detailMa.nomor) && Object.keys(detailMa.metadata).length >= 5,
  `${detailMa.nomor} — ${Object.keys(detailMa.metadata).length} kolom metadata`
);
ok(
  "detailPutusan menemukan tautan berkas",
  detailMa.berkas.length > 0,
  detailMa.berkas[0]?.split("/").slice(-2).join("/").slice(0, 40)
);

// --- 3. Fixture PDF sulit ---------------------------------------------------

const scanPdf = await halamanPdf({ buffer: PDF_FIXTURES.scanTanpaTeks });
ok(
  "PDF scan tanpa text layer dinyatakan tidak dapat diekstrak",
  scanPdf.extraction_health?.status === "no_text_layer" && scanPdf.extraction_health?.text_layer_pages === 0,
  JSON.stringify(scanPdf.extraction_health)
);

const duaKolomPdf = await halamanPdf({ buffer: PDF_FIXTURES.duaKolom });
const teksDuaKolom = duaKolomPdf.halaman[0]?.teks || "";
ok(
  "PDF dua kolom dibaca sampai bawah kolom kiri lalu kolom kanan",
  teksDuaKolom.indexOf("KIRI BARIS SATU") < teksDuaKolom.indexOf("KIRI BARIS DUA") &&
    teksDuaKolom.indexOf("KIRI BARIS DUA") < teksDuaKolom.indexOf("KANAN BARIS SATU") &&
    teksDuaKolom.indexOf("KANAN BARIS SATU") < teksDuaKolom.indexOf("KANAN BARIS DUA"),
  teksDuaKolom
);

const kosongPdf = await ekstrakTeksPdf({ buffer: PDF_FIXTURES.halamanKosongDiTengah });
ok(
  "halaman kosong dilewati tanpa menggeser nomor halaman berikutnya",
  kosongPdf.total_halaman === 3 &&
    kosongPdf.extraction_health?.empty_pages?.join(",") === "2" &&
    kosongPdf.halaman_dikembalikan.join(",") === "1,3",
  `kosong=${kosongPdf.extraction_health?.empty_pages}; kembali=${kosongPdf.halaman_dikembalikan}`
);

const arabPdf = await halamanPdf({ buffer: PDF_FIXTURES.arabNonUnicode });
ok(
  "teks Arab dengan pemetaan font rusak diberi peringatan tidak tepercaya",
  arabPdf.extraction_health?.warnings?.some((warning) => /Arab.*tidak dapat dipercaya/i.test(warning)),
  JSON.stringify(arabPdf.extraction_health)
);

const tanggalPdf = await halamanPdf({ buffer: PDF_FIXTURES.tanggalMustahil });
ok(
  "tanggal mustahil di dalam PDF ditolak tanpa normalisasi kalender",
  tanggalPdf.extraction_health?.invalid_legal_dates?.includes("31 Februari 2026"),
  JSON.stringify(tanggalPdf.extraction_health)
);

// --- ringkasan --------------------------------------------------------------

console.log(`\n${lulus} lulus, ${gagal} gagal — tanpa satu pun permintaan jaringan.`);
if (gagal > 0) {
  console.log(
    "\nParser gagal terhadap fixture. Karena fixture tidak berubah, penyebabnya ada pada kode,\n" +
      "bukan pada situs sumber. Bila situs sumbernya yang berubah, perbarui fixture secara sadar\n" +
      "lalu sesuaikan parsernya."
  );
  process.exitCode = 1;
}
