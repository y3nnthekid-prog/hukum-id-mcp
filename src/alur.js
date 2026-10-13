// Alur kerja gabungan. Satu panggilan menggantikan rantai tiga sampai lima
// panggilan, dan bagian yang tidak saling bergantung dijalankan paralel.
// Tujuannya bukan sekadar cepat: keluarannya sudah lengkap untuk dikutip,
// dan membawa peringatan atas jebakan yang sudah terbukti nyata.

import { cariPeraturan, detailPeraturan, teksPeraturan } from "./bpk.js";
import { cariDalamPdf } from "./pdf.js";
import { cariPutusanMK } from "./mk.js";
import { cariFatwaDsn, teksFatwaDsn } from "./dsn.js";
import { telusuriPutusan } from "./ma.js";
import { cariPerma } from "./perma.js";
import { selectExactCandidate } from "./trust.js";

/** "UU 27/2022", "UU No. 27 Tahun 2022", "27/2022" menjadi {keywords, nomor, tahun}. */
function uraikanRujukan(teks = "") {
  const m = String(teks).match(
    /^\s*([A-Za-z][A-Za-z .-]*?)?\s*(?:no\.?|nomor)?\s*(\d+)\s*[/ ]\s*(?:tahun\s*)?(\d{4})\s*$/i
  );
  if (!m) return { keywords: teks };
  return { keywords: (m[1] || "").trim(), nomor: m[2], tahun: m[3] };
}

const LEWAT_JDIH_MA = /^(perma|sema|kma)\b/i;

// Pencarian JDIH BPK mencocokkan kata kunci dengan judul, bukan dengan bentuk
// singkat jenisnya. "Permenkominfo 5/2020" mengembalikan nol hasil, padahal
// peraturannya ada. Singkatan diterjemahkan ke nama kementerian untuk mencari;
// singkatannya tetap dipakai sebagai jenis untuk memilih kandidat yang persis.
const KATA_KUNCI_JENIS = {
  PERMENKOMINFO: "Komunikasi dan Informatika",
  PERMENKOMDIGI: "Komunikasi dan Digital",
  PERMENAKER: "Ketenagakerjaan",
  PERMENKUMHAM: "Hukum dan Hak Asasi Manusia",
  PERMENDAGRI: "Dalam Negeri",
  PERMENDIKBUD: "Pendidikan dan Kebudayaan",
  PERMENKES: "Kesehatan",
  PERMENAG: "Agama",
  PERMENDAG: "Perdagangan",
  PERMENPERIN: "Perindustrian",
  PERMENHUB: "Perhubungan",
  PERMENSOS: "Sosial",
  PERMENKOPUKM: "Koperasi dan Usaha Kecil dan Menengah",
};

export function kataKunciUntukJenis(singkatan = "") {
  return KATA_KUNCI_JENIS[String(singkatan).replace(/[\s.]/g, "").toUpperCase()] || null;
}

function articleLookupResult(teks, pasal, hasPdf) {
  const pages = teks?.halaman_dikembalikan ?? [];
  const excerpts = teks?.isi ?? [];
  const found = pages.length > 0 && excerpts.length > 0;
  return {
    ditemukan: found,
    dicari: pasal,
    total_halaman: teks?.total_halaman ?? null,
    halaman: pages,
    kutipan: excerpts,
    extraction_health: teks?.extraction_health ?? null,
    attempted: [
      `frasa persis=${pasal}`,
      hasPdf ? `halaman PDF diperiksa=${teks?.total_halaman ?? 0}` : "PDF peraturan tidak tersedia",
      `halaman cocok=${pages.length}`,
    ],
  };
}

/**
 * Satu panggilan untuk menjawab "apa bunyi pasal X, dan apakah masih berlaku".
 * Menggabungkan pencarian, status, relasi antarperaturan, kutipan verbatim dari
 * PDF resmi, dan silang-periksa putusan MK.
 */
