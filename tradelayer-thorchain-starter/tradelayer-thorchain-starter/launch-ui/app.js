const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const actionPanel = $("#action-panel");
const journey = $("#journey");
const stageTitle = $("#stage-title");
const referral = $("#referral");
const messageInput = $("#message");

let state = null;
let lastPlan = null;
let dagRuntime = null;

function referralKey(params) {
  const key = new URLSearchParams();
  for (const name of ["ref", "campaign", "workflow", "strategy"]) {
    if (params.has(name)) key.set(name, params.get(name));
  }
  return key.toString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function addMessage(text, role = "agent") {
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.textContent = text;
  messages.append(item);
  item.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || "BitAgent request failed");
    error.state = body.state;
    throw error;
  }
  return body;
}

async function start() {
  try {
    dagRuntime = (await api("/api/dag-runtime")).runtime;
  } catch {
    dagRuntime = null;
  }
  const params = new URLSearchParams(location.search);
  const hasReferral = params.has("ref") && params.has("campaign") && params.has("workflow");
  const activeReferralKey = hasReferral ? referralKey(params) : null;
  const storedReferralKey = localStorage.getItem("bitagent.referralKey");
  let workflowId = localStorage.getItem("bitagent.workflowId");
  if (hasReferral && storedReferralKey !== activeReferralKey) workflowId = null;
  if (workflowId) {
    try {
      const body = await api(`/api/workflows/${encodeURIComponent(workflowId)}`);
      state = body.state;
      addMessage("Welcome back. I restored your last verified workflow state.");
      return render();
    } catch {
      localStorage.removeItem("bitagent.workflowId");
      localStorage.removeItem("bitagent.referralKey");
    }
  }

  const body = await api("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      referralLink: hasReferral ? location.href : undefined,
      intent: hasReferral ? undefined : "deposit_bitcoin",
      network: "bitcoin-testnet4"
    })
  });
  state = body.state;
  localStorage.setItem("bitagent.workflowId", state.id);
  if (activeReferralKey) localStorage.setItem("bitagent.referralKey", activeReferralKey);
  const intentCopy = {
    deposit_bitcoin: "I’ll help you receive a Bitcoin UTXO in your wallet.",
    starter_strategy: "Your referral opens directly into the starter TradeLayer strategy.",
    withdraw_bitcoin: "I’ll help you withdraw remaining Bitcoin to a normal address."
  };
  addMessage(intentCopy[state.currentIntent]);
  render();
}

