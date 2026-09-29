import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { generateImage } from "../resources/skills/responses-imagegen/scripts/image.mjs";

const directory = mkdtempSync(join(tmpdir(), "indieops-image-"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
after(() => rmSync(directory, { recursive: true, force: true }));

test("Responses Skill 生成与编辑均使用 image_generation 工具", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-key");
    return new Response(JSON.stringify({ id: "response-1", output: [{ type: "image_generation_call",
      result: png.toString("base64"), revised_prompt: "revised" }] }), { status: 200 });
  };
  const env = { OPS_IMAGE_API_KEY: "test-key", OPS_IMAGE_MODEL: "responses-model", OPS_IMAGE_TOOL_MODEL: "image-model" };
  const output = join(directory, "new.png");
  const generated = await generateImage({ prompt: "生成封面", out: output, env, fetcher });
  assert.equal(generated.responseId, "response-1");
  assert.deepEqual(readFileSync(output), png);
  assert.equal((requests[0].tools as { action: string; model: string }[])[0].action, "generate");
  assert.equal((requests[0].tools as { model: string }[])[0].model, "image-model");
  const input = join(directory, "source.png");
  writeFileSync(input, png);
  await generateImage({ prompt: "保留布局，修改标题", inputs: [input], out: join(directory, "edit.png"),
    previousResponseId: "response-1", env, fetcher });
  assert.equal((requests[1].tools as { action: string }[])[0].action, "edit");
  assert.equal(requests[1].previous_response_id, "response-1");
  assert.equal(((requests[1].input as { content: { type: string }[] }[])[0].content)[1].type, "input_image");
});

test("透明 PNG 遮罩走 Responses input_image_mask，拒绝不匹配尺寸", async () => {
  const source = join(directory, "source.png");
  const mask = join(directory, "mask.png");
  writeFileSync(source, png);
  writeFileSync(mask, png);
  const fetcher: typeof fetch = async (url, options) => {
    assert.match(String(url), /\/responses$/);
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-key");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.tools[0].model, "image-model");
    assert.equal(body.tools[0].action, "edit");
    assert.equal(body.tools[0].input_image_mask.image_url, `data:image/png;base64,${png.toString("base64")}`);
    assert.equal(body.input[0].content[1].type, "input_image");
    return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: png.toString("base64") }] }), { status: 200 });
  };
  const env = { OPS_IMAGE_API_KEY: "test-key", OPS_IMAGE_TOOL_MODEL: "image-model" };
  const output = await generateImage({ prompt: "只修改圈选区域", inputs: [source], mask,
    out: join(directory, "masked.png"), env, fetcher });
  assert.deepEqual(readFileSync(output.path), png);
  const wrongSize = Buffer.from(png);
  wrongSize.writeUInt32BE(2, 16);
  writeFileSync(mask, wrongSize);
  await assert.rejects(generateImage({ prompt: "修改", inputs: [source], mask,
    out: join(directory, "invalid.png"), env, fetcher }), /同尺寸/);
});

test("缺失凭据、错误参考图和格式阻止请求", async () => {
  await assert.rejects(generateImage({ prompt: "x", out: join(directory, "x.png"), env: {} }), /OPS_IMAGE_API_KEY/);
  await assert.rejects(generateImage({ prompt: "x", inputs: [join(directory, "source.png")], out: join(directory, "x.png"),
    env: { OPS_IMAGE_API_KEY: "key", OPS_IMAGE_FORMAT: "../escape" } }), /OPS_IMAGE_FORMAT/);
});
