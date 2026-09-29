import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  Artifact,
  BackendStatus,
  Commit,
  CustomProvider,
  EnvironmentEntry,
  ImageJob,
  ModelEntry,
  Project,
  ProjectMemory,
  Schedule,
  ServiceNotification,
  SkillEntry,
  Subagent,
  TaskEvent,
  TaskRun,
  WorkbenchBridge,
} from "../shared/contracts";
import { MaskEditor } from "./MaskEditor";
import { PhonePreview } from "./PhonePreview";
import { buildStyledImagePrompt, imageStyles } from "../shared/image-styles";
import { marked } from "marked";
import DOMPurify from "dompurify";

declare global {
  interface Window {
    workbench?: WorkbenchBridge;
  }
}

type View = "dashboard" | "projects" | "runs" | "artifacts" | "images" | "skills" | "schedules" | "settings";
type ListKey = "projects" | "runs" | "artifacts" | "schedules" | "skills" | "providers" | "images" | "imageJobs";
type IconName = "overview" | "folder" | "activity" | "document" | "spark" | "calendar" | "settings" | "arrow" | "plus" | "refresh" | "chevron" | "play" | "stop" | "trash" | "external" | "check" | "clock" | "search" | "send" | "branch" | "bolt" | "menu" | "close" | "image";

const nav: { view: View; label: string; icon: IconName; eyebrow: string; title: string; description: string }[] = [
  { view: "dashboard", label: "总览", icon: "overview", eyebrow: "WORKSPACE / OVERVIEW", title: "工作台总览", description: "从仓库变化到任务交付，掌握每一步进展。" },
  { view: "projects", label: "项目仓库", icon: "folder", eyebrow: "WORKSPACE / PROJECTS", title: "项目仓库", description: "连接代码仓库，检查提交并确定处理策略。" },
  { view: "runs", label: "任务审计", icon: "activity", eyebrow: "WORKSPACE / RUNS", title: "任务审计", description: "启动写作与审校任务，查看执行链、纠偏和失败原因。" },
  { view: "artifacts", label: "内容产物", icon: "document", eyebrow: "WORKSPACE / ARTIFACTS", title: "内容产物", description: "预览正式 Markdown 正文，核对依据与封面，再人工决定是否发布。" },
  { view: "images", label: "独立生图", icon: "image", eyebrow: "WORKSPACE / IMAGE STUDIO", title: "独立生图", description: "无需发起文案任务。选择项目、描述画面即可生成或编辑图片。" },
  { view: "skills", label: "技能库", icon: "spark", eyebrow: "WORKSPACE / SKILLS", title: "技能库", description: "管理工作流可使用的本地技能。" },
  { view: "schedules", label: "定时计划", icon: "calendar", eyebrow: "WORKSPACE / SCHEDULES", title: "定时计划", description: "让重复任务按你的节奏自动运行。" },
  { view: "settings", label: "设置", icon: "settings", eyebrow: "WORKSPACE / SETTINGS", title: "工作台设置", description: "维护后端服务、模型凭据与本地数据。" },
];

const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z" />,
  activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
  document: <><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v5h5M8 13h8M8 17h6" /></>,
  spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8zM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3" /></>,
  settings: <><path d="M12 3a2 2 0 0 1 2 2l.2 1.1 1.7.9 1.1-.4a2 2 0 0 1 2.4.8l.8 1.4a2 2 0 0 1-.4 2.5l-.9.7v2l.9.7a2 2 0 0 1 .4 2.5l-.8 1.4a2 2 0 0 1-2.4.8l-1.1-.4-1.7.9L14 20a2 2 0 0 1-2 2 2 2 0 0 1-2-2l-.2-1.1-1.7-.9-1.1.4a2 2 0 0 1-2.4-.8l-.8-1.4a2 2 0 0 1 .4-2.5l.9-.7v-2l-.9-.7a2 2 0 0 1-.4-2.5l.8-1.4A2 2 0 0 1 7 6.6l1.1.4 1.7-.9L10 5a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="3" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2m0 4v-4h-4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  play: <path d="m8 5 11 7-11 7z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
  external: <><path d="M13 5h6v6M19 5l-9 9M19 14v5H5V5h5" /></>,
  check: <path d="m5 12 5 5L20 7" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  send: <path d="m3 11 18-8-8 18-2-8zM11 13 21 3" />,
  branch: <><circle cx="6" cy="4" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="6" cy="20" r="2" /><path d="M6 6v12M6 12c0-4 3-5 10-5" /></>,
  bolt: <path d="m13 2-9 11h7l-1 9 10-12h-7z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 3-3 5 5" /></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function shortSha(sha?: string | null) { return sha ? sha.slice(0, 8) : "—"; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function pickedPath(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && "path" in value && typeof value.path === "string") return value.path || null;
  return null;
}

const runLabels: Record<TaskRun["status"], string> = { queued: "排队中", running: "运行中", completed: "已完成", failed: "失败", aborted: "已中止" };
const backendLabels: Record<BackendStatus["state"], string> = { stopped: "未启动", starting: "启动中", running: "运行中", error: "异常" };

