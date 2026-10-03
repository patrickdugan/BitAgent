import { hashObject } from "../../launch/canonical.js";
import { DAG_NODES_V3 } from "../dag.js";
import { mulberry32 } from "../policies.js";
import type { ModelCandidateV3, TaskPacketV3 } from "../types.js";
import { GATE_CLASSES, PROBLEMS, type GateState } from "./dagMoveGates.js";

// A tiny recursive commit/veto gate. It sees the host's typed gate state and the proposer's
// move (never the oracle) and says whether the host should commit the proposal or veto it and
// take the script route. Weights are plain JSON so inference needs no framework; training is a
// hand-written backward pass through the recursive steps.

export const MOVE_CLASSES = ["advance", "observe", "refresh", "resume", "hold", "clarify", "incident", "none"] as const;
export type MoveClass = typeof MOVE_CLASSES[number];

export function moveClass(key: string | null): MoveClass {
  if (!key) return "none";
  if (key.startsWith("advance/")) return "advance";
  if (key.startsWith("recover/observe/")) return "observe";
  if (key.startsWith("clarify/")) return "clarify";
  if (key.startsWith("hold/")) return "hold";
  if (key.startsWith("escalate/")) return "incident";
  return key.endsWith("resume_persisted_state") ? "resume" : "refresh";
}

function oneHot<T extends string>(values: readonly T[], value: T) {
  return values.map((item) => (item === value ? 1 : 0));
}

export type VetoFeatureInput = {
  packet: TaskPacketV3;
  state: GateState;
  proposalKey: string | null;
  proposalRefs: Record<string, string>;
  margin: number | null;
  optionCount: number;
};

export function vetoFeatures(input: VetoFeatureInput): number[] {
  const { state, packet } = input;
  const klass = moveClass(input.proposalKey);
  const chosenIntent = state.intentCandidates.find((candidate) => candidate.id === input.proposalRefs.intent);
  return [
    ...oneHot(DAG_NODES_V3, state.node),
    ...oneHot(PROBLEMS, state.problem),
    ...oneHot(GATE_CLASSES, state.gateClass),
    ...oneHot(MOVE_CLASSES, klass),
    Math.min(state.refreshCount, 3) / 3,
    state.refreshBudgetLeft ? 1 : 0,
    state.approvalBound ? 1 : 0,
    state.simulationAdmitted ? 1 : 0,
    state.simulationExpired ? 1 : 0,
    state.submission === "submitted" ? 1 : 0,
    state.submission === "unknown" ? 1 : 0,
    state.repeatsEarlierIntent ? 1 : 0,
    state.intentCandidates.length > 1 ? 1 : 0,
    state.intentCandidates.some((candidate) => !candidate.attested) ? 1 : 0,
    chosenIntent ? 1 : 0,
    chosenIntent?.isCurrent ? 1 : 0,
    chosenIntent && !chosenIntent.attested ? 1 : 0,
    Math.min(input.optionCount, 26) / 26,
    input.margin === null ? 0 : 1,
    input.margin === null ? 0 : Math.max(-1, Math.min(1, input.margin / 5)),
    packet.run.intent_index > 0 ? 1 : 0,
    Math.min(packet.run.step, 40) / 40
  ];
}

export const VETO_FEATURE_DIM = vetoFeatures({
  packet: { run: { intent_index: 0, step: 0 } } as TaskPacketV3,
  state: {
    node: "observe", problem: "none", failedGates: [], gateClass: "none", refreshCount: 0, refreshBudgetLeft: true,
    intentCandidates: [], quoteId: null, repeatsEarlierIntent: false, approvalBound: false,
    simulationAdmitted: false, simulationExpired: false, submission: "none"
  },
  proposalKey: null, proposalRefs: {}, margin: null, optionCount: 1
}).length;

export type VetoRow = { features: number[]; commit: 0 | 1 };

export type VetoModelJson = {
  schema: "bitagent.veto_trm.v1";
  featureDim: number;
  hidden: number;
  steps: number;
  threshold: number;
  weights: { wIn: number[][]; bIn: number[]; wRec: number[][]; bRec: number[]; wOut: number[]; bOut: number };
  trainedOn: { rows: number; seed: number; epochs: number; sha256: string };
};

type Weights = VetoModelJson["weights"];

function zeros(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(0));
}

function matVec(matrix: number[][], vector: number[], bias: number[]) {
  return matrix.map((row, index) => row.reduce((sum, weight, column) => sum + weight * vector[column]!, bias[index]!));
}

// h0 = tanh(Win x); h_{t+1} = tanh(Wrec [h_t ; h0]); p = sigmoid(w . h_K + b)
export class TinyRecursiveVeto {
  constructor(readonly featureDim: number, readonly hidden: number, readonly steps: number, readonly weights: Weights, public threshold = 0.5) {}

