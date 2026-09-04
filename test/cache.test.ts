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
