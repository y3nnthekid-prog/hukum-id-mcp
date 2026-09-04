// Sumber dalil naqli: ayat Al-Qur'an dan hadis, lengkap dengan teks Arab yang
// benar, transliterasi, dan terjemahan Indonesia.
//
// Alasan modul ini ada: lapisan teks Arab pada PDF fatwa dan sebagian dokumen
// resmi sering rusak karena memakai font non-Unicode. Teks Arab yang dikutip
// harus datang dari sumber yang memang menyajikannya sebagai Unicode.

import { getJson } from "./http.js";

const MYQURAN = "https://api.myquran.com/v2";
const QURANCOM = "https://api.quran.com/api/v4";

function rapikan(s) {
  return typeof s === "string" ? s.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim() : s;
}

export async function ambilAyat({ surah, ayat }) {
  const j = await getJson(`${MYQURAN}/quran/ayat/${surah}/${ayat}`);
  if (!j.status || !j.data?.length) throw new Error(`Ayat ${surah}:${ayat} tidak ditemukan.`);
  const a = j.data[0];
  const info = j.info?.surat || {};
  return {
    sumber: "myquran.com (teks & terjemahan Kemenag RI)",
    rujukan: `QS. ${info.nama?.id || surah}: ${ayat}`,
    surah: { nomor: info.id ?? Number(surah), nama_arab: info.nama?.ar || null, nama_latin: info.nama?.id || null, golongan: info.relevasi || null },
    ayat: Number(ayat),
    arab: a.arab || null,
    latin: rapikan(a.latin),
    terjemah: rapikan(a.text),
    tema: rapikan(a.theme) || null,
    asbab_nuzul: rapikan(a.asbab) || null,
    juz: a.juz ?? null,
  };
}

export async function cariAyat({ query, limit = 5 }) {
  const j = await getJson(`${QURANCOM}/search?${new URLSearchParams({ q: query, size: String(Math.min(limit, 10)), language: "id" })}`);
  const kunci = (j.search?.results || []).map((r) => r.verse_key).filter(Boolean).slice(0, Math.min(limit, 8));

  const hasil = [];
  for (const k of kunci) {
    const [s, a] = k.split(":");
    try {
      hasil.push(await ambilAyat({ surah: s, ayat: a }));
    } catch {
      hasil.push({ rujukan: `QS. ${k}`, catatan: "gagal mengambil terjemahan" });
    }
  }

  return {
    sumber: "quran.com (pencarian) + myquran.com (teks & terjemahan)",
    kueri: query,
    total_temuan: j.search?.total_results ?? null,
    jumlah_ditampilkan: hasil.length,
    hasil,
    catatan:
      "Pencarian ini leksikal, bukan tafsir. Ayat yang muncul belum tentu menjadi dalil yang tepat " +
      "untuk masalahnya — periksa konteks, asbab nuzul, dan penggunaannya dalam fatwa atau kitab fikih.",
  };
}

export async function daftarKitabHadis() {
  const j = await getJson(`${MYQURAN}/hadits/perawi`);
  return {
    sumber: "myquran.com",
    kitab: (j.data || []).map((k) => ({ nama: k.name, slug: k.slug, jumlah_hadis: k.total })),
    catatan:
      "Penomoran mengikuti penomoran kitab pada sumber ini dan bisa berbeda dari cetakan lain " +
      "(mis. penomoran Fathul Bari vs penomoran Darussalam). Sebutkan sumber penomoran saat mengutip.",
  };
}

export async function ambilHadis({ kitab, nomor }) {
  const j = await getJson(`${MYQURAN}/hadits/${encodeURIComponent(kitab)}/${encodeURIComponent(nomor)}`);
  if (!j.status || !j.data) throw new Error(`Hadis ${kitab} no. ${nomor} tidak ditemukan.`);
  const p = j.info?.perawi || {};
  return {
    sumber: "myquran.com",
    kitab: p.name || kitab,
    nomor: j.data.number ?? Number(nomor),
    arab: j.data.arab || null,
    terjemah: rapikan(j.data.id),
    catatan:
      "Sumber ini tidak menyertakan status kesahihan. Untuk dokumen formal, verifikasi takhrij dan " +
      "derajat hadisnya pada kitab syarah atau pada bagian 'Mengingat' fatwa DSN-MUI yang relevan.",
  };
}

// ---------------------------------------------------------------------------
// Hadis berderajat (hadeethenc.com — Ensiklopedia Hadis Nabawi).
//
// Sumber penomoran kitab di atas tidak menyertakan status kesahihan, padahal
// bagi kajian hukum derajat hadis menentukan boleh tidaknya sebuah dalil
// dipakai menetapkan halal-haram. Sumber ini melengkapinya: derajat, takhrij,
// syarah, dan faedah, dalam bahasa Indonesia.
//
// Keduanya sengaja dipertahankan berdampingan. Penomoran hadis berbeda antar
// sumber, jadi jangan menyilangkan nomor dari satu sumber ke sumber lain.

import { ambilJson, simpanJson } from "./cache.js";

