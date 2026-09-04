// Uji asap: jalankan server lewat stdio, daftar tool, lalu panggil beberapa tool.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "src", "server.js");

const p = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const pending = new Map();
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});

let id = 0;
function call(method, params) {
  const myId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(myId, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 90000);
  });
}

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);

await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "1.0.0" },
});
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = (await call("tools/list", {})).result.tools;
ok("tools/list", tools.length === 32, tools.map((t) => t.name).join(", "));

async function tool(name, args) {
  const r = await call("tools/call", { name, arguments: args });
  const teks = r.result?.content?.[0]?.text || "";
  if (r.result?.isError) return { error: teks };
  try {
    return JSON.parse(teks);
  } catch {
    return { error: "bukan JSON: " + teks.slice(0, 120) };
  }
}

const cari = await tool("cari_peraturan", { keywords: "pelindungan data pribadi", limit: 3 });
ok("cari_peraturan", cari.hasil?.length === 3, cari.hasil?.[0]?.judul || cari.error);

const uu = cari.hasil?.find((h) => h.jenis === "UU") || cari.hasil?.[0];
const detail = await tool("detail_peraturan", { ref: uu.id });
ok("detail_peraturan", Boolean(detail.status && detail.judul), `${detail.judul} — status ${detail.status}`);

const pdf = detail.berkas?.find((b) => b.kategori === "Peraturan");
if (pdf) {
  const teks = await tool("teks_peraturan", { url_pdf: pdf.url, cari: "Pasal 1", maks_karakter: 1200 });
  ok("teks_peraturan", (teks.isi?.length || 0) > 0, `${teks.total_halaman} hlm, halaman ${teks.halaman_dikembalikan}`);
} else ok("teks_peraturan", false, "tidak ada PDF peraturan");

const mk = await tool("cari_putusan_mk", { query: "data pribadi", jenis: "PUU", limit: 2 });
ok("cari_putusan_mk", mk.hasil?.length > 0, mk.hasil?.[0]?.nomor_perkara || mk.error);

const kat = await tool("kategori_putusan_ma", {});
ok("kategori_putusan_ma", kat.kategori?.length > 0, kat.kategori?.slice(0, 4).map((k) => k.slug).join(", ") || kat.error);

const ma = await tool("telusuri_putusan_ma", { kategori: "korupsi-1", tahun: "2025", limit: 2 });
ok("telusuri_putusan_ma", ma.hasil?.length > 0, ma.hasil?.[0]?.judul || ma.error);

if (ma.hasil?.[0]) {
  const dp = await tool("detail_putusan_ma", { ref: ma.hasil[0].url });
  ok("detail_putusan_ma", Boolean(dp.nomor), `${dp.nomor} — ${dp.metadata?.["Lembaga Peradilan"] || ""}`);
} else ok("detail_putusan_ma", false, "tidak ada putusan untuk diuji");

const lit = await tool("cari_literatur_hukum", { query: "indonesian constitutional court judicial review", limit: 2 });
ok("cari_literatur_hukum", lit.hasil?.length > 0, lit.hasil?.[0]?.judul || lit.error);

const fatwa = await tool("cari_fatwa_dsn", { query: "murabahah", limit: 3 });
ok("cari_fatwa_dsn", fatwa.hasil?.length > 0, `${fatwa.total_fatwa_terindeks} fatwa terindeks — ${fatwa.hasil?.[0]?.nomor}`);

if (fatwa.hasil?.[0]) {
  const isi = await tool("teks_fatwa_dsn", { rujukan: fatwa.hasil[0].nomor, cari: "Menetapkan", maks_karakter: 1200 });
  ok("teks_fatwa_dsn", (isi.isi?.length || 0) > 0, isi.error || `${isi.total_halaman} hlm, halaman ${isi.halaman_dikembalikan}`);
} else ok("teks_fatwa_dsn", false, "tidak ada fatwa untuk diuji");

