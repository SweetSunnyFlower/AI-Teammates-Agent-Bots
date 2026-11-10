import { defineConfig } from "@trigger.dev/sdk";

// Background runs for Dotty bots. Tasks live in ./trigger.
// The project ref comes from .env.local (TRIGGER_PROJECT_REF) — see .env.example.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_set_TRIGGER_PROJECT_REF_in_env_local",
  dirs: ["./trigger"],
  runtime: "node-22",
  // A bot run may browse, code or wait; give it up to an hour of compute (waits don't count).
  maxDuration: 3600,
  logLevel: "info",
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 20000, factor: 2, randomize: true },
  },
});