async function callTool(name, args = {}) {
  try {
    const body = await api(`/api/tools/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify({ workflowId: state.id, ...args })
    });
    state = body.state;
    render();
  } catch (error) {
    if (error.state) {
      state = error.state;
    } else if (state?.id) {
      try {
        state = (await api(`/api/workflows/${encodeURIComponent(state.id)}`)).state;
      } catch {
        // Preserve the last visible public state if refresh also fails.
      }
    }
    addMessage(error.message, "agent");
    render();
    actionPanel.insertAdjacentHTML("afterbegin", `<div class="card error">${escapeHtml(error.message)}</div>`);
  }
}

function journeyItems() {
  const stage = state.stage;
  const walletDone = state.wallet.status === "connected";
  const depositDone = state.deposit.status === "confirmed";
  const strategyDone = state.events.some((event) => event.type === "starter_strategy.verification_verified");
  const withdrawDone = stage === "withdrawal_verified";
  return [
    ["Wallet", walletDone, !walletDone],
    ["Bitcoin deposit", depositDone, walletDone && !depositDone],
    ["Starter strategy", strategyDone, depositDone && !strategyDone],
    ["Withdraw", withdrawDone, strategyDone && !withdrawDone]
  ];
}

function button(label, action, kind = "primary") {
  return `<button class="${kind}" type="button" data-action="${action}">${escapeHtml(label)}</button>`;
}

function renderSimulation(simulation) {
  const effects = simulation.effects.map((effect) => `
    <div class="effect">
      <span>${escapeHtml(effect.direction)} ${escapeHtml(effect.asset)}</span>
      <strong>${escapeHtml(effect.amount)} ${escapeHtml(effect.unit)}</strong>
    </div>`).join("");
  return `
    <div class="card">
      <p class="eyebrow">Exact simulation</p>
      <h3>${simulation.action === "starter_strategy" ? "Post-only tlBTC → tlUSD order" : "Bitcoin withdrawal"}</h3>
      <div class="effects">${effects}</div>
      <p>Network fee: <strong>${escapeHtml(simulation.fees.networkFeeSats)} sats</strong> ·
        Remaining: <strong>${escapeHtml(simulation.balanceAfterSats)} sats</strong></p>
      ${simulation.quote ? `<p>Quote: $${escapeHtml(simulation.quote.priceUsd)} · expires ${new Date(simulation.expiresAt).toLocaleTimeString()}</p>` : ""}
      ${simulation.destinationAddress ? `<p>Destination</p><p class="mono">${escapeHtml(simulation.destinationAddress)}</p>` : ""}
      ${simulation.payload ? `<p>TradeLayer payload</p><p class="mono">${escapeHtml(simulation.payload)}</p>` : ""}
      <p class="mono">Simulation ${escapeHtml(simulation.hash)}</p>
    </div>`;
}

function render() {
  stageTitle.textContent = state.stage.replaceAll("_", " ");
  journey.innerHTML = journeyItems().map(([label, complete, current]) =>
    `<li class="${complete ? "complete" : current ? "current" : ""}">${label}</li>`
  ).join("");

  referral.innerHTML = state.referral
    ? `Referral <strong>${escapeHtml(state.referral.campaignId)}</strong><br>
       Attribution: ${escapeHtml(state.referral.status)}`
    : "";

  const cards = [];
  if (state.wallet.status !== "connected") {
    cards.push(`<div class="card">
      <h3>Create or connect a wallet</h3>
      <p>Only a public wallet session is shared with BitAgent.</p>
      <div class="button-row">
        ${button("Create demo wallet", "wallet-create")}
        ${button("Connect demo wallet", "wallet-connect", "secondary")}
      </div>
    </div>`);
  } else {
    cards.push(`<div class="card">
      <p class="eyebrow">Wallet connected</p>
      <h3>${escapeHtml(state.wallet.confirmedBalanceSats)} confirmed sats</h3>
      <p class="mono">${escapeHtml(state.wallet.bitcoinAddress)}</p>
    </div>`);
  }

  if (state.wallet.status === "connected" && state.deposit.status === "not_started") {
    cards.push(`<div class="card"><h3>Get a deposit address</h3>
      <p>The address belongs to your connected demo wallet.</p>
      <div class="button-row">${button("Generate deposit address", "deposit-prepare")}</div></div>`);
  }
  if (["awaiting_deposit", "unconfirmed"].includes(state.deposit.status)) {
    cards.push(`<div class="card">
      <p class="eyebrow">Bitcoin deposit</p>
      <h3>${state.deposit.confirmations}/${state.deposit.requiredConfirmations} confirmations</h3>
      <p class="mono">${escapeHtml(state.deposit.address)}</p>
      <p>For this scripted testnet journey, record a deterministic deposit to continue.</p>
      <div class="field-row">
        <input id="deposit-amount" inputmode="numeric" value="250000" aria-label="Demo deposit sats">
        ${button("Record confirmed demo UTXO", "deposit-observe")}
      </div>
    </div>`);
  }
  if (state.deposit.status === "confirmed") {
    cards.push(`<div class="card">
      <p class="eyebrow">UTXO confirmed</p>
      <h3>${escapeHtml(state.deposit.amountSats)} sats received</h3>
      <p class="mono">${escapeHtml(state.deposit.txid)}:${escapeHtml(state.deposit.vout)}</p>
      <p class="mono">UTXO-Ref ${escapeHtml(state.deposit.utxoRef)}</p>
    </div>`);
  }

  if (state.simulation) cards.push(renderSimulation(state.simulation));
  const approvalRetry = ["rejected", "cancelled"].includes(state.pendingApproval?.status);
  if (state.simulation && (!state.pendingApproval || approvalRetry)) {
    const recovery = approvalRetry
      ? `<p>${escapeHtml(state.recoveryInstructions?.join(" ") || "No transaction was executed. Review the saved simulation and try again.")}</p>`
      : "";
    cards.push(`<div class="card ${approvalRetry ? "error" : ""}">
      <h3>${approvalRetry ? "Wallet approval was not completed" : "Wallet approval required"}</h3>
      <p>Review the exact effects and fees above before opening the wallet prompt.</p>
      ${recovery}
      <div class="button-row">${button(approvalRetry ? "Request wallet approval again" : "Request wallet approval", "approval-request")}</div></div>`);
  }
  if (state.pendingApproval?.status === "pending") {
    const walletOwnedRequest = Boolean(state.pendingApproval.walletApprovalRequestId);
    cards.push(`<div class="card">
      <p class="eyebrow">Approval boundary</p>
      <h3>${walletOwnedRequest ? "Approval pending in connected wallet" : "Approve these exact wallet effects?"}</h3>
      <p>${walletOwnedRequest
        ? "Approve or reject the saved request in your wallet, then check its status here."
        : "No action can execute until you approve this simulation hash."}</p>
      <div class="button-row">
        ${button(walletOwnedRequest ? "Check wallet approval" : "Approve in demo wallet", "approval-approve")}
        ${button(walletOwnedRequest ? "Cancel in BitAgent" : "Reject", "approval-reject", "danger")}
      </div>
    </div>`);
  }
  if (state.pendingApproval?.status === "approved" && !state.execution) {
    cards.push(`<div class="card"><h3>Exact action approved</h3>
      <p>The one-time approval is bound to the displayed simulation.</p>
      <div class="button-row">${button("Execute approved action", "execute")}</div></div>`);
  }
  if (state.execution && state.verification?.status === "pending") {
    cards.push(`<div class="card"><h3>Submitted, not yet verified</h3>
      <p class="mono">${escapeHtml(state.execution.txid)}</p>
      <div class="button-row">${button("Verify result", "verify")}</div></div>`);
  }
  if (state.verification?.status === "verified") {
    cards.push(`<div class="card"><p class="eyebrow">Verified</p>
      <h3>${state.verification.action === "starter_strategy" ? "Starter order verified" : "Bitcoin withdrawal verified"}</h3>
      <p class="mono">${escapeHtml(state.verification.orderId || state.verification.txid)}</p>
    </div>`);
  }
  if (state.stage === "strategy_verified") {
    cards.push(`<div class="card"><h3>Withdraw remaining Bitcoin</h3>
      <p>Ask: “Withdraw 50000 sats to &lt;your testnet address&gt;.”</p></div>`);
  }

  if (lastPlan?.suggestedTool) {
    cards.push(`<div class="card"><h3>Structured plan ready</h3>
      <p>${escapeHtml(lastPlan.summary)}</p>
      <div class="button-row">${button("Continue with simulation", "plan-tool")}</div></div>`);
  }
  actionPanel.innerHTML = cards.join("");
}

async function demoTxid() {
  const data = new TextEncoder().encode(`${state.id}:deposit`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

actionPanel.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "wallet-create") return callTool("bitagent.wallet.connect", { mode: "create" });
  if (action === "wallet-connect") return callTool("bitagent.wallet.connect", { mode: "connect" });
  if (action === "deposit-prepare") return callTool("bitagent.deposit.prepare");
  if (action === "deposit-observe") {
    return callTool("bitagent.deposit.observe", {
      txid: await demoTxid(),
      vout: 0,
      amountSats: $("#deposit-amount").value,
      blockHeight: 100,
      currentHeight: 101
    });
  }
  if (action === "approval-request") return callTool("bitagent.wallet.request_approval");
  if (action === "approval-approve") return callTool("bitagent.wallet.resolve_approval", { decision: "approve" });
  if (action === "approval-reject") return callTool("bitagent.wallet.resolve_approval", { decision: "reject" });
  if (action === "execute") return callTool("bitagent.action.execute");
  if (action === "verify") return callTool("bitagent.action.verify");
  if (action === "plan-tool" && lastPlan?.suggestedTool) {
    const tool = lastPlan.suggestedTool;
    lastPlan = null;
    return callTool(tool.name, Object.fromEntries(Object.entries(tool.arguments).filter(([key]) => key !== "workflowId")));
  }
});

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;
  addMessage(message, "user");
  messageInput.value = "";
  try {
    let body;
    if (dagRuntime?.modelAvailable === true) {
      try {
        body = await api(`/api/workflows/${encodeURIComponent(state.id)}/dag-propose`, {
          method: "POST",
          body: JSON.stringify({ message })
        });
        if (body.receipt?.ok === false) {
          addMessage("The local model proposal was normalized by the deterministic safety controller.");
        }
      } catch {
        addMessage("The local model is temporarily unavailable. Continuing with the deterministic safety planner.");
      }
    }
    if (!body) {
      body = await api(`/api/workflows/${encodeURIComponent(state.id)}/message`, {
        method: "POST",
        body: JSON.stringify({ message })
      });
    }
    lastPlan = body.plan;
    state = body.state;
    addMessage(body.plan.summary);
    render();
  } catch (error) {
    addMessage(error.message);
  }
});

document.querySelectorAll("[data-prompt]").forEach((item) => {
  item.addEventListener("click", () => {
    messageInput.value = item.dataset.prompt;
    messageInput.focus();
  });
});

$("#resume").addEventListener("click", async () => {
  if (!state) return start();
  const body = await api(`/api/workflows/${encodeURIComponent(state.id)}`);
  state = body.state;
  addMessage("Workflow state refreshed from the persistent store.");
  render();
});

start().catch((error) => {
  addMessage(error.message);
  stageTitle.textContent = "Unable to start";
});
