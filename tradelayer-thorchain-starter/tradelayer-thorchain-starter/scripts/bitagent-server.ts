import { createBitAgentServer } from "../src/launch/server.js";

const port = Number(process.env.BITAGENT_PORT || 8790);
const server = createBitAgentServer();
server.listen(port, "127.0.0.1", () => {
  console.log(`BitAgent launch kernel: http://127.0.0.1:${port}`);
});

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