const ayat = await tool("ambil_ayat", { surah: 2, ayat: 282 });
ok("ambil_ayat", Boolean(ayat.arab && ayat.terjemah), `${ayat.rujukan} — ${(ayat.terjemah || "").slice(0, 45)}`);

const cariAy = await tool("cari_ayat", { query: "riba", limit: 2 });
ok("cari_ayat", cariAy.hasil?.length > 0, cariAy.hasil?.map((h) => h.rujukan).join(", ") || cariAy.error);

const kitab = await tool("daftar_kitab_hadis", {});
ok("daftar_kitab_hadis", kitab.kitab?.length > 0, kitab.kitab?.map((k) => k.slug).join(", "));

const hadis = await tool("ambil_hadis", { kitab: "muslim", nomor: 2995 });
ok("ambil_hadis", Boolean(hadis.arab && hadis.terjemah), `${hadis.kitab} no. ${hadis.nomor}`);

const subkat = await tool("kategori_putusan_ma", { induk: "perdata-agama-1" });
const es = subkat.kategori?.find((k) => /syari/i.test(k.slug));
ok("kategori_putusan_ma (induk)", Boolean(es), es ? `${es.slug} — ${es.nama}` : "subkategori syariah tidak ketemu");

const putusanES = await tool("telusuri_putusan_ma", { kategori: "ekonomi-syari-ah-1", limit: 2 });
ok("putusan ekonomi syariah", putusanES.hasil?.length > 0, putusanES.hasil?.[0]?.judul || putusanES.error);

const perma = await tool("cari_perma", { query: "ekonomi syariah", limit: 3 });
ok("cari_perma", perma.hasil?.length > 0, perma.hasil?.map((h) => h.judul).join(" | ") || perma.error);

const khes = await tool("cari_perma", { query: "perma nomor 2 tahun 2008", limit: 1 });
if (khes.hasil?.[0]?.url_pdf) {
  const isiKhes = await tool("teks_peraturan", { url_pdf: khes.hasil[0].url_pdf, maks_karakter: 1200 });
  ok("KHES terbaca", (isiKhes.isi?.length || 0) > 0, `${khes.hasil[0].judul} — ${isiKhes.total_halaman} hlm`);
} else ok("KHES terbaca", false, khes.error || "PDF KHES tidak ketemu");

const t0 = Date.now();
const pp = await tool("periksa_pasal", { peraturan: "UU 27/2022", pasal: "Pasal 46" });
const msPP = Date.now() - t0;
ok(
  "periksa_pasal",
  Boolean(pp.peraturan?.status && pp.pasal?.kutipan?.length),
  `${msPP}ms — ${pp.peraturan?.status}, hlm ${JSON.stringify(pp.pasal?.halaman)}, ${pp.peringatan?.length ?? 0} peringatan`
);

const dicabut = await tool("periksa_pasal", { peraturan: "UU 8/1981", sertakan_putusan_mk: false });
ok(
  "periksa_pasal memperingatkan peraturan dicabut",
  /Tidak Berlaku/i.test(dicabut.peraturan?.status || "") && (dicabut.peringatan || []).some((p) => /STATUS/.test(p)),
  dicabut.peringatan?.[0]?.slice(0, 70)
);

const dalam = await tool("cari_dalam_pdf", {
  url_pdf: pp.peraturan.url_pdf,
  kata_kunci: "Pasal 46",
  maks_temuan: 3,
});
ok("cari_dalam_pdf", dalam.jumlah_temuan > 0, `${dalam.jumlah_temuan} temuan di ${dalam.total_halaman} hlm`);

const kosong = await tool("cari_dalam_pdf", { url_pdf: pp.peraturan.url_pdf, kata_kunci: "Pasal 9999" });
ok("cari_dalam_pdf melaporkan nihil dengan jujur", kosong.jumlah_temuan === 0, "jumlah_temuan = 0");

