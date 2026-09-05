import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { performance } from "node:perf_hooks";

import { createPlatformServer } from "../src/platform.js";
import { CHANNEL_FIXTURE_EVIDENCE, CHANNEL_FIXTURE_SERVICE } from "./fixtures/fixture-legal-service.js";

function percentile(samples: number[], value: number) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
}

function median(samples: number[]) {
  return percentile(samples, 0.5);
}

test("three waves of 50 concurrent cached requests meet median p95 budgets without egress", async () => {
  const server = createPlatformServer({
    service: CHANNEL_FIXTURE_SERVICE,
    authenticate: async (authorization) => authorization ?? null,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const nativeFetch = globalThis.fetch;
  const externalHosts = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname !== "127.0.0.1") {
      externalHosts.add(url.hostname);
      throw new Error(`LOAD_TEST_EGRESS_BLOCKED: ${url.hostname}`);
    }
    return nativeFetch(input, init);
  };

  try {
    async function runWave(
      label: string,
      wave: number,
      path: string,
      validate: (body: unknown) => boolean = () => true
    ) {
      return Promise.all(
        Array.from({ length: 50 }, async (_, index) => {
          const started = performance.now();
          const response = await fetch(`${baseUrl}${path}`, {
            headers: { authorization: `Bearer load-${label}-${wave}-${index}` },
          });
          const body = await response.json();
          return {
            failed: response.status !== 200 || !validate(body),
            durationMs: performance.now() - started,
          };
        })
      );
    }

    function report(waves: Array<Array<{ failed: boolean; durationMs: number }>>) {
      const samples = waves.flat();
      const durations = samples.map((sample) => sample.durationMs);
      const p95Runs = waves.map((wave) => Number(percentile(wave.map((sample) => sample.durationMs), 0.95).toFixed(2)));
      const errors = samples.filter((sample) => sample.failed).length;
      return {
        concurrencyPerWave: 50,
        waves: waves.length,
        requests: samples.length,
        errors,
        errorRate: errors / samples.length,
        medianP95Ms: Number(median(p95Runs).toFixed(2)),
        p95RunsMs: p95Runs,
        maxMs: Number(Math.max(...durations).toFixed(2)),
        externalRequests: externalHosts.size,
      };
    }

    await fetch(`${baseUrl}/v1/search?q=warmup`, { headers: { authorization: "Bearer warmup-search" } });
    await fetch(`${baseUrl}/v1/documents/UU%2021%20Tahun%202008/articles/Pasal%201%20angka%207`, {
      headers: { authorization: "Bearer warmup-exact" },
    });

    const searchWaves = [];
    for (let wave = 0; wave < 3; wave++) {
      searchWaves.push(
        await runWave("search", wave, "/v1/search?q=akad%20murabahah&pageSize=10")
      );
    }
    const searchReport = report(searchWaves);
    console.log(`LOAD_EVIDENCE ${JSON.stringify(searchReport)}`);
    assert.equal(searchReport.externalRequests, 0);
    assert.ok(searchReport.errorRate < 0.01, `error rate ${searchReport.errorRate}`);
    assert.ok(searchReport.medianP95Ms <= 500, `median p95 ${searchReport.medianP95Ms} ms melebihi 500 ms`);

    const exactWaves = [];
    for (let wave = 0; wave < 3; wave++) {
      exactWaves.push(
        await runWave(
          "exact",
          wave,
          "/v1/documents/UU%2021%20Tahun%202008/articles/Pasal%201%20angka%207",
          (body) => {
            const parsed = body as { data?: { evidence?: Array<{ id?: string }> } };
            return parsed.data?.evidence?.some((item) => item.id === CHANNEL_FIXTURE_EVIDENCE.id) === true;
          }
        )
      );
    }
    const exactReport = report(exactWaves);
    console.log(`EXACT_LOAD_EVIDENCE ${JSON.stringify(exactReport)}`);
    assert.equal(exactReport.externalRequests, 0);
    assert.ok(exactReport.errorRate < 0.01, `exact error rate ${exactReport.errorRate}`);
    assert.ok(exactReport.medianP95Ms <= 300, `exact median p95 ${exactReport.medianP95Ms} ms melebihi 300 ms`);
  } finally {
    globalThis.fetch = nativeFetch;
    server.close();
    await once(server, "close");
  }
});