export async function periksaPasal({
  peraturan,
  pasal = "",
  nomor = "",
  tahun = "",
  jenis = "",
  sertakan_putusan_mk = true,
  maks_karakter = 4000,
}) {
  const r = uraikanRujukan(peraturan);
  const kueri = {
    keywords: kataKunciUntukJenis(r.keywords) || r.keywords || peraturan,
    nomor: nomor || r.nomor || "",
    tahun: tahun || r.tahun || "",
    jenis,
    limit: 8,
  };

  if (LEWAT_JDIH_MA.test(String(peraturan))) {
    const p = await cariPerma({ query: peraturan, limit: 5 });
    const identitas = p.hasil.map((item) => {
      const match = item.judul?.match(/\b(?:nomor|no\.)\s*0*(\d+)\s+tahun\s+(\d{4})\b/i);
      return { ...item, nomor: match?.[1] || "", tahun: match?.[2] || "" };
    });
    const selection = selectExactCandidate(identitas, { nomor: r.nomor || "", tahun: r.tahun || "" });
    if (selection.status !== "matched") {
      return {
        ditemukan: false,
        status: selection.status,
        reason: selection.reason,
        attempted: selection.attempted,
        catatan:
          selection.status === "ambiguous"
            ? "Produk hukum MA ambigu. Sistem tidak memilih kandidat pertama; berikan nomor dan tahun yang persis."
            : "Produk hukum MA dengan identitas persis tidak ditemukan di JDIH MA.",
        kandidat: selection.candidates,
        pencarian: p,
      };
    }
    const pilih = selection.value;
    const teks =
      pasal && pilih.url_pdf
        ? await teksPeraturan({ url_pdf: pilih.url_pdf, cari: pasal, maks_karakter })
        : null;
    const hasilPasal = pasal ? articleLookupResult(teks, pasal, Boolean(pilih.url_pdf)) : null;
    return {
      ...(hasilPasal && !hasilPasal.ditemukan ? { status: "insufficient_evidence" } : {}),
      sumber: "JDIH Mahkamah Agung RI",
      peraturan: pilih,
      pasal: hasilPasal,
      peringatan: [
        "Produk hukum MA tidak terindeks di JDIH BPK, sehingga status dan relasi antarperaturannya tidak tersedia seperti pada peraturan pusat.",
      ],
    };
  }

  const cari = await cariPeraturan(kueri);
  const selection = selectExactCandidate(cari.hasil, { nomor: kueri.nomor, tahun: kueri.tahun, jenis: jenis || r.keywords });
  if (selection.status !== "matched") {
    return {
      ditemukan: false,
      status: selection.status,
      reason: selection.reason,
      attempted: selection.attempted,
      catatan:
        selection.status === "ambiguous"
          ? "Rujukan peraturan ambigu. Sistem tidak memilih kandidat pertama; berikan jenis, nomor, dan tahun."
          : "Peraturan dengan identitas persis tidak ditemukan.",
      kandidat: selection.candidates,
      pencarian: cari,
    };
  }
  const pilih = selection.value;

  const detail = await detailPeraturan(pilih.id);
  const pdf = detail.berkas.find((f) => f.kategori === "Peraturan");

  const [teks, mk] = await Promise.all([
    pasal && pdf ? teksPeraturan({ url_pdf: pdf.url, cari: pasal, maks_karakter }) : Promise.resolve(null),
    sertakan_putusan_mk
      ? cariPutusanMK({
          query: (detail.metadata["Judul"] || pilih.judul || "").slice(0, 60),
          jenis: "PUU",
          limit: 6,
          // Silang-periksa bersifat tambahan: diberi anggaran waktu ketat agar
          // situs MK yang sedang lambat tidak menahan seluruh jawaban.
          opsi_jaringan: { retries: 0, timeout: 8000 },
        }).catch((e) => ({ galat: e.message }))
      : Promise.resolve(null),
  ]);

  const peringatan = [];
  if (/tidak berlaku|dicabut/i.test(detail.status || "")) {
    peringatan.push(
      `STATUS: ${detail.status}. Jangan dipakai sebagai hukum yang berlaku tanpa menyatakan hal ini.`
    );
  }
  if (detail.relasi_status["Diubah dengan"]) {
    peringatan.push(
      "Peraturan ini pernah diubah. Teks yang berlaku adalah teks asli sebagaimana diubah; sebut rantainya memakai juncto."
    );
  }
  if (!detail.uji_materi?.length) {
    peringatan.push(
      "Daftar uji materi di JDIH BPK tidak lengkap. Hasil putusan_mk_terkait di bawah adalah silang-periksanya, bukan daftar resmi."
    );
  }
  if (mk?.galat) {
    peringatan.push(
      "Silang-periksa ke situs MK tidak berhasil dijalankan, jadi daftar putusan_mk_terkait kosong bukan karena " +
        "tidak ada perkara. Ulangi nanti atau panggil cari_putusan_mk tersendiri. Sebab: " +
        String(mk.galat).slice(0, 90)
    );
  }
  if (pasal && teks && !teks.halaman_dikembalikan?.length) {
    peringatan.push(`Kata kunci "${pasal}" tidak ditemukan dalam PDF. Periksa penulisannya atau telusuri manual.`);
  }
  if (pasal && !pdf) {
    peringatan.push(`PDF peraturan tidak tersedia, sehingga "${pasal}" tidak dapat diperiksa dan sistem abstain.`);
  }

  const hasilPasal = pasal ? articleLookupResult(teks, pasal, Boolean(pdf)) : null;

  return {
    ...(hasilPasal && !hasilPasal.ditemukan ? { status: "insufficient_evidence" } : {}),
    sumber: "JDIH BPK RI",
    peraturan: {
      id: pilih.id,
      judul: detail.judul,
      jenis: pilih.jenis,
      nomor: pilih.nomor,
      tahun: pilih.tahun,
      status: detail.status,
      tanggal_penetapan: detail.metadata["Tanggal Penetapan"] || null,
      tanggal_pengundangan: detail.metadata["Tanggal Pengundangan"] || null,
      tanggal_berlaku: detail.metadata["Tanggal Berlaku"] || null,
      sumber_lembaran: detail.metadata["Sumber"] || null,
      url: detail.url,
      url_pdf: pdf?.url || null,
    },
    relasi_status: detail.relasi_status,
    uji_materi_menurut_bpk: detail.uji_materi,
    pasal: hasilPasal,
    putusan_mk_terkait: mk?.hasil ?? null,
    abstrak: detail.abstrak,
    catatan: detail.catatan,
    peringatan,
  };
}

