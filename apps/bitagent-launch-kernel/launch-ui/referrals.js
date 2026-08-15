const CONTACT_KEY = "bitagent.referral.contacts.v1";
const SALT_KEY = "bitagent.referral.deviceSalt.v1";
const DASHBOARD_KEY = "bitagent.referral.dashboard.v1";
const labels = [
  "interested_in_crypto", "interested_in_markets", "interested_in_side_income", "owns_pc",
  "phone_only", "android_user", "needs_local_language", "trusted_relationship",
  "likely_to_try_recommendation", "needs_setup_help", "experienced_wallet_user", "never_invite"
];
const positiveWeights = {
  interested_in_crypto: 16, interested_in_markets: 18, interested_in_side_income: 4,
  owns_pc: 5, phone_only: 8, android_user: 5, needs_local_language: -2,
  trusted_relationship: 14, likely_to_try_recommendation: 18, needs_setup_help: -6,
  experienced_wallet_user: 12, never_invite: -10000
};

const $ = (selector) => document.querySelector(selector);
const state = { contacts: loadContacts(), selectedId: null, permission: 0 };

function normalize(value) {
  return String(value || "").normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ").trim();
}

function loadContacts() {
  try { return JSON.parse(localStorage.getItem(CONTACT_KEY) || "[]"); } catch { return []; }
}

function saveContacts() {
  localStorage.setItem(CONTACT_KEY, JSON.stringify(state.contacts));
}

function deviceSalt() {
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    salt = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(SALT_KEY, salt);
  }
  return salt;
}

