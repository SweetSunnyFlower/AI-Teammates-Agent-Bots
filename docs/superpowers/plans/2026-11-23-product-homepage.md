# Dotty Product Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal landing screen with a complete, responsive product homepage that explains Dotty's AI team, visible workflow, approval boundary, and self-hosted architecture.

**Architecture:** Build the page as a static Next.js Server Component with semantic sections and no runtime data access. Keep page-specific visual CSS in a CSS Module, reuse the existing field-notes tokens from `app/globals.css`, and use the real Dotty office capture as a responsive `next/image` product visual.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript, CSS Modules, `next/image`, `next/link`, `lucide-react`, Node test runner.

## Global Constraints

- The product remains Simplified Chinese only.
- The page must not use `use client`, database access, authentication state, or client-side data fetching.
- Do not add dependencies.
- Do not invent customers, testimonials, usage counts, pricing, or efficiency claims.
- Reuse the existing palette: `#E3DCCB`, `#FBF7F0`, `#F4EEE3`, `#EBE3D4`, `#2B2620`, `#7D7468`, `#8CC15D`, `#F0DAB1`, `#20263D`.
- Do not use purple-pink gradients, emoji icons, or a generic AI SaaS layout.
- Respect `prefers-reduced-motion`.
- `/` must stay static or prerenderable.

---

### Task 1: Build the tested landing-page product contract

**Files:**
- Create: `tests/landing-page.test.ts`
- Create: `tests/next-css-modules.test.ts`
- Modify: `next.config.ts`
- Read: `app/(routes)/(landing)/page.tsx`
- Read: `app/(routes)/(landing)/landing.module.css`
- Read: `public/dotty-office.png`

**Interfaces:**
- Consumes: the selected “产品现场手册” design in `docs/superpowers/specs/2026-11-23-product-homepage-design.md`.
- Produces: source-level regression coverage for the required headings, sections, links, static-rendering contract, screenshot asset, and visual-system markers.

- [x] **Step 1: Write the failing test**

Create `tests/landing-page.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

test("the landing page presents the complete product story", () => {
  const page = read("app/(routes)/(landing)/page.tsx");

  assert.match(page, /把工作交给一支 AI 团队。你只负责最后点头。/);
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
  assert.match(page, /href="#how-it-works"/);
  assert.match(page, /href="#capabilities"/);
  assert.match(page, /href="#safety"/);
  assert.match(page, /href="#self-hosted"/);
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
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test tests/landing-page.test.ts
```

Expected: the first test fails because the current page lacks the new product-story headings, and the visual-system test fails because the CSS Module does not exist.

### Task 1 (continued): Build the static product homepage

**Files:**
- Modify: `app/(routes)/(landing)/page.tsx`
- Create: `app/(routes)/(landing)/landing.module.css`
- Create: `public/dotty-office.png` from `_design/dotty-home.png`
- Test: `tests/landing-page.test.ts`

**Interfaces:**
- Consumes: `next/link`, `next/image`, `lucide-react`, and the existing CSS custom properties in `app/globals.css`.
- Produces: the default-exported server component `LandingPage` at `/` and page metadata with the product title and description.

- [x] **Step 1: Copy the real product capture**

Run:

```bash
cp _design/dotty-home.png public/dotty-office.png
```

Expected: `public/dotty-office.png` exists and preserves the `1920×1080` office capture.

- [x] **Step 2: Implement the semantic page structure**

Replace the page with a static Server Component whose top-level structure is:

```tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Code2,
  Database,
  GitPullRequest,
  Layers3,
  Mail,
  Search,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Dotty — 把工作交给一支 AI 团队",
  description:
    "Dotty 在一个自托管的迷你办公室里组织 AI Bot。总控规划、部门执行，发送、支付、发布、删除和合并必须经过你的批准。",
};

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>...</header>
      <main>
        <section className={styles.hero}>...</section>
        <section className={styles.capabilityBand}>...</section>
        <section id="how-it-works">...</section>
        <section id="capabilities">...</section>
        <section id="safety">...</section>
        <section id="self-hosted">...</section>
        <section className={styles.finalCta}>...</section>
      </main>
      <footer>...</footer>
    </div>
  );
}
```

The completed JSX must include:

```tsx
<h1>把工作交给一支 AI 团队。你只负责最后点头。</h1>
<p>总控 Bot 负责规划和分派，各楼层负责执行。发送、支付、发布、删除和合并，都会停在“待我处理”，只有你批准后才会发生。</p>

<Link href="/auth/login">开始组建团队 <ArrowRight aria-hidden="true" /></Link>
<Link href="/workspace">看看办公室</Link>

<Image
  src="/dotty-office.png"
  alt="Dotty 办公室界面，显示楼层、Bot 团队、任务状态和实时动态"
  width={1920}
  height={1080}
  sizes="(max-width: 900px) 100vw, 58vw"
  loading="eager"
/>

<ol>
  <li>交办</li>
  <li>拆解</li>
  <li>执行</li>
  <li>审阅</li>
</ol>

<p>发送</p>
<p>支付</p>
<p>发布</p>
<p>删除</p>
<p>合并</p>
```

Use `Bot`, `Building2`, `CalendarClock`, `Code2`, `Database`, `GitPullRequest`, `Layers3`, `Mail`, `Search`, `Server`, `ShieldCheck`, and `Workflow` as inline SVG icons beside text. Do not use emoji.

- [x] **Step 3: Implement the page-specific CSS Module**

Create `app/(routes)/(landing)/landing.module.css` with these required foundations:

