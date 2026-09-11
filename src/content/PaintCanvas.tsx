import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  MousePointer2,
  Type,
  PenTool,
  Eraser,
  Highlighter,
  PaintBucket,
  Minus,
  Square,
  Circle,
  Trash2,
  Camera,
  Undo2,
  Redo2,
  X,
  Hexagon,
  Monitor,
  Download,
  Copy,
  Triangle,
  GripHorizontal,
  FileDown,
  FileText,
  Loader2
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tool =
  | "select"
  | "text"
  | "pen"
  | "eraser"
  | "highlighter"
  | "fill"
  | "curve"
  | "line"
  | "squiggle"
  | "polygon"
  | "rect"
  | "ellipse"
  | "triangle";

interface DrawPoint {
  x: number;
  y: number;
}

interface DrawPath {
  tool: Tool;
  points: DrawPoint[];
  color: string;
  opacity: number;
  size: number;
  text?: string;
  image?: HTMLImageElement;
}

// ─── SVG icon helpers ─────────────────────────────────────────────────────────
const CurveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 19c3.33-4 6.67-4 10 0 3.33 4 6.67 4 10 0" />
  </svg>
);

const SquiggleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
  </svg>
);

const ColorWheelIcon = ({ color }: { color: string }) => (
  <div style={{ position: "relative", width: "24px", height: "24px", margin: "0 auto" }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
        padding: "3px",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          backgroundColor: color,
          border: "2px solid white",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)"
        }}
      />
    </div>
  </div>
);

