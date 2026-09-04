// Kompilasi Hukum Ekonomi Syariah (Lampiran PERMA 2/2008).
//
// KHES adalah hukum materiil yang dipakai hakim Pengadilan Agama untuk perkara
// ekonomi syariah, tetapi naskah lengkapnya adalah LAMPIRAN yang tidak ikut
// dalam PDF PERMA di JDIH Mahkamah Agung — PDF itu hanya memuat batang tubuh
// PERMA dua halaman.
//
// Penelusuran ke sumber daring tidak membuahkan berkas yang dapat diambil
// mesin: perpustakaan BLDK Mahkamah Agung tidak dapat dijangkau, JDIH Kemenkeu
// hanya menyajikan halaman aplikasi tanpa tautan berkas, dan KHES bukan produk
// hukum Kemenag. Karena itu modul ini menerima berkas yang dipasok pengguna,
// lalu mengindeksnya per pasal.
//
// Prinsipnya tegas: selama naskahnya belum diimpor, jangan pernah menyebut
// nomor pasal KHES. Tool ini mengembalikan penolakan yang jelas, bukan tebakan.

import { readFile } from "node:fs/promises";
import { getBuffer } from "./http.js";
import { halamanPdf, cariDalamPdf } from "./pdf.js";
import { ambilJson, simpanJson } from "./cache.js";

const KUNCI_INDEKS = "khes::indeks-v1";
const TTL = 365 * 24 * 60 * 60 * 1000;

/**
 * Struktur KHES, DIVERIFIKASI ke naskah primer: Kompilasi Hukum Ekonomi
 * Syari'ah, Edisi Revisi 2011, terbitan Direktorat Jenderal Badan Peradilan
 * Agama Mahkamah Agung RI.
 *
 * Angka ini sempat keliru karena diambil dari literatur sekunder, yang menyebut
 * Buku II berakhir di 673, Buku III 674-734, dan Buku IV mulai 735. Pemeriksaan
 * langsung ke naskah menunjukkan tiga dari empat batas itu salah:
 *   Pasal 667 masih Dana Pensiun Syariah (Buku II)
 *   Pasal 668 membuka Buku III dengan definisi Infak
 *   Pasal 727 masih hibah dan waris (Buku III)
 *   Pasal 728 membuka Buku IV: "Akuntansi syari'ah harus dilakukan dengan
 *   mencatat, mengelompokkan, dan menyimpulkan transaksi"
 *   Pasal 790 adalah penutup: tanggung jawab hakim menggali dan menemukan hukum
 */
export const STRUKTUR_KHES = [
  { buku: "I", judul: "Subjek Hukum dan Amwal", pasal_awal: 1, pasal_akhir: 19 },
  { buku: "II", judul: "Akad", pasal_awal: 20, pasal_akhir: 667 },
  { buku: "III", judul: "Zakat dan Hibah", pasal_awal: 668, pasal_akhir: 727 },
  { buku: "IV", judul: "Akuntansi Syariah", pasal_awal: 728, pasal_akhir: 790 },
];

const SUMBER_KANDIDAT = [
  {
    nama: "Perpustakaan BLDK Mahkamah Agung",
    url: "https://perpustakaan.bldk.mahkamahagung.go.id/index.php?p=fstream&fid=4276&bid=3122&fname=kompilasi+hukum+ekonomi+syariah.pdf",
    status_terakhir: "tidak dapat dijangkau dari jaringan uji",
  },
];

export function bukuDariPasal(nomorPasal) {
  const n = Number(nomorPasal);
  if (!Number.isFinite(n)) return null;
  const b = STRUKTUR_KHES.find((x) => n >= x.pasal_awal && (x.pasal_akhir === null || n <= x.pasal_akhir));
  return b
    ? {
        buku: b.buku,
        judul: b.judul,
        catatan: "Pembagian buku diverifikasi ke naskah primer KHES Edisi Revisi 2011 terbitan Ditjen Badilag MA.",
      }
    : null;
}

async function indeksTersimpan() {
  return (await ambilJson(KUNCI_INDEKS, TTL)) || null;
}

