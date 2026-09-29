import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { evidenceFor, inspectRepository, recentCommits } from "../src/service/git.js";

const directory = mkdtempSync(join(tmpdir(), "indieops-git-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const git = (...args: string[]) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.name", "Tester");
git("config", "user.email", "test@example.com");
writeFileSync(join(directory, "feature.txt"), "新功能：导出草稿\n");
git("add", ".");
git("commit", "-qm", "add draft export");

test("Git 项目与提交证据保持 SHA 可追溯", async () => {
  const project = await inspectRepository(directory);
  assert.equal(project.head, git("rev-parse", "HEAD"));
  assert.equal(project.dirty, false);
  const commits = await recentCommits(directory);
  assert.equal(commits[0].subject, "add draft export");
  assert.deepEqual(commits[0].files, ["feature.txt"]);
  const evidence = await evidenceFor(directory, commits);
  assert.match(evidence.text, /新功能：导出草稿/);
  assert.deepEqual(evidence.blocked, []);
});

test("敏感文件阻止进入模型", async () => {
  writeFileSync(join(directory, ".env"), "OPENAI_API_KEY=sk-supersecret1234567890123456\n");
  git("add", ".env");
  git("commit", "-qm", "accidental key");
  const evidence = await evidenceFor(directory, (await recentCommits(directory)).slice(0, 1));
  assert.equal(evidence.text, "");
  assert.equal(evidence.blocked.length, 1);
});
