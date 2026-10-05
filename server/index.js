import { createExplorerServer } from "./app.js";
import { readConfig } from "./config.js";

try {
  const config = readConfig();
  const application = await createExplorerServer({ config });
  await application.listen();
  console.log(`Vitosha Peak Explorer running at ${config.publicOrigin || `http://${config.host}:${config.port}`} (${config.weatherMode} weather).`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("Finishing requests and closing the server…");
    try { await application.close(); } catch { process.exitCode = 1; }
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exitCode = 1;
}
