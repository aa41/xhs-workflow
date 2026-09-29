import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

type Point = { x: number; y: number };
type Stroke = { points: Point[]; width: number };

export function MaskEditor({ source, onChange }: { source: { dataUrl: string; width: number; height: number }; onChange: (mask: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef(false);
  const [brush, setBrush] = useState(64);
  const [hasMask, setHasMask] = useState(false);

  const strokePath = (context: CanvasRenderingContext2D, stroke: Stroke) => {
    const { points, width } = stroke;
    if (!points.length) return;
    context.beginPath();
    context.lineWidth = width;
    if (points.length === 1) {
      context.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  };

  const render = () => {
    const target = canvas.current;
    const context = target?.getContext("2d");
    if (!target || !context || !image.current) return;
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(image.current, 0, 0, target.width, target.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(221, 107, 75, .56)";
    context.fillStyle = "rgba(221, 107, 75, .56)";
    for (const stroke of strokes.current) strokePath(context, stroke);
  };

  useEffect(() => {
    const loaded = new Image();
    loaded.onload = () => {
      image.current = loaded;
      if (canvas.current) { canvas.current.width = source.width; canvas.current.height = source.height; }
      strokes.current = [];
      setHasMask(false);
      onChange(null);
      render();
    };
    loaded.src = source.dataUrl;
    return () => { loaded.onload = null; };
  }, [source.dataUrl, source.width, source.height]);

  useEffect(() => { render(); }, [brush]);

  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(source.width, (event.clientX - bounds.left) * source.width / bounds.width)),
      y: Math.max(0, Math.min(source.height, (event.clientY - bounds.top) * source.height / bounds.height)) };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const mask = document.createElement("canvas");
    mask.width = source.width;
    mask.height = source.height;
    const context = mask.getContext("2d");
    if (!context) return;
    context.fillStyle = "white";
    context.fillRect(0, 0, mask.width, mask.height);
    context.globalCompositeOperation = "destination-out";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "black";
    context.fillStyle = "black";
    for (const stroke of strokes.current) strokePath(context, stroke);
    setHasMask(true);
    onChange(mask.toDataURL("image/png"));
  };

  return <div className="mask-editor">
    <div className="mask-editor-heading"><div><strong>局部遮罩</strong><p>在第一张 PNG 上涂红要修改的区域，其余部分尽量保持不变。</p></div><button type="button" className="button button-quiet" disabled={!hasMask} onClick={() => {
      strokes.current = []; setHasMask(false); onChange(null); render();
    }}>清空遮罩</button></div>
    <canvas ref={canvas} role="img" aria-label="在参考图上绘制编辑区域" onPointerDown={(event) => {
      drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId);
      strokes.current.push({ points: [point(event)], width: brush }); render();
    }} onPointerMove={(event) => {
      if (!drawing.current) return;
      strokes.current.at(-1)?.points.push(point(event)); render();
    }} onPointerUp={finish} onPointerCancel={finish} />
    <label className="brush-control">画笔大小 <input type="range" min="16" max="160" step="8" value={brush}
      onChange={(event) => setBrush(Number(event.target.value))} /><span>{brush} px</span></label>
    <p className="field-hint">透明区域由 Responses image_generation 重绘；中转服务须支持 input_image_mask。图片不会自动发布。</p>
  </div>;
}
