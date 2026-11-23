import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("the Tailwind Turbopack rule preserves CSS Module semantics", () => {
  const config = readFileSync(path.resolve("next.config.ts"), "utf8");
  const rule = config.match(/"\*\.css":\s*\{([\s\S]*?)\n\s{6}\},/)?.[1] ?? "";

  assert.match(rule, /@tailwindcss\/turbopack/);
  assert.doesNotMatch(rule, /as:\s*["']\*\.css["']/);
});
