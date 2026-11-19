/**
 * Background sender for Email / SMS / WhatsApp (outbox worker).
 * Run alongside the web app:  npm run worker
 * Safe to run several copies — rows are claimed with SKIP LOCKED.
 */
import "./load-env"; // must be first: DATABASE_URL, SECRETS_ENCRYPTION_KEY, APP_URL
import { prisma } from "../src/server/db";
import { processQueue } from "../src/server/modules/notifications/dispatch";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
let stopping = false;

async function loop() {
  console.log(`[worker] started, polling every ${INTERVAL_MS / 1000}s (encryption key ${process.env.SECRETS_ENCRYPTION_KEY ? "loaded" : "MISSING"})`);
  while (!stopping) {
    try {
      let batch;
      do {
        batch = await processQueue({ limit: 20 });
        const n = batch.sent + batch.failed + batch.retried + batch.skipped;
        if (n) console.log(`[worker] sent=${batch.sent} retry=${batch.retried} failed=${batch.failed} skipped=${batch.skipped}`);
      } while (!stopping && batch.sent + batch.failed + batch.retried + batch.skipped >= 20);
    } catch (e) {
      console.error("[worker] error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
loop();
