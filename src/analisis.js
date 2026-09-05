// Dua alur analisis: keberlakuan menurut waktu, dan daftar periksa kepatuhan akad.

import { cariPeraturan, detailPeraturan } from "./bpk.js";
import { cariFatwaDsn, teksFatwaDsn } from "./dsn.js";
import { parseLegalDate, selectExactCandidate } from "./trust.js";

/** Terima "17 Oktober 2022", "2026-01-02", atau "02/01/2026". */
export function uraikanTanggal(teks) {
  return parseLegalDate(teks);
}

function tglTeks(d) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function daftarRelasi(relasi, label) {
  const v = relasi?.[label];
  if (!v) return [];
  return Array.isArray(v) ? v : v.ditampilkan || [];
}

/**
 * Apakah sebuah peraturan berlaku pada tanggal tertentu.
 * Penting untuk perkara yang tunduk pada hukum lama — misalnya perbuatan
 * pidana sebelum KUHP baru berlaku pada 2 Januari 2026.
 */
export async function hukumPadaTanggal({ peraturan, tanggal }) {
  const acuan = uraikanTanggal(tanggal);
  if (!acuan) throw new Error("Tanggal tidak dikenali. Pakai format '17 Oktober 2022' atau '2022-10-17'.");

  const m = String(peraturan).match(
    /^\s*([A-Za-z][A-Za-z .-]*?)?\s*(?:no\.?|nomor)?\s*(\d+)\s*[/ ]\s*(?:tahun\s*)?(\d{4})\s*$/i
  );
  const cari = await cariPeraturan({
    keywords: m ? (m[1] || "").trim() || peraturan : peraturan,
    nomor: m ? m[2] : "",
    tahun: m ? m[3] : "",
    limit: 8,
  });
  const selection = selectExactCandidate(cari.hasil, { nomor: m?.[2] || "", tahun: m?.[3] || "", jenis: (m?.[1] || "").trim() });
  if (selection.status !== "matched") {
    return {
      ditemukan: false,
      status: selection.status,
      reason: selection.reason,
      attempted: selection.attempted,
      catatan:
        selection.status === "ambiguous"
          ? "Rujukan ambigu. Persempit dengan jenis, nomor, dan tahun; sistem tidak memilih kandidat pertama."
          : "Peraturan dengan identitas persis tidak ditemukan.",
      kandidat: selection.candidates,
      pencarian: cari,
    };
  }
  const pilih = selection.value;

  const d = await detailPeraturan(pilih.id);
  const berlaku = uraikanTanggal(d.metadata["Tanggal Berlaku"]);
  const undang = uraikanTanggal(d.metadata["Tanggal Pengundangan"]);
  const tetap = uraikanTanggal(d.metadata["Tanggal Penetapan"]);
  const mulai = berlaku || undang || tetap;

  const dicabutOleh = daftarRelasi(d.relasi_status, "Dicabut dengan");
  const sudahDicabut = /tidak berlaku|dicabut/i.test(d.status || "");

  let simpulan;
  const alasan = [];

  if (!mulai) {
    simpulan = "tidak_dapat_dipastikan";
    alasan.push("Tanggal mulai berlaku tidak tercantum pada metadata JDIH BPK.");
  } else if (acuan < mulai) {
    simpulan = "belum_berlaku";
    alasan.push(`Pada ${tglTeks(acuan)} peraturan ini belum berlaku; mulai berlaku ${tglTeks(mulai)}.`);
  } else if (sudahDicabut) {
    simpulan = "perlu_periksa_tanggal_pencabutan";
    alasan.push(
      `Peraturan berstatus "${d.status}". Sudah berlaku pada ${tglTeks(acuan)}, tetapi kemudian dicabut. ` +
        "Tanggal pencabutan menentukan apakah ia masih berlaku pada tanggal acuan."
    );
  } else {
    simpulan = "berlaku";
    alasan.push(`Berlaku sejak ${tglTeks(mulai)}, dan sampai kini berstatus "${d.status}".`);
  }

  // Bila dicabut, tanggal berlakunya pencabut menentukan batas akhir.
  const pencabut = [];
  for (const p of dicabutOleh.slice(0, 3)) {
    try {
      const dp = await detailPeraturan(p.id);
      const mulaiCabut =
        uraikanTanggal(dp.metadata["Tanggal Berlaku"]) || uraikanTanggal(dp.metadata["Tanggal Pengundangan"]);
      pencabut.push({
        peraturan: p.peraturan,
        tentang: p.tentang,
        mulai_berlaku: tglTeks(mulaiCabut),
        url: p.url,
      });
      if (mulaiCabut && simpulan === "perlu_periksa_tanggal_pencabutan") {
        if (acuan < mulaiCabut) {
          simpulan = "berlaku_pada_tanggal_itu";
          alasan.push(
            `Pencabutnya (${p.peraturan}) baru berlaku ${tglTeks(mulaiCabut)}, sesudah tanggal acuan. ` +
              "Jadi pada tanggal acuan peraturan ini masih berlaku."
          );
        } else {
          simpulan = "sudah_dicabut_pada_tanggal_itu";
          alasan.push(`Pencabutnya (${p.peraturan}) berlaku ${tglTeks(mulaiCabut)}, sebelum atau pada tanggal acuan.`);
        }
      }
    } catch {
      pencabut.push({ peraturan: p.peraturan, url: p.url, catatan: "detail pencabut gagal diambil" });
    }
  }

  return {
    sumber: "JDIH BPK RI",
    tanggal_acuan: tglTeks(acuan),
    peraturan: {
      judul: d.judul,
      jenis: pilih.jenis,
      nomor: pilih.nomor,
      tahun: pilih.tahun,
      status_kini: d.status,
      url: d.url,
    },
    garis_waktu: {
      penetapan: tglTeks(tetap),
      pengundangan: tglTeks(undang),
      mulai_berlaku: tglTeks(berlaku),
    },
    dicabut_dengan: pencabut,
    simpulan,
    alasan,
    peringatan: [
      "Simpulan ini bertumpu pada tanggal yang tercatat di JDIH BPK. Untuk perkara nyata, cocokkan dengan " +
        "Lembaran Negara, dan perhatikan ketentuan peralihan yang bisa mengatur keberlakuan secara khusus.",
      "Pasal tertentu di dalam satu undang-undang dapat punya saat berlaku sendiri. Periksa ketentuan penutupnya.",
    ],
  };
}

