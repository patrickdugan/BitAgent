import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const uiDirectory = new URL("../launch-ui/", import.meta.url);

test("phone-first referral surface includes economics, goals, permissions, ranking, review, share, tracking, and deletion", async () => {
  const html = await fs.readFile(new URL("referrals.html", uiDirectory), "utf8");
  for (const text of [
    "Referral earnings", "0.05 bp", "$1", "$5", "$10", "Permission ladder",
    "Local ranking", "Review the message", "native share sheet", "campaign tracker",
    "Delete local contact data", "Vested tokens", "Unvested tokens"
  ]) assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(html, /Your agent currently receives your 0\.05 bp sponsor credit/);
  assert.match(html, /first eligible settled trade/i);
});

test("browser implementation keeps contacts local and gives final-send control to the OS and human", async () => {
  const source = await fs.readFile(new URL("referrals.js", uiDirectory), "utf8");
  assert.match(source, /navigator\.contacts\.select/);
  assert.match(source, /preferAndroid17: true/);
  assert.match(source, /fallback: "ACTION_PICK"/);
  assert.match(source, /navigator\.share/);
  assert.match(source, /I completed the send|record-sent/);
  assert.match(source, /localStorage\.removeItem\(CONTACT_KEY\)/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendSMS|WhatsApp Business|READ_CALL_LOG|READ_SMS|SEND_SMS/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
});

test("contact labels contain no prohibited sensitive inference targets", async () => {
  const source = await fs.readFile(new URL("referrals.js", uiDirectory), "utf8");
  for (const sensitive of [
    "poverty", "debt", "desperation", "race", "ethnicity", "religion", "political",
    "health_status", "disability", "immigration", "sexual_orientation", "minor_status"
  ]) assert.doesNotMatch(source, new RegExp(`['\"]${sensitive}['\"]`, "i"));
});
