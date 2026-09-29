export const MAX_REVIEW_ATTEMPTS = 3;

export type ReviewDecision = { verdict: "APPROVED" | "REJECTED"; feedback: string };

export function parseReviewDecision(output: string): ReviewDecision {
  const match = output.trim().match(/^(APPROVED|REJECTED)(?=\s|$)/);
  if (!match) throw new Error("审校 Agent 未按要求返回 APPROVED 或 REJECTED，需人工检查");
  return { verdict: match[1] as ReviewDecision["verdict"], feedback: output.trim().slice(match[1].length).trim() };
}

export class ReviewExhaustedError extends Error {
  constructor(readonly attempts: number, readonly feedback: string) {
    super(`审校连续 ${attempts} 次未通过，已停止自动改写；请人工检查最后草稿与反馈：${feedback.slice(0, 800)}`);
  }
}

export async function reviewWithRevisions(
  write: (attempt: number, previousDraft: string, feedback: string) => Promise<string>,
  review: (draft: string, attempt: number) => Promise<string>,
  onRejected: (draft: string, attempt: number, feedback: string) => void,
  maxAttempts = MAX_REVIEW_ATTEMPTS,
): Promise<{ draft: string; attempts: number }> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("审校次数无效");
  let previousDraft = "";
  let feedback = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const draft = await write(attempt, previousDraft, feedback);
    const decision = parseReviewDecision(await review(draft, attempt));
    if (decision.verdict === "APPROVED") return { draft, attempts: attempt };
    onRejected(draft, attempt, decision.feedback);
    previousDraft = draft;
    feedback = decision.feedback;
  }
  throw new ReviewExhaustedError(maxAttempts, feedback);
}