const t1 = Date.now();
const ulang = await tool("periksa_pasal", { peraturan: "UU 27/2022", pasal: "Pasal 46" });
const msUlang = Date.now() - t1;
ok(
  "cache mempercepat panggilan berulang",
  msUlang < msPP || msUlang < 500,
  `panggilan pertama ${msPP}ms, panggilan kedua ${msUlang}ms`
);

const akad = await tool("riset_akad_syariah", { akad: "murabahah", sertakan_teks_fatwa: false });
ok(
  "riset_akad_syariah",
  (akad.fatwa_dsn?.hasil?.length || 0) > 0 && (akad.peringatan?.length || 0) >= 3,
  `${akad.fatwa_dsn?.hasil?.length} fatwa, fatwa utama ${akad.fatwa_utama?.nomor}`
);

const sisir = await tool("sisir_putusan_mk", {
  nomor_perkara: ["82/PUU-XX/2022"],
  kata_kunci: ["Pasal 64 ayat (3)", "Pasal 64 ayat (1b)"],
});
const s0 = sisir.hasil?.[0];
ok(
  "sisir_putusan_mk menghitung kata kunci",
  Boolean(s0?.kata_kunci),
  s0?.kata_kunci
    ? `ayat(3)=${s0.kata_kunci["Pasal 64 ayat (3)"].jumlah}, ayat(1b)=${s0.kata_kunci["Pasal 64 ayat (1b)"].jumlah} di ${s0.total_halaman} hlm`
    : s0?.catatan
);

const pojk = await tool("cari_peraturan", { keywords: "syariah", jenis: "80", limit: 3 });
ok(
  "POJK terjangkau lewat JDIH BPK (jenis=80)",
  (pojk.hasil?.length || 0) > 0 && pojk.hasil.every((h) => /OJK/i.test(h.jenis || "")),
  pojk.hasil?.[0]?.judul?.slice(0, 55)
);

const pbi = await tool("cari_peraturan", { keywords: "syariah", jenis: "78", limit: 2 });
ok("PBI terjangkau lewat JDIH BPK (jenis=78)", (pbi.hasil?.length || 0) > 0, pbi.hasil?.[0]?.judul?.slice(0, 55));

const katHadis = await tool("daftar_kategori_hadis", {});
const fikih = katHadis.kategori?.find((k) => k.id === "4");
ok("daftar_kategori_hadis", Boolean(fikih), fikih ? `${fikih.judul} — ${fikih.jumlah_hadis} hadis` : katHadis.error);

const hadisRiba = await tool("cari_hadis_berderajat", { query: "riba", limit: 3 });
const semuaRiba = (hadisRiba.hasil || []).every((h) => /riba/i.test(h.judul || ""));
ok(
  "cari_hadis_berderajat mencocokkan kata utuh",
  (hadisRiba.hasil?.length || 0) > 0 && semuaRiba,
  hadisRiba.hasil?.map((h) => h.derajat).join(", ")
);

ok(
  "hadis membawa derajat dan takhrij",
  Boolean(hadisRiba.hasil?.[0]?.derajat && hadisRiba.hasil?.[0]?.takhrij && hadisRiba.hasil?.[0]?.arab),
  `${hadisRiba.hasil?.[0]?.derajat} — ${hadisRiba.hasil?.[0]?.takhrij}`
);

const pedoman = await tool("cari_produk_dsn", { jenis: "pedoman-implementasi", limit: 4 });
ok(
  "cari_produk_dsn (pedoman implementasi)",
  (pedoman.hasil?.length || 0) > 0 && pedoman.hasil.every((d) => /DSN/i.test(d.nomor || "")),
  `${pedoman.total_terindeks} terindeks — ${pedoman.hasil?.[0]?.nomor}`
);

const talimat = await tool("cari_produk_dsn", { jenis: "talimat", limit: 3 });
ok(
  "cari_produk_dsn (talimat)",
  (talimat.hasil?.length || 0) > 0 && talimat.hasil.every((d) => Boolean(d.url_pdf)),
  `${talimat.total_terindeks} terindeks — ${talimat.hasil?.[0]?.nomor}`
);