/** Muat naskah KHES dari berkas lokal milik pengguna, atau dari URL. */
export async function imporKhes({ path_pdf = "", url_pdf = "" }) {
  if (!path_pdf && !url_pdf) throw new Error("Sertakan path_pdf (berkas di komputer) atau url_pdf.");

  const buffer = path_pdf ? await readFile(path_pdf) : await getBuffer(url_pdf, { timeout: 180000 });
  if (buffer.slice(0, 5).toString("utf8") !== "%PDF-") {
    throw new Error("Berkas yang dimuat bukan PDF. Periksa kembali sumbernya.");
  }

  const doc = await halamanPdf({ url_pdf: url_pdf || `lokal::${path_pdf}`, buffer });
  const seluruh = doc.halaman.map((h) => h.teks).join("\n");

  // Petakan tiap "Pasal N" ke nomor halamannya, agar pencarian pasal presisi.
  const petaPasal = {};
  for (const h of doc.halaman) {
    for (const m of h.teks.matchAll(/\bPasal\s+(\d{1,3})\b/g)) {
      const n = m[1];
      if (!petaPasal[n]) petaPasal[n] = [];
      if (!petaPasal[n].includes(h.halaman)) petaPasal[n].push(h.halaman);
    }
  }

  const nomor = Object.keys(petaPasal).map(Number).sort((a, b) => a - b);
  const indeks = {
    sumber: path_pdf ? `berkas lokal: ${path_pdf}` : url_pdf,
    diimpor_pada: new Date().toISOString(),
    total_halaman: doc.total_halaman,
    jumlah_pasal_terdeteksi: nomor.length,
    pasal_terendah: nomor[0] ?? null,
    pasal_tertinggi: nomor[nomor.length - 1] ?? null,
    peta_pasal: petaPasal,
    rujukan_pdf: url_pdf || `lokal::${path_pdf}`,
  };
  await simpanJson(KUNCI_INDEKS, indeks);

  const peringatan = [];
  if ((nomor[nomor.length - 1] ?? 0) < 780) {
    peringatan.push(
      "Pasal tertinggi yang terdeteksi di bawah 780, padahal KHES Edisi Revisi 2011 berakhir pada Pasal 790. " +
        "Berkas ini mungkin hanya sebagian. Periksa kelengkapannya sebelum dipakai."
    );
  }
  if (!/amwal|akad|musyarakah|mudharabah/i.test(seluruh.slice(0, 40000))) {
    peringatan.push("Kata kunci khas KHES tidak ditemukan di bagian awal berkas. Pastikan berkas yang diimpor benar KHES.");
  }

  return { berhasil: true, indeks: { ...indeks, peta_pasal: undefined }, peringatan };
}

/** Cari pasal atau frasa di dalam naskah KHES yang sudah diimpor. */
export async function cariPasalKhes({ pasal = "", query = "", maks_temuan = 8 }) {
  const indeks = await indeksTersimpan();

  if (!indeks) {
    return {
      tersedia: false,
      catatan:
        "Naskah KHES belum tersedia. KHES adalah LAMPIRAN PERMA 2/2008 dan tidak termuat dalam PDF PERMA " +
        "di JDIH Mahkamah Agung, yang hanya berisi batang tubuh dua halaman.",
      cara_melengkapi:
        "Panggil impor_khes dengan path_pdf berisi salinan KHES milik Anda, atau url_pdf bila punya tautan resminya. " +
        "Setelah diimpor sekali, naskahnya tersimpan dan siap dicari.",
      sumber_kandidat: SUMBER_KANDIDAT,
      struktur_khes: STRUKTUR_KHES,
      peringatan: [
        "JANGAN menyebut nomor pasal KHES sebelum naskahnya diimpor dan dibaca.",
      ],
    };
  }

  if (pasal) {
    const n = String(pasal).replace(/\D+/g, "");
    const halaman = indeks.peta_pasal[n];
    if (!halaman?.length) {
      return {
        tersedia: true,
        sumber: indeks.sumber,
        dicari: `Pasal ${n}`,
        ditemukan: false,
        catatan: `Pasal ${n} tidak terdeteksi dalam naskah yang diimpor (rentang terdeteksi: ${indeks.pasal_terendah}-${indeks.pasal_tertinggi}).`,
      };
    }
    const isi = await cariDalamPdf({
      url_pdf: indeks.rujukan_pdf,
      kata_kunci: `Pasal ${n}`,
      konteks: 700,
      maks_temuan,
    });
    return {
      tersedia: true,
      sumber: indeks.sumber,
      dicari: `Pasal ${n}`,
      buku: bukuDariPasal(n),
      halaman,
      temuan: isi.temuan,
    };
  }

  if (query) {
    const isi = await cariDalamPdf({ url_pdf: indeks.rujukan_pdf, kata_kunci: query, konteks: 420, maks_temuan });
    return { tersedia: true, sumber: indeks.sumber, dicari: query, jumlah_temuan: isi.jumlah_temuan, temuan: isi.temuan };
  }

  return {
    tersedia: true,
    sumber: indeks.sumber,
    diimpor_pada: indeks.diimpor_pada,
    total_halaman: indeks.total_halaman,
    jumlah_pasal_terdeteksi: indeks.jumlah_pasal_terdeteksi,
    rentang_pasal: `${indeks.pasal_terendah}-${indeks.pasal_tertinggi}`,
    struktur_khes: STRUKTUR_KHES,
  };
}
