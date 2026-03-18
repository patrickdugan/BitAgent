import { createWalletActivityServer, listActivityFeed } from "../src/adapters/walletAdapter.js";
import { demoDefaults } from "../src/config.js";

async function main() {
  if (process.argv.includes("--serve")) {
    await createWalletActivityServer(demoDefaults.walletFeedPort);
    console.log(`activity feed listening on http://localhost:${demoDefaults.walletFeedPort}`);
    return;
  }

  console.log(JSON.stringify(await listActivityFeed(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
