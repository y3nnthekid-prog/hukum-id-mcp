import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  materializeActiveIndex,
  publishIndexRelease,
  type IndexReleaseReader,
  type IndexReleaseStore,
} from "../src/indexing/releases.js";

const lexical = Buffer.from("sqlite-fts5-fixture");
const semantic = Buffer.from("hnsw-fixture");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function manifest() {
  return {
    schemaVersion: 1 as const,
    releaseId: "2026-09-05T010000Z-a1b2c3d4",
    corpusVersion: "2026-09-05",
    builtAt: "2026-09-05T01:00:00.000Z",
    connectors: {
      "jdih-bpk": { status: "ok" as const, fetchedAt: "2026-09-05T00:40:00.000Z", documentCount: 100 },
      "dsn-mui": { status: "ok" as const, fetchedAt: "2026-09-05T00:45:00.000Z", documentCount: 50 },
    },
    failedSources: [],
    files: [
      { name: "lexical.sqlite", sha256: sha256(lexical), sizeBytes: lexical.length },
      { name: "semantic.hnsw", sha256: sha256(semantic), sizeBytes: semantic.length },
    ],
  };
}

function memoryStore() {
  const writes: string[] = [];
  let active: { releaseId: string; manifestPath: string } | null = null;
  const store: IndexReleaseStore = {
    putImmutable: async (path) => void writes.push(path),
    readActive: async () => ({ value: active, etag: active ? "etag-1" : null }),
    compareAndSwapActive: async (value) => { active = value; writes.push("active.json"); },
  };
  return { store, writes, get active() { return active; } };
}

test("a healthy complete snapshot publishes immutable files then switches active pointer", async () => {
  const memory = memoryStore();
  await publishIndexRelease({
    store: memory.store,
    manifest: manifest(),
    files: new Map([["lexical.sqlite", lexical], ["semantic.hnsw", semantic]]),
  });

  assert.deepEqual(memory.writes, [
    "releases/2026-09-05T010000Z-a1b2c3d4/lexical.sqlite",
    "releases/2026-09-05T010000Z-a1b2c3d4/semantic.hnsw",
    "releases/2026-09-05T010000Z-a1b2c3d4/manifest.json",
    "active.json",
  ]);
  assert.equal(memory.active?.releaseId, "2026-09-05T010000Z-a1b2c3d4");
});

test("partial connector failure cannot replace the active release", async () => {
  const memory = memoryStore();
  const invalid = manifest();
  invalid.connectors["dsn-mui"] = { status: "failed" as never, fetchedAt: "2026-09-05T00:45:00.000Z", documentCount: 0 };
  invalid.failedSources.push("dsn-mui");

  await assert.rejects(
    () => publishIndexRelease({ store: memory.store, manifest: invalid, files: new Map() }),
    /tidak lengkap/i
  );
  assert.deepEqual(memory.writes, []);
  assert.equal(memory.active, null);
});

test("checksum mismatch is rejected before any upload", async () => {
  const memory = memoryStore();
  await assert.rejects(
    () => publishIndexRelease({
      store: memory.store,
      manifest: manifest(),
      files: new Map([["lexical.sqlite", Buffer.from("corrupt")], ["semantic.hnsw", semantic]]),
    }),
    /checksum/i
  );
  assert.deepEqual(memory.writes, []);
});

test("startup materialization exposes a release only after every downloaded file verifies", async () => {
  const root = await mkdtemp(join(tmpdir(), "hukumid-index-"));
  const current = manifest();
  const prefix = `releases/${current.releaseId}`;
  const objects = new Map<string, Uint8Array>([
    [`${prefix}/manifest.json`, Buffer.from(JSON.stringify(current))],
    [`${prefix}/lexical.sqlite`, lexical],
    [`${prefix}/semantic.hnsw`, semantic],
  ]);
  const reader: IndexReleaseReader = {
    readActive: async () => ({
      value: { releaseId: current.releaseId, manifestPath: `${prefix}/manifest.json` },
      etag: "active-etag",
    }),
    get: async (path) => objects.get(path) ?? null,
  };

  try {
    const loaded = await materializeActiveIndex({ reader, cacheRoot: root });
    assert.equal(loaded.releaseId, current.releaseId);
    assert.deepEqual(await readFile(join(loaded.directory, "lexical.sqlite")), lexical);

    objects.set(`${prefix}/semantic.hnsw`, Buffer.from("damaged"));
    await rm(loaded.directory, { recursive: true });
    await assert.rejects(() => materializeActiveIndex({ reader, cacheRoot: root }), /checksum/i);
    await assert.rejects(() => readFile(join(loaded.directory, "semantic.hnsw")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
