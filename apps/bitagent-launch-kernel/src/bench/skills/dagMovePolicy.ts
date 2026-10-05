import { CLARIFY_KEY, candidateFromKey, candidateKey, isCandidateShapeV3 } from "../dag.js";
import { moveOptions, type LlamaPolicyHandle, type PromptDecoration } from "../llamaPolicy.js";
import type { AsyncPolicy, TaskPacketV3 } from "../types.js";
import { gateState, renderChecklist, scriptRoute, type GateState, type ScriptRoute } from "./dagMoveGates.js";
import { TinyRecursiveVeto, vetoFeatures } from "./vetoTrm.js";

// The `bitagent-dag-move` skill as a benchmark policy, in four allocations of the task graph:
//   S1a gate facts: the host's gate checklist is shown without any recommendation; the model
//       works out and chooses every move.
//   S1  graph-gated prompt: the checklist also names the rule and the move it prescribes; the
//       model still chooses every move, so this measures whether it follows the recommendation.
//   S2  script-owned gates: closed gates are decided without the model; it is consulted only on
//       open gates, with the options narrowed to what the circuit leaves open.
//   S3  rudder: the model proposes every move; a tiny veto model commits it or substitutes the
//       script route.
export type SkillArm = "S1a" | "S1" | "S2" | "S3";

export type SkillDecision = {
  source: "script" | "model" | "model_vetoed" | "model_fallback";
  rule: string;
  key: string | null;
  argRefs: Record<string, string>;
  optionIndex: number;
  optionCount: number;
  margin: number | null;
  commitProbability: number | null;
  state: GateState;
};

export type SkillStats = { turns: number; scriptMoves: number; modelConsults: number; vetoes: number; fallbacks: number };

export type SkillPolicy = AsyncPolicy & { stats(): SkillStats; last(): SkillDecision; llm: LlamaPolicyHandle };

function scriptCandidate(packet: TaskPacketV3, route: Extract<ScriptRoute, { closed: true }>) {
  return candidateFromKey({
    taskId: packet.task_id, key: route.key, argRefs: route.argRefs, reasonCode: route.rule,
    evidenceIds: packet.intent_id ? [packet.intent_id] : []
  });
}

export function skillPolicy(options: {
  id: string;
  arm: SkillArm;
  // Builds the model policy with the skill's own prompt decoration hook.
  makeLlm: (decorate: (packet: TaskPacketV3) => PromptDecoration) => LlamaPolicyHandle;
  trm?: TinyRecursiveVeto;
}): SkillPolicy {
  const stats: SkillStats = { turns: 0, scriptMoves: 0, modelConsults: 0, vetoes: 0, fallbacks: 0 };
  let decoration: PromptDecoration = {};
  let lastDecision: SkillDecision | null = null;
  let margin: number | undefined;
  const llm = options.makeLlm(() => decoration);

  const base = (packet: TaskPacketV3, state: GateState, route: ScriptRoute, source: SkillDecision["source"]): SkillDecision => ({
    source, rule: route.rule, key: null, argRefs: {}, optionIndex: -1,
    optionCount: moveOptions(packet).length, margin: null, commitProbability: null, state
  });

  return {
    id: options.id,
    llm,
    stats: () => ({ ...stats }),
    last: () => lastDecision!,
    margin: () => margin,
    async propose(packet, context) {
      stats.turns += 1;
      margin = undefined;
      const state = gateState(packet);
      const route = scriptRoute(state, packet);
      const offered = moveOptions(packet);

      if (options.arm === "S2" && route.closed) {
        stats.scriptMoves += 1;
        const candidate = scriptCandidate(packet, route);
        lastDecision = { ...base(packet, state, route, "script"), key: candidateKey(candidate), argRefs: candidate.arg_refs };
        return candidate;
      }

      // The model is consulted. S1a shows gate facts; S1 adds the prescribed move; S2 also narrows
      // the options; S3 shows nothing.
      decoration = options.arm === "S3" ? {} : {
        checklist: renderChecklist(state, route, options.arm !== "S1a"),
        ...(options.arm === "S2" && !route.closed ? { allow: route.allow } : {})
      };
      stats.modelConsults += 1;
      const proposed = await llm.propose(packet, context);
      const choice = llm.last();
      margin = llm.margin?.();
      const candidate = isCandidateShapeV3(proposed) ? proposed : null;
      const decision: SkillDecision = {
        ...base(packet, state, route, "model"),
        key: candidate ? candidateKey(candidate) : choice.key,
        argRefs: candidate ? candidate.arg_refs : choice.argRefs,
        optionIndex: choice.optionIndex,
        optionCount: offered.length,
        margin: margin ?? null
      };

      if (options.arm === "S3" && options.trm) {
        const features = vetoFeatures({
          packet, state, proposalKey: decision.key, proposalRefs: decision.argRefs,
          margin: decision.margin, optionCount: decision.optionCount
        });
        decision.commitProbability = options.trm.commitProbability(features);
        if (!options.trm.commits(features)) {
          stats.vetoes += 1;
          const substitute = route.closed
            ? scriptCandidate(packet, route)
            : candidateFromKey({ taskId: packet.task_id, key: CLARIFY_KEY, reasonCode: "veto_open_gate_clarify" });
          lastDecision = { ...decision, source: "model_vetoed", key: candidateKey(substitute), argRefs: substitute.arg_refs };
          margin = undefined;
          return substitute;
        }
      }

      // On an open gate the model may only pick what the circuit allowed; anything else becomes the safe default.
      if (!route.closed && candidate && !offered.some((option) => route.allow(option) && option.key === candidateKey(candidate))) {
        stats.fallbacks += 1;
        const fallback = candidateFromKey({ taskId: packet.task_id, key: CLARIFY_KEY, reasonCode: "open_gate_fallback" });
        lastDecision = { ...decision, source: "model_fallback", key: candidateKey(fallback), argRefs: {} };
        margin = undefined;
        return fallback;
      }
      lastDecision = decision;
      return proposed;
    }
  };
}
