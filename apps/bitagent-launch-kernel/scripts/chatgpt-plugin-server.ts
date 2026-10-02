import { pluginConfig } from "../src/chatgpt/config.js";
import { McpEndpoint, serveStdio } from "../src/chatgpt/mcp.js";
import { createChatGptPluginServer } from "../src/chatgpt/server.js";

// `--stdio` serves MCP on stdin/stdout for OpenAI's tunnel-client and other
// local MCP hosts. The default serves Streamable HTTP at /mcp.
if (process.argv.includes("--stdio")) {
  serveStdio(new McpEndpoint());
} else {
  const { host, port } = pluginConfig;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  const preview = process.env.BITAGENT_CHATGPT_PREVIEW
    ? process.env.BITAGENT_CHATGPT_PREVIEW === "true"
    : loopback;
  const server = createChatGptPluginServer({ preview });
  server.listen(port, host, () => {
    console.log(`BitAgent ChatGPT plugin (MCP): http://${host}:${port}/mcp`);
    if (preview) console.log(`Widget preview: http://${host}:${port}/preview`);
  });

  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
