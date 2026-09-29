import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { pathToFileURL } from "node:url";

const formats = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

export function pngDimensions(bytes) {
  if (bytes.length < 26 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("遮罩与主图须为有效 PNG");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 20_000_000) throw new Error("PNG 尺寸无效或过大");
  return { width, height, colorType: bytes[25] };
}

export async function generateImage({ prompt, inputs = [], mask, out, previousResponseId, env = process.env, fetcher = fetch, signal }) {
  if (!prompt || prompt.length > 6000 || !out || inputs.length > 8) throw new Error("提示词、输出路径或参考图数量无效");
  if (mask && !inputs.length) throw new Error("遮罩编辑需要第一张 PNG 参考图");
  const key = env.OPS_IMAGE_API_KEY;
  if (!key) throw new Error("请在设置中配置 OPS_IMAGE_API_KEY");
  const base = new URL(env.OPS_IMAGE_BASE_URL || "https://api.openai.com/v1");
  if (base.username || base.password || base.search || base.hash ||
    (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) {
    throw new Error("OPS_IMAGE_BASE_URL 须为 HTTPS 或本机 HTTP");
  }
  const format = env.OPS_IMAGE_FORMAT || "png";
  if (!(format in formats)) throw new Error("OPS_IMAGE_FORMAT 仅支持 png、jpeg、webp");
  const content = [{ type: "input_text", text: prompt }];
  const files = [];
  for (const path of inputs) {
    const info = await stat(path);
    if (!info.isFile() || info.size > 20_000_000) throw new Error("参考图须为小于 20 MB 的本地文件");
    const bytes = await readFile(path);
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
    if (!mime) throw new Error("参考图仅支持 PNG、JPEG、WebP");
    files.push({ path, bytes, mime });
    content.push({ type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}` });
  }
  const settings = { model: env.OPS_IMAGE_TOOL_MODEL || "gpt-image-2.5-sunburst", size: env.OPS_IMAGE_SIZE || "auto",
    quality: env.OPS_IMAGE_QUALITY || "auto", output_format: format, background: env.OPS_IMAGE_BACKGROUND || "auto" };
  if (settings.background === "transparent" && format === "jpeg") throw new Error("透明背景不支持 JPEG");
  let inputImageMask;
  if (mask) {
    const maskBytes = await readFile(mask);
    if (maskBytes.length > 4_000_000) throw new Error("遮罩 PNG 不得超过 4 MB");
    const sourceSize = pngDimensions(files[0].bytes);
    const maskSize = pngDimensions(maskBytes);
    if (sourceSize.width !== maskSize.width || sourceSize.height !== maskSize.height ||
      ![4, 6].includes(maskSize.colorType)) throw new Error("遮罩须与首张 PNG 同尺寸，且包含 Alpha 通道");
    inputImageMask = { image_url: `data:image/png;base64,${maskBytes.toString("base64")}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  let response;
  try {
    const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    response = await fetcher(`${base.toString().replace(/\/$/, "")}/responses`, {
      method: "POST", redirect: "error", signal: requestSignal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.OPS_IMAGE_MODEL || "gpt-5.5", input: [{ role: "user", content }],
        tools: [{ type: "image_generation", ...settings, action: inputs.length ? "edit" : "generate",
          ...(inputImageMask ? { input_image_mask: inputImageMask } : {}) }],
        tool_choice: { type: "image_generation" }, ...(previousResponseId ? { previous_response_id: previousResponseId } : {}) }),
    });
  } finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`Responses 图片请求失败（HTTP ${response.status}；遮罩需兼容 input_image_mask）`);
  const result = await response.json();
  const image = result.output?.find((item) => item.type === "image_generation_call" && item.result);
  const data = image?.result;
  if (!data) throw new Error("Responses 未返回 image_generation_call 图片");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > 30_000_000) throw new Error("图片数据无效或超过 30 MB");
  const matchesFormat = format === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : format === "jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!matchesFormat) throw new Error("Provider 返回的图片格式与请求不符");
  if (extname(out).toLowerCase() !== `.${format === "jpeg" ? "jpg" : format}`) throw new Error("输出文件扩展名与格式不匹配");
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  await writeFile(out, bytes, { mode: 0o600 });
  return { path: out, responseId: result.id || null, revisedPrompt: image.revised_prompt || null, mimeType: formats[format] };
}

if (!process.send && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const inputs = args.flatMap((arg, index) => arg === "--input" ? [args[index + 1]] : []);
  generateImage({ prompt: option("--prompt"), out: option("--out"), inputs,
    mask: option("--mask"),
    previousResponseId: args.includes("--previous-response-id") ? option("--previous-response-id") : undefined })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
