// Sumber: Mahkamah Konstitusi RI (mkri.id) — putusan PUU, SKLN, PHPU, PHPKADA.
// Halaman putusan adalah aplikasi Next.js; datanya ikut terkirim sebagai
// rekaman JSON di dalam payload halaman, jadi itulah yang dibaca (lebih stabil
// daripada membedah DOM).

import { getText, decodeEntities } from "./http.js";

const BASE = "https://www.mkri.id";

export const JENIS_PERKARA = {
  PUU: "Pengujian Undang-Undang terhadap UUD 1945",
  SKLN: "Sengketa Kewenangan Lembaga Negara",
  PHPU: "Perselisihan Hasil Pemilihan Umum",
  PHPKADA: "Perselisihan Hasil Pemilihan Kepala Daerah",
};

function bersih(v) {
  return typeof v === "string" ? decodeEntities(v).replace(/\s*\r?\n\s*/g, " ").replace(/\s{2,}/g, " ").trim() : v;
}

export async function cariPutusanMK({ query = "", jenis = "", halaman = 1, limit = 10, opsi_jaringan } = {}) {
  const qs = new URLSearchParams({ search: query });
  if (jenis) qs.set("jenis", jenis.toUpperCase());
  if (Number(halaman) > 1) qs.set("page", String(halaman));
  const url = `${BASE}/perkara/persidangan/putusan?${qs.toString()}`;
  const html = await getText(url, opsi_jaringan);

  // Payload berupa literal string JS, jadi tanda kutip di dalamnya ter-escape.
  const BS = String.fromCharCode(92);
  const flat = html.split(BS + '"').join('"');
  const hasil = [];
  for (const m of flat.matchAll(/\{"jenisnya":[\s\S]{0,20000}?"link_hit":"[^"]*"\}/g)) {
    let r;
    try {
      r = JSON.parse(m[0]);
    } catch {
      continue;
    }
    if (!r.no_perkara) continue;
    hasil.push({
      nomor_perkara: bersih(r.no_perkara),
      jenis: r.jenisnya || null,
      pokok_perkara: bersih(r.pokok_perkara),
      pemohon: bersih(r.pemohon),
      amar_putusan: bersih(r.amar_putusan),
      status: bersih(r.status),
      tanggal: bersih(r.date),
      kata_kunci: bersih(r.keywords) || null,
      berkas_putusan: r.link_hit || null,
      berkas_pendukung: r.supporting_file || null,
    });
    if (hasil.length >= limit) break;
  }

  // Situs MK mencocokkan nomor perkara sebagai substring, sehingga kueri
  // "48/PUU-XXIII/2025" ikut mengembalikan "248/PUU-XXIII/2025". Bila kueri
  // berbentuk nomor perkara, dahulukan yang persis sama.
  const kueriNomor = /^\s*\d+\s*\/\s*[A-Za-z.-]+\s*\/\s*\d{4}\s*$/.test(query);
  let keluaran = hasil;
  let catatanNomor = null;
  if (kueriNomor) {
    const rapi = query.replace(/\s+/g, "");
    const persis = hasil.filter((h) => (h.nomor_perkara || "").replace(/\s+/g, "") === rapi);
    if (persis.length) {
      keluaran = [...persis, ...hasil.filter((h) => !persis.includes(h))];
      catatanNomor = `Kueri dikenali sebagai nomor perkara; ${persis.length} hasil yang persis sama didahulukan.`;
    } else {
      catatanNomor =
        "Tidak ada hasil yang nomornya persis sama dengan kueri. Hasil di bawah ini hanya cocok sebagian " +
        "(pencarian MK memakai substring), jadi jangan diperlakukan sebagai perkara yang dicari.";
    }
  }

  return {
    sumber: "Mahkamah Konstitusi RI",
    catatan_pencocokan: catatanNomor,
    url_pencarian: url,
    filter_jenis: jenis ? `${jenis.toUpperCase()} — ${JENIS_PERKARA[jenis.toUpperCase()] || "?"}` : "semua jenis",
    halaman: Number(halaman),
    jumlah_ditampilkan: hasil.length,
    hasil: keluaran,
  };
}
