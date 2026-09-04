// Sumber: Dewan Syariah Nasional MUI (dsnmui.or.id) — fatwa DSN-MUI adalah
// rujukan utama kesesuaian syariah bagi lembaga keuangan syariah Indonesia,
// dan sebagian besar isinya dipositifkan lewat POJK/PBI serta KHES.

import { getText, inline, decodeEntities } from "./http.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ambilJson, simpanJson } from "./cache.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = "https://dsnmui.or.id";
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "fatwa-dsn.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let memori = null;

export function parseHalaman(html) {
  const keluar = [];
  const baris = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  for (const tr of baris) {
    const sel = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (sel.length < 2) continue;
    const nomor = inline(sel[0]);
    if (!/^\d+\s*\/\s*DSN/i.test(nomor)) continue;
    const judul = inline(sel[1]);
    const tautan = (tr.match(/href="(https?:\/\/[^"]+)"/) || [])[1];
    const bagian = nomor.split("/").map((x) => x.trim());
    keluar.push({
      nomor,
      nomor_urut: Number(bagian[0]) || null,
      tahun: Number(bagian[3]) || null,
      judul,
      url_pdf: tautan ? decodeEntities(tautan) : null,
    });
  }
  return keluar;
}

/** Bangun indeks seluruh fatwa DSN-MUI (semua halaman), dengan cache 7 hari. */
export async function indeksFatwa({ paksa_segarkan = false } = {}) {
  if (memori && !paksa_segarkan) return memori;

  if (!paksa_segarkan) {
    try {
      const mentah = JSON.parse(await readFile(CACHE_FILE, "utf8"));
      if (Date.now() - mentah.diambil_pada < CACHE_TTL_MS && mentah.fatwa?.length) {
        memori = mentah;
        return memori;
      }
    } catch {}
  }

  const pertama = await getText(`${BASE}/kategori/fatwa/`);
  const nomorHalaman = [...pertama.matchAll(/\/kategori\/fatwa\/page\/(\d+)\//g)].map((m) => Number(m[1]));
  const totalHalaman = nomorHalaman.length ? Math.max(...nomorHalaman) : 1;

  const semua = parseHalaman(pertama);
  for (let h = 2; h <= totalHalaman; h++) {
    try {
      semua.push(...parseHalaman(await getText(`${BASE}/kategori/fatwa/page/${h}/`)));
    } catch {
      // satu halaman gagal tidak boleh membatalkan seluruh indeks
    }
  }

  const unik = new Map();
  for (const f of semua) if (!unik.has(f.nomor)) unik.set(f.nomor, f);

  memori = {
    sumber: "DSN-MUI",
    diambil_pada: Date.now(),
    total_halaman: totalHalaman,
    fatwa: [...unik.values()].sort((a, b) => (b.nomor_urut || 0) - (a.nomor_urut || 0)),
  };
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(memori), "utf8");
  } catch {}
  return memori;
}

export async function cariFatwaDsn({ query = "", nomor = "", tahun = 0, limit = 15, paksa_segarkan = false } = {}) {
  const idx = await indeksFatwa({ paksa_segarkan });
  const kata = query.toLowerCase().split(/\s+/).filter(Boolean);

  let hasil = idx.fatwa;
  if (nomor) hasil = hasil.filter((f) => f.nomor.toLowerCase().includes(String(nomor).toLowerCase()));
  if (tahun) hasil = hasil.filter((f) => f.tahun === Number(tahun));
  if (kata.length) {
    hasil = hasil
      .map((f) => {
        const teks = `${f.judul} ${f.nomor}`.toLowerCase();
        const skor = kata.reduce((n, k) => n + (teks.includes(k) ? 1 : 0), 0);
        return { f, skor };
      })
      .filter((x) => x.skor > 0)
      .sort((a, b) => b.skor - a.skor || (b.f.nomor_urut || 0) - (a.f.nomor_urut || 0))
      .map((x) => x.f);
  }

  return {
    sumber: "DSN-MUI",
    total_fatwa_terindeks: idx.fatwa.length,
    indeks_diambil: new Date(idx.diambil_pada).toISOString(),
    jumlah_cocok: hasil.length,
    hasil: hasil.slice(0, limit),
    catatan:
      "Fatwa DSN-MUI mengikat lembaga keuangan syariah lewat pemositifan dalam POJK/PBI/KHES. " +
      "Periksa juga peraturan otoritas yang mengadopsinya sebelum menyimpulkan daya ikat hukumnya.",
  };
}

