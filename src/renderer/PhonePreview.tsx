import type { ImageJob } from "../shared/contracts";
import { cleanPublishableMarkdown } from "../shared/publishable";

export function phoneCopyFromMarkdown(markdown: string): { title: string; body: string } {
  const lines = cleanPublishableMarkdown(markdown).split("\n").map(line => line.trim()).filter(Boolean);
  const title = (lines.find(line => /^#{1,3}\s/.test(line)) ?? lines[0] ?? "未命名笔记")
    .replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").slice(0, 80);
  const body = lines.filter(line => line !== lines.find(item => /^#{1,3}\s/.test(item)) && line !== title)
    .join("\n\n").replace(/^#{1,6}[ \t]+/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(?:\*\*|__|`)/g, "");
  return { title, body };
}

type Props = {
  markdown: string;
  images: ImageJob[];
  selectedId: string | null;
  imageUrl: string | null;
  loadFailed?: boolean;
  onSelect: (id: string) => void;
  onReveal: (job: ImageJob) => void;
};

export function PhonePreview({ markdown, images, selectedId, imageUrl, loadFailed, onSelect, onReveal }: Props) {
  const { title, body } = phoneCopyFromMarkdown(markdown);
  const selected = images.find(job => job.id === selectedId);
  return <div className="phone-preview-layout">
    <div className="phone-device" aria-label="小红书笔记手机模拟预览">
      <div className="phone-status"><span>9:41</span><span>●●● ▰</span></div>
      <div className="phone-header"><span>‹</span><strong>笔记预览</strong><span>···</span></div>
      <div className="phone-scroll">
        <div className="phone-cover">{imageUrl ? <img src={imageUrl} alt={selected?.role === "content" ? "内容配图模拟预览" : "封面模拟预览"} />
          : <div className="phone-cover-placeholder"><span>图片预览</span><small>{!images.length ? "尚无已生成图片" : loadFailed ? "图片预览不可用，请定位文件检查" : "正在加载所选图片…"}</small></div>}
          {images.length > 1 && <span className="phone-image-index">{Math.max(1, images.findIndex(job => job.id === selectedId) + 1)} / {images.length}</span>}</div>
        <div className="phone-author"><span className="phone-avatar">我</span><strong>独立开发者</strong><span className="phone-follow">关注</span></div>
        <article className="phone-note"><h3>{title}</h3><p>{body || "暂无正文"}</p></article>
      </div>
      <div className="phone-toolbar"><span>说点什么…</span><span>♡　☆　↗</span></div>
    </div>
    <div className="phone-preview-side"><span className="section-kicker">MOBILE SIMULATION</span><h3>手机阅读效果</h3><p>仅模拟图片比例、标题与正文的阅读节奏；不是小红书的实际发布页面，也不会自动上传。</p>
      {images.length ? <><strong>切换图片</strong><div className="phone-image-choices">{images.map(job => <button key={job.id} className={selectedId === job.id ? "active" : ""} onClick={() => onSelect(job.id)}>{job.role === "content" ? "配图" : "封面"} {job.sequence}</button>)}</div>
        {selected && <button className="button button-outline" onClick={() => onReveal(selected)}>在文件夹中定位这张图片</button>}</>
        : <p className="quiet-message">还没有已完成的图片。正文仍可独立预览；图片完成后会出现在这里。</p>}
      <small>发布前请在真实设备和小红书客户端再次核对裁切、文字及图片顺序。</small>
    </div>
  </div>;
}
