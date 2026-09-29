import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/service/db.js";
import type { TaskRun } from "../src/shared/contracts.js";

const directory = mkdtempSync(join(tmpdir(), "indieops-db-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("项目、审计、草稿与计划在重启后持久化", () => {
  const path = join(directory, "data.sqlite");
  const store = new Store(path);
  store.addProject("Demo", "/tmp/demo-repo");
  const project = store.projects()[0];
  store.setStrategy(project.id, "真实开发日志");
  store.addMemory(project.id, "不要使用夸大标题");
  const timestamp = new Date().toISOString();
  const run: TaskRun = { id: "run-1", projectId: project.id, status: "running", baselineSha: "a",
    targetSha: "b", prompt: "测试", provider: null, model: null, reviewProvider: null, reviewModel: null,
    parentRunId: null, coverStyle: "editorial-poster", coverCount: 10, contentImageCount: 3, contentImageStyle: "paper-collage",
    output: "", error: null,
    createdAt: timestamp, updatedAt: timestamp };
  store.addRun(run);
  const subagentId = store.startSubagent(run.id, "writer", "openai", "test-model");
  store.finishSubagent(subagentId, "completed", "草稿", null);
  store.startSubagent(run.id, "reviewer", "relay", "review-model");
  store.event(run.id, "started", { sha: "a" });
  store.addArtifact(project.id, run.id, "一篇草稿和审校依据【f8345672d095d3e6596ba7ba13b9751a64c44892】", [{ sha: "a", files: ["demo.ts"], subject: "feat" }],
    "# 正式正文【f8345672d095d3e6596ba7ba13b9751a64c44892】");
  const [cover] = store.addImageJobs(project.id, ["内容图片提示词"], [], null, run.id, [{ role: "content", sequence: 2 }]);
  store.addSchedule(project.id, 60, "每小时检查");
  store.close();

  const reopened = new Store(path);
  assert.equal(reopened.projects()[0].strategy, "真实开发日志");
  assert.equal(reopened.memories(project.id)[0].content, "不要使用夸大标题");
  assert.equal(reopened.runs()[0].status, "failed");
  assert.equal(reopened.runs()[0].coverStyle, "editorial-poster");
  assert.equal(reopened.runs()[0].coverCount, 10);
  assert.equal(reopened.runs()[0].contentImageCount, 3);
  assert.equal(reopened.runs()[0].contentImageStyle, "paper-collage");
  assert.equal(reopened.imageJob(cover.id)?.runId, run.id);
  assert.equal(reopened.imageJob(cover.id)?.role, "content");
  assert.equal(reopened.imageJob(cover.id)?.sequence, 2);
  assert.deepEqual(reopened.subagents(run.id).map((child) => child.status), ["completed", "failed"]);
  assert.equal(reopened.events(run.id)[0].type, "started");
  assert.equal(reopened.artifacts()[0].status, "draft");
  assert.equal(reopened.artifacts()[0].publishableMarkdown, "# 正式正文");
  assert.match(reopened.artifacts()[0].content, /f8345672d095d3e6596ba7ba13b9751a64c44892/);
  assert.equal(reopened.schedules()[0].intervalMinutes, 60);
  assert.deepEqual(reopened.cleanup(90, false), { artifacts: 0, events: 0 });
  reopened.close();
});

test("旧数据库迁移封面关联与审校轮次字段", () => {
  const path = join(directory, "legacy.sqlite");
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
    baseline_sha TEXT NOT NULL, target_sha TEXT NOT NULL, prompt TEXT NOT NULL, provider TEXT, model TEXT,
    review_provider TEXT, review_model TEXT, parent_run_id TEXT, output TEXT NOT NULL DEFAULT '',
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE image_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, prompt TEXT NOT NULL,
    inputs TEXT NOT NULL, mask_path TEXT, status TEXT NOT NULL, output_path TEXT, error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE subagents (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, role TEXT NOT NULL,
    status TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, output TEXT NOT NULL DEFAULT '',
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
    type TEXT NOT NULL, content TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL);`);
  database.close();
  const store = new Store(path);
  store.addProject("Legacy", "/tmp/legacy-repo");
  const projectId = store.projects()[0].id;
  const timestamp = new Date().toISOString();
  store.addRun({ id: "legacy-run", projectId, status: "completed", baselineSha: "a", targetSha: "b", prompt: "迁移",
    provider: null, model: null, reviewProvider: null, reviewModel: null, coverStyle: "system-map",
    parentRunId: null, output: "草稿", error: null, createdAt: timestamp, updatedAt: timestamp });
  const [image] = store.addImageJobs(projectId, ["图谱"], [], null, "legacy-run");
  store.startSubagent("legacy-run", "writer", "openai", "test", 2);
  store.addArtifact(projectId, "legacy-run", "旧混合稿", []);
  assert.equal(store.run("legacy-run")?.coverStyle, "system-map");
  assert.equal(store.run("legacy-run")?.coverCount, 1);
  assert.equal(store.run("legacy-run")?.contentImageCount, 0);
  assert.equal(store.imageJob(image.id)?.runId, "legacy-run");
  assert.equal(store.imageJob(image.id)?.role, "cover");
  assert.equal(store.subagents("legacy-run")[0].attempt, 2);
  assert.equal(store.artifacts()[0].publishableMarkdown, null);
  store.close();
});

test("旧图片表迁移为可选项目，保留原记录且独立图片不随项目删除", () => {
  const path = join(directory, "images-legacy.sqlite");
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT '', last_processed_sha TEXT);
    CREATE TABLE image_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL, inputs TEXT NOT NULL, mask_path TEXT, run_id TEXT,
    role TEXT NOT NULL DEFAULT 'independent', sequence INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL, output_path TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO projects (id,name,path,created_at) VALUES ('old-project','Legacy','/tmp/image-legacy','2026-01-01');
    INSERT INTO image_jobs (id,project_id,prompt,inputs,status,created_at,updated_at)
      VALUES ('old-image','old-project','原项目图片','[]','completed','2026-01-01','2026-01-01');`);
  database.close();
  const store = new Store(path);
  assert.equal(store.imageJob("old-image")?.projectId, "old-project");
  const [standalone] = store.addImageJobs(null, ["独立图片"], [], null);
  store.removeProject("old-project");
  assert.equal(store.imageJob("old-image"), undefined);
  assert.equal(store.imageJob(standalone.id)?.projectId, null);
  store.close();
  const reopened = new Store(path);
  assert.equal(reopened.imageJob(standalone.id)?.prompt, "独立图片");
  reopened.close();
});
