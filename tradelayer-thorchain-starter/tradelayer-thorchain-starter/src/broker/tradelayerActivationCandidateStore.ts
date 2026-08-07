import fs from "node:fs/promises";
import path from "node:path";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import {
  validatePrivateTradeLayerActivationCandidate,
  type PreparedTradeLayerActivationCandidate,
  type PrivateTradeLayerActivationCandidate,
  type TradeLayerActivationCancellationReceipt
} from "./tradelayerActivationCandidateBroker.js";
import type {
  TradeLayerActivationReconciliationReceipt,
  TradeLayerActivationSubmissionReceipt
} from "./tradelayerActivationExecutionBroker.js";

export type TradeLayerActivationRecordStatus =
  | "pending_approval"
  | "execution_requested"
  | "cancelled"
  | "submitted"
  | "submission_unknown"
  | "mempool"
  | "confirmed"
  | "failed_released"
  | "manual_recovery";

export type TradeLayerActivationFailure = {
  code: string;
  message: string;
  inputLockDisposition: "retained" | "released" | "unknown";
  broadcastMayHaveOccurred: boolean;
  observedAt: string;
};

type ActivationResult =
  | TradeLayerActivationCancellationReceipt
  | TradeLayerActivationSubmissionReceipt
  | TradeLayerActivationReconciliationReceipt;

type PrivateActivationRecord = {
  schema: "bitagent_tradelayer_activation_private_record_v1";
  approvalHash: string;
  status: TradeLayerActivationRecordStatus;
  candidate: PrivateTradeLayerActivationCandidate;
  createdAt: string;
  updatedAt: string;
  result?: ActivationResult;
  failure?: TradeLayerActivationFailure;
  recordHash: string;
};

type PrivateActivationDocument = {
  schema: "bitagent_tradelayer_activation_private_store_v1";
  records: Record<string, PrivateActivationRecord>;
  documentHash: string;
};

export type TradeLayerActivationApprovalView = {
  schema: "bitagent_tradelayer_activation_approval_view_v1";
  authority: "wallet_user";
  status: TradeLayerActivationRecordStatus;
  explanation: string;
  exactEffects: {
    inputUtxos: PreparedTradeLayerActivationCandidate["inputUtxos"];
    dataOutput: PreparedTradeLayerActivationCandidate["dataOutput"] & { payloadUtf8: string };
    changeOutput: PreparedTradeLayerActivationCandidate["changeOutput"];
    feeSats: string;
    unsignedTxid: string;
    unsignedPsbtHash: string;
    approvalHash: string;
  };
  approval: {
    required: true;
    exactApprovalHash: string;
    decisionStatus: "pending" | "cancelled" | "approved";
  };
  walletActions: {
    signingPerformed: boolean | null;
    broadcastStatus: "not_performed" | "unknown" | "submitted";
    retryAuthorized: false;
  };
  recoveryInstructions: string[];
  result?: ActivationResult;
  failure?: TradeLayerActivationFailure;
};

function recordMaterial(record: PrivateActivationRecord) {
  const { recordHash: _recordHash, ...material } = record;
  return material;
}

function documentMaterial(document: PrivateActivationDocument) {
  const { documentHash: _documentHash, ...material } = document;
  return material;
}

function validateResult(
  approvalHash: string,
  requestHash: string,
  status: TradeLayerActivationRecordStatus,
  result: ActivationResult | undefined
): void {
  const resultRequired = status === "cancelled" || status === "submitted" || status === "mempool" || status === "confirmed";
  if (!result) {
    if (resultRequired) {
      throw new IntegrationBoundaryError("signer_broker_error", "Activation durable state is missing its result receipt");
    }
    return;
  }
  const { receiptHash, ...material } = result;
  if (
    result.approvalHash !== approvalHash ||
    result.requestHash !== requestHash ||
    canonicalHash(material) !== receiptHash ||
    (status === "cancelled" && result.schema !== "bitagent_tradelayer_activation_cancellation_v1") ||
    (status === "submitted" && result.schema !== "bitagent_tradelayer_activation_submission_v1") ||
    ((status === "mempool" || status === "confirmed") &&
      (result.schema !== "bitagent_tradelayer_activation_reconciliation_v1" || result.status !== status))
  ) {
    throw new IntegrationBoundaryError("signer_broker_error", "Activation result does not match its durable state");
  }
}