const turats = await tool("cari_turats", { query: "الخراج بالضمان", limit: 3 });
const lengkap = (turats.hasil || []).every((h) => h.kitab && h.penulis && h.cuplikan);
ok(
  "cari_turats mengembalikan kitab, penulis, dan cuplikan",
  (turats.hasil?.length || 0) > 0 && lengkap,
  `${turats.total_temuan} temuan — ${turats.hasil?.[0]?.kitab?.slice(0, 40)}`
);

ok(
  "cari_turats membatasi panjang kutipan",
  (turats.hasil || []).every((h) => (h.cuplikan || "").length <= 620),
  `terpanjang ${Math.max(...(turats.hasil || []).map((h) => (h.cuplikan || "").length))} karakter`
);

ok(
  "cari_turats membawa pagar pemakaian",
  (turats.peringatan || []).length >= 2 && /bukan sumber hukum positif/i.test((turats.peringatan || []).join(" ")),
  `${turats.peringatan?.length} peringatan`
);

const kons = await tool("konsolidasi_peraturan", {
  peraturan: "UU 12/2011",
  pasal: "176.",
  frasa_alternatif: ["tafsir resmi"],
  konteks: 400,
});
const disentuh = (kons.diubah_oleh || []).filter((p) => p.menyentuh_pasal_ini).map((p) => p.oleh);
ok(
  "konsolidasi_peraturan menemukan perubahan butir 176 oleh UU 13/2022",
  disentuh.some((x) => /13 Tahun 2022/.test(x)),
  `rantai: ${kons.rantai_sitasi}`
);

const konsAngka = await tool("konsolidasi_peraturan", { peraturan: "UU 12/2011", pasal: "999." });
ok(
  "konsolidasi_peraturan memperingatkan kerapuhan pencarian angka",
  (konsAngka.peringatan || []).some((p) => /paling rapuh/.test(p)),
  "peringatan digit rusak muncul"
);

const draf = `Hukum acara pidana diatur dalam UU 8/1981 yang masih berlaku sampai sekarang.
UU 27/2022 Pasal 46 mewajibkan pemberitahuan paling lambat 3 x 24 jam kepada subjek data.
Lihat pula Putusan 93/PUU-X/2012 dan fatwa 17/DSN-MUI/IX/2000.`;

const ver = await tool("verifikasi_kutipan", { teks: draf });
const uu8 = (ver.hasil || []).find((h) => /8\/1981/.test(h.tertulis || ""));
const uu27 = (ver.hasil || []).find((h) => /27\/2022/.test(h.tertulis || ""));
ok(
  "verifikasi_kutipan menandai klaim berlaku yang salah",
  uu8?.status_verifikasi === "bermasalah" && /Tidak Berlaku/i.test(uu8?.status_peraturan || ""),
  uu8?.catatan?.[0]?.slice(0, 70)
);
ok(
  "verifikasi_kutipan meloloskan sitasi yang benar",
  uu27?.status_verifikasi === "terverifikasi" && uu27?.pasal_ditemukan === true,
  `${uu27?.pasal_disebut} ditemukan, frasa "${uu27?.frasa_diuji}" -> ${uu27?.frasa_ditemukan}`
);
ok(
  "verifikasi_kutipan tidak salah melekatkan pasal",
  uu8?.pasal_disebut == null,
  "Pasal 46 tidak dilekatkan ke UU 8/1981"
);
ok(
  "verifikasi_kutipan memverifikasi putusan MK dan fatwa",
  (ver.hasil || []).filter((h) => h.status_verifikasi === "terverifikasi" && /mk|fatwa/.test(h.jenis)).length === 2,
  `ringkasan: ${JSON.stringify(ver.ringkasan)}`
);

