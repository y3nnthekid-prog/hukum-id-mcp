type Timed = { diambil_pada?: unknown; dari_cache?: unknown } | null | undefined;

/**
 * Waktu ambil dan status verifikasi yang jujur untuk sebuah kutipan.
 *
 * "verified_live" hanya dipakai bila sumbernya terbukti baru saja diambil dari situs resmi.
 * Teks dari cache, atau yang asal-usul waktunya tidak diketahui, selalu "verified_snapshot"
 * dengan waktu ambil aslinya, supaya pembaca tahu salinan itu setua apa.
 */
export function provenanceTiming(source: Timed, now = new Date()) {
  const raw = typeof source?.diambil_pada === "string" ? source.diambil_pada : "";
  const parsed = raw ? new Date(raw) : null;
  const known = parsed !== null && !Number.isNaN(parsed.getTime());
  return {
    retrievedAt: (known ? parsed : now).toISOString(),
    verificationStatus: known && source?.dari_cache === false ? ("verified_live" as const) : ("verified_snapshot" as const),
  };
}
