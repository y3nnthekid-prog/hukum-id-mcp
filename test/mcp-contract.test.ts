import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createPlatformServer } from "../src/platform.js";
import { researchLegalProblem } from "../web/src/lib/api.js";
import {
  CHANNEL_FIXTURE_EVIDENCE,
  CHANNEL_FIXTURE_QUERY,
  CHANNEL_FIXTURE_SERVICE,
} from "./fixtures/fixture-legal-service.js";

test("default MCP exposes only the ten evidence-first tools with output schemas", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/mcp/stdio.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "contract-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const response = await client.listTools();
    const names = response.tools.map((tool) => tool.name).sort();

    assert.deepEqual(names, [
      "analyze_legal_problem",
      "analyze_uploaded_document",
      "get_legal_document",
      "get_source_status",
      "lookup_article",
      "research_sharia_issue",
      "search_jurisprudence",
      "search_legal_sources",
      "trace_regulation",
      "verify_citation",
    ]);
    assert.ok(response.tools.every((tool) => tool.outputSchema));
    assert.ok(response.tools.every((tool) => tool.annotations?.readOnlyHint === true));
  } finally {
    await client.close();
  }
});

function evidenceIds(value: unknown) {
  const result = value as { evidence?: Array<{ id?: string }> };
  return (result.evidence ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

function mcpData(response: Awaited<ReturnType<Client["callTool"]>>) {
  return (response.structuredContent as { data: unknown }).data;
}

test("Web, REST, local MCP and remote MCP preserve evidence IDs for one corpus release", async () => {
  const server = createPlatformServer({ service: CHANNEL_FIXTURE_SERVICE });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const local = new Client({ name: "local-channel-test", version: "1.0.0" });
  const remote = new Client({ name: "remote-channel-test", version: "1.0.0" });
  try {
    await local.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "test/fixtures/mcp-stdio-server.ts"],
        cwd: process.cwd(),
        stderr: "pipe",
      })
    );
    await remote.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const restResponse = await fetch(`${baseUrl}/v1/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: CHANNEL_FIXTURE_QUERY, useAi: false }),
    });
    assert.equal(restResponse.status, 200);
    const rest = (await restResponse.json()) as { data: unknown };
    const web = await researchLegalProblem(
      { question: CHANNEL_FIXTURE_QUERY },
      { baseUrl }
    );
    const localResult = await local.callTool({
      name: "analyze_legal_problem",
      arguments: { question: CHANNEL_FIXTURE_QUERY },
    });
    const remoteResult = await remote.callTool({
      name: "analyze_legal_problem",
      arguments: { question: CHANNEL_FIXTURE_QUERY },
    });

    const expected = [CHANNEL_FIXTURE_EVIDENCE.id];
    assert.deepEqual(evidenceIds(rest.data), expected);
    assert.deepEqual(evidenceIds(web.data), expected);
    assert.deepEqual(evidenceIds(mcpData(localResult)), expected);
    assert.deepEqual(evidenceIds(mcpData(remoteResult)), expected);
  } finally {
    await local.close();
    await remote.close();
    server.close();
    await once(server, "close");
  }
});
