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
      page_id: m.page_id ?? null,
      author_id: x.author_id ?? null,
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

/** Kontrak respons primer /book dan /page; pg memakai page_id, bukan halaman cetak. */
export function uraikanHalamanTurats(book, page, { bookId, pageId }) {
  const meta = uraikanMeta(page?.meta);
  if (Number(book?.meta?.id) !== bookId || !Number.isSafeInteger(meta.page_id) || meta.page_id !== pageId ||
      !book?.meta?.name || meta.book_name !== book.meta.name || !bersihkan(page?.text)) {
    throw new Error("Identitas kitab atau halaman turats tidak cocok; hasil tidak dipakai.");
  }
  const text = bersihkan(page.text);
  const truncated = text.length > 6000;
  return {
    sumber: "api.turath.io",
    hasil: [{ book_id: bookId, page_id: pageId, author_id: book.meta.author_id ?? null,
      kitab: meta.book_name, penulis: meta.author_name || null, jilid: meta.vol ?? null,
      halaman: meta.page ?? null, edisi: bersihkan(book.meta.info), versi: String(book.meta.version ?? ""),
      cuplikan: truncated ? text.slice(0, 6000) : text, terpotong: truncated }],
    peringatan: ["Halaman berasal dari transkripsi digital Turath; cocokkan dengan edisi cetak. Identitas penulis bukan bukti madzhab pendapat yang sedang dikutip.",
      ...(truncated ? ["Teks halaman dibatasi 6.000 karakter; halaman belum terbaca lengkap."] : [])],
  };
}

export async function bukaHalamanTurats({ bookId, pageId }) {
  if (!Number.isSafeInteger(bookId) || bookId < 1 || bookId > 10000000 || !Number.isSafeInteger(pageId) || pageId < 0 || pageId > 1000000) throw new Error("Rujukan halaman turats tidak sah.");
  const book = await getJson(`${API}/book?id=${bookId}&ver=3`, { timeout: 30000 });
  const page = await getJson(`${API}/page?book_id=${bookId}&pg=${pageId}&ver=3`, { timeout: 30000 });
  return uraikanHalamanTurats(book, page, { bookId, pageId });
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
