import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createApiApp } from "../src/api/app.js";
import { HUKUM_ID_VERSION } from "../src/version.js";
import { CHANNEL_FIXTURE_SERVICE } from "./fixtures/fixture-legal-service.js";

test("package, Web, OpenAPI and runtime report one release version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const webPackageJson = JSON.parse(await readFile("web/package.json", "utf8"));
  const openapi = await readFile("openapi.yaml", "utf8");
  const response = await createApiApp({ service: CHANNEL_FIXTURE_SERVICE }).request("/health");
  const health = await response.json();

  assert.equal(packageJson.version, HUKUM_ID_VERSION);
  assert.equal(webPackageJson.version, HUKUM_ID_VERSION);
  assert.match(openapi, new RegExp(`^  version: ${HUKUM_ID_VERSION.replaceAll(".", "\\.")}$`, "m"));
  assert.equal(health.version, HUKUM_ID_VERSION);
});
