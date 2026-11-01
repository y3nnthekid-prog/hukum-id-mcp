/**
 * Kamus bahasa sehari-hari ke istilah hukum untuk empat topik Tanya Pasla.
 *
 * Kamus ini hanya menyusun kata kunci pencarian dan memilih pasal kunci yang
 * dibuka. Ia tidak pernah menjadi dasar jawaban, dan kueri yang dikirim ke situs
 * sumber hanya berasal dari kosakata di sini, bukan dari teks mentah pengguna.
 */
import type { RujukanBuka } from "./sumber.js";

export const TOPIK = ["konsumen", "pekerjaan", "sewa-utang", "syariah"] as const;
export type Topik = (typeof TOPIK)[number];
export type JenisSumberTopik = "peraturan" | "fatwa" | "khes";

/** pasal: rujukan kunci yang dibuka langsung. Nomornya diperiksa ke teks korpus atau indeks DSN (1-2 Nov 2026). */
type Entri = { pola: RegExp; kueri: string; pasal?: RujukanBuka[] };
const uu = (rujukan: string, ...pasal: string[]): RujukanBuka[] => pasal.map((p) => ({ jenis: "peraturan", rujukan, pasal: `Pasal ${p}` }));
const fatwa = (...nomor: string[]): RujukanBuka[] => nomor.map((n) => ({ jenis: "fatwa", nomor: n }));
type Profil = {
  label: string;
  /** Penanda topik. Bobot 3 untuk istilah khas, 2 untuk kata yang kuat tetapi umum, 1 untuk kata yang bisa muncul di topik lain. */
  penanda: Array<[RegExp, number]>;
  entri: Entri[];
  kueriDasar: string;
  sumber: JenisSumberTopik[];
};

