// Pemeriksaan kesehatan sumber.
//
// Kerusakan yang paling berbahaya bukan galat yang terlihat, melainkan parser
// yang tetap berjalan tetapi mengembalikan kosong karena situs sumber berganti
// tampilan. Tool tetap menjawab, jawabannya terdengar wajar, dan penggunanya
// tidak tahu apa-apa.
//
// Karena itu pemeriksaan di sini tidak berhenti pada "permintaan berhasil".
// Tiap sumber ditembak dengan kueri yang HASILNYA SUDAH DIKETAHUI, lalu bentuk
// keluarannya diperiksa. Permintaan yang berhasil tetapi hasilnya kosong
// dilaporkan sebagai berubah_struktur — dan itulah sinyal yang penting.

import { paksaLewatiCache, getText } from "./http.js";
import { cariPeraturan, detailPeraturan } from "./bpk.js";
import { telusuriPutusan } from "./ma.js";
import { cariPutusanMK } from "./mk.js";
import { cariPerma } from "./perma.js";
import { parseHalaman } from "./dsn.js";
import { ambilAyat, hadisBerderajat } from "./dalil.js";
import { cariTurats } from "./turats.js";
import { cariLiteratur } from "./scholar.js";

const AMBANG_LAMBAT_MS = 6000;

const PROBA = [
  {
    sumber: "JDIH BPK — pencarian peraturan",
    host: "peraturan.bpk.go.id",
    penting: true,
    async jalan() {
      const r = await cariPeraturan({ keywords: "perbankan syariah", nomor: "21", tahun: "2008", limit: 4 });
      const uu = r.hasil.find((h) => h.jenis === "UU" && h.nomor === "21" && h.tahun === "2008");
      return { baik: Boolean(uu), bukti: uu ? uu.judul.slice(0, 50) : `${r.hasil.length} hasil, UU 21/2008 tidak ada` };
    },
  },
  {
    sumber: "JDIH BPK — detail dan status",
    host: "peraturan.bpk.go.id",
    penting: true,
    async jalan() {
      const r = await cariPeraturan({ keywords: "perbankan syariah", nomor: "21", tahun: "2008", limit: 3 });
      const pilih = r.hasil.find((h) => h.jenis === "UU") || r.hasil[0];
      if (!pilih) return { baik: false, bukti: "pencarian tidak memberi kandidat" };
      const d = await detailPeraturan(pilih.id);
      const lengkap = Boolean(d.status && d.judul && d.berkas.length);
      return { baik: lengkap, bukti: lengkap ? `status "${d.status}", ${d.berkas.length} berkas` : "metadata tidak lengkap" };
    },
  },
  {
    sumber: "Direktori Putusan MA — telusur kategori",
    host: "putusan3.mahkamahagung.go.id",
    penting: false,
    async jalan() {
      const r = await telusuriPutusan({ kategori: "korupsi-1", limit: 3 });
      return { baik: r.hasil.length > 0, bukti: r.hasil[0]?.judul?.slice(0, 48) || "daftar kosong" };
    },
  },
  {
    sumber: "Mahkamah Konstitusi — putusan",
    host: "www.mkri.id",
    penting: true,
    async jalan() {
      const r = await cariPutusanMK({ query: "pemilu", limit: 3 });
      const utuh = r.hasil.filter((h) => h.nomor_perkara && h.amar_putusan).length;
      return { baik: utuh > 0, bukti: utuh ? `${utuh} putusan lengkap — ${r.hasil[0].nomor_perkara}` : "hasil kosong" };
    },
  },
  {
    sumber: "JDIH Mahkamah Agung — PERMA/SEMA",
    host: "jdih.mahkamahagung.go.id",
    penting: false,
    async jalan() {
      const r = await cariPerma({ query: "ekonomi syariah", limit: 4 });
      return { baik: r.hasil.length > 0, bukti: r.hasil[0]?.judul || "daftar kosong" };
    },
  },
  {
    sumber: "DSN-MUI — indeks fatwa",
    host: "dsnmui.or.id",
    penting: true,
    async jalan() {
      // Sengaja menembak halaman mentah, bukan indeks. Indeks fatwa disimpan di
      // memori proses, sehingga memakainya di sini akan selalu tampak sehat
      // meski situs DSN sudah berganti tampilan.
      const html = await getText("https://dsnmui.or.id/kategori/fatwa/");
      const baris = parseHalaman(html);
      const berpola = baris.filter((f) => /DSN/i.test(f.nomor) && f.url_pdf).length;
      return {
        baik: berpola >= 5,
        bukti: berpola ? `${berpola} fatwa terbaca dari halaman pertama — ${baris[0].nomor}` : "tabel fatwa tidak terbaca",
      };
    },
  },
  {
    sumber: "Al-Quran — ayat dan terjemahan",
    host: "api.myquran.com",
    penting: false,
    async jalan() {
      const a = await ambilAyat({ surah: 2, ayat: 275 });
      return { baik: Boolean(a.arab && a.terjemah), bukti: a.rujukan };
    },
  },
  {
    sumber: "Ensiklopedia Hadis — derajat",
    host: "hadeethenc.com",
    penting: false,
    async jalan() {
      const h = await hadisBerderajat({ id: "5907" });
      return { baik: Boolean(h.arab && h.derajat), bukti: `derajat ${h.derajat}, takhrij ${h.takhrij}` };
    },
  },
  {
    sumber: "Kitab turats — verifikasi kaidah",
    host: "api.turath.io",
    penting: false,
    async jalan() {
      const r = await cariTurats({ query: "الخراج بالضمان", limit: 2 });
      return { baik: r.hasil.length > 0 && Boolean(r.hasil[0].kitab), bukti: r.hasil[0]?.kitab?.slice(0, 40) || "kosong" };
    },
  },
  {
    sumber: "OpenAlex — literatur",
    host: "api.openalex.org",
    penting: false,
    async jalan() {
      const r = await cariLiteratur({ query: "indonesian constitutional law", limit: 2 });
      return { baik: (r.hasil?.length || 0) > 0, bukti: r.hasil?.[0]?.judul?.slice(0, 45) || "kosong" };
    },
  },
];

