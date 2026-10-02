import fs from "node:fs/promises";
import http from "node:http";
import { pluginConfig } from "./config.js";
import { McpEndpoint } from "./mcp.js";

const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const MAX_BODY_BYTES = 1_000_000;

// Returns null for an oversized body. A modest overrun is drained so the
// client receives the 413; a large one drops the connection.
async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES * 8) {
      request.destroy();
      return null;
    }
    if (size <= MAX_BODY_BYTES) chunks.push(buffer);
  }
  return size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8");
}

export function createChatGptPluginServer(options: {
  endpoint?: McpEndpoint;
  allowedOrigins?: readonly string[];
  // Serves the local widget harness at /preview. Keep off on public hosts.
  preview?: boolean;
} = {}) {
  const endpoint = options.endpoint || new McpEndpoint();
  const allowedOrigins = new Set(options.allowedOrigins || pluginConfig.allowedOrigins);

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const origin = request.headers.origin;
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, {
        "cache-control": "no-store",
        ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }),
        ...headers
      });
      response.end(body === undefined ? undefined : JSON.stringify(body));
    };

    try {
      // Browsers always send Origin on cross-site POSTs; rejecting unknown
      // origins blocks DNS-rebinding access to a locally running server.
      if (origin && !allowedOrigins.has(origin) && !LOOPBACK_ORIGIN.test(origin)) {
        response.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return response.end(JSON.stringify({ error: { code: "origin_not_allowed", message: "Origin is not allowed" } }));
      }
      if (request.method === "OPTIONS") {
        return send(204, undefined, {
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id"
        });
      }
      if (url.pathname === "/mcp") {
        // Stateless JSON responses only: there is no server-initiated stream.
        if (request.method !== "POST") return send(405, undefined, { allow: "POST, OPTIONS" });
        const body = await readBody(request);
        if (body === null) return send(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body is too large" } });
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        }
        const result = await endpoint.handle(payload);
        return result === undefined ? send(202) : send(200, result);
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        return send(200, {
          status: "ok",
          name: pluginConfig.name,
          version: pluginConfig.version,
          mcpPath: "/mcp",
          fundedExecutionAllowed: false
        });
      }
      if (options.preview && request.method === "GET" && url.pathname === "/preview") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return response.end(await fs.readFile(pluginConfig.previewPath));
      }
      send(404, { error: { code: "not_found", message: "Route not found" } });
    } catch {
      if (!response.headersSent) send(500, { error: { code: "internal_error", message: "BitAgent could not complete this request" } });
      else response.end();
    }
  });
}
