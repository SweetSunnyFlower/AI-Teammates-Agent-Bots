import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as officeStatus from "../lib/office/status";

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

test("the bot status appends the current activity after the main label", () => {
  const statusLine = (officeStatus as typeof officeStatus & {
    statusLine?: (detail: string, status: "working" | "waiting" | "error" | "resting") => string;
  }).statusLine;
  assert.equal(statusLine?.("Planning your request", "working"), "工作中 · 正在规划你的请求");
  assert.equal(statusLine?.("Resting", "resting"), "休息中");
});

test("Chinese controls use centered line boxes that do not clip glyphs", () => {
  const css = read("app/globals.css");
  const pill = css.match(/\.fn-pill \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  const status = read("components/ui/status.tsx");
  const tabs = read("components/ui/tabs.tsx");

  assert.match(pill, /justify-center/);
  assert.match(pill, /leading-\[1\.25\]/);
  assert.match(status, /justify-center/);
  assert.match(status, /leading-normal/);
  assert.match(tabs, /min-h-8/);
  assert.doesNotMatch(tabs, /h-\[calc\(100%-1px\)\]/);
});