function approvalView(record: PrivateActivationRecord): TradeLayerActivationApprovalView {
  const candidate = record.candidate.publicCandidate;
  const executionSucceeded = record.status === "submitted" || record.status === "mempool" || record.status === "confirmed";
  const submissionUnknown = record.status === "submission_unknown";
  const executionUnresolved = submissionUnknown || record.status === "execution_requested";
  return {
    schema: "bitagent_tradelayer_activation_approval_view_v1",
    authority: "wallet_user",
    status: record.status,
    explanation: "Activate only TradeLayer tx type 11 for the pinned candidate11 code hash on Bitcoin testnet4.",
    exactEffects: {
      inputUtxos: structuredClone(candidate.inputUtxos),
      dataOutput: { ...structuredClone(candidate.dataOutput), payloadUtf8: candidate.request.activation.payloadUtf8 },
      changeOutput: structuredClone(candidate.changeOutput),
      feeSats: candidate.feeSats,
      unsignedTxid: candidate.unsignedTxid,
      unsignedPsbtHash: candidate.unsignedPsbtHash,
      approvalHash: candidate.approvalHash
    },
    approval: {
      required: true,
      exactApprovalHash: candidate.approvalHash,
      decisionStatus: record.status === "pending_approval" ? "pending" : record.status === "cancelled" ? "cancelled" : "approved"
    },
    walletActions: {
      signingPerformed: executionSucceeded || submissionUnknown ? true : executionUnresolved || record.status === "manual_recovery" ? null : false,
      broadcastStatus: executionSucceeded ? "submitted" : executionUnresolved ? "unknown" : "not_performed",
      retryAuthorized: false
    },
    recoveryInstructions: record.status === "submission_unknown" || record.status === "execution_requested"
      ? ["Do not retry.", "Use positive chain reconciliation for the exact unsigned txid."]
      : record.status === "pending_approval"
        ? ["Approve the exact hash or cancel to release the reserved input."]
        : record.status === "manual_recovery"
          ? ["Stop execution and inspect the wallet input lock before any further action."]
          : [],
    ...(record.result ? { result: structuredClone(record.result) } : {}),
    ...(record.failure ? { failure: structuredClone(record.failure) } : {})
  };
}

