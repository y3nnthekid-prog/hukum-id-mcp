import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyApiRoute, createApiTelemetryAttributes } from "../src/telemetry.js";

test("telemetry memakai route template tanpa query atau document ID", () => {
  const path = "/v1/documents/UU-21-2008/timeline";
  assert.equal(classifyApiRoute(path), "/v1/documents/:id/timeline");
  assert.equal(
    classifyApiRoute("/v1/documents/UU-21-2008/articles/Pasal-1"),
    "/v1/documents/:id/articles/:article"
  );
  assert.equal(classifyApiRoute("/v1/search"), "/v1/search");
  assert.equal(classifyApiRoute("/private/question"), "unmatched");

  const attributes = createApiTelemetryAttributes("get", path, 200);
  assert.deepEqual(attributes, {
    "http.request.method": "GET",
    "http.route": "/v1/documents/:id/timeline",
    "http.response.status_code": 200,
    "http.response.status_class": "2xx",
  });
  const serialized = JSON.stringify(attributes);
  assert.doesNotMatch(serialized, /UU-21-2008|api.?key|token|question/i);
});

test("telemetry never labels unmatched paths with user input", () => {
  const secret = "rahasia-penelitian-privat";
  const attributes = createApiTelemetryAttributes("post", `/v1/${secret}`, 404);
  assert.equal(attributes["http.route"], "unmatched");
  assert.doesNotMatch(JSON.stringify(attributes), new RegExp(secret));
});
