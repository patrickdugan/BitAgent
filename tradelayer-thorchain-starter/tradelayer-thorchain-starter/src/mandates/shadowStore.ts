import fs from "node:fs/promises";
import path from "node:path";
import { StrategyMandateError } from "./errors.js";
import type { TradeLayerShadowCapture } from "./shadowTypes.js";
import { validateTradeLayerShadowCapture } from "./tradelayerShadowSource.js";

export class FileTradeLayerShadowCaptureStore {
  constructor(private readonly directory: string) {}

  async save(raw: TradeLayerShadowCapture) {
    const capture = validateTradeLayerShadowCapture(raw);
    await fs.mkdir(this.directory, { recursive: true });
    const target = this.pathFor(capture.captureHash);
    const serialized = `${JSON.stringify(capture, null, 2)}\n`;
    try {
      const existing = await fs.readFile(target, "utf8");
      const parsed = validateTradeLayerShadowCapture(JSON.parse(existing) as TradeLayerShadowCapture);
      if (parsed.captureHash !== capture.captureHash || existing !== serialized) {
        throw new StrategyMandateError("shadow_state_conflict", "Existing shadow capture does not match its content address");
      }
      return capture;
    } catch (error) {
      if (error instanceof StrategyMandateError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new StrategyMandateError("shadow_source_error", "Unable to inspect shadow capture store", error);
      }
    }
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
    return capture;
  }

  async load(captureHash: string) {
    if (!/^[0-9a-f]{64}$/.test(captureHash)) {
      throw new StrategyMandateError("shadow_state_invalid", "Shadow capture hash is invalid");
    }
    try {
      const parsed = JSON.parse(await fs.readFile(this.pathFor(captureHash), "utf8")) as TradeLayerShadowCapture;
      const capture = validateTradeLayerShadowCapture(parsed);
      if (capture.captureHash !== captureHash) {
        throw new StrategyMandateError("shadow_state_conflict", "Stored shadow capture is under the wrong content address");
      }
      return capture;
    } catch (error) {
      if (error instanceof StrategyMandateError) throw error;
      throw new StrategyMandateError("shadow_source_error", "Unable to load shadow capture", error);
    }
  }

  private pathFor(captureHash: string) {
    return path.join(this.directory, `${captureHash}.json`);
  }
}
