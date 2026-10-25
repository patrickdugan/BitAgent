import { listActivityFeed } from "../src/adapters/walletAdapter.js";
import { resetActivities } from "../src/activityStore.js";
import { runOnboardingDemo } from "../src/onboarding.js";

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: npm run demo:onboard:direct

Required environment: DEST_BTC_ADDRESS or DEST_LTC_ADDRESS.
For the NEAR Intents rail, also provide NEAR_INTENTS_REFUND_ADDRESS.
This demo prepares a quote and simulated intake artifacts only; it never signs,
broadcasts, or moves funds.`);
    return;
  }
  await resetActivities();
  const result = await runOnboardingDemo();
  const activities = await listActivityFeed();
  console.log(
    JSON.stringify(
      {
        result,
        activities
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
