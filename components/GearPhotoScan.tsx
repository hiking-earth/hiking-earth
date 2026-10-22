"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, ScanSearch, ShieldCheck, Trash2 } from "lucide-react";
import NextImage from "next/image";

type Detection = { name: string; category: string; score: number };
type ObjectDetector = { detect: (image: HTMLCanvasElement, max?: number, score?: number) => Promise<Array<{ class: string; score: number }>> };

const LABELS: Record<string, [string, string]> = {
  backpack: ["背包", "背包"], handbag: ["手提包（请确认用途）", "其他"], suitcase: ["行李箱（请确认用途）", "其他"],
  bench: ["步道长椅/露营凳候选（请确认用途）", "休息"], chair: ["露营椅候选（请确认类型）", "休息"], bed: ["铺位/睡垫候选（请确认物品）", "睡眠"], "dining table": ["露营桌候选（请确认用途）", "炊具"],
  bottle: ["瓶状物（请确认用途）", "饮食"], cup: ["杯子", "饮食"], bowl: ["碗", "饮食"],
  knife: ["刀具", "工具"], fork: ["叉子", "饮食"], spoon: ["勺子", "饮食"], book: ["地图或手册候选（请确认内容）", "导航"],
  clock: ["手表或计时器候选（请确认类型）", "导航"], scissors: ["剪刀状工具候选（请确认用途）", "工具"], toothbrush: ["牙刷候选", "卫生"],
  "cell phone": ["手机", "导航"], umbrella: ["雨伞", "其他"], skis: ["滑雪板候选", "其他"], snowboard: ["单板滑雪板候选", "其他"],
  surfboard: ["冲浪板候选", "其他"], skateboard: ["滑板候选", "其他"], "tennis racket": ["球拍候选", "其他"],
  "baseball bat": ["球棒候选", "其他"], "baseball glove": ["手套候选", "其他"],
  "sports ball": ["球类装备候选", "其他"], frisbee: ["飞盘候选", "其他"], kite: ["风筝候选", "其他"],
};

let detectorPromise: Promise<ObjectDetector> | undefined;

async function loadDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const tf = await import("@tensorflow/tfjs-core");
      await import("@tensorflow/tfjs-backend-cpu");
      await import("@tensorflow/tfjs-backend-webgl");
      const model = await import("@tensorflow-models/coco-ssd");
      let accelerated = false;
      try { accelerated = await tf.setBackend("webgl"); } catch { /* Use CPU below. */ }
      if (!accelerated) {
        let cpu = false;
        try { cpu = await tf.setBackend("cpu"); } catch { /* Show one stable error to the user. */ }
        if (!cpu) throw new Error("此设备无法启动本机识别，请换设备后重试");
      }
      await tf.ready();
      const modelUrl = new URL("/client-app/models/gear/model.json", window.location.origin).toString();
      return model.load({ base: "lite_mobilenet_v2", modelUrl });
    })().catch((error: unknown) => {
      detectorPromise = undefined;
      throw error;
    });
  }
  return detectorPromise;
}

export function GearPhotoScan() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef("");
  const [preview, setPreview] = useState("");
  const [previewDimensions, setPreviewDimensions] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<Detection[]>([]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  function clearPhoto() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setPreviewDimensions(null);
    setItems([]);
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function choosePhoto(file?: File) {
    clearPhoto();
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
      setMessage("请选择 JPEG 或 PNG 照片。");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setMessage("照片需小于 4 MB。");
      return;
    }
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
  }

  async function analyze() {
    if (!preview || busy) return;
    setBusy(true);
    setMessage("首次使用需加载约 19 MB 的本机模型；照片始终留在此设备。");
    try {
      const image = new window.Image();
      image.src = preview;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24_000_000) {
        throw new Error("照片尺寸过大，请先压缩后重试。");
      }
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 300 / image.naturalWidth, 300 / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("此浏览器不支持本机图像分析。");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const predictions = await (await loadDetector()).detect(canvas, 20, 0.55);
      const best = new Map<string, { mapped: [string, string]; score: number }>();
      for (const { class: label, score } of predictions) {
        const mapped = LABELS[label];
        if (!mapped || !Number.isFinite(score) || score < 0 || score > 1) continue;
        if (score > (best.get(label)?.score ?? -1)) best.set(label, { mapped, score });
      }
      const next = [...best.values()]
        .sort((a, b) => b.score - a.score)
        .map(({ mapped, score }) => ({ name: mapped[0], category: mapped[1], score }));
      setItems(next);
      setMessage(next.length ? "以下是图像候选，请逐项人工确认；模型分数不是准确率或装备质量认证。" : "没有检测到模型支持的类别；这不表示照片中没有装备。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本机图像分析失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="gear-photo" aria-label="本机照片装备识别">
    <div className="gear-photo-head"><h3><ScanSearch size={16} />照片装备识别</h3><span><ShieldCheck size={13} />仅在本机处理</span></div>
    <p>免费模型只识别有限通用物体候选；徒步鞋靴、登山杖、帐篷、睡袋和药品没有专用类别，请结合路线装备清单手动核对。床类只提供铺位/睡垫候选，不表示识别出睡袋。照片仅在本机处理，模型不判断衣物材质、装备性能或完整性。</p>
    <input ref={inputRef} className="gear-photo-input" type="file" accept="image/jpeg,image/png" aria-label="选择装备照片" onChange={(event) => choosePhoto(event.currentTarget.files?.[0])} />
    <div className="gear-photo-actions">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}><Camera size={15} />{preview ? "更换照片" : "从设备选择照片"}</button>
      {preview && <button type="button" className="gear-photo-clear" onClick={clearPhoto} disabled={busy} aria-label="移除照片"><Trash2 size={14} /></button>}
    </div>
    {preview && <NextImage className="gear-photo-preview" src={preview} alt="待分析的装备照片" width={previewDimensions?.width ?? 640} height={previewDimensions?.height ?? 360} unoptimized onLoad={(event) => setPreviewDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />}
    {preview && <button type="button" className="gear-photo-analyze" onClick={() => void analyze()} disabled={busy}>
      {busy ? <><LoaderCircle className="gear-photo-spinner" size={15} />本机分析中</> : <><ScanSearch size={15} />开始本机识别</>}
    </button>}
    {message && <p className="gear-photo-message" role="status">{message}</p>}
    {!!items.length && <ul className="gear-photo-results">{items.map((item, index) => <li key={`${item.name}-${index}`}><b>{item.name}</b><span>{item.category}</span><em>候选 {Math.round(item.score * 100)}%</em></li>)}</ul>}
  </section>;
}
