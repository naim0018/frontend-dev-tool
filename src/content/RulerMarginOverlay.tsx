import React, { useState, useEffect, useCallback } from "react";
import { Ruler, Trash2, X, Circle as CircleIcon, Square, Magnet } from "lucide-react";

export interface Guide {
  id: string;
  type: "horizontal" | "vertical";
  position: number; // Y coordinate for horizontal, X coordinate for vertical
}

export interface MeasurementShape {
  id: string;
  type: "box" | "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  isSnapped?: boolean;
}

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface RulerMarginOverlayProps {
  active: boolean;
  onClose: () => void;
}

const RULER_SIZE = 26; // Width/height of the ruler bar in pixels

export const RulerMarginOverlay: React.FC<RulerMarginOverlayProps> = ({ active, onClose }) => {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [shapes, setShapes] = useState<MeasurementShape[]>([]);

  // Dragging new guide from ruler state
  const [draggingNewGuide, setDraggingNewGuide] = useState<{
    type: "horizontal" | "vertical";
    currentPos: number;
  } | null>(null);

  // Moving existing guide state
  const [movingGuideId, setMovingGuideId] = useState<string | null>(null);
  const [hoveredGuideId, setHoveredGuideId] = useState<string | null>(null);

  // Drawing box/circle shape state
  const [isDrawingShape, setIsDrawingShape] = useState(false);
  const [shapeStartPos, setShapeStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentShape, setCurrentShape] = useState<MeasurementShape | null>(null);
  
  // Modifier key states
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);

  // Moving existing shape state
  const [movingShape, setMovingShape] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Resizing existing shape state
  const [resizingShape, setResizingShape] = useState<{
    id: string;
    handle: ResizeHandle;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);

  // Hovered shape state
  const [hoveredShapeId, setHoveredShapeId] = useState<string | null>(null);

  // Track window dimensions
  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Listen for Shift & Ctrl key states
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.shiftKey) setIsShiftPressed(true);
      if (e.key === "Control" || e.ctrlKey) setIsCtrlPressed(true);
      if (e.key === "Escape" && active) {
        onClose();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftPressed(false);
      if (e.key === "Control") setIsCtrlPressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [active, onClose]);

  // Helper function to find closest DOM element to snap box bounds
  const findContentElementToSnap = useCallback(
    (
      mouseX: number,
      mouseY: number,
      startX?: number,
      startY?: number
    ): { x: number; y: number; width: number; height: number; tagName: string } | null => {
      const rulerRoot = document.getElementById("ruler-margin-canvas-root");
      const shadowHost = document.getElementById("accessibility-inspector-extension-root");

      // Temporarily set pointer-events none to query underlying DOM elements
      if (rulerRoot) rulerRoot.style.pointerEvents = "none";

      const elementsAtMouse = document.elementsFromPoint(mouseX, mouseY) as HTMLElement[];
      let startElements: HTMLElement[] = [];
      if (startX !== undefined && startY !== undefined) {
        startElements = document.elementsFromPoint(startX, startY) as HTMLElement[];
      }

      if (rulerRoot) rulerRoot.style.pointerEvents = "auto";

      const candidates = [...elementsAtMouse, ...startElements];

      for (const el of candidates) {
        if (!el || el === document.documentElement || el === document.body) continue;
        if (shadowHost && shadowHost.contains(el)) continue;
        if (el.id === "ruler-margin-canvas-root" || el.closest("#ruler-margin-canvas-root")) continue;
        if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        // Exclude outer full-page wrappers
        if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.96) continue;

        return {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          tagName: el.tagName.toLowerCase(),
        };
      }

      return null;
    },
    []
  );

  // Handle global mouse move for guide dragging, shape drawing, moving, and resizing
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!active) return;

      const mouseX = e.clientX;
      const mouseY = e.clientY;

      const ctrlHeld = e.ctrlKey || isCtrlPressed;
      const shiftHeld = e.shiftKey || isShiftPressed;

      // 1. Dragging new guide from ruler
      if (draggingNewGuide) {
        setDraggingNewGuide({
          ...draggingNewGuide,
          currentPos: draggingNewGuide.type === "horizontal" ? mouseY : mouseX,
        });
        return;
      }

      // 2. Moving existing guide
      if (movingGuideId) {
        setGuides((prev) =>
          prev.map((g) => {
            if (g.id === movingGuideId) {
              return {
                ...g,
                position: g.type === "horizontal" ? mouseY : mouseX,
              };
            }
            return g;
          })
        );
        return;
      }

      // 3. Moving existing shape
      if (movingShape) {
        let newX = mouseX - movingShape.offsetX;
        let newY = mouseY - movingShape.offsetY;

        if (ctrlHeld) {
          const snapped = findContentElementToSnap(mouseX, mouseY);
          if (snapped) {
            newX = snapped.x;
            newY = snapped.y;
          }
        }

        setShapes((prev) =>
          prev.map((s) => {
            if (s.id === movingShape.id) {
              return {
                ...s,
                x: newX,
                y: newY,
                isSnapped: ctrlHeld,
              };
            }
            return s;
          })
        );
        return;
      }

      // 4. Resizing existing shape
      if (resizingShape) {
        const dx = mouseX - resizingShape.startX;
        const dy = mouseY - resizingShape.startY;
        const { initialX, initialY, initialWidth, initialHeight, handle, id } = resizingShape;

        let newX = initialX;
        let newY = initialY;
        let newW = initialWidth;
        let newH = initialHeight;

        if (ctrlHeld) {
          const snapped = findContentElementToSnap(mouseX, mouseY);
          if (snapped) {
            newX = snapped.x;
            newY = snapped.y;
            newW = snapped.width;
            newH = snapped.height;
          }
        } else {
          if (handle.includes("e")) {
            newW = Math.max(10, initialWidth + dx);
          }
          if (handle.includes("s")) {
            newH = Math.max(10, initialHeight + dy);
          }
          if (handle.includes("w")) {
            newW = Math.max(10, initialWidth - dx);
            newX = initialX + initialWidth - newW;
          }
          if (handle.includes("n")) {
            newH = Math.max(10, initialHeight - dy);
            newY = initialY + initialHeight - newH;
          }
        }

        const targetShape = shapes.find((s) => s.id === id);
        if (targetShape?.type === "circle" || shiftHeld) {
          const size = Math.max(newW, newH);
          newW = size;
          newH = size;
          if (handle.includes("w")) newX = initialX + initialWidth - newW;
          if (handle.includes("n")) newY = initialY + initialHeight - newH;
        }

        setShapes((prev) =>
          prev.map((s) => {
            if (s.id === id) {
              return {
                ...s,
                x: newX,
                y: newY,
                width: newW,
                height: newH,
                isSnapped: ctrlHeld,
              };
            }
            return s;
          })
        );
        return;
      }

      // 5. Drawing new shape on canvas
      if (isDrawingShape && shapeStartPos) {
        if (ctrlHeld) {
          const snapped = findContentElementToSnap(mouseX, mouseY, shapeStartPos.x, shapeStartPos.y);
          if (snapped) {
            let w = snapped.width;
            let h = snapped.height;
            if (shiftHeld) {
              const size = Math.max(w, h);
              w = size;
              h = size;
            }
            setCurrentShape({
              id: "temp-shape",
              type: shiftHeld ? "circle" : "box",
              x: snapped.x,
              y: snapped.y,
              width: w,
              height: h,
              isSnapped: true,
            });
            return;
          }
        }

        const dx = mouseX - shapeStartPos.x;
        const dy = mouseY - shapeStartPos.y;

        let width = Math.abs(dx);
        let height = Math.abs(dy);
        let x = dx < 0 ? mouseX : shapeStartPos.x;
        let y = dy < 0 ? mouseY : shapeStartPos.y;

        if (shiftHeld) {
          // Constrain 1:1 for perfect circle/square
          const size = Math.max(width, height);
          width = size;
          height = size;
          if (dx < 0) x = shapeStartPos.x - size;
          if (dy < 0) y = shapeStartPos.y - size;
        }

        setCurrentShape({
          id: "temp-shape",
          type: shiftHeld ? "circle" : "box",
          x,
          y,
          width,
          height,
          isSnapped: false,
        });
      }
    },
    [
      active,
      draggingNewGuide,
      movingGuideId,
      movingShape,
      resizingShape,
      isDrawingShape,
      shapeStartPos,
      isShiftPressed,
      isCtrlPressed,
      shapes,
      findContentElementToSnap,
    ]
  );

  // Handle global mouse up
  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!active) return;

      const mouseX = e.clientX;
      const mouseY = e.clientY;

      // 1. Finish dragging new guide from ruler
      if (draggingNewGuide) {
        if (draggingNewGuide.type === "horizontal" && mouseY > RULER_SIZE) {
          setGuides((prev) => [
            ...prev,
            { id: `guide-${Date.now()}`, type: "horizontal", position: mouseY },
          ]);
        } else if (draggingNewGuide.type === "vertical" && mouseX > RULER_SIZE) {
          setGuides((prev) => [
            ...prev,
            { id: `guide-${Date.now()}`, type: "vertical", position: mouseX },
          ]);
        }
        setDraggingNewGuide(null);
        return;
      }

      // 2. Finish moving existing guide
      if (movingGuideId) {
        const guide = guides.find((g) => g.id === movingGuideId);
        if (guide) {
          // If dragged back into ruler, delete it
          if (
            (guide.type === "horizontal" && mouseY <= RULER_SIZE) ||
            (guide.type === "vertical" && mouseX <= RULER_SIZE)
          ) {
            setGuides((prev) => prev.filter((g) => g.id !== movingGuideId));
          }
        }
        setMovingGuideId(null);
        return;
      }

      // 3. Finish moving shape
      if (movingShape) {
        setMovingShape(null);
        return;
      }

      // 4. Finish resizing shape
      if (resizingShape) {
        setResizingShape(null);
        return;
      }

      // 5. Finish drawing shape
      if (isDrawingShape && currentShape) {
        if (currentShape.width > 4 && currentShape.height > 4) {
          setShapes((prev) => [
            ...prev,
            {
              ...currentShape,
              id: `shape-${Date.now()}`,
            },
          ]);
        }
        setIsDrawingShape(false);
        setShapeStartPos(null);
        setCurrentShape(null);
      }
    },
    [
      active,
      draggingNewGuide,
      movingGuideId,
      guides,
      movingShape,
      resizingShape,
      isDrawingShape,
      currentShape,
    ]
  );

  useEffect(() => {
    if (!active) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [active, handleMouseMove, handleMouseUp]);

  if (!active) return null;

  // Handle mousedown on Canvas to start drawing or Ctrl-snapping shapes
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only start shape drawing if clicked outside rulers & extension controls
    const target = e.target as HTMLElement;
    if (target.closest("#extension-ruler-control-bar") || target.closest(".ruler-bar")) return;

    // Check if clicking on an interactive element, button, or shape element
    if (target.closest("button") || target.closest("input") || target.closest(".measurement-shape-el")) return;

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    if (mouseX <= RULER_SIZE || mouseY <= RULER_SIZE) return;

    const ctrlHeld = e.ctrlKey || isCtrlPressed;
    const shiftHeld = e.shiftKey || isShiftPressed;

    if (ctrlHeld) {
      const snapped = findContentElementToSnap(mouseX, mouseY);
      if (snapped) {
        let w = snapped.width;
        let h = snapped.height;
        if (shiftHeld) {
          const size = Math.max(w, h);
          w = size;
          h = size;
        }
        const newShape: MeasurementShape = {
          id: `shape-${Date.now()}`,
          type: shiftHeld ? "circle" : "box",
          x: snapped.x,
          y: snapped.y,
          width: w,
          height: h,
          isSnapped: true,
        };
        setShapes((prev) => [...prev, newShape]);
        return;
      }
    }

    setIsDrawingShape(true);
    setShapeStartPos({ x: mouseX, y: mouseY });
    setCurrentShape({
      id: "temp-shape",
      type: shiftHeld ? "circle" : "box",
      x: mouseX,
      y: mouseY,
      width: 0,
      height: 0,
    });
  };

  // Generate tick marks for Top Ruler
  const renderTopRulerTicks = () => {
    const ticks: React.ReactNode[] = [];
    const step = 10;
    const count = Math.ceil(viewportSize.width / step);

    for (let i = 0; i < count; i++) {
      const pos = i * step;
      if (pos < RULER_SIZE) continue;

      const isMajor100 = pos % 100 === 0;
      const isMedium50 = pos % 50 === 0 && !isMajor100;
      const tickHeight = isMajor100 ? 12 : isMedium50 ? 8 : 4;

      ticks.push(
        <div
          key={`top-tick-${pos}`}
          style={{
            position: "absolute",
            left: `${pos}px`,
            bottom: 0,
            width: "1px",
            height: `${tickHeight}px`,
            backgroundColor: isMajor100 ? "#38bdf8" : isMedium50 ? "#94a3b8" : "#475569",
          }}
        >
          {isMajor100 && (
            <span
              style={{
                position: "absolute",
                top: "-14px",
                left: "2px",
                fontSize: "8px",
                fontFamily: "monospace",
                color: "#7dd3fc",
                fontWeight: 600,
                userSelect: "none",
                pointerEvents: "none",
              }}
            >
              {pos}
            </span>
          )}
          {isMedium50 && (
            <span
              style={{
                position: "absolute",
                top: "-14px",
                left: "2px",
                fontSize: "7.5px",
                fontFamily: "monospace",
                color: "#94a3b8",
                userSelect: "none",
                pointerEvents: "none",
              }}
            >
              {pos}
            </span>
          )}
        </div>
      );
    }
    return ticks;
  };

  // Generate tick marks for Left Ruler
  const renderLeftRulerTicks = () => {
    const ticks: React.ReactNode[] = [];
    const step = 10;
    const count = Math.ceil(viewportSize.height / step);

    for (let i = 0; i < count; i++) {
      const pos = i * step;
      if (pos < RULER_SIZE) continue;

      const isMajor100 = pos % 100 === 0;
      const isMedium50 = pos % 50 === 0 && !isMajor100;
      const tickWidth = isMajor100 ? 12 : isMedium50 ? 8 : 4;

      ticks.push(
        <div
          key={`left-tick-${pos}`}
          style={{
            position: "absolute",
            top: `${pos}px`,
            right: 0,
            height: "1px",
            width: `${tickWidth}px`,
            backgroundColor: isMajor100 ? "#38bdf8" : isMedium50 ? "#94a3b8" : "#475569",
          }}
        >
          {isMajor100 && (
            <span
              style={{
                position: "absolute",
                left: "2px",
                top: "-10px",
                fontSize: "8px",
                fontFamily: "monospace",
                color: "#7dd3fc",
                fontWeight: 600,
                userSelect: "none",
                pointerEvents: "none",
              }}
            >
              {pos}
            </span>
          )}
          {isMedium50 && (
            <span
              style={{
                position: "absolute",
                left: "2px",
                top: "-10px",
                fontSize: "7.5px",
                fontFamily: "monospace",
                color: "#94a3b8",
                userSelect: "none",
                pointerEvents: "none",
              }}
            >
              {pos}
            </span>
          )}
        </div>
      );
    }
    return ticks;
  };

  // Helper to render resize handle dot
  const renderResizeHandle = (shape: MeasurementShape, handle: ResizeHandle) => {
    let top = "0px";
    let left = "0px";
    let cursor = "nwse-resize";

    if (handle === "nw") {
      top = "-4px";
      left = "-4px";
      cursor = "nwse-resize";
    } else if (handle === "n") {
      top = "-4px";
      left = "calc(50% - 4px)";
      cursor = "ns-resize";
    } else if (handle === "ne") {
      top = "-4px";
      left = "calc(100% - 4px)";
      cursor = "nesw-resize";
    } else if (handle === "e") {
      top = "calc(50% - 4px)";
      left = "calc(100% - 4px)";
      cursor = "ew-resize";
    } else if (handle === "se") {
      top = "calc(100% - 4px)";
      left = "calc(100% - 4px)";
      cursor = "nwse-resize";
    } else if (handle === "s") {
      top = "calc(100% - 4px)";
      left = "calc(50% - 4px)";
      cursor = "ns-resize";
    } else if (handle === "sw") {
      top = "calc(100% - 4px)";
      left = "-4px";
      cursor = "nesw-resize";
    } else if (handle === "w") {
      top = "calc(50% - 4px)";
      left = "-4px";
      cursor = "ew-resize";
    }

    const isCircle = shape.type === "circle";
    const accentColor = isCircle ? "#c084fc" : "#38bdf8";

    return (
      <div
        key={handle}
        onMouseDown={(e) => {
          e.stopPropagation();
          setResizingShape({
            id: shape.id,
            handle,
            startX: e.clientX,
            startY: e.clientY,
            initialX: shape.x,
            initialY: shape.y,
            initialWidth: shape.width,
            initialHeight: shape.height,
          });
        }}
        style={{
          position: "absolute",
          top,
          left,
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: "#ffffff",
          border: `2px solid ${accentColor}`,
          boxShadow: `0 0 6px ${accentColor}`,
          cursor,
          zIndex: 999940,
        }}
        title={`Resize shape (${handle.toUpperCase()})`}
      />
    );
  };

  return (
    <div
      id="ruler-margin-canvas-root"
      onMouseDown={handleCanvasMouseDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999900,
        pointerEvents: "auto",
        cursor: isDrawingShape ? "crosshair" : movingShape ? "grabbing" : "default",
        userSelect: "none",
      }}
    >
      {/* ─── 1. TOP RULER ────────────────────────────────────────────────────────── */}
      <div
        className="ruler-bar"
        onMouseDown={(e) => {
          e.stopPropagation();
          setDraggingNewGuide({ type: "horizontal", currentPos: e.clientY });
        }}
        title="Click & drag down to pull a Horizontal Guide Line"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: `${RULER_SIZE}px`,
          backgroundColor: "#090d16",
          borderBottom: "1px solid #1e293b",
          zIndex: 999950,
          cursor: "ns-resize",
          boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}
      >
        {renderTopRulerTicks()}
      </div>

      {/* ─── 2. LEFT RULER ───────────────────────────────────────────────────────── */}
      <div
        className="ruler-bar"
        onMouseDown={(e) => {
          e.stopPropagation();
          setDraggingNewGuide({ type: "vertical", currentPos: e.clientX });
        }}
        title="Click & drag right to pull a Vertical Guide Line"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: `${RULER_SIZE}px`,
          backgroundColor: "#090d16",
          borderRight: "1px solid #1e293b",
          zIndex: 999950,
          cursor: "ew-resize",
          boxShadow: "1px 0 4px rgba(0,0,0,0.5)",
        }}
      >
        {renderLeftRulerTicks()}
      </div>

      {/* ─── 3. TOP-LEFT CORNER ─────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: `${RULER_SIZE}px`,
          height: `${RULER_SIZE}px`,
          backgroundColor: "#030712",
          borderRight: "1px solid #1e293b",
          borderBottom: "1px solid #1e293b",
          zIndex: 999960,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#38bdf8",
        }}
        title="Ruler & Alignment Guides"
      >
        <Ruler className="w-3.5 h-3.5" />
      </div>

      {/* ─── 4. CONTROL BAR (Top Floating HUD) ──────────────────────────────────── */}
      <div
        id="extension-ruler-control-bar"
        style={{
          position: "fixed",
          top: "36px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 999970,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "rgba(3, 7, 18, 0.92)",
          backdropFilter: "blur(12px)",
          border: "1px solid #1e293b",
          borderRadius: "12px",
          padding: "6px 14px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs font-bold text-slate-200 font-mono tracking-wide">
            Margin & Ruler Mode
          </span>
        </div>

        {/* Divider */}
        <div
          className="w-[1px] h-4 bg-slate-700/80 shrink-0"
          style={{ width: "1px", height: "16px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }}
        />

        {/* Counter Info & Modifier Key Pills */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1 pr-1">
            <span className="text-cyan-400 font-semibold">{guides.length}</span> Guides
          </span>
          <span className="flex items-center gap-1 pr-1">
            <span className="text-sky-400 font-semibold">{shapes.length}</span> Shapes
          </span>
          <span
            className={`px-1.5 py-0.5 rounded border text-[9px] transition-colors ${
              isShiftPressed
                ? "bg-purple-600/30 border-purple-500 text-purple-300 font-bold"
                : "bg-slate-900 border-slate-800 text-slate-400"
            }`}
          >
            Shift = Circle
          </span>
          <span
            className={`px-1.5 py-0.5 rounded border text-[9px] transition-colors flex items-center gap-1 ${
              isCtrlPressed
                ? "bg-cyan-600/30 border-cyan-400 text-cyan-300 font-bold"
                : "bg-slate-900 border-slate-800 text-slate-400"
            }`}
          >
            <Magnet className="w-3 h-3 text-cyan-400" />
            <span>Ctrl = Snap Content</span>
          </span>
        </div>

        {/* Divider */}
        <div
          className="w-[1px] h-4 bg-slate-700/80 shrink-0"
          style={{ width: "1px", height: "16px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }}
        />

        {/* Clear Buttons */}
        {guides.length > 0 && (
          <button
            onClick={() => setGuides([])}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[10px] font-mono transition-all cursor-pointer"
            title="Clear all straight guide lines"
          >
            <Trash2 className="w-3 h-3 text-cyan-400" />
            <span>Clear Guides</span>
          </button>
        )}

        {shapes.length > 0 && (
          <button
            onClick={() => setShapes([])}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[10px] font-mono transition-all cursor-pointer"
            title="Clear all drawn boxes & circles"
          >
            <Square className="w-3 h-3 text-sky-400" />
            <span>Clear Shapes</span>
          </button>
        )}

        <button
          onClick={onClose}
          className="p-1 rounded-md bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-800/80 text-slate-400 hover:text-rose-300 transition-all cursor-pointer ml-1"
          title="Exit Ruler Mode"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ─── 5. DRAWN GUIDES (HORIZONTAL & VERTICAL STRAIGHT LINES) ───────────── */}
      {guides.map((guide) => {
        const isHovered = hoveredGuideId === guide.id;
        const isMoving = movingGuideId === guide.id;

        if (guide.type === "horizontal") {
          return (
            <div
              key={guide.id}
              onMouseEnter={() => setHoveredGuideId(guide.id)}
              onMouseLeave={() => setHoveredGuideId(null)}
              onMouseDown={(e) => {
                e.stopPropagation();
                setMovingGuideId(guide.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setGuides((prev) => prev.filter((g) => g.id !== guide.id));
              }}
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                top: `${guide.position}px`,
                height: "5px",
                marginTop: "-2px",
                cursor: "ns-resize",
                zIndex: isMoving || isHovered ? 999940 : 999930,
              }}
            >
              {/* Visible Line */}
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  left: 0,
                  right: 0,
                  height: "1.5px",
                  backgroundColor: isHovered || isMoving ? "#38bdf8" : "#00f0ff",
                  boxShadow: isHovered || isMoving
                    ? "0 0 10px #38bdf8, 0 0 4px #38bdf8"
                    : "0 0 6px rgba(0, 240, 255, 0.7)",
                }}
              />

              {/* Coordinate Badge */}
              <div
                style={{
                  position: "absolute",
                  top: "-22px",
                  left: "40px",
                  backgroundColor: isHovered || isMoving ? "#0284c7" : "#090d16",
                  color: "#ffffff",
                  border: "1px solid #38bdf8",
                  borderRadius: "4px",
                  padding: "1px 6px",
                  fontSize: "9px",
                  fontFamily: "monospace",
                  fontWeight: "bold",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  pointerEvents: "none",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                }}
              >
                <span>Y: {Math.round(guide.position)}px</span>
                <span style={{ fontSize: "8px", opacity: 0.8 }}>(Double click to remove)</span>
              </div>
            </div>
          );
        } else {
          // Vertical guide line
          return (
            <div
              key={guide.id}
              onMouseEnter={() => setHoveredGuideId(guide.id)}
              onMouseLeave={() => setHoveredGuideId(null)}
              onMouseDown={(e) => {
                e.stopPropagation();
                setMovingGuideId(guide.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setGuides((prev) => prev.filter((g) => g.id !== guide.id));
              }}
              style={{
                position: "fixed",
                top: 0,
                bottom: 0,
                left: `${guide.position}px`,
                width: "5px",
                marginLeft: "-2px",
                cursor: "ew-resize",
                zIndex: isMoving || isHovered ? 999940 : 999930,
              }}
            >
              {/* Visible Line */}
              <div
                style={{
                  position: "absolute",
                  left: "2px",
                  top: 0,
                  bottom: 0,
                  width: "1.5px",
                  backgroundColor: isHovered || isMoving ? "#38bdf8" : "#00f0ff",
                  boxShadow: isHovered || isMoving
                    ? "0 0 10px #38bdf8, 0 0 4px #38bdf8"
                    : "0 0 6px rgba(0, 240, 255, 0.7)",
                }}
              />

              {/* Coordinate Badge */}
              <div
                style={{
                  position: "absolute",
                  left: "6px",
                  top: "40px",
                  backgroundColor: isHovered || isMoving ? "#0284c7" : "#090d16",
                  color: "#ffffff",
                  border: "1px solid #38bdf8",
                  borderRadius: "4px",
                  padding: "1px 6px",
                  fontSize: "9px",
                  fontFamily: "monospace",
                  fontWeight: "bold",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                }}
              >
                <span>X: {Math.round(guide.position)}px</span>
              </div>
            </div>
          );
        }
      })}

      {/* ─── 6. DRAGGING NEW GUIDE PREVIEW ──────────────────────────────────────── */}
      {draggingNewGuide && (
        <div
          style={{
            position: "fixed",
            zIndex: 999980,
            pointerEvents: "none",
            ...(draggingNewGuide.type === "horizontal"
              ? {
                  left: 0,
                  right: 0,
                  top: `${draggingNewGuide.currentPos}px`,
                  height: "1px",
                  backgroundColor: "#00f0ff",
                  boxShadow: "0 0 8px #00f0ff",
                }
              : {
                  top: 0,
                  bottom: 0,
                  left: `${draggingNewGuide.currentPos}px`,
                  width: "1px",
                  backgroundColor: "#00f0ff",
                  boxShadow: "0 0 8px #00f0ff",
                }),
          }}
        >
          <div
            style={{
              position: "absolute",
              ...(draggingNewGuide.type === "horizontal"
                ? { left: "50px", top: "-22px" }
                : { left: "10px", top: "50px" }),
              backgroundColor: "#0284c7",
              color: "#ffffff",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "10px",
              fontFamily: "monospace",
              fontWeight: "bold",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}
          >
            {draggingNewGuide.type === "horizontal"
              ? `Y: ${Math.round(draggingNewGuide.currentPos)}px`
              : `X: ${Math.round(draggingNewGuide.currentPos)}px`}
          </div>
        </div>
      )}

      {/* ─── 7. DRAWN MEASUREMENT SHAPES (BOXES & CIRCLES) ──────────────────────── */}
      {[...shapes, ...(currentShape ? [currentShape] : [])].map((shape) => {
        const isCircle = shape.type === "circle";
        const isTemp = shape.id === "temp-shape";
        const isHovered = hoveredShapeId === shape.id;
        const isMovingThis = movingShape?.id === shape.id;
        const isResizingThis = resizingShape?.id === shape.id;

        return (
          <div
            key={shape.id}
            className="measurement-shape-el"
            onMouseEnter={() => !isTemp && setHoveredShapeId(shape.id)}
            onMouseLeave={() => !isTemp && setHoveredShapeId(null)}
            onMouseDown={(e) => {
              if (isTemp) return;
              e.stopPropagation();
              setMovingShape({
                id: shape.id,
                offsetX: e.clientX - shape.x,
                offsetY: e.clientY - shape.y,
              });
            }}
            style={{
              position: "fixed",
              left: `${shape.x}px`,
              top: `${shape.y}px`,
              width: `${shape.width}px`,
              height: `${shape.height}px`,
              borderRadius: isCircle ? "50%" : "4px",
              border: `2px solid ${isCircle ? "#c084fc" : shape.isSnapped ? "#00f0ff" : "#38bdf8"}`,
              backgroundColor: isCircle
                ? "rgba(168, 85, 247, 0.16)"
                : shape.isSnapped
                ? "rgba(0, 240, 255, 0.14)"
                : "rgba(14, 165, 233, 0.16)",
              boxShadow: isCircle
                ? "0 0 12px rgba(168, 85, 247, 0.35)"
                : shape.isSnapped
                ? "0 0 14px rgba(0, 240, 255, 0.5)"
                : "0 0 12px rgba(56, 189, 248, 0.35)",
              zIndex: isTemp ? 999935 : isMovingThis || isResizingThis ? 999945 : 999920,
              pointerEvents: "auto",
              cursor: isTemp ? "crosshair" : isMovingThis ? "grabbing" : "grab",
              transition: isTemp ? "none" : "border-color 0.15s ease",
            }}
          >
            {/* Dimension Badge Header */}
            <div
              onMouseDown={(e) => {
                if (isTemp) return;
                e.stopPropagation();
                setMovingShape({
                  id: shape.id,
                  offsetX: e.clientX - shape.x,
                  offsetY: e.clientY - shape.y,
                });
              }}
              style={{
                position: "absolute",
                top: "-26px",
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: isCircle
                  ? "rgba(88, 28, 135, 0.95)"
                  : shape.isSnapped
                  ? "rgba(8, 47, 73, 0.95)"
                  : "rgba(3, 7, 18, 0.95)",
                color: "#ffffff",
                border: `1px solid ${isCircle ? "#c084fc" : shape.isSnapped ? "#38bdf8" : "#38bdf8"}`,
                borderRadius: "6px",
                padding: "2px 8px",
                fontSize: "10px",
                fontFamily: "monospace",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 4px 10px rgba(0,0,0,0.5)",
                pointerEvents: "auto",
                cursor: "grab",
              }}
            >
              {shape.isSnapped ? (
                <Magnet className="w-3 h-3 text-cyan-400" />
              ) : isCircle ? (
                <CircleIcon className="w-3 h-3 text-purple-300" />
              ) : (
                <Square className="w-3 h-3 text-sky-400" />
              )}
              <span>
                {Math.round(shape.width)}px × {Math.round(shape.height)}px
              </span>

              {!isTemp && (isHovered || isMovingThis || isResizingThis) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShapes((prev) => prev.filter((s) => s.id !== shape.id));
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#f43f5e",
                    cursor: "pointer",
                    padding: 0,
                    marginLeft: "2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Delete shape"
                >
                  <X className="w-3.5 h-3.5 hover:text-rose-400 transition-colors" />
                </button>
              )}
            </div>

            {/* 8 Perimeter Resize Handles */}
            {!isTemp &&
              (isHovered || isMovingThis || isResizingThis) &&
              (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as ResizeHandle[]).map((handle) =>
                renderResizeHandle(shape, handle)
              )}
          </div>
        );
      })}
    </div>
  );
};
