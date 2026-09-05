import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createEvidenceFirstMcpServer } from "../../src/mcp/server.js";
import { CHANNEL_FIXTURE_SERVICE } from "./fixture-legal-service.js";

const server = createEvidenceFirstMcpServer(CHANNEL_FIXTURE_SERVICE);
await server.connect(new StdioServerTransport());
