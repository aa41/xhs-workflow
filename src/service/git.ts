import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import type { Commit, Project } from "../shared/contracts.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[], maxBuffer = 1_000_000): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    timeout: 10_000, maxBuffer, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_EXTERNAL_DIFF: "false" },
  });
  return stdout.trim();
}

export async function inspectRepository(path: string): Promise<Pick<Project, "name" | "path" | "branch" | "head" | "dirty">> {
  const canonical = await realpath(path);
  const root = await realpath(await git(canonical, ["rev-parse", "--show-toplevel"]));
  const [head, branch, status] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain", "--untracked-files=normal"]),
  ]);
  return { name: basename(root), path: root, branch: branch || "detached HEAD", head, dirty: Boolean(status) };
}

export async function recentCommits(path: string, limit = 8, since?: string): Promise<Commit[]> {
  const output = await git(path, ["log", `-n${Math.min(Math.max(limit, 1), 30)}`,
    ...(since ? [`${since}..HEAD`] : []),
    "--format=%H%x1f%s%x1f%an%x1f%aI%x1e"]);
  const entries = output.split("\x1e").map((entry) => entry.trim()).filter(Boolean);
  return Promise.all(entries.map(async (entry) => {
    const [sha, subject, author, date] = entry.split("\x1f");
    const files = (await git(path, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha]))
      .split("\n").filter(Boolean).slice(0, 50);
    return { sha, subject, author, date, files };
  }));
}

export async function commitCountSince(path: string, sha: string): Promise<number> {
  const output = await git(path, ["rev-list", "--count", `${sha}..HEAD`]);
  return Number(output);
}

const sensitivePath = /(^|\/)(\.env(?:\.|$)|.*(?:secret|credential|private.key|\.pem$|\.p12$|id_rsa))/i;
const sensitiveContent = /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;

export async function evidenceFor(path: string, commits: Commit[]): Promise<{ text: string; blocked: string[] }> {
  const blocked: string[] = [];
  const parts: string[] = [];
  for (const commit of commits) {
    if (commit.files.some((file) => sensitivePath.test(file)) || sensitiveContent.test(commit.subject)) {
      blocked.push(`${commit.sha.slice(0, 8)} 包含疑似敏感文件`);
      continue;
    }
    const diff = await git(path, ["show", "--format=", "--no-ext-diff", "--no-textconv", "--unified=2", commit.sha], 2_000_000);
    if (sensitiveContent.test(diff)) {
      blocked.push(`${commit.sha.slice(0, 8)} 包含疑似凭据`);
      continue;
    }
    parts.push(`提交 ${commit.sha}\n主题 ${commit.subject}\n文件 ${commit.files.join(", ")}\n差异（截断）:\n${diff.slice(0, 28_000)}`);
  }
  return { text: parts.join("\n\n---\n\n").slice(0, 90_000), blocked };
}
