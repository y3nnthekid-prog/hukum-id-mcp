// Verifikasi sitasi dalam sebuah draf tulisan.
//
// Menjadikan alat ini bukan sekadar pencari, melainkan pemeriksa: diberi teks
// berisi rujukan hukum, ia memeriksa satu per satu apakah peraturannya ada,
// apakah statusnya masih berlaku, apakah pasalnya benar ada, dan apakah nomor
// perkara atau nomor fatwanya persis. Berguna juga untuk memeriksa tulisan yang
// dihasilkan model lain.
//
// Prinsip keluaran: yang tidak bisa diperiksa dinyatakan "tidak diperiksa",
// bukan diam-diam dianggap benar.

import { cariPeraturan, detailPeraturan } from "./bpk.js";
import { cariDalamPdf } from "./pdf.js";
import { cariPutusanMK } from "./mk.js";
import { indeksFatwa } from "./dsn.js";
import { selectExactCandidate } from "./trust.js";

const POLA = {
  peraturan:
    /\b(UU|Undang-Undang|Perppu|PP|Perpres|Peraturan Presiden|Inpres|Keppres|POJK|PBI|PERMA|SEMA)\s*(?:No\.?|Nomor)?\s*(\d+)\s*(?:\/|\s+Tahun\s+)\s*(\d{4})\b/gi,
  putusan_mk: /\b(\d+)\/(PUU|SKLN|PHPU|PHPKADA)-([IVXLCDM]+)\/(\d{4})\b/g,
  putusan_ma: /\b(\d+)\s*(K|PK)\/([A-Z][A-Z.]{2,})\/(\d{4})\b/g,
  fatwa_dsn: /\b(\d+)\/DSN-MUI\/([IVXLCDM]+)\/(\d{4})\b/g,
};

const KLAIM_BERLAKU = /(masih\s+berlaku|tetap\s+berlaku|yang\s+berlaku|sedang\s+berlaku)/i;
const KLAIM_DICABUT = /(telah\s+dicabut|sudah\s+dicabut|tidak\s+berlaku|dicabut\s+oleh)/i;

function jendela(teks, indeks, lebar = 220) {
  return teks.slice(Math.max(0, indeks - lebar), indeks + lebar);
}

/**
 * Lekatkan tiap "Pasal N" pada rujukan peraturan TERDEKAT, maju maupun mundur.
 *
 * Sitasi hukum Indonesia lazim menulis pasal lebih dulu — "Pasal 49 huruf i
 * UU 3/2006" — sehingga penelusuran satu arah melewatkannya diam-diam. Dan
 * diam-diam itulah bahayanya: tool melaporkan terverifikasi padahal pasalnya
 * tidak pernah diperiksa sama sekali.
 */
function petakanPasal(teks, posisiRujukan, jangkauan = 160) {
  const peta = new Map();
  for (const m of teks.matchAll(/\bPasal\s+(\d{1,4})/gi)) {
    let terdekat = null;
    let jarak = Infinity;
    for (const p of posisiRujukan) {
      const d = Math.min(Math.abs(m.index - p.mulai), Math.abs(m.index - (p.mulai + p.panjang)));
      if (d < jarak) {
        jarak = d;
        terdekat = p;
      }
    }
    if (terdekat && jarak <= jangkauan && !peta.has(terdekat.mulai)) {
      peta.set(terdekat.mulai, `Pasal ${m[1]}`);
    }
  }
  return peta;
}

/** Frasa berangka atau kutipan yang khas — bagus untuk menguji isi klaim. */
function frasaUji(teks, indeks) {
  const w = jendela(teks, indeks, 260);
  const kutipan = w.match(/["“”']([^"“”']{8,80})["“”']/);
  if (kutipan) return kutipan[1];
  const angka = w.match(/\b\d+\s*(?:x|kali)\s*\d+\s*\w+/i);
  return angka ? angka[0] : null;
}

