/**
 * Kamus bahasa sehari-hari ke istilah hukum untuk empat topik Tanya Pasla.
 *
 * Kamus ini hanya menyusun kata kunci pencarian. Ia tidak pernah menjadi dasar
 * jawaban, dan kueri yang dikirim ke situs sumber hanya berasal dari kosakata
 * di sini, bukan dari teks mentah pengguna.
 */
export const TOPIK = ["konsumen", "pekerjaan", "sewa-utang", "syariah"] as const;
export type Topik = (typeof TOPIK)[number];
export type JenisSumberTopik = "peraturan" | "fatwa" | "khes";
import type { RujukanBuka } from "./sumber.js";

/** pasal: rujukan kunci yang dibuka langsung. Nomornya diperiksa ke korpus/indeks DSN 1 Nov 2026. */
type Entri = { pola: RegExp; kueri: string; pasal?: RujukanBuka[] };
const uu = (rujukan: string, ...pasal: string[]): RujukanBuka[] => pasal.map((p) => ({ jenis: "peraturan", rujukan, pasal: `Pasal ${p}` }));
type Profil = {
  label: string;
  /** Penanda topik. Bobot 3 untuk istilah khas, 1 untuk kata yang bisa muncul di topik lain. */
  penanda: Array<[RegExp, number]>;
  entri: Entri[];
  kueriDasar: string;
  sumber: JenisSumberTopik[];
};

