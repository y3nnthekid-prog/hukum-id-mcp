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
  kajian: "kajian-dan-penelitian-hukum",
  artikel: "artikel-hukum",
  monografi: "monografi-hukum",
};

/**
 * Pencarian JDIH MA mencocokkan teks judul secara harfiah, dan situs tidak
 * konsisten menuliskan nomor: PERMA ditulis "PERMA NOMOR 2 TAHUN 2008",
 * sedangkan SEMA ditulis "SEMA NO. 02 TAHUN 1994".
 *
 * Karena itu rujukan singkat seperti "PERMA 2/2008" dijabarkan menjadi beberapa
 * varian yang dicoba berurutan. Membebankan bentuk panjang yang tepat kepada
 * pemanggil hanya akan memindahkan jebakan ini kepada penggunanya.
 */
export function varianKueri(q = "") {
  const m = String(q).match(/^\s*(perma|sema|kma)\s*(?:no\.?|nomor)?\s*(\d+)\s*[/ ]\s*(?:tahun\s*)?(\d{4})\s*$/i);
  if (!m) return [q];

  const jenis = m[1].toLowerCase();
  const nomor = m[2];
  const tahun = m[3];
  const nol = nomor.length === 1 ? `0${nomor}` : nomor;

  const varian = [
    `${jenis} nomor ${nomor} tahun ${tahun}`,
    `${jenis} no. ${nol} tahun ${tahun}`,
    `${jenis} nomor ${nol} tahun ${tahun}`,
    `${jenis} no. ${nomor} tahun ${tahun}`,
  ];
  return [...new Set(varian)];
}

function parseHasil(html, limit) {
  const hasil = [];
  for (const blok of html.split(/class="event-item-metal"/).slice(1)) {
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
  return hasil;
}

export async function cariPerma({ query = "", jenis = "peraturan", tahun = "", limit = 15 } = {}) {
  const varian = varianKueri(query);
  let terakhirUrl = null;

  for (const kueri of varian) {
    const qs = new URLSearchParams({ jenis: JENIS[jenis] || jenis, search: kueri });
    if (tahun) qs.set("year", String(tahun));
    const url = `${BASE}/dokumen?${qs.toString()}`;
    terakhirUrl = url;

    const html = await getText(url);
    const hasil = parseHasil(html, limit);

    if (hasil.length) {
      return {
        sumber: "JDIH Mahkamah Agung RI",
        url_pencarian: url,
        jenis,
        kueri_dipakai: kueri,
        varian_dicoba: varian.slice(0, varian.indexOf(kueri) + 1),
        jumlah_ditampilkan: hasil.length,
        hasil,
        catatan:
          "Untuk membaca isinya, oper url_pdf ke teks_peraturan. Produk hukum MA (PERMA/SEMA/KMA) tidak " +
          "terindeks di JDIH BPK, jadi cari di sini, bukan lewat cari_peraturan.",
      };
    }
  }

  return {
    sumber: "JDIH Mahkamah Agung RI",
    url_pencarian: terakhirUrl,
    jenis,
    varian_dicoba: varian,
    jumlah_ditampilkan: 0,
    hasil: [],
    catatan:
      "Tidak ditemukan setelah mencoba seluruh varian penulisan nomor. Pencarian JDIH MA mencocokkan teks judul " +
      "secara harfiah, jadi coba kata kunci topikal (mis. 'ekonomi syariah', 'kompilasi') alih-alih nomor.",
  };
}
