import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type CustomProvider = { id: string; baseUrl: string; api: "openai-completions" | "openai-responses"; models: string[] };
export type EnvironmentEntry = { name: string; configured: boolean };

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function saveJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
}

export function validateBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Base URL 必须为 HTTPS，或本机 HTTP；不能包含凭据、查询及片段");
  }
  return url.toString().replace(/\/$/, "");
}

export class LocalConfig {
  constructor(private readonly dataDir: string) {}

  providers(): CustomProvider[] { return readJson<CustomProvider[]>(join(this.dataDir, "providers.json"), []); }

  saveProvider(provider: CustomProvider, key?: string): void {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(provider.id) || provider.models.length > 100 ||
      !provider.models.length || provider.models.some((id) => !id.trim() || id.length > 200)) throw new Error("Provider ID 或模型列表无效");
    const baseUrl = validateBaseUrl(provider.baseUrl);
    if (!["openai-completions", "openai-responses"].includes(provider.api)) throw new Error("API 类型无效");
    const providers = this.providers().filter((item) => item.id !== provider.id);
    providers.push({ ...provider, baseUrl, models: [...new Set(provider.models.map((id) => id.trim()))] });
    saveJson(join(this.dataDir, "providers.json"), providers);
    if (key?.trim()) this.setKey(provider.id, key.trim());
  }

  removeProvider(id: string): void {
    saveJson(join(this.dataDir, "providers.json"), this.providers().filter((item) => item.id !== id));
    const auth = this.auth();
    delete auth[id];
    saveJson(join(this.dataDir, "auth.json"), auth);
  }

  private auth(): Record<string, { type: string; key: string }> {
    return readJson(join(this.dataDir, "auth.json"), {});
  }

  setKey(id: string, key: string): void {
    if (!/^[a-z0-9-]+$/.test(id) || !key || key.length > 4000) throw new Error("凭据无效");
    saveJson(join(this.dataDir, "auth.json"), { ...this.auth(), [id]: { type: "api_key", key } });
  }

  hasKey(id: string): boolean { return !!this.auth()[id]?.key; }

  async runtime(): Promise<ModelRuntime> {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const runtime = await ModelRuntime.create({ authPath: join(this.dataDir, "auth.json"),
      modelsPath: join(this.dataDir, "models.json") });
    for (const provider of this.providers()) {
      runtime.registerProvider(provider.id, { baseUrl: provider.baseUrl, api: provider.api,
        models: provider.models.map((id) => ({ id, name: id, reasoning: false, input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8192 })) });
    }
    return runtime;
  }

  async discover(id: string, draft?: { baseUrl: string; key?: string }): Promise<string[]> {
    const provider = this.providers().find((item) => item.id === id);
    if (!provider && !draft) throw new Error("未找到自定义 Provider");
    const baseUrl = validateBaseUrl(draft?.baseUrl || provider!.baseUrl);
    const key = draft?.key || this.auth()[id]?.key;
    if (!key) throw new Error("请先保存 API Key");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` },
        redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error(`模型列表请求失败（HTTP ${response.status}）`);
      const body = await response.json() as { data?: { id?: unknown }[] };
      if (!Array.isArray(body.data)) throw new Error("服务商未提供 OpenAI 兼容的 /models 列表，请手动填写模型 ID");
      return [...new Set(body.data.map((item) => item.id).filter((value): value is string => typeof value === "string" && !!value && value.length <= 200))].slice(0, 200);
    } finally { clearTimeout(timer); }
  }

  private environment(): Record<string, string> { return readJson(join(this.dataDir, "environment.json"), {}); }
  environmentList(): EnvironmentEntry[] {
    return Object.keys(this.environment()).sort().map((name) => ({ name, configured: true }));
  }
  setEnvironment(name: string, value: string): void {
    if (!/^OPS_[A-Z][A-Z0-9_]{0,79}$/.test(name) || value.length > 8000 || !value) throw new Error("环境变量名称或值无效（仅支持 OPS_ 前缀）");
    saveJson(join(this.dataDir, "environment.json"), { ...this.environment(), [name]: value });
  }
  removeEnvironment(name: string): void {
    const values = this.environment();
    delete values[name];
    saveJson(join(this.dataDir, "environment.json"), values);
  }
  imageEnvironment(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.environment()).filter(([name]) => name.startsWith("OPS_IMAGE_")));
  }

  redact(text: string): string {
    const secrets = [...Object.values(this.auth()).map((entry) => entry.key), ...Object.values(this.environment())]
      .filter((value) => value.length >= 4);
    return secrets.reduce((output, value) => output.replaceAll(value, "[REDACTED]"), text);
  }
}