export const PROFIL_TOPIK: Record<Topik, Profil> = {
  konsumen: {
    label: "Belanja dan konsumen",
    penanda: [
      [/\b(?:konsumen|marketplace|e-?commerce|toko (?:online|daring)|belanja (?:online|daring)|refund|retur|garansi|cod|checkout|resi|kurir|ekspedisi)\b/iu, 3],
      [/\b(?:shopee|tokopedia|lazada|tiktok ?shop|bukalapak|blibli)\b/iu, 3],
      [/\b(?:belanja|beli|membeli|dibeli|pembelian|pembeli|penjual|seller|toko|barang|produk|paket|pesanan|dikirim|pengiriman|jasa|servis|bengkel|kedaluwarsa|palsu|iklan|promo)\b/iu, 1],
    ],
    entri: [
      { pola: /\b(?:rusak|cacat|pecah|retak|mati|tidak berfungsi|tak berfungsi|bekas)\b/iu, kueri: "barang cacat rusak ganti rugi", pasal: uu("UU 8/1999", "19", "4") },
      { pola: /\b(?:refund|uang kembali|pengembalian (?:dana|uang)|balikin uang|minta uang)\b/iu, kueri: "pengembalian uang ganti rugi konsumen", pasal: uu("UU 8/1999", "19") },
      { pola: /\b(?:tidak sesuai|tak sesuai|beda|berbeda|palsu|kw|tiruan|salah kirim)\b/iu, kueri: "barang tidak sesuai dengan yang dijanjikan", pasal: uu("UU 8/1999", "4", "7") },
      { pola: /\bgaransi\b/iu, kueri: "jaminan garansi purna jual" },
      { pola: /\b(?:tidak (?:dikirim|sampai|datang)|belum (?:dikirim|sampai|datang)|hilang)\b/iu, kueri: "barang tidak dikirim pelaku usaha" },
      { pola: /\b(?:iklan|promo|diskon|menyesatkan|penipuan)\b/iu, kueri: "iklan informasi menyesatkan pelaku usaha" },
      { pola: /\b(?:online|daring|marketplace|aplikasi|e-?commerce)\b/iu, kueri: "perdagangan melalui sistem elektronik" },
      { pola: /\b(?:data pribadi|bocor|kebocoran|nomor (?:hp|telepon) disebar)\b/iu, kueri: "pelindungan data pribadi" },
      { pola: /\b(?:jasa|servis|bengkel|laundry|perbaikan)\b/iu, kueri: "jasa pelaku usaha tanggung jawab" },
    ],
    kueriDasar: "hak dan kewajiban konsumen pelaku usaha",
    sumber: ["peraturan"],
  },
  pekerjaan: {
    label: "Pekerjaan",
    penanda: [
      [/\b(?:phk|pesangon|pkwt|pkwtt|outsourcing|alih daya|lembur|thr|hrd|bpjs ketenagakerjaan|disnaker|hubungan industrial|serikat pekerja)\b/iu, 3],
      [/\b(?:dipecat|diberhentikan|di-?phk|resign|mengundurkan diri|kontrak kerja|perjanjian kerja|magang|cuti)\b/iu, 3],
      [/\b(?:kerja|bekerja|pekerja|karyawan|buruh|pegawai|kantor|perusahaan|pabrik|bos|atasan|gaji|upah|shift)\b/iu, 1],
    ],
    entri: [
      { pola: /\b(?:dipecat|diberhentikan|di-?phk|phk|pemutusan|disuruh berhenti|diminta berhenti)\b/iu, kueri: "pemutusan hubungan kerja", pasal: uu("PP 35/2021", "40") },
      { pola: /\b(?:pesangon|uang (?:pisah|penghargaan))\b/iu, kueri: "uang pesangon penghargaan masa kerja", pasal: uu("PP 35/2021", "40") },
      { pola: /\b(?:gaji|upah)\b/iu, kueri: "pembayaran upah pekerja" },
      { pola: /\blembur\b/iu, kueri: "waktu kerja lembur upah lembur" },
      { pola: /\b(?:kontrak|pkwt|perjanjian kerja waktu tertentu|habis kontrak)\b/iu, kueri: "perjanjian kerja waktu tertentu" },
      { pola: /\b(?:tetap|pkwtt|karyawan tetap)\b/iu, kueri: "perjanjian kerja waktu tidak tertentu" },
      { pola: /\bcuti\b/iu, kueri: "cuti istirahat pekerja" },
      { pola: /\b(?:resign|mengundurkan diri|keluar kerja)\b/iu, kueri: "mengundurkan diri atas kemauan sendiri" },
      { pola: /\b(?:thr|tunjangan hari raya)\b/iu, kueri: "tunjangan hari raya keagamaan" },
      { pola: /\b(?:outsourcing|alih daya|vendor)\b/iu, kueri: "perusahaan alih daya" },
      { pola: /\b(?:mediasi|bipartit|tripartit|perselisihan|sengketa|gugat)\b/iu, kueri: "perselisihan hubungan industrial" },
    ],
    kueriDasar: "hak pekerja kewajiban pengusaha",
    sumber: ["peraturan"],
  },
  "sewa-utang": {
    label: "Sewa dan utang-piutang",
    penanda: [
      [/\b(?:sewa|menyewa|disewa|penyewa|kontrakan|kos|kost|indekos|deposit|uang jaminan)\b/iu, 3],
      [/\b(?:utang|hutang|piutang|pinjam|meminjam|dipinjam|pinjaman|pinjol|debt collector|penagih|wanprestasi|ingkar janji|somasi)\b/iu, 3],
      [/\b(?:bayar|cicilan|angsuran|tagih|ditagih|tagihan|bunga|denda|kwitansi|jaminan|gadai|pemilik rumah|rumah|kamar)\b/iu, 1],
    ],
    entri: [
      { pola: /\b(?:sewa|menyewa|disewa|kontrakan|kos|kost|indekos)\b/iu, kueri: "sewa menyewa penyewa", pasal: uu("KUH Perdata", "1548") },
      { pola: /\b(?:deposit|uang jaminan|uang muka)\b/iu, kueri: "sewa menyewa jaminan pengembalian" },
      { pola: /\b(?:diusir|disuruh pindah|diputus|berakhir|habis masa)\b/iu, kueri: "berakhirnya sewa menyewa" },
      { pola: /\b(?:utang|hutang|piutang|pinjam|meminjam|dipinjam|pinjaman)\b/iu, kueri: "pinjam meminjam uang", pasal: uu("KUH Perdata", "1754", "1763") },
      { pola: /\b(?:(?:tidak|tak|belum|enggan) (?:mau |juga )?(?:bayar|membayar|dibayar|melunasi|mengembalikan)|ingkar|wanprestasi|kabur|menghilang)\b/iu, kueri: "wanprestasi penggantian biaya rugi bunga", pasal: uu("KUH Perdata", "1238", "1243") },
      { pola: /\b(?:pinjol|pinjaman (?:online|daring)|aplikasi pinjaman|fintech)\b/iu, kueri: "layanan pendanaan bersama berbasis teknologi informasi" },
      { pola: /\b(?:penagih|debt collector|ditagih|teror|diancam|disebar)\b/iu, kueri: "penagihan pendanaan" },
      { pola: /\b(?:bunga|denda)\b/iu, kueri: "bunga perjanjian" },
      { pola: /\b(?:tanpa (?:perjanjian|surat|hitam di atas putih)|lisan|kwitansi|bukti transfer)\b/iu, kueri: "syarat sahnya perjanjian", pasal: uu("KUH Perdata", "1866") },
    ],
    kueriDasar: "perjanjian kewajiban debitur kreditur",
    sumber: ["peraturan"],
  },
  syariah: {
    label: "Ekonomi syariah",
    penanda: [
      [/\b(?:syariah|syar'?i|akad|murabahah|mudharabah|mudarabah|musyarakah|mmq|ijarah|imbt|wakalah|kafalah|rahn|qardh|wadiah|hawalah|istishna|salam|ujrah|riba|gharar|nisbah|bagi hasil|fatwa|dsn|takaful|sukuk|wakaf)\b/iu, 3],
      [/\b(?:bank syariah|pembiayaan|nasabah|margin|pegadaian|koperasi syariah|kpr syariah)\b/iu, 1],
    ],
    entri: [
      { pola: /\bmurabahah\b/iu, kueri: "murabahah" },
      { pola: /\b(?:mudharabah|mudarabah)\b/iu, kueri: "mudharabah" },
      { pola: /\b(?:musyarakah mutanaqishah|mmq)\b/iu, kueri: "musyarakah mutanaqishah" },
      { pola: /\bmusyarakah\b/iu, kueri: "musyarakah" },
      { pola: /\b(?:ijarah|imbt|sewa syariah)\b/iu, kueri: "ijarah" },
      { pola: /\bwakalah\b/iu, kueri: "wakalah" },
      { pola: /\bkafalah\b/iu, kueri: "kafalah" },
      { pola: /\b(?:rahn|gadai syariah|pegadaian)\b/iu, kueri: "rahn" },
      { pola: /\bqardh\b/iu, kueri: "qardh" },
      { pola: /\b(?:telat|terlambat|tunggakan|menunggak|denda|ta'?zir)\b/iu, kueri: "sanksi nasabah mampu menunda pembayaran", pasal: [{ jenis: "fatwa", nomor: "17/DSN-MUI/IX/2000" }] },
      { pola: /\b(?:riba|bunga)\b/iu, kueri: "riba" },
      { pola: /\b(?:bagi hasil|nisbah)\b/iu, kueri: "nisbah bagi hasil" },
      { pola: /\b(?:sengketa|gugat|pengadilan agama|basyarnas)\b/iu, kueri: "penyelesaian sengketa ekonomi syariah" },
    ],
    kueriDasar: "akad pembiayaan syariah",
    sumber: ["fatwa", "peraturan", "khes"],
  },
};

export function tentukanTopik(teks: string): Topik | null {
  let terbaik: Topik | null = null;
  let skorTerbaik = 0;
  for (const topik of TOPIK) {
    const skor = PROFIL_TOPIK[topik].penanda.reduce((jumlah, [pola, bobot]) => jumlah + (pola.test(teks) ? bobot : 0), 0);
    // Syariah didahulukan saat seri: "pembiayaan murabahah" juga memuat kata utang.
    if (skor > skorTerbaik || (skor === skorTerbaik && skor > 0 && topik === "syariah")) {
      terbaik = topik;
      skorTerbaik = skor;
    }
  }
  return skorTerbaik >= 1 ? terbaik : null;
}

/** Kueri pencarian dari kosakata kamus saja; paling banyak tiga, yang spesifik lebih dulu. */
export function susunKueri(topik: Topik, teks: string, maks = 3): string[] {
  const profil = PROFIL_TOPIK[topik];
  const cocok = profil.entri.filter((entri) => entri.pola.test(teks)).map((entri) => entri.kueri);
  return [...new Set([...cocok, profil.kueriDasar])].slice(0, maks);
}

/** Rujukan kunci dari situasi yang cocok, dibuka sebelum hasil pencarian. Paling banyak empat. */
export function pasalKunci(topik: Topik, teks: string, maks = 4): RujukanBuka[] {
  const seen = new Set<string>();
  return PROFIL_TOPIK[topik].entri.filter((e) => e.pola.test(teks)).flatMap((e) => e.pasal ?? [])
    .filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, maks);
}
