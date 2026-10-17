// Ekstraksi teks PDF bersama, dipakai untuk PDF peraturan, putusan, dan fatwa.
//
// Membedah PDF adalah bagian termahal dari seluruh alur (putusan MK 254 halaman
// perlu puluhan detik). Karena isi PDF resmi tidak pernah berubah, hasil
// ekstraksinya disimpan per dokumen, lalu penyaringan halaman dan kata kunci
// dilakukan di atas hasil simpanan itu.

import { getBufferBersumber } from "./http.js";
import { ambilJson, simpanJson, umurSimpan, waktuSimpan } from "./cache.js";
import { parseLegalDate, selectPdfPages } from "./trust.js";
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const PDF_PROFILE = JSON.parse(readFileSync(new URL("../pdf-profile.json", import.meta.url), "utf8"));
export const PDF_EXTRACTION_PROFILE = createHash("sha256").update(JSON.stringify(PDF_PROFILE)).digest("hex");

export const PDF_LIMITS = { maxBytes: 16 * 1024 * 1024, maxPages: 600, maxChars: 4_000_000, maxPageChars: 150_000, maxPageItems: 100_000, timeoutMs: 45_000 };
const WORKER_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 96, stackSizeMb: 4 };

export function extractPdfIsolated(data, limits = PDF_LIMITS, workerUrl = new URL("./pdf-worker.js", import.meta.url)) {
  if (data.byteLength > limits.maxBytes) return Promise.reject(new Error("PDF_BYTE_LIMIT"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { execArgv: [], workerData: { data, maxPages: limits.maxPages, maxChars: limits.maxChars, maxPageChars: limits.maxPageChars ?? PDF_LIMITS.maxPageChars, maxPageItems: limits.maxPageItems ?? PDF_LIMITS.maxPageItems, documentOptions: PDF_PROFILE.textOptions }, resourceLimits: WORKER_RESOURCE_LIMITS });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("PDF_DEADLINE")), limits.timeoutMs);
    worker.once("message", result => finish(result.error ? new Error(result.error) : null, result));
    worker.once("error", () => finish(new Error("PDF_RESOURCE_LIMIT")));
    worker.once("exit", () => finish(new Error("PDF_WORKER_EXIT")));
  });
}

const CATATAN =
  "Sebagian PDF resmi punya lapisan teks yang cacat. Bandingkan dengan PDF sumber sebelum mengutip verbatim.";

export { pageText } from "./pdf-text.js";

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
export async function halamanPdf({ url_pdf, buffer, referer, lewati_cache = false, asal = null }) {
  const policy = JSON.stringify({ limits: PDF_LIMITS, resources: WORKER_RESOURCE_LIMITS });
  const kunci = "pdf-teks::" + PDF_EXTRACTION_PROFILE + "::" + policy + "::" + (url_pdf || "buffer");
  // Buffer tidak dapat dibuktikan berasal dari URL ini; jangan baca/tulis cache URL-nya.
  if (url_pdf && !buffer && !lewati_cache) {
    const tersimpan = await ambilJson(kunci, umurSimpan(url_pdf));
    if (tersimpan?.halaman?.length) {
      // Entri lama belum mencatat waktu ambil; waktu tulis berkas cache adalah batas atasnya.
      const diambil_pada = tersimpan.diambil_pada || (await waktuSimpan(kunci, ".json"));
      return withExtractionHealth({ ...tersimpan, diambil_pada, dari_cache: true });
    }
  }

  // `asal` membawa waktu ambil untuk buffer yang sudah diunduh pemanggil (mis. fatwa dari Drive).
  const unduhan = buffer ? asal : await getBufferBersumber(url_pdf, { referer, timeout: 120000, maxBytes: PDF_LIMITS.maxBytes });
  const data = new Uint8Array(buffer || unduhan.buffer);
  const extracted = await extractPdfIsolated(data);

  const diambil_pada = unduhan?.diambil_pada || new Date().toISOString();
  const hasil = withExtractionHealth({ ...extracted, diambil_pada, extraction_profile: PDF_EXTRACTION_PROFILE });
  if (url_pdf && !buffer) await simpanJson(kunci, hasil);
  return { ...hasil, dari_cache: Boolean(unduhan?.dari_cache) };
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
  asal = null,
}) {
  const doc = await halamanPdf({ url_pdf, buffer, referer, lewati_cache, asal });

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
    diambil_pada: doc.diambil_pada || null,
    dari_cache: Boolean(doc.dari_cache),
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
