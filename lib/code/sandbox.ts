import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ChangedFile } from "@/lib/github/commit";

/**
 * The coding sandbox (D20): a rootless Docker or Podman container with the repo cloned on the host.
 * SERVER ONLY (local container runtime binary).
 *
 * Safety: the host clones with a read-only GitHub token; the token never enters the container.
 * The container has no network, a read-only root filesystem, a writable /tmp and only the
 * per-run workspace mounted at /workspace. Commits and pull requests are made on the host.
 */

export type Runtime = "node" | "python" | "golang" | "rust" | "ruby";

export interface Sandbox {
  name: string;
  workspaceDir: string;
  runtime: Runtime;
  image: string;
  delete: () => Promise<void>;
}

export const hasBox = () => process.env.SANDBOX_ENABLED !== "false";

/** Docker on macOS/Windows by default; rootless Podman on Linux. */
export const containerBin = () =>
  process.env.CONTAINER_BIN?.trim() || (process.platform === "linux" ? "podman" : "docker");

export const REPO_DIR = "/workspace/repo";

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
  const workspaceDir = await mkdtemp(path.join(process.env.DOTTY_SANDBOX_ROOT || tmpdir(), "dotty-code-"));
  const image =
    process.env[`SANDBOX_${input.runtime.toUpperCase()}_IMAGE`] ||
    `localhost/dotty-sandbox-${input.runtime}:latest`;
  const sandbox: Sandbox = {
    name: input.name,
    workspaceDir,
    runtime: input.runtime,
    image,
    delete: async () => {
      await rm(workspaceDir, { recursive: true, force: true });
    },
  };
  // The token stays on the host for the clone; it is deliberately not passed to the container runtime.
  Object.defineProperty(sandbox, "__readToken", { value: input.readToken, enumerable: false });
  return sandbox;
}

/** Run a shell command in the repo; output is stdout+stderr, trimmed to fit the model's context. */
export async function run(
  box: Sandbox,
  command: string,
  timeoutSeconds = 300,
  cwd = REPO_DIR,
) {
  const args = [
    "run",
    "--rm",
    `--network=${process.env.SANDBOX_NETWORK || "none"}`,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=512m",
    "--memory=768m",
    "--cpus=1",
    "--pids-limit=256",
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "--volume",
    `${box.workspaceDir}:/workspace:rw,Z`,
    "--env",
    "HOME=/tmp/home",
    "--workdir",
    cwd,
    box.image,
    "timeout",
    String(Math.round(timeoutSeconds)),
    "bash",
    "-lc",
    `mkdir -p /tmp/home && ${command}`,
  ];
  return new Promise<{ exit: number; output: string; timedOut: boolean }>((resolve) => {
    execFile(
      containerBin(),
      args,
      {
        env: {
          ...process.env,
          HOME: process.env.DOTTY_SANDBOX_HOME || process.env.HOME,
        },
        maxBuffer: 500_000,
        timeout: (Math.round(timeoutSeconds) + 30) * 1000,
      },
      (error, stdout, stderr) => {
        const exit = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({
          exit,
          output: `${stdout}${stderr}`.trim(),
          timedOut: exit === 124,
        });
      },
    );
  });
}

/** Keep the start and (mostly) the end of long output. */
export function clipOutput(text: string, max = 12_000) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.2);
  return `${text.slice(0, head)}\n…（已截断 ${text.length - max} 个字符）…\n${text.slice(-(max - head))}`;
}

/** Clone `ref` into REPO_DIR (auth comes from the injected header). Returns the checked-out commit. */
export async function cloneRepo(
  box: Sandbox,
  owner: string,
  repo: string,
  ref: string,
) {
  const url = `https://github.com/${owner}/${repo}.git`;
  const token = (box as Sandbox & { __readToken?: string }).__readToken;
  if (!token) throw new Error("沙箱克隆令牌缺失。");
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const repoHostDir = path.join(box.workspaceDir, "repo");
  await new Promise<void>((resolve, reject) => {
    execFile(
      "git",
      ["clone", "--depth", "50", "--branch", ref, url, repoHostDir],
      {
        timeout: 600_000,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
        },
      },
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`无法克隆 ${owner}/${repo}@${ref}：${clipOutput(stderr || error.message, 600)}`));
        else resolve();
      },
    );
  });
  await appendFile(path.join(repoHostDir, ".git", "info", "exclude"), `\n${LOCAL_EXCLUDES.join("\n")}\n`);
  await mkdir(path.join(repoHostDir, ".git"), { recursive: true });
  const sha = await new Promise<string>((resolve, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: repoHostDir }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error("无法读取克隆后的提交。");
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
    throw new Error(`请使用仓库内部路径（收到“${path}”）。`);
  }
  return clean;
}