export const PROFIL_TOPIK: Record<Topik, Profil> = {
  konsumen: {
    label: "Belanja dan konsumen",
    penanda: [
      [/\b(?:konsumen|marketplace|e-?commerce|toko (?:online|daring)|belanja (?:online|daring)|refund|retur|garansi|cod|checkout|resi|kurir|ekspedisi|olshop)\b/iu, 3],
      [/\b(?:shopee|tokopedia|lazada|tiktok ?shop|bukalapak|blibli)\b/iu, 3],
      [/\b(?:belanja|beli|membeli|dibeli|pembelian|pembeli|penjual|seller|barang|produk|paket|pesanan|dikirim|pengiriman|jasa|servis|bengkel|kedaluwarsa|palsu|iklan|promo)\b/iu, 1],
    ],
    entri: [
      { pola: /\b(?:rusak|cacat|pecah|retak|mati|tidak berfungsi|tak berfungsi|bekas)\b/iu, kueri: "barang cacat rusak ganti rugi", pasal: uu("UU 8/1999", "19", "4") },
      { pola: /\b(?:refund|uang kembali|pengembalian (?:dana|uang)|balikin uang|minta uang|mengembalikan uang|uang\w* (?:tidak|belum|ga|gak|nggak) dikembalikan)\b/iu, kueri: "pengembalian uang ganti rugi konsumen", pasal: uu("UU 8/1999", "19") },
      { pola: /\b(?:tidak sesuai|tak sesuai|beda|berbeda|palsu|kw|tiruan|salah kirim)\b/iu, kueri: "barang tidak sesuai dengan yang dijanjikan", pasal: uu("UU 8/1999", "4", "7") },
      { pola: /\bgaransi\b/iu, kueri: "jaminan garansi purna jual", pasal: uu("UU 8/1999", "25", "26") },
      { pola: /\b(?:tidak (?:dikirim|sampai|datang)|belum (?:dikirim|sampai|datang)|hilang|telat (?:dikirim|sampai))\b/iu, kueri: "barang tidak dikirim pelaku usaha", pasal: uu("UU 8/1999", "16") },
      { pola: /\b(?:iklan|promo|diskon|menyesatkan|penipuan)\b/iu, kueri: "iklan informasi menyesatkan pelaku usaha", pasal: uu("UU 8/1999", "17") },
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
      [/\b(?:dipecat|pecat|diberhentikan|di-?phk|dirumahkan|resign|mengundurkan diri|kontrak kerja|perjanjian kerja|magang|cuti)\b/iu, 3],
      [/\b(?:gaji\w*|upah\w*|karyawan|pekerja|buruh|pegawai|bos|atasan|kantor|pabrik)\b/iu, 2],
      [/\b(?:kerja|bekerja|perusahaan|shift)\b/iu, 1],
    ],
    entri: [
      { pola: /\b(?:dipecat|pecat|diberhentikan|di-?phk|phk|pemutusan|disuruh berhenti|diminta berhenti|dirumahkan)\b/iu, kueri: "pemutusan hubungan kerja", pasal: uu("PP 35/2021", "40") },
      { pola: /\b(?:pesangon|uang (?:pisah|penghargaan))\b/iu, kueri: "uang pesangon penghargaan masa kerja", pasal: uu("PP 35/2021", "40") },
      { pola: /\b(?:gaji\w*|upah\w*)\b.{0,40}\b(?:(?:belum|tidak|tak|ga|gak|nggak|enggak)\s+(?:di)?(?:bayar\w*|kasih|keluar|cair|turun)|ditahan|nunggak|dicicil|telat|terlambat)\b|\b(?:telat|terlambat|belum)\s+(?:gajian|digaji)\b|\b(?:telat|terlambat|belum|tidak|tak|ga|gak|nggak|enggak)\s+(?:bayar|membayar|dibayar|kasih|ngasih)\s+(?:gaji|upah)|\blewat\s+(?:dari\s+)?(?:tanggal\s+)?gajian\b/iu, kueri: "pembayaran upah terlambat denda", pasal: uu("PP 36/2021", "55", "61") },
      { pola: /\b(?:gaji\w*|upah\w*)\b/iu, kueri: "pembayaran upah pekerja" },
      { pola: /\blembur\b/iu, kueri: "waktu kerja lembur upah lembur", pasal: uu("PP 35/2021", "27") },
      { pola: /\b(?:habis kontrak|kontrak (?:habis|selesai|berakhir))\b/iu, kueri: "berakhirnya perjanjian kerja waktu tertentu kompensasi", pasal: uu("PP 35/2021", "15") },
      { pola: /\b(?:diputus sebelum|sebelum kontrak|kontrak (?:diputus|dihentikan))\b/iu, kueri: "pengakhiran perjanjian kerja waktu tertentu", pasal: uu("PP 35/2021", "17") },
      { pola: /\b(?:kontrak|pkwt|perjanjian kerja waktu tertentu)\b/iu, kueri: "perjanjian kerja waktu tertentu" },
      { pola: /\b(?:tetap|pkwtt|karyawan tetap)\b/iu, kueri: "perjanjian kerja waktu tidak tertentu" },
      { pola: /\bcuti\b/iu, kueri: "cuti istirahat pekerja" },
      { pola: /\b(?:resign|mengundurkan diri|keluar kerja)\b/iu, kueri: "mengundurkan diri atas kemauan sendiri", pasal: uu("PP 35/2021", "50") },
      { pola: /\b(?:thr|tunjangan hari raya)\b/iu, kueri: "tunjangan hari raya keagamaan", pasal: uu("PP 36/2021", "9", "62") },
      { pola: /\b(?:outsourcing|alih daya|vendor)\b/iu, kueri: "perusahaan alih daya" },
      { pola: /\b(?:mediasi|bipartit|tripartit|perselisihan|sengketa|gugat)\b/iu, kueri: "perselisihan hubungan industrial" },
    ],
    kueriDasar: "hak pekerja kewajiban pengusaha",
    sumber: ["peraturan"],
  },
  "sewa-utang": {
    label: "Sewa dan utang-piutang",
    penanda: [
      [/\b(?:sewa|menyewa|disewa|penyewa|kontrakan|kos|kost|kosan|ngekos|indekos|deposit|uang jaminan)\b/iu, 3],
      [/\b(?:utang\w*|hutang\w*|piutang|pinjam|meminjam|dipinjam|pinjaman|minjem|pinjem|ngutang|pinjol|debt collector|penagih|wanprestasi|ingkar janji|somasi)\b/iu, 3],
      [/\b(?:kredit|leasing|cicilan|angsuran)\b/iu, 2],
      [/\b(?:bayar|tagih|ditagih|tagihan|bunga|denda|kwitansi|jaminan|gadai|pemilik rumah|rumah|kamar|duit)\b/iu, 1],
    ],
    entri: [
      { pola: /\b(?:sewa|menyewa|disewa|kontrakan|kos|kost|kosan|ngekos|indekos)\b/iu, kueri: "sewa menyewa penyewa", pasal: uu("KUH Perdata", "1548", "1550") },
      { pola: /\b(?:deposit|uang jaminan|uang muka)\b/iu, kueri: "sewa menyewa jaminan pengembalian", pasal: uu("KUH Perdata", "1560", "1564") },
      { pola: /\b(?:diusir|disuruh pindah|diputus|berakhir|habis masa|rumahnya dijual)\b/iu, kueri: "berakhirnya sewa menyewa", pasal: uu("KUH Perdata", "1570", "1576") },
      { pola: /\b(?:utang\w*|hutang\w*|piutang|pinjam|meminjam|dipinjam|pinjaman|minjem|pinjem|ngutang)\b/iu, kueri: "pinjam meminjam uang", pasal: uu("KUH Perdata", "1754", "1763") },
      { pola: /\b(?:(?:tidak|tak|belum|enggan|ga|gak|nggak) (?:mau |juga )?(?:bayar|membayar|dibayar|melunasi|mengembalikan|balikin)|ingkar|wanprestasi|kabur|menghilang)\b/iu, kueri: "wanprestasi penggantian biaya rugi bunga", pasal: uu("KUH Perdata", "1238", "1243") },
      { pola: /\b(?:pinjol|pinjaman (?:online|daring)|aplikasi pinjaman|fintech)\b/iu, kueri: "layanan pendanaan bersama berbasis teknologi informasi" },
      { pola: /\b(?:penagih|debt collector|ditagih|teror|diancam|disebar|dipermalukan)\b/iu, kueri: "penagihan pendanaan", pasal: uu("POJK 10/POJK.05/2022", "102") },
      { pola: /\b(?:bunga|denda)\b/iu, kueri: "bunga perjanjian" },
      { pola: /\b(?:tanpa (?:perjanjian|surat|hitam di atas putih)|lisan|kwitansi|bukti transfer)\b/iu, kueri: "syarat sahnya perjanjian", pasal: uu("KUH Perdata", "1866") },
    ],
    kueriDasar: "perjanjian kewajiban debitur kreditur",
    sumber: ["peraturan"],
  },
  syariah: {
    label: "Ekonomi syariah",
    penanda: [
      // "salam" sengaja tidak dipakai: lebih sering salam pembuka daripada akad salam.
      [/\b(?:syariah|syar'?i|akad|murabahah|mudharabah|mudarabah|musyarakah|mmq|ijarah|imbt|wakalah|kafalah|rahn|qardh|wadiah|hawalah|istishna|ujrah|riba|gharar|nisbah|bagi hasil|fatwa|dsn|takaful|sukuk|wakaf)\b/iu, 3],
      [/\b(?:bank syariah|koperasi syariah|kpr syariah|pegadaian syariah)\b/iu, 3],
      [/\b(?:pembiayaan|nasabah|margin)\b/iu, 1],
    ],
    entri: [
      { pola: /\bmurabahah\b/iu, kueri: "murabahah", pasal: fatwa("04/DSN-MUI/IV/2000") },
      { pola: /\b(?:mudharabah|mudarabah)\b/iu, kueri: "mudharabah" },
      { pola: /\b(?:musyarakah mutanaqishah|mmq)\b/iu, kueri: "musyarakah mutanaqishah" },
      { pola: /\bmusyarakah\b/iu, kueri: "musyarakah" },
      { pola: /\b(?:imbt|ijarah muntahiyah)\b/iu, kueri: "ijarah muntahiyah bittamlik", pasal: fatwa("27/DSN-MUI/III/2002") },
      { pola: /\b(?:ijarah|sewa syariah)\b/iu, kueri: "ijarah", pasal: fatwa("112/DSN-MUI/IX/2017") },
      { pola: /\bwakalah\b/iu, kueri: "wakalah" },
      { pola: /\bkafalah\b/iu, kueri: "kafalah" },
      { pola: /\b(?:rahn|gadai syariah|pegadaian)\b/iu, kueri: "rahn" },
      { pola: /\bqardh\b/iu, kueri: "qardh" },
      { pola: /\b(?:tidak mampu|tak mampu|gak mampu|kesulitan bayar|bangkrut|usaha (?:sepi|rugi))\b/iu, kueri: "nasabah tidak mampu membayar penyelesaian", pasal: fatwa("47/DSN-MUI/II/2005", "48/DSN-MUI/II/2005") },
      { pola: /\b(?:telat|terlambat|tunggakan|menunggak|denda|ta'?zir)\b/iu, kueri: "sanksi nasabah mampu menunda pembayaran", pasal: fatwa("17/DSN-MUI/IX/2000") },
      { pola: /\b(?:ganti rugi|ta'?widh)\b/iu, kueri: "ganti rugi ta'widh", pasal: fatwa("43/DSN-MUI/VIII/2004") },
      { pola: /\b(?:riba|bunga)\b/iu, kueri: "riba" },
      { pola: /\b(?:bagi hasil|nisbah)\b/iu, kueri: "nisbah bagi hasil" },
      { pola: /\b(?:sengketa|gugat|pengadilan agama|basyarnas)\b/iu, kueri: "penyelesaian sengketa ekonomi syariah" },
    ],
    kueriDasar: "akad pembiayaan syariah",
    sumber: ["fatwa", "peraturan", "khes"],
  },
};

/** Persoalan di luar empat topik yang sering tertukar: dijawab tanpa AI dengan arahan ke bantuan hukum. */
const DI_LUAR_TOPIK = /\b(?:akad nikah|menikah|pernikahan|cerai|talak|rujuk|waris\w*|hak asuh|nafkah anak|pidana|dipenjara|penjara|narkoba|pembunuhan|pencurian|kdrt)\b/iu;

export function tentukanTopik(teks: string): Topik | null {
  if (DI_LUAR_TOPIK.test(teks)) return null;
  const skor = TOPIK.map((topik) => {
    const penanda = PROFIL_TOPIK[topik].penanda;
    return { topik, nilai: penanda.reduce((jumlah, [pola, bobot]) => jumlah + (pola.test(teks) ? bobot : 0), 0), khas: penanda.some(([pola, bobot]) => bobot >= 3 && pola.test(teks)) };
  });
  // Syariah hanya dipilih bila ada istilah khas syariah; "pembiayaan" atau "nasabah" saja tidak cukup.
  const layak = skor.filter((s) => s.nilai > 0 && (s.topik !== "syariah" || s.khas));
  if (!layak.length) return null;
  layak.sort((a, b) => b.nilai - a.nilai || Number(b.khas) - Number(a.khas) || Number(b.topik === "syariah") - Number(a.topik === "syariah"));
  return layak[0]!.topik;
}

/** Kueri pencarian dari kosakata kamus saja; pesan terbaru diutamakan, paling banyak tiga. */
export function susunKueri(topik: Topik, teks: string, maks = 3, teksTerbaru = ""): string[] {
  const profil = PROFIL_TOPIK[topik];
  const cocok = (t: string) => profil.entri.filter((entri) => t && entri.pola.test(t)).map((entri) => entri.kueri);
  return [...new Set([...cocok(teksTerbaru), ...cocok(teks), profil.kueriDasar])].slice(0, maks);
}

/** Rujukan kunci dari situasi yang cocok, dibuka sebelum hasil pencarian. Paling banyak empat. */
export function pasalKunci(topik: Topik, teks: string, maks = 4): RujukanBuka[] {
  const seen = new Set<string>();
  return PROFIL_TOPIK[topik].entri.filter((e) => e.pola.test(teks)).flatMap((e) => e.pasal ?? [])
    .filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, maks);
}
