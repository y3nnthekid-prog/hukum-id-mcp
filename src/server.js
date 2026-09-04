#!/usr/bin/env node
// hukum-id-mcp — server MCP untuk riset hukum Indonesia.
// Sumber: JDIH BPK (peraturan), Direktori Putusan MA, Putusan MK, OpenAlex.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { cariPeraturan, detailPeraturan, teksPeraturan } from "./bpk.js";
import { telusuriPutusan, daftarKategori, detailPutusan } from "./ma.js";
import { cariPutusanMK, JENIS_PERKARA } from "./mk.js";
import { cariLiteratur } from "./scholar.js";
import { cariFatwaDsn, teksFatwaDsn, cariProdukDsn } from "./dsn.js";
import {
  ambilAyat,
  cariAyat,
  daftarKitabHadis,
  ambilHadis,
  cariHadisBerderajat,
  hadisBerderajat,
  daftarKategoriHadis,
} from "./dalil.js";
import { cariPerma } from "./perma.js";
import { cariDalamPdf } from "./pdf.js";
import { periksaPasal, sisirPutusanMK, risetAkadSyariah } from "./alur.js";
import { cariPasalKhes, imporKhes } from "./khes.js";
import { cariTurats, penulisTurats } from "./turats.js";
import { konsolidasiPeraturan } from "./konsolidasi.js";
import { verifikasiKutipan } from "./verifikasi.js";
import { hukumPadaTanggal, daftarPeriksaAkad } from "./analisis.js";

const server = new McpServer({ name: "hukum-id", version: "1.0.0" });