export class FileTradeLayerActivationCandidateStore {
  private operation = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly expectedPolicyFingerprint: string
  ) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private emptyDocument(): PrivateActivationDocument {
    const document = {
      schema: "bitagent_tradelayer_activation_private_store_v1" as const,
      records: {},
      documentHash: ""
    };
    document.documentHash = canonicalHash(documentMaterial(document));
    return document;
  }

  private validateRecord(record: PrivateActivationRecord): void {
    if (
      record.schema !== "bitagent_tradelayer_activation_private_record_v1" ||
      ![
        "pending_approval", "execution_requested", "cancelled", "submitted", "submission_unknown",
        "mempool", "confirmed", "failed_released", "manual_recovery"
      ].includes(record.status) ||
      !/^[a-f0-9]{64}$/.test(record.approvalHash) ||
      record.candidate.publicCandidate.approvalHash !== record.approvalHash ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      !Number.isFinite(Date.parse(record.updatedAt)) ||
      canonicalHash(recordMaterial(record)) !== record.recordHash
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "Private activation candidate record integrity check failed");
    }
    validatePrivateTradeLayerActivationCandidate(
      record.candidate,
      this.expectedPolicyFingerprint,
      new Date(record.updatedAt),
      true
    );
    validateResult(
      record.approvalHash,
      record.candidate.publicCandidate.request.requestHash,
      record.status,
      record.result
    );
    const failureRequired = record.status === "submission_unknown" || record.status === "failed_released" || record.status === "manual_recovery";
    if (failureRequired !== Boolean(record.failure)) {
      throw new IntegrationBoundaryError("signer_broker_error", "Activation durable recovery state is incomplete");
    }
  }

  private async readDocument(): Promise<PrivateActivationDocument> {
    let parsed: PrivateActivationDocument;
    try {
      parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as PrivateActivationDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.emptyDocument();
      throw new IntegrationBoundaryError("signer_broker_error", "Private activation candidate store is unreadable");
    }
    if (
      parsed.schema !== "bitagent_tradelayer_activation_private_store_v1" ||
      !parsed.records ||
      canonicalHash(documentMaterial(parsed)) !== parsed.documentHash
    ) {
      throw new IntegrationBoundaryError("signer_broker_error", "Private activation candidate store integrity check failed");
    }
    for (const [approvalHash, record] of Object.entries(parsed.records)) {
      if (approvalHash !== record.approvalHash) {
        throw new IntegrationBoundaryError("signer_broker_error", "Private activation candidate store key mismatch");
      }
      this.validateRecord(record);
    }
    return parsed;
  }

  private async writeDocument(document: PrivateActivationDocument): Promise<void> {
    document.documentHash = canonicalHash(documentMaterial(document));
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.filePath);
  }

  private async update(
    approvalHash: string,
    mutate: (record: PrivateActivationRecord) => void
  ): Promise<TradeLayerActivationApprovalView> {
    return this.serialize(async () => {
      const document = await this.readDocument();
      const record = document.records[approvalHash];
      if (!record) throw new IntegrationBoundaryError("signer_broker_error", "Activation candidate was not found");
      mutate(record);
      record.recordHash = canonicalHash(recordMaterial(record));
      this.validateRecord(record);
      await this.writeDocument(document);
      return approvalView(record);
    });
  }

  async create(candidate: PrivateTradeLayerActivationCandidate, now = new Date()): Promise<TradeLayerActivationApprovalView> {
    return this.serialize(async () => {
      validatePrivateTradeLayerActivationCandidate(candidate, this.expectedPolicyFingerprint, now);
      const approvalHash = candidate.publicCandidate.approvalHash;
      const document = await this.readDocument();
      const existing = document.records[approvalHash];
      if (existing) {
        if (existing.candidate.envelopeHash !== candidate.envelopeHash) {
          throw new IntegrationBoundaryError("signer_broker_error", "Activation approval hash collides with different private material");
        }
        return approvalView(existing);
      }
      const record = {
        schema: "bitagent_tradelayer_activation_private_record_v1" as const,
        approvalHash,
        status: "pending_approval" as const,
        candidate: structuredClone(candidate),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        recordHash: ""
      } satisfies PrivateActivationRecord;
      record.recordHash = canonicalHash(recordMaterial(record));
      document.records[approvalHash] = record;
      await this.writeDocument(document);
      return approvalView(record);
    });
  }

  async loadPrivate(approvalHash: string): Promise<PrivateTradeLayerActivationCandidate> {
    return this.serialize(async () => {
      const record = (await this.readDocument()).records[approvalHash];
      if (!record) throw new IntegrationBoundaryError("signer_broker_error", "Activation candidate was not found");
      return structuredClone(record.candidate);
    });
  }

  async getPublic(approvalHash: string): Promise<TradeLayerActivationApprovalView> {
    return this.serialize(async () => {
      const record = (await this.readDocument()).records[approvalHash];
      if (!record) throw new IntegrationBoundaryError("signer_broker_error", "Activation candidate was not found");
      return approvalView(record);
    });
  }

  async markResult(
    approvalHash: string,
    status: Exclude<TradeLayerActivationRecordStatus, "pending_approval" | "submission_unknown" | "failed_released" | "manual_recovery">,
    result: ActivationResult,
    now = new Date()
  ): Promise<TradeLayerActivationApprovalView> {
    return this.update(approvalHash, (record) => {
      const validTransition =
        (status === "cancelled" && record.status === "pending_approval") ||
        (status === "submitted" && record.status === "execution_requested") ||
        ((status === "mempool" || status === "confirmed") &&
          (record.status === "execution_requested" || record.status === "submission_unknown" || record.status === "submitted"));
      if (!validTransition) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation candidate cannot enter the requested result state");
      }
      validateResult(approvalHash, record.candidate.publicCandidate.request.requestHash, status, result);
      record.status = status;
      record.result = structuredClone(result);
      delete record.failure;
      record.updatedAt = now.toISOString();
    });
  }

  async markFailure(
    approvalHash: string,
    status: "submission_unknown" | "failed_released" | "manual_recovery",
    failure: TradeLayerActivationFailure,
    now = new Date()
  ): Promise<TradeLayerActivationApprovalView> {
    return this.update(approvalHash, (record) => {
      if (record.status !== "execution_requested" && record.status !== "submission_unknown") {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation candidate cannot enter the requested recovery state");
      }
      if (
        (status === "submission_unknown" &&
          (!failure.broadcastMayHaveOccurred || failure.inputLockDisposition !== "retained")) ||
        (status === "failed_released" &&
          (failure.broadcastMayHaveOccurred || failure.inputLockDisposition !== "released")) ||
        (status === "manual_recovery" && failure.inputLockDisposition !== "unknown")
      ) {
        throw new IntegrationBoundaryError("signer_broker_error", "Activation recovery evidence does not match its durable state");
      }
      record.status = status;
      record.failure = structuredClone(failure);
      record.updatedAt = now.toISOString();
    });
  }

  async markExecutionRequested(
    approvalHash: string,
    now = new Date()
  ): Promise<TradeLayerActivationApprovalView> {
    return this.update(approvalHash, (record) => {
      if (record.status !== "pending_approval") {
        throw new IntegrationBoundaryError("signer_broker_error", "Only a pending activation can enter execution");
      }
      record.status = "execution_requested";
      record.updatedAt = now.toISOString();
    });
  }
}
