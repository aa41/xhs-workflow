import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import type { ImageJob } from "../shared/contracts.js";
import { generateImage, pngDimensions } from "../../resources/skills/responses-imagegen/scripts/image.mjs";
import { LocalConfig } from "./config.js";
import { Store } from "./db.js";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function imageDirectory(dataDir: string, projectId: string | null): string {
  return join(dataDir, "images", projectId ?? "_standalone");
}

export function reference(path: string): { dataUrl: string; mimeType: string; width?: number; height?: number } {
  const info = statSync(path);
  if (!info.isFile() || info.size > 20_000_000) throw new Error("参考图须为小于 20 MB 的本地文件");
  const bytes = readFileSync(path);
  const mimeType = bytes.subarray(0, 8).equals(signature) ? "image/png"
    : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  if (!mimeType) throw new Error("参考图仅支持 PNG、JPEG、WebP");
  const dimensions = mimeType === "image/png" ? pngDimensions(bytes) : undefined;
  return { dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}) };
}

export class ImageQueue {
  private running = false;
  private current: { id: string; controller: AbortController } | null = null;

  constructor(private readonly store: Store, private readonly dataDir: string,
    private readonly notify: (event: string, data: unknown) => void, private readonly fetcher: typeof fetch = fetch) {
    queueMicrotask(() => { void this.pump(); });
  }

  enqueue(projectId: string | null, prompts: string[], inputs: string[], maskData?: string, reuseMaskPath?: string,
    runId: string | null = null, metadata?: Pick<ImageJob, "role" | "sequence">[]): ImageJob[] {
    if (projectId !== null && !this.store.project(projectId)) throw new Error("项目不存在");
    if (runId && this.store.run(runId)?.projectId !== projectId) throw new Error("图片关联任务与项目不匹配");
    if (!prompts.length || prompts.length > (runId ? 20 : 12) || prompts.some((prompt) => !prompt.trim() || prompt.length > 6000)) {
      throw new Error(`每次可提交 1–${runId ? 20 : 12} 条不超过 6000 字的提示词`);
    }
    if (metadata && (metadata.length !== prompts.length || metadata.some(item => !["cover", "content", "independent"].includes(item.role) ||
      !Number.isInteger(item.sequence) || item.sequence < 1 || item.sequence > 20))) throw new Error("图片任务分类无效");
    if (inputs.length > 8 || inputs.some((path) => typeof path !== "string" || path.length > 2000)) throw new Error("参考图列表无效");
    if (this.store.pendingImageJobCount() + prompts.length > 40) {
      throw new Error("队列最多容纳 40 个待执行任务");
    }
    for (const path of inputs) reference(path);
    let maskPath: string | null = reuseMaskPath || null;
    if (maskData) {
      if (!inputs.length || !maskData.startsWith("data:image/png;base64,") || maskData.length > 6_000_000) {
        throw new Error("遮罩须为首张 PNG 参考图对应的透明 PNG");
      }
      const first = readFileSync(inputs[0]);
      const sourceSize = pngDimensions(first);
      const maskBytes = Buffer.from(maskData.slice("data:image/png;base64,".length), "base64");
      const maskSize = pngDimensions(maskBytes);
      if (maskBytes.length > 4_000_000 || sourceSize.width !== maskSize.width || sourceSize.height !== maskSize.height ||
        ![4, 6].includes(maskSize.colorType)) throw new Error("遮罩须小于 4 MB、含 Alpha 通道且与首图同尺寸");
      const directory = join(this.dataDir, "masks", projectId ?? "_standalone");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      maskPath = join(directory, `${randomUUID()}.png`);
      writeFileSync(maskPath, maskBytes, { mode: 0o600 });
    }
    const jobs = this.store.addImageJobs(projectId, prompts.map((prompt) => prompt.trim()), inputs, maskPath, runId, metadata);
    this.notify("images.updated", { ids: jobs.map((job) => job.id) });
    void this.pump();
    return jobs;
  }

  retry(id: string): ImageJob[] {
    const job = this.store.imageJob(id);
    if (!job || !["failed", "aborted"].includes(job.status)) throw new Error("仅可重试失败或已中止的任务");
    if (job.maskPath && !existsSync(job.maskPath)) throw new Error("原始遮罩已清理，无法重试");
    return this.enqueue(job.projectId, [job.prompt], job.inputs, undefined, job.maskPath || undefined, job.runId,
      [{ role: job.role, sequence: job.sequence }]);
  }

  cancel(id: string): void {
    const job = this.store.imageJob(id);
    if (!job || !["queued", "running"].includes(job.status)) throw new Error("任务已结束");
    if (job.status === "queued") this.store.setImageJob(id, "aborted", null, "用户已取消");
    else this.current?.id === id && this.current.controller.abort();
    this.notify("images.updated", { id });
  }

  preview(id: string): { dataUrl: string; path: string } {
    const path = this.outputPath(id);
    const format = extname(path).toLowerCase();
    const mimeType = format === ".png" ? "image/png" : format === ".jpg" ? "image/jpeg" : "image/webp";
    return { path, dataUrl: `data:${mimeType};base64,${readFileSync(path).toString("base64")}` };
  }

  outputPath(id: string): string {
    const job = this.store.imageJob(id);
    if (!job || job.status !== "completed" || !job.outputPath || !existsSync(job.outputPath)) throw new Error("图片不存在或已被清理");
    const info = lstatSync(job.outputPath);
    if (!info.isFile() || info.size > 30_000_000) throw new Error("图片文件无效或过大");
    const format = extname(job.outputPath).toLowerCase();
    const mimeType = format === ".png" ? "image/png" : format === ".jpg" ? "image/jpeg" : format === ".webp" ? "image/webp" : null;
    const root = realpathSync(imageDirectory(this.dataDir, job.projectId)) + sep;
    if (!mimeType || !realpathSync(job.outputPath).startsWith(root)) throw new Error("图片路径或格式无效");
    return job.outputPath;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.store.nextImageJob(); job; job = this.store.nextImageJob()) {
        const controller = new AbortController();
        this.current = { id: job.id, controller };
        this.store.setImageJob(job.id, "running");
        this.notify("images.updated", { id: job.id });
        try {
          const env = new LocalConfig(this.dataDir).imageEnvironment();
          const format = env.OPS_IMAGE_FORMAT || "png";
          if (!["png", "jpeg", "webp"].includes(format)) throw new Error("OPS_IMAGE_FORMAT 仅支持 png、jpeg、webp");
          const directory = imageDirectory(this.dataDir, job.projectId);
          const out = join(directory, `${job.id}.${format === "jpeg" ? "jpg" : format}`);
          await generateImage({ prompt: job.prompt, inputs: job.inputs, mask: job.maskPath || undefined,
            out, env, signal: controller.signal, fetcher: this.fetcher });
          this.store.setImageJob(job.id, "completed", out);
        } catch (error) {
          const message = new LocalConfig(this.dataDir).redact(error instanceof Error ? error.message : String(error));
          this.store.setImageJob(job.id, controller.signal.aborted ? "aborted" : "failed", null, message);
        } finally { this.current = null; this.notify("images.updated", { id: job.id }); }
      }
    } finally { this.running = false; }
  }
}
