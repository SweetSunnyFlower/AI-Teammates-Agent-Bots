import { Box, type Runtime } from "@upstash/box";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ChangedFile } from "@/lib/github/commit";

/**
 * The coding sandbox (D20): an Upstash Box with the repo cloned in, driven by our own AI SDK loop
 * through these tools. SERVER ONLY (UPSTASH_BOX_API_KEY).
 *
 * Safety: the box gets no Dotty secrets. GitHub access is a read-only token for the one repo,
 * injected as a header by Box's proxy (it never enters the container). Outbound traffic is limited
 * to GitHub and package registries. Commits and pull requests are made outside the box.
 */

export const hasBox = () => Boolean(process.env.UPSTASH_BOX_API_KEY);

export const REPO_DIR = "/workspace/home/repo";

/** Package registries the agent may install from (plus GitHub for the clone). */
const ALLOWED_DOMAINS = [
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "repo.yarnpkg.com",
  "nodejs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "proxy.golang.org",
  "sum.golang.org",
  "storage.googleapis.com",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "static.rust-lang.org",
  "rubygems.org",
  "index.rubygems.org",
  "deb.debian.org",
];

/** Build/dependency folders kept out of commits even when the repo doesn't ignore them. */
const LOCAL_EXCLUDES = [
  "node_modules/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".pytest_cache/",
  "target/",
  ".next/",
  ".turbo/",
  "coverage/",
  ".DS_Store",
];

/** Single-quote for bash. */
export const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Pick the box runtime from the repo's top-level files. */
export function runtimeFor(files: string[]): Runtime {
  const has = (name: string) => files.includes(name);
  if (has("package.json")) return "node";
  if (
    has("pyproject.toml") ||
    has("requirements.txt") ||
    has("setup.py") ||
    has("Pipfile")
  )
    return "python";
  if (has("go.mod")) return "golang";
  if (has("Cargo.toml")) return "rust";
  if (has("Gemfile")) return "ruby";
  return "node";
}

export async function createSandbox(input: {
  name: string;
  runtime: Runtime;
  owner: string;
  repo: string;
  readToken: string;
}) {
  const basic = Buffer.from(`x-access-token:${input.readToken}`).toString(
    "base64",
  );
  return Box.create({
    name: input.name,
    runtime: input.runtime,
    size: "small",
    labels: ["dotty"],
    git: { userName: "Dotty", userEmail: "dotty@users.noreply.github.com" },
    attachHeaders: { "github.com": { Authorization: `Basic ${basic}` } },
    networkPolicy: { mode: "custom", allowedDomains: ALLOWED_DOMAINS },
    // Commands are wrapped in `timeout`; give the request a little longer than the longest one.
    timeout: 16 * 60_000,
  });
}

export type Sandbox = Awaited<ReturnType<typeof createSandbox>>;

/** Run a shell command in the repo; output is stdout+stderr, trimmed to fit the model's context. */
export async function run(
  box: Sandbox,
  command: string,
  timeoutSeconds = 300,
  cwd = REPO_DIR,
) {
  const res = await box.exec.command(
    `cd ${sh(cwd)} && timeout ${Math.round(timeoutSeconds)} bash -lc ${sh(command)} 2>&1`,
  );
  const exit = res.exitCode ?? (res.status === "completed" ? 0 : 1);
  const output = res.stdout || res.result || "";
  return { exit, output, timedOut: exit === 124 };
}

/** Keep the start and (mostly) the end of long output. */
export function clipOutput(text: string, max = 12_000) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.2);
  return `${text.slice(0, head)}\n…(${text.length - max} characters cut)…\n${text.slice(-(max - head))}`;
}

/** Clone `ref` into REPO_DIR (auth comes from the injected header). Returns the checked-out commit. */
export async function cloneRepo(
  box: Sandbox,
  owner: string,
  repo: string,
  ref: string,
) {
  const url = `https://github.com/${owner}/${repo}.git`;
  const clone = await run(
    box,
    `git clone --depth 50 --branch ${sh(ref)} ${sh(url)} ${sh(REPO_DIR)}`,
    600,
    "/workspace/home",
  );
  if (clone.exit !== 0)
    throw new Error(
      `Couldn't clone ${owner}/${repo}@${ref}: ${clipOutput(clone.output, 600)}`,
    );
  await run(
    box,
    `printf '%s\\n' ${LOCAL_EXCLUDES.map(sh).join(" ")} >> .git/info/exclude`,
  );
  const head = await run(box, "git rev-parse HEAD");
  const sha = head.output.trim();
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error("Couldn't read the cloned commit.");
  return sha;
}