const sebelum = await tool("hukum_pada_tanggal", { peraturan: "UU 8/1981", tanggal: "1 Januari 2025" });
const sesudah = await tool("hukum_pada_tanggal", { peraturan: "UU 8/1981", tanggal: "1 Maret 2026" });
ok(
  "hukum_pada_tanggal membedakan sebelum dan sesudah pencabutan",
  sebelum.simpulan === "berlaku_pada_tanggal_itu" && sesudah.simpulan === "sudah_dicabut_pada_tanggal_itu",
  `${sebelum.simpulan} vs ${sesudah.simpulan}`
);

const belum = await tool("hukum_pada_tanggal", { peraturan: "UU 27/2022", tanggal: "1 Januari 2022" });
ok("hukum_pada_tanggal mengenali peraturan yang belum berlaku", belum.simpulan === "belum_berlaku", belum.simpulan);

const akadUji = await tool("daftar_periksa_akad", { akad: "murabahah", nomor_fatwa: "111" });
ok(
  "daftar_periksa_akad menyusun butir ketentuan",
  akadUji.jumlah_butir >= 5 && akadUji.daftar_periksa.every((b) => b.penilaian === "belum_dinilai"),
  `${akadUji.jumlah_butir} butir dari ${akadUji.fatwa_utama?.nomor}`
);
ok(
  "daftar_periksa_akad menolak memutuskan sendiri",
  (akadUji.peringatan || []).some((p) => /BUKAN fatwa/.test(p)),
  "batas kewenangan dinyatakan"
);

const sehat = await tool("periksa_kesehatan_sumber", { hanya_penting: true });
ok(
  "periksa_kesehatan_sumber memeriksa sumber inti",
  (sehat.hasil?.length || 0) >= 3 && sehat.hasil.every((h) => h.status && h.bukti),
  `${JSON.stringify(sehat.ringkasan)}`
);
ok(
  "periksa_kesehatan_sumber melewati cache secara bawaan",
  sehat.memakai_cache === false,
  "menembak sumber sungguhan, bukan cache"
);

// Regresi: sitasi Indonesia lazim menulis pasal SEBELUM rujukan.
// Penelusuran satu arah dulu melewatkannya diam-diam, sehingga "Pasal 9999"
// yang tidak ada pun dilaporkan terverifikasi.
const gayaLazim = await tool("verifikasi_kutipan", {
  teks: "Kewenangan itu diatur dalam Pasal 49 huruf i UU 3/2006 tentang Peradilan Agama.",
  maks_rujukan: 2,
});
ok(
  "verifikasi_kutipan memeriksa pasal yang ditulis sebelum rujukan",
  gayaLazim.hasil?.[0]?.pasal_disebut === "Pasal 49" && gayaLazim.hasil[0].pasal_ditemukan === true,
  `${gayaLazim.hasil?.[0]?.pasal_disebut} ditemukan=${gayaLazim.hasil?.[0]?.pasal_ditemukan}`
);

const pasalPalsu = await tool("verifikasi_kutipan", {
  teks: "Pasal 9999 UU 27/2022 mengatur hal itu.",
  maks_rujukan: 2,
});
ok(
  "verifikasi_kutipan menandai pasal yang tidak ada",
  pasalPalsu.hasil?.[0]?.status_verifikasi === "bermasalah" && pasalPalsu.hasil[0].pasal_ditemukan === false,
  pasalPalsu.hasil?.[0]?.catatan?.find((c) => /tidak ditemukan/.test(c))?.slice(0, 60)
);

const tanpaSitasi = await tool("verifikasi_kutipan", { teks: "Tulisan biasa tanpa rujukan hukum apa pun." });
ok(
  "verifikasi_kutipan jujur ketika tidak ada rujukan dikenali",
  tanpaSitasi.jumlah_rujukan_terdeteksi === 0 &&
    (tanpaSitasi.peringatan || []).some((p) => /tidak ada rujukan yang dikenali/i.test(p)),
  "menyatakan nihil, bukan diam"
);

