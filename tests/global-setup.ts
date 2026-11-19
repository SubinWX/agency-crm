import { execSync } from "node:child_process";

/**
 * Prepare the dedicated test database (crm_test) without destroying data:
 * apply pending migrations and run the idempotent seed. Tests use random
 * far-future dates, so leftovers from earlier runs never interfere.
 */
export default function setup() {
  const env = { ...process.env, DATABASE_URL: "postgresql://crm:crm_dev_password@localhost:5433/crm_test?schema=public" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
