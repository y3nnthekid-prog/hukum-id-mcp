// Kitab turats: verifikasi redaksi kaidah fikih dan istilah fikih klasik.
//
// Skill qawaid-fiqhiyyah menuntut redaksi kaidah dicocokkan ke sumber cetak
// sebelum dikutip dalam dokumen formal. Modul ini menyediakan jalannya lewat
// api.turath.io, yang mengembalikan teks Arab beserta nama kitab, penulis,
// jilid, dan halaman.
//
// Batas yang sengaja dipasang: kutipan dipotong pendek. Tujuan modul ini adalah
// MEMVERIFIKASI redaksi, bukan menyajikan ulang isi kitab. Sebagian karya di
// pangkalan ini adalah tulisan ulama kontemporer yang kemungkinan masih
// berhak cipta, jadi untuk bacaan panjang rujuk edisi terbitannya.

import { getJson } from "./http.js";

const API = "https://api.turath.io";
const BATAS_CUPLIKAN = 600;

function bersihkan(teks = "") {
  return String(teks)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uraikanMeta(meta) {
  if (!meta) return {};
  try {
    return typeof meta === "string" ? JSON.parse(meta) : meta;
  } catch {
    return {};
  }
}

/**
 * Cari frasa Arab di kitab-kitab turats. Dipakai terutama untuk memastikan
 * redaksi sebuah kaidah fikih sebelum dikutip.
 */
export async function cariTurats({ query, limit = 5 }) {
  const data = await getJson(`${API}/search?q=${encodeURIComponent(query)}`, { timeout: 45000 });

  const hasil = (data?.data || []).slice(0, Math.min(limit, 15)).map((x) => {
    const m = uraikanMeta(x.meta);
    const cuplikan = bersihkan(x.snip || x.text);
    return {
      kitab: m.book_name || null,
      penulis: m.author_name || null,
      jilid: m.vol || null,
      halaman: m.page ?? null,
      bagian: Array.isArray(m.headings) ? m.headings.slice(0, 2) : [],
      cuplikan: cuplikan.length > BATAS_CUPLIKAN ? cuplikan.slice(0, BATAS_CUPLIKAN) + " …" : cuplikan,
      book_id: x.book_id,
    };
  });

  return {
    sumber: "api.turath.io",
    kueri: query,
    total_temuan: data?.count ?? null,
    jumlah_ditampilkan: hasil.length,
    hasil,
    catatan:
      "Kutipan sengaja dipotong pendek karena tujuannya memverifikasi redaksi, bukan menyajikan ulang isi kitab. " +
      "Pangkalan ini memuat karya klasik maupun kontemporer; untuk karya kontemporer yang kemungkinan masih " +
      "berhak cipta, rujuk edisi terbitannya untuk bacaan panjang.",
    peringatan: [
      "Kemunculan sebuah redaksi di satu kitab tidak dengan sendirinya menjadikannya kaidah yang disepakati. " +
        "Periksa siapa penulisnya, kedudukan kitabnya, dan apakah fatwa DSN-MUI yang relevan memakai redaksi yang sama.",
      "Kitab turats bukan sumber hukum positif Indonesia. Ia menjelaskan dasar fikih sebuah ketentuan, " +
        "bukan menggantikan peraturan perundang-undangan maupun fatwa DSN-MUI.",
    ],
  };
}

/** Ambil biografi ringkas penulis, untuk menilai kedudukan sebuah rujukan. */
export async function penulisTurats({ id }) {
  const j = await getJson(`${API}/author?id=${encodeURIComponent(id)}`, { timeout: 30000 });
  if (!j?.id) throw new Error(`Penulis dengan id ${id} tidak ditemukan.`);
  const bio = bersihkan(j.biography);
  return {
    sumber: "api.turath.io",
    id: j.id,
    nama: j.name || null,
    biografi: bio.length > 1200 ? bio.slice(0, 1200) + " …" : bio,
  };
}
