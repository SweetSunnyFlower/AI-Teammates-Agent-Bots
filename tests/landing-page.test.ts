import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

test("the landing page presents the complete product story", () => {
  const page = read("app/(routes)/(landing)/page.tsx");

  assert.match(page, /把工作交给一支 AI 团队。[\s\S]*?你只负责最后点头。/);
  assert.match(page, /一句话进来，一组结果出去。/);
  assert.match(page, /不是一个聊天框，而是一间会工作的办公室。/);
  assert.match(page, /自动化可以很快，但最后一步必须是你。/);
  assert.match(page, /你的团队，运行在你的服务器上。/);
  assert.match(page, /id="how-it-works"/);
  assert.match(page, /id="capabilities"/);
  assert.match(page, /id="safety"/);
  assert.match(page, /id="self-hosted"/);
});

test("the landing page exposes its primary actions and internal anchors", () => {
  const page = read("app/(routes)/(landing)/page.tsx");

  assert.match(page, /href="\/auth\/login"/);
  assert.match(page, /href="\/workspace"/);
  assert.match(page, /"#how-it-works"/);
  assert.match(page, /"#capabilities"/);
  assert.match(page, /"#safety"/);
  assert.match(page, /"#self-hosted"/);
});

test("the landing page stays static and uses the real office capture", () => {
  const page = read("app/(routes)/(landing)/page.tsx");
  const asset = path.resolve("public/dotty-office.png");

  assert.doesNotMatch(page, /["']use client["']/);
  assert.doesNotMatch(page, /fetch\(|DATABASE_URL|getUser|getSession/);
  assert.match(page, /import Image from "next\/image"/);
  assert.match(page, /src="\/dotty-office\.png"/);
  assert.equal(existsSync(asset), true);
});

test("the landing page extends the field-notes visual system", () => {
  const css = read("app/(routes)/(landing)/landing.module.css");

  assert.match(css, /var\(--paper\)/);
  assert.match(css, /var\(--lawn\)/);
  assert.match(css, /var\(--ink\)/);
  assert.match(css, /var\(--night\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /grid-template-columns/);
});