/** Repo-relative path, refusing escapes out of the repo. */
function repoPath(path: string) {
  const clean = path
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/workspace\/home\/repo\/?/, "");
  if (
    !clean ||
    clean.startsWith("/") ||
    clean.split("/").includes("..") ||
    clean.startsWith(".git/") ||
    clean === ".git"
  ) {
    throw new Error(`Use a path inside the repository (got "${path}").`);
  }
  return clean;
}

export interface FinishReport {
  summary: string;
  prTitle: string;
  testCommand?: string;
}

/** The coding agent's tools. `onFinish` receives the agent's report (the loop stops on it). */
export function sandboxTools(
  box: Sandbox,
  onFinish: (report: FinishReport) => void,
): ToolSet {
  const guard = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error ? error.message.slice(0, 1000) : String(error),
      };
    }
  };

  return {
    run_command: tool({
      description:
        "Run a shell command in the repository (bash, in the repo root). Use it to install dependencies, build, run tests and linters, and inspect things. Output is trimmed when long. Internet is limited to GitHub and package registries.",
      inputSchema: z.object({
        command: z.string().min(1).max(4000),
        timeoutSeconds: z.number().int().min(5).max(900).default(300),
      }),
      execute: ({ command, timeoutSeconds }) =>
        guard(async () => {
          const r = await run(box, command, timeoutSeconds);
          return {
            ok: r.exit === 0,
            exitCode: r.exit,
            timedOut: r.timedOut,
            output: clipOutput(r.output),
          };
        }),
    }),

    list_files: tool({
      description:
        "List files in the repository (tracked and new), optionally under a folder.",
      inputSchema: z.object({ path: z.string().max(500).default("") }),
      execute: ({ path }) =>
        guard(async () => {
          const where = path.trim() ? sh(repoPath(path)) : ".";
          const r = await run(
            box,
            `git ls-files --cached --others --exclude-standard -- ${where} | head -800`,
            60,
          );
          return { ok: true, files: r.output.split("\n").filter(Boolean) };
        }),
    }),

    search: tool({
      description:
        "Search file contents in the repository (extended regex, like grep -E). Returns matching lines with file and line number.",
      inputSchema: z.object({
        pattern: z.string().min(1).max(500),
        path: z
          .string()
          .max(500)
          .default("")
          .describe("Limit to this folder or file."),
        ignoreCase: z.boolean().default(false),
      }),
      execute: ({ pattern, path, ignoreCase }) =>
        guard(async () => {
          const where = path.trim() ? sh(repoPath(path)) : ".";
          const r = await run(
            box,
            `git grep --untracked -n -I -E ${ignoreCase ? "-i " : ""}-e ${sh(pattern)} -- ${where} | head -300`,
            60,
          );
          return {
            ok: true,
            matches: clipOutput(r.output, 15_000) || "(no matches)",
          };
        }),
    }),

    read_file: tool({
      description:
        "Read a file with line numbers. For big files, read a range of lines.",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(2000).default(400),
      }),
      execute: ({ path, startLine, lineCount }) =>
        guard(async () => {
          const file = repoPath(path);
          const text = await box.files.read(`${REPO_DIR}/${file}`);
          const lines = text.split("\n");
          const slice = lines.slice(startLine - 1, startLine - 1 + lineCount);
          return {
            ok: true,
            path: file,
            totalLines: lines.length,
            content: clipOutput(
              slice.map((l, i) => `${startLine + i}\t${l}`).join("\n"),
              60_000,
            ),
            more:
              startLine - 1 + lineCount < lines.length
                ? `Lines ${startLine + lineCount}–${lines.length} not shown.`
                : undefined,
          };
        }),
    }),

    write_file: tool({
      description: "Create or overwrite a file with the full content.",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(500_000),
      }),
      execute: ({ path, content }) =>
        guard(async () => {
          const file = repoPath(path);
          const dir = file.includes("/")
            ? file.slice(0, file.lastIndexOf("/"))
            : "";
          if (dir)
            await box.files.mkdir(`${REPO_DIR}/${dir}`, { parents: true });
          await box.files.write({ path: `${REPO_DIR}/${file}`, content });
          return { ok: true, path: file, bytes: Buffer.byteLength(content) };
        }),
    }),

    edit_file: tool({
      description:
        "Replace exact text in a file. oldText must match exactly once (include enough surrounding lines), unless replaceAll is true.",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        oldText: z.string().min(1).max(100_000),
        newText: z.string().max(100_000),
        replaceAll: z.boolean().default(false),
      }),
      execute: ({ path, oldText, newText, replaceAll }) =>
        guard(async () => {
          const file = repoPath(path);
          const text = await box.files.read(`${REPO_DIR}/${file}`);
          const count = text.split(oldText).length - 1;
          if (count === 0)
            return {
              ok: false,
              error:
                "oldText wasn't found. Read the file again and copy the text exactly.",
            };
          if (count > 1 && !replaceAll)
            return {
              ok: false,
              error: `oldText appears ${count} times. Add more surrounding lines, or set replaceAll.`,
            };
          const next = replaceAll
            ? text.split(oldText).join(newText)
            : text.replace(oldText, () => newText);
          await box.files.write({ path: `${REPO_DIR}/${file}`, content: next });
          return { ok: true, path: file, replaced: replaceAll ? count : 1 };
        }),
    }),

    finish: tool({
      description:
        "Call once when the work is done (or can't be done). Dotty then runs the tests, commits your changes to a branch and opens a draft pull request. Don't commit or push yourself.",
      inputSchema: z.object({
        summary: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "What you changed and why, and anything the reviewer should check. Markdown.",
          ),
        prTitle: z
          .string()
          .min(3)
          .max(120)
          .describe(
            'Pull request title, e.g. "Fix empty state on the dashboard".',
          ),
        testCommand: z
          .string()
          .max(300)
          .optional()
          .describe(
            'The command that runs the relevant tests, if any (e.g. "npm test").',
          ),
      }),
      execute: async (report) => {
        onFinish(report);
        return { ok: true };
      },
    }),
  };
}