// Regresi: JDIH MA mencocokkan teks judul secara harfiah dan tidak konsisten
// menulis nomor ("PERMA NOMOR 2" tetapi "SEMA NO. 02"), sehingga rujukan
// singkat dulu selalu nihil padahal dokumennya ada.
const permaSingkat = await tool("cari_perma", { query: "PERMA 2/2008", limit: 2 });
ok(
  "cari_perma menerima rujukan singkat",
  permaSingkat.jumlah_ditampilkan > 0 && /PERMA NOMOR 2 TAHUN 2008/i.test(permaSingkat.hasil[0].judul),
  `via "${permaSingkat.kueri_dipakai}"`
);

const semaSingkat = await tool("cari_perma", { query: "SEMA 2/1994", limit: 2 });
ok(
  "cari_perma mencoba varian penulisan nomor",
  semaSingkat.jumlah_ditampilkan > 0 && /SEMA NO\. 02/i.test(semaSingkat.hasil[0].judul),
  `via "${semaSingkat.kueri_dipakai}"`
);

const permaAlur = await tool("periksa_pasal", { peraturan: "PERMA 14/2016", pasal: "Pasal 1" });
ok(
  "periksa_pasal mengalihkan PERMA ke JDIH MA dan menemukan pasalnya",
  permaAlur.sumber === "JDIH Mahkamah Agung RI" && (permaAlur.pasal?.halaman?.length || 0) > 0,
  `${permaAlur.peraturan?.judul} — hlm ${JSON.stringify(permaAlur.pasal?.halaman)}`
);

// Regresi: alamat internal harus ditolak, bukan sekadar gagal kebetulan.
const internal = await tool("cari_dalam_pdf", { url_pdf: "http://127.0.0.1:8080/x.pdf", kata_kunci: "a" });
ok(
  "permintaan ke alamat internal ditolak",
  Boolean(internal.error) && /alamat internal/i.test(internal.error),
  "pagar SSRF aktif"
);

// KHES: naskahnya tidak ikut disebarkan bersama perangkat ini, jadi uji ini
// harus benar pada dua keadaan — sudah diimpor maupun belum.
const khesStatus = await tool("cari_pasal_khes", {});
if (khesStatus.tersedia) {
  ok(
    "cari_pasal_khes melaporkan naskah yang sudah diimpor",
    khesStatus.jumlah_pasal_terdeteksi > 700 && khesStatus.total_halaman > 200,
    `${khesStatus.jumlah_pasal_terdeteksi} pasal, ${khesStatus.total_halaman} hlm, rentang ${khesStatus.rentang_pasal}`
  );

  const p20 = await tool("cari_pasal_khes", { pasal: "20", maks_temuan: 1 });
  ok(
    "Pasal 20 KHES terbaca dan dipetakan ke Buku II",
    p20.buku?.buku === "II" && /Akad adalah kesepakatan/i.test(p20.temuan?.[0]?.cuplikan || ""),
    `Buku ${p20.buku?.buku} — hlm ${JSON.stringify(p20.halaman)}`
  );

  const p728 = await tool("cari_pasal_khes", { pasal: "728", maks_temuan: 1 });
  ok(
    "batas Buku IV terverifikasi pada Pasal 728",
    p728.buku?.buku === "IV" && /[Aa]kuntansi syari/i.test(p728.temuan?.[0]?.cuplikan || ""),
    `Buku ${p728.buku?.buku} — pembuka akuntansi syariah`
  );

  const pTiada = await tool("cari_pasal_khes", { pasal: "9999" });
  ok(
    "pasal di luar rentang dilaporkan tidak ditemukan",
    pTiada.ditemukan === false,
    pTiada.catatan?.slice(0, 58)
  );
} else {
  ok(
    "cari_pasal_khes menolak dengan jujur saat naskah belum diimpor",
    Boolean(khesStatus.cara_melengkapi) && (khesStatus.peringatan || []).some((p) => /JANGAN/.test(p)),
    "menolak + memberi cara melengkapi"
  );
}

p.kill();
if (gagal > 0) process.exitCode = 1;
