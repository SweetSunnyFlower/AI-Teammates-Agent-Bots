import {
  defineConfig
} from "./chunk-L7UPS7X3.mjs";
import "./chunk-KLNFYQGZ.mjs";
import "./chunk-Q4REAINQ.mjs";
import "./chunk-F65DORNJ.mjs";
import "./chunk-JMBGUL5N.mjs";
import {
  init_esm
} from "./chunk-SOPMFPK3.mjs";

// trigger.config.ts
init_esm();
var trigger_config_default = defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_set_TRIGGER_PROJECT_REF_in_env_local",
  dirs: ["./trigger"],
  runtime: "node-22",
  // A bot run may browse, code or wait; give it up to an hour of compute (waits don't count).
  maxDuration: 3600,
  logLevel: "info",
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 2, minTimeoutInMs: 2e3, maxTimeoutInMs: 2e4, factor: 2, randomize: true }
  },
  build: {}
});
var resolveEnvVars = void 0;
export {
  trigger_config_default as default,
  resolveEnvVars
};
//# sourceMappingURL=trigger.config.mjs.map