function golongkanGalat(pesan) {
  const p = String(pesan || "");
  if (/membatasi akses otomatis|HTTP 403|HTTP 429/i.test(p)) return "membatasi";
  if (/timed out|timeout|ETIMEDOUT|ENOTFOUND|ECONNRESET|HTTP 5\d\d/i.test(p)) return "gagal_jaringan";
  return "gagal";
}

/**
 * Tembak tiap sumber dengan kueri yang hasilnya sudah diketahui, lalu laporkan
 * kesehatannya. Secara bawaan cache dilewati, karena pemeriksaan yang dilayani
 * cache akan selalu terlihat sehat meski situsnya sudah berubah.
 */
export async function periksaKesehatanSumber({ pakai_cache = false, hanya_penting = false } = {}) {
  const daftar = hanya_penting ? PROBA.filter((p) => p.penting) : PROBA;

  if (!pakai_cache) paksaLewatiCache(true);
  const hasil = [];
  try {
    for (const p of daftar) {
      const mulai = Date.now();
      try {
        const r = await p.jalan();
        const ms = Date.now() - mulai;
        hasil.push({
          sumber: p.sumber,
          host: p.host,
          penting: p.penting,
          status: r.baik ? (ms > AMBANG_LAMBAT_MS ? "lambat" : "sehat") : "berubah_struktur",
          ms,
          bukti: r.bukti,
          ...(r.baik
            ? {}
            : {
                catatan:
                  "Permintaan berhasil tetapi hasilnya tidak sesuai bentuk yang diharapkan. " +
                  "Ini gejala situs sumber berganti tampilan sehingga parser perlu diperbarui. " +
                  "Jalankan test/parser.test.js untuk memastikan kode belum berubah, lalu perbarui fixture-nya.",
              }),
        });
      } catch (e) {
        hasil.push({
          sumber: p.sumber,
          host: p.host,
          penting: p.penting,
          status: golongkanGalat(e.message),
          ms: Date.now() - mulai,
          bukti: String(e.message).slice(0, 120),
        });
      }
    }
  } finally {
    if (!pakai_cache) paksaLewatiCache(false);
  }

  const hitung = hasil.reduce((a, h) => ((a[h.status] = (a[h.status] || 0) + 1), a), {});
  const berubah = hasil.filter((h) => h.status === "berubah_struktur");
  const pentingBermasalah = hasil.filter((h) => h.penting && h.status !== "sehat" && h.status !== "lambat");

  const peringatan = [];
  if (berubah.length) {
    peringatan.push(
      `${berubah.length} sumber mengembalikan bentuk yang tidak diharapkan: ` +
        berubah.map((h) => h.sumber).join("; ") +
        ". Ini kerusakan senyap — tool akan tetap menjawab, tetapi jawabannya kosong atau keliru. Perbaiki parsernya."
    );
  }
  if (pentingBermasalah.length) {
    peringatan.push(
      `Sumber inti bermasalah: ${pentingBermasalah.map((h) => `${h.sumber} (${h.status})`).join("; ")}. ` +
        "Hasil riset yang bergantung padanya tidak bisa dipercaya sampai pulih."
    );
  }
  if (hasil.some((h) => h.status === "membatasi")) {
    peringatan.push(
      "Ada sumber yang sedang membatasi akses otomatis. Ini biasanya sementara dan pulih sendiri; " +
        "sementara itu cache tetap melayani dokumen yang sudah pernah diambil."
    );
  }
  if (!peringatan.length) peringatan.push("Seluruh sumber sehat.");

  return {
    diperiksa_pada: new Date().toISOString(),
    memakai_cache: pakai_cache,
    jumlah_diperiksa: hasil.length,
    ringkasan: hitung,
    hasil,
    peringatan,
  };
}
