import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { LocalConfig, validateBaseUrl } from "../src/service/config.js";

const directory = mkdtempSync(join(tmpdir(), "indieops-config-"));
after(() => rmSync(directory, { recursive: true, force: true }));

test("中转商模型经 Pi 注册并保持凭据隔离", async () => {
  const config = new LocalConfig(directory);
  config.saveProvider({ id: "my-relay", baseUrl: "https://relay.example/v1", api: "openai-completions", models: ["custom-model"] }, "test-secret");
  const runtime = await config.runtime();
  assert.equal(runtime.getModel("my-relay", "custom-model")?.baseUrl, "https://relay.example/v1");
  assert((await runtime.getAvailable("my-relay")).some((model) => model.id === "custom-model"));
  assert.equal(JSON.stringify(config.providers()).includes("test-secret"), false);
  assert.equal(statSync(join(directory, "auth.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(directory, "providers.json"), "utf8").includes("test-secret"), false);
  config.removeProvider("my-relay");
  assert.equal(config.hasKey("my-relay"), false);
});

test("环境变量只允许 OPS_，生图变量限定作用域", () => {
  const config = new LocalConfig(directory);
  assert.throws(() => config.setEnvironment("PATH", "bad"));
  config.setEnvironment("OPS_IMAGE_API_KEY", "secret");
  config.setEnvironment("OPS_OTHER_KEY", "other");
  assert.deepEqual(config.imageEnvironment(), { OPS_IMAGE_API_KEY: "secret" });
  assert.equal(config.redact("secret and other"), "[REDACTED] and [REDACTED]");
  assert.deepEqual(config.environmentList().map((entry) => entry.name), ["OPS_IMAGE_API_KEY", "OPS_OTHER_KEY"]);
  config.removeEnvironment("OPS_IMAGE_API_KEY");
  assert.equal(config.imageEnvironment().OPS_IMAGE_API_KEY, undefined);
  assert.throws(() => validateBaseUrl("http://remote.example/v1"));
  assert.equal(validateBaseUrl("http://localhost:3333/v1/"), "http://localhost:3333/v1");
});

test("新中转商保存前可显式发现模型", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.url, "/v1/models");
    assert.equal(request.headers.authorization, "Bearer draft-key");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "alpha" }, { id: "beta" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器地址无效");
    const config = new LocalConfig(directory);
    assert.deepEqual(await config.discover("new-relay", {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, key: "draft-key",
    }), ["alpha", "beta"]);
  } finally { server.close(); }
});
