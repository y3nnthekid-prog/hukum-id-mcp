import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { ambil, simpan, umurSimpan } from "./cache.js";

const execFileP = promisify(execFile);

// Lapisan HTTP bersama: header ala browser (beberapa situs JDIH/pengadilan
// menolak permintaan tanpa header navigasi), jeda sopan per host, dan retry.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MIN_GAP_MS = 900;
// Direktori Putusan MA membatasi permintaan beruntun lebih ketat.
const GAP_PER_HOST = {
  "putusan3.mahkamahagung.go.id": 2600,
  "www.mkri.id": 1800,
  "jdih.mahkamahagung.go.id": 1500,
};
const lastHit = new Map();

// Pemutus arus. Situs sumber yang sedang membatasi (403/429) akan menolak semua
// percobaan berikutnya, sehingga retry berulang hanya menyandera seluruh alur
// selama belasan detik. Setelah dua penolakan beruntun, host itu dilewati cepat
// selama satu menit dan pemanggil diberi tahu alasannya.
const HENTI_MS = 60000;
const putus = new Map();

function periksaPutus(host) {
  const p = putus.get(host);
  if (p && Date.now() < p.sampai) {
    const sisa = Math.ceil((p.sampai - Date.now()) / 1000);
    throw new Error(
      `${host} sedang membatasi akses otomatis (ditolak ${p.jumlah} kali beruntun). ` +
        `Dilewati selama ${sisa} detik lagi agar alur lain tidak ikut tertahan. ` +
        `Data dari cache tetap dilayani.`
    );
  }
}

function catatGagal(host) {
  const p = putus.get(host) || { jumlah: 0, sampai: 0 };
  p.jumlah += 1;
  if (p.jumlah >= 2) p.sampai = Date.now() + HENTI_MS;
  putus.set(host, p);
}

function catatSukses(host) {
  putus.delete(host);
}

async function politeGap(host) {
  const prev = lastHit.get(host) || 0;
  const wait = prev + (GAP_PER_HOST[host] || MIN_GAP_MS) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

function headers(referer) {
  const h = {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) h.Referer = referer;
  return h;
}

const CURL_ONLY = new Set(["putusan3.mahkamahagung.go.id"]);

// Pemeriksaan kesehatan harus menembak sumber sungguhan, bukan dilayani cache.
// Tanpa saklar ini, hasilnya selalu terlihat sehat meski situsnya sudah berubah.
let lewatiCacheGlobal = false;
export function paksaLewatiCache(nyala) {
  lewatiCacheGlobal = Boolean(nyala);
}

function curlArgs(url, referer, timeout, outFile) {
  const h = headers(referer);
  const args = ["-sS", "-L", "--compressed", "--max-time", String(Math.ceil(timeout / 1000)),
    "-o", outFile, "-w", "%{http_code}"];
  for (const [k, v] of Object.entries(h)) {
    if (k === "User-Agent") args.push("-A", v);
    else args.push("-H", `${k}: ${v}`);
  }
  args.push(url);
  return args;
}

/**
 * Sebagian situs (Cloudflare) menolak sidik jari TLS milik Node fetch tetapi
 * menerima curl. Karena itu curl dipakai sebagai transport cadangan — dan
 * transport utama untuk host yang sudah diketahui rewel.
 */
async function viaCurl(url, referer, timeout) {
  const outFile = path.join(os.tmpdir(), `hukum-id-${randomUUID()}.bin`);
  try {
    const { stdout } = await execFileP("curl", curlArgs(url, referer, timeout, outFile), {
      timeout: timeout + 5000,
      windowsHide: true,
    });
    const status = Number(String(stdout).trim().slice(-3));
    const buffer = await readFile(outFile).catch(() => Buffer.alloc(0));
    return { status, buffer };
  } finally {
    unlink(outFile).catch(() => {});
  }
}

async function viaFetch(url, referer, timeout) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { headers: headers(referer), signal: ac.signal, redirect: "follow" });
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  } finally {
    clearTimeout(timer);
  }
}

async function request(url, { referer, timeout = 45000, retries = 2, lewati_cache = false } = {}) {
  const host = new URL(url).host;

  if (!lewati_cache && !lewatiCacheGlobal) {
    const tersimpan = await ambil(url, umurSimpan(url));
    if (tersimpan) return { status: 200, buffer: tersimpan, dari_cache: true };
  }

  periksaPutus(host);

  const transports = CURL_ONLY.has(host) ? [viaCurl] : [viaFetch, viaCurl];
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const t of transports) {
      await politeGap(host);
      try {
        const r = await t(url, referer, timeout);
        if (r.status >= 200 && r.status < 300 && r.buffer.length) {
          await simpan(url, r.buffer);
          catatSukses(host);
          return r;
        }
        lastErr = new Error(`HTTP ${r.status} dari ${host}`);
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }

  // Baru dihitung setelah seluruh percobaan untuk satu permintaan habis,
  // supaya satu galat sesaat tidak langsung mengunci host.
  catatGagal(host);
  throw new Error(
    `Gagal mengambil ${url}: ${lastErr?.message || "tidak diketahui"}. ` +
      `Situs sumber kadang membatasi akses otomatis — coba lagi sebentar, atau buka URL-nya langsung.`
  );
}

export async function getText(url, opts) {
  return (await request(url, opts)).buffer.toString("utf8");
}

export async function getJson(url, opts) {
  return JSON.parse((await request(url, opts)).buffer.toString("utf8"));
}

export async function getBuffer(url, opts) {
  return (await request(url, opts)).buffer;
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", bull: "•", middot: "·",
};

export function decodeEntities(s = "") {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** HTML -> teks bersih, mempertahankan batas baris antar blok. */
export function toText(html = "") {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|td)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** Teks satu baris (untuk judul, label, dsb). */
export function inline(html = "") {
  return toText(html).replace(/\s*\n\s*/g, " ").trim();
}
