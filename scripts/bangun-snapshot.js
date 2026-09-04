#!/usr/bin/env node
// Bangun snapshot korpus inti ke dalam .cache/
//
// Alasannya soal beban, bukan kecepatan. Satu peneliti yang mengambil dokumen
// dari JDIH sesekali tidak menjadi masalah. Seribu peneliti yang masing-masing
// mengambil dokumen yang sama, berulang-ulang, adalah masalah bagi situs
// pemerintah yang membiayainya dari anggaran publik.
//
// Skrip ini mengisi cache sekali untuk dokumen yang hampir selalu dibutuhkan,
// sehingga hasilnya dapat dibagikan sebagai berkas dan peneliti baru tidak
// perlu sekali pun menembak situs sumber untuk korpus inti.
//
// Pakai:
//   node scripts/bangun-snapshot.js            korpus inti lengkap dengan PDF
//   node scripts/bangun-snapshot.js --ringkas  metadata saja, tanpa PDF

import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cariPeraturan, detailPeraturan } from "../src/bpk.js";
import { halamanPdf } from "../src/pdf.js";
import { indeksFatwa, cariProdukDsn } from "../src/dsn.js";
import { cariPerma } from "../src/perma.js";
import { indeksHadisKategori } from "../src/dalil.js";

const RINGKAS = process.argv.includes("--ringkas");
const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache");

/** Undang-undang yang hampir selalu jadi rujukan dalam riset hukum ekonomi syariah. */
const KORPUS = [
  ["perbankan syariah", "21", "2008"],
  ["peradilan agama", "3", "2006"],
  ["peradilan agama", "50", "2009"],
  ["surat berharga syariah negara", "19", "2008"],
  ["wakaf", "41", "2004"],
  ["pengelolaan zakat", "23", "2011"],
  ["jaminan produk halal", "33", "2014"],
  ["pengembangan dan penguatan sektor keuangan", "4", "2023"],
  ["pembentukan peraturan perundang-undangan", "12", "2011"],
  ["perubahan atas pembentukan peraturan perundang-undangan", "15", "2019"],
  ["perubahan kedua pembentukan peraturan perundang-undangan", "13", "2022"],
  ["penyesuaian pidana", "1", "2026"],
  ["kitab undang-undang hukum pidana", "1", "2023"],
  ["kitab undang-undang hukum acara pidana", "20", "2025"],
  ["hukum acara pidana", "8", "1981"],
  ["pelindungan data pribadi", "27", "2022"],
];

const PERMA = ["perma nomor 2 tahun 2008", "ekonomi syariah", "kompilasi"];

let berhasil = 0;
let gagal = 0;

async function langkah(label, fn) {
  const m = Date.now();
  try {
    await fn();
    berhasil++;
    console.log(`  ok    ${String(Date.now() - m).padStart(6)} ms  ${label}`);
  } catch (e) {
    gagal++;
    console.log(`  GAGAL ${String(Date.now() - m).padStart(6)} ms  ${label} — ${String(e.message).slice(0, 70)}`);
  }
}

async function ukuranCache() {
  try {
    const berkas = await readdir(CACHE);
    let total = 0;
    for (const f of berkas) {
      const st = await stat(path.join(CACHE, f));
      total += st.size;
    }
    return { jumlah: berkas.length, mb: (total / 1024 / 1024).toFixed(1) };
  } catch {
    return { jumlah: 0, mb: "0.0" };
  }
}

console.log(`Membangun snapshot korpus inti${RINGKAS ? " (ringkas, tanpa PDF)" : ""}…\n`);
const awal = Date.now();

console.log("Peraturan inti:");
for (const [kata, nomor, tahun] of KORPUS) {
  await langkah(`${nomor}/${tahun} — ${kata.slice(0, 38)}`, async () => {
    const cari = await cariPeraturan({ keywords: kata, nomor, tahun, limit: 4 });
    const pilih = cari.hasil.find((h) => h.nomor === nomor && h.tahun === tahun) || cari.hasil[0];
    if (!pilih) throw new Error("tidak ditemukan");
    const d = await detailPeraturan(pilih.id);
    if (!RINGKAS) {
      const pdf = d.berkas.find((f) => f.kategori === "Peraturan");
      if (pdf) await halamanPdf({ url_pdf: pdf.url });
    }
  });
}

console.log("\nProduk hukum Mahkamah Agung:");
for (const q of PERMA) {
  await langkah(`cari_perma: ${q}`, async () => {
    const r = await cariPerma({ query: q, limit: 6 });
    if (!RINGKAS) {
      for (const h of r.hasil.slice(0, 3)) {
        if (h.url_pdf) await halamanPdf({ url_pdf: h.url_pdf }).catch(() => {});
      }
    }
  });
}

console.log("\nFatwa dan produk DSN-MUI:");
await langkah("indeks seluruh fatwa DSN", () => indeksFatwa({ paksa_segarkan: true }));
await langkah("pedoman implementasi", () => cariProdukDsn({ jenis: "pedoman-implementasi", limit: 40 }));
await langkah("talimat", () => cariProdukDsn({ jenis: "talimat", limit: 40 }));

console.log("\nDalil:");
await langkah("indeks hadis kategori fikih", () => indeksHadisKategori("4"));

const ukuran = await ukuranCache();
console.log(
  `\nSelesai dalam ${((Date.now() - awal) / 1000).toFixed(1)} detik. ` +
    `Berhasil ${berhasil}, gagal ${gagal}.\n` +
    `Cache kini ${ukuran.jumlah} berkas, ${ukuran.mb} MB, di .cache/\n`
);
console.log(
  "Untuk membagikannya: kemas folder .cache/ menjadi satu arsip, lalu bagikan kepada peneliti lain.\n" +
    "Mereka cukup membongkarnya ke folder yang sama, dan korpus inti langsung tersedia tanpa\n" +
    "sekali pun menembak situs sumber."
);

if (gagal > 0) process.exitCode = 1;
