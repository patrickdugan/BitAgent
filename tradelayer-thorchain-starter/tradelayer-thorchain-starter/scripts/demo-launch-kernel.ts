import crypto from "node:crypto";
import { BitAgentConversation } from "../src/launch/agent.js";
import { createLaunchKernel, createScriptedReferralLinkService } from "../src/launch/factory.js";
import { LaunchToolRegistry } from "../src/launch/tools.js";
import { AcquisitionMode, InvitationActor } from "../src/referral/types.js";

async function main() {
  const workflowId = `demo-${Date.now()}`;
  const kernel = createLaunchKernel();
  const tools = new LaunchToolRegistry(kernel);
  const agent = new BitAgentConversation(kernel);
  const referralLink = createScriptedReferralLinkService().issue({
    referrerPrincipalId: "demo-referrer",
    acquisitionMode: AcquisitionMode.HUMAN_MANUAL_SHARE,
    invitationActor: InvitationActor.HUMAN
  }).url;

  await kernel.start({ workflowId, referralLink });
  await tools.call("bitagent.wallet.connect", { workflowId, mode: "create" });
  await tools.call("bitagent.deposit.prepare", { workflowId });
  await tools.call("bitagent.deposit.observe", {
    workflowId,
    txid: crypto.createHash("sha256").update(workflowId).digest("hex"),
    vout: 0,
    amountSats: "250000",
    blockHeight: 100,
    currentHeight: 101
  });
  const plan = await agent.plan(workflowId, "Use 100000 sats in the starter TradeLayer strategy.");
  await tools.call(plan.suggestedTool!.name, plan.suggestedTool!.arguments);
  await tools.call("bitagent.wallet.request_approval", { workflowId });
  await tools.call("bitagent.wallet.resolve_approval", { workflowId, decision: "approve" });
  await tools.call("bitagent.action.execute", { workflowId });
  await tools.call("bitagent.action.verify", { workflowId });

  console.log(JSON.stringify({
    plan,
    state: await kernel.getPublic(workflowId)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
