import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Artifact, ImageJob, Project, ProjectMemory, Schedule, Subagent, TaskEvent, TaskRun } from "../shared/contracts.js";
import { cleanPublishableMarkdown } from "../shared/publishable.js";

const now = () => new Date().toISOString();

export class Store {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT '', last_processed_sha TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL, baseline_sha TEXT NOT NULL, target_sha TEXT NOT NULL,
        prompt TEXT NOT NULL, provider TEXT, model TEXT, review_provider TEXT, review_model TEXT, cover_style TEXT,
        cover_count INTEGER NOT NULL DEFAULT 1,
        content_image_count INTEGER NOT NULL DEFAULT 0, content_image_style TEXT,
        parent_run_id TEXT, output TEXT NOT NULL DEFAULT '',
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type TEXT NOT NULL, content TEXT NOT NULL, publishable_markdown TEXT, evidence TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        interval_minutes INTEGER NOT NULL, prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, next_run_at TEXT NOT NULL, last_run_at TEXT
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subagents (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT '', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS image_jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL, inputs TEXT NOT NULL, mask_path TEXT, run_id TEXT,
        role TEXT NOT NULL DEFAULT 'independent', sequence INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL, output_path TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    const runColumns = this.database.prepare("PRAGMA table_info(runs)").all().map((column) => String(column.name));
    if (!runColumns.includes("review_provider")) this.database.exec("ALTER TABLE runs ADD COLUMN review_provider TEXT");
    if (!runColumns.includes("review_model")) this.database.exec("ALTER TABLE runs ADD COLUMN review_model TEXT");
    if (!runColumns.includes("parent_run_id")) this.database.exec("ALTER TABLE runs ADD COLUMN parent_run_id TEXT");
    if (!runColumns.includes("cover_style")) this.database.exec("ALTER TABLE runs ADD COLUMN cover_style TEXT");
    if (!runColumns.includes("cover_count")) this.database.exec("ALTER TABLE runs ADD COLUMN cover_count INTEGER NOT NULL DEFAULT 1");
    if (!runColumns.includes("content_image_count")) this.database.exec("ALTER TABLE runs ADD COLUMN content_image_count INTEGER NOT NULL DEFAULT 0");
    if (!runColumns.includes("content_image_style")) this.database.exec("ALTER TABLE runs ADD COLUMN content_image_style TEXT");
    const artifactColumns = this.database.prepare("PRAGMA table_info(artifacts)").all().map((column) => String(column.name));
    if (!artifactColumns.includes("publishable_markdown")) this.database.exec("ALTER TABLE artifacts ADD COLUMN publishable_markdown TEXT");
    const imageColumns = this.database.prepare("PRAGMA table_info(image_jobs)").all().map((column) => String(column.name));
    if (!imageColumns.includes("run_id")) this.database.exec("ALTER TABLE image_jobs ADD COLUMN run_id TEXT");
    if (!imageColumns.includes("role")) {
      this.database.exec("ALTER TABLE image_jobs ADD COLUMN role TEXT NOT NULL DEFAULT 'independent'");
      this.database.exec("UPDATE image_jobs SET role='cover' WHERE run_id IS NOT NULL");
    }
    if (!imageColumns.includes("sequence")) this.database.exec("ALTER TABLE image_jobs ADD COLUMN sequence INTEGER NOT NULL DEFAULT 1");
    const subagentColumns = this.database.prepare("PRAGMA table_info(subagents)").all().map((column) => String(column.name));
    if (!subagentColumns.includes("attempt")) this.database.exec("ALTER TABLE subagents ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1");
    this.database.prepare("UPDATE runs SET status='failed',error='后端重启中断了任务',updated_at=? WHERE status IN ('queued','running')")
      .run(now());
    this.database.prepare("UPDATE subagents SET status='failed',error='后端重启中断了子任务',updated_at=? WHERE status='running'").run(now());
    this.database.prepare("UPDATE image_jobs SET status='failed',error='后端重启中断了生图请求；可重试',updated_at=? WHERE status='running'").run(now());
  }

  close(): void { this.database.close(); }

  addProject(name: string, path: string): void {
    this.database.prepare("INSERT INTO projects (id,name,path,created_at) VALUES (?,?,?,?)")
      .run(randomUUID(), name, path, now());
  }