/**
 * Sisir sekumpulan putusan MK sekaligus: untuk tiap nomor perkara, ambil
 * metadata dan hitung kemunculan kata kunci di seluruh salinan putusannya.
 * Menjawab "apakah pasal X pernah diuji" tanpa membuka satu per satu.
 */
export async function sisirPutusanMK({ nomor_perkara = [], kata_kunci = [], kueri = "", limit_kueri = 20 }) {
  const daftar = [...nomor_perkara];

  if (kueri) {
    const r = await cariPutusanMK({ query: kueri, jenis: "PUU", limit: limit_kueri });
    for (const h of r.hasil) if (!daftar.includes(h.nomor_perkara)) daftar.push(h.nomor_perkara);
  }

  const hasil = await Promise.all(
    daftar.slice(0, 25).map(async (no) => {
      try {
        const r = await cariPutusanMK({ query: no, limit: 30 });
        const h = r.hasil.find((x) => x.nomor_perkara === no);
        if (!h) return { nomor_perkara: no, catatan: "tidak ada hasil yang nomornya persis sama" };

        const url = (h.berkas_pendukung || h.berkas_putusan || "").split(" ").join("%20");
        const dasar = {
          nomor_perkara: h.nomor_perkara,
          status: h.status,
          tanggal: h.tanggal,
          pokok_perkara: h.pokok_perkara,
          amar_putusan: h.amar_putusan,
          berkas: url || null,
        };
        if (!url || !kata_kunci.length) return dasar;

        const temuan = {};
        for (const kk of kata_kunci) {
          const c = await cariDalamPdf({ url_pdf: url, kata_kunci: kk, maks_temuan: 3, konteks: 200 });
          temuan[kk] = { jumlah: c.jumlah_temuan, contoh: c.temuan.slice(0, 2) };
          dasar.total_halaman = c.total_halaman;
        }
        return { ...dasar, kata_kunci: temuan };
      } catch (e) {
        return { nomor_perkara: no, catatan: "gagal: " + String(e.message).slice(0, 80) };
      }
    })
  );

  return {
    sumber: "Mahkamah Konstitusi RI",
    jumlah_perkara: hasil.length,
    kata_kunci_dicari: kata_kunci,
    catatan:
      "Angka nol pada sebuah kata kunci berarti frasa itu tidak muncul dalam salinan putusan, bukan bahwa isunya " +
      "tidak dibahas dengan rumusan lain. Baca cuplikannya sebelum menyimpulkan.",
    hasil,
  };
}

