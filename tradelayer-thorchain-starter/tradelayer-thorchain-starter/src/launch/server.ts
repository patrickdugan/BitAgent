import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BitAgentConversation } from "./agent.js";
import { errorResult, LaunchKernelError } from "./errors.js";
import { createLaunchKernel } from "./factory.js";
import { buildDagCandidateTask, validateDagCandidate } from "./dagCandidate.js";
import type { BitAgentLaunchKernel } from "./kernel.js";
import {
  defaultReserveOperatorEvidencePaths,
  readReserveOperatorEvidence,
  type ReserveOperatorEvidencePaths
} from "./operatorEvidence.js";
import {
  ReserveOperatorToolRegistry,
  reserveOperatorToolSchemas
} from "./operatorTools.js";
import { launchToolSchemas, LaunchToolRegistry } from "./tools.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultUiDir = path.resolve(moduleDir, "..", "..", "launch-ui");

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new LaunchKernelError("validation_error", "Request body is too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(body, null, 2));
}

async function staticFile(response: http.ServerResponse, uiDir: string, pathname: string) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(uiDir, relative);
  if (!target.startsWith(path.resolve(uiDir) + path.sep) && target !== path.join(path.resolve(uiDir), "index.html")) {
    return false;
  }
  try {
    const content = await fs.readFile(target);
    const type = target.endsWith(".css")
      ? "text/css; charset=utf-8"
      : target.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createBitAgentServer(options: {
  uiDir?: string;
  kernel?: BitAgentLaunchKernel;
  reserveOperatorEvidencePaths?: ReserveOperatorEvidencePaths;
} = {}) {
  const kernel = options.kernel || createLaunchKernel();
  const conversation = new BitAgentConversation(kernel);
  const tools = new LaunchToolRegistry(kernel);
  const uiDir = options.uiDir || defaultUiDir;
  const evidencePaths = options.reserveOperatorEvidencePaths
    || defaultReserveOperatorEvidencePaths(path.resolve(moduleDir, "..", ".."));
  const operatorTools = new ReserveOperatorToolRegistry(evidencePaths);
  const publicToolSchemas = { ...launchToolSchemas, ...reserveOperatorToolSchemas };

  return http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return json(response, 204, {});
    const url = new URL(request.url || "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/tools") {
        return json(response, 200, { tools: publicToolSchemas });
      }
      if (request.method === "GET" && url.pathname === "/api/operator/reserve-intake") {
        return json(response, 200, { data: await readReserveOperatorEvidence(evidencePaths) });
      }
      if (request.method === "POST" && url.pathname === "/api/workflows") {
        const body = await readBody(request);
        const state = await kernel.start({
          workflowId: typeof body.workflowId === "string" ? body.workflowId : undefined,
          referralLink: typeof body.referralLink === "string" ? body.referralLink : undefined,
          intent: typeof body.intent === "string" ? body.intent as never : undefined,
          network: body.network === "bitcoin" ? "bitcoin" : "bitcoin-testnet4"
        });
        return json(response, 201, { state: await kernel.getPublic(state.id) });
      }
      const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)$/);
      if (request.method === "GET" && workflowMatch) {
        return json(response, 200, { state: await kernel.getPublic(decodeURIComponent(workflowMatch[1])) });
      }
      const messageMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/message$/);
      if (request.method === "POST" && messageMatch) {
        const body = await readBody(request);
        const workflowId = decodeURIComponent(messageMatch[1]);
        const plan = await conversation.plan(workflowId, String(body.message || ""));
        return json(response, 200, { plan, state: await kernel.getPublic(workflowId) });
      }
      const dagTaskMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/dag-task$/);
      if (request.method === "POST" && dagTaskMatch) {
        const body = await readBody(request);
        const workflowId = decodeURIComponent(dagTaskMatch[1]);
        const message = String(body.message || "");
        const plan = await conversation.plan(workflowId, message, { persistIntent: false });
        const state = await kernel.getPublic(workflowId);
        const task = buildDagCandidateTask({ state, plan });
        return json(response, 200, {
          plan,
          task: task.packet,
          state,
          modelAuthority: "candidate_only"
        });
      }
      const dagCandidateMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/dag-candidate$/);
      if (request.method === "POST" && dagCandidateMatch) {
        const body = await readBody(request);
        const workflowId = decodeURIComponent(dagCandidateMatch[1]);
        const message = String(body.message || "");
        const plan = await conversation.plan(workflowId, message, { persistIntent: false });
        const state = await kernel.getPublic(workflowId);
        const task = buildDagCandidateTask({ state, plan });
        return json(response, 200, {
          receipt: validateDagCandidate({ task, proposed: body.candidate }),
          plan,
          state
        });
      }
      const toolMatch = url.pathname.match(/^\/api\/tools\/(.+)$/);
      if (request.method === "POST" && toolMatch) {
        const body = await readBody(request);
        const name = decodeURIComponent(toolMatch[1]);
        if (name in reserveOperatorToolSchemas) {
          return json(response, 200, { result: await operatorTools.call(name, body) });
        }
        const workflowId = String(body.workflowId || "");
        try {
          const result = await tools.call(name, body);
          return json(response, 200, {
            result: name === "bitagent.workflow.get" ? result : undefined,
            state: await kernel.getPublic(workflowId)
          });
        } catch (error) {
          const result = errorResult(error);
          let state: Awaited<ReturnType<BitAgentLaunchKernel["getPublic"]>> | undefined;
          try {
            state = workflowId ? await kernel.getPublic(workflowId) : undefined;
          } catch {
            state = undefined;
          }
          return json(response, result.code === "not_found" ? 404 : 400, { error: result, state });
        }
      }
      if (request.method === "GET" && await staticFile(response, uiDir, url.pathname)) return;
      json(response, 404, { error: { code: "not_found", message: "Route not found" } });
    } catch (error) {
      const result = errorResult(error);
      json(response, result.code === "not_found" ? 404 : 400, { error: result });
    }
  });
}
