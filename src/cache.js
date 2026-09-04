// Cache berkas di disk. Alasannya sederhana: dokumen hukum resmi yang sudah
// diundangkan tidak berubah. Mengunduh PDF undang-undang yang sama berkali-kali
// hanya membuang waktu dan menghabiskan jatah permintaan ke situs sumber
// (situs MK sempat menolak dengan 403 karena permintaan beruntun).

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export function cacheDirectory() {
  const configured = process.env.HUKUM_CACHE_DIR?.trim();
  if (configured) return path.resolve(configured);
  const base = process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
  return path.join(base, "hukum-id-mcp");
}

const DIR = cacheDirectory();

const HARI = 24 * 60 * 60 * 1000;

/** Umur simpan ditentukan seberapa mungkin isinya berubah. */
export function umurSimpan(url) {
  if (/\.pdf(\?|$)/i.test(url) || /\/Download\//i.test(url) || /putusan\/download\//i.test(url))
    return 60 * HARI; // salinan resmi yang sudah diundangkan/diucapkan: praktis abadi
  if (/drive\.google\.com/i.test(url)) return 60 * HARI; // salinan fatwa
  if (/\/Details\//i.test(url)) return 7 * HARI; // metadata & status peraturan
  if (/direktori\/putusan\//i.test(url)) return 30 * HARI; // detail putusan MA
  if (/\/Search|\/search|\?search=|\/dokumen\?|api\.openalex/i.test(url)) return 1 * HARI; // hasil pencarian
  return 1 * HARI;
}

function berkas(kunci, ext) {
  return path.join(DIR, createHash("sha1").update(kunci).digest("hex") + ext);
}

export async function ambil(kunci, ttlMs) {
  const p = berkas(kunci, ".bin");
  try {
    const st = await stat(p);
    if (Date.now() - st.mtimeMs > ttlMs) return null;
    return await readFile(p);
  } catch {
    return null;
  }
}

export async function simpan(kunci, buffer) {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(berkas(kunci, ".bin"), buffer);
  } catch {
    // cache gagal tidak boleh menggagalkan permintaan
  }
}

export async function ambilJson(kunci, ttlMs) {
  const p = berkas(kunci, ".json");
  try {
    const st = await stat(p);
    if (Date.now() - st.mtimeMs > ttlMs) return null;
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

export async function simpanJson(kunci, data) {
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(berkas(kunci, ".json"), JSON.stringify(data), "utf8");
  } catch {}
}