  static init(featureDim: number, hidden = 24, steps = 4, seed = 7) {
    const random = mulberry32(seed);
    const scaleIn = Math.sqrt(2 / (featureDim + hidden));
    const scaleRec = Math.sqrt(1 / hidden);
    const weights: Weights = {
      wIn: zeros(hidden, featureDim).map((row) => row.map(() => (random() * 2 - 1) * scaleIn)),
      bIn: Array(hidden).fill(0),
      wRec: zeros(hidden, hidden * 2).map((row) => row.map(() => (random() * 2 - 1) * scaleRec)),
      bRec: Array(hidden).fill(0),
      wOut: Array.from({ length: hidden }, () => (random() * 2 - 1) * scaleRec),
      bOut: 0
    };
    return new TinyRecursiveVeto(featureDim, hidden, steps, weights);
  }

  static fromJSON(json: VetoModelJson) {
    if (json.schema !== "bitagent.veto_trm.v1") throw new Error("unsupported veto model schema");
    return new TinyRecursiveVeto(json.featureDim, json.hidden, json.steps, structuredClone(json.weights), json.threshold);
  }

  toJSON(trainedOn: VetoModelJson["trainedOn"]): VetoModelJson {
    return {
      schema: "bitagent.veto_trm.v1",
      featureDim: this.featureDim,
      hidden: this.hidden,
      steps: this.steps,
      threshold: this.threshold,
      weights: structuredClone(this.weights),
      trainedOn
    };
  }

  private forward(features: number[]) {
    const { wIn, bIn, wRec, bRec, wOut, bOut } = this.weights;
    const h0 = matVec(wIn, features, bIn).map(Math.tanh);
    const states = [h0];
    for (let step = 0; step < this.steps; step += 1) {
      const previous = states[states.length - 1]!;
      states.push(matVec(wRec, [...previous, ...h0], bRec).map(Math.tanh));
    }
    const last = states[states.length - 1]!;
    const logit = last.reduce((sum, value, index) => sum + value * wOut[index]!, bOut);
    return { states, probability: 1 / (1 + Math.exp(-logit)) };
  }

  // Probability that the proposal should be committed.
  commitProbability(features: number[]) {
    return this.forward(features).probability;
  }

  commits(features: number[]) {
    return this.commitProbability(features) >= this.threshold;
  }

  parameterCount() {
    const { wIn, wRec, wOut } = this.weights;
    return wIn.length * wIn[0]!.length + wRec.length * wRec[0]!.length + wOut.length + this.hidden * 2 + 1;
  }

