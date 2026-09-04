// Sumber: JDIH Mahkamah Agung (jdih.mahkamahagung.go.id) — PERMA, SEMA, dan
// Keputusan KMA. Penting karena produk hukum MA tidak terindeks di JDIH BPK,
// padahal di situlah KHES (PERMA 2/2008) dan tata cara penyelesaian perkara
// ekonomi syariah (PERMA 14/2016) berada.

import { getText, inline, decodeEntities } from "./http.js";

const BASE = "https://jdih.mahkamahagung.go.id";

const JENIS = {
  peraturan: "puu",
  putusan: "putusan",
  "naskah-akademik": "naskah-akademik",
  "kajian": "kajian-dan-penelitian-hukum",
  "artikel": "artikel-hukum",
  "monografi": "monografi-hukum",
};

export async function cariPerma({ query = "", jenis = "peraturan", tahun = "", limit = 15 } = {}) {
  const qs = new URLSearchParams({ jenis: JENIS[jenis] || jenis, search: query });
  if (tahun) qs.set("year", String(tahun));
  const url = `${BASE}/dokumen?${qs.toString()}`;
  const html = await getText(url);

  const hasil = [];
  const potongan = html.split(/class="event-item-metal"/).slice(1);
  for (const blok of potongan) {
    if (hasil.length >= limit) break;
    const pdf = (blok.match(/data-pdf="([^"]+)"/) || [])[1];
    const judulM = blok.match(/<h3>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/);
    if (!judulM) continue;
    const perihal = (blok.match(/<p class="highlight-text">([\s\S]*?)<\/p>/) || [])[1];
    const tanggal = (blok.match(/icon-date-accent\.svg"[^>]*>\s*([^<]{6,30})/) || [])[1];
    hasil.push({
      judul: inline(judulM[2]),
      perihal: perihal ? inline(perihal) : null,
      tanggal: tanggal ? inline(tanggal) : null,
      url_detail: decodeEntities(judulM[1]),
      url_pdf: pdf ? decodeEntities(pdf).trim() : null,
    });
  }

  return {
    sumber: "JDIH Mahkamah Agung RI",
    url_pencarian: url,
    jenis,
    jumlah_ditampilkan: hasil.length,
    hasil,
    catatan:
      "Untuk membaca isinya, oper url_pdf ke teks_peraturan. Produk hukum MA (PERMA/SEMA/KMA) " +
      "tidak terindeks di JDIH BPK, jadi cari di sini, bukan lewat cari_peraturan.",
  };
}