async function localHash(value) {
  const data = new TextEncoder().encode(`${deviceSalt()}\n${normalize(value)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function selectedLabels() {
  return [...document.querySelectorAll("#labels input:checked")].map((input) => input.value);
}

async function addCandidate(name, identity = name) {
  const displayName = normalize(name) || "Contact";
  const candidate = {
    id: await localHash(identity || displayName), displayName, labels: selectedLabels(),
    relationship: Number($("#relationship").value), score: 0,
    explanation: "Not ranked yet.", campaign: "candidate", followUps: 0
  };
  const existing = state.contacts.findIndex((row) => row.id === candidate.id);
  if (existing >= 0) state.contacts[existing] = candidate; else state.contacts.push(candidate);
  state.selectedId = candidate.id;
  saveContacts();
  render();
}

async function pickContacts(level) {
  state.permission = level;
  $("#permission-level").textContent = `Level ${level}`;
  if (level === 0) return;
  if (level === 3) {
    const disclosure = "A complete scan may read names, phone numbers, emails, and address-book membership locally. It never reads notes or photos, never uploads records, can be revoked, and can be deleted here.";
    $("#permission-disclosure").textContent = disclosure;
    if (!confirm(`${disclosure}\n\nContinue only in a native shell that supports explicit Level 3 access?`)) return;
    if (!window.BitAgentNativeContacts?.scanWithDisclosure) {
      $("#permission-disclosure").textContent += " This browser has no broad-scan adapter; no permission was requested.";
      return;
    }
    const records = await window.BitAgentNativeContacts.scanWithDisclosure({ fields: ["name", "phone", "email"] });
    for (const record of records) await addCandidate(record.name, record.phone || record.email || record.name);
    return;
  }
  try {
    let records;
    if (window.BitAgentNativeContacts?.pick) {
      records = await window.BitAgentNativeContacts.pick({ multiple: level === 2, preferAndroid17: true, fallback: "ACTION_PICK", fields: ["name", "phone", "email"] });
    } else if (navigator.contacts?.select) {
      records = await navigator.contacts.select(["name", "tel", "email"], { multiple: level === 2 });
    } else {
      $("#permission-disclosure").textContent = "The system contact picker is unavailable here. Use the manual local fallback; no contact permission was requested.";
      return;
    }
    for (const record of records || []) {
      const name = Array.isArray(record.name) ? record.name[0] : record.name;
      const phone = Array.isArray(record.tel) ? record.tel[0] : record.phone;
      const email = Array.isArray(record.email) ? record.email[0] : record.email;
      await addCandidate(name, phone || email || name);
    }
  } catch (error) {
    $("#permission-disclosure").textContent = `Contact selection was denied or cancelled. Link copying still works. ${normalize(error?.message)}`;
  }
}

function rank() {
  for (const contact of state.contacts) {
    if (contact.labels.includes("never_invite") || ["not_interested", "do_not_contact"].includes(contact.campaign)) {
      contact.score = -10000;
      contact.explanation = "Suppressed by your local preference.";
      continue;
    }
    const effort = contact.labels.includes("needs_setup_help") ? 12 : contact.labels.includes("experienced_wallet_user") ? 2 : 6;
    const relationshipCost = contact.relationship <= 1 ? 12 : 3;
    contact.score = contact.labels.reduce((sum, label) => sum + (positiveWeights[label] || 0), 0) + contact.relationship * 8 - effort - relationshipCost;
    const reasons = [];
    if (contact.labels.includes("interested_in_markets")) reasons.push("interested in markets");
    if (contact.labels.includes("android_user")) reasons.push("comfortable with Android");
    if (contact.labels.includes("likely_to_try_recommendation")) reasons.push("likely to try something you recommend");
    if (contact.labels.includes("phone_only")) reasons.push("suited to the phone-only flow");
    if (contact.labels.includes("needs_setup_help")) reasons.push("may need setup help");
    if (contact.relationship <= 1) reasons.push("the relationship is marked as weak");
    contact.explanation = reasons.length ? `You marked this person as ${reasons.join(", ")}.` : "Few explicit product-fit labels; ranked conservatively.";
  }
  state.contacts.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  saveContacts();
  render();
}

function canonicalLink() {
  const raw = normalize($("#canonical-link").value);
  const url = new URL(raw);
  const fields = [...url.searchParams.keys()];
  const allowed = ["invitation", "policy", "sig"];
  if (url.pathname !== "/invite" || fields.length !== 3 || fields.some((field) => !allowed.includes(field))
    || allowed.some((field) => url.searchParams.getAll(field).length !== 1 || !url.searchParams.get(field))) {
    throw new Error("Use the exact host-issued /invite link with invitation, policy, and sig only.");
  }
  return url.toString();
}

function activeContact() {
  return state.contacts.find((row) => row.id === state.selectedId && row.score > -10000);
}

function draftInitial() {
  const contact = activeContact();
  if (!contact) throw new Error("Choose a ranked contact first.");
  const reason = contact.explanation.replace(/^You marked this person as /, "").replace(/\.$/, "");
  $("#message-review").value = `Hey ${normalize(contact.displayName)}, I’ve been trying BitAgent, a self-custodial trading agent that can work from a phone. I thought it might interest you because ${reason}. I receive a tiny referral fee if someone joins through my link. Want me to send the details?\n\nDrafted with BitAgent`;
  contact.campaign = "drafted";
  saveContacts(); render();
}

function draftDetails() {
  const link = canonicalLink();
  const spanish = $("#spanish").checked;
  $("#message-review").value = spanish
    ? `Aquí tienes el enlace de BitAgent: ${link}\n\nEs un enlace de referido pagado. Recibo 0.05 puntos básicos de tus operaciones elegibles durante un año si te unes mediante el enlace. Eso equivale a $0.50 por cada $100,000 de volumen elegible. Conservas el control de tu billetera y la aplicación muestra la comisión antes de la autorización.\n\nDrafted with BitAgent`
    : `Here’s the BitAgent link: ${link}\n\nIt is a paid referral link. I receive 0.05 basis points of your eligible trading for one year if you join through it. That is $0.50 per $100,000 of eligible volume. You keep control of your wallet, and the app shows the fee before authorization.\n\nDrafted with BitAgent`;
}

async function openShare() {
  const text = normalize($("#message-review").value.replace(/\n/g, " \n ")).replace(/ \n /g, "\n");
  if (!text) throw new Error("Review a message first.");
  if (/\$\s*5\s+per\s+referral/i.test(text)) throw new Error("Misleading per-referral bounty language is blocked.");
  const contact = activeContact();
  if (contact) contact.campaign = "share_prepared";
  saveContacts(); render();
  if (navigator.share) await navigator.share({ title: "BitAgent referral", text });
  else await navigator.clipboard.writeText(text);
  $("#share-status").textContent = navigator.share
    ? "Share sheet opened. BitAgent did not press send or record a send."
    : "Message copied because the native share sheet is unavailable. BitAgent did not send it.";
}

function renderCandidates() {
  const visible = state.contacts.filter((row) => row.score > -10000);
  $("#candidate-list").innerHTML = visible.length ? visible.map((contact) => `
    <button type="button" class="candidate ${contact.id === state.selectedId ? "selected" : ""}" data-contact="${contact.id}">
      <span><strong>${escapeHtml(contact.displayName)}</strong><small>${escapeHtml(contact.explanation)}</small></span><b>${contact.score}</b>
    </button>`).join("") : '<p class="muted">No eligible contacts selected.</p>';
  document.querySelectorAll("[data-contact]").forEach((button) => button.addEventListener("click", () => {
    state.selectedId = button.dataset.contact; render();
  }));
}

function renderCampaigns() {
  $("#campaign-list").innerHTML = state.contacts.length ? state.contacts.map((contact) => `
    <div class="campaign-row"><span><strong>${escapeHtml(contact.displayName)}</strong><small>${escapeHtml(contact.campaign.replaceAll("_", " "))}</small></span>
      <span class="campaign-actions">
        ${contact.campaign === "human_sent" && contact.followUps === 0 ? `<button data-follow="${contact.id}" class="secondary">Approve one follow-up</button>` : ""}
        ${!["not_interested", "do_not_contact"].includes(contact.campaign) ? `<button data-stop="${contact.id}" class="secondary">Not interested</button><button data-dnc="${contact.id}" class="danger">Do not contact</button>` : ""}
      </span></div>`).join("") : '<p class="muted">Campaign state stays on this device.</p>';
  document.querySelectorAll("[data-follow]").forEach((button) => button.addEventListener("click", () => {
    const row = state.contacts.find((item) => item.id === button.dataset.follow);
    if (row && row.followUps === 0) { row.followUps = 1; row.campaign = "follow_up_approved"; saveContacts(); render(); }
  }));
  document.querySelectorAll("[data-stop]").forEach((button) => button.addEventListener("click", () => suppress(button.dataset.stop, "not_interested")));
  document.querySelectorAll("[data-dnc]").forEach((button) => button.addEventListener("click", () => suppress(button.dataset.dnc, "do_not_contact")));
}

function suppress(id, campaign) {
  const row = state.contacts.find((item) => item.id === id);
  if (row) { row.campaign = campaign; saveContacts(); render(); }
}

function renderDashboard() {
  let dashboard = {};
  try { dashboard = JSON.parse(localStorage.getItem(DASHBOARD_KEY) || "{}"); } catch {}
  const accrualMicrousd = BigInt(dashboard.feeValueAtAccrualAtomic || "0");
  const tokenMicrousd = BigInt(dashboard.currentEstimatedTokenValueAtomic || "0");
  const money = (value) => `$${(Number(value) / 1_000_000).toFixed(2)}`;
  $("#fee-earned").textContent = money(accrualMicrousd);
  $("#accrual-value").textContent = money(accrualMicrousd);
  $("#token-value").textContent = money(tokenMicrousd);
  $("#vested-value").textContent = dashboard.vestedTokenUnits || "0";
  $("#unvested-value").textContent = dashboard.unvestedTokenUnits || "0";
  if (dashboard.referrerDisplayName && dashboard.expiryHeight) {
    $("#beneficiary-copy").textContent = `${dashboard.referrerDisplayName} receives your 0.05 bp sponsor credit until block ${dashboard.expiryHeight}. It then returns to your agent.`;
    $("#term-progress").textContent = `Block term: ${dashboard.startHeight || "—"} → ${dashboard.expiryHeight}`;
  }
}

function renderGoal(goal) {
  document.querySelectorAll("[data-goal]").forEach((button) => button.classList.toggle("active", Number(button.dataset.goal) === goal));
  const total = goal * 200000;
  $("#goal-title").textContent = `$${total.toLocaleString()} total eligible notional`;
  $("#goal-examples").innerHTML = [1, 10, 20].map((count) => `<li>${count} active referral${count === 1 ? "" : "s"} producing $${(total / count).toLocaleString()} each</li>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function render() { renderCandidates(); renderCampaigns(); renderDashboard(); }

$("#labels").insertAdjacentHTML("beforeend", labels.map((label) => `<label><input type="checkbox" value="${label}"> ${label.replaceAll("_", " ")}</label>`).join(""));
document.querySelectorAll("[data-permission]").forEach((button) => button.addEventListener("click", () => pickContacts(Number(button.dataset.permission)).catch(showError)));
document.querySelectorAll("[data-goal]").forEach((button) => button.addEventListener("click", () => renderGoal(Number(button.dataset.goal))));
$("#add-contact").addEventListener("click", () => addCandidate($("#contact-name").value).catch(showError));
$("#rank").addEventListener("click", rank);
$("#draft-initial").addEventListener("click", () => { try { draftInitial(); } catch (error) { showError(error); } });
$("#draft-details").addEventListener("click", () => { try { draftDetails(); } catch (error) { showError(error); } });
$("#copy-link").addEventListener("click", async () => { try { await navigator.clipboard.writeText(canonicalLink()); $("#share-status").textContent = "Verified link copied. No contact permission was used."; } catch (error) { showError(error); } });
$("#open-share").addEventListener("click", () => openShare().catch(showError));
$("#record-sent").addEventListener("click", () => {
  const contact = activeContact();
  if (!contact || contact.campaign !== "share_prepared") return showError(new Error("Prepare and complete the share action first."));
  contact.campaign = "human_sent"; saveContacts(); render();
  $("#share-status").textContent = "Recorded locally as human sent. One follow-up remains available only with your approval.";
});
$("#delete-local").addEventListener("click", () => {
  if (!confirm("Delete all local referral-contact names, labels, drafts, and campaign state from this device?")) return;
  localStorage.removeItem(CONTACT_KEY); localStorage.removeItem(SALT_KEY);
  state.contacts = []; state.selectedId = null; $("#message-review").value = ""; render();
});

function showError(error) { $("#share-status").textContent = normalize(error?.message || error); }

const current = new URL(location.href);
if (["invitation", "policy", "sig"].every((field) => current.searchParams.has(field))) $("#canonical-link").value = current.href;
renderGoal(5);
render();
