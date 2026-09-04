import assert from "node:assert/strict";
import test from "node:test";

import { ApiClientError, searchLegalSources } from "../web/src/lib/api.js";

test("web search client serializes filters and returns the API envelope", async () => {
  let requested = "";
  const fakeFetch: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        data: { query: "murabahah", documents: [], sourceStatus: {}, warnings: [], nextCursor: null },
        meta: { traceId: "trace-1", nextCursor: null },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await searchLegalSources(
    { query: "akad murabahah", sources: ["regulation", "fatwa"], pageSize: 12 },
    { baseUrl: "https://api.example.test", fetch: fakeFetch }
  );

  assert.match(requested, /q=akad\+murabahah/);
  assert.match(requested, /sources=regulation%2Cfatwa/);
  assert.match(requested, /pageSize=12/);
  assert.equal(result.meta.traceId, "trace-1");
});

test("web search client preserves safe API error details", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { code: "RATE_LIMITED", message: "Coba lagi nanti.", traceId: "trace-2" } }),
      { status: 429, headers: { "content-type": "application/json" } }
    );

  await assert.rejects(
    () => searchLegalSources({ query: "wakaf" }, { baseUrl: "https://api.example.test", fetch: fakeFetch }),
    (error: unknown) =>
      error instanceof ApiClientError && error.code === "RATE_LIMITED" && error.traceId === "trace-2"
  );
});
