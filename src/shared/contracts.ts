export type BackendStatus = {
  state: "stopped" | "starting" | "running" | "error";
  pid?: number;
  dataDir?: string;
  error?: string;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
  createdAt: string;
  strategy: string;
  lastProcessedSha: string | null;
};

export type Commit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
  files: string[];
};

export type TaskRun = {
  id: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  baselineSha: string;
  targetSha: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  reviewProvider: string | null;
  reviewModel: string | null;
  coverStyle?: string | null;
  coverCount?: number;
  contentImageCount?: number;
  contentImageStyle?: string | null;
  parentRunId: string | null;
  output: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvent = {
  id: number;
  runId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type Artifact = {
  id: string;
  projectId: string;
  runId: string;
  type: string;
  content: string;
  publishableMarkdown: string | null;
  evidence: { sha: string; files: string[]; subject: string }[];
  status: "draft" | "approved" | "published";
  createdAt: string;
};

export type Schedule = {
  id: string;
  projectId: string;
  intervalMinutes: number;
  prompt: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
};

export type SkillEntry = {
  name: string;
  description: string;
  path: string;
  source: string;
};

export type ModelEntry = { provider: string; id: string; name: string };
export type ImageJob = { id: string; projectId: string | null; runId: string | null; role: "cover" | "content" | "independent"; sequence: number;
  prompt: string; inputs: string[]; maskPath: string | null;
  status: "queued" | "running" | "completed" | "failed" | "aborted"; outputPath: string | null;
  error: string | null; createdAt: string; updatedAt: string };
export type CustomProvider = { id: string; baseUrl: string; api: "openai-completions" | "openai-responses"; models: string[]; hasKey: boolean };
export type EnvironmentEntry = { name: string; configured: boolean };
export type Subagent = { id: string; runId: string; role: string; attempt: number; status: "running" | "completed" | "failed" | "aborted";
  provider: string; model: string; output: string; error: string | null; createdAt: string; updatedAt: string };

export type ProjectMemory = {
  id: string;
  projectId: string;
  content: string;
  createdAt: string;
};

export type ServiceRequest = { id: number; method: string; payload?: unknown };
export type ServiceResponse = { id: number; result?: unknown; error?: string };
export type ServiceNotification = { event: string; data: unknown };

export type WorkbenchBridge = {
  call<T = unknown>(method: string, payload?: unknown): Promise<T>;
  onEvent(callback: (event: ServiceNotification) => void): () => void;
};