async function periksaPeraturan(teks, m, pasalTerkait) {
  const [penuh, jenisTeks, nomor, tahun] = m;
  const konteks = jendela(teks, m.index);
  const hasil = {
    jenis: "peraturan",
    tertulis: penuh,
    posisi: m.index,
    status_verifikasi: "tidak_diperiksa",
    catatan: [],
  };

  try {
    const cari = await cariPeraturan({ keywords: jenisTeks, nomor, tahun, limit: 6 });
    const selection = selectExactCandidate(cari.hasil, { nomor, tahun });
    if (selection.status !== "matched") {
      hasil.status_verifikasi = "tidak_ditemukan";
      hasil.catatan.push(
        selection.status === "ambiguous"
          ? "Lebih dari satu peraturan cocok persis; jenis/otoritas harus diperjelas dan sistem tidak memilih salah satunya."
          : "Peraturan dengan nomor dan tahun itu tidak ditemukan persis di JDIH BPK."
      );
      hasil.kandidat = selection.candidates;
      return hasil;
    }
    const pilih = selection.value;

    const d = await detailPeraturan(pilih.id);
    hasil.judul_resmi = d.judul;
    hasil.status_peraturan = d.status;
    hasil.url = d.url;

    const dicabut = /tidak berlaku|dicabut/i.test(d.status || "");
    const diklaimBerlaku = KLAIM_BERLAKU.test(konteks);
    const diklaimDicabut = KLAIM_DICABUT.test(konteks);

    if (dicabut && diklaimBerlaku) {
      hasil.status_verifikasi = "bermasalah";
      hasil.catatan.push(
        `SALAH: teks menyatakan peraturan ini berlaku, padahal statusnya "${d.status}". ` +
          "Perbaiki pernyataannya, atau tambahkan keterangan bahwa rujukan ini bersifat historis."
      );
    } else if (!dicabut && diklaimDicabut) {
      hasil.status_verifikasi = "bermasalah";
      hasil.catatan.push(`SALAH: teks menyatakan peraturan ini sudah dicabut, padahal statusnya "${d.status}".`);
    } else {
      hasil.status_verifikasi = "terverifikasi";
      if (dicabut) {
        hasil.catatan.push(
          `Peraturan berstatus "${d.status}". Teks tidak mengklaim sebaliknya, tetapi pastikan pembaca tahu hal ini.`
        );
      }
    }

    if (d.relasi_status?.["Diubah dengan"]) {
      hasil.catatan.push(
        "Peraturan ini pernah diubah. Periksa apakah pasal yang dikutip termasuk yang diubah, dan sebut rantai " +
          "sitasinya memakai juncto. Pakai konsolidasi_peraturan untuk menelusurinya."
      );
    }

    const pasal = pasalTerkait || null;
    const pdf = d.berkas.find((f) => f.kategori === "Peraturan");
    if (pasal && pdf) {
      hasil.pasal_disebut = pasal;
      const t = await cariDalamPdf({ url_pdf: pdf.url, kata_kunci: pasal, konteks: 500, maks_temuan: 2 });
      hasil.pasal_ditemukan = t.jumlah_temuan > 0;

      if (!t.jumlah_temuan) {
        hasil.status_verifikasi = "bermasalah";
        hasil.catatan.push(
          `${pasal} tidak ditemukan dalam PDF peraturan ini. Bisa jadi salah nomor, atau lapisan teks PDF merusak ` +
            "angkanya — periksa langsung sebelum menyimpulkan."
        );
      } else {
        hasil.kutipan_pasal = t.temuan[0]?.cuplikan?.slice(0, 400) || null;

        const frasa = frasaUji(teks, m.index);
        if (frasa) {
          hasil.frasa_diuji = frasa;
          const token = frasa.split(/\s+/);
          const varian = [frasa];
          if (token.length > 2) varian.push(token.slice(0, 3).join(" "), token.slice(0, 2).join(" "));

          let cocok = null;
          for (const vr of varian) {
            const uji = await cariDalamPdf({ url_pdf: pdf.url, kata_kunci: vr, konteks: 220, maks_temuan: 1 });
            if (uji.jumlah_temuan > 0) {
              cocok = { varian: vr, cuplikan: uji.temuan[0]?.cuplikan?.slice(0, 260) || null };
              break;
            }
          }

          hasil.frasa_ditemukan = Boolean(cocok);
          if (cocok) {
            hasil.frasa_cocok_pada = cocok.varian;
            hasil.frasa_kutipan = cocok.cuplikan;
            if (cocok.varian !== frasa) {
              hasil.catatan.push(
                `Frasa "${frasa}" tidak ada persis, tetapi bagiannya (${cocok.varian}) ditemukan. Naskah resmi ` +
                  "sering menyisipkan ejaan huruf di tengah angka. Cocokkan kutipan verbatim langsung ke PDF."
              );
            }
          } else {
            hasil.catatan.push(
              `Frasa "${frasa}" tidak ditemukan dalam PDF, termasuk setelah dilonggarkan. Ini belum tentu salah — ` +
                "redaksi bisa berbeda atau lapisan teks cacat — tetapi kutipan verbatim wajib dicocokkan ke PDF."
            );
          }
        }
      }
    }
  } catch (e) {
    hasil.status_verifikasi = "tidak_diperiksa";
    hasil.catatan.push("Pemeriksaan gagal dijalankan: " + String(e.message).slice(0, 110));
  }

  return hasil;
}