  projects(): Array<Pick<Project, "id" | "name" | "path" | "createdAt" | "strategy" | "lastProcessedSha">> {
    return this.database.prepare("SELECT id,name,path,created_at,strategy,last_processed_sha FROM projects ORDER BY created_at DESC")
      .all().map((row) => ({ id: String(row.id), name: String(row.name), path: String(row.path),
        createdAt: String(row.created_at), strategy: String(row.strategy),
        lastProcessedSha: row.last_processed_sha === null ? null : String(row.last_processed_sha) }));
  }

  project(id: string): ReturnType<Store["projects"]>[number] | undefined {
    return this.projects().find((project) => project.id === id);
  }

  removeProject(id: string): void { this.database.prepare("DELETE FROM projects WHERE id=?").run(id); }
  setStrategy(id: string, strategy: string): void {
    this.database.prepare("UPDATE projects SET strategy=? WHERE id=?").run(strategy, id);
  }

  markProcessed(id: string, sha: string): void {
    this.database.prepare("UPDATE projects SET last_processed_sha=? WHERE id=?").run(sha, id);
  }

  memories(projectId: string): ProjectMemory[] {
    return this.database.prepare("SELECT * FROM memories WHERE project_id=? ORDER BY created_at DESC LIMIT 100")
      .all(projectId).map((row) => ({ id: String(row.id), projectId: String(row.project_id),
        content: String(row.content), createdAt: String(row.created_at) }));
  }

  addMemory(projectId: string, content: string): void {
    this.database.prepare("INSERT INTO memories (id,project_id,content,created_at) VALUES (?,?,?,?)")
      .run(randomUUID(), projectId, content, now());
  }

  removeMemory(id: string): void { this.database.prepare("DELETE FROM memories WHERE id=?").run(id); }

