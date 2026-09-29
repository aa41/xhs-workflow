import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import type { Project, ServiceNotification, ServiceRequest, ServiceResponse, SkillEntry, TaskRun } from "../shared/contracts.js";
import type { AgentRunner } from "./agent.js";
import { LocalConfig } from "./config.js";
import { ImageQueue, imageDirectory, reference } from "./images.js";
import { Store } from "./db.js";
import { commitCountSince, inspectRepository, recentCommits } from "./git.js";
import { imageStyle, validatedCoverCount } from "../shared/image-styles.js";
import { plannedImagePrompts } from "../shared/image-plan.js";

const dataDir = process.argv[2];
if (!dataDir) throw new Error("缺少数据目录");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const store = new Store(join(dataDir, "workbench.sqlite"));
const skillsDir = join(dataDir, "skills");
mkdirSync(skillsDir, { recursive: true, mode: 0o700 });
const bundledSkillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "resources", "skills");
function copyBundledDirectory(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyBundledDirectory(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile()) writeFileSync(join(destination, entry.name), readFileSync(join(source, entry.name)), { mode: 0o600 });
  }
}
if (existsSync(bundledSkillsDir)) {
  for (const entry of readdirSync(bundledSkillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !existsSync(join(skillsDir, entry.name))) {
      copyBundledDirectory(join(bundledSkillsDir, entry.name), join(skillsDir, entry.name));
    }
  }
}

function send(message: ServiceResponse | ServiceNotification): void { process.send?.(message); }
const notify = (event: string, data: unknown) => send({ event, data });
let runnerPromise: Promise<AgentRunner> | undefined;
const runner = () => runnerPromise ??= import("./agent.js")
  .then(({ AgentRunner }) => new AgentRunner(store, dataDir, notify, imageQueue));
const config = new LocalConfig(dataDir);
const imageQueue = new ImageQueue(store, dataDir, notify);