const DERAU_BUTIR = /(dewan\s*sy|majelis\s*ulama|jl\.|telp|fax|www\.|dsnmui|halaman\s*\d)/i;

function bersihButir(t) {
  return String(t).replace(/\s+/g, " ").replace(/\s([.,;:])/g, "$1").trim();
}

/** Teks berkop sering keluar sebagai huruf terpisah spasi ("D ew an Sy ar i ah"). */
function terlaluTerpisah(t) {
  const kata = t.split(/\s+/).filter(Boolean);
  if (kata.length < 8) return false;
  const pendek = kata.filter((k) => k.length <= 2).length;
  return pendek / kata.length > 0.45;
}

/**
 * Susun daftar periksa kepatuhan akad dari ketentuan fatwa DSN-MUI.
 *
 * Yang dikerjakan alat: menarik fatwa yang relevan dan mengekstrak butir
 * ketentuan menjadi daftar periksa. Yang TIDAK dikerjakan alat: memutuskan
 * sendiri butir mana yang terpenuhi. Penilaian itu menuntut pembacaan akad dan
 * merupakan pekerjaan penganalisis, bukan pencocokan kata.
 */
export async function daftarPeriksaAkad({ akad, nomor_fatwa = "", maks_karakter = 8000 }) {
  const cari = nomor_fatwa
    ? await cariFatwaDsn({ nomor: nomor_fatwa, limit: 5 })
    : await cariFatwaDsn({ query: akad, limit: 6 });

  const utama = cari.hasil?.[0];
  if (!utama) {
    return {
      akad,
      ditemukan: false,
      catatan: "Tidak ada fatwa DSN-MUI yang cocok. Coba istilah akad yang lain, atau sebutkan nomor fatwanya.",
      pencarian: cari,
    };
  }

  // Ketentuan operatif dimulai setelah kata MEMUTUSKAN; sebelum itu hanya
  // konsiderans dan dalil, yang tidak boleh masuk daftar periksa.
  let ketentuan = null;
  let halamanMulai = null;
  try {
    const jejak = await teksFatwaDsn({ rujukan: utama.nomor, cari: "MEMUTUSKAN", maks_karakter: 1500 });
    halamanMulai = jejak.halaman_dikembalikan?.[0] || null;
    ketentuan = await teksFatwaDsn({
      rujukan: utama.nomor,
      halaman_awal: halamanMulai || 1,
      halaman_akhir: 0,
      maks_karakter,
    });
  } catch (e) {
    ketentuan = { galat: e.message };
  }

  const butir = [];
  const bagian = [];
  if (ketentuan?.isi?.length) {
    const teks = ketentuan.isi.map((x) => x.teks).join("\n");

    for (const m of teks.matchAll(/Ketentuan\s+[A-Z][A-Za-z ]{2,40}/g)) {
      const j = bersihButir(m[0]);
      if (!bagian.includes(j)) bagian.push(j);
    }

    // Penomoran fatwa kadang cacat hasil pemindaian: "7 -" untuk "7.".
    for (const m of teks.matchAll(/(?:^|\n|\s)(\d{1,2})\s*[.-]\s+([\s\S]{25,420}?)(?=\s\d{1,2}\s*[.-]\s|\n\n|$)/g)) {
      const bunyi = bersihButir(m[2]);
      if (DERAU_BUTIR.test(bunyi) || terlaluTerpisah(bunyi)) continue;
      if (butir.some((b) => b.bunyi.slice(0, 60) === bunyi.slice(0, 60))) continue;
      butir.push({ nomor: m[1], bunyi: bunyi.slice(0, 420), penilaian: "belum_dinilai" });
      if (butir.length >= 30) break;
    }
  }

  return {
    akad,
    fatwa_utama: { nomor: utama.nomor, judul: utama.judul, url_pdf: utama.url_pdf },
    fatwa_terkait: (cari.hasil || []).slice(1, 5).map((f) => ({ nomor: f.nomor, judul: f.judul })),
    halaman_mulai_memutuskan: halamanMulai,
    bagian_ketentuan: bagian,
    daftar_periksa: butir,
    jumlah_butir: butir.length,
    cara_memakai: [
      "Nilai tiap butir menjadi terpenuhi, tidak terpenuhi, atau tidak dapat dinilai, dengan menunjuk klausul akad " +
        "yang menjadi dasarnya. Jangan menilai dari nama akad, tetapi dari substansi arus dana, risiko, dan kepemilikan.",
      "Periksa juga apakah fatwa ini sudah dipositifkan lewat POJK, PBI, atau KHES; daya ikat hukum positifnya " +
        "bergantung pada itu. Cari POJK dengan cari_peraturan jenis 80.",
      "Lihat cari_produk_dsn untuk pedoman implementasi fatwa ini, bila ada.",
    ],
    peringatan: [
      "Daftar periksa ini disusun otomatis dari teks fatwa dan bisa saja tidak lengkap atau terpotong. " +
        "Baca salinan fatwanya sendiri sebelum dipakai menilai kepatuhan.",
      "Keluaran ini adalah analisis kepatuhan, BUKAN fatwa dan BUKAN persetujuan Dewan Pengawas Syariah.",
      ...(ketentuan?.galat ? ["Teks fatwa gagal diambil: " + String(ketentuan.galat).slice(0, 90)] : []),
    ],
  };
}