const HE = "https://hadeethenc.com/api/v1";
const TTL_INDEKS = 30 * 24 * 60 * 60 * 1000;

/** Kategori "Fikih dan Usul Fikih" — paling relevan untuk muamalah. */
export const KATEGORI_FIKIH = "4";

export async function daftarKategoriHadis() {
  const data = await getJson(`${HE}/categories/list/?language=id`);
  return {
    sumber: "hadeethenc.com (Ensiklopedia Hadis Nabawi)",
    catatan: "Untuk hukum ekonomi syariah, kategori yang paling relevan biasanya Fikih dan Usul Fikih (id 4).",
    kategori: (data || []).map((k) => ({
      id: k.id,
      judul: k.title,
      jumlah_hadis: Number(k.hadeeths_count) || 0,
      induk: k.parent_id || null,
    })),
  };
}

/** Bangun indeks judul hadis satu kategori, lalu simpan 30 hari. */
export async function indeksHadisKategori(kategori_id = KATEGORI_FIKIH, { paksa_segarkan = false } = {}) {
  const kunci = `hadis-indeks::${kategori_id}`;
  if (!paksa_segarkan) {
    const tersimpan = await ambilJson(kunci, TTL_INDEKS);
    if (tersimpan?.hadis?.length) return tersimpan;
  }

  const pertama = await getJson(`${HE}/hadeeths/list/?language=id&category_id=${kategori_id}&page=1`);
  const totalHalaman = Number(pertama?.meta?.last_page) || 1;
  const hadis = (pertama?.data || []).map((h) => ({ id: h.id, judul: h.title }));

  for (let p = 2; p <= totalHalaman; p++) {
    try {
      const d = await getJson(`${HE}/hadeeths/list/?language=id&category_id=${kategori_id}&page=${p}`);
      for (const h of d?.data || []) hadis.push({ id: h.id, judul: h.title });
    } catch {
      // satu halaman gagal tidak boleh membatalkan seluruh indeks
    }
  }

  const indeks = {
    kategori_id: String(kategori_id),
    diambil_pada: Date.now(),
    total_menurut_sumber: Number(pertama?.meta?.total_items) || hadis.length,
    hadis,
  };
  await simpanJson(kunci, indeks);
  return indeks;
}

/** Cari hadis berdasarkan kata kunci pada judulnya, lalu ambil derajatnya. */
export async function cariHadisBerderajat({ query, kategori_id = KATEGORI_FIKIH, limit = 5, ambil_detail = true }) {
  const indeks = await indeksHadisKategori(kategori_id);
  const kata = String(query).toLowerCase().split(/\s+/).filter(Boolean);

  // Cocokkan sebagai kata utuh, bukan potongan. Tanpa ini kata "riba" ikut
  // cocok di dalam "beribadah", dan hasilnya menyesatkan.
  const jadikanToken = (t) => " " + String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const kataToken = kata.map((k) => jadikanToken(k).trim());

  const cocok = indeks.hadis
    .map((h) => {
      const t = jadikanToken(h.judul);
      return { h, skor: kataToken.reduce((n, k) => n + (t.includes(" " + k + " ") ? 1 : 0), 0) };
    })
    .filter((x) => x.skor > 0)
    .sort((a, b) => b.skor - a.skor)
    .slice(0, limit)
    .map((x) => x.h);

  const hasil = ambil_detail
    ? await Promise.all(cocok.map((h) => hadisBerderajat({ id: h.id }).catch(() => ({ id: h.id, judul: h.judul, galat: true }))))
    : cocok;

  return {
    sumber: "hadeethenc.com (Ensiklopedia Hadis Nabawi)",
    kueri: query,
    kategori_id: String(kategori_id),
    total_terindeks: indeks.hadis.length,
    jumlah_ditampilkan: hasil.length,
    catatan:
      "Pencarian dilakukan pada judul hadis, bukan seluruh matan, sehingga hadis relevan bisa saja terlewat. " +
      "Penomoran sumber ini berbeda dari penomoran kitab pada ambil_hadis — jangan disilangkan.",
    hasil,
  };
}

/** Ambil satu hadis lengkap: teks Arab, terjemahan, derajat, takhrij, syarah. */
export async function hadisBerderajat({ id }) {
  const j = await getJson(`${HE}/hadeeths/one/?language=id&id=${encodeURIComponent(id)}`);
  if (!j?.id) throw new Error(`Hadis id ${id} tidak ditemukan pada hadeethenc.`);
  return {
    sumber: "hadeethenc.com (Ensiklopedia Hadis Nabawi)",
    id: j.id,
    judul: j.title,
    arab: j.hadeeth_ar || null,
    terjemah: j.hadeeth || null,
    derajat: j.grade || null,
    derajat_arab: j.grade_ar || null,
    takhrij: j.attribution || null,
    syarah: j.explanation || null,
    faedah: j.hints || [],
    catatan:
      "Derajat dan takhrij berasal dari sumber ini. Untuk dokumen formal, cocokkan dengan kitab syarah atau dengan " +
      "bagian Mengingat pada fatwa DSN-MUI yang memakai hadis tersebut.",
  };
}
