import { useEffect, useRef } from "react";

const TOTAL_MS = 1000;
const TRAVEL_MS = 800;
const FADE_MS = 200;
const CREEP_MS = 200;
const CREEP_DIST = 0.06;
const GAUSS_MU = 450;
const GAUSS_SIGMA = 110;
const TRAIL_N = 42;

const LOGO_W = 658;

const CORNER_BL = { x: 0.26915, y: 0.72391 };
const CORNER_BR = { x: 0.70167, y: 0.72391 };
const JUNCTION_L = { x: 0.37933, y: 0.33554 };
const JUNCTION_R = { x: 0.59210, y: 0.33609 };
const CIRCLE_C = { x: 0.48632, y: 0.21413 };
const CIRCLE_R = 0.20061;
const ARC_START_L = 122.2;
const ARC_SWEEP_L = 192.8;
const ARC_START_R = 58.2;
const ARC_SWEEP_R = -103.2;

type Point = { x: number; y: number };
type Segment =
  | { kind: "line"; from: Point; to: Point; length: number }
  | { kind: "arc"; center: Point; radius: number; startDeg: number; sweepDeg: number; length: number };

interface MeasuredPath {
  length: number;
  segments: Segment[];
}

export function SplashOverlay(props: { onFinished: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(false);
  const { onFinished } = props;

  useEffect(() => {
    const canvasElement = canvasRef.current;
    const wrapElement = canvasElement?.parentElement;
    if (!canvasElement || !wrapElement) return;
    const canvas = canvasElement;
    const wrap = wrapElement;

    let animationFrame = 0;
    let startTime = 0;
    let width = 0;
    let height = 0;

    function resize() {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const context = canvas.getContext("2d");
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function finish() {
      if (doneRef.current) return;
      doneRef.current = true;
      onFinished();
    }

    function frame(now: number) {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;
      drawSplashLights(canvas, width, height, elapsed);
      if (elapsed < TOTAL_MS) {
        animationFrame = window.requestAnimationFrame(frame);
      } else {
        finish();
      }
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    animationFrame = window.requestAnimationFrame(frame);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [onFinished]);

  return <div className="splash-overlay" aria-label="BYOKey Speak loading">
    <div className="splash-logo-wrap" aria-hidden="true">
      <img src="/images/splash_logo.webp" alt="" />
      <canvas ref={canvasRef} className="splash-canvas" />
    </div>
  </div>;
}

function drawSplashLights(canvas: HTMLCanvasElement, width: number, height: number, tMs: number) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  const fade = tMs <= TRAVEL_MS ? 1 : clamp(1 - (tMs - TRAVEL_MS) / FADE_MS, 0, 1);
  if (fade <= 0) return;

  const [pathA, pathB] = buildPaths(width, height);
  const u = width / LOGO_W;
  const t = Math.min(tMs, TRAVEL_MS);
  const previousOperation = context.globalCompositeOperation;
  context.globalCompositeOperation = "lighter";

  for (const path of [pathA, pathB]) {
    for (let k = 1; k < TRAIL_N; k += 1) {
      const tt = t - k * 10;
      if (tt < 0) break;
      const weight = 1 - k / TRAIL_N;
      glowPoint(context, pointOnPath(path, progress(tt)), (4.5 * weight + 1) * u * 2.2, (13 * weight + 2) * u * 3, fade * 0.4 * weight * weight);
    }
    glowPoint(context, pointOnPath(path, progress(t)), 6 * u * 2.2, 26 * u * 3, fade);
  }

  if (tMs >= TRAVEL_MS - 20) {
    const flash = Math.min(1, (tMs - (TRAVEL_MS - 20)) / 60);
    glowPoint(context, pointOnPath(pathA, 1), 8 * u * 2.2, 34 * u * 3, flash * fade * 1.2);
  }

  context.globalCompositeOperation = previousOperation;
}

function buildPaths(width: number, height: number): [MeasuredPath, MeasuredPath] {
  const radius = CIRCLE_R * width;
  const center = { x: CIRCLE_C.x * width, y: CIRCLE_C.y * height };
  return [
    measure([
      line(scale(CORNER_BL, width, height), scale(JUNCTION_L, width, height)),
      arc(center, radius, ARC_START_L, ARC_SWEEP_L)
    ]),
    measure([
      line(scale(CORNER_BL, width, height), scale(CORNER_BR, width, height)),
      line(scale(CORNER_BR, width, height), scale(JUNCTION_R, width, height)),
      arc(center, radius, ARC_START_R, ARC_SWEEP_R)
    ])
  ];
}

function scale(point: Point, width: number, height: number): Point {
  return { x: point.x * width, y: point.y * height };
}

function line(from: Point, to: Point): Segment {
  return { kind: "line", from, to, length: Math.hypot(to.x - from.x, to.y - from.y) };
}

function arc(center: Point, radius: number, startDeg: number, sweepDeg: number): Segment {
  return { kind: "arc", center, radius, startDeg, sweepDeg, length: Math.abs(degToRad(sweepDeg)) * radius };
}

function measure(segments: Segment[]): MeasuredPath {
  return { segments, length: segments.reduce((sum, segment) => sum + segment.length, 0) };
}

function pointOnPath(path: MeasuredPath, fraction: number): Point {
  let remaining = path.length * clamp(fraction, 0, 1);
  for (const segment of path.segments) {
    if (remaining > segment.length) {
      remaining -= segment.length;
      continue;
    }
    const ratio = segment.length <= 0 ? 0 : remaining / segment.length;
    if (segment.kind === "line") {
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio
      };
    }
    const angle = degToRad(segment.startDeg + segment.sweepDeg * ratio);
    return {
      x: segment.center.x + Math.cos(angle) * segment.radius,
      y: segment.center.y + Math.sin(angle) * segment.radius
    };
  }
  const last = path.segments[path.segments.length - 1];
  if (last.kind === "line") return last.to;
  const angle = degToRad(last.startDeg + last.sweepDeg);
  return { x: last.center.x + Math.cos(angle) * last.radius, y: last.center.y + Math.sin(angle) * last.radius };
}

function glowPoint(context: CanvasRenderingContext2D, center: Point, coreR: number, glowR: number, intensity: number) {
  if (intensity <= 0.01) return;
  const i = Math.min(1, intensity);
  const glow = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
  glow.addColorStop(0, `rgba(255, 247, 224, ${0.55 * i})`);
  glow.addColorStop(0.35, `rgba(255, 247, 224, ${0.22 * i})`);
  glow.addColorStop(1, "rgba(255, 247, 224, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(center.x, center.y, glowR, 0, Math.PI * 2);
  context.fill();

  const core = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, coreR);
  core.addColorStop(0, `rgba(255, 255, 255, ${i})`);
  core.addColorStop(0.6, `rgba(255, 255, 255, ${0.5 * i})`);
  core.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = core;
  context.beginPath();
  context.arc(center.x, center.y, coreR, 0, Math.PI * 2);
  context.fill();
}

function normCdf(x: number) {
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

function progress(tMs: number) {
  if (tMs <= 0) return 0;
  if (tMs <= CREEP_MS) {
    const x = tMs / CREEP_MS;
    return CREEP_DIST * x * x * (2 - x);
  }
  const lo = normCdf((CREEP_MS - GAUSS_MU) / GAUSS_SIGMA);
  const hi = normCdf((TRAVEL_MS - GAUSS_MU) / GAUSS_SIGMA);
  const g = (normCdf((tMs - GAUSS_MU) / GAUSS_SIGMA) - lo) / (hi - lo);
  return clamp(CREEP_DIST + (1 - CREEP_DIST) * g, 0, 1);
}

function degToRad(degrees: number) {
  return degrees * Math.PI / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
