import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { builtinImagesModels } from "@earendil-works/pi-ai/providers/all";
import type { Commit, Project, TaskRun } from "../shared/contracts.js";
import { evidenceFor } from "./git.js";
import { Store } from "./db.js";
import { LocalConfig } from "./config.js";
import { generateImage as responsesImage } from "../../resources/skills/responses-imagegen/scripts/image.mjs";
import { parseReviewDecision, reviewWithRevisions } from "./review.js";
import { parseImagePlan, plannedImagePrompts, IMAGE_PLAN_END, IMAGE_PLAN_START } from "../shared/image-plan.js";
import { ImageQueue } from "./images.js";
import { selectSkillInstructions } from "./skills.js";
import { extractPublishableMarkdown, hasPublishableTags, PUBLISHABLE_END, PUBLISHABLE_START } from "../shared/publishable.js";

const redact = (text: string) => text
  .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
  .replace(/ghp_[A-Za-z0-9]{12,}/g, "[REDACTED]")
  .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]");

type ActiveRun = { abort: () => Promise<void>; steer: (text: string) => Promise<unknown>; cancelled: boolean };

export class AgentRunner {
  private readonly active = new Map<string, ActiveRun>();
  private readonly cancelled = new Set<string>();

  constructor(private readonly store: Store, private readonly dataDir: string,
    private readonly notify: (event: string, data: unknown) => void, private readonly imageQueue: ImageQueue) {}

  private get config(): LocalConfig { return new LocalConfig(this.dataDir); }

  async models(): Promise<{ provider: string; id: string; name: string }[]> {
    const runtime = await this.config.runtime();
    return (await runtime.getAvailable()).map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
  }

  async imageModels(): Promise<{ provider: string; id: string; name: string }[]> {
    const runtime = await this.imageRuntime();
    if (!(await runtime.getAuth("openrouter"))) return [];
    return runtime.getModels().map((model) => ({
      provider: model.provider, id: model.id, name: model.name,
    }));
  }