function Empty({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={25} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function SectionTitle({ label, title, aside }: { label: string; title: string; aside?: ReactNode }) {
  return <div className="section-heading"><div><span className="section-kicker">{label}</span><h2>{title}</h2></div>{aside}</div>;
}

function StatusPill({ status }: { status: TaskRun["status"] }) {
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{runLabels[status]}</span>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const html = DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string, { FORBID_TAGS: ["img", "iframe", "form", "svg"], FORBID_ATTR: ["style"] });
  return <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} onClick={event => { if ((event.target as HTMLElement).closest("a")) event.preventDefault(); }} />;
}

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [backend, setBackend] = useState<BackendStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [skillErrors, setSkillErrors] = useState<Partial<Record<"name" | "description" | "body" | "form", string>>>({});
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [imageModels, setImageModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErrors, setListErrors] = useState<Partial<Record<ListKey | "backend", string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<{ project: Project; commits: Commit[] } | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [strategy, setStrategy] = useState("");
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [imageProjectId, setImageProjectId] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [selectedImageModel, setSelectedImageModel] = useState("");
  const [imageResult, setImageResult] = useState<{ path: string; dataUrl: string; projectId: string; projectName: string; prompt: string; jobId?: string } | null>(null);
  const [imageEngine, setImageEngine] = useState<"responses" | "openrouter">("responses");
  const [imageInputs, setImageInputs] = useState<string[]>([]);
  const [imageReference, setImageReference] = useState<{ dataUrl: string; mimeType: string; width?: number; height?: number } | null>(null);
  const [imageMask, setImageMask] = useState<string | null>(null);
  const [imageVariants, setImageVariants] = useState(1);
  const [imageStyleId, setImageStyleId] = useState<string>(imageStyles[0].id);
  const [coverEnabled, setCoverEnabled] = useState(false);
  const [coverStyleId, setCoverStyleId] = useState<string>(imageStyles[0].id);
  const [coverCount, setCoverCount] = useState(1);
  const [contentImageEnabled, setContentImageEnabled] = useState(false);
  const [contentImageCount, setContentImageCount] = useState(1);
  const [contentImageStyleId, setContentImageStyleId] = useState<string>(imageStyles[0].id);
  const [artifactTab, setArtifactTab] = useState<"preview" | "phone" | "markdown" | "source">("preview");
  const [selectedPhoneJobId, setSelectedPhoneJobId] = useState<string | null>(null);
  const [phoneLoadFailure, setPhoneLoadFailure] = useState<string | null>(null);
  const [imageJobs, setImageJobs] = useState<ImageJob[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentEntry[]>([]);
  const [providerId, setProviderId] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [providerApi, setProviderApi] = useState<CustomProvider["api"]>("openai-completions");
  const [providerModels, setProviderModels] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [envName, setEnvName] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runProjectId, setRunProjectId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReviewModel, setSelectedReviewModel] = useState("");
  const [parentRunId, setParentRunId] = useState<string | null>(null);
  const [steerText, setSteerText] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleProjectId, setScheduleProjectId] = useState("");
  const [keyProvider, setKeyProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [cleanupDays, setCleanupDays] = useState(30);
  const [cleanupPreview, setCleanupPreview] = useState<{ artifacts: number; events: number; files: number } | null>(null);
  const [query, setQuery] = useState("");

  const call = useCallback(<T,>(method: string, payload?: unknown) => {
    if (!window.workbench) return Promise.reject(new Error("工作台桥接不可用。请在 Electron 应用中打开此页面。"));
    return window.workbench.call<T>(method, payload);
  }, []);

  const refreshBackend = useCallback(async () => {
    try {
      const result = await call<BackendStatus>("backend.status");
      setBackend(result);
      setListErrors(current => ({ ...current, backend: undefined }));
      return result;
    } catch (error) {
      setListErrors(current => ({ ...current, backend: errorText(error) }));
      return null;
    }
  }, [call]);

  const refreshLists = useCallback(async () => {
    const requests: { key: ListKey; method: string; update: (value: never) => void }[] = [
      { key: "projects", method: "projects.list", update: value => setProjects(value) },
      { key: "runs", method: "runs.list", update: value => setRuns(value) },
      { key: "artifacts", method: "artifacts.list", update: value => setArtifacts(value) },
      { key: "schedules", method: "schedules.list", update: value => setSchedules(value) },
      { key: "skills", method: "skills.list", update: value => setSkills(value) },
      { key: "providers", method: "providers.list", update: value => setModels(value) },
      { key: "images", method: "images.models", update: value => setImageModels(value) },
      { key: "imageJobs", method: "images.jobs", update: value => setImageJobs(value) },
    ];
    await Promise.all(requests.map(async ({ key, method, update }) => {
      try { update(await call<never>(method)); setListErrors(current => ({ ...current, [key]: undefined })); }
      catch (error) { setListErrors(current => ({ ...current, [key]: errorText(error) })); }
    }));
    setLoading(false);
  }, [call]);

  const refreshSettings = useCallback(() => {
    void call<CustomProvider[]>("providers.configured").then(setCustomProviders).catch(() => {});
    void call<EnvironmentEntry[]>("environment.list").then(setEnvironment).catch(() => {});
  }, [call]);

  const refreshAll = useCallback(() => {
    void refreshBackend().then(result => {
      if (result?.state === "running") void refreshLists();
      else setLoading(false);
    });
  }, [refreshBackend, refreshLists]);

  useEffect(() => {
    refreshAll();
    const poll = window.setInterval(refreshAll, 15000);
    let eventTimer: number | undefined;
    const unsubscribe = window.workbench?.onEvent((_event: ServiceNotification) => {
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(refreshAll, 300);
    });
    return () => { window.clearInterval(poll); window.clearTimeout(eventTimer); unsubscribe?.(); };
  }, [refreshAll]);

  useEffect(() => {
    if (view === "artifacts") {
      const visible = artifacts.filter(item => !projectFilter || item.projectId === projectFilter);
      if (!visible.some(item => item.id === selectedArtifactId)) {
        setSelectedArtifactId(visible[0]?.id ?? null);
        setArtifactTab("preview");
      }
    }
    if (view === "images" && imageProjectId && !projects.some(item => item.id === imageProjectId)) setImageProjectId("");
    else if (view === "images" && projects.length === 1 && !imageProjectId) setImageProjectId(projects[0].id);
  }, [view, artifacts, selectedArtifactId, projectFilter, projects, imageProjectId]);

  useEffect(() => {
    if (!selectedProjectId) { setInspection(null); return; }
    let active = true;
    setInspecting(true); setInspectionError(null);
    call<{ project: Project; commits: Commit[] }>("projects.inspect", { projectId: selectedProjectId })
      .then(result => { if (active) { setInspection(result); setStrategy(result.project.strategy); } })
      .catch(error => { if (active) { setInspection(null); setInspectionError(errorText(error)); } })
      .finally(() => { if (active) setInspecting(false); });
    return () => { active = false; };
  }, [call, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || backend?.state !== "running") { setMemories([]); return; }
    let active = true;
    void call<ProjectMemory[]>("memory.list", { projectId: selectedProjectId })
      .then(result => { if (active) setMemories(result); })
      .catch(() => { if (active) setMemories([]); });
    return () => { active = false; };
  }, [call, selectedProjectId, backend?.state]);

  useEffect(() => {
    if (!selectedRunId) { setEvents([]); return; }
    let active = true;
    const load = () => { void call<Subagent[]>("runs.subagents", { runId: selectedRunId })
      .then(result => { if (active) setSubagents(result); }).catch(() => {});
      return call<TaskEvent[]>("runs.events", { runId: selectedRunId })
      .then(result => { if (active) { setEvents(result); setEventsError(null); } })
      .catch(error => { if (active) setEventsError(errorText(error)); }); };
    void load();
    const poll = window.setInterval(load, 4000);
    return () => { active = false; window.clearInterval(poll); };
  }, [call, selectedRunId]);

  useEffect(() => { if (backend?.state === "running") refreshSettings(); }, [backend?.state, refreshSettings]);

  useEffect(() => { if (projects.length && !projects.some(project => project.id === runProjectId)) setRunProjectId(projects[0].id); }, [projects, runProjectId]);
  useEffect(() => { if (projects.length && !projects.some(project => project.id === scheduleProjectId)) setScheduleProjectId(projects[0].id); }, [projects, scheduleProjectId]);
  useEffect(() => { if (projects.length && !projects.some(project => project.id === imageProjectId)) setImageProjectId(projects[0].id); }, [projects, imageProjectId]);
  useEffect(() => { if (imageModels.length && !imageModels.some(item => `${item.provider}::${item.id}` === selectedImageModel)) setSelectedImageModel(`${imageModels[0].provider}::${imageModels[0].id}`); }, [imageModels, selectedImageModel]);
  useEffect(() => {
    setImageMask(null);
    setImageReference(null);
    if (!imageInputs[0] || backend?.state !== "running") return;
    let active = true;
    void call<{ dataUrl: string; mimeType: string; width?: number; height?: number }>("images.reference", { path: imageInputs[0] })
      .then((value) => { if (active) setImageReference(value); })
      .catch((error) => { if (active) { setImageReference(null); setNotice({ text: errorText(error), kind: "error" }); } });
    return () => { active = false; };
  }, [call, imageInputs, backend?.state]);
  useEffect(() => { if ((models.length || imageModels.length) && !keyProvider) setKeyProvider((models[0] ?? imageModels[0]).provider); }, [models, imageModels, keyProvider]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(null), 6000); return () => window.clearTimeout(timer); } }, [notice]);

  const projectName = useCallback((id: string) => projects.find(project => project.id === id)?.name ?? "已移除项目", [projects]);
  const model = models.find(item => `${item.provider}::${item.id}` === selectedModel);
  const reviewModel = models.find(item => `${item.provider}::${item.id}` === selectedReviewModel);
  const imageModel = imageModels.find(item => `${item.provider}::${item.id}` === selectedImageModel);
  const providers = [...new Set(["anthropic", "openai", "openrouter", "google", "deepseek", ...models, ...imageModels]
    .map(item => typeof item === "string" ? item : item.provider))];
  const activeRuns = runs.filter(run => run.status === "running" || run.status === "queued");
  const recentRuns = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filteredRuns = recentRuns.filter(run => !projectFilter || run.projectId === projectFilter);
  const filteredArtifacts = artifacts.filter(artifact => !projectFilter || artifact.projectId === projectFilter);
  const selectedRun = runs.find(run => run.id === selectedRunId);
  const selectedArtifact = artifacts.find(artifact => artifact.id === selectedArtifactId);
  const artifactImages = imageJobs.filter(job => job.runId === selectedArtifact?.runId && job.status === "completed")
    .sort((first, second) => (first.role === "cover" ? 0 : 1) - (second.role === "cover" ? 0 : 1) || first.sequence - second.sequence);
  const phoneJob = artifactImages.find(job => job.id === selectedPhoneJobId) ?? artifactImages[0];
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const filteredProjects = projects.filter(project => `${project.name} ${project.path}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (view !== "artifacts" || artifactTab !== "phone" || !phoneJob || imageResult?.jobId === phoneJob.id ||
      phoneLoadFailure === phoneJob.id) return;
    let active = true;
    void call<{ path: string; dataUrl: string }>("images.preview", { id: phoneJob.id })
      .then(result => { if (active) setImageResult({ ...result, jobId: phoneJob.id, projectId: phoneJob.projectId,
        projectName: projectName(phoneJob.projectId), prompt: phoneJob.prompt }); })
      .catch(() => { if (active) setPhoneLoadFailure(phoneJob.id); });
    return () => { active = false; };
  }, [view, artifactTab, phoneJob?.id, imageResult?.jobId, phoneLoadFailure, call, projectName]);

  async function perform(key: string, action: () => Promise<unknown>, success: string, after?: () => void) {
    setBusy(key); setNotice(null);
    try { await action(); setNotice({ text: success, kind: "success" }); after?.(); refreshAll(); }
    catch (error) { setNotice({ text: errorText(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  function navigate(next: View) { setView(next); setMobileNav(false); setProjectFilter(""); }
  function openRun(runId: string) { setSelectedRunId(runId); navigate("runs"); }
  function startForProject(projectId: string) { setRunProjectId(projectId); navigate("runs"); window.requestAnimationFrame(() => document.getElementById("run-prompt")?.focus()); }

  async function addProject() {
    setBusy("pick-project");
    try {
      const path = pickedPath(await call("dialog.pickRepository"));
      if (!path) return;
      const project = await call<Project>("projects.add", { path });
      setSelectedProjectId(project.id);
      navigate("projects");
      setNotice({ text: "仓库已添加。正在刷新项目列表。", kind: "success" });
      refreshAll();
    } catch (error) { setNotice({ text: errorText(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  async function installSkill() {
    setBusy("pick-skill");
    try {
      const path = pickedPath(await call("dialog.pickSkill"));
      if (!path) return;
      await call("skills.install", { path });
      setNotice({ text: "技能安装请求已完成。正在刷新技能库。", kind: "success" });
      refreshAll();
    } catch (error) { setNotice({ text: errorText(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  async function createSkill(event: FormEvent) {
    event.preventDefault();
    const name = skillName.trim();
    const description = skillDescription.trim();
    const body = skillBody.trim();
    const errors: typeof skillErrors = {};
    if (!name) errors.name = "请输入 Skill 名称。";
    else if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) errors.name = "使用 1–64 位小写字母、数字和单个连字符分隔词语。";
    if (!description) errors.description = "请输入简短描述。";
    else if (description.length > 1024) errors.description = "描述不能超过 1024 个字符。";
    if (!body) errors.body = "请输入 Skill 内容。";
    else if (body.length > 20_000) errors.body = "内容不能超过 20,000 个字符。";
    setSkillErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy("create-skill");
    try {
      const skill = await call<SkillEntry>("skills.create", { name, description, body });
      setSkills(current => current.some(item => item.path === skill.path) ? current : [skill, ...current]);
      setSkillName(""); setSkillDescription(""); setSkillBody("");
      setNotice({ text: `Skill「${skill.name}」已创建。`, kind: "success" });
      refreshAll();
    } catch (error) { setSkillErrors({ form: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function startRun(event: FormEvent) {
    event.preventDefault();
    if (!runProjectId || !prompt.trim()) return;
    await perform("start-run", async () => {
      const run = await call<TaskRun>("runs.start", { projectId: runProjectId, prompt: prompt.trim(),
        ...(parentRunId ? { parentRunId } : {}),
        ...(coverEnabled ? { coverStyle: coverStyleId, coverCount } : {}),
        ...(contentImageEnabled ? { contentImageCount, contentImageStyle: contentImageStyleId } : {}),
        ...(model ? { provider: model.provider, model: model.id } : {}),
        ...(reviewModel ? { reviewProvider: reviewModel.provider, reviewModel: reviewModel.id } : {}) });
      setSelectedRunId(run.id);
      setPrompt("");
      setParentRunId(null);
    }, "任务已提交，运行状态将持续更新。");
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    if (!scheduleProjectId || !schedulePrompt.trim() || intervalMinutes < 1) return;
    await perform("create-schedule", () => call("schedules.create", { projectId: scheduleProjectId, intervalMinutes, prompt: schedulePrompt.trim() }), "计划已创建。", () => setSchedulePrompt(""));
  }

  async function generateImage(event: FormEvent) {
    event.preventDefault();
    if (!imageProjectId || !imagePrompt.trim() || (imageEngine === "openrouter" && !imageModel)) return;
    if (imageEngine === "responses") {
      const prompts = imagePrompt.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      let batch: string[];
      try { batch = prompts.flatMap((item) => Array.from({ length: imageVariants }, () => imageStyleId ? buildStyledImagePrompt(item, imageStyleId) : item)); }
      catch (error) { setNotice({ kind: "error", text: errorText(error) }); return; }
      if (batch.length > 12 || batch.some((item) => item.length > 6000)) {
        setNotice({ kind: "error", text: "每批最多 12 张图片，每条提示词不超过 6000 字。" });
        return;
      }
      await perform("enqueue-images", () => call("images.enqueue", {
        projectId: imageProjectId, prompts: batch, inputs: imageInputs, maskData: imageMask,
      }), `已加入 ${batch.length} 个生图任务；按顺序执行，可在下方查看进度。`);
      return;
    }
    setImageResult(null);
    await perform("generate-image", async () => {
      const result = await call<{ path: string; dataUrl: string }>("images.generate", {
        projectId: imageProjectId, prompt: imageStyleId ? buildStyledImagePrompt(imagePrompt.trim(), imageStyleId) : imagePrompt.trim(), provider: imageModel?.provider, model: imageModel?.id,
      });
      setImageResult({ ...result, projectId: imageProjectId, projectName: projectName(imageProjectId), prompt: imagePrompt.trim() });
    }, "图片已生成，可在下方预览。");
  }

  async function previewImage(job: ImageJob) {
    await perform(`preview-${job.id}`, async () => {
      const result = await call<{ path: string; dataUrl: string }>("images.preview", { id: job.id });
      setImageResult({ ...result, jobId: job.id, projectId: job.projectId, projectName: projectName(job.projectId), prompt: job.prompt });
    }, "图片已载入预览。");
  }

  async function revealImage(job: ImageJob) {
    await perform(`reveal-${job.id}`, () => call("images.reveal", { id: job.id }), "已在文件夹中定位图片。");
  }

  async function pickImage() {
    try {
      const path = pickedPath(await call("dialog.pickImage"));
      if (path) setImageInputs(current => [...new Set([...current, path])].slice(0, 8));
    } catch (error) { setNotice({ text: errorText(error), kind: "error" }); }
  }

  const header = nav.find(item => item.view === view)!;
  const listError = (key: ListKey) => listErrors[key] && <div className="inline-error" role="alert">{listErrors[key]} <button onClick={refreshAll}>重试</button></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><span>i</span><span>o</span></div><div><strong>indie<span>ops</span></strong><small>独立创造者工作台</small></div><button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="关闭导航"><Icon name="close" /></button></div>
      <div className="nav-caption">工作空间 <span>01 / {String(nav.length).padStart(2, "0")}</span></div>
      <nav aria-label="主导航">{nav.map(item => <button key={item.view} className={`nav-item ${view === item.view ? "active" : ""}`} onClick={() => navigate(item.view)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.view === "runs" && activeRuns.length > 0 && <span className="nav-count">{activeRuns.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-service"><span className={`service-light ${backend?.state ?? "stopped"}`} /><div><strong>本地服务</strong><small>{listErrors.backend ? "连接失败" : backend ? backendLabels[backend.state] : "检测中"}</small></div><button className="icon-button" title="刷新状态" aria-label="刷新服务状态" onClick={refreshBackend}><Icon name="refresh" size={16} /></button></div><div className="sidebar-foot">INDIEOPS <span>© 2026</span></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}

    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="打开导航"><Icon name="menu" /></button><span className="breadcrumb">工作空间 <Icon name="chevron" size={13} /> {header.label}</span><div className="topbar-right"><span className="topbar-date">{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date())}</span><span className="topbar-divider" /><span className="avatar">IO</span></div></header>
      <div className={`page-content view-${view}`}>
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{header.eyebrow}</div><h1>{header.title}<span className="heading-period">.</span></h1><p>{header.description}</p></div><div className="heading-actions">{view !== "settings" && <button className="button button-quiet" onClick={refreshAll} aria-label="刷新数据"><Icon name="refresh" size={16} />刷新</button>}{(view === "dashboard" || view === "projects") && <button className="button button-primary" onClick={addProject} disabled={busy === "pick-project"}><Icon name="plus" size={17} />{busy === "pick-project" ? "添加中…" : "添加仓库"}</button>}</div></div>

        {notice && <div className={`notice notice-${notice.kind}`} role="status"><Icon name={notice.kind === "error" ? "stop" : "check"} size={17} /><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="关闭提示"><Icon name="close" size={15} /></button></div>}
        {loading && <div className="loading-bar" role="status">正在同步工作台数据…</div>}
        {view === "artifacts" && selectedArtifact && <div className="iteration-banner"><span>当前草稿可作为下一轮优化的上下文；所有产品事实仍会重新核对 Git 提交。</span><button className="button button-outline" onClick={() => { setRunProjectId(selectedArtifact.projectId); setParentRunId(selectedArtifact.runId); setPrompt("根据我的反馈优化上一轮草稿："); navigate("runs"); }}>基于此稿继续纠偏 <Icon name="arrow" size={16} /></button></div>}
        {view === "runs" && parentRunId && <div className="iteration-banner parent-run-banner"><span>正在迭代任务 {parentRunId.slice(0, 8)} 的草稿</span><button className="button button-text" onClick={() => setParentRunId(null)}>取消关联</button></div>}
        {view === "projects" && selectedProjectId && <section className="panel memory-panel"><SectionTitle label="PROJECT MEMORY" title="运营反馈记忆" aside={<span className="muted-small">只影响表达策略，不替代 Git 事实</span>} /><form onSubmit={event => { event.preventDefault(); if (!memoryText.trim()) return; void perform("memory-add", async () => { const result = await call<ProjectMemory[]>("memory.add", { projectId: selectedProjectId, content: memoryText.trim() }); setMemories(result); setMemoryText(""); }, "反馈已保存，后续任务会参考。") }}><input value={memoryText} onChange={event => setMemoryText(event.target.value)} placeholder="例如：少用夸张标题，多讲真实开发取舍" maxLength={4000} /><button className="button button-primary" disabled={!memoryText.trim() || busy === "memory-add"}>保存反馈</button></form>{memories.length > 0 && <div className="memory-list">{memories.map(memory => <div key={memory.id}><span>{memory.content}</span><button className="icon-button danger" aria-label="删除反馈" onClick={() => perform("memory-delete", async () => { await call("memory.delete", { memoryId: memory.id }); setMemories(current => current.filter(item => item.id !== memory.id)); }, "反馈已删除。") }><Icon name="trash" size={16} /></button></div>)}</div>}</section>}
        {view === "runs" && selectedRun && <section className="panel subagents-panel"><SectionTitle label="AGENT ORCHESTRATION" title="子 Agent 执行链" aside={<span className="muted-small">{subagents.length} 个独立会话</span>} /><div className="subagent-list">{subagents.length ? subagents.map(child => <article key={child.id}><span className={`status-dot status-${child.status}`} /><div><strong>第 {child.attempt} 轮 · {child.role === "writer" ? "写作 Agent" : "事实审校 Agent"}</strong><small>{child.provider} / {child.model} · {dateTime(child.createdAt)}</small>{child.error && <p className="inline-error">{child.error}</p>}<details><summary>查看子任务输出</summary><pre>{child.output || "暂无输出"}</pre></details></div><span className="subtle-badge">{runLabels[child.status]}</span></article>) : <p className="quiet-message">任务启动后，这里会显示各子 Agent 的独立执行记录。</p>}</div></section>}
        {view === "runs" && <section className="panel review-model-panel"><div className="review-model-heading"><span className="image-panel-icon"><Icon name="branch" size={19} /></span><div><span className="section-kicker">SUBAGENT / REVIEW</span><h2>独立审校 Agent</h2><p>写作完成后独立会话核对 Git 证据；可选择不同服务商。</p></div></div><label htmlFor="review-model">审校模型</label><select id="review-model" className="model-picker" value={selectedReviewModel} onChange={event => setSelectedReviewModel(event.target.value)}><option value="">沿用写作模型</option>{[...new Set(models.map(item => item.provider))].map(provider => <optgroup key={provider} label={provider}>{models.filter(item => item.provider === provider).map(item => <option key={item.id} value={`${provider}::${item.id}`}>{item.name} · {item.id}</option>)}</optgroup>)}</select>{!models.length && <p className="quiet-message">暂无可用模型。请先在设置中添加凭据或中转服务商。</p>}</section>}

        {view === "runs" && <section className="panel cover-option-panel">
          <div className="review-model-heading"><span className="image-panel-icon"><Icon name="image" size={19} /></span><div><span className="section-kicker">OPTIONAL / VISUAL STORY</span><h2>随文图片方案</h2><p>写作 Agent 为每张图设计独立的主题与构图；审校通过后才加入图片队列。</p></div></div>
          <label className="cover-toggle"><input type="checkbox" checked={coverEnabled} onChange={event => setCoverEnabled(event.target.checked)} />生成封面（1–10 张）</label>
          {coverEnabled && <div className="cover-style-row"><label>封面视觉风格<select value={coverStyleId} onChange={event => setCoverStyleId(event.target.value)}>{imageStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label><label>封面数量<select value={coverCount} onChange={event => setCoverCount(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 张</option>)}</select></label><p>{imageStyles.find(style => style.id === coverStyleId)?.description}</p></div>}
          <label className="cover-toggle"><input type="checkbox" checked={contentImageEnabled} onChange={event => setContentImageEnabled(event.target.checked)} />生成正文内容配图（1–10 张）</label>
          {contentImageEnabled && <div className="cover-style-row"><label>配图视觉风格<select value={contentImageStyleId} onChange={event => setContentImageStyleId(event.target.value)}>{imageStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label><label>配图数量<select value={contentImageCount} onChange={event => setContentImageCount(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 张</option>)}</select></label><p>{imageStyles.find(style => style.id === contentImageStyleId)?.description}</p></div>}
          <p className="field-hint">共 {Number(coverEnabled ? coverCount : 0) + Number(contentImageEnabled ? contentImageCount : 0)} 张，各自独立提示词、分别计费。内容配图须对应不同正文片段；队列最多容纳 40 个待执行任务。图片不会自动发布。只想生图？<button type="button" className="text-link" onClick={() => { setImageProjectId(runProjectId); navigate("images"); }}>前往独立生图</button></p>
        </section>}
        {view === "runs" && selectedRun && (selectedRun.coverStyle || selectedRun.contentImageCount) && <section className="panel run-cover-panel"><SectionTitle label="TASK / IMAGE" title="图片执行进度" aside={<span className="muted-small">封面 {selectedRun.coverStyle ? selectedRun.coverCount ?? 1 : 0} · 配图 {selectedRun.contentImageCount ?? 0}</span>} />
          {imageJobs.filter(job => job.runId === selectedRun.id).map(job => <div className="image-job" key={job.id}><span className={`image-job-status ${job.status}`} /><div><strong>{job.role === "content" ? "内容配图" : "封面"} {job.sequence} · {job.status === "queued" ? "排队中" : job.status === "running" ? "生成中" : job.status === "completed" ? "已完成" : job.status === "aborted" ? "已取消" : "失败"}</strong><small>{dateTime(job.createdAt)} · {job.prompt.slice(0, 100)}</small>{job.error && <p className="inline-error">{job.error}</p>}</div><div className="image-job-actions">{job.status === "completed" && <><button className="button button-outline" onClick={() => previewImage(job)}>预览</button><button className="button button-outline" onClick={() => revealImage(job)}>定位文件</button></>}{["failed", "aborted"].includes(job.status) && <button className="button button-outline" onClick={() => perform(`retry-${job.id}`, () => call("images.retry", { id: job.id }), "图片已重新加入队列。")}>重试</button>}{["queued", "running"].includes(job.status) && <button className="button button-quiet" onClick={() => perform(`cancel-${job.id}`, () => call("images.cancel", { id: job.id }), "已请求取消生图。")}>取消</button>}</div></div>)}
          {imageJobs.some(job => job.runId === selectedRun.id && job.outputPath === imageResult?.path) && imageResult && <img className="run-cover-preview" src={imageResult.dataUrl} alt="关联任务图片预览" />}
          {!imageJobs.some(job => job.runId === selectedRun.id) && <p className="quiet-message">{selectedRun.status === "running" ? "等待文案审校通过后入队。" : events.find(item => item.type === "images_enqueue_failed" || item.type === "cover_enqueue_failed") ? "图片未能入队，请查看任务事件记录。" : "本轮未产生图片。"} {selectedRun.status === "completed" && <button className="button button-outline" onClick={() => perform("queue-images", () => call("runs.queueImages", { runId: selectedRun.id }), "图片已重新加入队列。")}>重新加入图片队列</button>}</p>}
        </section>}
        {view === "runs" && selectedRun?.status === "completed" && artifacts.some(item => item.runId === selectedRun.id) && <div className="iteration-banner"><span>任务执行与审校已结束；正式正文、封面和人工批准在内容产物中处理。</span><button className="button button-outline" onClick={() => { setSelectedArtifactId(artifacts.find(item => item.runId === selectedRun.id)!.id); setArtifactTab("preview"); navigate("artifacts"); }}>查看正式产物 <Icon name="arrow" size={16} /></button></div>}
        {view === "runs" && selectedRun?.status === "failed" && selectedRun.output && <div className="iteration-banner"><span>自动审校已停止，最后草稿和反馈已保留。可以人工纠偏后重新发起。</span><button className="button button-outline" onClick={() => { setParentRunId(selectedRun.id); setRunProjectId(selectedRun.projectId); setPrompt("根据审校反馈修订上一轮草稿，未证实的界面效果仅描述代码状态："); window.requestAnimationFrame(() => document.getElementById("run-prompt")?.focus()); }}>基于最后草稿继续 <Icon name="arrow" size={16} /></button></div>}

        {view === "images" && <>
          <section className="panel image-panel">
            <div className="image-panel-heading"><span className="image-panel-icon"><Icon name="image" size={21} /></span><div><span className="section-kicker">IMAGE STUDIO / LOCAL QUEUE</span><h2>生图工作台</h2><p>无需修改或启动文案任务。选择一个项目存放图片，输入描述即可生成；也可上传参考图并圈选修改区域。</p></div></div>
            <button type="button" className="button button-outline image-folder-action" disabled={!imageProjectId} onClick={() => perform("open-image-folder", () => call("images.projectFolder", { projectId: imageProjectId }), "已打开项目图片目录。")}>打开项目图片目录</button>
            {listError("images")}{listError("imageJobs")}
            <form className="image-composer" onSubmit={generateImage}>
              <div className="image-form-fields"><label>关联项目<select value={imageProjectId} onChange={event => setImageProjectId(event.target.value)} required><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>生成引擎<select value={imageEngine} onChange={event => setImageEngine(event.target.value as "responses" | "openrouter")}><option value="responses">Responses · 队列 / 局部编辑</option><option value="openrouter">OpenRouter · 单张生成</option></select></label></div>
              {imageEngine === "openrouter" ? <label className="image-model-field">图像模型<select value={selectedImageModel} onChange={event => setSelectedImageModel(event.target.value)} required><option value="">选择模型</option>{imageModels.map(item => <option key={`${item.provider}::${item.id}`} value={`${item.provider}::${item.id}`}>{item.provider} / {item.name}</option>)}</select></label> : <div className="image-reference-zone"><div className="image-zone-copy"><strong>参考图与局部修改</strong><span>首张 PNG 可直接涂抹遮罩；透明区域由 Responses 工具重绘。</span></div><div className="image-inputs"><button type="button" className="button button-outline" onClick={pickImage} disabled={imageInputs.length >= 8}><Icon name="plus" size={15} />添加参考图</button>{imageInputs.map(path => <span key={path} title={path}>{path.split(/[\\/]/).at(-1)} <button type="button" aria-label={`移除 ${path}`} onClick={() => setImageInputs(current => current.filter(item => item !== path))}>×</button></span>)}</div>{imageReference?.mimeType === "image/png" && imageReference.width && imageReference.height && <MaskEditor key={imageInputs[0]} source={{ dataUrl: imageReference.dataUrl, width: imageReference.width, height: imageReference.height }} onChange={setImageMask} />}{imageReference && imageReference.mimeType !== "image/png" && <p className="field-hint">第一张参考图需为 PNG 才能绘制遮罩；普通编辑仍支持 JPEG / WebP。</p>}</div>}
              <div className="image-style-field"><label htmlFor="image-style">视觉风格</label><select id="image-style" value={imageStyleId} onChange={event => setImageStyleId(event.target.value)}><option value="">不套用风格</option>{imageStyles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select><p className="field-hint">{imageStyles.find(style => style.id === imageStyleId)?.description || "直接使用你输入的画面描述。"} 预设会补充构图、材质与真实性约束。</p>{imageStyleId && <details className="style-preview"><summary>查看风格指令</summary><p>{imageStyles.find(style => style.id === imageStyleId)?.direction}</p></details>}</div>
              <div className="image-prompt-heading"><label htmlFor="image-prompt">画面描述</label>{imageEngine === "responses" && <span>每行一个任务 · 最多 12 张</span>}</div>
              <textarea id="image-prompt" value={imagePrompt} onChange={event => setImagePrompt(event.target.value)} placeholder={imageEngine === "responses" ? "独立开发者工作日志封面，留出标题空间…\n同主题的另一种构图，突出产品界面…" : "描述画面内容、风格与用途…"} rows={4} required />
              <div className="image-form-footer">{imageEngine === "responses" ? <label>每条生成<select value={imageVariants} onChange={event => setImageVariants(Number(event.target.value))}><option value={1}>1 张</option><option value={2}>2 张</option><option value={3}>3 张</option><option value={4}>4 张</option></select></label> : <span>OpenRouter 使用已有的图像模型配置。</span>}<div><span className="field-hint">加入队列后即开始调用模型，可能产生费用。</span><button className="button button-primary" disabled={!imageProjectId || (imageEngine === "openrouter" && !imageModel) || !imagePrompt.trim() || busy === "generate-image" || busy === "enqueue-images"}><Icon name="spark" size={16} />{busy === "generate-image" || busy === "enqueue-images" ? "处理中…" : imageEngine === "responses" ? "加入并执行" : "生成图片"}</button></div></div>
            </form>
            {imageEngine === "responses" && <div className="image-queue"><div className="image-queue-heading"><div><span className="section-kicker">PRODUCTION QUEUE</span><h3>任务队列</h3></div><span>{imageJobs.filter(job => job.projectId === imageProjectId && ["queued", "running"].includes(job.status)).length} 个待处理</span></div>{imageJobs.filter(job => job.projectId === imageProjectId).slice(0, 50).length ? imageJobs.filter(job => job.projectId === imageProjectId).slice(0, 50).map(job => <article className="image-job" key={job.id}><span className={`image-job-status ${job.status}`} /><div><strong>{job.role === "content" ? `内容配图 ${job.sequence}` : job.role === "cover" ? `封面 ${job.sequence}` : job.prompt}</strong><small>{job.maskPath ? "局部遮罩编辑" : job.inputs.length ? "参考图编辑" : "新图生成"} · {dateTime(job.createdAt)} · {job.status === "queued" ? "排队中" : job.status === "running" ? "生成中" : job.status === "completed" ? "已完成" : job.status === "aborted" ? "已取消" : "失败"}</small>{job.error && <p className="inline-error">{job.error}</p>}</div><div className="image-job-actions">{job.status === "completed" && <><button className="button button-outline" onClick={() => previewImage(job)}>预览</button><button className="button button-outline" onClick={() => revealImage(job)}>定位文件</button></>}{["failed", "aborted"].includes(job.status) && <button className="button button-outline" onClick={() => perform(`retry-${job.id}`, () => call("images.retry", { id: job.id }), "已重新加入队列。")}>重试</button>}{["queued", "running"].includes(job.status) && <button className="button button-quiet" onClick={() => perform(`cancel-${job.id}`, () => call("images.cancel", { id: job.id }), "已请求取消。")}>取消</button>}</div></article>) : <p className="quiet-message">当前项目尚无图片任务。填写描述后加入队列，运行记录会保留。</p>}</div>}
            {imageResult?.projectId === imageProjectId && <div className="image-result"><div><strong>图片预览</strong><span>{imageResult.projectName}</span></div>{imageResult.dataUrl?.startsWith("data:image/") ? <img src={imageResult.dataUrl} alt={imageResult.prompt} /> : <p className="quiet-message">预览数据不可用，图片已保存至下方路径。</p>}<code title={imageResult.path}>{imageResult.path}</code><button className="button button-outline" onClick={() => imageResult.jobId ? void perform("reveal-preview", () => call("images.reveal", { id: imageResult.jobId }), "已定位图片文件。") : void perform("reveal-generated", () => call("images.revealGenerated", { projectId: imageResult.projectId, path: imageResult.path }), "已定位图片文件。")}>在文件夹中定位图片</button></div>}
          </section>
        </>}

        {view === "skills" && <section className="panel skill-create-panel">
          <SectionTitle label="CREATE / CUSTOM SKILL" title="创建自定义 Skill" aside={<span className="muted-small">保存为本地技能</span>} />
          <form onSubmit={createSkill} noValidate>
            <div className="skill-create-fields">
              <label htmlFor="skill-name">名称 <span>小写字母、数字及连字符</span><input id="skill-name" value={skillName} onChange={event => { setSkillName(event.target.value); setSkillErrors(current => ({ ...current, name: undefined, form: undefined })); }} placeholder="例如 release-notes" maxLength={64} aria-invalid={Boolean(skillErrors.name)} aria-describedby={skillErrors.name ? "skill-name-error" : undefined} />{skillErrors.name && <small id="skill-name-error" className="field-error">{skillErrors.name}</small>}</label>
              <label htmlFor="skill-description">描述<input id="skill-description" value={skillDescription} onChange={event => { setSkillDescription(event.target.value); setSkillErrors(current => ({ ...current, description: undefined, form: undefined })); }} placeholder="这个 Skill 在什么情况下使用？" maxLength={1024} aria-invalid={Boolean(skillErrors.description)} aria-describedby={skillErrors.description ? "skill-description-error" : undefined} />{skillErrors.description && <small id="skill-description-error" className="field-error">{skillErrors.description}</small>}</label>
            </div>
            <label className="skill-body-label" htmlFor="skill-body">内容<textarea id="skill-body" value={skillBody} onChange={event => { setSkillBody(event.target.value); setSkillErrors(current => ({ ...current, body: undefined, form: undefined })); }} placeholder="写下 Skill 的使用说明、步骤和约束…" rows={4} maxLength={20_000} aria-invalid={Boolean(skillErrors.body)} aria-describedby={skillErrors.body ? "skill-body-error" : undefined} />{skillErrors.body && <small id="skill-body-error" className="field-error">{skillErrors.body}</small>}</label>
            {skillErrors.form && <div className="inline-error" role="alert">{skillErrors.form}</div>}
            <div className="form-footer"><span>名称与描述会自动写入 Skill 元数据。</span><button className="button button-primary" disabled={busy === "create-skill"}><Icon name="plus" size={16} />{busy === "create-skill" ? "创建中…" : "创建 Skill"}</button></div>
          </form>
        </section>}

        {view === "dashboard" && <>
          <section className="hero-grid"><div className="hero-card"><div className="hero-top"><span className="hero-tag"><span className="pulse-dot" />LOCAL WORKBENCH</span><Icon name="spark" size={27} /></div><div><span className="hero-overline">从想法，到可追溯的交付</span><h2>让每一次代码变化<br />都有下一步<span>。</span></h2><p>连接你的仓库，启动任务，并将每份产物与真实提交关联。</p></div><div className="hero-actions"><button className="button button-light" onClick={() => projects.length ? startForProject(projects[0].id) : addProject()}>{projects.length ? "开始一项任务" : "连接第一个仓库"}<Icon name="arrow" size={17} /></button><span>{projects.length} 个已连接仓库</span></div><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /></div>
          <div className="backend-card"><div className="backend-card-head"><span className="section-kicker">SERVICE / STATUS</span><Icon name="bolt" size={19} /></div><h3>后端服务</h3><div className={`backend-state ${backend?.state ?? "stopped"}`}><span className="service-light" />{listErrors.backend ? "状态获取失败" : backend ? backendLabels[backend.state] : "正在检测"}</div><p>{backend?.state === "running" ? `服务已就绪${backend.pid ? ` · PID ${backend.pid}` : ""}` : backend?.error || listErrors.backend || "部署或重启本地服务，开始使用工作台。"}</p><div className="backend-actions"><button className="button button-outline" onClick={() => perform("deploy", () => call("backend.deploy"), "部署命令已完成，正在检查服务状态。", refreshBackend)} disabled={busy === "deploy" || backend?.state === "starting"}>{busy === "deploy" ? "部署中…" : "一键部署"}</button><button className="button button-text" onClick={() => perform("restart", () => call("backend.restart"), "重启命令已完成，正在检查服务状态。", refreshBackend)} disabled={busy === "restart" || backend?.state === "starting"}><Icon name="refresh" size={15} />重启</button></div></div></section>
          <section className="stats-grid"><div className="stat-card"><span>已连接仓库</span><strong>{projects.length.toString().padStart(2, "0")}</strong><small><Icon name="folder" size={15} />项目资源</small></div><div className="stat-card"><span>进行中任务</span><strong>{activeRuns.length.toString().padStart(2, "0")}</strong><small><Icon name="activity" size={15} />实时运行</small></div><div className="stat-card"><span>内容产物</span><strong>{artifacts.length.toString().padStart(2, "0")}</strong><small><Icon name="document" size={15} />全部状态</small></div><div className="stat-card"><span>启用计划</span><strong>{schedules.filter(item => item.enabled).length.toString().padStart(2, "0")}</strong><small><Icon name="calendar" size={15} />自动执行</small></div></section>
          <div className="dashboard-columns"><section className="panel"><SectionTitle label="RECENT ACTIVITY" title="最近任务" aside={<button className="text-link" onClick={() => navigate("runs")}>查看全部 <Icon name="arrow" size={15} /></button>} />{listError("runs")}{recentRuns.length ? <div className="activity-list">{recentRuns.slice(0, 5).map(run => <button className="activity-row" key={run.id} onClick={() => openRun(run.id)}><span className="activity-symbol"><Icon name="activity" size={18} /></span><span className="activity-main"><strong>{run.prompt}</strong><small>{projectName(run.projectId)} · {dateTime(run.createdAt)}</small></span><StatusPill status={run.status} /><Icon name="chevron" size={16} /></button>)}</div> : <Empty icon="activity" title="还没有任务记录">从已连接仓库发起第一项任务。</Empty>}</section>
          <section className="panel projects-panel"><SectionTitle label="YOUR REPOSITORIES" title="项目仓库" aside={<button className="text-link" onClick={() => navigate("projects")}>管理项目 <Icon name="arrow" size={15} /></button>} />{listError("projects")}{projects.length ? <div className="compact-projects">{projects.slice(0, 4).map(project => <button key={project.id} onClick={() => { setSelectedProjectId(project.id); navigate("projects"); }}><span className="project-monogram">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small><Icon name="branch" size={13} />{project.branch} · {shortSha(project.head)}</small></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty icon="folder" title="还没有连接仓库">添加一个本地 Git 仓库，开始你的工作流。</Empty>}</section></div>
        </>}

        {view === "projects" && <div className="workspace-grid"><section className="panel list-panel"><SectionTitle label={`${projects.length} REPOSITORIES`} title="已连接仓库" /><label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索仓库名称或路径" /></label>{listError("projects")}{filteredProjects.length ? <div className="selection-list">{filteredProjects.map(project => <button key={project.id} className={`selection-item ${selectedProjectId === project.id ? "selected" : ""}`} onClick={() => setSelectedProjectId(project.id)}><span className="project-monogram">{project.name.slice(0, 1).toUpperCase()}</span><span className="selection-copy"><strong>{project.name}</strong><small>{project.path}</small><em><Icon name="branch" size={13} />{project.branch} <span>·</span> {shortSha(project.head)} {project.dirty && <b>有未提交更改</b>}</em></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty icon="folder" title={query ? "没有匹配的仓库" : "还没有项目"}>{query ? "试试其他关键词。" : "选择一个本地仓库并添加到工作台。"}</Empty>}</section>
          <section className="panel detail-panel">{selectedProject ? <><div className="detail-head"><div><span className="section-kicker">REPOSITORY DETAIL</span><h2>{selectedProject.name}</h2><p className="path-text" title={selectedProject.path}>{selectedProject.path}</p></div><span className={`subtle-badge ${selectedProject.dirty ? "warm" : ""}`}>{selectedProject.dirty ? "工作区有更改" : "工作区干净"}</span></div>{inspectionError && <div className="inline-error" role="alert">{inspectionError}<button onClick={() => setSelectedProjectId(null)}>关闭</button></div>}<div className="detail-metrics"><div><span>当前分支</span><strong><Icon name="branch" size={16} />{selectedProject.branch}</strong></div><div><span>最新提交</span><strong className="mono">{shortSha(selectedProject.head)}</strong></div><div><span>上次处理</span><strong className="mono">{shortSha(selectedProject.lastProcessedSha)}</strong></div></div><form className="strategy-form" onSubmit={event => { event.preventDefault(); if (!strategy.trim()) return; void perform("strategy", () => call("projects.strategy", { projectId: selectedProject.id, strategy: strategy.trim() }), "项目策略已保存。"); }}><label htmlFor="strategy">处理策略</label><div><input id="strategy" value={strategy} onChange={event => setStrategy(event.target.value)} placeholder="例如：聚焦用户可见的变化" /><button className="button button-outline" disabled={!strategy.trim() || strategy === selectedProject.strategy || busy === "strategy"}>{busy === "strategy" ? "保存中…" : "保存"}</button></div></form><div className="detail-actions"><button className="button button-primary" onClick={() => startForProject(selectedProject.id)}><Icon name="play" size={15} />发起任务</button><button className="button button-danger-quiet" disabled={busy === "remove-project"} onClick={() => { if (window.confirm(`确定移除「${selectedProject.name}」？本地仓库文件不会被删除。`)) void perform("remove-project", () => call("projects.remove", { projectId: selectedProject.id }), "项目已从工作台移除。", () => setSelectedProjectId(null)); }}><Icon name="trash" size={15} />移除项目</button></div><div className="divider" /><SectionTitle label="GIT HISTORY" title="最近提交" aside={<span className="muted-small">{inspecting ? "正在检查…" : `${inspection?.commits.length ?? 0} 条`}</span>} />{inspection?.commits.length ? <div className="commit-list">{inspection.commits.map(commit => <div className="commit-row" key={commit.sha}><span className="commit-line-dot" /><div><strong>{commit.subject}</strong><p>{commit.author} · {dateTime(commit.date)}</p>{commit.files.length > 0 && <small>{commit.files.length} 个文件</small>}</div><code>{shortSha(commit.sha)}</code></div>)}</div> : !inspecting && <Empty icon="branch" title="暂无提交信息">检查仓库后，提交记录会显示在这里。</Empty>}</> : <Empty icon="folder" title="选择一个项目">从左侧选择仓库，查看分支、提交和处理策略。</Empty>}</section></div>}

        {view === "runs" && <><section className="panel composer-panel"><SectionTitle label="NEW TASK" title="发起任务" aside={<span className="muted-small">任务将关联到所选仓库</span>} />{listError("providers")}<form onSubmit={startRun}><div className="form-row"><label>项目仓库<select value={runProjectId} onChange={event => setRunProjectId(event.target.value)} required><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>模型（可选）<select value={selectedModel} onChange={event => setSelectedModel(event.target.value)}><option value="">使用默认模型</option>{models.map(item => <option key={`${item.provider}::${item.id}`} value={`${item.provider}::${item.id}`}>{item.provider} / {item.name}</option>)}</select></label></div><label className="prompt-label" htmlFor="run-prompt">任务说明</label><textarea id="run-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述希望完成的工作，尽量说明目标与预期产出…" rows={3} required /><div className="form-footer"><span>任务提交后，可在下方查看事件记录与结果。</span><button className="button button-primary" disabled={!projects.length || !prompt.trim() || busy === "start-run"}><Icon name="send" size={16} />{busy === "start-run" ? "提交中…" : "启动任务"}</button></div></form></section><div className="workspace-grid runs-grid"><section className="panel list-panel"><SectionTitle label={`${filteredRuns.length} TASKS`} title="运行记录" aside={<select className="filter-select" value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">全部项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>} />{listError("runs")}{filteredRuns.length ? <div className="selection-list">{filteredRuns.map(run => <button className={`selection-item run-item ${selectedRunId === run.id ? "selected" : ""}`} key={run.id} onClick={() => setSelectedRunId(run.id)}><span className="run-icon"><Icon name="activity" size={18} /></span><span className="selection-copy"><strong>{run.prompt}</strong><small>{projectName(run.projectId)} · {dateTime(run.createdAt)}</small><StatusPill status={run.status} /></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty icon="activity" title="暂无运行记录">填写上方任务说明，开始第一项工作。</Empty>}</section><section className="panel detail-panel">{selectedRun ? <><div className="detail-head"><div><span className="section-kicker">TASK / {selectedRun.id.slice(0, 8)}</span><h2>任务详情</h2><p>{projectName(selectedRun.projectId)} · 创建于 {dateTime(selectedRun.createdAt)}</p></div><StatusPill status={selectedRun.status} /></div><div className="task-prompt">{selectedRun.prompt}</div><div className="detail-metrics"><div><span>基准提交</span><strong className="mono">{shortSha(selectedRun.baselineSha)}</strong></div><div><span>目标提交</span><strong className="mono">{shortSha(selectedRun.targetSha)}</strong></div><div><span>模型</span><strong>{selectedRun.model || "默认"}</strong></div></div>{selectedRun.error && <div className="inline-error" role="alert">{selectedRun.error}</div>}{selectedRun.output && <div className="output-block"><span className="section-kicker">OUTPUT</span><pre>{selectedRun.output}</pre></div>}{(selectedRun.status === "running" || selectedRun.status === "queued") && <div className="steer-box"><label htmlFor="steer-text">运行中追加指令</label><div><input id="steer-text" value={steerText} onChange={event => setSteerText(event.target.value)} placeholder="补充方向或约束…" onKeyDown={event => { if (event.key === "Enter" && steerText.trim()) { event.preventDefault(); void perform("steer", () => call("runs.steer", { runId: selectedRun.id, text: steerText.trim() }), "指令已发送。", () => setSteerText("")); } }} /><button className="button button-outline" disabled={!steerText.trim() || busy === "steer"} onClick={() => perform("steer", () => call("runs.steer", { runId: selectedRun.id, text: steerText.trim() }), "指令已发送。", () => setSteerText(""))}><Icon name="send" size={15} />发送</button></div><button className="button button-danger-quiet" disabled={busy === "abort"} onClick={() => { if (window.confirm("确定中止这项任务？")) void perform("abort", () => call("runs.abort", { runId: selectedRun.id }), "中止请求已发送，正在更新状态。"); }}><Icon name="stop" size={15} />中止任务</button></div>}<div className="divider" /><SectionTitle label="AUDIT TRAIL" title="事件记录" aside={<span className="muted-small">{events.length} 条</span>} />{eventsError && <div className="inline-error" role="alert">{eventsError}</div>}{events.length ? <div className="event-list">{events.map(item => <div className="event-row" key={item.id}><span className="event-marker" /><div><strong>{item.type}</strong><time>{dateTime(item.createdAt)}</time>{item.payload != null && <pre>{typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload, null, 2)}</pre>}</div></div>)}</div> : <p className="quiet-message">暂无事件，运行中的更新会自动显示在这里。</p>}</> : <Empty icon="activity" title="选择一项任务">查看输出、事件记录与实时状态。</Empty>}</section></div></>}

        {view === "artifacts" && <>
          {selectedArtifact && selectedArtifact.status !== "published" && <div className="artifact-review"><div><strong>{selectedArtifact.status === "draft" ? "草稿待人工核对" : "已批准，待手动发布"}</strong><p>仅记录本地状态，不会自动发布。先检查正式正文、提交依据及封面。</p></div><button className={`button ${selectedArtifact.status === "draft" ? "button-outline" : "button-primary"}`} disabled={busy === "artifact-status" || !selectedArtifact.publishableMarkdown} onClick={() => { const status = selectedArtifact.status === "draft" ? "approved" : "published"; if (status === "published" && !window.confirm("确认已经在外部完成发布？工作台不会代替你发布。")) return; void perform("artifact-status", () => call("artifacts.status", { artifactId: selectedArtifact.id, status }), status === "approved" ? "已标记批准。" : "已标记已发布。"); }}><Icon name="check" size={16} />{selectedArtifact.status === "draft" ? "标记批准" : "标记已发布"}</button></div>}
          <div className="workspace-grid"><section className="panel list-panel"><SectionTitle label={`${filteredArtifacts.length} ARTIFACTS`} title="文案产物" aside={<select className="filter-select" value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">全部项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>} />{listError("artifacts")}{filteredArtifacts.length ? <div className="selection-list">{[...filteredArtifacts].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).map(artifact => <button className={`selection-item ${selectedArtifactId === artifact.id ? "selected" : ""}`} key={artifact.id} onClick={() => { setSelectedArtifactId(artifact.id); setArtifactTab("preview"); }}><span className="run-icon"><Icon name="document" size={18} /></span><span className="selection-copy"><strong>{artifact.publishableMarkdown?.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "") || "待整理的历史稿"}</strong><small>{projectName(artifact.projectId)} · {dateTime(artifact.createdAt)}</small><em>{artifact.status === "published" ? "已发布" : artifact.status === "approved" ? "已批准" : "草稿"} · {artifact.evidence.length} 条提交依据</em></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty icon="document" title="暂无文案产物">审校通过的任务会在此生成可预览的正文。</Empty>}</section>
            <section className="panel detail-panel">{selectedArtifact ? <>
              <div className="detail-head"><div><span className="section-kicker">CONTENT / {selectedArtifact.id.slice(0, 8)}</span><h2>文案产物</h2><p>{projectName(selectedArtifact.projectId)} · {dateTime(selectedArtifact.createdAt)}</p></div><span className="subtle-badge">{selectedArtifact.status === "published" ? "已发布" : selectedArtifact.status === "approved" ? "已批准" : "草稿"}</span></div>
              <div className="artifact-tabs" role="tablist" aria-label="文案查看方式">{(["preview", "phone", "markdown", "source"] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={artifactTab === tab} className={artifactTab === tab ? "active" : ""} onClick={() => setArtifactTab(tab)}>{tab === "preview" ? "正式预览" : tab === "phone" ? "手机模拟" : tab === "markdown" ? "Markdown 正文" : "原始取证稿（含 SHA）"}</button>)}</div>
              {selectedArtifact.publishableMarkdown ? <>{artifactTab === "preview" ? <MarkdownPreview markdown={selectedArtifact.publishableMarkdown} /> : artifactTab === "phone" ? <PhonePreview markdown={selectedArtifact.publishableMarkdown} images={artifactImages} selectedId={phoneJob?.id ?? null} imageUrl={phoneJob?.id === imageResult?.jobId ? imageResult.dataUrl : null} loadFailed={phoneLoadFailure === phoneJob?.id} onSelect={setSelectedPhoneJobId} onReveal={job => { void revealImage(job); }} /> : <div className="artifact-content">{artifactTab === "source" && <p className="field-hint">此处保留 Git SHA 和事实对照，仅用于人工核对，请勿直接复制发布。</p>}<pre>{artifactTab === "markdown" ? selectedArtifact.publishableMarkdown : selectedArtifact.content}</pre></div>}{artifactTab !== "source" && <button className="button button-outline artifact-copy" onClick={() => { void call("clipboard.writeText", selectedArtifact.publishableMarkdown).then(() => setNotice({ kind: "success", text: "已复制纯净的 Markdown 正文。" })).catch(error => setNotice({ kind: "error", text: errorText(error) })); }}>复制正式 Markdown</button>}</> : <div className="legacy-artifact"><strong>此历史稿没有可靠的正式正文分段</strong><p>为避免把审校说明、事实对照误当成发布正文，暂不提供正式预览或批准。请人工整理后重新运行任务。</p><details><summary>查看原始混合稿</summary><pre>{selectedArtifact.content}</pre></details></div>}
              <div className="divider" /><SectionTitle label="VISUALS" title="关联图片产物" aside={<button className="text-link" onClick={() => { setImageProjectId(selectedArtifact.projectId); navigate("images"); }}>独立生图 <Icon name="arrow" size={15} /></button>} />
              {imageJobs.filter(job => job.runId === selectedArtifact.runId).length ? imageJobs.filter(job => job.runId === selectedArtifact.runId).map(job => <div className="image-job" key={job.id}><span className={`image-job-status ${job.status}`} /><div><strong>{job.role === "content" ? "内容配图" : "封面"} {job.sequence} · {job.status === "completed" ? "已完成" : job.status === "failed" ? "失败" : job.status === "aborted" ? "已取消" : job.status === "running" ? "生成中" : "排队中"}</strong><small>{job.prompt.slice(0, 160)}</small>{job.error && <p className="inline-error">{job.error}</p>}</div><div className="image-job-actions">{job.status === "completed" && <><button className="button button-outline" onClick={() => { setSelectedPhoneJobId(job.id); setArtifactTab("phone"); }}>手机预览</button><button className="button button-outline" onClick={() => revealImage(job)}>定位文件</button></>}{["failed", "aborted"].includes(job.status) && <button className="button button-outline" onClick={() => perform(`retry-${job.id}`, () => call("images.retry", { id: job.id }), "图片已重新入队。")}>重试</button>}</div></div>) : <p className="quiet-message">此稿没有关联图片。可从独立生图页另行创作。</p>}
              {imageJobs.some(job => job.runId === selectedArtifact.runId && job.outputPath === imageResult?.path) && imageResult && artifactTab !== "phone" && <img className="run-cover-preview" src={imageResult.dataUrl} alt="图片预览" />}
              <div className="divider" /><SectionTitle label="TRACEABILITY" title="提交依据" aside={<span className="muted-small">{selectedArtifact.evidence.length} 条</span>} />{selectedArtifact.evidence.length ? <div className="evidence-list">{selectedArtifact.evidence.map((item, index) => <div className="evidence-card" key={`${item.sha}-${index}`}><code>{shortSha(item.sha)}</code><strong>{item.subject}</strong><small>{item.files.length} 个关联文件</small>{item.files.length > 0 && <div className="file-chips">{item.files.map(file => <span key={file}>{file}</span>)}</div>}</div>)}</div> : <p className="quiet-message">此产物没有记录提交依据。</p>}<button className="text-link" onClick={() => openRun(selectedArtifact.runId)}>查看任务审计 <Icon name="arrow" size={15} /></button>
            </> : <Empty icon="document" title="选择一份文案">查看正式正文、原稿、关联图片和代码依据。</Empty>}</section></div>
        </>}

        {view === "skills" && <><div className="feature-strip"><span className="feature-icon"><Icon name="spark" size={24} /></span><div><strong>扩展你的工作流</strong><p>从本地选择技能目录，安装后即可在后续任务中使用。</p></div><button className="button button-primary" onClick={installSkill} disabled={busy === "pick-skill"}><Icon name="plus" size={16} />{busy === "pick-skill" ? "安装中…" : "安装本地技能"}</button></div><section className="panel"><SectionTitle label={`${skills.length} AVAILABLE SKILLS`} title="已安装技能" />{listError("skills")}{skills.length ? <div className="skills-grid">{skills.map((skill, index) => <article className="skill-card" key={`${skill.path}-${index}`}><div className="skill-card-top"><span className="skill-icon"><Icon name="spark" size={20} /></span><span className="subtle-badge">{skill.source}</span></div><h3>{skill.name}</h3><p>{skill.description || "暂无描述"}</p><div className="skill-path" title={skill.path}>{skill.path}</div></article>)}</div> : <Empty icon="spark" title="还没有安装技能">安装本地技能以扩展任务能力。<div className="empty-action"><button className="button button-outline" onClick={installSkill}>选择技能目录</button></div></Empty>}</section></>}

        {view === "schedules" && <><section className="panel schedule-composer"><SectionTitle label="NEW AUTOMATION" title="创建定时计划" /><form onSubmit={createSchedule}><div className="form-row"><label>项目仓库<select value={scheduleProjectId} onChange={event => setScheduleProjectId(event.target.value)} required><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>运行间隔<select value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))}><option value={60}>每小时</option><option value={360}>每 6 小时</option><option value={720}>每 12 小时</option><option value={1440}>每天</option><option value={10080}>每周</option></select></label></div><label className="prompt-label" htmlFor="schedule-prompt">任务说明</label><textarea id="schedule-prompt" rows={2} value={schedulePrompt} onChange={event => setSchedulePrompt(event.target.value)} placeholder="每次运行时要执行什么？" required /><div className="form-footer"><span>计划创建后可随时暂停或删除。</span><button className="button button-primary" disabled={!projects.length || !schedulePrompt.trim() || busy === "create-schedule"}><Icon name="plus" size={16} />{busy === "create-schedule" ? "创建中…" : "创建计划"}</button></div></form></section><section className="panel"><SectionTitle label={`${schedules.length} SCHEDULES`} title="计划列表" />{listError("schedules")}{schedules.length ? <div className="schedule-list">{schedules.map(item => <article className="schedule-row" key={item.id}><span className="schedule-icon"><Icon name="calendar" size={20} /></span><div className="schedule-copy"><div><strong>{item.prompt}</strong><span className={`subtle-badge ${item.enabled ? "green" : ""}`}>{item.enabled ? "运行中" : "已暂停"}</span></div><p>{projectName(item.projectId)} · 每 {item.intervalMinutes >= 1440 && item.intervalMinutes % 1440 === 0 ? `${item.intervalMinutes / 1440} 天` : `${item.intervalMinutes} 分钟`}运行</p><small>下次 {dateTime(item.nextRunAt)} · 上次 {dateTime(item.lastRunAt)}</small></div><div className="schedule-actions"><button className="button button-outline" disabled={busy === item.id} onClick={() => perform(item.id, () => call("schedules.toggle", { scheduleId: item.id, enabled: !item.enabled }), item.enabled ? "计划已暂停。" : "计划已启用。")}>{item.enabled ? "暂停" : "启用"}</button><button className="icon-button danger" title="删除计划" aria-label={`删除计划 ${item.prompt}`} disabled={busy === item.id} onClick={() => { if (window.confirm("确定删除这项定时计划？")) void perform(item.id, () => call("schedules.delete", { scheduleId: item.id }), "计划已删除。"); }}><Icon name="trash" size={17} /></button></div></article>)}</div> : <Empty icon="calendar" title="还没有定时计划">配置项目、间隔与任务说明，创建第一项计划。</Empty>}</section></>}

        {view === "settings" && <div className="settings-stack"><section className="panel"><SectionTitle label="LOCAL SERVICE" title="后端服务" /><div className="settings-service"><div><div className={`backend-state ${backend?.state ?? "stopped"}`}><span className="service-light" />{listErrors.backend ? "连接失败" : backend ? backendLabels[backend.state] : "检测中"}</div><p>{backend?.error || listErrors.backend || (backend?.dataDir ? `数据目录：${backend.dataDir}` : "服务运行在本机，部署和重启可能需要一些时间。")}</p>{backend?.pid && <small>进程 PID {backend.pid}</small>}</div><div className="button-group"><button className="button button-primary" onClick={() => perform("deploy", () => call("backend.deploy"), "后端已部署并启动。", refreshBackend)} disabled={busy === "deploy" || backend?.state === "starting"}><Icon name="bolt" size={16} />{busy === "deploy" ? "部署中…" : "一键部署"}</button><button className="button button-outline" onClick={() => perform("restart", () => call("backend.restart"), "后端已重启。", refreshBackend)} disabled={busy === "restart" || backend?.state === "starting"}><Icon name="refresh" size={16} />{busy === "restart" ? "重启中…" : "重启服务"}</button><button className="button button-quiet" onClick={refreshBackend}>检查状态</button></div></div></section><section className="panel"><SectionTitle label="MODEL ACCESS" title="模型凭据" /><p className="setting-description">选择服务商并保存密钥。出于安全考虑，工作台不会回显已保存的密钥。</p>{listError("providers")}{listError("images")}<form className="key-form" onSubmit={event => { event.preventDefault(); if (!keyProvider || !apiKey.trim()) return; void perform("set-key", () => call("providers.setKey", { provider: keyProvider, key: apiKey.trim() }), "密钥保存请求已完成。", () => setApiKey("")); }}><label>服务商<select value={keyProvider} onChange={event => setKeyProvider(event.target.value)} required><option value="">选择服务商</option>{providers.map(provider => <option key={provider}>{provider}</option>)}</select></label><label>API Key<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="输入新的密钥" required /></label><button className="button button-primary" disabled={!keyProvider || !apiKey.trim() || busy === "set-key"}>{busy === "set-key" ? "保存中…" : "保存密钥"}</button></form><p className="muted-small">当前可用模型：{models.length} 个文本模型 · {imageModels.length} 个图像模型 · {providers.length} 个服务商</p></section><section className="panel"><SectionTitle label="DATA MAINTENANCE" title="清理本地数据" /><p className="setting-description">先预览可清理的数据量，再决定是否执行。清理操作不可撤销。</p><div className="cleanup-controls"><label>保留最近 <input type="number" min={7} max={3650} value={cleanupDays} onChange={event => { setCleanupDays(Number(event.target.value)); setCleanupPreview(null); }} /> 天</label><button className="button button-outline" disabled={busy === "preview" || cleanupDays < 7} onClick={() => perform("preview", async () => setCleanupPreview(await call<{ artifacts: number; events: number; files: number }>("cleanup.preview", { days: cleanupDays })), "预览已更新。")}>预览清理</button></div>{cleanupPreview && <div className="cleanup-preview"><div><strong>{cleanupPreview.artifacts}</strong><span>份产物</span></div><div><strong>{cleanupPreview.events}</strong><span>条事件</span></div><div><strong>{cleanupPreview.files}</strong><span>个历史文件</span></div><button className="button button-danger-quiet" disabled={busy === "cleanup" || cleanupDays < 7} onClick={() => { if (window.confirm(`确定清理超过 ${cleanupDays} 天的数据？此操作不可撤销。`)) void perform("cleanup", () => call("cleanup.run", { days: cleanupDays }), "清理命令已完成。", () => setCleanupPreview(null)); }}><Icon name="trash" size={16} />确认清理</button></div>}</section></div>}
        {view === "settings" && <div className="settings-stack advanced-settings">
          <section className="panel"><SectionTitle label="CUSTOM PROVIDERS" title="中转服务商与模型目录" aside={<span className="muted-small">OpenAI 兼容接口</span>} />
            <p className="setting-description">内置模型来自 Pi 目录；自定义模型可手动填写，也可从兼容的 /models 接口读取。模型列表不会自动代表此模型可用。</p>
            <form className="advanced-form" onSubmit={event => { event.preventDefault(); void perform("provider-save", () => call("providers.save", { id: providerId.trim(), baseUrl: providerUrl.trim(), api: providerApi, models: providerModels.split(/[\n,]/).map(item => item.trim()).filter(Boolean), key: providerKey.trim() }), "服务商已保存。", () => { setProviderKey(""); refreshSettings(); }); }}>
              <label>服务商 ID<input value={providerId} onChange={event => setProviderId(event.target.value)} placeholder="my-relay" required pattern="[a-z][a-z0-9-]{1,63}" /></label>
              <label>Base URL<input value={providerUrl} onChange={event => setProviderUrl(event.target.value)} placeholder="https://relay.example/v1" required /></label>
              <label>协议<select value={providerApi} onChange={event => setProviderApi(event.target.value as CustomProvider["api"])}><option value="openai-completions">Chat Completions</option><option value="openai-responses">Responses</option></select></label>
              <label>API Key（编辑时留空保留）<input type="password" autoComplete="off" value={providerKey} onChange={event => setProviderKey(event.target.value)} placeholder="仅保存到本机" /></label>
              <label className="span-all">模型 ID（每行一个）<textarea value={providerModels} onChange={event => setProviderModels(event.target.value)} rows={3} placeholder="model-id-1\nmodel-id-2" required /></label>
              <div className="button-group span-all"><button className="button button-primary" disabled={busy === "provider-save"}>保存服务商</button><button type="button" className="button button-outline" disabled={!providerId || !providerUrl || busy === "provider-discover"} onClick={() => perform("provider-discover", async () => { const ids = await call<string[]>("providers.discover", { id: providerId, baseUrl: providerUrl.trim(), key: providerKey.trim() }); setProviderModels(ids.join("\n")); }, "模型列表已读取，请确认后保存。")}>获取模型列表</button></div>
            </form>
            <div className="config-list">{customProviders.map(provider => <div key={provider.id}><div><strong>{provider.id}</strong><small>{provider.api} · {provider.baseUrl} · {provider.models.length} 个模型 · {provider.hasKey ? "已配密钥" : "未配密钥"}</small></div><button className="button button-quiet" onClick={() => { setProviderId(provider.id); setProviderUrl(provider.baseUrl); setProviderApi(provider.api); setProviderModels(provider.models.join("\n")); setProviderKey(""); }}>编辑</button><button className="icon-button danger" aria-label={`删除 ${provider.id}`} onClick={() => { if (window.confirm(`删除 ${provider.id} 及其密钥？`)) void perform("provider-remove", () => call("providers.remove", { id: provider.id }), "服务商已删除。", refreshSettings); }}><Icon name="trash" size={16} /></button></div>)}</div>
            <details className="model-catalog"><summary>可用文本模型（{models.length}）</summary><div>{models.map(item => <span key={`${item.provider}::${item.id}`}>{item.provider} / {item.id}</span>)}</div></details>
          </section>
          <section className="panel"><SectionTitle label="SKILL ENVIRONMENT" title="Skill 环境变量" /><p className="setting-description">仅允许 OPS_ 前缀，密值不回显。生图脚本仅接收 OPS_IMAGE_ 变量；导入的脚本不会被任务自动执行。</p>
            <form className="advanced-form environment-form" onSubmit={event => { event.preventDefault(); void perform("env-save", () => call("environment.set", { name: envName.trim(), value: envValue }), "变量已保存。", () => { setEnvValue(""); refreshSettings(); }); }}><label>变量名<input value={envName} onChange={event => setEnvName(event.target.value.toUpperCase())} placeholder="OPS_IMAGE_API_KEY" required /></label><label>值<input type="password" autoComplete="off" value={envValue} onChange={event => setEnvValue(event.target.value)} placeholder="输入值或更新已有值" required /></label><button className="button button-primary" disabled={busy === "env-save"}>保存变量</button></form>
            <div className="config-list">{environment.map(entry => <div key={entry.name}><strong>{entry.name}</strong><small>已配置 · 值不显示</small><button className="icon-button danger" aria-label={`删除 ${entry.name}`} onClick={() => { if (window.confirm(`删除 ${entry.name}？`)) void perform("env-remove", () => call("environment.remove", { name: entry.name }), "变量已删除。", refreshSettings); }}><Icon name="trash" size={16} /></button></div>)}</div>
            <p className="muted-small">生图至少配置 OPS_IMAGE_API_KEY；可选 OPS_IMAGE_BASE_URL、OPS_IMAGE_MODEL、OPS_IMAGE_TOOL_MODEL、OPS_IMAGE_SIZE、OPS_IMAGE_QUALITY、OPS_IMAGE_FORMAT。</p>
          </section>
        </div>}
      </div>
    </main>
  </div>;
}

export default App;
