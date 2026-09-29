import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LocalConfig } from "../src/service/config.js";
import { Store } from "../src/service/db.js";
import { ImageQueue } from "../src/service/images.js";

const directory = mkdtempSync(join(tmpdir(), "indieops-image-queue-"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
after(() => rmSync(directory, { recursive: true, force: true }));

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("图片任务未在预期时间内完成");
}

test("批量任务顺序执行、取消排队项、失败重试且预览可用", async () => {
  const dataDir = join(directory, "queue");
  const store = new Store(join(dataDir, "data.sqlite"));
  store.addProject("Demo", join(dataDir, "repo"));
  const projectId = store.projects()[0].id;
  const timestamp = new Date().toISOString();
  store.addRun({ id: "cover-run", projectId, status: "completed", baselineSha: "a", targetSha: "b",
    prompt: "封面", provider: null, model: null, reviewProvider: null, reviewModel: null,
    coverStyle: "editorial-poster", parentRunId: null, output: "草稿", error: null,
    createdAt: timestamp, updatedAt: timestamp });
  new LocalConfig(dataDir).setEnvironment("OPS_IMAGE_API_KEY", "test-key");
  const started: string[] = [];
  let releaseFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const fetcher: typeof fetch = async (_url, options) => {
    const prompt = JSON.parse(String(options?.body)).input[0].content[0].text as string;
    started.push(prompt);
    if (prompt === "one") await firstRequest;
    if (prompt === "fail" && started.filter((item) => item === "fail").length === 1) {
      return new Response("temporary", { status: 503 });
    }
    return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: png.toString("base64") }] }), { status: 200 });
  };
  const queue = new ImageQueue(store, dataDir, () => {}, fetcher);
  const jobs = queue.enqueue(projectId, ["one", "cancel", "fail"], [], undefined, undefined, "cover-run");
  await until(() => store.imageJob(jobs[0].id)?.status === "running");
  assert.deepEqual(started, ["one"]);
  queue.cancel(jobs[1].id);
  releaseFirst();
  await until(() => store.imageJob(jobs[2].id)?.status === "failed");
  assert.deepEqual(started, ["one", "fail"]);
  assert.equal(store.imageJob(jobs[1].id)?.status, "aborted");
  assert.equal(store.imageJob(jobs[0].id)?.status, "completed");
  const retry = queue.retry(jobs[2].id)[0];
  await until(() => store.imageJob(retry.id)?.status === "completed");
  assert.deepEqual(started, ["one", "fail", "fail"]);
  assert.equal(store.imageJob(retry.id)?.runId, "cover-run");
  assert.deepEqual(readFileSync(queue.preview(retry.id).path), png);
  assert.equal(queue.outputPath(retry.id), queue.preview(retry.id).path);
  const batchPrompts = Array.from({ length: 20 }, (_, index) => `独立视觉方案 ${index + 1}`);
  const metadata = batchPrompts.map((_, index) => ({ role: index < 10 ? "cover" as const : "content" as const,
    sequence: index % 10 + 1 }));
  const batch = queue.enqueue(projectId, batchPrompts, [], undefined, undefined, "cover-run", metadata);
  assert.equal(batch.length, 20);
  await until(() => store.imageJob(batch.at(-1)!.id)?.status === "completed");
  assert.deepEqual(store.imageJobsForRun("cover-run").slice(-20).map(job => [job.role, job.sequence]),
    metadata.map(item => [item.role, item.sequence]));
  assert.throws(() => queue.enqueue(projectId, Array.from({ length: 13 }, () => "太多"), []), /1–12/);
  store.close();
});

test("重启后运行项标失败、排队项恢复，并保留遮罩", async () => {
  const dataDir = join(directory, "restart");
  const path = join(dataDir, "data.sqlite");
  const source = join(dataDir, "source.png");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(source, png);
  const store = new Store(path);
  store.addProject("Demo", join(dataDir, "repo"));
  const projectId = store.projects()[0].id;
  new LocalConfig(dataDir).setEnvironment("OPS_IMAGE_API_KEY", "test-key");
  const [interrupted, queued] = store.addImageJobs(projectId, ["interrupted", "queued"], [source], null);
  store.setImageJob(interrupted.id, "running");
  store.close();
  const reopened = new Store(path);
  assert.equal(reopened.imageJob(interrupted.id)?.status, "failed");
  assert.equal(reopened.imageJob(queued.id)?.status, "queued");
  const calls: unknown[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    calls.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: png.toString("base64") }] }), { status: 200 });
  };
  const queue = new ImageQueue(reopened, dataDir, () => {}, fetcher);
  await until(() => reopened.imageJob(queued.id)?.status === "completed");
  const masked = queue.enqueue(projectId, ["masked"], [source], `data:image/png;base64,${png.toString("base64")}`)[0];
  await until(() => reopened.imageJob(masked.id)?.status === "completed");
  assert.equal((calls[1] as { tools: { input_image_mask: { image_url: string } }[] }).tools[0].input_image_mask.image_url,
    `data:image/png;base64,${png.toString("base64")}`);
  assert.deepEqual(readFileSync(masked.maskPath!), png);
  assert.throws(() => queue.enqueue(projectId, ["invalid"], [source], "data:image/png;base64,broken"), /PNG/);
  reopened.close();
});

test("运行中取消中断请求，后续任务继续执行", async () => {
  const dataDir = join(directory, "abort");
  const store = new Store(join(dataDir, "data.sqlite"));
  store.addProject("Demo", join(dataDir, "repo"));
  new LocalConfig(dataDir).setEnvironment("OPS_IMAGE_API_KEY", "test-key");
  let requests = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    requests++;
    if (requests === 1) return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: png.toString("base64") }] }), { status: 200 });
  };
  const queue = new ImageQueue(store, dataDir, () => {}, fetcher);
  const [first, second] = queue.enqueue(store.projects()[0].id, ["cancel running", "continue"], []);
  await until(() => store.imageJob(first.id)?.status === "running");
  queue.cancel(first.id);
  await until(() => store.imageJob(second.id)?.status === "completed");
  assert.equal(store.imageJob(first.id)?.status, "aborted");
  assert.equal(requests, 2);
  store.close();
});