// ─── Flood Fill Algorithm ─────────────────────────────────────────────────────
const performFloodFill = async (canvas: HTMLCanvasElement, startX: number, startY: number, color: string): Promise<string> => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), 255] : [0, 0, 0, 255];
  };
  const fillColor = hexToRgb(color);

  const getPixel = (x: number, y: number) => {
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const startColor = getPixel(startX, startY);

  const tolerance = 128; // Higher tolerance to fill anti-aliased edges
  const matchStartColor = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return Math.abs(data[i] - startColor[0]) <= tolerance &&
      Math.abs(data[i + 1] - startColor[1]) <= tolerance &&
      Math.abs(data[i + 2] - startColor[2]) <= tolerance;
  };

  if (Math.abs(startColor[0] - fillColor[0]) <= tolerance &&
    Math.abs(startColor[1] - fillColor[1]) <= tolerance &&
    Math.abs(startColor[2] - fillColor[2]) <= tolerance) {
    return "";
  }

  const pixelStack: [number, number][] = [[Math.round(startX), Math.round(startY)]];

  while (pixelStack.length > 0) {
    const [px, py] = pixelStack.pop()!;
    let currentX = px;
    while (currentX >= 0 && matchStartColor(currentX, py)) {
      currentX--;
    }
    currentX++;

    let spanAbove = false;
    let spanBelow = false;

    while (currentX < width && matchStartColor(currentX, py)) {
      const i = (py * width + currentX) * 4;
      data[i] = fillColor[0];
      data[i + 1] = fillColor[1];
      data[i + 2] = fillColor[2];
      data[i + 3] = fillColor[3]; // opacity 255 usually, or mapped

      if (py > 0) {
        if (matchStartColor(currentX, py - 1)) {
          if (!spanAbove) {
            pixelStack.push([currentX, py - 1]);
            spanAbove = true;
          }
        } else {
          spanAbove = false;
        }
      }

      if (py < height - 1) {
        if (matchStartColor(currentX, py + 1)) {
          if (!spanBelow) {
            pixelStack.push([currentX, py + 1]);
            spanBelow = true;
          }
        } else {
          spanBelow = false;
        }
      }
      currentX++;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
};

// ─── Canvas render helper ─────────────────────────────────────────────────────
function redrawCanvas(canvas: HTMLCanvasElement, paths: DrawPath[], draft?: DrawPath | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawSingle = (path: DrawPath) => {
    if (path.tool === "fill" && path.image) {
      ctx.save();
      ctx.globalAlpha = path.opacity;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(path.image, 0, 0);
      ctx.restore();
      return;
    }

    if (!path.points.length) return;
    ctx.save();
    ctx.globalAlpha = path.opacity;
    ctx.strokeStyle = path.tool === "eraser" ? "rgba(255,255,255,1)" : path.color;
    ctx.fillStyle = path.color;
    ctx.lineWidth = path.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (path.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else if (path.tool === "highlighter") {
      ctx.globalCompositeOperation = "multiply";
      ctx.lineWidth = path.size * 3;
      ctx.globalAlpha = path.opacity * 0.3;
    } else {
      ctx.globalCompositeOperation = "source-over";
    }

    const p0 = path.points[0];
    const pN = path.points[path.points.length - 1];

    if (path.tool === "pen" || path.tool === "highlighter" || path.tool === "eraser" || path.tool === "squiggle" || path.tool === "curve") {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < path.points.length; i++) {
        const prev = path.points[i - 1];
        const curr = path.points[i];
        const mx = (prev.x + curr.x) / 2;
        const my = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
      }
      ctx.lineTo(pN.x, pN.y);
      ctx.stroke();
    } else if (path.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(pN.x, pN.y);
      ctx.stroke();
    } else if (path.tool === "rect") {
      ctx.beginPath();
      ctx.strokeRect(p0.x, p0.y, pN.x - p0.x, pN.y - p0.y);
    } else if (path.tool === "ellipse") {
      const rx = Math.abs(pN.x - p0.x) / 2;
      const ry = Math.abs(pN.y - p0.y) / 2;
      const cx = p0.x + (pN.x - p0.x) / 2;
      const cy = p0.y + (pN.y - p0.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (path.tool === "polygon") {
      const rx = Math.abs(pN.x - p0.x) / 2;
      const ry = Math.abs(pN.y - p0.y) / 2;
      const cx = p0.x + (pN.x - p0.x) / 2;
      const cy = p0.y + (pN.y - p0.y) / 2;
      const sides = 6;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
        const x = cx + rx * Math.cos(angle);
        const y = cy + ry * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (path.tool === "triangle") {
      ctx.beginPath();
      ctx.moveTo(p0.x + (pN.x - p0.x) / 2, p0.y); // Top center
      ctx.lineTo(pN.x, pN.y); // Bottom right
      ctx.lineTo(p0.x, pN.y); // Bottom left
      ctx.closePath();
      ctx.stroke();
    } else if (path.tool === "text" && path.text) {
      ctx.font = `${path.size * 4}px Inter, sans-serif`;
      ctx.fillStyle = path.color;
      ctx.globalAlpha = path.opacity;
      ctx.fillText(path.text, p0.x, p0.y);
    }

    ctx.restore();
  };

  paths.forEach(drawSingle);
  if (draft) drawSingle(draft);
}

// ─── Component ────────────────────────────────────────────────────────────────
interface PaintCanvasProps {
  onClose: () => void;
  initialAction?: "area" | "full" | "fullpage";
  onScreenshotModeChange?: (active: boolean) => void;
}

export const PaintCanvas: React.FC<PaintCanvasProps> = ({ onClose, initialAction, onScreenshotModeChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ff0000");
  const [opacity, setOpacity] = useState(1);
  const [size, setSize] = useState(5);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [redoStack, setRedoStack] = useState<DrawPath[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<DrawPath | null>(null);

  // Draggable Toolbar
  const [toolbarPos, setToolbarPos] = useState({ x: window.innerWidth - 140, y: window.innerHeight * 0.1 });
  const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Screenshot State
  const [isTakingScreenshot, setIsTakingScreenshot] = useState(false);
  const [screenshotStart, setScreenshotStart] = useState<{ x: number, y: number } | null>(null);
  const [screenshotCurrent, setScreenshotCurrent] = useState<{ x: number, y: number } | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null); // To show confirmation modal
  const [isCapturingFullPage, setIsCapturingFullPage] = useState(false);
  const [fullPageProgress, setFullPageProgress] = useState(0);

  useEffect(() => {
    if (onScreenshotModeChange) {
      onScreenshotModeChange(isTakingScreenshot || previewDataUrl !== null || isCapturingFullPage);
    }
    return () => {
      if (onScreenshotModeChange) {
        onScreenshotModeChange(false);
      }
    };
  }, [isTakingScreenshot, previewDataUrl, isCapturingFullPage, onScreenshotModeChange]);

  // Text input state
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState("");
  const textInputRef = useRef<HTMLInputElement>(null);

  // Fit canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      redrawCanvas(canvas, paths, currentPath);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [paths, currentPath]);

  // Focus text
  useEffect(() => {
    if (pendingText) {
      setTimeout(() => textInputRef.current?.focus(), 50);
    }
  }, [pendingText]);

  // Drag logic
  const startDrag = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName.toLowerCase() === 'input' || target.closest('button') || target.closest('svg')) return;
    setIsDraggingToolbar(true);
    dragOffset.current = {
      x: e.clientX - toolbarPos.x,
      y: e.clientY - toolbarPos.y
    };
  };

  useEffect(() => {
    if (initialAction === "area") {
      setIsTakingScreenshot(true);
      setTool("select");
    } else if (initialAction === "full") {
      // Wait slightly for render
      setTimeout(() => {
        setIsTakingScreenshot(false);
        setTool("select");
        captureRegion(0, 0, window.innerWidth, window.innerHeight);
      }, 100);
    } else if (initialAction === "fullpage") {
      setTimeout(() => {
        setIsTakingScreenshot(false);
        setTool("select");
        captureFullPage();
      }, 100);
    }
  }, [initialAction]);

  const onDrag = useCallback((e: MouseEvent) => {
    if (!isDraggingToolbar) return;
    setToolbarPos({
      x: Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x)),
      y: Math.max(0, Math.min(window.innerHeight - 500, e.clientY - dragOffset.current.y))
    });
  }, [isDraggingToolbar]);

  const endDrag = useCallback(() => setIsDraggingToolbar(false), []);

  useEffect(() => {
    if (isDraggingToolbar) {
      window.addEventListener('mousemove', onDrag);
      window.addEventListener('mouseup', endDrag);
    } else {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', endDrag);
    }
    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', endDrag);
    };
  }, [isDraggingToolbar, onDrag, endDrag]);

  const getPos = (e: React.MouseEvent | MouseEvent): DrawPoint => ({
    x: e.clientX,
    y: e.clientY,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    const toolbar = document.getElementById("paint-toolbar");
    const preview = document.getElementById("paint-screenshot-preview");
    if ((toolbar && toolbar.contains(e.target as Node)) || (preview && preview.contains(e.target as Node))) {
      return;
    }

    if (isTakingScreenshot) {
      setScreenshotStart(getPos(e));
      setScreenshotCurrent(getPos(e));
      return;
    }

    if (tool === "select") return;

    e.preventDefault();
    e.stopPropagation();

    if (tool === "text") {
      setPendingText({ x: e.clientX, y: e.clientY });
      setTextInput("");
      return;
    }

    if (tool === "fill") {
      const canvas = canvasRef.current;
      if (canvas) {
        setRedoStack([]);
        performFloodFill(canvas, e.clientX, e.clientY, color).then((dataUrl) => {
          if (dataUrl) {
            const img = new Image();
            img.onload = () => {
              setPaths(prev => [...prev, { tool: "fill", points: [getPos(e)], color, opacity, size: 1, image: img }]);
            };
            img.src = dataUrl;
          }
        });
      }
      return;
    }

    setIsDrawing(true);
    setRedoStack([]);

    const newPath: DrawPath = { tool, color, opacity, size, points: [getPos(e)] };
    setCurrentPath(newPath);
  }, [tool, color, opacity, size, isTakingScreenshot]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isTakingScreenshot && screenshotStart) {
      setScreenshotCurrent(getPos(e));
      return;
    }
    if (!isDrawing || !currentPath) return;
    e.preventDefault();
    const pos = getPos(e);
    const updated = { ...currentPath, points: [...currentPath.points, pos] };
    setCurrentPath(updated);

    const canvas = canvasRef.current;
    if (canvas) redrawCanvas(canvas, paths, updated);
  }, [isDrawing, currentPath, paths, isTakingScreenshot, screenshotStart]);

  const captureRegion = async (x: number, y: number, w: number, h: number) => {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {

      // Temporarily hide the extension container so zero extension elements/bars are captured
      const extensionRoot = document.getElementById("accessibility-inspector-extension-root");
      if (extensionRoot) extensionRoot.style.visibility = "hidden";

      // Force double rAF + timeout to ensure compositor frame is rendered cleanly without extension UI
      await new Promise(res => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(res, 50);
          });
        });
      });

      chrome.runtime.sendMessage({ action: "capture-tab" }, (response) => {
        // Restore extension UI immediately after capture is taken
        if (extensionRoot) extensionRoot.style.visibility = "visible";

        if (response && response.dataUrl) {
          const img = new Image();
          img.onload = () => {
            const scale = img.width / window.innerWidth;

            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = w * scale;
            cropCanvas.height = h * scale;
            const cropCtx = cropCanvas.getContext("2d");
            if (!cropCtx) return;

            // High-res composite
            cropCtx.drawImage(img, x * scale, y * scale, w * scale, h * scale, 0, 0, w * scale, h * scale);

            const paintCanvas = canvasRef.current;
            if (paintCanvas) {
              cropCtx.drawImage(paintCanvas, x, y, w, h, 0, 0, w * scale, h * scale);
            }

            setPreviewDataUrl(cropCanvas.toDataURL("image/png", 1.0));
          };
          img.src = response.dataUrl;
        } else {
          // If capture failed and we were in one-shot mode, close
          if (initialAction) onClose();
        }
      });
    }
  };

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isTakingScreenshot && screenshotStart && screenshotCurrent) {
      setIsTakingScreenshot(false);
      const endPos = getPos(e);
      const start = screenshotStart;
      setScreenshotStart(null);
      setScreenshotCurrent(null);
      setTool("select");

      const x = Math.min(start.x, endPos.x);
      const y = Math.min(start.y, endPos.y);
      const w = Math.abs(endPos.x - start.x);
      const h = Math.abs(endPos.y - start.y);

      if (w < 10 || h < 10) {
        if (initialAction) onClose();
        return;
      }

      captureRegion(x, y, w, h);
      return;
    }

    if (!isDrawing || !currentPath) return;
    e.preventDefault();
    const pos = getPos(e);
    const final = { ...currentPath, points: [...currentPath.points, pos] };
    setPaths(prev => [...prev, final]);
    setCurrentPath(null);
    setIsDrawing(false);
  }, [isDrawing, currentPath, isTakingScreenshot, screenshotStart, screenshotCurrent]);

  const commitText = () => {
    if (!pendingText || !textInput.trim()) {
      setPendingText(null);
      setTextInput("");
      return;
    }
    const textPath: DrawPath = { tool: "text", color, opacity, size, points: [pendingText], text: textInput.trim() };
    setPaths(prev => [...prev, textPath]);
    setRedoStack([]);
    setPendingText(null);
    setTextInput("");
  };

  const undo = () => {
    if (paths.length === 0) return;
    setPaths(prev => {
      const newPaths = [...prev];
      const last = newPaths.pop();
      if (last) setRedoStack(rs => [...rs, last]);
      return newPaths;
    });
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    setRedoStack(prev => {
      const newRedo = [...prev];
      const next = newRedo.pop();
      if (next) setPaths(ps => [...ps, next]);
      return newRedo;
    });
  };

  const clearAll = () => {
    setPaths([]);
    setRedoStack([]);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const startScreenshotRegion = () => {
    setIsTakingScreenshot(true);
    setTool("select");
  };

  const takeFullScreenShot = () => {
    setIsTakingScreenshot(false);
    setTool("select");
    captureRegion(0, 0, window.innerWidth, window.innerHeight);
  };

  const captureFullPage = async () => {
    if (!chrome?.runtime?.sendMessage) return;

    setIsCapturingFullPage(true);
    setFullPageProgress(0);

    let paintToolbar: HTMLElement | null = null;
    let mainToolbar: HTMLElement | null = null;
    let floatingPanel: HTMLElement | null = null;
    const rootNode = canvasRef.current?.getRootNode() as ShadowRoot | Document;

    if (rootNode) {
      paintToolbar = rootNode.querySelector("#paint-toolbar") as HTMLElement;
      mainToolbar = rootNode.querySelector("#main-extension-menu") as HTMLElement;
      floatingPanel = rootNode.querySelector("#floating-panel-container") as HTMLElement;
    }

    if (paintToolbar) paintToolbar.style.display = "none";
    if (mainToolbar) mainToolbar.style.display = "none";
    if (floatingPanel) floatingPanel.style.display = "none";

    const originalOverflow = document.documentElement.style.overflow;
    const startX = window.scrollX;
    const startY = window.scrollY;

    const body = document.body;
    const html = document.documentElement;

    const fullWidth = Math.max(
      body ? body.scrollWidth : 0,
      body ? body.offsetWidth : 0,
      html.clientWidth,
      html.scrollWidth,
      html.offsetWidth
    );
    const fullHeight = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement("canvas");
    canvas.width = fullWidth * dpr;
    canvas.height = fullHeight * dpr;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      if (paintToolbar) paintToolbar.style.display = "flex";
      if (mainToolbar) mainToolbar.style.display = "flex";
      if (floatingPanel) floatingPanel.style.display = "block";
      setIsCapturingFullPage(false);
      return;
    }

    const fixedElements: { el: HTMLElement; origVis: string }[] = [];
    try {
      const allEls = document.querySelectorAll<HTMLElement>("*");
      allEls.forEach(el => {
        if (el.closest("#accessibility-inspector-extension-root")) return;
        const compStyle = window.getComputedStyle(el);
        if (compStyle.position === "fixed") {
          fixedElements.push({ el, origVis: el.style.visibility });
        } else if (compStyle.position === "sticky") {
          const rect = el.getBoundingClientRect();
          const docTop = rect.top + window.scrollY;
          // Only hide sticky elements if they are top-of-page headers (docTop < 150px)
          if (docTop < 150) {
            fixedElements.push({ el, origVis: el.style.visibility });
          }
        }
      });
    } catch (e) {
      console.warn("Error finding fixed elements:", e);
    }

    const numYSteps = Math.ceil(fullHeight / viewportHeight);
    const numXSteps = Math.ceil(fullWidth / viewportWidth);
    const totalSteps = numYSteps * numXSteps;
    let currentStep = 0;

    try {
      for (let yIdx = 0; yIdx < numYSteps; yIdx++) {
        const targetY = yIdx === numYSteps - 1
          ? Math.max(0, fullHeight - viewportHeight)
          : yIdx * viewportHeight;

        if (yIdx > 0) {
          fixedElements.forEach(({ el }) => {
            el.style.visibility = "hidden";
          });
        }

        for (let xIdx = 0; xIdx < numXSteps; xIdx++) {
          const targetX = xIdx === numXSteps - 1
            ? Math.max(0, fullWidth - viewportWidth)
            : xIdx * viewportWidth;

          window.scrollTo(targetX, targetY);
          
          // Wait 650ms to allow scroll animations, CSS transitions, lazy loading, and reflows to settle completely
          await new Promise(res => setTimeout(res, 650));

          const actualScrollX = window.scrollX;
          const actualScrollY = window.scrollY;

          // Temporarily hide progress banner & extension UI before taking tab capture
          const extensionRoot = document.getElementById("accessibility-inspector-extension-root");
          if (extensionRoot) extensionRoot.style.visibility = "hidden";

          await new Promise(res => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setTimeout(res, 50);
              });
            });
          });

          const captureResponse = await new Promise<{ dataUrl?: string }>(res => {
            chrome.runtime.sendMessage({ action: "capture-tab" }, resp => {
              res(resp || {});
            });
          });

          // Restore extension UI immediately after tab capture
          if (extensionRoot) extensionRoot.style.visibility = "visible";

          if (captureResponse.dataUrl) {
            await new Promise<void>(resImg => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(
                  img,
                  0,
                  0,
                  img.width,
                  img.height,
                  actualScrollX * dpr,
                  actualScrollY * dpr,
                  viewportWidth * dpr,
                  viewportHeight * dpr
                );
                resImg();
              };
              img.onerror = () => resImg();
              img.src = captureResponse.dataUrl!;
            });
          }

          currentStep++;
          setFullPageProgress(Math.round((currentStep / totalSteps) * 100));
        }
      }
    } catch (err) {
      console.error("Full page screenshot error:", err);
    } finally {
      fixedElements.forEach(({ el, origVis }) => {
        el.style.visibility = origVis;
      });

      window.scrollTo(startX, startY);
      document.documentElement.style.overflow = originalOverflow;

      if (paintToolbar) paintToolbar.style.display = "flex";
      if (mainToolbar) mainToolbar.style.display = "flex";
      if (floatingPanel) floatingPanel.style.display = "block";

      setIsCapturingFullPage(false);

      const paintCanvas = canvasRef.current;
      if (paintCanvas && paths.length > 0) {
        ctx.drawImage(paintCanvas, 0, startY * dpr, viewportWidth * dpr, viewportHeight * dpr);
      }

      setPreviewDataUrl(canvas.toDataURL("image/png", 1.0));
    }
  };

  const takeFullPageScreenshot = () => {
    setIsTakingScreenshot(false);
    setTool("select");
    captureFullPage();
  };

  const handlePreviewClose = () => {
    setPreviewDataUrl(null);
    if (initialAction) onClose();
  };

  const downloadPreview = () => {
    if (!previewDataUrl) return;

    let baseName = document.title.trim();
    if (!baseName) {
      baseName = window.location.hostname || "screenshot";
    }

    const sanitized = baseName
      .replace(/[/\\?%*:|"<>]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 60);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const dateStamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    const fileName = `${sanitized || "screenshot"}_${dateStamp}.png`;

    const link = document.createElement("a");
    link.download = fileName;
    link.href = previewDataUrl;
    link.click();
    handlePreviewClose();
  };

  const copyPreview = async () => {
    if (!previewDataUrl) return;
    try {
      const res = await fetch(previewDataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
      handlePreviewClose();
    } catch (err) {
      console.error("Failed to copy image", err);
    }
  };

  const exportPdf = async () => {
    if (!previewDataUrl) return;

    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = previewDataUrl;
      });

      const width = img.width;
      const height = img.height;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);

      const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const base64Data = jpegDataUrl.split(",")[1];
      const jpegBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      const ptWidth = Math.round(width * 0.75);
      const ptHeight = Math.round(height * 0.75);

      const encoder = new TextEncoder();

      const header = `%PDF-1.4\n%\xFF\xFF\xFF\xFF\n`;
      const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
      const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
      const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Resources << /XObject << /I1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`;
      
      const streamContent = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /I1 Do Q\n`;
      const obj4 = `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`;
      
      const obj5Header = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`;
      const obj5Footer = `\nendstream\nendobj\n`;

      const parts: Uint8Array[] = [
        encoder.encode(header),
        encoder.encode(obj1),
        encoder.encode(obj2),
        encoder.encode(obj3),
        encoder.encode(obj4),
        encoder.encode(obj5Header),
        jpegBytes,
        encoder.encode(obj5Footer)
      ];

      let currentOffset = header.length;
      const offsets = [0];
      
      offsets.push(currentOffset);
      currentOffset += obj1.length;
      
      offsets.push(currentOffset);
      currentOffset += obj2.length;
      
      offsets.push(currentOffset);
      currentOffset += obj3.length;
      
      offsets.push(currentOffset);
      currentOffset += obj4.length;
      
      offsets.push(currentOffset);
      currentOffset += obj5Header.length + jpegBytes.length + obj5Footer.length;

      const xrefOffset = currentOffset;

      let xref = `xref\n0 6\n0000000000 65535 f \n`;
      for (let i = 1; i <= 5; i++) {
        xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
      }

      const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

      parts.push(encoder.encode(xref));
      parts.push(encoder.encode(trailer));

      const pdfBlob = new Blob(parts, { type: "application/pdf" });
      
      let baseName = document.title.trim() || window.location.hostname || "screenshot";
      const sanitized = baseName.replace(/[/\\?%*:|"<>]/g, "").replace(/\s+/g, "_").slice(0, 60);
      const now = new Date();
      const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
      const fileName = `${sanitized || "screenshot"}_${dateStamp}.pdf`;

      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.download = fileName;
      link.href = blobUrl;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

      handlePreviewClose();
    } catch (err) {
      console.error("Failed to export PDF:", err);
    }
  };

  const getCursor = () => {
    if (isTakingScreenshot) return "crosshair";
    if (tool === "select") return "default";
    if (tool === "eraser") return "cell";
    if (tool === "text") return "text";
    return "crosshair";
  };

  const toolBtn = (t: Tool, icon: React.ReactNode) => {
    const isActive = tool === t && !isTakingScreenshot;
    return (
      <button
        key={t}
        onClick={() => { setTool(t); setIsTakingScreenshot(false); }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "36px", height: "36px", borderRadius: "8px", border: "none", cursor: "pointer",
          background: isActive ? "#f1f5f9" : "transparent", color: isActive ? "#0f172a" : "#64748b",
          transition: "all 0.2s ease", boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.05) inset" : "none"
        }}
      >
        {icon}
      </button>
    );
  };

  return (
    <>
      {/* Full-screen draw canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 1999990,
          cursor: getCursor(), pointerEvents: tool === "select" && !isTakingScreenshot ? "none" : "all",
        }}
      />

      {/* Screenshot Overlay Region */}
      {isTakingScreenshot && screenshotStart && screenshotCurrent && (
        <div style={{
          position: "fixed", zIndex: 1999991, border: "2px solid #a855f7", backgroundColor: "rgba(168, 85, 247, 0.1)",
          left: Math.min(screenshotStart.x, screenshotCurrent.x), top: Math.min(screenshotStart.y, screenshotCurrent.y),
          width: Math.abs(screenshotCurrent.x - screenshotStart.x), height: Math.abs(screenshotCurrent.y - screenshotStart.y),
          pointerEvents: "none"
        }} />
      )}

      {/* Pending text input overlay */}
      {pendingText && (
        <div style={{ position: "fixed", top: pendingText.y - 14, left: pendingText.x, zIndex: 1999995, pointerEvents: "all" }}>
          <input
            ref={textInputRef} value={textInput} onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commitText(); if (e.key === "Escape") { setPendingText(null); setTextInput(""); } }}
            onBlur={commitText} placeholder="Type & press Enter…"
            style={{
              background: "transparent", color, border: "none", borderBottom: `2px dashed ${color}`,
              padding: "2px", fontSize: `${size * 4}px`, fontFamily: "Inter, sans-serif", outline: "none", minWidth: "120px",
            }}
          />
        </div>
      )}

      {/* Screenshot Preview Modal */}
      {previewDataUrl && (
        <div id="paint-screenshot-preview" style={{
          position: "fixed", inset: 0, zIndex: 2147483647, backgroundColor: "rgba(15, 23, 42, 0.88)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all",
          padding: "24px", boxSizing: "border-box"
        }}>
          <div style={{
            position: "relative",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "16px",
            maxWidth: "92vw", maxHeight: "92vh"
          }}>
            <img src={previewDataUrl} alt="Screenshot Preview" style={{
              maxWidth: "100%", maxHeight: "calc(88vh - 70px)",
              objectFit: "contain", borderRadius: "12px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.12)"
            }} />

            <div style={{
              display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", borderRadius: "16px",
              backgroundColor: "rgba(30, 41, 59, 0.95)", border: "1px solid rgba(255,255,255,0.15)",
              boxShadow: "0 20px 30px -10px rgba(0,0,0,0.5)"
            }}>
              <button onClick={downloadPreview} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #10b981, #059669)", color: "#ffffff", cursor: "pointer", transition: "all 0.15s ease", fontWeight: "600" }} title="Download PNG Image">
                <Download size={18} strokeWidth={2.2} />
                <span style={{ fontSize: "13px", fontFamily: "sans-serif" }}>PNG</span>
              </button>
              <button onClick={exportPdf} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#ffffff", cursor: "pointer", transition: "all 0.15s ease", fontWeight: "600" }} title="Export as PDF Document">
                <FileText size={18} strokeWidth={2.2} />
                <span style={{ fontSize: "13px", fontFamily: "sans-serif" }}>PDF</span>
              </button>
              <button onClick={copyPreview} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "10px", border: "none", background: "rgba(51, 65, 85, 0.8)", color: "#f8fafc", cursor: "pointer", transition: "all 0.15s ease", fontWeight: "500" }} title="Copy to Clipboard">
                <Copy size={18} strokeWidth={2} />
                <span style={{ fontSize: "13px", fontFamily: "sans-serif" }}>Copy</span>
              </button>
              <div style={{ width: "1px", height: "24px", backgroundColor: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
              <button onClick={handlePreviewClose} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "10px", border: "none", background: "rgba(239, 68, 68, 0.15)", color: "#f87171", cursor: "pointer", transition: "all 0.15s ease", fontWeight: "600" }} title="Close Preview">
                <X size={18} strokeWidth={2.5} />
                <span style={{ fontSize: "13px", fontFamily: "sans-serif" }}>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Paint Toolbar */}
      {(!initialAction && !isTakingScreenshot && !previewDataUrl) && (
        <div
          id="paint-toolbar"
          style={{
            position: "fixed", top: `${toolbarPos.y}px`, left: `${toolbarPos.x}px`, zIndex: 1999998,
            background: "#ffffff", borderRadius: "20px", padding: "20px 16px", display: "flex", flexDirection: "column", gap: "20px",
            boxShadow: "0 10px 40px rgba(0,0,0,0.08), 0 2px 10px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)",
            width: "104px", userSelect: "none", pointerEvents: "all", fontFamily: "Inter, sans-serif",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
            <div
              onMouseDown={startDrag}
              style={{ display: "flex", justifyContent: "center", color: "#e2e8f0", marginTop: "-12px", cursor: isDraggingToolbar ? "grabbing" : "grab" }}>
              <GripHorizontal size={24} strokeWidth={3} />
            </div>
            <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
              <span style={{ color: "#1e293b", fontSize: "15px", fontWeight: "700" }}>Paint</span>
              <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex", padding: "2px", marginLeft: "12px" }}><X size={18} strokeWidth={2.5} /></button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", justifyItems: "center" }}>
            {toolBtn("select", <MousePointer2 size={20} strokeWidth={1.5} />)}
            {toolBtn("text", <Type size={20} strokeWidth={1.5} />)}
            {toolBtn("pen", <PenTool size={20} strokeWidth={1.5} />)}
            {toolBtn("eraser", <Eraser size={20} strokeWidth={1.5} />)}
            {toolBtn("highlighter", <Highlighter size={20} strokeWidth={1.5} />)}
            {toolBtn("fill", <PaintBucket size={20} strokeWidth={1.5} />)}
            {toolBtn("curve", <CurveIcon />)}
            {toolBtn("squiggle", <SquiggleIcon />)}
            {toolBtn("line", <Minus size={20} strokeWidth={1.5} />)}
            {toolBtn("rect", <Square size={20} strokeWidth={1.5} />)}
            {toolBtn("ellipse", <Circle size={20} strokeWidth={1.5} />)}
            {toolBtn("triangle", <Triangle size={20} strokeWidth={1.5} />)}
            {toolBtn("polygon", <Hexagon size={20} strokeWidth={1.5} />)}
          </div>

          <div style={{ height: "1px", background: "#f1f5f9", margin: "0 -16px" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
            <span style={{ color: "#1e293b", fontSize: "13px", fontWeight: "600" }}>Color</span>
            <label style={{ position: "relative", cursor: "pointer" }} title="Pick color">
              <ColorWheelIcon color={color} />
              <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ position: "absolute", top: 0, left: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
            </label>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
            <span style={{ color: "#1e293b", fontSize: "12px", fontWeight: "600" }}>Transparency</span>
            <input
              type="range" min="0.05" max="1" step="0.05" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))}
              style={{ width: "90%", height: "6px", borderRadius: "3px", background: `linear-gradient(to right, #f1f5f9, ${color})`, WebkitAppearance: "none", outline: "none", cursor: "pointer" }}
            />
            <span style={{ color: "#64748b", fontSize: "11px", fontWeight: "500" }}>{Math.round(opacity * 100)}%</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
            <span style={{ color: "#1e293b", fontSize: "12px", fontWeight: "600" }}>Size</span>
            <input
              type="range" min="1" max="50" step="1" value={size} onChange={e => setSize(parseInt(e.target.value))}
              style={{ width: "90%", height: "6px", borderRadius: "3px", background: "#e2e8f0", WebkitAppearance: "none", outline: "none", cursor: "pointer" }}
            />
            <span style={{ color: "#64748b", fontSize: "11px", fontWeight: "500" }}>{Math.round((size / 50) * 100)}%</span>
          </div>

          <div style={{ height: "1px", background: "#f1f5f9", margin: "0 -16px" }} />

          <div style={{ display: "flex", justifyContent: "center", gap: "12px", alignItems: "center", padding: "0 4px" }}>
            <button onClick={clearAll} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", transition: "color 0.2s" }} title="Clear All"><Trash2 size={16} strokeWidth={1.5} /></button>
            <button onClick={startScreenshotRegion} style={{ background: "none", border: "none", color: isTakingScreenshot ? "#a855f7" : "#64748b", cursor: "pointer", transition: "color 0.2s" }} title="Area Screenshot"><Camera size={16} strokeWidth={1.5} /></button>
            <button onClick={takeFullScreenShot} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", transition: "color 0.2s" }} title="Visible Viewport Screenshot"><Monitor size={16} strokeWidth={1.5} /></button>
            <button onClick={takeFullPageScreenshot} style={{ background: "none", border: "none", color: isCapturingFullPage ? "#10b981" : "#64748b", cursor: "pointer", transition: "color 0.2s" }} title="Full Page Screenshot"><FileDown size={16} strokeWidth={1.5} /></button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 12px" }}>
            <button onClick={undo} disabled={!paths.length} style={{ background: "none", border: "none", color: paths.length ? "#64748b" : "#cbd5e1", cursor: paths.length ? "pointer" : "not-allowed", transition: "color 0.2s" }} title="Undo"><Undo2 size={18} strokeWidth={1.5} /></button>
            <button onClick={redo} disabled={!redoStack.length} style={{ background: "none", border: "none", color: redoStack.length ? "#64748b" : "#cbd5e1", cursor: redoStack.length ? "pointer" : "not-allowed", transition: "color 0.2s" }} title="Redo"><Redo2 size={18} strokeWidth={1.5} /></button>
          </div>
        </div>
      )}

      {/* Full Page Screenshot Progress Banner */}
      {isCapturingFullPage && (
        <div
          id="full-page-progress-banner"
          style={{
            position: "fixed",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483647,
            background: "rgba(15, 23, 42, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(16, 185, 129, 0.4)",
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: "14px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontFamily: "sans-serif",
            pointerEvents: "none"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px" }}>
            <Loader2 className="animate-spin text-emerald-400" size={22} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "13px", fontWeight: "700", letterSpacing: "0.02em", color: "#f8fafc" }}>Capturing Full Page...</span>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>Stitching document tiles... {fullPageProgress}%</span>
          </div>
          <div style={{ width: "90px", height: "6px", background: "#1e293b", borderRadius: "3px", overflow: "hidden", marginLeft: "6px" }}>
            <div style={{ width: `${fullPageProgress}%`, height: "100%", background: "linear-gradient(90deg, #10b981, #3b82f6)", transition: "width 0.15s ease-out" }} />
          </div>
        </div>
      )}
    </>
  );
};

export default PaintCanvas;
