// Ekstraksi teks PDF bersama, dipakai untuk PDF peraturan, putusan, dan fatwa.
//
// Membedah PDF adalah bagian termahal dari seluruh alur (putusan MK 254 halaman
// perlu puluhan detik). Karena isi PDF resmi tidak pernah berubah, hasil
// ekstraksinya disimpan per dokumen, lalu penyaringan halaman dan kata kunci
// dilakukan di atas hasil simpanan itu.

import { getBuffer } from "./http.js";
import { ambilJson, simpanJson, umurSimpan } from "./cache.js";
import { parseLegalDate, selectPdfPages } from "./trust.js";

const CATATAN =
  "Sebagian PDF resmi punya lapisan teks yang cacat. Bandingkan dengan PDF sumber sebelum mengutip verbatim.";

function textItems(items) {
  return items
    .filter((item) => typeof item.str === "string" && item.str.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
      width: Number(item.width ?? 0),
      height: Math.max(Number(item.height ?? 0), 1),
    }));
}

function renderLines(items) {
  const ordered = [...items].sort((left, right) => {
    const sameLine = Math.abs(left.y - right.y) <= Math.max(left.height, right.height) * 0.35;
    return sameLine ? left.x - right.x : right.y - left.y;
  });
  const lines = [];
  for (const item of ordered) {
    const current = lines.at(-1);
    if (current && Math.abs(current.y - item.y) <= Math.max(current.height, item.height) * 0.35) {
      current.parts.push(item);
      current.height = Math.max(current.height, item.height);
    } else {
      lines.push({ y: item.y, height: item.height, parts: [item] });
    }
  }
  return lines
    .map((line) => line.parts.sort((left, right) => left.x - right.x).map((item) => item.text).join(" "))
    .join("\n");
}

function pageText(items, pageWidth) {
  const positioned = textItems(items);
  if (positioned.length === 0) return "";

  const midpoint = pageWidth / 2;
  const left = positioned.filter((item) => item.x + item.width / 2 < midpoint);
  const right = positioned.filter((item) => item.x + item.width / 2 >= midpoint);
  const leftEdge = left.length ? Math.max(...left.map((item) => item.x + item.width)) : Infinity;
  const rightEdge = right.length ? Math.min(...right.map((item) => item.x)) : -Infinity;
  const hasSeparatedColumns =
    left.length >= 2 && right.length >= 2 && rightEdge - leftEdge >= Math.max(24, pageWidth * 0.04);

  return (hasSeparatedColumns ? `${renderLines(left)}\n${renderLines(right)}` : renderLines(positioned))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const DATE_PATTERNS = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g,
  /\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}\b/gi,
];

export function assessPdfExtraction(pages) {
  const emptyPages = pages.filter((page) => !String(page.teks ?? "").trim()).map((page) => page.halaman);
  const textLayerPages = pages.length - emptyPages.length;
  const invalidLegalDates = [];
  let suspiciousArabicMapping = false;

  for (const page of pages) {
    const text = String(page.teks ?? "");
    for (const pattern of DATE_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (!parseLegalDate(match[0]) && !invalidLegalDates.includes(match[0])) invalidLegalDates.push(match[0]);
      }
    }
    const hasArabicMarker = /\b(?:teks|dalil|kutipan)\s+arab\b/i.test(text);
    const hasArabicCodePoint = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(text);
    const hasBrokenGlyph = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff]/u.test(text);
    if ((hasArabicMarker && !hasArabicCodePoint) || hasBrokenGlyph) suspiciousArabicMapping = true;
  }

  const warnings = [];
  if (textLayerPages === 0) {
    warnings.push("PDF tidak memiliki lapisan teks; ekstraksi dihentikan dan memerlukan pemeriksaan manusia.");
  } else if (emptyPages.length > 0) {
    warnings.push(`Halaman tanpa teks dilewati tanpa mengubah nomor halaman asli: ${emptyPages.join(", ")}.`);
  }
  if (suspiciousArabicMapping) {
    warnings.push("Teks Arab tidak dapat dipercaya karena pemetaan font tampak hilang atau non-Unicode.");
  }
  if (invalidLegalDates.length > 0) {
    warnings.push(`Tanggal kalender tidak sah di dalam PDF ditolak: ${invalidLegalDates.join(", ")}.`);
  }

  return {
    status: textLayerPages === 0 ? "no_text_layer" : warnings.length > 0 ? "degraded" : "ok",
    text_layer_pages: textLayerPages,
    empty_pages: emptyPages,
    invalid_legal_dates: invalidLegalDates,
    warnings,
  };
}

function withExtractionHealth(document) {
  return {
    ...document,
    extraction_health: assessPdfExtraction(document.halaman ?? []),
  };
}

/** Ambil seluruh halaman sebagai teks, dari cache bila ada. */
export async function halamanPdf({ url_pdf, buffer, referer, lewati_cache = false }) {
  const kunci = "pdf-teks::" + (url_pdf || "buffer");
  if (url_pdf && !lewati_cache) {
    const tersimpan = await ambilJson(kunci, umurSimpan(url_pdf));
    if (tersimpan?.halaman?.length) return withExtractionHealth(tersimpan);
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
      teks: pageText(isi.items, page.getViewport({ scale: 1 }).width),
    });
  }

  const hasil = withExtractionHealth({ total_halaman: doc.numPages, halaman });
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
  const dalamRentang = doc.halaman.filter(
    (h) => h.halaman >= awal && h.halaman <= akhir && String(h.teks ?? "").trim()
  );

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
    extraction_health: doc.extraction_health,
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
    extraction_health: doc.extraction_health,
    catatan: CATATAN,
    temuan,
  };
}