/**
 * Pilih fatwa yang mengatur akad itu sendiri, bukan sekadar fatwa terbaru yang
 * menyebutnya. Untuk "murabahah", hasil teratas dulu adalah 153/DSN-MUI/VI/2022
 * tentang pelunasan dipercepat, padahal yang mengatur akadnya adalah fatwa
 * berjudul "Akad Jual Beli Murabahah". Urutan asli dipertahankan bila skornya sama.
 */
export function pilihFatwaUtama(hasil = [], akad = "") {
  if (!Array.isArray(hasil) || !hasil.length) return undefined;
  const bersih = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const nama = bersih(akad);
  if (!nama) return hasil[0];
  const inti = new Set([nama, `akad ${nama}`, `akad jual beli ${nama}`, `pembiayaan ${nama}`, `akad ${nama} di lembaga keuangan syariah`]);
  const skor = (f) => {
    const judul = bersih(f?.judul);
    if (inti.has(judul)) return 3;
    if (new RegExp(`\\b${nama}\\b`).test(judul) && judul.split(" ").length <= 5) return 2;
    return 1;
  };
  return hasil.reduce((terbaik, f) => (skor(f) > skor(terbaik) ? f : terbaik), hasil[0]);
}

/**
 * Titik masuk analisis dua perspektif untuk satu akad syariah: fatwa DSN-MUI,
 * peraturan positif terkait, dan praktik peradilan agama, dalam satu panggilan.
 */
export async function risetAkadSyariah({ akad, sertakan_teks_fatwa = true, maks_karakter = 3500 }) {
  const [fatwa, peraturan, putusan] = await Promise.all([
    cariFatwaDsn({ query: akad, limit: 8 }).catch((e) => ({ galat: e.message })),
    cariPeraturan({ keywords: akad + " syariah", limit: 6 }).catch((e) => ({ galat: e.message })),
    telusuriPutusan({ kategori: "ekonomi-syari-ah-1", limit: 5 }).catch((e) => ({ galat: e.message })),
  ]);

  let ketentuan = null;
  const utama = pilihFatwaUtama(fatwa?.hasil, akad);
  if (sertakan_teks_fatwa && utama?.nomor) {
    ketentuan = await teksFatwaDsn({ rujukan: utama.nomor, cari: "Menetapkan", maks_karakter }).catch((e) => ({
      galat: e.message,
    }));
  }

  return {
    akad,
    fatwa_dsn: fatwa,
    fatwa_utama: utama || null,
    ketentuan_fatwa_utama: ketentuan,
    peraturan_positif_terkait: peraturan,
    contoh_putusan_ekonomi_syariah: putusan,
    peringatan: [
      "Fatwa DSN-MUI bukan peraturan perundang-undangan. Daya ikat hukumnya lahir setelah dipositifkan lewat POJK, PBI, atau KHES; periksa instrumen itu sebelum menyimpulkan.",
      "Teks Arab pada PDF fatwa keluar rusak karena font non-Unicode. Ambil dalil Arab lewat ambil_ayat atau ambil_hadis.",
      "Daftar putusan di atas adalah yang terbaru pada kategori ekonomi syariah, bukan hasil pencarian kata kunci; pencarian teks-bebas di Direktori Putusan MA terkunci CAPTCHA.",
    ],
  };
}
