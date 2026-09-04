// Sumber: JDIH BPK (peraturan.bpk.go.id) — basis data peraturan paling lengkap
// dan paling konsisten memuat STATUS (berlaku/dicabut/diubah) serta relasi
// antarperaturan dan tautan putusan uji materi.

import { getText, toText, inline, decodeEntities } from "./http.js";

const BASE = "https://peraturan.bpk.go.id";

function parseSlug(slug = "") {
  const m = slug.match(/^(.+?)-no-(.+?)-tahun-(\d{4})$/i);
  if (!m) return {};
  return { jenis: m[1].replace(/-/g, " ").toUpperCase(), nomor: m[2], tahun: m[3] };
}

/** Ambil blok relasi ("Mencabut", "Diubah dengan", "Dicabut dengan", ...). */
function parseRelasi(html, maksPerLabel = 30) {
  const out = {};
  const labelRe = /<div class="[^"]*bg-light-[a-z]+[^"]*"[^>]*>\s*([^<>{}]{3,60}?)\s*:?\s*<\/div>/g;
  const marks = [];
  let m;
  while ((m = labelRe.exec(html))) marks.push({ label: inline(m[1]), from: m.index + m[0].length });

  for (let i = 0; i < marks.length; i++) {
    const blok = html.slice(marks[i].from, i + 1 < marks.length ? marks[i + 1].from : marks[i].from + 40000);
    const items = [];
    let total = 0;
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(blok))) {
      const a = li[1].match(/<a[^>]*href="(\/Details\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      if (!a) continue;
      total++;
      if (items.length >= maksPerLabel) continue;
      const sisa = li[1].slice(li[1].indexOf(a[0]) + a[0].length);
      const catatanM = sisa.match(/<br\s*\/?>\s*<span[^>]*>([\s\S]*?)<\/span>/);
      const tentang = inline(sisa.replace(/<br[\s\S]*$/, "")).replace(/^tentang\s+/i, "");
      items.push({
        id: a[2],
        peraturan: inline(a[3]),
        tentang: tentang || null,
        catatan: catatanM ? inline(catatanM[1]) || null : null,
        url: BASE + decodeEntities(a[1]),
      });
    }
    if (items.length) out[marks[i].label] = total > items.length ? { total, ditampilkan: items } : items;
  }
  return out;
}

export async function cariPeraturan({
  keywords = "",
  tentang = "",
  nomor = "",
  jenis = "",
  entitas = "",
  tahun = "",
  halaman = 1,
  limit = 10,
} = {}) {
  const qs = new URLSearchParams({ keywords, tentang, nomor, jenis, entitas });
  if (tahun) qs.set("tahun", String(tahun));
  if (Number(halaman) > 1) qs.set("p", String(halaman));
  const url = `${BASE}/Search?${qs.toString()}`;
  const html = await getText(url);

  const hasil = [];
  const re =
    /<div class="col-lg-10 fs-2 fw-bold pe-4">\s*<a href="(\/Details\/(\d+)\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && hasil.length < limit) {
    const before = html.slice(Math.max(0, m.index - 2500), m.index);
    const statusM = [...before.matchAll(/<span class="text-muted">([\s\S]*?)<\/span>/g)].pop();
    const after = html.slice(m.index, m.index + 2500);
    const subjekM = after.match(/<span class="badge badge-light-primary[^"]*">([\s\S]*?)<\/span>/);
    hasil.push({
      id: m[2],
      judul: inline(m[4]),
      ...parseSlug(m[3]),
      status: statusM ? inline(statusM[1]).replace(/^[•\s]+/, "") : null,
      subjek: subjekM ? inline(subjekM[1]) : null,
      url: BASE + decodeEntities(m[1]),
    });
  }

  const pages = [...html.matchAll(/[?&]p=(\d+)/g)].map((x) => Number(x[1]));
  return {
    sumber: "JDIH BPK RI",
    url_pencarian: url,
    halaman: Number(halaman),
    total_halaman: pages.length ? Math.max(...pages) : 1,
    jumlah_ditampilkan: hasil.length,
    hasil,
  };
}

export async function detailPeraturan(ref) {
  const url = /^https?:/i.test(ref)
    ? ref
    : /^\d+$/.test(String(ref).trim())
      ? `${BASE}/Details/${String(ref).trim()}`
      : `${BASE}${String(ref).startsWith("/") ? "" : "/"}${ref}`;

  const html = await getText(url);

  const meta = {};
  const mre =
    /<div class="col-lg-3 fw-bold">\s*([\s\S]*?)\s*<\/div>\s*<div class="col-lg-9[^"]*">\s*([\s\S]*?)\s*<\/div>/g;
  let m;
  while ((m = mre.exec(html))) {
    const k = inline(m[1]);
    const v = inline(m[2]);
    if (k) meta[k] = v || null;
  }

  const abstrak = [];
  const catatan = [];
  const secRe = /<td valign="top">\s*(ABSTRAK|CATATAN):?\s*<\/td>\s*<td>([\s\S]*?)<\/td>/gi;
  while ((m = secRe.exec(html))) {
    const items = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)(?:<\/li>|(?=<li)|$)/g)].map((x) => inline(x[1]));
    (m[1].toUpperCase() === "ABSTRAK" ? abstrak : catatan).push(...items.filter(Boolean));
  }

  const files = [];
  const fre = /data-label="([^"]*)"\s*data-kategori="([^"]*)"[\s\S]{0,300}?href="(\/Download[^"]+)"/g;
  while ((m = fre.exec(html))) {
    files.push({ label: decodeEntities(m[1]), kategori: m[2], url: BASE + decodeEntities(m[3]) });
  }
  const dre = /href="(\/Download(?:UjiMateri)?\/[^"]+\.pdf)"/gi;
  while ((m = dre.exec(html))) {
    const u = BASE + decodeEntities(m[1]);
    if (!files.some((f) => f.url === u)) {
      files.push({
        label: decodeURIComponent(m[1].split("/").pop()),
        kategori: /UjiMateri/i.test(m[1]) ? "UjiMateri" : "Peraturan",
        url: u,
      });
    }
  }

  const ujiMateri = [];
  const ure = /PUTUSAN Nomor\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = ure.exec(html))) {
    ujiMateri.push({ nomor: inline(m[2]), url: BASE + decodeEntities(m[1]) });
  }

  return {
    sumber: "JDIH BPK RI",
    url,
    judul: meta["Judul"] || meta["Tipe Dokumen"] || null,
    status: meta["Status"] || null,
    metadata: meta,
    abstrak,
    catatan,
    relasi_status: parseRelasi(html),
    uji_materi: ujiMateri,
    berkas: files,
  };
}

/** Unduh PDF peraturan dan ekstrak teksnya (opsional: rentang halaman / cari kata). */
export async function teksPeraturan(args) {
  const { ekstrakTeksPdf } = await import("./pdf.js");
  return ekstrakTeksPdf(args);
}