```css
.page {
  min-height: 100dvh;
  overflow: hidden;
  color: var(--ink);
  background-color: var(--paper);
  background-image:
    radial-gradient(rgb(43 38 32 / 0.055) 0.75px, transparent 0.75px),
    radial-gradient(90% 45% at 50% 0%, rgb(255 255 255 / 0.46), transparent 78%);
  background-size: 14px 14px, 100% 100%;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: clamp(48px, 7vw, 104px);
}

.productFrame {
  position: relative;
  overflow: hidden;
  border: 2px solid var(--ink);
  border-radius: 22px;
  background: var(--panel);
  box-shadow:
    0 8px 0 var(--ink),
    0 34px 60px -32px rgb(43 38 32 / 0.65);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page *,
  .page *::before,
  .page *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Complete the rest of the module with:

- A 1280px content container and 32px desktop gutters.
- The separate floating navigation pills from the existing product chrome.
- Fluid hero title using `clamp(42px, 6vw, 82px)` and a 3.5:1 size contrast against body text.
- A dark capability card, paper capability cards, status chips, approval sample, self-hosted panel, final CTA, and footer.
- 2×2 step/capability layouts on tablet.
- Single-column layouts and 20px gutters below 720px.
- Focus-visible rings on all links.
- A `scroll-margin-top` on every anchor target.
- No horizontal scrolling at 375px.

- [x] **Step 4: Run the contract tests**

Run:

```bash
node --import tsx --test tests/landing-page.test.ts
```

Expected: all four tests pass.

- [x] **Step 5: Run type checking**

Run:

```bash
npx tsc --noEmit
```

Expected: exit code 0 with no TypeScript errors.

- [x] **Step 6: Commit the implementation**

```bash
git add "app/(routes)/(landing)/page.tsx" \
  "app/(routes)/(landing)/landing.module.css" \
  tests/landing-page.test.ts \
  public/dotty-office.png
git commit -m "feat: build product homepage"
```

### Task 2: Verify responsive presentation and refine the result

**Files:**
- Modify: `app/(routes)/(landing)/page.tsx`
- Modify: `app/(routes)/(landing)/landing.module.css`
- Test: `tests/landing-page.test.ts`

**Interfaces:**
- Consumes: the running development server at `http://localhost:3000`.
- Produces: verified desktop, tablet, and mobile layouts with no console errors, overflow, clipped text, or broken links.

- [x] **Step 1: Verify the desktop page**

Open `http://localhost:3000` in the agent browser at `1440×1000`, then confirm:

```text
把工作交给一支 AI 团队。你只负责最后点头。
一句话进来，一组结果出去。
不是一个聊天框，而是一间会工作的办公室。
自动化可以很快，但最后一步必须是你。
你的团队，运行在你的服务器上。
```

Take a full-page screenshot and inspect spacing, image sharpness, connector lines, approval sample, and footer alignment.

- [x] **Step 2: Verify tablet and mobile**

Repeat the browser inspection at `768×1024` and `375×812`. Confirm:

```text
- No horizontal scroll
- Navigation fits without clipping
- The hero image keeps its 16:9 aspect ratio
- Buttons are at least 44px tall
- Steps and cards become a readable single column
- No text overlaps the image, borders, or footer
```

- [x] **Step 3: Verify interaction and console health**

Click every navigation anchor and confirm it reaches the correct section. Verify `/auth/login` and `/workspace` link destinations. Read the browser console and confirm zero errors or warnings.

- [x] **Step 4: Refine the CSS and rerun checks**

Fix any spacing, wrapping, contrast, or alignment issues found above, then run:

```bash
node --import tsx --test tests/landing-page.test.ts
npx tsc --noEmit
npm run lint
```

Expected: all commands exit 0.

- [x] **Step 5: Commit visual refinements**

```bash
git add "app/(routes)/(landing)/page.tsx" \
  "app/(routes)/(landing)/landing.module.css"
git commit -m "style: polish responsive product homepage"
```

### Task 3: Final regression and handoff

**Files:**
- Verify: `app/(routes)/(landing)/page.tsx`
- Verify: `app/(routes)/(landing)/landing.module.css`
- Verify: `public/dotty-office.png`
- Verify: `tests/landing-page.test.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a build-verified and browser-verified homepage on `codex/product-homepage`.

- [x] **Step 1: Run all automated checks**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands exit 0; route output shows `/` as static or prerenderable.

- [x] **Step 2: Confirm the final browser state**

Reload `http://localhost:3000` after the production build or development compile and confirm the final heading, screenshot, CTA links, anchors, responsive layout, and console state.

- [x] **Step 3: Review the diff**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- "app/(routes)/(landing)" public/dotty-office.png tests/landing-page.test.ts docs/superpowers/specs/2026-11-23-product-homepage-design.md docs/superpowers/plans/2026-11-23-product-homepage.md
```

Expected: only the product-homepage spec, plan, page, CSS Module, screenshot asset, and test are included. The pre-existing untracked architecture files remain untouched.

- [x] **Step 4: Commit any final verification fix**

If verification required a change:

```bash
git add "app/(routes)/(landing)/page.tsx" \
  "app/(routes)/(landing)/landing.module.css" \
  tests/landing-page.test.ts
git commit -m "fix: resolve product homepage verification issues"
```

If no change was required, skip this commit.

## Verification note

Browser verification found that the existing Tailwind Turbopack rule used
`as: "*.css"`, which caused `.module.css` imports to emit global CSS while the
component received no class-name map. The override was removed from
`next.config.ts`, and `tests/next-css-modules.test.ts` now prevents the same
regression. Final desktop and mobile browser checks passed with zero axe WCAG
2.0/2.1 A/AA violations.