const MAX_FILES = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Everything the agent changed (staged in the box), read out as files to commit. */
export async function collectChanges(box: Sandbox) {
  await run(box, "git add -A", 120);
  const raw = await run(
    box,
    "git -c core.quotepath=off diff --cached --raw --no-renames -z",
    120,
  );
  const stat = await run(box, "git diff --cached --shortstat", 60);
  const parts = raw.output.split("\0").filter((p) => p !== "");
  const files: ChangedFile[] = [];
  const skipped: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    // ":100644 100644 <old> <new> M" then the path
    const meta = parts[i].replace(/^:/, "").split(" ");
    const path = parts[i + 1];
    const mode = meta[1];
    const status = meta[4]?.[0];
    if (status === "D") {
      files.push({ path, mode: "100644", content: null });
      continue;
    }
    if (mode === "160000") {
      skipped.push(`${path} (submodule)`);
      continue;
    }
    if (files.length >= MAX_FILES) {
      skipped.push(path);
      continue;
    }
    if (mode === "120000") {
      const target = await run(box, `readlink ${sh(path)}`, 30);
      files.push({
        path,
        mode: "120000",
        content: Buffer.from(target.output.replace(/\n$/, "")).toString(
          "base64",
        ),
      });
      continue;
    }
    const size = Number(
      (await run(box, `stat -c %s ${sh(path)}`, 30)).output.trim(),
    );
    if (!Number.isFinite(size) || size > MAX_FILE_BYTES) {
      skipped.push(`${path} (too large)`);
      continue;
    }
    const content = await box.files.read(`${REPO_DIR}/${path}`, {
      encoding: "base64",
    });
    files.push({
      path,
      mode: mode === "100755" ? "100755" : "100644",
      content,
    });
  }
  const m =
    /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(
      stat.output,
    );
  return {
    files,
    skipped,
    stats: {
      files: m ? Number(m[1]) : files.length,
      additions: m?.[2] ? Number(m[2]) : 0,
      deletions: m?.[3] ? Number(m[3]) : 0,
    },
  };
}

/** The repo's own test command, if we can tell. */
export async function detectTestCommand(box: Sandbox): Promise<string | null> {
  const probe = await run(
    box,
    `ls -1a; if [ -f package.json ]; then node -e 'const p=require("./package.json");process.stdout.write("\\nTEST_SCRIPT="+((p.scripts&&p.scripts.test)||""))'; fi`,
    60,
  );
  const files = probe.output.split("\n");
  const has = (f: string) => files.includes(f);
  const script = /TEST_SCRIPT=(.*)$/m.exec(probe.output)?.[1]?.trim() ?? "";
  if (has("package.json")) {
    if (!script || /no test specified/.test(script)) return null;
    if (has("pnpm-lock.yaml"))
      return "corepack enable >/dev/null 2>&1; pnpm install --frozen-lockfile && pnpm test";
    if (has("yarn.lock"))
      return "corepack enable >/dev/null 2>&1; yarn install --frozen-lockfile && yarn test";
    if (has("bun.lockb") || has("bun.lock")) return null;
    return `${has("package-lock.json") ? "npm ci" : "npm install"} && npm test`;
  }
  if (has("go.mod")) return "go test ./...";
  if (has("Cargo.toml")) return "cargo test";
  if (has("pyproject.toml") || has("pytest.ini") || has("requirements.txt")) {
    return "(pip install -q -r requirements.txt 2>/dev/null || pip install -q -e . 2>/dev/null || true) && python -m pytest -q";
  }
  return null;
}