  // Full-batch gradient descent with momentum on the logistic loss, backpropagated through every
  // recursive step. Class weights balance commit and veto rows.
  train(rows: VetoRow[], options: { epochs?: number; learningRate?: number; l2?: number; seed?: number } = {}) {
    const epochs = options.epochs ?? 300;
    const learningRate = options.learningRate ?? 0.05;
    const l2 = options.l2 ?? 1e-4;
    const { wIn, bIn, wRec, bRec, wOut } = this.weights;
    const positives = rows.filter((row) => row.commit === 1).length;
    const weightFor = (commit: 0 | 1) => (commit === 1 ? rows.length / (2 * Math.max(1, positives)) : rows.length / (2 * Math.max(1, rows.length - positives)));
    const momentum = {
      wIn: zeros(this.hidden, this.featureDim), bIn: Array(this.hidden).fill(0) as number[],
      wRec: zeros(this.hidden, this.hidden * 2), bRec: Array(this.hidden).fill(0) as number[],
      wOut: Array(this.hidden).fill(0) as number[], bOut: 0
    };
    const history: number[] = [];
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      const grad = {
        wIn: zeros(this.hidden, this.featureDim), bIn: Array(this.hidden).fill(0) as number[],
        wRec: zeros(this.hidden, this.hidden * 2), bRec: Array(this.hidden).fill(0) as number[],
        wOut: Array(this.hidden).fill(0) as number[], bOut: 0
      };
      let loss = 0;
      for (const row of rows) {
        const { states, probability } = this.forward(row.features);
        const weight = weightFor(row.commit) / rows.length;
        loss -= weight * (row.commit ? Math.log(Math.max(probability, 1e-9)) : Math.log(Math.max(1 - probability, 1e-9)));
        const dLogit = weight * (probability - row.commit);
        const last = states[states.length - 1]!;
        for (let i = 0; i < this.hidden; i += 1) grad.wOut[i]! += dLogit * last[i]!;
        grad.bOut += dLogit;
        // Backward through the recursion. dH0 accumulates from every step's re-injection.
        let dH = wOut.map((value) => dLogit * value);
        const dH0 = Array(this.hidden).fill(0) as number[];
        for (let step = this.steps; step >= 1; step -= 1) {
          const output = states[step]!;
          const previous = states[step - 1]!;
          const h0 = states[0]!;
          const dPre = output.map((value, i) => dH[i]! * (1 - value * value));
          const dPrevious = Array(this.hidden).fill(0) as number[];
          for (let i = 0; i < this.hidden; i += 1) {
            grad.bRec[i]! += dPre[i]!;
            for (let j = 0; j < this.hidden; j += 1) {
              grad.wRec[i]![j]! += dPre[i]! * previous[j]!;
              grad.wRec[i]![this.hidden + j]! += dPre[i]! * h0[j]!;
              dPrevious[j]! += dPre[i]! * wRec[i]![j]!;
              dH0[j]! += dPre[i]! * wRec[i]![this.hidden + j]!;
            }
          }
          dH = dPrevious;
        }
        const dFirst = dH.map((value, i) => value + dH0[i]!);
        const h0 = states[0]!;
        for (let i = 0; i < this.hidden; i += 1) {
          const dPre = dFirst[i]! * (1 - h0[i]! * h0[i]!);
          grad.bIn[i]! += dPre;
          for (let j = 0; j < this.featureDim; j += 1) grad.wIn[i]![j]! += dPre * row.features[j]!;
        }
      }
      const update = (matrix: number[][] | number[], g: number[][] | number[], m: number[][] | number[]) => {
        if (Array.isArray(matrix[0])) {
          (matrix as number[][]).forEach((row, i) => row.forEach((value, j) => {
            const velocity = 0.9 * (m as number[][])[i]![j]! + (g as number[][])[i]![j]! + l2 * value;
            (m as number[][])[i]![j] = velocity;
            row[j] = value - learningRate * velocity;
          }));
        } else {
          (matrix as number[]).forEach((value, i) => {
            const velocity = 0.9 * (m as number[])[i]! + (g as number[])[i]! + l2 * value;
            (m as number[])[i] = velocity;
            (matrix as number[])[i] = value - learningRate * velocity;
          });
        }
      };
      update(wIn, grad.wIn, momentum.wIn);
      update(bIn, grad.bIn, momentum.bIn);
      update(wRec, grad.wRec, momentum.wRec);
      update(bRec, grad.bRec, momentum.bRec);
      update(wOut, grad.wOut, momentum.wOut);
      momentum.bOut = 0.9 * momentum.bOut + grad.bOut;
      this.weights.bOut -= learningRate * momentum.bOut;
      history.push(loss);
    }
    return history;
  }

  // Picks the threshold that maximises balanced accuracy on the given rows (a validation split).
  calibrate(rows: VetoRow[]) {
    const scored = rows.map((row) => ({ p: this.commitProbability(row.features), commit: row.commit }));
    let best = { threshold: 0.5, balanced: -1 };
    for (let threshold = 0.05; threshold <= 0.95; threshold += 0.05) {
      const metrics = vetoMetrics(scored.map((row) => ({ commit: row.commit, predicted: row.p >= threshold ? 1 : 0 })));
      if (metrics.balancedAccuracy > best.balanced) best = { threshold: Number(threshold.toFixed(2)), balanced: metrics.balancedAccuracy };
    }
    this.threshold = best.threshold;
    return best;
  }
}

export function vetoMetrics(rows: { commit: 0 | 1; predicted: 0 | 1 }[]) {
  const count = (commit: 0 | 1, predicted: 0 | 1) => rows.filter((row) => row.commit === commit && row.predicted === predicted).length;
  const tp = count(1, 1), fn = count(1, 0), tn = count(0, 0), fp = count(0, 1);
  const recallCommit = tp / Math.max(1, tp + fn);
  const recallVeto = tn / Math.max(1, tn + fp);
  return {
    rows: rows.length,
    accuracy: (tp + tn) / Math.max(1, rows.length),
    balancedAccuracy: (recallCommit + recallVeto) / 2,
    // A false commit lets a wrong proposal through; a false reject vetoes a right one.
    falseCommitRate: fp / Math.max(1, fp + tn),
    falseRejectRate: fn / Math.max(1, fn + tp)
  };
}

export function rowsDigest(rows: VetoRow[]) {
  return hashObject(rows);
}

export function candidateIndexAmong(options: { key: string; argRefs: Record<string, string> }[], candidate: ModelCandidateV3 | null) {
  if (!candidate) return -1;
  return options.findIndex((option) => option.key === `${candidate.decision}/${candidate.next_node}/${candidate.tool}`
    && hashObject(option.argRefs) === hashObject(candidate.arg_refs));
}