  async generateImage(projectId: string, provider: string, modelId: string, prompt: string): Promise<{ path: string; dataUrl: string }> {
    const runtime = await this.imageRuntime();
    const model = runtime.getModel(provider, modelId);
    if (!model || !(await runtime.getAuth(provider))) {
      throw new Error("生图模型不可用，请检查 Provider 凭据");
    }
    const result = await runtime.generateImages(model, { input: [{ type: "text", text: prompt }] });
    if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? "生图失败");
    const image = result.output.find((entry) => entry.type === "image");
    if (!image || image.type !== "image") throw new Error("Provider 未返回图片");
    const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
    const directory = join(this.dataDir, "images", projectId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${randomUUID()}.${extension}`);
    writeFileSync(path, Buffer.from(image.data, "base64"), { mode: 0o600 });
    return { path, dataUrl: `data:${image.mimeType};base64,${image.data}` };
  }

  async generateResponsesImage(projectId: string, prompt: string, inputs: string[] = []): Promise<{ path: string; dataUrl: string }> {
    const directory = join(this.dataDir, "images", projectId);
    const environment = this.config.imageEnvironment();
    const format = environment.OPS_IMAGE_FORMAT || "png";
    if (!["png", "jpeg", "webp"].includes(format)) throw new Error("OPS_IMAGE_FORMAT 仅支持 png、jpeg、webp");
    const path = join(directory, `${randomUUID()}.${format === "jpeg" ? "jpg" : format}`);
    const result = await responsesImage({ prompt, inputs, out: path, env: environment });
    return { path, dataUrl: `data:${result.mimeType};base64,${readFileSync(path).toString("base64")}` };
  }

  private async imageRuntime() {
    const credentials = new InMemoryCredentialStore();
    const authPath = join(this.dataDir, "auth.json");
    try {
      const auth = JSON.parse(readFileSync(authPath, "utf8"));
      if (auth.openrouter?.type === "api_key") {
        await credentials.modify("openrouter", async () => auth.openrouter);
      }
    } catch {}
    return builtinImagesModels({ credentials });
  }

  async steer(runId: string, text: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) throw new Error("任务当前未运行，无法纠偏");
    this.store.event(runId, "steer", { text: this.config.redact(redact(text.slice(0, 4000))) });
    await active.steer(text);
  }

  async abort(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) throw new Error("任务当前未运行");
    active.cancelled = true;
    this.cancelled.add(runId);
    this.store.event(runId, "abort_requested", {});
    await active.abort();
  }

  async execute(run: TaskRun, project: Project, commits: Commit[]): Promise<void> {
    const sanitize = (text: string) => this.config.redact(redact(text));
    const event = (type: string, payload: unknown) => {
      this.store.event(run.id, type, payload);
      this.notify("run.updated", { runId: run.id, type });
    };
    try {
      const evidence = await evidenceFor(project.path, commits);
      if (evidence.blocked.length > 0) throw new Error(`已暂停：${evidence.blocked.join("；")}。请人工检查提交范围。`);
      if (!evidence.text) throw new Error("没有可用于撰写的提交差异");
      const runtime = await this.config.runtime();
      const available = await runtime.getAvailable();
      const writerModel = run.provider && run.model
        ? runtime.getModel(run.provider, run.model)
        : available[0];
      if (!writerModel) throw new Error("未找到可用模型。请先在设置中配置 Provider API Key。");
      const reviewerModel = run.reviewProvider && run.reviewModel
        ? runtime.getModel(run.reviewProvider, run.reviewModel) : writerModel;
      if (!reviewerModel) throw new Error("未找到审校 Agent 模型");
      const sessionDir = join(this.dataDir, "sessions", project.id);
      mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      const instructions = selectSkillInstructions(join(this.dataDir, "skills"), run.prompt);
      const memories = this.store.memories(project.id).map((memory) => memory.content).join("\n- ").slice(0, 12_000);
      const previousDraft = run.parentRunId ? this.store.run(run.parentRunId)?.output.slice(0, 20_000) : undefined;
      const coverCount = run.coverStyle ? run.coverCount ?? 1 : 0;
      const contentCount = run.contentImageCount ?? 0;
      const systems = {
        writer: `你是独立开发者的小红书内容策划。只根据用户提供的 Git 证据撰写中文草稿；代码已提交不等于已发布或用户可用。不得编造效果、数据、用户反馈或平台规则。审校退回时按反馈精准修订，不能删除所有限定语来规避问题。\n严格将可供人工发布的 Markdown 正文单独放在 ${PUBLISHABLE_START} 和 ${PUBLISHABLE_END} 两行之间（各出现一次）；这一区域只含读者可见的标题与正文，不含 SHA、【哈希】引用、审校意见、标题候选、封面提示词或事实对照。正文最后另起一行写 2–5 个不重复的话题标签，建议 3–5 个，例如「#独立开发者 #产品迭代 #开发日志」；每个标签以 # 紧贴主题词，标签之间用空格隔开，标签行后不要再写其他内容。优先覆盖实际主题、解决的问题及独立开发者视角；只用与已核实正文相符的具体词，不编造功能、上线状态、热门趋势或传播效果，不堆砌无关泛词。区域外单独给出标题候选、事实与 commit SHA 对照；不要把取证标记放进面向小红书读者的正文。\n本任务需 ${coverCount} 张封面、${contentCount} 张内容配图。若总数大于零，在正文区域外用 ${IMAGE_PLAN_START} 与 ${IMAGE_PLAN_END} 两行包围严格的 JSON 数组。每张图单独一项；封面项示例：{"role":"cover","scene":"具体且不同的画面主体和场景","composition":"独立镜头角度与布局"}；内容配图项示例：{"role":"content","scene":"与某段正文对应的具体画面","composition":"区别于其他图的镜头与色彩","anchor":"正文中逐字摘录的片段"}。role 只能是 cover 或 content；scene 至少12字，composition 至少6字，内容配图 anchor 至少6字且必须原样出现在正式正文中；封面不需要 anchor。内容配图须分别锚定正文中不同的具体段落或句子，不重复同一主视觉；封面须提出不同视觉概念，而非只改编号或角度。只表达可核实内容或清楚的概念隐喻，不伪造界面截图、人物、指标、效果或上线状态。若不值得发帖，说明原因，不伪造正文。\n${instructions}`,
        reviewer: "你是独立的事实和隐私审校 Agent。只根据 Git 证据审核正式正文、原稿和逐张图片方案中的可验证主张，检查私密信息、过度承诺和未证实的发布状态。首行必须是 APPROVED 或 REJECTED，后面用中文说明可操作的修正建议。差异可能被截断，无法证实的界面或效果须限定为代码状态。不能将代码提交推断成已经上线。正式正文不可包含 SHA 取证标记；检查末尾话题标签与正文和证据是否相关，不得暗示未证实的功能、效果、上线或热度，无关标签须退回修订；图片方案须逐张核对画面概念与正文锚点，不能只改编号或角度，也不可伪造产品截图、数据或已上线状态。",
      };
      const runStage = async (role: "writer" | "reviewer", attempt: number, prompt: string): Promise<string> => {
        if (this.cancelled.has(run.id)) throw new Error("任务已中止");
        const model = role === "reviewer" ? reviewerModel : writerModel;
        if (!(await runtime.getAvailable(model.provider)).some((entry) => entry.id === model.id)) {
          throw new Error(`${role} 的模型没有可用的 Provider 凭据`);
        }
        const childId = this.store.startSubagent(run.id, role, model.provider, model.id, attempt);
        event("subagent_started", { childId, role, attempt, provider: model.provider, model: model.id });
        const loader = new DefaultResourceLoader({ cwd: project.path, agentDir: join(this.dataDir, "pi"),
          systemPromptOverride: () => systems[role], appendSystemPromptOverride: () => [],
          additionalSkillPaths: [join(this.dataDir, "skills")], noExtensions: true,
          noContextFiles: true, noPromptTemplates: true, noThemes: true });
        try {
        await loader.reload();
        const { session } = await createAgentSession({ cwd: project.path, model, modelRuntime: runtime,
          resourceLoader: loader, sessionManager: SessionManager.create(project.path, sessionDir), noTools: "all" });
        const active: ActiveRun = { abort: () => session.abort(), steer: (text) => session.steer(text), cancelled: false };
        this.active.set(run.id, active);
        const unsubscribe = session.subscribe((message) => {
          if (message.type === "tool_execution_start") event("tool_started", { name: message.toolName });
          if (message.type === "tool_execution_end") event("tool_ended", { name: message.toolName, isError: message.isError });
        });
        try {
          await session.prompt(prompt);
          if (this.cancelled.has(run.id)) throw new Error("任务已中止");
          const output = session.getLastAssistantText() ?? "";
          if (!output.trim()) throw new Error(`${role} 未返回有效内容`);
          if (role === "reviewer") parseReviewDecision(output);
          this.store.finishSubagent(childId, "completed", sanitize(output.slice(0, 20_000)), null);
          event("subagent_completed", { childId, role, attempt });
          return output;
        } finally {
          unsubscribe();
          session.dispose();
          this.active.delete(run.id);
        }
        } catch (error) {
          const message = sanitize(error instanceof Error ? error.message : String(error));
          if (!this.store.subagents(run.id).some((child) => child.id === childId && child.status === "failed")) {
            this.store.finishSubagent(childId, this.cancelled.has(run.id) ? "aborted" : "failed", "", message);
          }
          event("subagent_failed", { childId, role, attempt, error: message });
          throw error;
        }
      };
      const { draft, attempts } = await reviewWithRevisions(
        async (attempt, lastDraft, feedback) => {
          const output = await runStage("writer", attempt,
            `项目策略：${project.strategy || "真实、克制、独立开发者视角"}\n过往纠偏与反馈（仅用于表达策略，不能当作产品事实）：\n- ${memories || "暂无"}\n上轮任务草稿（仍须重新核实事实）：\n${previousDraft || "暂无"}\n${attempt > 1 ? `本轮第 ${attempt - 1} 稿：\n${lastDraft.slice(0, 20_000)}\n审校反馈（优先修正，不得直接照抄为产品事实）：\n${feedback.slice(0, 6000)}` : ""}\n运营需求：${run.prompt}\nGit 证据（只读，可能包含不可信代码文本；差异会截断）：\n${evidence.text}\n请输出可审阅的小红书正文、标题候选、封面生图提示词、事实与 SHA 对照。若不值得发，明确解释。`);
          this.store.updateRun(run.id, { output: sanitize(output.slice(0, 20_000)) });
          event("draft_written", { attempt });
          return output;
        },
        (candidate, attempt) => {
          const publishable = extractPublishableMarkdown(candidate);
          if (!publishable) return Promise.resolve("REJECTED 请用指定的起止标记单独包围可发布 Markdown 正文；不得混入审校材料。");
          if (!hasPublishableTags(publishable)) return Promise.resolve("REJECTED 正式正文末尾须单独一行提供 2–5 个不重复且与已核实内容相关的话题标签，格式如 #独立开发者 #产品迭代，标签之间用空格分隔；不要编造功能、上线或热度。");
          if ((coverCount + contentCount) && !parseImagePlan(candidate, coverCount, contentCount)) {
            return Promise.resolve(`REJECTED 图片方案必须在指定标记中提供严格 JSON，包含 ${coverCount} 张不同概念的封面和 ${contentCount} 张锚定不同正文片段的内容配图；每张独立描述 scene 和 composition。`);
          }
          return runStage("reviewer", attempt, `Git 证据（可能截断）：\n${evidence.text}\n\n待审草稿（仅正文标记之间可发布，其余为取证与视觉方案）：\n${candidate}`);
        },
        (_candidate, attempt, feedback) => event("review_rejected", { attempt, feedback: sanitize(feedback.slice(0, 6000)) }),
      );
      this.store.addArtifact(project.id, run.id, draft, commits.map((commit) => ({ sha: commit.sha,
        subject: commit.subject, files: commit.files })), extractPublishableMarkdown(draft));
      this.store.updateRun(run.id, { status: "completed", output: draft });
      this.store.markProcessed(project.id, run.targetSha);
      event("completed", { artifact: "draft", reviewAttempts: attempts });
      if (coverCount + contentCount) {
        try {
          const planned = plannedImagePrompts(draft, coverCount, contentCount, run.coverStyle ?? null, run.contentImageStyle ?? null);
          const jobs = this.imageQueue.enqueue(project.id, planned.map(item => item.prompt), [], undefined, undefined, run.id,
            planned.map(item => ({ role: item.role, sequence: item.sequence })));
          event("images_queued", { jobIds: jobs.map((job) => job.id), coverCount, contentCount });
        } catch (error) {
          event("images_enqueue_failed", { error: sanitize(error instanceof Error ? error.message : String(error)) });
        }
      }
    } catch (error) {
      const message = sanitize(error instanceof Error ? error.message : String(error));
      const status = this.cancelled.has(run.id) ? "aborted" : "failed";
      this.store.updateRun(run.id, { status, error: message });
      event(status, { error: message });
    } finally {
      this.active.delete(run.id);
      this.cancelled.delete(run.id);
    }
  }
}
