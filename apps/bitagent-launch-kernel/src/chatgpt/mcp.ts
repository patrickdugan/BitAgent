import fs from "node:fs/promises";
import readline from "node:readline";
import { pluginConfig } from "./config.js";
import { ChatGptPluginError, pluginErrorResult } from "./errors.js";
import { ChatGptToolRegistry } from "./tools.js";

// Newest first: an unrecognized client version is answered with the newest.
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export const SERVER_INSTRUCTIONS = `BitAgent is a self-custodial Bitcoin onboarding agent at a testnet/scripted MVP stage. You are its guide inside ChatGPT, and you are a candidate producer only.

Always:
- Call bitagent_overview before describing BitAgent. Tool results are your only source of BitAgent facts, steps, balances, and fees.
- Speak plainly for people who are new to Bitcoin. Give one step or one question at a time.
- For anything about how much money to use, call bitagent_money_plan with only what the person actually told you, and ask the questions it returns word for word.
- Say clearly that practice runs and stress tests are simulated, and that this release cannot move real funds.
- Hand off to the person's own self-hosted BitAgent for every wallet approval.

Never:
- Ask for, accept, or repeat a seed phrase, private key, mnemonic, or WIF. If one appears, tell the person to stop and treat that wallet as exposed.
- Say that anything was approved, signed, broadcast, executed, deposited, or filled.
- Invent a price, balance, quote, confirmation, download link, or transaction.
- Recommend what to buy or how much to invest, or promise returns. Report the person's own limits back to them; do not set limits for them.
- Suggest VPNs or other ways around a regional restriction.

Research: call bitagent_research_brief first. You may research and reason about trading systems, but present bitagent_research_stress_test output as hypothetical what-if results, never as a backtest, a forecast, or advice.`;

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

type JsonRpcId = string | number | null;

const success = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const failure = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

export class McpEndpoint {
  constructor(
    private readonly tools: ChatGptToolRegistry = new ChatGptToolRegistry(),
    private readonly widgetPath: string = pluginConfig.widgetPath
  ) {}

  // Returns undefined when the payload held only notifications or responses.
  async handle(payload: unknown): Promise<unknown> {
    if (!Array.isArray(payload)) return this.handleMessage(payload);
    if (!payload.length) return failure(null, -32600, "Invalid Request");
    const responses = (await Promise.all(payload.map((message) => this.handleMessage(message))))
      .filter((response) => response !== undefined);
    return responses.length ? responses : undefined;
  }

  private async handleMessage(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
      return failure(null, -32600, "Invalid Request");
    }
    const message = raw as { id?: JsonRpcId; method?: unknown; params?: unknown };
    if (typeof message.method !== "string") {
      return "result" in message || "error" in message ? undefined : failure(message.id ?? null, -32600, "Invalid Request");
    }
    if (message.id === undefined) return undefined;
    const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
      ? message.params as Record<string, unknown>
      : {};
    try {
      return success(message.id, await this.dispatch(message.method, params));
    } catch (error) {
      return error instanceof RpcError
        ? failure(message.id, error.code, error.message)
        : failure(message.id, -32603, "Internal error");
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>) {
    switch (method) {
      case "initialize": {
        const requested = String(params.protocolVersion || "");
        return {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
          serverInfo: { name: pluginConfig.name, title: pluginConfig.title, version: pluginConfig.version },
          instructions: SERVER_INSTRUCTIONS
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: this.tools.list() };
      case "tools/call":
        return this.callTool(params);
      case "resources/list":
        return {
          resources: [{
            uri: pluginConfig.widgetUri,
            name: "bitagent-journey",
            title: "BitAgent journey",
            description: "Shows BitAgent setup steps, money limits, practice simulations, and stress-test results.",
            mimeType: WIDGET_MIME_TYPE
          }]
        };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "resources/read":
        return this.readResource(params);
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async callTool(params: Record<string, unknown>) {
    if (typeof params.name !== "string") throw new RpcError(-32602, "tools/call requires a tool name");
    try {
      const { summary, structuredContent } = await this.tools.call(params.name, params.arguments);
      return {
        content: [{ type: "text", text: summary }, { type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent
      };
    } catch (error) {
      if (error instanceof ChatGptPluginError && error.code === "unknown_tool") {
        throw new RpcError(-32602, error.message);
      }
      // Tool-level failures are results, so the model can read and recover.
      const result = pluginErrorResult(error);
      return {
        isError: true,
        content: [{ type: "text", text: `${result.code}: ${result.message}` }],
        structuredContent: { kind: "error", error: result, effect: "none", fundedExecutionAllowed: false }
      };
    }
  }

  private async readResource(params: Record<string, unknown>) {
    if (params.uri !== pluginConfig.widgetUri) throw new RpcError(-32002, "Resource not found");
    return {
      contents: [{
        uri: pluginConfig.widgetUri,
        mimeType: WIDGET_MIME_TYPE,
        text: await fs.readFile(this.widgetPath, "utf8"),
        _meta: {
          // The widget is self-contained: it loads and contacts nothing.
          ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
          "openai/widgetDescription": "A read-only card showing the BitAgent step, limits, or simulation the tool just returned.",
          "openai/widgetPrefersBorder": true,
          "openai/widgetCSP": { connect_domains: [], resource_domains: [] }
        }
      }]
    };
  }
}

// Newline-delimited JSON-RPC over stdio, for OpenAI's tunnel-client
// (--mcp-command) and other local MCP hosts.
export function serveStdio(
  endpoint: McpEndpoint,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on("line", async (raw) => {
    // Windows shells prepend a byte-order mark when piping text.
    const line = raw.replace(/^﻿/, "").trim();
    if (!line) return;
    let response: unknown;
    try {
      response = await endpoint.handle(JSON.parse(line));
    } catch {
      response = failure(null, -32700, "Parse error");
    }
    if (response !== undefined) output.write(`${JSON.stringify(response)}\n`);
  });
  return lines;
}