async function periksaPutusanMK(m) {
  const nomor = `${m[1]}/${m[2]}-${m[3]}/${m[4]}`;
  const hasil = {
    jenis: "putusan_mk",
    tertulis: nomor,
    posisi: m.index,
    status_verifikasi: "tidak_diperiksa",
    catatan: [],
  };
  try {
    const r = await cariPutusanMK({ query: nomor, limit: 30, opsi_jaringan: { retries: 1, timeout: 20000 } });
    const h = r.hasil.find((x) => x.nomor_perkara === nomor);
    if (!h) {
      hasil.status_verifikasi = "tidak_ditemukan";
      hasil.catatan.push(
        "Tidak ada perkara dengan nomor persis itu. Pencarian MK mencocokkan substring, jadi nomor yang mirip " +
          "bukan berarti benar. Periksa penulisan angka Romawi dan tahunnya."
      );
      return hasil;
    }
    hasil.status_verifikasi = "terverifikasi";
    hasil.pokok_perkara = h.pokok_perkara;
    hasil.amar = h.amar_putusan;
    hasil.status_perkara = h.status;
    hasil.tanggal = h.tanggal;
    hasil.berkas = h.berkas_pendukung || h.berkas_putusan || null;
  } catch (e) {
    hasil.catatan.push("Pemeriksaan gagal dijalankan: " + String(e.message).slice(0, 110));
  }
  return hasil;
}

async function periksaFatwa(m) {
  const nomor = `${m[1]}/DSN-MUI/${m[2]}/${m[3]}`;
  const hasil = {
    jenis: "fatwa_dsn",
    tertulis: nomor,
    posisi: m.index,
    status_verifikasi: "tidak_diperiksa",
    catatan: [],
  };
  try {
    const idx = await indeksFatwa();
    const f = idx.fatwa.find((x) => x.nomor.replace(/\s+/g, "") === nomor.replace(/\s+/g, ""));
    if (!f) {
      hasil.status_verifikasi = "tidak_ditemukan";
      hasil.catatan.push("Nomor fatwa itu tidak ada dalam indeks DSN-MUI. Periksa angka Romawi dan tahunnya.");
      return hasil;
    }
    hasil.status_verifikasi = "terverifikasi";
    hasil.judul = f.judul;
    hasil.url_pdf = f.url_pdf;
    hasil.catatan.push(
      "Fatwa ada, tetapi fatwa bukan peraturan perundang-undangan. Bila teks memperlakukannya sebagai hukum " +
        "positif, periksa apakah sudah dipositifkan lewat POJK, PBI, atau KHES."
    );
  } catch (e) {
    hasil.catatan.push("Pemeriksaan gagal dijalankan: " + String(e.message).slice(0, 110));
  }
  return hasil;
}