function repoHostPath(box: Sandbox, file: string) {
  return path.join(box.workspaceDir, "repo", ...file.split("/"));
}

async function readRepoFile(box: Sandbox, file: string, encoding: BufferEncoding = "utf8") {
  return readFile(repoHostPath(box, file), { encoding });
}

async function writeRepoFile(box: Sandbox, file: string, content: string) {
  const target = repoHostPath(box, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
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
        "在仓库根目录通过 bash 运行命令，可用于安装依赖、构建、测试、lint 和检查内容。输出过长时会截断；默认无网络，启用 SANDBOX_NETWORK 后才可联网。",
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
        "列出仓库中的已跟踪文件和新文件，也可以只列某个文件夹。",
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
        "在仓库文件中搜索内容（类似 grep -E 的扩展正则），返回匹配行、文件名和行号。",
      inputSchema: z.object({
        pattern: z.string().min(1).max(500),
        path: z
          .string()
          .max(500)
          .default("")
          .describe("只搜索这个文件夹或文件。"),
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
            matches: clipOutput(r.output, 15_000) || "（没有匹配项）",
          };
        }),
    }),

    read_file: tool({
      description:
        "读取文件并显示行号。大文件请分段读取。",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(2000).default(400),
      }),
      execute: ({ path, startLine, lineCount }) =>
        guard(async () => {
          const file = repoPath(path);
          const text = await readRepoFile(box, file);
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
                ? `第 ${startLine + lineCount}–${lines.length} 行未显示。`
                : undefined,
          };
        }),
    }),

    write_file: tool({
      description: "用完整内容创建或覆盖文件。",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(500_000),
      }),
      execute: ({ path, content }) =>
        guard(async () => {
          const file = repoPath(path);
          await writeRepoFile(box, file, content);
          return { ok: true, path: file, bytes: Buffer.byteLength(content) };
        }),
    }),

    edit_file: tool({
      description:
        "替换文件中的精确文本。除非 replaceAll 为 true，否则 oldText 必须只匹配一次，请包含足够的上下文。",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        oldText: z.string().min(1).max(100_000),
        newText: z.string().max(100_000),
        replaceAll: z.boolean().default(false),
      }),
      execute: ({ path, oldText, newText, replaceAll }) =>
        guard(async () => {
          const file = repoPath(path);
          const text = await readRepoFile(box, file);
          const count = text.split(oldText).length - 1;
          if (count === 0)
            return {
              ok: false,
              error:
                "没有找到 oldText，请重新读取文件并原样复制文本。",
            };
          if (count > 1 && !replaceAll)
            return {
              ok: false,
              error: `oldText 出现了 ${count} 次。请增加上下文行，或设置 replaceAll。`,
            };
          const next = replaceAll
            ? text.split(oldText).join(newText)
            : text.replace(oldText, () => newText);
          await writeRepoFile(box, file, next);
          return { ok: true, path: file, replaced: replaceAll ? count : 1 };
        }),
    }),

    finish: tool({
      description:
        "工作完成或确认无法完成时调用一次。Dotty 随后会运行测试、把修改提交到分支并创建草稿 Pull Request。不要自行 commit 或 push。",
      inputSchema: z.object({
        summary: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "说明修改了什么、为什么修改，以及评审者需要检查的内容。支持 Markdown。",
          ),
        prTitle: z
          .string()
          .min(3)
          .max(120)
          .describe(
            'Pull Request 标题，例如“修复看板空状态”。',
          ),
        testCommand: z
          .string()
          .max(300)
          .optional()
          .describe(
            '运行相关测试的命令，没有则留空（例如 "npm test"）。',
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
    const content = await readRepoFile(box, path, "base64");
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
