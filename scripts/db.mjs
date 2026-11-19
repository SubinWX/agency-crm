// Local development PostgreSQL (no Docker / system install required).
// Usage: npm run db  — keeps running until Ctrl+C. Data persists in ./.pgdata
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dataDir = "./.pgdata";
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "crm",
  password: "crm_dev_password",
  port: 5433,
  persistent: true,
});

if (!existsSync(dataDir)) await pg.initialise();
await pg.start();
for (const db of ["crm_dev", "crm_test"]) {
  try { await pg.createDatabase(db); } catch { /* exists */ }
}
console.log("PostgreSQL running on localhost:5433 (databases: crm_dev, crm_test)");

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
