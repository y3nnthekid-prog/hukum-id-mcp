import assert from "node:assert/strict";
import test from "node:test";

import { createEvidence } from "../src/core/contracts.js";
import { createEvidenceResolver, type EvidenceObjectStore } from "../src/storage/evidence.js";

const source = createEvidence({
  documentId: "bpk:uu-21-2008",
  text: "Kegiatan usaha berdasarkan Prinsip Syariah.",
  locator: { page: 3 },
  provenance: {
    sourceName: "JDIH BPK RI",
    sourceUrl: "https://peraturan.bpk.go.id/Details/39655/uu-no-21-tahun-2008",
    authority: "Republik Indonesia",
    retrievedAt: "2026-09-05T00:00:00.000Z",
    indexVersion: "test-1",
    verificationStatus: "verified_snapshot",
  },
});

test("evidence resolver preserves order, removes duplicate IDs and checks content integrity", async () => {
  const values = new Map<string, unknown>([
    [source.id, source],
    ["ev_000000000000000000000000", { ...source, id: "ev_000000000000000000000000" }],
  ]);
  const store: EvidenceObjectStore = { get: async (id) => values.get(id) ?? null };
  const resolve = createEvidenceResolver(store);

  const result = await resolve([source.id, source.id, "ev_000000000000000000000000"]);

  assert.deepEqual(result.map((item) => item.id), [source.id]);
});

test("evidence resolver limits fan-out before touching storage", async () => {
  let reads = 0;
  const store: EvidenceObjectStore = { get: async () => { reads += 1; return null; } };
  const resolve = createEvidenceResolver(store, { maxItems: 2 });

  await assert.rejects(() => resolve([source.id, "ev_000000000000000000000001", "ev_000000000000000000000002"]), /terlalu banyak/i);
  assert.equal(reads, 0);
});
