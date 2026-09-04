// Sumber: Direktori Putusan Mahkamah Agung (putusan3.mahkamahagung.go.id).
// Catatan penting: pencarian teks-bebas (search.html) kini dilindungi CAPTCHA,
// jadi penelusuran dilakukan lewat indeks direktori (kategori/tahun/halaman)
// yang tetap terbuka, sementara pencarian kata kunci disarankan lewat mesin
// pencari (site:putusan3.mahkamahagung.go.id) lalu diambil detailnya di sini.

import { getText, inline, toText, decodeEntities } from "./http.js";

const BASE = "https://putusan3.mahkamahagung.go.id";

export function parseDaftar(html, limit) {
  const out = [];
  const re = /<a href="(https?:\/\/putusan3[^"]*\/direktori\/putusan\/([a-z0-9]+)\.html)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const judul = inline(m[3]);
    if (!judul || judul.length < 8) continue;
    const after = html.slice(m.index, m.index + 1800);
    const meta = {};
    for (const [, k, v] of after.matchAll(/<strong>\s*([A-Za-z ]{3,20})\s*:\s*<\/strong>\s*([^<]{2,60})/g)) {
      meta[inline(k).toLowerCase()] = inline(v).replace(/[\s—–-]+$/, "");
    }
    const tglM = after.match(/Putus\s*:\s*<\/strong>?\s*([0-9-]{8,12})/i);
    out.push({
      id: m[2],
      judul,
      tanggal_putus: meta["putus"] || (tglM ? tglM[1] : null),
      tanggal_register: meta["register"] || null,
      url: decodeEntities(m[1]),
    });
  }
  return out;
}

/**
 * Telusuri direktori putusan berdasarkan kategori (mis. "korupsi-1",
 * "pidana-khusus-1", "perdata-1"), opsional disaring per tahun.
 */
export async function telusuriPutusan({ kategori = "korupsi-1", tahun = "", jenis_tahun = "putus", halaman = 1, limit = 15 } = {}) {
  let path = `/direktori/index/kategori/${encodeURIComponent(kategori)}`;
  if (tahun) path += `/tahunjenis/${jenis_tahun}/tahun/${tahun}`;
  if (Number(halaman) > 1) path += `/page/${halaman}`;
  const url = `${BASE}${path}.html`;
  const html = await getText(url, { referer: `${BASE}/direktori.html` });
  const pages = [...html.matchAll(/\/page\/(\d+)\.html/g)].map((x) => Number(x[1]));
  return {
    sumber: "Direktori Putusan Mahkamah Agung RI",
    url_telusur: url,
    kategori,
    tahun: tahun || null,
    halaman: Number(halaman),
    total_halaman: pages.length ? Math.max(...pages) : 1,
    hasil: parseDaftar(html, limit),
  };
}

/**
 * Daftar kategori di direktori. Tanpa argumen: kategori tingkat atas.
 * Dengan `induk` (mis. "perdata-agama-1"): subkategori di bawahnya, tempat
 * kategori khusus seperti "ekonomi-syari-ah-1" berada.
 */
export async function daftarKategori({ induk = "" } = {}) {
  const url = induk
    ? `${BASE}/direktori/index/kategori/${encodeURIComponent(induk)}.html`
    : `${BASE}/direktori.html`;
  const html = await getText(url, { referer: `${BASE}/direktori.html` });
  const set = new Map();
  for (const [, slug, label] of html.matchAll(
    /href="[^"]*\/direktori\/index\/kategori\/([a-z0-9-]+)\.html"[^>]*>([\s\S]*?)<\/a>/g
  )) {
    const l = inline(label);
    if (l && slug !== induk && !set.has(slug)) set.set(slug, l);
  }
  return {
    sumber: "Direktori Putusan MA RI",
    induk: induk || "(tingkat atas)",
    kategori: [...set].map(([slug, nama]) => ({ slug, nama })),
  };
}

/** Ambil detail satu putusan dari URL atau id direktori. */
export async function detailPutusan(ref) {
  const url = /^https?:/i.test(ref) ? ref : `${BASE}/direktori/putusan/${ref}.html`;
  const html = await getText(url, { referer: `${BASE}/direktori.html` });

  const meta = {};
  for (const [, k, v] of html.matchAll(/<td[^>]*>\s*<b>\s*([^<]{2,40}?)\s*<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    meta[inline(k)] = inline(v);
  }
  if (Object.keys(meta).length < 3) {
    for (const [, k, v] of html.matchAll(/<td[^>]*>\s*([A-Z][^<]{2,40}?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
      const key = inline(k);
      if (key && !meta[key]) meta[key] = inline(v);
    }
  }

  const berkas = [];
  for (const [, href] of html.matchAll(/href="([^"]*\/(?:pdf|zip)\/[^"]+)"/gi)) {
    berkas.push(href.startsWith("http") ? decodeEntities(href) : BASE + decodeEntities(href));
  }

  const badan = toText((html.match(/<div[^>]*class="[^"]*portlet-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || [])[1] || "");

  return {
    sumber: "Direktori Putusan Mahkamah Agung RI",
    url,
    nomor: meta["Nomor"] || meta["Nomor Putusan"] || null,
    metadata: meta,
    berkas: [...new Set(berkas)],
    ringkasan_halaman: badan ? badan.slice(0, 4000) : null,
  };
}