/** Ambil teks salinan fatwa (PDF pada Google Drive). */
export async function teksFatwaDsn({ rujukan, cari = "", halaman_awal = 1, halaman_akhir = 0, maks_karakter = 20000 }) {
  const idx = await indeksFatwa();
  let url = rujukan;

  if (!/^https?:/i.test(rujukan)) {
    const f =
      idx.fatwa.find((x) => x.nomor.toLowerCase() === rujukan.toLowerCase()) ||
      idx.fatwa.find((x) => x.nomor.toLowerCase().includes(rujukan.toLowerCase()));
    if (!f) throw new Error(`Fatwa "${rujukan}" tidak ada dalam indeks. Cari dulu dengan cari_fatwa_dsn.`);
    url = f.url_pdf;
    if (!url) throw new Error(`Fatwa ${f.nomor} terindeks tanpa tautan salinan PDF.`);
  }

  const id = (url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/) || [])[1];
  // Berkas Drive lama memerlukan resourcekey; tanpa itu Drive mengembalikan
  // halaman masuk akun, bukan PDF-nya.
  const kunci = (url.match(/[?&]resourcekey=([^&]+)/) || [])[1];
  const urlUnduh = id
    ? `https://drive.google.com/uc?export=download&id=${id}${kunci ? `&resourcekey=${kunci}` : ""}`
    : url;

  const { getBuffer } = await import("./http.js");
  const buffer = await getBuffer(urlUnduh, { timeout: 120000 });
  if (buffer.slice(0, 5).toString("utf8") !== "%PDF-") {
    throw new Error(
      `Google Drive tidak mengembalikan PDF untuk fatwa ini (kemungkinan tautan lama yang menuntut " +
      "izin akses atau halaman antara). Buka salinannya langsung di ${url}`
    );
  }

  const { ekstrakTeksPdf } = await import("./pdf.js");
  const hasil = await ekstrakTeksPdf({ buffer, url_pdf: urlUnduh, cari, halaman_awal, halaman_akhir, maks_karakter });
  return { sumber: "DSN-MUI", url_tampilan: url, ...hasil };
}

// ---------------------------------------------------------------------------
// Produk DSN-MUI selain fatwa: Pedoman Implementasi dan Ta'limat (surat edaran).
//
// Fatwa menetapkan kaidah akadnya; pedoman implementasi menjelaskan cara
// menerapkannya pada produk nyata, dan ta'limat memuat arahan kelembagaan.
// Bagi praktisi dan Dewan Pengawas Syariah, dua produk inilah yang paling
// sering dicari setelah fatwanya sendiri.

const JENIS_PRODUK = {
  "pedoman-implementasi": {
    jalur: "/produk/pedoman-implementasi/",
    label: "Pedoman Implementasi Fatwa DSN-MUI",
  },
  talimat: {
    jalur: "/produk/talimat/",
    label: "Ta'limat (Surat Edaran) DSN-MUI",
  },
};

/** Tabel produk memakai 4 kolom: nomor urut, nomor dokumen, tentang, tautan. */
export function parseTabelProduk(html) {
  const keluar = [];
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
    const sel = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => inline(m[1]));
    if (sel.length < 3) continue;

    // Kolom pertama biasanya nomor urut; nomor dokumen ada di kolom yang memuat "DSN".
    const idxNomor = sel.findIndex((c) => /DSN/i.test(c));
    if (idxNomor < 0) continue;

    const nomor = sel[idxNomor];
    const tentang = sel[idxNomor + 1] || "";
    const tautan = (tr.match(/href="(https?:\/\/[^"]+)"/) || [])[1];
    const tahun = Number((nomor.match(/(\d{4})\s*$/) || [])[1]) || null;

    keluar.push({
      nomor,
      tahun,
      tentang,
      url_pdf: tautan ? decodeEntities(tautan) : null,
    });
  }
  return keluar;
}

/** Bangun indeks satu jenis produk DSN, disimpan 7 hari seperti indeks fatwa. */
export async function indeksProdukDsn(jenis = "pedoman-implementasi", { paksa_segarkan = false } = {}) {
  const info = JENIS_PRODUK[jenis];
  if (!info) {
    throw new Error(`Jenis produk "${jenis}" tidak dikenal. Pilihan: ${Object.keys(JENIS_PRODUK).join(", ")}.`);
  }

  const kunci = `dsn-produk::${jenis}`;
  if (!paksa_segarkan) {
    const tersimpan = await ambilJson(kunci, CACHE_TTL_MS);
    if (tersimpan?.dokumen?.length) return tersimpan;
  }

  const html = await getText(`${BASE}${info.jalur}`);
  const dokumen = parseTabelProduk(html);

  const indeks = {
    jenis,
    label: info.label,
    sumber: `${BASE}${info.jalur}`,
    diambil_pada: Date.now(),
    dokumen,
  };
  await simpanJson(kunci, indeks);
  return indeks;
}

/** Cari pedoman implementasi atau ta'limat berdasarkan kata kunci. */
export async function cariProdukDsn({ jenis = "pedoman-implementasi", query = "", tahun = 0, limit = 15 }) {
  const idx = await indeksProdukDsn(jenis);
  const kata = String(query).toLowerCase().split(/\s+/).filter(Boolean);

  let hasil = idx.dokumen;
  if (tahun) hasil = hasil.filter((d) => d.tahun === Number(tahun));
  if (kata.length) {
    hasil = hasil
      .map((d) => {
        const t = `${d.tentang} ${d.nomor}`.toLowerCase();
        return { d, skor: kata.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0) };
      })
      .filter((x) => x.skor > 0)
      .sort((a, b) => b.skor - a.skor)
      .map((x) => x.d);
  }

  return {
    sumber: "DSN-MUI",
    jenis,
    label: idx.label,
    total_terindeks: idx.dokumen.length,
    jumlah_cocok: hasil.length,
    hasil: hasil.slice(0, limit),
    catatan:
      "Pedoman implementasi dan ta'limat menjelaskan penerapan fatwa, tetapi tidak menggantikan fatwanya. " +
      "Baca fatwa induknya lewat cari_fatwa_dsn, dan ingat bahwa daya ikat hukum positifnya tetap bergantung " +
      "pada pemositifan lewat POJK, PBI, atau KHES. Untuk membaca isinya, oper url_pdf ke teks_fatwa_dsn.",
  };
}
