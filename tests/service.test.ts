import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ServiceNotification, ServiceResponse } from "../src/shared/contracts.js";

const directory = mkdtempSync(join(tmpdir(), "indieops-service-"));
let child: ChildProcess | undefined;
after(() => {
  child?.kill();
  rmSync(directory, { recursive: true, force: true });
});

test("服务进程提供 Skill 开发和清理预览 IPC", async () => {
  child = fork(join(process.cwd(), "dist/service.mjs"), [directory], {
    execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const processHandle = child;
  let stderr = "";
  processHandle.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  processHandle.stdout?.resume();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`后端启动超时：${stderr}`)), 30_000);
    processHandle.on("message", (message: ServiceNotification) => {
      if (message.event === "backend.ready") { clearTimeout(timer); resolve(); }
    });
    processHandle.once("exit", (code) => reject(new Error(`后端意外退出：${code}`)));
  });
  let nextId = 0;
  const call = <T>(method: string, payload?: unknown) => new Promise<T>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`${method} 响应超时`)), 30_000);
    const listener = (message: ServiceResponse) => {
      if (message.id !== id) return;
      clearTimeout(timer);
      processHandle.off("message", listener);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result as T);
    };
    processHandle.on("message", listener);
    processHandle.send({ id, method, payload });
  });
  const created = await call<{ name: string }>("skills.create", {
    name: "sample-skill", description: "Test skill", body: "只根据证据写作。",
  });
  assert.equal(created.name, "sample-skill");
  const skills = await call<{ name: string }[]>("skills.list");
  assert(skills.some((skill) => skill.name === "sample-skill"));
  assert(skills.some((skill) => skill.name === "responses-imagegen"));
  const imported = await call<{ name: string }>("skills.install", {
    path: join(process.cwd(), "reference/xiaohongshu-ai-workbench/packages/xiaohongshu-title.skill"),
  });
  assert.equal(imported.name, "xiaohongshu-title");
  await call("providers.save", { id: "test-relay", baseUrl: "https://relay.example/v1", api: "openai-completions",
    models: ["demo-model"], key: "test-key" });
  const configured = await call<{ id: string; hasKey: boolean }[]>("providers.configured");
  assert(configured.some((provider) => provider.id === "test-relay" && provider.hasKey));
  const models = await call<{ id: string; provider: string }[]>("providers.list");
  assert(models.some((model) => model.provider === "test-relay" && model.id === "demo-model"));
  await call("environment.set", { name: "OPS_IMAGE_API_KEY", value: "secret" });
  const environment = await call<{ name: string }[]>("environment.list");
  assert.deepEqual(environment, [{ name: "OPS_IMAGE_API_KEY", configured: true }]);
  assert.equal(JSON.stringify(environment).includes("secret"), false);
  await assert.rejects(call("images.reveal", { id: "missing" }), /图片不存在/);
  await assert.rejects(call("images.revealGenerated", { projectId: "missing", path: "/tmp/image.png" }), /项目不存在/);
  await call("environment.remove", { name: "OPS_IMAGE_API_KEY" });
  await call("providers.remove", { id: "test-relay" });
  const preview = await call<{ artifacts: number; events: number; files: number }>("cleanup.preview", { days: 30 });
  assert.deepEqual(preview, { artifacts: 0, events: 0, files: 0 });
  processHandle.disconnect();
  await new Promise<void>((resolve) => processHandle.once("exit", () => resolve()));
  child = undefined;
});
