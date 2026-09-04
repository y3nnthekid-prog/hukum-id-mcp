#!/usr/bin/env node

if (process.env.HUKUM_MCP_LEGACY === "1") {
  await import("../server.js");
} else {
  const [{ StdioServerTransport }, { createLegalResearchService }, { legacyAdapters }, { createEvidenceFirstMcpServer }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("../core/service.js"),
      import("../core/legacy-adapters.js"),
      import("./server.js"),
    ]);

  const service = createLegalResearchService(legacyAdapters);
  const server = createEvidenceFirstMcpServer(service);
  await server.connect(new StdioServerTransport());
}