/** Periksa seluruh sitasi yang terdeteksi dalam sebuah draf. */
export async function verifikasiKutipan({ teks, maks_rujukan = 12, periksa_putusan_ma = true }) {
  if (!teks || String(teks).trim().length < 10) throw new Error("Sertakan teks draf yang berisi sitasi.");

  const tugas = [];
  for (const m of teks.matchAll(POLA.peraturan)) tugas.push({ tipe: "peraturan", m });
  for (const m of teks.matchAll(POLA.putusan_mk)) tugas.push({ tipe: "mk", m });
  for (const m of teks.matchAll(POLA.fatwa_dsn)) tugas.push({ tipe: "fatwa", m });
  tugas.sort((a, b) => a.m.index - b.m.index);

  const putusanMa = periksa_putusan_ma ? [...teks.matchAll(POLA.putusan_ma)].map((m) => m[0]) : [];
  const dipakai = tugas.slice(0, maks_rujukan);

  const posisiRujukan = dipakai
    .filter((t) => t.tipe === "peraturan")
    .map((t) => ({ mulai: t.m.index, panjang: t.m[0].length }));
  const petaPasal = petakanPasal(teks, posisiRujukan);

  const hasil = [];
  for (let i = 0; i < dipakai.length; i++) {
    const t = dipakai[i];
    if (t.tipe === "peraturan") hasil.push(await periksaPeraturan(teks, t.m, petaPasal.get(t.m.index)));
    else if (t.tipe === "mk") hasil.push(await periksaPutusanMK(t.m));
    else hasil.push(await periksaFatwa(t.m));
  }

  const ringkas = {
    terverifikasi: hasil.filter((h) => h.status_verifikasi === "terverifikasi").length,
    bermasalah: hasil.filter((h) => h.status_verifikasi === "bermasalah").length,
    tidak_ditemukan: hasil.filter((h) => h.status_verifikasi === "tidak_ditemukan").length,
    tidak_diperiksa: hasil.filter((h) => h.status_verifikasi === "tidak_diperiksa").length,
  };

  const peringatan = [
    "Alat ini memeriksa keberadaan, status, dan nomor. Ia TIDAK menilai apakah penafsiran hukumnya benar.",
    "Rujukan yang tidak terdeteksi polanya tidak ikut diperiksa, dan itu bukan berarti benar. Periksa sendiri " +
      "rujukan yang ditulis dengan gaya tidak lazim.",
  ];

  if (putusanMa.length) {
    peringatan.push(
      `Terdeteksi ${putusanMa.length} nomor putusan Mahkamah Agung (${putusanMa.slice(0, 3).join("; ")}). ` +
        "Nomor putusan MA tidak dapat diverifikasi otomatis karena pencarian teks-bebas Direktori Putusan terkunci " +
        "CAPTCHA. Cocokkan lewat mesin pencari lalu detail_putusan_ma."
    );
  }
  if (tugas.length > dipakai.length) {
    peringatan.push(`Terdeteksi ${tugas.length} rujukan, tetapi hanya ${dipakai.length} diperiksa (batas maks_rujukan).`);
  }
  if (!tugas.length) {
    peringatan.push("Tidak ada rujukan yang dikenali polanya dalam teks ini.");
  }

  return {
    jumlah_rujukan_terdeteksi: tugas.length,
    jumlah_diperiksa: hasil.length,
    ringkasan: ringkas,
    hasil,
    peringatan,
  };
}