  addRun(run: TaskRun): void {
    this.database.prepare(`INSERT INTO runs
      (id,project_id,status,baseline_sha,target_sha,prompt,provider,model,review_provider,review_model,cover_style,cover_count,content_image_count,content_image_style,parent_run_id,output,error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.id, run.projectId, run.status, run.baselineSha,
      run.targetSha, run.prompt, run.provider, run.model, run.reviewProvider, run.reviewModel,
      run.coverStyle ?? null, run.coverCount ?? 1, run.contentImageCount ?? 0, run.contentImageStyle ?? null,
      run.parentRunId, run.output, run.error, run.createdAt, run.updatedAt);
  }

  updateRun(id: string, values: Partial<Pick<TaskRun, "status" | "output" | "error">>): void {
    const current = this.run(id);
    if (!current) return;
    this.database.prepare("UPDATE runs SET status=?,output=?,error=?,updated_at=? WHERE id=?")
      .run(values.status ?? current.status, values.output ?? current.output, values.error ?? current.error, now(), id);
  }

  private mapRun(row: Record<string, unknown>): TaskRun {
    return { id: String(row.id), projectId: String(row.project_id), status: row.status as TaskRun["status"],
      baselineSha: String(row.baseline_sha), targetSha: String(row.target_sha), prompt: String(row.prompt),
      provider: row.provider === null ? null : String(row.provider), model: row.model === null ? null : String(row.model),
      reviewProvider: row.review_provider === null ? null : String(row.review_provider),
      reviewModel: row.review_model === null ? null : String(row.review_model),
      coverStyle: row.cover_style === null ? null : String(row.cover_style),
      coverCount: Number(row.cover_count),
      contentImageCount: Number(row.content_image_count),
      contentImageStyle: row.content_image_style === null ? null : String(row.content_image_style),
      parentRunId: row.parent_run_id === null ? null : String(row.parent_run_id),
      output: String(row.output), error: row.error === null ? null : String(row.error),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  run(id: string): TaskRun | undefined {
    const row = this.database.prepare("SELECT * FROM runs WHERE id=?").get(id);
    return row ? this.mapRun(row) : undefined;
  }

  runs(projectId?: string): TaskRun[] {
    const rows = projectId
      ? this.database.prepare("SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100").all(projectId)
      : this.database.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 100").all();
    return rows.map((row) => this.mapRun(row));
  }

  event(runId: string, type: string, payload: unknown): void {
    this.database.prepare("INSERT INTO events (run_id,type,payload,created_at) VALUES (?,?,?,?)")
      .run(runId, type, JSON.stringify(payload), now());
  }

  events(runId: string): TaskEvent[] {
    return this.database.prepare("SELECT * FROM events WHERE run_id=? ORDER BY id DESC LIMIT 500").all(runId)
      .reverse().map((row) => ({ id: Number(row.id), runId: String(row.run_id), type: String(row.type),
        payload: JSON.parse(String(row.payload)), createdAt: String(row.created_at) }));
  }

  startSubagent(runId: string, role: string, provider: string, model: string, attempt = 1): string {
    const id = randomUUID();
    this.database.prepare(`INSERT INTO subagents (id,run_id,role,attempt,status,provider,model,created_at,updated_at)
      VALUES (?,?,?,?,'running',?,?,?,?)`).run(id, runId, role, attempt, provider, model, now(), now());
    return id;
  }

  finishSubagent(id: string, status: Subagent["status"], output: string, error: string | null): void {
    this.database.prepare("UPDATE subagents SET status=?,output=?,error=?,updated_at=? WHERE id=?")
      .run(status, output, error, now(), id);
  }

  subagents(runId: string): Subagent[] {
    return this.database.prepare("SELECT * FROM subagents WHERE run_id=? ORDER BY rowid").all(runId).map((row) => ({
      id: String(row.id), runId: String(row.run_id), role: String(row.role), attempt: Number(row.attempt), status: row.status as Subagent["status"],
      provider: String(row.provider), model: String(row.model), output: String(row.output),
      error: row.error === null ? null : String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  private mapImageJob(row: Record<string, unknown>): ImageJob {
    return { id: String(row.id), projectId: String(row.project_id), runId: row.run_id === null ? null : String(row.run_id),
      role: row.role as ImageJob["role"], sequence: Number(row.sequence), prompt: String(row.prompt),
      inputs: JSON.parse(String(row.inputs)) as string[], maskPath: row.mask_path === null ? null : String(row.mask_path),
      status: row.status as ImageJob["status"], outputPath: row.output_path === null ? null : String(row.output_path),
      error: row.error === null ? null : String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  addImageJobs(projectId: string, prompts: string[], inputs: string[], maskPath: string | null, runId: string | null = null,
    metadata?: Pick<ImageJob, "role" | "sequence">[]): ImageJob[] {
    const createdAt = now();
    const jobs = prompts.map((prompt, index) => ({ id: randomUUID(), projectId, runId, prompt, inputs: [...inputs], maskPath,
      role: metadata?.[index]?.role ?? (runId ? "cover" : "independent"), sequence: metadata?.[index]?.sequence ?? index + 1,
      status: "queued" as const, outputPath: null, error: null, createdAt, updatedAt: createdAt }));
    this.database.exec("BEGIN");
    try {
      const insert = this.database.prepare(`INSERT INTO image_jobs
        (id,project_id,prompt,inputs,mask_path,run_id,role,sequence,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'queued',?,?)`);
      for (const job of jobs) insert.run(job.id, projectId, job.prompt, JSON.stringify(inputs), maskPath, runId, job.role, job.sequence, createdAt, createdAt);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return jobs;
  }

  imageJobs(projectId?: string): ImageJob[] {
    const order = "ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, rowid DESC LIMIT 100";
    const rows = projectId ? this.database.prepare(`SELECT * FROM image_jobs WHERE project_id=? ${order}`).all(projectId)
      : this.database.prepare(`SELECT * FROM image_jobs ${order}`).all();
    return rows.map((row) => this.mapImageJob(row));
  }

  imageJobsForRun(runId: string): ImageJob[] {
    return this.database.prepare("SELECT * FROM image_jobs WHERE run_id=? ORDER BY rowid").all(runId)
      .map((row) => this.mapImageJob(row));
  }

  imageJob(id: string): ImageJob | undefined {
    const row = this.database.prepare("SELECT * FROM image_jobs WHERE id=?").get(id);
    return row ? this.mapImageJob(row) : undefined;
  }

  pendingImageJobCount(): number {
    return Number(this.database.prepare("SELECT COUNT(*) AS count FROM image_jobs WHERE status IN ('queued','running')").get()?.count || 0);
  }

  nextImageJob(): ImageJob | undefined {
    const row = this.database.prepare("SELECT * FROM image_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();
    return row ? this.mapImageJob(row) : undefined;
  }

  setImageJob(id: string, status: ImageJob["status"], outputPath: string | null = null, error: string | null = null): void {
    this.database.prepare("UPDATE image_jobs SET status=?,output_path=?,error=?,updated_at=? WHERE id=?")
      .run(status, outputPath, error, now(), id);
  }

  addArtifact(projectId: string, runId: string, content: string, evidence: Artifact["evidence"], publishableMarkdown: string | null = null): void {
    this.database.prepare(`INSERT INTO artifacts (id,project_id,run_id,type,content,publishable_markdown,evidence,status,created_at)
      VALUES (?,?,?,'note',?,?,?,'draft',?)`).run(randomUUID(), projectId, runId, content, publishableMarkdown, JSON.stringify(evidence), now());
  }

  artifacts(projectId?: string): Artifact[] {
    const rows = projectId
      ? this.database.prepare("SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at DESC").all(projectId)
      : this.database.prepare("SELECT * FROM artifacts ORDER BY created_at DESC").all();
    return rows.map((row) => ({ id: String(row.id), projectId: String(row.project_id), runId: String(row.run_id),
      type: String(row.type), content: String(row.content), publishableMarkdown: row.publishable_markdown === null ? null : cleanPublishableMarkdown(String(row.publishable_markdown)), evidence: JSON.parse(String(row.evidence)),
      status: row.status as Artifact["status"], createdAt: String(row.created_at) }));
  }

  setArtifactStatus(id: string, status: "approved" | "published"): void {
    this.database.prepare("UPDATE artifacts SET status=? WHERE id=?").run(status, id);
  }

  schedules(): Schedule[] {
    return this.database.prepare("SELECT * FROM schedules ORDER BY next_run_at").all().map((row) => ({
      id: String(row.id), projectId: String(row.project_id), intervalMinutes: Number(row.interval_minutes),
      prompt: String(row.prompt), enabled: Boolean(row.enabled), nextRunAt: String(row.next_run_at),
      lastRunAt: row.last_run_at === null ? null : String(row.last_run_at),
    }));
  }

  addSchedule(projectId: string, intervalMinutes: number, prompt: string): void {
    this.database.prepare(`INSERT INTO schedules (id,project_id,interval_minutes,prompt,next_run_at)
      VALUES (?,?,?,?,?)`).run(randomUUID(), projectId, intervalMinutes, prompt,
      new Date(Date.now() + intervalMinutes * 60_000).toISOString());
  }

  setScheduleEnabled(id: string, enabled: boolean): void {
    this.database.prepare("UPDATE schedules SET enabled=? WHERE id=?").run(Number(enabled), id);
  }

  removeSchedule(id: string): void { this.database.prepare("DELETE FROM schedules WHERE id=?").run(id); }

  advanceSchedule(id: string, intervalMinutes: number): void {
    this.database.prepare("UPDATE schedules SET last_run_at=?,next_run_at=? WHERE id=?")
      .run(now(), new Date(Date.now() + intervalMinutes * 60_000).toISOString(), id);
  }

  cleanup(days: number, perform: boolean): { artifacts: number; events: number } {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const artifacts = Number(this.database.prepare("SELECT count(*) AS total FROM artifacts WHERE status='published' AND created_at<?")
      .get(cutoff)?.total ?? 0);
    const events = Number(this.database.prepare(`SELECT count(*) AS total FROM events WHERE created_at<?
      AND run_id IN (SELECT id FROM runs WHERE status IN ('completed','failed','aborted'))`).get(cutoff)?.total ?? 0);
    if (perform) {
      this.database.prepare("DELETE FROM artifacts WHERE status='published' AND created_at<?").run(cutoff);
      this.database.prepare(`DELETE FROM events WHERE created_at<?
        AND run_id IN (SELECT id FROM runs WHERE status IN ('completed','failed','aborted'))`).run(cutoff);
    }
    return { artifacts, events };
  }
}
