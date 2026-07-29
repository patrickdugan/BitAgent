import { listActivityFeed } from "../src/adapters/walletAdapter.js";
import { resetActivities } from "../src/activityStore.js";
import { runOnboardingDemo } from "../src/onboarding.js";

async function main() {
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
