import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

test("the document language and metadata are Chinese", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /lang="zh-CN"/);
  assert.match(layout, /description:\s*"[^"]*[\u4e00-\u9fff][^"]*"/);
});

test("the AI prompt explicitly requires Simplified Chinese", () => {
  const prompt = read("lib/chat/bot-context.ts");
  assert.match(prompt, /简体中文/);
  assert.doesNotMatch(prompt, /Be brief and friendly, like a capable coworker/);
});

test("the office shell uses Chinese status and panel titles", () => {
  const status = read("lib/office/status.ts");
  const panels = read("components/panels/left-column.tsx");
  assert.match(status, /工作中/);
  assert.match(status, /等待中/);
  assert.match(status, /休息中/);
  assert.match(panels, /待我处理/);
});