function bungkus(fn) {
  return async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn(args), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Gagal: ${e.message}` }] };
    }
  };
}

server.registerTool(
  "cari_peraturan",
  {
    title: "Cari peraturan (JDIH BPK)",
    description:
      "Cari peraturan perundang-undangan Indonesia di JDIH BPK: UU, Perppu, PP, Perpres, Permen, hingga Perda. " +
      "Mengembalikan judul, jenis/nomor/tahun, status keberlakuan singkat, dan URL detail. " +
      "Langkah pertama sebelum mengutip pasal mana pun.",
    inputSchema: {
      keywords: z.string().optional().describe("Kata kunci bebas, mis. 'pelindungan data pribadi'"),
      tentang: z.string().optional().describe("Pencarian pada judul/perihal saja"),
      nomor: z.string().optional().describe("Nomor peraturan, mis. '27'"),
      jenis: z
        .string()
        .optional()
        .describe(
          "Kode jenis peraturan. Kode yang sudah terverifikasi: 7=UUD 1945, 39=TAP MPR, 8=UU, " +
            "9=Perpu, 10=PP, 11=Perpres, 12=Keppres, 13=Inpres, 14=Peraturan Kementerian/Lembaga, " +
            "18=Peraturan Perundang-undangan Daerah, 6=Peraturan Perundang-undangan Pusat, " +
            "80=Peraturan OJK (POJK), 78=Peraturan Bank Indonesia (PBI), 79=Surat Edaran Bank Indonesia. " +
            "JDIH BPK sudah mengindeks POJK, SEOJK, dan PBI lengkap dengan statusnya, jadi regulasi keuangan " +
            "syariah dicari di sini, bukan di situs OJK. " +
            "214=Surat Edaran, 27=Peraturan BPK. Menyaring jenis jauh lebih efektif daripada " +
            "menebak lewat kata kunci saat mencari peraturan pelaksana."
        ),
      entitas: z.string().optional().describe("Instansi/daerah penerbit bila diketahui"),
      tahun: z.string().optional().describe("Tahun penetapan, mis. '2022'"),
      halaman: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
  },
  bungkus(cariPeraturan)
);

server.registerTool(
  "detail_peraturan",
  {
    title: "Detail & status peraturan",
    description:
      "Metadata lengkap satu peraturan: judul resmi, dasar hukum, tanggal penetapan/pengundangan, STATUS keberlakuan, " +
      "relasi antarperaturan (Mencabut / Dicabut dengan / Mengubah / Diubah dengan), putusan uji materi MK terkait, " +
      "abstrak, catatan, dan tautan PDF resmi. Panggil ini sebelum menyatakan sebuah pasal masih berlaku.",
    inputSchema: { ref: z.string().describe("ID BPK (mis. '229798') atau URL halaman Details") },
  },
  bungkus(({ ref }) => detailPeraturan(ref))
);

server.registerTool(
  "teks_peraturan",
  {
    title: "Teks penuh peraturan (PDF)",
    description:
      "Unduh PDF resmi peraturan lalu ekstrak teksnya. Bisa dibatasi rentang halaman atau disaring kata kunci " +
      "(mis. 'Pasal 65') agar hanya halaman relevan yang kembali. Pakai URL PDF dari detail_peraturan.",
    inputSchema: {
      url_pdf: z.string().describe("URL PDF dari detail_peraturan (berkas kategori 'Peraturan')"),
      halaman_awal: z.number().int().min(1).optional(),
      halaman_akhir: z.number().int().min(0).optional().describe("0 = sampai halaman terakhir"),
      cari: z.string().optional().describe("Hanya halaman yang memuat teks ini, mis. 'Pasal 65'"),
      maks_karakter: z.number().int().min(1000).max(60000).optional(),
    },
  },
  bungkus(teksPeraturan)
);

server.registerTool(
  "kategori_putusan_ma",
  {
    title: "Daftar kategori Direktori Putusan MA",
    description:
      "Slug kategori perkara di Direktori Putusan MA untuk dipakai pada telusuri_putusan_ma. " +
      "Tanpa argumen: kategori tingkat atas. Dengan induk='perdata-agama-1': subkategorinya, " +
      "termasuk 'ekonomi-syari-ah-1' tempat perkara ekonomi syariah di Pengadilan Agama berada.",
    inputSchema: { induk: z.string().optional().describe("Slug kategori induk, mis. 'perdata-agama-1'") },
  },
  bungkus(daftarKategori)
);

server.registerTool(
  "telusuri_putusan_ma",
  {
    title: "Telusuri putusan Mahkamah Agung",
    description:
      "Telusuri Direktori Putusan MA per kategori perkara dan tahun (mis. kategori 'korupsi-1', tahun '2025'). " +
      "Catatan: pencarian teks-bebas di situs MA dilindungi CAPTCHA, jadi untuk kata kunci gunakan mesin pencari " +
      "dengan 'site:putusan3.mahkamahagung.go.id', lalu ambil detailnya lewat detail_putusan_ma.",
    inputSchema: {
      kategori: z.string().optional().describe("Slug kategori, lihat kategori_putusan_ma"),
      tahun: z.string().optional().describe("Tahun, mis. '2025'"),
      jenis_tahun: z.enum(["putus", "regis", "upload"]).optional(),
      halaman: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
  },
  bungkus(telusuriPutusan)
);

server.registerTool(
  "detail_putusan_ma",
  {
    title: "Detail putusan Mahkamah Agung",
    description:
      "Metadata satu putusan MA: nomor, tingkat proses, klasifikasi, majelis hakim, panitera, tanggal register/putus, " +
      "kaidah, serta tautan unduh PDF/ZIP.",
    inputSchema: { ref: z.string().describe("URL halaman putusan atau id direktori") },
  },
  bungkus(({ ref }) => detailPutusan(ref))
);

server.registerTool(
  "cari_putusan_mk",
  {
    title: "Cari putusan Mahkamah Konstitusi",
    description:
      "Cari putusan MK berdasarkan kata kunci dan jenis perkara (" +
      Object.keys(JENIS_PERKARA).join(", ") +
      "). Mengembalikan nomor perkara, pokok perkara, pemohon, amar putusan, status, tanggal, dan tautan salinan putusan.",
    inputSchema: {
      query: z.string().optional().describe("Kata kunci, mis. 'pelindungan data pribadi'"),
      jenis: z.enum(["PUU", "SKLN", "PHPU", "PHPKADA"]).optional(),
      halaman: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
  },
  bungkus(cariPutusanMK)
);

server.registerTool(
  "cari_literatur_hukum",
  {
    title: "Cari literatur & doktrin (OpenAlex)",
    description:
      "Cari artikel jurnal, buku, dan bab buku ilmiah untuk menopang argumen doktrinal. Mengembalikan judul, penulis, " +
      "tahun, terbitan, DOI, jumlah sitasi, status akses terbuka, dan abstrak. Pakai bahasa='id' untuk literatur Indonesia.",
    inputSchema: {
      query: z.string().describe("Kata kunci; bahasa Inggris memberi cakupan terluas"),
      tahun_min: z.number().int().optional(),
      tahun_maks: z.number().int().optional(),
      hanya_akses_terbuka: z.boolean().optional(),
      bahasa: z.string().optional().describe("Kode bahasa ISO, mis. 'id' atau 'en'"),
      limit: z.number().int().min(1).max(25).optional(),
    },
  },
  bungkus(cariLiteratur)
);

server.registerTool(
  "cari_fatwa_dsn",
  {
    title: "Cari fatwa DSN-MUI",
    description:
      "Cari fatwa Dewan Syariah Nasional MUI dari indeks lengkap seluruh fatwa (di-cache 7 hari). " +
      "Rujukan utama kesesuaian syariah bagi lembaga keuangan syariah Indonesia. " +
      "Mengembalikan nomor fatwa, judul, tahun, dan tautan salinan PDF. " +
      "Daya ikat hukumnya baru penuh setelah dipositifkan lewat POJK/PBI/KHES — periksa juga peraturan itu.",
    inputSchema: {
      query: z.string().optional().describe("Kata kunci akad atau topik, mis. 'murabahah', 'sukuk', 'wakaf'"),
      nomor: z.string().optional().describe("Potongan nomor fatwa, mis. '111'"),
      tahun: z.number().int().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      paksa_segarkan: z.boolean().optional().describe("Bangun ulang indeks dari situs DSN-MUI"),
    },
  },
  bungkus(cariFatwaDsn)
);

server.registerTool(
  "teks_fatwa_dsn",
  {
    title: "Teks salinan fatwa DSN-MUI",
    description:
      "Ambil isi salinan fatwa DSN-MUI (PDF) sebagai teks: konsiderans, dalil yang dipakai, dan ketentuan akadnya. " +
      "PERINGATAN: lapisan teks Arab pada PDF fatwa memakai font non-Unicode sehingga keluar rusak — " +
      "pakai terjemahan Indonesianya, dan ambil teks Arab dalilnya lewat ambil_ayat atau ambil_hadis.",
    inputSchema: {
      rujukan: z.string().describe("Nomor fatwa (mis. '111/DSN-MUI/IX/2017') atau URL PDF-nya"),
      cari: z.string().optional().describe("Hanya halaman yang memuat teks ini, mis. 'Ketentuan Akad'"),
      halaman_awal: z.number().int().min(1).optional(),
      halaman_akhir: z.number().int().min(0).optional(),
      maks_karakter: z.number().int().min(1000).max(60000).optional(),
    },
  },
  bungkus(teksFatwaDsn)
);

server.registerTool(
  "ambil_ayat",
  {
    title: "Ambil ayat Al-Qur'an",
    description:
      "Ambil satu ayat: teks Arab Unicode, transliterasi, terjemahan Kemenag RI, tema, dan asbab nuzul bila ada. " +
      "Gunakan setiap kali sebuah ayat akan dikutip sebagai dalil — jangan menulis ayat dari ingatan.",
    inputSchema: {
      surah: z.union([z.number().int().min(1).max(114), z.string()]).describe("Nomor surah, 1-114"),
      ayat: z.union([z.number().int().min(1), z.string()]).describe("Nomor ayat"),
    },
  },
  bungkus(ambilAyat)
);

server.registerTool(
  "cari_ayat",
  {
    title: "Cari ayat Al-Qur'an",
    description:
      "Cari ayat berdasarkan kata kunci, lalu ambil teks Arab dan terjemahannya. " +
      "Pencarian bersifat leksikal, bukan tafsir: ayat yang muncul belum tentu dalil yang tepat untuk masalahnya.",
    inputSchema: {
      query: z.string().describe("Kata kunci, mis. 'riba', 'perdagangan', 'amanah'"),
      limit: z.number().int().min(1).max(8).optional(),
    },
  },
  bungkus(cariAyat)
);

server.registerTool(
  "daftar_kitab_hadis",
  {
    title: "Daftar kitab hadis",
    description: "Daftar kitab hadis yang tersedia beserta slug dan jumlah hadisnya, untuk dipakai pada ambil_hadis.",
    inputSchema: {},
  },
  bungkus(daftarKitabHadis)
);

server.registerTool(
  "ambil_hadis",
  {
    title: "Ambil hadis",
    description:
      "Ambil satu hadis berdasarkan kitab dan nomor: teks Arab Unicode dan terjemahan Indonesia. " +
      "Sumber ini tidak menyertakan derajat kesahihan, dan penomorannya bisa berbeda dari cetakan lain — " +
      "sebutkan sumber penomoran, dan verifikasi takhrij-nya untuk dokumen formal.",
    inputSchema: {
      kitab: z.string().describe("Slug kitab, mis. 'bukhari', 'muslim', 'ibnu-majah'"),
      nomor: z.union([z.number().int().min(1), z.string()]).describe("Nomor hadis pada kitab itu"),
    },
  },
  bungkus(ambilHadis)
);

server.registerTool(
  "cari_perma",
  {
    title: "Cari PERMA / SEMA / KMA (JDIH Mahkamah Agung)",
    description:
      "Cari produk hukum Mahkamah Agung: PERMA, SEMA, dan Keputusan KMA, lengkap dengan tautan PDF. " +
      "WAJIB dipakai untuk produk hukum MA — JDIH BPK tidak mengindeksnya, jadi cari_peraturan tidak akan menemukannya. " +
      "Di sinilah KHES (PERMA 2/2008) dan tata cara penyelesaian perkara ekonomi syariah (PERMA 14/2016) berada. " +
      "Oper url_pdf hasilnya ke teks_peraturan untuk membaca isinya.",
    inputSchema: {
      query: z.string().optional().describe("Kata kunci, mis. 'ekonomi syariah', 'kompilasi'"),
      jenis: z.string().optional().describe("peraturan (default), putusan, naskah-akademik, kajian, artikel, monografi"),
      tahun: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
  },
  bungkus(cariPerma)
);

server.registerTool(
  "periksa_pasal",
  {
    title: "Periksa pasal — satu panggilan, jawaban lengkap",
    description:
      "ALUR UTAMA. Pakai ini lebih dulu untuk pertanyaan berbentuk 'apa bunyi pasal X' atau 'apakah pasal X masih berlaku'. " +
      "Satu panggilan menggantikan rantai cari_peraturan, detail_peraturan, teks_peraturan, dan cari_putusan_mk: " +
      "mengembalikan identitas resmi, STATUS keberlakuan, tanggal penetapan/pengundangan/berlaku, data Lembaran Negara, " +
      "relasi antarperaturan, kutipan verbatim pasal dari PDF resmi beserta nomor halamannya, putusan MK terkait sebagai " +
      "silang-periksa, dan daftar peringatan otomatis (peraturan dicabut, peraturan pernah diubah, daftar uji materi BPK " +
      "yang tidak lengkap). Terima rujukan singkat seperti 'UU 27/2022' maupun kata kunci bebas. " +
      "Untuk PERMA/SEMA/KMA, tulis awalannya (mis. 'PERMA 2/2008') dan pencarian dialihkan ke JDIH Mahkamah Agung.",
    inputSchema: {
      peraturan: z.string().describe("Rujukan singkat ('UU 27/2022', 'PERMA 2/2008') atau kata kunci judul"),
      pasal: z.string().optional().describe("Pasal yang dicari, mis. 'Pasal 46'. Kosongkan bila hanya perlu status"),
      nomor: z.string().optional(),
      tahun: z.string().optional(),
      jenis: z.string().optional().describe("Kode jenis peraturan bila perlu dipersempit"),
      sertakan_putusan_mk: z.boolean().optional().describe("Default true; matikan bila tidak perlu silang-periksa MK"),
      maks_karakter: z.number().int().min(500).max(30000).optional(),
    },
  },
  bungkus(periksaPasal)
);

server.registerTool(
  "cari_dalam_pdf",
  {
    title: "Cari kata kunci di seluruh isi satu PDF",
    description:
      "Cari frasa di seluruh halaman sebuah PDF resmi sekaligus, lalu kembalikan cuplikan berkonteks beserta nomor " +
      "halamannya. Jauh lebih cepat daripada menebak rentang halaman satu per satu. Cocok untuk memastikan apakah " +
      "sebuah pasal atau istilah benar-benar disebut dalam salinan putusan atau undang-undang yang tebal. " +
      "Jumlah temuan nol berarti frasa persis itu tidak ada, bukan berarti isunya tidak dibahas dengan rumusan lain.",
    inputSchema: {
      url_pdf: z.string().describe("URL PDF, dari hasil tool lain"),
      kata_kunci: z.string().describe("Frasa yang dicari, mis. 'Pasal 64 ayat (3)'"),
      konteks: z.number().int().min(80).max(1200).optional().describe("Jumlah karakter konteks di kiri dan kanan"),
      maks_temuan: z.number().int().min(1).max(40).optional(),
    },
  },
  bungkus(cariDalamPdf)
);

server.registerTool(
  "sisir_putusan_mk",
  {
    title: "Sisir banyak putusan MK sekaligus",
    description:
      "Periksa sekumpulan putusan MK dalam satu panggilan: ambil metadata tiap perkara dan hitung kemunculan kata kunci " +
      "di seluruh salinan putusannya, lengkap dengan cuplikan. Dipakai untuk menjawab pertanyaan seperti 'apakah pasal " +
      "ini pernah diuji' tanpa membuka satu per satu. Beri daftar nomor perkara, atau beri kueri agar daftarnya disusun " +
      "otomatis, atau keduanya. Maksimal 25 perkara per panggilan.",
    inputSchema: {
      nomor_perkara: z.array(z.string()).optional().describe("Daftar nomor perkara, mis. ['82/PUU-XX/2022']"),
      kueri: z.string().optional().describe("Kata kunci untuk menyusun daftar perkara secara otomatis"),
      kata_kunci: z.array(z.string()).optional().describe("Frasa yang dihitung di tiap salinan putusan"),
      limit_kueri: z.number().int().min(1).max(30).optional(),
    },
  },
  bungkus(sisirPutusanMK)
);

server.registerTool(
  "riset_akad_syariah",
  {
    title: "Riset akad syariah dua perspektif — satu panggilan",
    description:
      "Titik masuk analisis hukum ekonomi syariah. Satu panggilan mengambil secara paralel: fatwa DSN-MUI yang relevan " +
      "beserta ketentuan akadnya, peraturan positif terkait, dan contoh putusan ekonomi syariah di Pengadilan Agama. " +
      "Keluarannya sudah menyertakan peringatan tentang daya ikat fatwa dan tentang teks Arab PDF fatwa yang rusak. " +
      "Pakai ini sebelum menyusun analisis akad, lalu perdalam dengan periksa_pasal dan ambil_ayat atau ambil_hadis.",
    inputSchema: {
      akad: z.string().describe("Nama akad atau topik, mis. 'murabahah', 'mudharabah', 'sukuk', 'ta widh'"),
      sertakan_teks_fatwa: z.boolean().optional().describe("Default true; ambil ketentuan fatwa utama"),
      maks_karakter: z.number().int().min(500).max(20000).optional(),
    },
  },
  bungkus(risetAkadSyariah)
);

server.registerTool(
  "cari_pasal_khes",
  {
    title: "Cari pasal Kompilasi Hukum Ekonomi Syariah",
    description:
      "Cari pasal atau frasa dalam KHES, hukum materiil yang dipakai hakim Pengadilan Agama untuk perkara ekonomi syariah. " +
      "PENTING: KHES adalah LAMPIRAN PERMA 2/2008 dan tidak termuat dalam PDF PERMA di JDIH Mahkamah Agung, yang hanya " +
      "berisi batang tubuh dua halaman. Bila naskahnya belum diimpor, tool ini mengembalikan penolakan yang jelas beserta " +
      "cara melengkapinya — JANGAN menyebut nomor pasal KHES sebelum naskahnya benar-benar terbaca. " +
      "Tanpa argumen, tool ini melaporkan status naskah yang tersimpan.",
    inputSchema: {
      pasal: z.string().optional().describe("Nomor pasal, mis. '20'"),
      query: z.string().optional().describe("Frasa yang dicari, mis. 'murabahah'"),
      maks_temuan: z.number().int().min(1).max(30).optional(),
    },
  },
  bungkus(cariPasalKhes)
);

server.registerTool(
  "impor_khes",
  {
    title: "Impor naskah KHES dari berkas pengguna",
    description:
      "Muat salinan KHES milik pengguna sekali saja, lalu indeks pasalnya agar dapat dicari. Terima berkas lokal " +
      "(path_pdf) atau tautan (url_pdf). Setelah diimpor, naskahnya tersimpan dan cari_pasal_khes langsung bekerja. " +
      "Tool ini memeriksa kelengkapan berkas dan memperingatkan bila pasal tertingginya jauh di bawah perkiraan.",
    inputSchema: {
      path_pdf: z.string().optional().describe("Lokasi berkas PDF KHES di komputer pengguna"),
      url_pdf: z.string().optional().describe("Tautan PDF KHES bila tersedia"),
    },
  },
  bungkus(imporKhes)
);

server.registerTool(
  "cari_hadis_berderajat",
  {
    title: "Cari hadis lengkap dengan derajat dan syarah",
    description:
      "Cari hadis berdasarkan kata kunci, lalu kembalikan teks Arab, terjemahan Indonesia, DERAJAT kesahihan, takhrij, " +
      "syarah, dan faedahnya. Pakai ini — bukan ambil_hadis — ketika sebuah hadis akan dijadikan dalil penetapan hukum, " +
      "karena derajat menentukan boleh tidaknya hadis dipakai menetapkan halal-haram. " +
      "Pencarian dilakukan pada judul hadis sebagai kata utuh, jadi hadis yang relevan bisa terlewat bila redaksinya " +
      "berbeda; coba beberapa padanan istilah sebelum menyimpulkan tidak ada. " +
      "Penomoran sumber ini berbeda dari penomoran kitab pada ambil_hadis — jangan disilangkan.",
    inputSchema: {
      query: z.string().describe("Kata kunci, mis. 'riba', 'jual beli', 'gharar'"),
      kategori_id: z.string().optional().describe("Default '4' (Fikih dan Usul Fikih), paling relevan untuk muamalah"),
      limit: z.number().int().min(1).max(15).optional(),
      ambil_detail: z.boolean().optional().describe("Default true; matikan bila hanya perlu daftar judul"),
    },
  },
  bungkus(cariHadisBerderajat)
);

server.registerTool(
  "hadis_berderajat",
  {
    title: "Ambil satu hadis berderajat",
    description:
      "Ambil satu hadis dari Ensiklopedia Hadis Nabawi berdasarkan id: teks Arab, terjemahan, derajat kesahihan, " +
      "takhrij, syarah, dan faedah. Id diperoleh dari cari_hadis_berderajat.",
    inputSchema: { id: z.string().describe("Id hadis pada hadeethenc") },
  },
  bungkus(hadisBerderajat)
);

server.registerTool(
  "daftar_kategori_hadis",
  {
    title: "Daftar kategori Ensiklopedia Hadis",
    description:
      "Daftar kategori beserta jumlah hadisnya, untuk mempersempit cari_hadis_berderajat. " +
      "Untuk hukum ekonomi syariah, kategori Fikih dan Usul Fikih (id 4) biasanya yang dituju.",
    inputSchema: {},
  },
  bungkus(daftarKategoriHadis)
);

server.registerTool(
  "cari_produk_dsn",
  {
    title: "Cari pedoman implementasi dan ta'limat DSN-MUI",
    description:
      "Cari produk DSN-MUI selain fatwa. Dua jenis: 'pedoman-implementasi' menjelaskan cara menerapkan sebuah fatwa " +
      "pada produk keuangan nyata, dan 'talimat' memuat surat edaran serta arahan kelembagaan DSN-MUI. " +
      "Inilah yang paling sering dicari praktisi dan Dewan Pengawas Syariah setelah fatwanya sendiri, karena fatwa " +
      "menetapkan kaidah akad sedangkan pedoman menjelaskan penerapannya. " +
      "Untuk membaca isinya, oper url_pdf hasilnya ke teks_fatwa_dsn.",
    inputSchema: {
      jenis: z.enum(["pedoman-implementasi", "talimat"]).optional().describe("Default 'pedoman-implementasi'"),
      query: z.string().optional().describe("Kata kunci, mis. 'musyarakah mutanaqishah', 'asuransi'"),
      tahun: z.number().int().optional(),
      limit: z.number().int().min(1).max(40).optional(),
    },
  },
  bungkus(cariProdukDsn)
);

server.registerTool(
  "cari_turats",
  {
    title: "Verifikasi redaksi kaidah fikih di kitab turats",
    description:
      "Cari frasa Arab di kitab-kitab turats, lalu kembalikan nama kitab, penulis, jilid, halaman, judul bagian, dan " +
      "cuplikan teksnya. Dipakai terutama untuk MEMVERIFIKASI redaksi sebuah kaidah fikih sebelum dikutip dalam " +
      "dokumen formal, sebagaimana dituntut skill qawaid-fiqhiyyah. " +
      "Kutipan sengaja dipotong pendek: tujuannya memastikan redaksi, bukan menyajikan ulang isi kitab. " +
      "Ingat, kemunculan sebuah redaksi di satu kitab tidak dengan sendirinya menjadikannya kaidah yang disepakati, " +
      "dan kitab turats bukan sumber hukum positif Indonesia.",
    inputSchema: {
      query: z.string().describe("Frasa Arab yang dicari, mis. 'الخراج بالضمان'"),
      limit: z.number().int().min(1).max(15).optional(),
    },
  },
  bungkus(cariTurats)
);

server.registerTool(
  "penulis_turats",
  {
    title: "Biografi penulis kitab turats",
    description:
      "Ambil biografi ringkas seorang penulis kitab turats berdasarkan id, untuk menilai kedudukan sebuah rujukan: " +
      "apakah ulama klasik atau kontemporer, dan dari mazhab apa.",
    inputSchema: { id: z.union([z.number().int(), z.string()]).describe("Id penulis dari hasil cari_turats") },
  },
  bungkus(penulisTurats)
);

server.registerTool(
  "konsolidasi_peraturan",
  {
    title: "Jejak perubahan sebuah pasal lintas undang-undang perubahan",
    description:
      "JDIH BPK menyediakan naskah asli dan daftar relasi, tetapi TIDAK menyediakan teks terkonsolidasi. Akibatnya, " +
      "mengutip pasal dari naskah asli bisa keliru karena pasal itu sudah diubah, dan kekeliruannya tidak terlihat " +
      "dari naskah aslinya sendiri. Tool ini menelusuri pasal yang dituju pada naskah asli DAN pada setiap " +
      "undang-undang yang mengubahnya, lalu menyusun rantai sitasi yang benar (mis. 'UU 12/2011 jo. UU 13/2022'). " +
      "Pakai ini sebelum mengutip pasal dari peraturan yang pernah diubah. " +
      "PENTING: pencarian berbasis angka rapuh karena lapisan teks PDF resmi kerap merusak digit — butir '176.' " +
      "pernah terbaca 't76.'. Bila hasilnya nihil, ulangi dengan frasa khas dari bunyi pasalnya lewat frasa_alternatif.",
    inputSchema: {
      peraturan: z.string().describe("Rujukan singkat, mis. 'UU 12/2011'"),
      pasal: z.string().describe("Pasal atau butir yang ditelusuri, mis. 'Pasal 15' atau 'tafsir resmi'"),
      frasa_alternatif: z.array(z.string()).optional().describe("Frasa cadangan bila pencarian utama gagal"),
      maks_perubahan: z.number().int().min(1).max(20).optional(),
      maks_temuan_per_dokumen: z.number().int().min(1).max(10).optional(),
      konteks: z.number().int().min(100).max(2000).optional(),
    },
  },
  bungkus(konsolidasiPeraturan)
);

server.registerTool(
  "verifikasi_kutipan",
  {
    title: "Verifikasi sitasi dalam sebuah draf tulisan",
    description:
      "Diberi teks berisi rujukan hukum, periksa satu per satu: apakah peraturannya ada, apakah statusnya sesuai " +
      "dengan yang diklaim teks, apakah pasal yang disebut benar ada, apakah frasa yang dikutip memang muncul, dan " +
      "apakah nomor perkara MK serta nomor fatwa DSN persis. Menjadikan alat ini pemeriksa, bukan sekadar pencari — " +
      "termasuk untuk memeriksa tulisan yang dihasilkan model lain. " +
      "Tiap rujukan diberi status terverifikasi, bermasalah, tidak_ditemukan, atau tidak_diperiksa. " +
      "Alat ini memeriksa keberadaan, status, dan nomor; ia TIDAK menilai benar tidaknya penafsiran hukum.",
    inputSchema: {
      teks: z.string().describe("Draf tulisan yang memuat sitasi"),
      maks_rujukan: z.number().int().min(1).max(30).optional(),
      periksa_putusan_ma: z.boolean().optional(),
    },
  },
  bungkus(verifikasiKutipan)
);

server.registerTool(
  "hukum_pada_tanggal",
  {
    title: "Apakah sebuah peraturan berlaku pada tanggal tertentu",
    description:
      "Susun garis waktu keberlakuan sebuah peraturan — penetapan, pengundangan, mulai berlaku, dan pencabutan — " +
      "lalu simpulkan statusnya pada tanggal yang ditanyakan. Penting untuk perkara yang tunduk pada hukum lama, " +
      "misalnya perbuatan pidana sebelum KUHP baru berlaku pada 2 Januari 2026. " +
      "Bila peraturan sudah dicabut, tanggal mulai berlakunya peraturan pencabut yang menentukan batas akhirnya.",
    inputSchema: {
      peraturan: z.string().describe("Rujukan singkat, mis. 'UU 8/1981'"),
      tanggal: z.string().describe("Tanggal acuan, mis. '1 Januari 2025' atau '2025-01-01'"),
    },
  },
  bungkus(hukumPadaTanggal)
);

server.registerTool(
  "daftar_periksa_akad",
  {
    title: "Daftar periksa kepatuhan akad terhadap fatwa DSN-MUI",
    description:
      "Tarik fatwa DSN-MUI yang relevan dengan sebuah akad, lalu ekstrak butir ketentuannya menjadi daftar periksa " +
      "yang siap dinilai satu per satu. Untuk praktisi dan Dewan Pengawas Syariah. " +
      "Alat ini SENGAJA tidak memutuskan sendiri butir mana yang terpenuhi: penilaian itu menuntut pembacaan akad " +
      "dan merupakan pekerjaan penganalisis, bukan pencocokan kata. Nilai dari substansi arus dana, risiko, dan " +
      "kepemilikan, bukan dari nama akadnya. " +
      "Keluarannya adalah analisis kepatuhan, BUKAN fatwa dan BUKAN persetujuan Dewan Pengawas Syariah.",
    inputSchema: {
      akad: z.string().describe("Nama akad, mis. 'murabahah', 'mudharabah', 'ijarah'"),
      nomor_fatwa: z.string().optional().describe("Potongan nomor fatwa bila sudah diketahui, mis. '111'"),
      maks_karakter: z.number().int().min(1000).max(30000).optional(),
    },
  },
  bungkus(daftarPeriksaAkad)
);

await server.connect(new StdioServerTransport());
