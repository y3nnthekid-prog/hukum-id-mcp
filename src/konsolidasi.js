// Jejak perubahan sebuah pasal lintas undang-undang perubahan.
//
// JDIH BPK menyediakan naskah asli dan daftar relasi antarperaturan, tetapi
// TIDAK menyediakan teks terkonsolidasi. Akibatnya nyata: mengutip sebuah pasal
// dari naskah asli bisa keliru karena pasal itu sudah diubah oleh undang-undang
// berikutnya, dan kekeliruan itu tidak terlihat dari naskah aslinya sendiri.
//
// Modul ini menyusun JEJAK PERUBAHAN, bukan teks gabungan hasil tebakan.
// Menggabungkan naskah menjadi satu teks berlaku adalah pekerjaan penafsir, dan
// alat ini tidak berpura-pura melakukannya.

import { cariPeraturan, detailPeraturan } from "./bpk.js";
import { cariDalamPdf } from "./pdf.js";
import { selectExactCandidate } from "./trust.js";

function daftarRelasi(relasi, label) {
  const v = relasi?.[label];
  if (!v) return [];
  return Array.isArray(v) ? v : v.ditampilkan || [];
}

function uraikanRujukan(teks = "") {
  const m = String(teks).match(
    /^\s*([A-Za-z][A-Za-z .-]*?)?\s*(?:no\.?|nomor)?\s*(\d+)\s*[/ ]\s*(?:tahun\s*)?(\d{4})\s*$/i
  );
  if (!m) return { keywords: teks };
  return { keywords: (m[1] || "").trim(), nomor: m[2], tahun: m[3] };
}

/**
 * Telusuri sebuah pasal (atau butir lampiran) pada naskah asli dan pada setiap
 * undang-undang yang mengubahnya.
 */
