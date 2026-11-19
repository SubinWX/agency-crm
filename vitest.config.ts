import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DB = "postgresql://crm:crm_dev_password@localhost:5433/crm_test?schema=public&connection_limit=20";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    env: { DATABASE_URL: TEST_DB, BUSINESS_TIMEZONE: "Asia/Kolkata", NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMTIzNDU=", APP_URL: "https://crm.test" },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
