import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReviewDecision, ReviewExhaustedError, reviewWithRevisions } from "../src/service/review.js";

test("REJECTED 将具体反馈交还写作 Agent，修订后重新审校", async () => {
  const writes: { attempt: number; previousDraft: string; feedback: string }[] = [];
  const rejected: number[] = [];
  const outcome = await reviewWithRevisions(
    async (attempt, previousDraft, feedback) => {
      writes.push({ attempt, previousDraft, feedback });
      return attempt === 1 ? "导出面板增加了选项" : "导出面板代码新增选项状态，界面与导出接入待核对";
    },
    async (_draft, attempt) => attempt === 1 ? "REJECTED\n只能确认状态字段" : "APPROVED\n限定语充分",
    (_draft, attempt) => { rejected.push(attempt); },
  );
  assert.equal(outcome.attempts, 2);
  assert.deepEqual(rejected, [1]);
  assert.equal(writes[1].previousDraft, "导出面板增加了选项");
  assert.match(writes[1].feedback, /状态字段/);
  assert.match(outcome.draft, /待核对/);
});

test("三轮仍被拒绝时停止，保留最后反馈供人工纠偏", async () => {
  let writes = 0;
  await assert.rejects(reviewWithRevisions(
    async () => { writes++; return `草稿 ${writes}`; },
    async () => "REJECTED\n证据不足",
    () => {},
  ), (error: unknown) => error instanceof ReviewExhaustedError && error.attempts === 3 && error.feedback === "证据不足");
  assert.equal(writes, 3);
  assert.deepEqual(parseReviewDecision("APPROVED\n可发布前核对"), { verdict: "APPROVED", feedback: "可发布前核对" });
  assert.throws(() => parseReviewDecision("看起来没问题"), /APPROVED 或 REJECTED/);
});
