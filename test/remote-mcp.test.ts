import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createPlatformServer } from "../src/platform.js";

const service = {
  searchLegalSources: async () => ({ documents: [], warnings: [], nextCursor: null }),
  getLegalDocument: async () => ({}),
  lookupArticle: async () => {
    throw new Error("Gagal membuka C:\\Users\\researcher\\private\\draft.pdf");
  },
  verifyCitation: async () => ({ hasil: [] }),
  traceRegulation: async () => ({}),
  searchJurisprudence: async () => ({ documents: [] }),
  researchShariaIssue: async () => ({}),
  analyzeLegalProblem: async () => ({ status: "insufficient_evidence", evidence: [] }),
  analyzeUploadedDocument: async () => ({}),
  getSourceStatus: async () => ({ hasil: [] }),
};

test("one HTTP server exposes REST health and stateless Streamable HTTP MCP", async () => {
  const server = createPlatformServer({ service: service as any });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);

  const client = new Client({ name: "remote-contract-test", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 10);
    const failed = await client.callTool({
      name: "lookup_article",
      arguments: { regulation: "UU 21 Tahun 2008", article: "Pasal 1" },
    });
    assert.equal(failed.isError, true);
    assert.doesNotMatch(JSON.stringify(failed), /researcher|draft\.pdf/);
    assert.match(JSON.stringify(failed), /path lokal/);
  } finally {
    await client.close();
    server.close();
    await once(server, "close");
  }
});
