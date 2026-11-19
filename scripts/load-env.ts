/** Load .env / .env.local exactly like Next.js does. Import this before anything else. */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
