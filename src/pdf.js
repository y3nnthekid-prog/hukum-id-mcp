// Ekstraksi teks PDF bersama, dipakai untuk PDF peraturan, putusan, dan fatwa.
//
// Membedah PDF adalah bagian termahal dari seluruh alur (putusan MK 254 halaman
// perlu puluhan detik). Karena isi PDF resmi tidak pernah berubah, hasil
// ekstraksinya disimpan per dokumen, lalu penyaringan halaman dan kata kunci
// dilakukan di atas hasil simpanan itu.

import { getBuffer } from "./http.js";
import { ambilJson, simpanJson, umurSimpan } from "./cache.js";
import { selectPdfPages } from "./trust.js";

const CATATAN =
  "Sebagian PDF resmi punya lapisan teks yang cacat. Bandingkan dengan PDF sumber sebelum mengutip verbatim.";

/** Ambil seluruh halaman sebagai teks, dari cache bila ada. */
export async function halamanPdf({ url_pdf, buffer, referer, lewati_cache = false }) {
  const kunci = "pdf-teks::" + (url_pdf || "buffer");
  if (url_pdf && !lewati_cache) {
    const tersimpan = await ambilJson(kunci, umurSimpan(url_pdf));
    if (tersimpan?.halaman?.length) return tersimpan;
  }

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer || (await getBuffer(url_pdf, { referer, timeout: 120000 })));
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

  const halaman = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const isi = await page.getTextContent();
    halaman.push({
      halaman: i,
      teks: isi.items
        .map((it) => (it.str || "") + (it.hasEOL ? "\n" : " "))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .trim(),
    });
  }

  const hasil = { total_halaman: doc.numPages, halaman };
  if (url_pdf) await simpanJson(kunci, hasil);
  return hasil;
}

export async function ekstrakTeksPdf({
  url_pdf,
  buffer,
  halaman_awal = 1,
  halaman_akhir = 0,
  cari = "",
  maks_karakter = 20000,
  referer,
  lewati_cache = false,
}) {
  const doc = await halamanPdf({ url_pdf, buffer, referer, lewati_cache });

  const akhir = halaman_akhir > 0 ? Math.min(halaman_akhir, doc.total_halaman) : doc.total_halaman;
  const awal = Math.max(1, halaman_awal);
  const dalamRentang = doc.halaman.filter((h) => h.halaman >= awal && h.halaman <= akhir);

  const dipakai = selectPdfPages(dalamRentang, cari);

  let total = 0;
  const keluar = [];
  for (const h of dipakai) {
    if (total + h.teks.length > maks_karakter) {
      keluar.push({
        halaman: h.halaman,
        teks: h.teks.slice(0, Math.max(0, maks_karakter - total)) + " …[terpotong]",
      });
      break;
    }
    keluar.push(h);
    total += h.teks.length;
  }

  return {
    url_pdf: url_pdf || null,
    total_halaman: doc.total_halaman,
    rentang: `${awal}-${akhir}`,
    kata_kunci: cari || null,
    halaman_dikembalikan: keluar.map((h) => h.halaman),
    catatan: CATATAN,
    isi: keluar,
  };
}

/** Cari kata kunci di seluruh dokumen sekaligus: kembalikan cuplikan berkonteks. */
export async function cariDalamPdf({ url_pdf, buffer, kata_kunci, konteks = 320, maks_temuan = 12, referer }) {
  const doc = await halamanPdf({ url_pdf, buffer, referer });
  const needle = String(kata_kunci).toLowerCase();
  const temuan = [];
  for (const h of doc.halaman) {
    const low = h.teks.toLowerCase();
    let p = low.indexOf(needle);
    while (p >= 0 && temuan.length < maks_temuan) {
      temuan.push({
        halaman: h.halaman,
        cuplikan: h.teks.slice(Math.max(0, p - konteks), p + needle.length + konteks).replace(/\s+/g, " ").trim(),
      });
      p = low.indexOf(needle, p + needle.length);
    }
    if (temuan.length >= maks_temuan) break;
  }
  return {
    url_pdf,
    total_halaman: doc.total_halaman,
    kata_kunci,
    jumlah_temuan: temuan.length,
    catatan: CATATAN,
    temuan,
  };
}
