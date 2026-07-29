import { listActivityFeed } from "../src/adapters/walletAdapter.js";
import { resetActivities } from "../src/activityStore.js";
import { runFinancialSurvivalDemo } from "../src/survival/harness.js";
import { resetSurvivalJournal } from "../src/survival/journal.js";

async function main() {
  await resetActivities();
  await resetSurvivalJournal();
  const result = await runFinancialSurvivalDemo();
  const activities = await listActivityFeed();
  console.log(JSON.stringify({ result, activities }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