export async function konsolidasiPeraturan({
  peraturan,
  pasal,
  frasa_alternatif = [],
  maks_perubahan = 8,
  maks_temuan_per_dokumen = 3,
  konteks = 700,
}) {
  if (!pasal) throw new Error("Sebutkan pasal atau butir yang ditelusuri, mis. 'Pasal 15' atau '176.'.");

  const semuaFrasa = [pasal, ...frasa_alternatif].filter(Boolean);

  // Lapisan teks PDF resmi kerap merusak angka — butir "176." pernah terbaca
  // "t76." pada UU 13/2022. Pencarian berbasis angka karena itu rapuh.
  const angkaSaja = /^[^a-z]*\d+[^a-z]*$/i.test(pasal.replace(/pasal/i, "").trim());

  async function telusuri(url_pdf) {
    const kumpulan = [];
    for (const f of semuaFrasa) {
      const t = await cariDalamPdf({ url_pdf, kata_kunci: f, konteks, maks_temuan: maks_temuan_per_dokumen });
      for (const x of t.temuan) kumpulan.push({ ...x, cocok_pada: f });
    }
    const unik = [];
    for (const x of kumpulan) {
      if (!unik.some((y) => y.halaman === x.halaman && y.cuplikan === x.cuplikan)) unik.push(x);
    }
    return { jumlah_temuan: unik.length, temuan: unik.slice(0, maks_temuan_per_dokumen) };
  }

  const r = uraikanRujukan(peraturan);
  const cari = await cariPeraturan({
    keywords: r.keywords || peraturan,
    nomor: r.nomor || "",
    tahun: r.tahun || "",
    limit: 8,
  });
  const selection = selectExactCandidate(cari.hasil, { nomor: r.nomor || "", tahun: r.tahun || "" });
  if (selection.status !== "matched") {
    return {
      ditemukan: false,
      status: selection.status,
      catatan:
        selection.status === "ambiguous"
          ? "Rujukan ambigu. Berikan nomor dan tahun; sistem tidak memilih kandidat pertama."
          : "Peraturan dengan identitas persis tidak ditemukan.",
      kandidat: selection.candidates,
      pencarian: cari,
    };
  }
  const pilih = selection.value;

  const induk = await detailPeraturan(pilih.id);
  const pdfInduk = induk.berkas.find((f) => f.kategori === "Peraturan");

  const pengubah = daftarRelasi(induk.relasi_status, "Diubah dengan").slice(0, maks_perubahan);
  const totalPengubah = (() => {
    const v = induk.relasi_status?.["Diubah dengan"];
    return Array.isArray(v) ? v.length : v?.total ?? 0;
  })();

  // Naskah asli dan seluruh naskah perubahan ditelusuri bersamaan.
  const [asli, perubahan] = await Promise.all([
    pdfInduk ? telusuri(pdfInduk.url).catch((e) => ({ galat: e.message })) : Promise.resolve(null),
    Promise.all(
      pengubah.map(async (p) => {
        try {
          const d = await detailPeraturan(p.id);
          const pdf = d.berkas.find((f) => f.kategori === "Peraturan");
          if (!pdf) return { oleh: p.peraturan, url: p.url, catatan: "PDF peraturan perubahan tidak tersedia" };
          const temuan = await telusuri(pdf.url);
          return {
            oleh: p.peraturan,
            tentang: p.tentang,
            status: d.status,
            tanggal_berlaku: d.metadata?.["Tanggal Berlaku"] || null,
            url: p.url,
            url_pdf: pdf.url,
            menyentuh_pasal_ini: temuan.jumlah_temuan > 0,
            jumlah_temuan: temuan.jumlah_temuan,
            temuan: temuan.temuan,
          };
        } catch (e) {
          return { oleh: p.peraturan, url: p.url, catatan: "gagal: " + String(e.message).slice(0, 90) };
        }
      })
    ),
  ]);

  const menyentuh = perubahan.filter((p) => p.menyentuh_pasal_ini);
  const rantai = [pilih.jenis + " " + pilih.nomor + "/" + pilih.tahun, ...menyentuh.map((p) => p.oleh)];

  const peringatan = [
    "Keluaran ini adalah JEJAK PERUBAHAN, bukan naskah terkonsolidasi resmi. Tidak ada lembaga yang menerbitkan " +
      "teks gabungan untuk peraturan Indonesia; penggabungan akhir adalah tafsir penyusun dan menjadi tanggung jawabnya.",
  ];

  if (menyentuh.length) {
    peringatan.push(
      `Pasal ini disentuh oleh ${menyentuh.length} undang-undang perubahan. ` +
        `JANGAN mengutipnya dari naskah asli saja. Sitasi yang benar menyebut rantainya: ${rantai.join(" jo. ")}.`
    );
  } else if (pengubah.length) {
    peringatan.push(
      "Tidak ada undang-undang perubahan yang memuat kata kunci ini. Ini BUKAN bukti pasalnya belum diubah: " +
        "pencarian bersifat leksikal atas lapisan teks PDF, dan perubahan yang dirumuskan dengan redaksi berbeda akan terlewat."
    );
    if (angkaSaja) {
      peringatan.push(
        "Kata kunci yang dipakai hanya berupa angka, dan itu paling rapuh. Lapisan teks PDF resmi kerap merusak " +
          "digit — butir \"176.\" pernah terbaca \"t76.\" pada UU 13/2022, sehingga pencarian angka gagal padahal " +
          "perubahannya ada. Ulangi memakai frasa khas dari bunyi pasalnya, atau isi frasa_alternatif."
      );
    }
  }

  if (totalPengubah > pengubah.length) {
    peringatan.push(
      `Peraturan ini diubah oleh ${totalPengubah} undang-undang, tetapi hanya ${pengubah.length} yang diperiksa ` +
        "(batas maks_perubahan). Naikkan batasnya untuk penelusuran menyeluruh."
    );
  }

  if (asli?.galat) peringatan.push("Naskah asli gagal dibaca: " + String(asli.galat).slice(0, 90));

  return {
    sumber: "JDIH BPK RI",
    dicari: pasal,
    peraturan_induk: {
      judul: induk.judul,
      jenis: pilih.jenis,
      nomor: pilih.nomor,
      tahun: pilih.tahun,
      status: induk.status,
      url: induk.url,
      url_pdf: pdfInduk?.url || null,
    },
    rantai_sitasi: rantai.join(" jo. "),
    naskah_asli: asli?.galat ? null : { jumlah_temuan: asli?.jumlah_temuan ?? 0, temuan: asli?.temuan ?? [] },
    diubah_oleh: perubahan,
    jumlah_pengubah_diperiksa: pengubah.length,
    jumlah_pengubah_seluruhnya: totalPengubah,
    peringatan,
  };
}
