import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

const BULAN = new Map([
  ["januari", 1],
  ["februari", 2],
  ["maret", 3],
  ["april", 4],
  ["mei", 5],
  ["juni", 6],
  ["juli", 7],
  ["agustus", 8],
  ["september", 9],
  ["oktober", 10],
  ["november", 11],
  ["desember", 12],
]);

function nomorNormal(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text.toLowerCase();
}

/**
 * Memilih dokumen hanya bila identitasnya persis dan tunggal. Fungsi ini
 * sengaja tidak pernah memakai kandidat pertama sebagai fallback.
 */
export function selectExactCandidate(candidates = [], { nomor = "", tahun = "" } = {}) {
  const expectedNumber = nomorNormal(nomor);
  const expectedYear = String(tahun ?? "").trim();
  const exact = candidates.filter((candidate) => {
    const numberMatches = !expectedNumber || nomorNormal(candidate.nomor) === expectedNumber;
    const yearMatches = !expectedYear || String(candidate.tahun ?? "").trim() === expectedYear;
    return numberMatches && yearMatches;
  });

  if (exact.length === 1) return { status: "matched", value: exact[0], candidates: exact };
  if (exact.length > 1) return { status: "ambiguous", value: null, candidates: exact };
  return { status: "not_found", value: null, candidates };
}

/** Filter halaman PDF secara fail-closed saat kata kunci diberikan. */
export function selectPdfPages(pages = [], keyword = "") {
  const needle = String(keyword).trim().toLocaleLowerCase("id-ID");
  if (!needle) return pages;
  return pages.filter((page) => String(page.teks ?? "").toLocaleLowerCase("id-ID").includes(needle));
}

function strictUtcDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Parse format tanggal hukum Indonesia tanpa normalisasi kalender diam-diam. */
export function parseLegalDate(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return strictUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return strictUtcDate(Number(match[3]), Number(match[2]), Number(match[1]));

  match = text.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (match) {
    const month = BULAN.get(match[2]);
    return month ? strictUtcDate(Number(match[3]), month, Number(match[1])) : null;
  }

  return null;
}

function normalizedIp(address) {
  const parsed = ipaddr.parse(String(address).replace(/^\[|\]$/g, "").split("%")[0]);
  return parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed;
}

function isPublicUnicast(address) {
  try {
    const parsed = normalizedIp(address);
    if (parsed.range() === "unicast") return true;

    // RFC 6052 well-known DNS64 prefix. Beberapa jaringan mengembalikan
    // alamat publik Cloudflare dalam bentuk ini; nilai IPv4 tertanamnya tetap
    // harus lolos pemeriksaan publik yang sama.
    if (
      parsed.kind() === "ipv6" &&
      parsed.parts[0] === 0x64 &&
      parsed.parts[1] === 0xff9b &&
      parsed.parts.slice(2, 6).every((part) => part === 0)
    ) {
      const high = parsed.parts[6];
      const low = parsed.parts[7];
      const embedded = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
      return normalizedIp(embedded).range() === "unicast";
    }
    return false;
  } catch {
    return false;
  }
}

function hostAllowed(hostname, allowedHosts) {
  if (!allowedHosts) return true;
  const host = hostname.toLowerCase();
  return [...allowedHosts].some((allowed) => {
    const rule = String(allowed).toLowerCase();
    return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) : host === rule;
  });
}

/**
 * Validasi URL server-side. Semua jawaban DNS harus berupa alamat unicast
 * publik; satu jawaban privat cukup untuk menolak permintaan.
 */
export async function assertPublicUrl(rawUrl, { lookup = dnsLookup, allowedHosts } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL tidak sah: ${String(rawUrl).slice(0, 80)}`);
  }

  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`Skema ${url.protocol} tidak diizinkan; hanya http dan https.`);
  }
  if (url.username || url.password) throw new Error("URL dengan kredensial tidak diizinkan.");
  if (!hostAllowed(url.hostname, allowedHosts)) {
    throw new Error(`Host ${url.hostname} tidak termasuk sumber yang diizinkan.`);
  }

  const literal = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = ipaddr.isValid(literal)
    ? [{ address: literal }]
    : await lookup(url.hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicUnicast(address))) {
    throw new Error(
      `Permintaan ke alamat internal atau privat melalui ${url.hostname} ditolak; sumber hukum harus berada di internet publik.`
    );
  }
  return url;
}
