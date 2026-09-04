import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