function input(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function required(value: unknown, label: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}无效`);
  return value.trim();
}

function imageProjectId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const id = required(value, "项目 ID", 80);
  if (!store.project(id)) throw new Error("项目不存在");
  return id;
}

async function projectById(id: string): Promise<Project> {
  const stored = store.project(id);
  if (!stored) throw new Error("项目不存在");
  return { ...stored, ...await inspectRepository(stored.path) };
}

async function startRun(payload: Record<string, unknown>): Promise<TaskRun> {
  const project = await projectById(required(payload.projectId, "项目 ID"));
  const parentRunId = typeof payload.parentRunId === "string" ? payload.parentRunId : null;
  const parentRun = parentRunId ? store.run(parentRunId) : null;
  if (parentRunId && (!parentRun || parentRun.projectId !== project.id || !parentRun.output)) {
    throw new Error("上一轮任务不存在或没有可用草稿");
  }
  if (store.runs(project.id).some((run) => run.status === "queued" || run.status === "running")) {
    throw new Error("此项目已有运行中的任务");
  }
  if (project.lastProcessedSha === project.head && payload.scheduled === true) {
    throw new Error("没有新提交，跳过定时任务");
  }
  const count = project.lastProcessedSha ? await commitCountSince(project.path, project.lastProcessedSha) : 8;
  if (count > 30) throw new Error("待处理提交超过 30 个，请先缩小范围或分批处理");
  const selected = await recentCommits(project.path, Math.max(count, 1), count > 0 ? project.lastProcessedSha ?? undefined : undefined);
  if (!selected.length) throw new Error("仓库没有可读取的提交");
  const timestamp = new Date().toISOString();
  const coverStyle = payload.coverStyle === undefined || payload.coverStyle === null || payload.coverStyle === ""
    ? null : required(payload.coverStyle, "封面风格", 80);
  if (coverStyle && !imageStyle(coverStyle)) throw new Error("封面风格不存在");
  const coverCount = validatedCoverCount(payload.coverCount, Boolean(coverStyle));
  const contentImageCount = payload.contentImageCount === undefined ? 0 : payload.contentImageCount;
  if (!Number.isInteger(contentImageCount) || (contentImageCount as number) < 0 || (contentImageCount as number) > 10) {
    throw new Error("内容配图数量须为 0–10 张");
  }
  const contentImageStyle = contentImageCount ? required(payload.contentImageStyle, "内容配图风格", 80) : null;
  if (contentImageStyle && !imageStyle(contentImageStyle)) throw new Error("内容配图风格不存在");
  const run: TaskRun = {
    id: randomUUID(), projectId: project.id, status: "running",
    baselineSha: project.lastProcessedSha ?? selected.at(-1)!.sha, targetSha: project.head,
    prompt: typeof payload.prompt === "string" ? payload.prompt.slice(0, 4000) : "根据近期真实代码变化生成小红书运营草稿",
    provider: typeof payload.provider === "string" && payload.provider ? payload.provider : null,
    model: typeof payload.model === "string" && payload.model ? payload.model : null,
    reviewProvider: typeof payload.reviewProvider === "string" && payload.reviewProvider ? payload.reviewProvider : null,
    reviewModel: typeof payload.reviewModel === "string" && payload.reviewModel ? payload.reviewModel : null,
    coverStyle,
    coverCount,
    contentImageCount: contentImageCount as number,
    contentImageStyle,
    parentRunId,
    output: "", error: null, createdAt: timestamp, updatedAt: timestamp,
  };
  store.addRun(run);
  store.event(run.id, "started", { baselineSha: run.baselineSha, targetSha: run.targetSha,
    dirtyAtStart: project.dirty, parentRunId, coverStyle, coverCount: coverStyle ? coverCount : 0,
    contentImageCount, commits: selected.map((commit) => commit.sha) });
  notify("run.updated", { runId: run.id, type: "started" });
  void runner().then((agent) => agent.execute(run, project, selected)).catch((error: unknown) => {
    const message = config.redact(error instanceof Error ? error.message : String(error));
    store.updateRun(run.id, { status: "failed", error: message });
    store.event(run.id, "failed", { error: message });
    notify("run.updated", { runId: run.id, type: "failed" });
  });
  return run;
}

function skillFrom(path: string): SkillEntry {
  const file = join(path, "SKILL.md");
  const content = readFileSync(file, "utf8");
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const metadata = frontmatter ? parseYaml(frontmatter[1]) as Record<string, unknown> : {};
  const name = metadata.name;
  const description = metadata.description;
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
    || typeof description !== "string" || !description.trim() || content.length > 50_000) {
    throw new Error("Skill 需要合法的 name、description 与 SKILL.md（最大 50 KB）");
  }
  return { name, description, path, source: existsSync(join(path, ".created")) ? "自建"
    : existsSync(join(path, ".imported")) ? "导入" : "内嵌" };
}

function checkNoLinks(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Skill 不允许符号链接");
  if (stat.isDirectory()) for (const child of readdirSync(path)) checkNoLinks(join(path, child));
}

function installSkill(source: string): SkillEntry {
  const path = resolve(source);
  let tempDir: string | undefined;
  try {
    let directory = path;
    if (lstatSync(path).isFile() && path.endsWith(".skill")) {
      if (lstatSync(path).size > 10_000_000) throw new Error("Skill 包超过 10 MB");
      tempDir = mkdtempSync(join(dataDir, "skill-import-"));
      const files = unzipSync(readFileSync(path));
      let total = 0;
      for (const [name, bytes] of Object.entries(files)) {
        const target = resolve(tempDir, name);
        if (!target.startsWith(tempDir + sep) || name.includes("\\")) throw new Error("Skill 包包含非法路径");
        total += bytes.length;
        if (total > 20_000_000) throw new Error("Skill 解压后超过 20 MB");
        if (name.endsWith("/")) mkdirSync(target, { recursive: true });
        else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
      }
      const candidates = [tempDir, ...readdirSync(tempDir).map((name) => join(tempDir!, name))];
      directory = candidates.find((candidate) => existsSync(join(candidate, "SKILL.md"))) ?? tempDir;
    }
    checkNoLinks(directory);
    const entry = skillFrom(directory);
    const destination = join(skillsDir, entry.name);
    if (existsSync(destination)) throw new Error("同名 Skill 已存在，需先人工检查版本");
    cpSync(directory, destination, { recursive: true });
    writeFileSync(join(destination, ".imported"), path, { mode: 0o600 });
    notify("skills.updated", { name: entry.name });
    return skillFrom(destination);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function sessionFiles(days: number, perform: boolean): number {
  const cutoff = Date.now() - days * 86_400_000;
  let count = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && (entry.name.endsWith(".jsonl") || /\.(png|jpg|webp)$/.test(entry.name))
        && statSync(path).mtimeMs < cutoff) {
        count++;
        if (perform) rmSync(path);
      }
    }
  };
  for (const folder of ["sessions", "images", "masks"]) {
    const root = join(dataDir, folder);
    if (existsSync(root)) visit(root);
  }
  return count;
}

async function dispatch(method: string, payload: unknown): Promise<unknown> {
  const data = input(payload);
  switch (method) {
    case "projects.list": return Promise.all(store.projects().map(async (project) => {
      try { return await projectById(project.id); }
      catch { return { ...project, branch: "不可用", head: "", dirty: false }; }
    }));
    case "projects.add": {
      const info = await inspectRepository(required(data.path, "仓库路径"));
      store.addProject(info.name, info.path);
      notify("projects.updated", {});
      return projectById(store.projects().find((project) => project.path === info.path)!.id);
    }
    case "projects.remove": {
      const projectId = required(data.projectId, "项目 ID");
      if (store.runs(projectId).some((run) => run.status === "running" || run.status === "queued")) {
        throw new Error("请先中止此项目正在运行的任务");
      }
      store.removeProject(projectId); notify("projects.updated", {}); return true;
    }
    case "projects.inspect": {
      const project = await projectById(required(data.projectId, "项目 ID"));
      return { project, commits: await recentCommits(project.path, 12) };
    }
    case "projects.strategy": store.setStrategy(required(data.projectId, "项目 ID"), required(data.strategy, "策略", 20_000)); notify("projects.updated", {}); return true;
    case "memory.list": return store.memories(required(data.projectId, "项目 ID"));
    case "memory.add": {
      const projectId = required(data.projectId, "项目 ID");
      if (!store.project(projectId)) throw new Error("项目不存在");
      store.addMemory(projectId, required(data.content, "反馈记忆", 4000));
      notify("memory.updated", { projectId }); return store.memories(projectId);
    }
    case "memory.delete": store.removeMemory(required(data.memoryId, "记忆 ID")); notify("memory.updated", {}); return true;
    case "runs.list": return store.runs(typeof data.projectId === "string" ? data.projectId : undefined);
    case "runs.start": return startRun(data);
    case "runs.events": return store.events(required(data.runId, "任务 ID"));
    case "runs.subagents": return store.subagents(required(data.runId, "任务 ID"));
    case "runs.steer": await (await runner()).steer(required(data.runId, "任务 ID"), required(data.text, "纠偏内容")); return true;
    case "runs.abort": await (await runner()).abort(required(data.runId, "任务 ID")); return true;
    case "runs.queueCovers":
    case "runs.queueImages": {
      const run = store.run(required(data.runId, "任务 ID"));
      if (!run || run.status !== "completed" || !run.output || (!run.coverStyle && !run.contentImageCount)) {
        throw new Error("任务尚未产生可用的随文图片方案");
      }
      if (store.imageJobsForRun(run.id).length) throw new Error("已有图片任务，请分别重试失败项");
      const planned = plannedImagePrompts(run.output, run.coverStyle ? run.coverCount ?? 1 : 0,
        run.contentImageCount ?? 0, run.coverStyle ?? null, run.contentImageStyle ?? null);
      const jobs = imageQueue.enqueue(run.projectId, planned.map(item => item.prompt), [], undefined, undefined, run.id,
        planned.map(item => ({ role: item.role, sequence: item.sequence })));
      store.event(run.id, "images_queued", { jobIds: jobs.map((job) => job.id), count: jobs.length, retried: true });
      notify("run.updated", { runId: run.id, type: "images_queued" });
      return jobs;
    }
    case "artifacts.list": return store.artifacts(typeof data.projectId === "string" ? data.projectId : undefined);
    case "artifacts.status": {
      if (data.status !== "published" && data.status !== "approved") throw new Error("草稿状态无效");
      const artifact = store.artifacts().find((item) => item.id === data.artifactId);
      if (!artifact?.publishableMarkdown) throw new Error("此产物缺少独立正式正文，请人工核对原稿，不能直接标记批准或发布");
      store.setArtifactStatus(required(data.artifactId, "草稿 ID"), data.status);
      notify("artifacts.updated", {}); return true;
    }
    case "schedules.list": return store.schedules();
    case "schedules.create": {
      const projectId = required(data.projectId, "项目 ID");
      if (!store.project(projectId)) throw new Error("项目不存在");
      const minutes = Number(data.intervalMinutes);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > 43_200) throw new Error("间隔须为 15–43200 分钟");
      store.addSchedule(projectId, minutes, typeof data.prompt === "string" ? data.prompt.slice(0, 4000) : "");
      notify("schedules.updated", {}); return true;
    }
    case "schedules.toggle": store.setScheduleEnabled(required(data.scheduleId, "计划 ID"), data.enabled === true); notify("schedules.updated", {}); return true;
    case "schedules.delete": store.removeSchedule(required(data.scheduleId, "计划 ID")); notify("schedules.updated", {}); return true;
    case "skills.list": return readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .flatMap((entry) => { try { return [skillFrom(join(skillsDir, entry.name))]; } catch { return []; } });
    case "skills.install": return installSkill(required(data.path, "Skill 路径"));
    case "skills.create": {
      const name = required(data.name, "Skill 名称", 64);
      const description = required(data.description, "Skill 描述", 1024);
      const body = required(data.body, "Skill 内容", 20_000);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Skill 名称仅支持小写字母、数字和连字符");
      const directory = join(skillsDir, name);
      if (existsSync(directory)) throw new Error("同名 Skill 已存在");
      mkdirSync(directory, { mode: 0o700 });
      writeFileSync(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`);
      writeFileSync(join(directory, ".created"), new Date().toISOString());
      notify("skills.updated", { name });
      return skillFrom(directory);
    }
    case "providers.list": return (await runner()).models();
    case "providers.configured": return config.providers().map((provider) => ({ ...provider, hasKey: config.hasKey(provider.id) }));
    case "providers.save": {
      const id = required(data.id, "Provider ID", 64);
      const runtime = await config.runtime();
      if (!config.providers().some((item) => item.id === id) && runtime.getProvider(id)) throw new Error("Provider ID 与内置服务商冲突");
      config.saveProvider({ id, baseUrl: required(data.baseUrl, "Base URL", 500),
        api: data.api === "openai-responses" ? "openai-responses" : "openai-completions",
        models: Array.isArray(data.models) ? data.models.filter((item): item is string => typeof item === "string") : [] },
      typeof data.key === "string" ? data.key : undefined);
      notify("providers.updated", {}); return true;
    }
    case "providers.remove": config.removeProvider(required(data.id, "Provider ID", 64)); notify("providers.updated", {}); return true;
    case "providers.discover": return config.discover(required(data.id, "Provider ID", 64),
      typeof data.baseUrl === "string" && data.baseUrl ? {
        baseUrl: required(data.baseUrl, "Base URL", 500), key: typeof data.key === "string" ? data.key : undefined,
      } : undefined);
    case "environment.list": return config.environmentList();
    case "environment.set": config.setEnvironment(required(data.name, "变量名", 80), required(data.value, "变量值", 8000)); notify("environment.updated", {}); return true;
    case "environment.remove": config.removeEnvironment(required(data.name, "变量名", 80)); notify("environment.updated", {}); return true;
    case "images.models": return (await runner()).imageModels();
    case "images.reference": return reference(required(data.path, "图片路径", 2000));
    case "images.jobs": return store.imageJobs(typeof data.projectId === "string" ? data.projectId : undefined);
    case "images.enqueue": {
      const prompts = Array.isArray(data.prompts) ? data.prompts : [];
      const inputs = Array.isArray(data.inputs) ? data.inputs : [];
      if (prompts.some((item) => typeof item !== "string") || inputs.some((item) => typeof item !== "string")) throw new Error("生图参数无效");
      return imageQueue.enqueue(imageProjectId(data.projectId), prompts as string[], inputs as string[],
        typeof data.maskData === "string" ? data.maskData : undefined);
    }
    case "images.cancel": imageQueue.cancel(required(data.id, "图片任务 ID", 80)); return true;
    case "images.retry": return imageQueue.retry(required(data.id, "图片任务 ID", 80));
    case "images.preview": return imageQueue.preview(required(data.id, "图片任务 ID", 80));
    case "images.reveal": return imageQueue.outputPath(required(data.id, "图片任务 ID", 80));
    case "images.projectFolder": {
      const directory = imageDirectory(dataDir, imageProjectId(data.projectId));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      return directory;
    }
    case "images.revealGenerated": {
      const projectId = imageProjectId(data.projectId);
      const path = resolve(required(data.path, "图片路径", 2000));
      const root = imageDirectory(dataDir, projectId);
      if (!path.startsWith(root + sep) || !/\.(png|jpg|webp)$/i.test(path) || !existsSync(path) ||
        !lstatSync(path).isFile() || !realpathSync(path).startsWith(realpathSync(root) + sep)) {
        throw new Error("图片路径无效或文件已被清理");
      }
      return path;
    }
    case "images.generate": {
      const projectId = imageProjectId(data.projectId);
      const image = await (await runner()).generateImage(projectId, required(data.provider, "Provider", 80),
        required(data.model, "生图模型", 200), required(data.prompt, "生图提示词", 3000));
      notify("images.generated", { projectId, path: image.path });
      return image;
    }
    case "images.responses": {
      const projectId = imageProjectId(data.projectId);
      const inputs = Array.isArray(data.inputs) ? data.inputs : [];
      if (inputs.length > 8 || inputs.some((path) => typeof path !== "string" || path.length > 2000)) throw new Error("参考图列表无效");
      const image = await (await runner()).generateResponsesImage(projectId, required(data.prompt, "生图提示词", 6000), inputs as string[]);
      notify("images.generated", { projectId, path: image.path }); return image;
    }
    case "providers.setKey": {
      const provider = required(data.provider, "Provider", 80);
      const key = required(data.key, "API Key", 4000);
      if (!/^[a-z0-9-]+$/.test(provider)) throw new Error("Provider ID 无效");
      config.setKey(provider, key);
      notify("providers.updated", {}); return true;
    }
    case "cleanup.preview": {
      const days = Number(data.days) || 90;
      return { ...store.cleanup(days, false), files: sessionFiles(days, false) };
    }
    case "cleanup.run": {
      const days = Number(data.days);
      if (!Number.isInteger(days) || days < 7 || days > 3650) throw new Error("保留天数须为 7–3650 天");
      return { ...store.cleanup(days, true), files: sessionFiles(days, true) };
    }
    default: throw new Error(`未知操作：${method}`);
  }
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const schedule of store.schedules()) {
      if (!schedule.enabled || schedule.nextRunAt > new Date().toISOString()) continue;
      store.advanceSchedule(schedule.id, schedule.intervalMinutes);
      try { await startRun({ projectId: schedule.projectId, prompt: schedule.prompt, scheduled: true }); }
      catch (error) { notify("schedule.skipped", { id: schedule.id, error: String(error) }); }
    }
  } finally { ticking = false; }
}

process.on("message", (message: ServiceRequest) => {
  if (!message || typeof message.id !== "number" || typeof message.method !== "string") return;
  void dispatch(message.method, message.payload)
    .then((result) => send({ id: message.id, result }))
    .catch((error: unknown) => send({ id: message.id, error: error instanceof Error ? error.message : String(error) }));
});

process.on("disconnect", () => { store.close(); process.exit(0); });
setInterval(() => { void tick(); }, 30_000).unref();
void tick();
send({ event: "backend.ready", data: { pid: process.pid } });
