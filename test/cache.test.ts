import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import { cacheDirectory } from "../src/cache.js";

test("cache can live outside the installed package and survives package upgrades", () => {
  const previous = process.env.HUKUM_CACHE_DIR;
  try {
    process.env.HUKUM_CACHE_DIR = path.join(process.cwd(), "local-cache-fixture");
    assert.equal(cacheDirectory(), path.resolve("local-cache-fixture"));
  } finally {
    if (previous === undefined) delete process.env.HUKUM_CACHE_DIR;
    else process.env.HUKUM_CACHE_DIR = previous;
  }
});

test("frozen snapshot mode serves entries of any age and offline mode never touches the network", async () => {
  const { mkdtemp, utimes } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "hukum-beku-"));
  process.env.HUKUM_CACHE_DIR = dir;
  const cache = await import(`../src/cache.js?beku=${Date.now()}`);
  await cache.simpanJson("kunci-lama", { isi: 1 });
  const { createHash } = await import("node:crypto");
  const file = path.join(dir, createHash("sha1").update("kunci-lama").digest("hex") + ".json");
  const old = new Date("2025-01-01T00:00:00Z");
  await utimes(file, old, old);

  delete process.env.HUKUM_CACHE_BEKU;
  assert.equal(await cache.ambilJson("kunci-lama", 1000), null);
  process.env.HUKUM_CACHE_BEKU = "1";
  assert.deepEqual(await cache.ambilJson("kunci-lama", 1000), { isi: 1 });
  delete process.env.HUKUM_CACHE_BEKU;

  process.env.HUKUM_LURING = "1";
  const { getText } = await import("../src/http.js");
  await assert.rejects(() => getText("https://peraturan.bpk.go.id/Details/999999999", { retries: 0 }), /LURING/);
  delete process.env.HUKUM_LURING;
});
