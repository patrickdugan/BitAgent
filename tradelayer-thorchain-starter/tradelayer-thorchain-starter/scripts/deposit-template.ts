import * as dotenv from "dotenv";
import { submitTemplateBoundDeposit } from "../src/evmTemplateDeposit.js";

dotenv.config();

async function main() {
  const result = await submitTemplateBoundDeposit();
  console.log(
    JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
