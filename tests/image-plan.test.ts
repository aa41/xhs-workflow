import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGE_PLAN_END, IMAGE_PLAN_START, parseImagePlan, plannedImagePrompts } from "../src/shared/image-plan.js";
import { PUBLISHABLE_END, PUBLISHABLE_START } from "../src/shared/publishable.js";
import { phoneCopyFromMarkdown } from "../src/renderer/PhonePreview.js";

const markdown = "# 本地任务队列开发日志\n\n提交增加了本地队列状态记录。\n\n另一处提交增加了失败任务重试入口。";
const plan = [
  { role: "cover", scene: "俯视桌面上的两层任务卡片和一支铅笔", composition: "主体居中，顶部留标题安全区" },
  { role: "cover", scene: "一条穿过纸张窗口的抽象任务路径和光斑", composition: "斜向运动，右侧大面积留白" },
  { role: "content", scene: "编号卡片依次进入清晰可见的纸质收纳槽", composition: "近景俯拍，强调顺序而非真实界面", anchor: "提交增加了本地队列状态记录。" },
  { role: "content", scene: "一张被退回后重新进入工作流的便签卡片", composition: "横向层次，右下角强调回环路径", anchor: "另一处提交增加了失败任务重试入口。" },
];
const draft = (entries: unknown) => `${PUBLISHABLE_START}\n${markdown}\n${PUBLISHABLE_END}\n${IMAGE_PLAN_START}\n${JSON.stringify(entries)}\n${IMAGE_PLAN_END}`;

test("封面和内容配图各有独立画面、构图与正文锚点", () => {
  assert.equal(parseImagePlan(draft(plan), 2, 2)?.length, 4);
  const prompts = plannedImagePrompts(draft(plan), 2, 2, "editorial-poster", "paper-collage");
  assert.deepEqual(prompts.map(item => [item.role, item.sequence]), [["cover", 1], ["cover", 2], ["content", 1], ["content", 2]]);
  assert.equal(new Set(prompts.map(item => item.prompt)).size, 4);
  assert.match(prompts[2].prompt, /本地队列状态记录/);
  assert.match(prompts[3].prompt, /失败任务重试入口/);
  assert.match(prompts[2].prompt, /纸艺拼贴/);
});

test("拒绝重复主体、重复或不存在的正文锚点及错误数量", () => {
  assert.equal(parseImagePlan(draft(plan.slice(0, 3)), 2, 2), null);
  assert.equal(parseImagePlan(draft([plan[0], { ...plan[0] }, ...plan.slice(2)]), 2, 2), null);
  assert.equal(parseImagePlan(draft([plan[0], { ...plan[1], scene: "俯视桌面上的两层任务卡片和一支蓝色铅笔" }, ...plan.slice(2)]), 2, 2), null);
  assert.equal(parseImagePlan(draft([...plan.slice(0, 3), { ...plan[3], anchor: plan[2].anchor }]), 2, 2), null);
  assert.equal(parseImagePlan(draft([...plan.slice(0, 3), { ...plan[3], anchor: "未出现的功能已经上线" }]), 2, 2), null);
  assert.throws(() => plannedImagePrompts("旧稿", 2, 2, "editorial-poster", "paper-collage"), /逐张图片方案/);
});

test("手机模拟文案不带 Git 引用标记", () => {
  const result = phoneCopyFromMarkdown("# 一次真实提交【f8345672d095d3e6596ba7ba13b9751a64c44892】\n\n新增了本地队列。[查看说明](https://example.org)");
  assert.equal(result.title, "一次真实提交");
  assert.match(result.body, /新增了本地队列。查看说明/);
});
