import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStyledImagePrompt, imageStyles } from "../src/shared/image-styles.js";

test("风格预设包含构图、材质与真实性约束", () => {
  assert.equal(imageStyles.length, 10);
  for (const style of imageStyles) {
    const prompt = buildStyledImagePrompt("真实开发日志的封面", style.id);
    assert.match(prompt, /3:4/);
    assert.match(prompt, /不得伪造真实产品界面/);
    assert.match(prompt, new RegExp(style.name));
    assert(prompt.length < 6000);
  }
  assert.throws(() => buildStyledImagePrompt("x", "unknown"), /风格不存在/);
  assert.throws(() => buildStyledImagePrompt(" ", imageStyles[0].id), /图片描述/);
});
