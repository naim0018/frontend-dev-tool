import React, { useEffect, useState, useRef, useCallback } from "react";
import { InspectorOverlay } from "./InspectorOverlay";
import { FloatingPanel } from "./FloatingPanel";
import { PaintCanvas } from "./PaintCanvas";
import { RulerMarginOverlay } from "./RulerMarginOverlay";
import { ElementStyles, extractElementStyles, parseColor } from "./styleExtractor";
import {
  MousePointer,
  Type,
  Palette,
  Image as ImageIcon,
  Layout,
  Power,  
  Pipette,
  X,
  Copy,
  Check,
  Grid,
  PenTool,
  Camera,
  Monitor,
  FileDown,
  GripVertical,
  Ruler
} from "lucide-react";

const isTextElement = (el: HTMLElement): boolean => {
  const shadowHost = document.getElementById("accessibility-inspector-extension-root");
  if (shadowHost && shadowHost.contains(el)) return false;

  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 3 && node.textContent && node.textContent.trim().length > 0) {
      if (/[a-zA-Z0-9]/.test(node.textContent)) {
        return true;
      }
    }
  }
  return false;
};
const isTransparentOverlay = (element: HTMLElement): boolean => {
  // If it's our extension container, bypass it
  const shadowHost = document.getElementById("accessibility-inspector-extension-root");
  if (shadowHost && shadowHost.contains(element)) return true;

  const style = window.getComputedStyle(element);
  const bg = style.backgroundColor;
  const isBgTransparent = bg === "transparent" || bg === "rgba(0, 0, 0, 0)" || bg.replace(/\s/g, "") === "rgba(0,0,0,0)";
  
  if (!isBgTransparent) return false;
  
  // If it has text content directly in its nodes (not just children)
  let hasText = false;
  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes[i];
    if (node.nodeType === 3 && node.textContent && node.textContent.trim().length > 0) {
      hasText = true;
      break;
    }
  }
  if (hasText) return false;
  
  // Check tags
  const tagName = element.tagName.toLowerCase();
  if (["img", "input", "button", "canvas", "svg", "video", "iframe"].includes(tagName)) return false;
  
  // Check borders
  const hasBorder = (parseFloat(style.borderTopWidth) > 0 && style.borderTopColor !== "transparent" && style.borderTopColor !== "rgba(0, 0, 0, 0)") ||
                    (parseFloat(style.borderRightWidth) > 0 && style.borderRightColor !== "transparent" && style.borderRightColor !== "rgba(0, 0, 0, 0)") ||
                    (parseFloat(style.borderBottomWidth) > 0 && style.borderBottomColor !== "transparent" && style.borderBottomColor !== "rgba(0, 0, 0, 0)") ||
                    (parseFloat(style.borderLeftWidth) > 0 && style.borderLeftColor !== "transparent" && style.borderLeftColor !== "rgba(0, 0, 0, 0)");
  if (hasBorder) return false;
  
  return true;
};

const isElementVisible = (el: HTMLElement, rect: DOMRect): boolean => {
  // 1. Viewport bounds check
  if (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  ) {
    return false;
  }

  // 2. CSS visibility/opacity check
  const style = window.getComputedStyle(el);
  if (style.opacity === "0" || style.visibility === "hidden" || style.display === "none") {
    return false;
  }

  // Check if the element itself is tiny (likely hidden or sr-only)
  const elRect = el.getBoundingClientRect();
  if (elRect.width <= 2 || elRect.height <= 2) {
    return false;
  }

  // Check if clip property visually hides it completely
  if (style.clip && (style.clip.includes("rect(0px, 0px, 0px, 0px)") || style.clip.includes("rect(0, 0, 0, 0)"))) {
    return false;
  }

  // 3. Overflow occlusion check (climbing the DOM tree)
  let parent = el.parentElement;
  while (parent) {
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.overflow !== "visible" && parentStyle.overflow !== "") {
      const parentRect = parent.getBoundingClientRect();
      if (parentRect.width <= 2 || parentRect.height <= 2) {
        return false;
      }
      if (
        rect.bottom <= parentRect.top ||
        rect.top >= parentRect.bottom ||
        rect.right <= parentRect.left ||
        rect.left >= parentRect.right
      ) {
        return false;
      }
    }
    parent = parent.parentElement;
  }

  // 4. Foreground occlusion check (is there another element covering it?)
  // We check the center of the text rect
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  if (centerX >= 0 && centerY >= 0 && centerX <= window.innerWidth && centerY <= window.innerHeight) {
    let topEl = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
    
    // If we hit a transparent empty overlay, temporarily bypass it to find the real element underneath
    const temporaryDisabledElements: HTMLElement[] = [];
    const seenElements = new Set<HTMLElement>();
    let attempts = 0;
    while (topEl && isTransparentOverlay(topEl) && attempts < 10) {
      if (seenElements.has(topEl)) {
        break;
      }
      seenElements.add(topEl);
      temporaryDisabledElements.push(topEl);
      if (topEl.style) {
        topEl.style.pointerEvents = "none";
      }
      topEl = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
      attempts++;
    }
    
    // Restore pointer events style immediately after checking
    temporaryDisabledElements.forEach(item => {
      if (item.style) {
        item.style.pointerEvents = "";
      }
    });

    if (topEl) {
      // Ignore our own extension root container
      const extensionRoot = document.getElementById("accessibility-inspector-extension-root");
      if (extensionRoot && (topEl === extensionRoot || extensionRoot.contains(topEl))) {
        return false;
      }

      // If the topmost element is not our element, nor a descendant, nor an ancestor,
      // it means some unrelated overlay element is covering it.
      if (topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        return false;
      }
    }
  }

  return true;
};

export const ContentApp: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(true); // Default to open on initial injection
  const [isOpen, setIsOpen] = useState(false); // Overlay starts closed
  const [inspectorActive, setInspectorActive] = useState(false);
  const [isEyedropperActive, setIsEyedropperActive] = useState(false);
  const [paintActive, setPaintActive] = useState(false);
  const [paintInitialAction, setPaintInitialAction] = useState<"area" | "full" | "fullpage" | undefined>(undefined);
  const [isScreenshotActive, setIsScreenshotActive] = useState(false);
  const [gridInspectorActive, setGridInspectorActive] = useState(false);
  const [marginInspectorActive, setMarginInspectorActive] = useState(false);
  const [showGridHoverBox, setShowGridHoverBox] = useState(true);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [lockedItems, setLockedItems] = useState<{ element: HTMLElement; styles: ElementStyles }[]>([]);
  const [focusedTab, setFocusedTab] = useState<"inspect" | "colors" | "fonts" | "images">("inspect");
  const [showContrastTooltips, setShowContrastTooltips] = useState(false);
  const [activeOverlayModes, setActiveOverlayModes] = useState<Set<"fontSize" | "fontWeight" | "fontFamily" | "lineHeight" | "tracking" | "textColor" | "contrast">>(new Set());
  const [fullPageTooltips, setFullPageTooltips] = useState<{
    id: string;
    top: number;
    left: number;
    segments: { value: string; bgColor: string }[];
  }[]>([]);
  const [hoveredTooltipId, setHoveredTooltipId] = useState<string | null>(null);

  // Movable Menu State
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [isMenuPositioned, setIsMenuPositioned] = useState(false);
  const [isDraggingMenu, setIsDraggingMenu] = useState(false);
  const menuDragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // Initial center bottom placement
    setMenuPos({
      x: window.innerWidth / 2 - 250, // rough estimate of half width
      y: 24 // 24px from bottom
    });
    setIsMenuPositioned(true);
  }, []);

  const startDragMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.tagName.toLowerCase() === 'input') return;
    setIsDraggingMenu(true);
    menuDragOffset.current = {
      x: e.clientX - menuPos.x,
      y: (window.innerHeight - e.clientY) - menuPos.y
    };
  };

  const onDragMenu = useCallback((e: MouseEvent) => {
    if (!isDraggingMenu) return;
    setMenuPos({
      x: Math.max(0, Math.min(window.innerWidth - 100, e.clientX - menuDragOffset.current.x)),
      y: Math.max(0, Math.min(window.innerHeight - 50, (window.innerHeight - e.clientY) - menuDragOffset.current.y))
    });
  }, [isDraggingMenu]);

  const endDragMenu = useCallback(() => setIsDraggingMenu(false), []);

  useEffect(() => {
    if (isDraggingMenu) {
      window.addEventListener('mousemove', onDragMenu);
      window.addEventListener('mouseup', endDragMenu);
    } else {
      window.removeEventListener('mousemove', onDragMenu);
      window.removeEventListener('mouseup', endDragMenu);
    }
    return () => {
      window.removeEventListener('mousemove', onDragMenu);
      window.removeEventListener('mouseup', endDragMenu);
    };
  }, [isDraggingMenu, onDragMenu, endDragMenu]);

  // Text Inspector States
  const [textInspectorActive, setTextInspectorActive] = useState(false);
  const [hoveredTextElement, setHoveredTextElement] = useState<HTMLElement | null>(null);
  const [hoveredTextStyles, setHoveredTextStyles] = useState<ElementStyles | null>(null);
  const [selectedTextElements, setSelectedTextElements] = useState<{ id: string; element: HTMLElement; styles: ElementStyles; textContent: string }[]>([]);
  const [activeSelectedTextId, setActiveSelectedTextId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Automatically clear all inspection states when the extension menu is closed
  useEffect(() => {
    if (!isMenuOpen) {
      setInspectorActive(false);
      setGridInspectorActive(false);
      setTextInspectorActive(false);
      setIsOpen(false);
      setShowContrastTooltips(false);
      setActiveOverlayModes(new Set());
    }
  }, [isMenuOpen]);
  const [selectedColor, setSelectedColorState] = useState<string>("");
  const [colorPickerHoveredElement, setColorPickerHoveredElement] = useState<HTMLElement | null>(null);
  const [colorPickerColorHex, setColorPickerColorHex] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const imageScaleRef = useRef<number>(1);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const normalizeToHex = (colorStr: string): string => {
    if (!colorStr) return "";
    const clean = colorStr.trim();
    if (clean.startsWith("#") && (clean.length === 7 || clean.length === 4)) {
      return clean.toUpperCase();
    }
    const parsed = parseColor(clean);
    if (parsed && !isNaN(parsed.r)) {
      const r = Math.round(parsed.r).toString(16).padStart(2, "0");
      const g = Math.round(parsed.g).toString(16).padStart(2, "0");
      const b = Math.round(parsed.b).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`.toUpperCase();
    }
    return clean;
  };

  const setSelectedColor = (color: string) => {
    setSelectedColorState(normalizeToHex(color));
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        fallbackCopyText(text);
      });
    } else {
      fallbackCopyText(text);
    }
  };

  const fallbackCopyText = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
    } catch (err) {
      console.warn("Fallback copy failed:", err);
    }
    document.body.removeChild(textArea);
  };

  const handleCopyField = (fieldName: string, value: string) => {
    copyToClipboard(value);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1500);
  };

  // Sync state and respond to messages from popup or background scripts
  useEffect(() => {
    const handleMessage = (
      message: any,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      const action = message.action;

      if (action === "query-status") {
        sendResponse({ inspectorActive, gridInspectorActive, isOpen, isMenuOpen });
      } else if (action === "toggle-extension") {
        const next = !isMenuOpen;
        setIsMenuOpen(next);
        if (!next) {
          setIsOpen(false);
          setInspectorActive(false);
          setGridInspectorActive(false);
          setTextInspectorActive(false);
          setShowContrastTooltips(false);
          setActiveOverlayModes(new Set());
        }
        sendResponse({ isMenuOpen: next });
      } else if (action === "toggle-inspector") {
        const nextState = !inspectorActive;
        setInspectorActive(nextState);
        setGridInspectorActive(false);
        if (nextState) setHoveredElement(null);
        sendResponse({ inspectorActive: nextState });
      } else if (action === "toggle-grid-inspector") {
        const nextState = !gridInspectorActive;
        setGridInspectorActive(nextState);
        setInspectorActive(false);
        setTextInspectorActive(false);
        if (nextState) setHoveredElement(null);
        sendResponse({ gridInspectorActive: nextState });
      } else if (action === "activate-eyedropper") {
        triggerNativeEyeDropper();
        sendResponse({ status: "eyedropper-triggered" });
      } else if (action === "open-colors") {
        setIsOpen(true);
        setFocusedTab("colors");
        sendResponse({ status: "colors-opened" });
      } else if (action === "open-fonts") {
        setIsOpen(true);
        setFocusedTab("fonts");
        sendResponse({ status: "fonts-opened" });
      } else if (action === "open-images") {
        setIsOpen(true);
        setFocusedTab("images");
        sendResponse({ status: "images-opened" });
      } else if (action === "trigger-fullpage-screenshot") {
        setPaintInitialAction("fullpage");
        setPaintActive(true);
        setInspectorActive(false);
        setGridInspectorActive(false);
        setTextInspectorActive(false);
        sendResponse({ status: "fullpage-triggered" });
      } else if (action === "trigger-viewport-screenshot") {
        setPaintInitialAction("full");
        setPaintActive(true);
        setInspectorActive(false);
        setGridInspectorActive(false);
        setTextInspectorActive(false);
        sendResponse({ status: "viewport-triggered" });
      } else if (action === "trigger-area-screenshot") {
        setPaintInitialAction("area");
        setPaintActive(true);
        setInspectorActive(false);
        setGridInspectorActive(false);
        setTextInspectorActive(false);
        sendResponse({ status: "area-triggered" });
      } else if (action === "toggle-sidebar") {
        const nextOpen = !isOpen;
        setIsOpen(nextOpen);
        sendResponse({ isOpen: nextOpen });
      } else {
        sendResponse({ status: "unknown" });
      }
      return true;
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [inspectorActive, gridInspectorActive, isOpen, isMenuOpen]);

  // DOM Color Picker mode inside content script
  const triggerNativeEyeDropper = () => {
    if (isEyedropperActive) {
      setIsEyedropperActive(false);
      setColorPickerHoveredElement(null);
      setColorPickerColorHex(null);
      setScreenshotDataUrl(null);
      imageDataRef.current = null;
      return;
    }
    setInspectorActive(false);
    setTextInspectorActive(false);
    setIsEyedropperActive(true); // Hide the floating panel instantly

    // Wait for React to render the hidden state and browser to paint it
    setTimeout(() => {
      // Request a screenshot for the pixel magnifier
      chrome.runtime.sendMessage({ action: "capture-tab" }, (response) => {
        if (response && response.dataUrl) {
          setScreenshotDataUrl(response.dataUrl);

          // Parse the image data to allow instant precise pixel color lookups
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              imageDataRef.current = ctx.getImageData(0, 0, img.width, img.height);
              imageScaleRef.current = img.width / window.innerWidth;
              sourceCanvasRef.current = canvas;
            }
          };
          img.src = response.dataUrl;
        }
      });
    }, 50);
  };

  // Hover handler for DOM Color Picker
  useEffect(() => {
    if (!isEyedropperActive) {
      setColorPickerHoveredElement(null);
      setColorPickerColorHex(null);
      return;
    }

    // Set cursor to crosshair during color picking
    const styleEl = document.createElement("style");
    styleEl.id = "accessibility-inspector-eyedropper-cursor";
    styleEl.textContent = `
      * {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(styleEl);

    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });

      const target = e.target as HTMLElement;
      if (!target) return;

      const shadowHost = document.getElementById("accessibility-inspector-extension-root");
      if (shadowHost && shadowHost.contains(target)) {
        setColorPickerHoveredElement(null);
        setColorPickerColorHex(null);
        return;
      }

      setColorPickerHoveredElement(target);

      if (imageDataRef.current) {
        const scale = imageScaleRef.current;
        // e.clientX/Y are relative to viewport, same as the screenshot canvas
        const x = Math.floor(e.clientX * scale);
        const y = Math.floor(e.clientY * scale);

        const data = imageDataRef.current.data;
        const width = imageDataRef.current.width;
        const index = (y * width + x) * 4;

        if (index >= 0 && index < data.length) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];

          const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
          setColorPickerColorHex(hex);
        } else {
          setColorPickerColorHex(null);
        }

        // Draw pixel-perfect preview
        if (sourceCanvasRef.current && previewCanvasRef.current) {
          const previewCtx = previewCanvasRef.current.getContext("2d");
          if (previewCtx) {
            previewCtx.imageSmoothingEnabled = false;
            // Clear canvas
            previewCtx.clearRect(0, 0, 120, 120);

            // We want to sample a 15x15 region around the mouse and scale it to 120x120 (8x scale)
            const regionSize = 15;
            const srcX = x - regionSize / 2;
            const srcY = y - regionSize / 2;

            previewCtx.drawImage(
              sourceCanvasRef.current,
              srcX, srcY, regionSize, regionSize,
              0, 0, 120, 120
            );
          }
        }
      } else {
        setColorPickerColorHex(null);
      }
    };

    const handleMouseLeave = () => {
      setColorPickerHoveredElement(null);
      setColorPickerColorHex(null);
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.getElementById("accessibility-inspector-eyedropper-cursor")?.remove();
    };
  }, [isEyedropperActive]);

  // Click/mouse handler for DOM Color Picker
  useEffect(() => {
    if (!isEyedropperActive) return;

    const handleEyedropperInteraction = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const shadowHost = document.getElementById("accessibility-inspector-extension-root");
      if (shadowHost && shadowHost.contains(target)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.type === "click") {
        if (colorPickerColorHex) {
          setSelectedColor(colorPickerColorHex);
          setIsOpen(true);
          setFocusedTab("colors");
        }

        setIsEyedropperActive(false);
        setColorPickerHoveredElement(null);
        setColorPickerColorHex(null);
      }
    };

    document.addEventListener("click", handleEyedropperInteraction, true);
    document.addEventListener("mousedown", handleEyedropperInteraction, true);
    document.addEventListener("mouseup", handleEyedropperInteraction, true);
    return () => {
      document.removeEventListener("click", handleEyedropperInteraction, true);
      document.removeEventListener("mousedown", handleEyedropperInteraction, true);
      document.removeEventListener("mouseup", handleEyedropperInteraction, true);
    };
  }, [isEyedropperActive, colorPickerColorHex]);

  // Listen for keyboard shortcuts when menu is open
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement).isContentEditable
      )) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "m") {
        e.preventDefault();
        setInspectorActive(prev => !prev);
        setGridInspectorActive(false);
        setTextInspectorActive(false);
      } else if (key === "l") {
        e.preventDefault();
        setGridInspectorActive(prev => !prev);
        setInspectorActive(false);
        setTextInspectorActive(false);
      } else if (key === "e") {
        e.preventDefault();
        triggerNativeEyeDropper();
      } else if (key === "t") {
        e.preventDefault();
        setTextInspectorActive(prev => !prev);
        setInspectorActive(false);
        setGridInspectorActive(false);
      } else if (key === "i") {
        e.preventDefault();
        setFocusedTab("inspect");
        setIsOpen(true);
      } else if (key === "c") {
        e.preventDefault();
        setFocusedTab("colors");
        setIsOpen(true);
      } else if (key === "f") {
        e.preventDefault();
        setFocusedTab("fonts");
        setIsOpen(true);
      } else if (key === "g") {
        e.preventDefault();
        setFocusedTab("images");
        setIsOpen(true);
      } else if (key === "v") {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (key === "q") {
        e.preventDefault();
        setIsMenuOpen(false);
        setIsOpen(false);
        setInspectorActive(false);
        setGridInspectorActive(false);
        setTextInspectorActive(false);
        setShowContrastTooltips(false);
        setActiveOverlayModes(new Set());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen, gridInspectorActive]);

  // Hover handler for Text Inspector
  useEffect(() => {
    if (!textInspectorActive) {
      setHoveredTextElement(null);
      setHoveredTextStyles(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      if (isTextElement(target)) {
        setHoveredTextElement(target);
        try {
          const styles = extractElementStyles(target);
          setHoveredTextStyles(styles);
        } catch {
          setHoveredTextStyles(null);
        }
      } else {
        setHoveredTextElement(null);
        setHoveredTextStyles(null);
      }
    };

    const handleMouseLeave = () => {
      setHoveredTextElement(null);
      setHoveredTextStyles(null);
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [textInspectorActive]);

  // Click/mouse handler for Text Inspector (select multiple elements)
  useEffect(() => {
    if (!textInspectorActive) return;

    const handleTextInteraction = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const shadowHost = document.getElementById("accessibility-inspector-extension-root");
      if (shadowHost && shadowHost.contains(target)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.type === "click" && isTextElement(target)) {
        const alreadySelected = selectedTextElements.some(item => item.element === target);
        if (!alreadySelected) {
          try {
            const styles = extractElementStyles(target);
            const textContent = target.textContent?.trim().slice(0, 20) || "Text Element";
            const id = `text-el-${Date.now()}`;
            setSelectedTextElements(prev => [...prev, { id, element: target, styles, textContent }]);
            setActiveSelectedTextId(id);
          } catch (err) {
            console.warn("Failed style extraction on text click:", err);
          }
        } else {
          const item = selectedTextElements.find(item => item.element === target);
          if (item) {
            setActiveSelectedTextId(item.id);
          }
        }
      }
    };

    document.addEventListener("click", handleTextInteraction, true);
    document.addEventListener("mousedown", handleTextInteraction, true);
    document.addEventListener("mouseup", handleTextInteraction, true);
    return () => {
      document.removeEventListener("click", handleTextInteraction, true);
      document.removeEventListener("mousedown", handleTextInteraction, true);
      document.removeEventListener("mouseup", handleTextInteraction, true);
    };
  }, [textInspectorActive, selectedTextElements]);

  // Inject global grid inspector outlines when active
  useEffect(() => {
    if (!gridInspectorActive) return;

    const styleEl = document.createElement("style");
    styleEl.id = "accessibility-inspector-global-grid-styles";
    styleEl.innerHTML = `
      body *:not(#accessibility-inspector-extension-root):not(#accessibility-inspector-extension-root *) {
        outline: 1px solid rgba(239, 68, 68, 0.25) !important;
        outline-offset: -1px !important;
      }
    `;
    document.head.appendChild(styleEl);

    return () => {
      const el = document.getElementById("accessibility-inspector-global-grid-styles");
      if (el) {
        el.remove();
      }
    };
  }, [gridInspectorActive]);

  // Document hover handler (works even if sidebar is closed)
  useEffect(() => {
    if (!inspectorActive && !gridInspectorActive) {
      setHoveredElement(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Ignore our extension container
      const shadowHost = document.getElementById("accessibility-inspector-extension-root");
      if (shadowHost && shadowHost.contains(target)) {
        setHoveredElement(null);
        return;
      }

      setHoveredElement(target);
    };

    const handleMouseLeave = () => {
      setHoveredElement(null);
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [inspectorActive, gridInspectorActive]);

  // Document click/mouse handler (locks element and auto-opens sidebar to inspect tab)
  useEffect(() => {
    if (!inspectorActive && !gridInspectorActive) return;

    const handleMouseInteraction = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const shadowHost = document.getElementById("accessibility-inspector-extension-root");
      if (shadowHost && shadowHost.contains(target)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Only perform locking on actual click event
      if (e.type === "click") {
        const alreadyLocked = lockedItems.some(item => item.element === target);
        if (!alreadyLocked) {
          try {
            const styles = extractElementStyles(target);
            setLockedItems(prev => [...prev, { element: target, styles }]);
            setFocusedTab("inspect");
            setIsOpen(true); // Always open panel when an element is locked
          } catch (err) {
            console.warn("Failed style extraction on click", err);
          }
        }
        setHoveredElement(null);
      }
    };

    document.addEventListener("click", handleMouseInteraction, true);
    document.addEventListener("mousedown", handleMouseInteraction, true);
    document.addEventListener("mouseup", handleMouseInteraction, true);
    return () => {
      document.removeEventListener("click", handleMouseInteraction, true);
      document.removeEventListener("mousedown", handleMouseInteraction, true);
      document.removeEventListener("mouseup", handleMouseInteraction, true);
    };
  }, [inspectorActive, gridInspectorActive, lockedItems]);

  const handleClearAllLocked = () => {
    setLockedItems([]);
  };

  const handleRemoveLockedItem = (element: HTMLElement) => {
    setLockedItems(prev => prev.filter(item => item.element !== element));
  };

  const MODE_CONFIG: Record<string, { bgColor: (styles: ReturnType<typeof extractElementStyles>) => string; getValue: (styles: ReturnType<typeof extractElementStyles>) => string }> = {
    fontSize: { bgColor: () => "#1e3a8a", getValue: s => s.fontSize },
    fontWeight: { bgColor: () => "#3730a3", getValue: s => s.fontWeight },
    fontFamily: { bgColor: () => "#4c1d95", getValue: s => { const v = s.fontFamilyChain[0] || s.fontFamily; return v.length > 15 ? v.substring(0, 12) + "..." : v; } },
    lineHeight: { bgColor: () => "#9a3412", getValue: s => s.lineHeight === "normal" ? "normal" : s.lineHeight },
    tracking: { bgColor: () => "#701a75", getValue: s => s.letterSpacing === "normal" ? "0px" : s.letterSpacing },
    textColor: { bgColor: () => "#0f766e", getValue: s => s.color },
    contrast: {
      bgColor: s => {
        const isLargeText = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.6 && parseInt(s.fontWeight, 10) >= 700);
        return (isLargeText ? s.contrastRatio >= 3.0 : s.contrastRatio >= 4.5) ? "#064e3b" : "#7f1d1d";
      }, getValue: s => `${s.contrastRatio.toFixed(1)}:1`
    },
  };

  const scanFullPageTooltips = () => {
    if (activeOverlayModes.size === 0) {
      setFullPageTooltips([]);
      return;
    }

    const allElements = Array.from(document.querySelectorAll("*")) as HTMLElement[];
    const shadowHost = document.getElementById("accessibility-inspector-extension-root");
    const activeModes = Array.from(activeOverlayModes);

    const tooltips: { id: string; top: number; left: number; segments: { value: string; bgColor: string }[] }[] = [];

    allElements.forEach((el, idx) => {
      if (shadowHost && shadowHost.contains(el)) return;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;

      // Find the first non-empty direct text node that contains letters or numbers
      let firstTextNode: Text | null = null;
      for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === 3 && node.textContent && node.textContent.trim().length > 0) {
          if (/[a-zA-Z0-9]/.test(node.textContent)) {
            firstTextNode = node as Text;
            break;
          }
        }
      }

      if (firstTextNode) {
        try {
          // Use Range to get the actual text bounding box (not the element box)
          const range = document.createRange();
          range.selectNode(firstTextNode);
          const textRect = range.getBoundingClientRect();
          if (textRect.width < 2 || textRect.height < 2) return;

          // Check if element is currently visible to the user
          if (!isElementVisible(el, textRect)) return;

          const styles = extractElementStyles(el);

          // One container per element – all active modes shown side by side
          const segments = activeModes.map(mode => ({
            value: MODE_CONFIG[mode].getValue(styles),
            bgColor: MODE_CONFIG[mode].bgColor(styles),
          }));

          tooltips.push({
            id: `fp-tooltip-${idx}`,
            // Center over the actual text, not the full element width
            top: textRect.top - 24,
            left: textRect.left + textRect.width / 2,
            segments,
          });
        } catch {
          // ignore
        }
      }
    });

    setFullPageTooltips(tooltips);
  };

  useEffect(() => {
    if (activeOverlayModes.size === 0) {
      setFullPageTooltips([]);
      return;
    }

    scanFullPageTooltips();

    let scrollTimeout: number;
    const handleScrollOrResize = () => {
      cancelAnimationFrame(scrollTimeout);
      scrollTimeout = requestAnimationFrame(() => {
        scanFullPageTooltips();
      });
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize, true);

    const observer = new MutationObserver(() => {
      handleScrollOrResize();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize, true);
      observer.disconnect();
      cancelAnimationFrame(scrollTimeout);
    };
  }, [activeOverlayModes]);

  // Track mouse coordinates to detect which tooltip is hovered, since tooltips have pointer-events: none
  useEffect(() => {
    if (activeOverlayModes.size === 0 || fullPageTooltips.length === 0) {
      setHoveredTooltipId(null);
      return;
    }

    let frameId: number;
    const handleMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const x = e.clientX;
        const y = e.clientY;
        let foundId: string | null = null;

        const shadowHost = document.getElementById("accessibility-inspector-extension-root");
        const shadowRoot = shadowHost?.shadowRoot;

        for (let i = 0; i < fullPageTooltips.length; i++) {
          const tip = fullPageTooltips[i];
          const el = shadowRoot ? shadowRoot.getElementById(tip.id) : null;
          if (el) {
            const rect = el.getBoundingClientRect();
            // Check if cursor is within the tooltip bounds (with a tiny 2px padding for better user feel)
            if (
              x >= rect.left - 2 &&
              x <= rect.right + 2 &&
              y >= rect.top - 2 &&
              y <= rect.bottom + 2
            ) {
              foundId = tip.id;
              break;
            }
          }
        }
        setHoveredTooltipId(foundId);
      });
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(frameId);
    };
  }, [fullPageTooltips, activeOverlayModes]);

  // Synchronize showContrastTooltips with activeOverlayModes
  useEffect(() => {
    if (showContrastTooltips) {
      setActiveOverlayModes(prev => { const next = new Set(prev); next.add("contrast"); return next; });
    } else {
      setActiveOverlayModes(prev => { const next = new Set(prev); next.delete("contrast"); return next; });
    }
  }, [showContrastTooltips]);

  useEffect(() => {
    setShowContrastTooltips(activeOverlayModes.has("contrast"));
  }, [activeOverlayModes]);

  // Turn off contrast tooltips if the user navigates away from the fonts/colors tab
  useEffect(() => {
    if (focusedTab !== "fonts" && focusedTab !== "colors") {
      setActiveOverlayModes(prev => { const next = new Set(prev); next.delete("contrast"); return next; });
    }
  }, [focusedTab]);

  // Turn off overlay modes if the text inspector becomes inactive
  useEffect(() => {
    if (!textInspectorActive) {
      setActiveOverlayModes(new Set());
    }
  }, [textInspectorActive]);

  // Reset ALL inspector state when the menu is closed so it opens fresh
  useEffect(() => {
    if (!isMenuOpen) {
      setInspectorActive(false);
      setGridInspectorActive(false);
      setTextInspectorActive(false);
      setMarginInspectorActive(false);
      setLockedItems([]);
      setHoveredElement(null);
      setHoveredTextElement(null);
      setHoveredTextStyles(null);
      setSelectedTextElements([]);
      setActiveSelectedTextId(null);
      setIsOpen(false);
      setActiveOverlayModes(new Set());
      setShowContrastTooltips(false);
      setIsEyedropperActive(false);
      setColorPickerHoveredElement(null);
      setColorPickerColorHex(null);
      setPaintActive(false);
    }
  }, [isMenuOpen]);

  return (
    <>
      {isMenuOpen && (
        <>
          {/* Hover Outline - Active even when panel is closed */}
          {inspectorActive && hoveredElement && (
            <InspectorOverlay element={hoveredElement} />
          )}

          {/* Grid Inspector Overlay */}
          {gridInspectorActive && hoveredElement && showGridHoverBox && (
            <InspectorOverlay element={hoveredElement} mode="grid" />
          )}

          {/* Paint / Annotation Canvas */}
          {paintActive && <PaintCanvas onClose={() => { setPaintActive(false); setPaintInitialAction(undefined); setIsScreenshotActive(false); }} initialAction={paintInitialAction} onScreenshotModeChange={setIsScreenshotActive} />}

          {/* Margin & Ruler Canvas Overlay */}
          <RulerMarginOverlay active={marginInspectorActive} onClose={() => setMarginInspectorActive(false)} />

          {/* Selected Element Outlines - Persistent if selection locked */}
          {lockedItems.map((item, idx) => (
            <InspectorOverlay
              key={`locked-${idx}-${item.element.tagName}`}
              element={item.element}
              borderColor="#10b981"
              backgroundColor="rgba(16, 185, 129, 0.04)"
              label={`selected: ${item.element.tagName.toLowerCase()}`}
              interactive={true}
              onClose={() => handleRemoveLockedItem(item.element)}
            />
          ))}

          {/* Hover Outline for Text Inspector */}
          {textInspectorActive && hoveredTextElement && (
            <InspectorOverlay
              element={hoveredTextElement}
              borderColor="#3b82f6"
              backgroundColor="rgba(59, 130, 246, 0.05)"
              label="text element"
              showPopover={false}
            />
          )}

          {/* DOM Color Picker Overlay */}
          {isEyedropperActive && colorPickerHoveredElement && (
            <InspectorOverlay
              element={colorPickerHoveredElement}
              borderColor={colorPickerColorHex || "#ef4444"}
              backgroundColor="transparent"
              borderStyle="solid"
              label={colorPickerColorHex ? `Color: ${colorPickerColorHex}` : "Picking..."}
              showPopover={false}
            />
          )}

          {/* Eyedropper Magnifier Preview */}
          {isEyedropperActive && cursorPos && (
            <div
              style={{
                position: "fixed",
                top: cursorPos.y,
                left: cursorPos.x,
                transform: "translate(15px, 15px)", // Offset to bottom-right of cursor
                zIndex: 2147483647,
                pointerEvents: "none",
              }}
            >
              {/* The zoom circle */}
              <div
                style={{
                  width: "120px",
                  height: "120px",
                  borderRadius: "50%",
                  backgroundColor: screenshotDataUrl ? undefined : (colorPickerColorHex || "#ffffff"),
                  border: "4px solid rgba(0, 0, 0, 0.1)",
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.1), 0 16px 32px rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  overflow: "hidden"
                }}
              >
                {/* The pixel-perfect preview canvas */}
                <canvas
                  ref={previewCanvasRef}
                  width={120}
                  height={120}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    imageRendering: "pixelated",
                    pointerEvents: "none"
                  }}
                />
                {/* The center pixel indicator */}
                <div style={{ position: "relative", zIndex: 10, width: "8px", height: "8px", border: "1px solid white", boxShadow: "0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.5)" }} />

                {/* Eyedropper floating icon */}
                <div
                  className="absolute bg-slate-900 text-blue-400 rounded-full flex items-center justify-center shadow-xl border border-slate-700"
                  style={{ width: "32px", height: "32px", bottom: "-4px", right: "-4px" }}
                >
                  <Pipette className="w-4 h-4" />
                </div>
              </div>
            </div>
          )}

          {/* Selected Text Outlines */}
          {textInspectorActive && selectedTextElements.map((item) => (
            <InspectorOverlay
              key={item.id}
              element={item.element}
              borderColor="#3b82f6"
              borderStyle="dashed"
              backgroundColor="rgba(59, 130, 246, 0.02)"
              label={`selected text: ${item.textContent}`}
              interactive={true}
              showPopover={false}
              onClose={() => {
                setSelectedTextElements(prev => prev.filter(x => x.id !== item.id));
                if (activeSelectedTextId === item.id) {
                  setActiveSelectedTextId(null);
                }
              }}
            />
          ))}

          {/* Full Page Visual Overlay Tooltips – one container per element, chips side-by-side */}
          {activeOverlayModes.size > 0 && fullPageTooltips.map((tip) => {
            const isHovered = hoveredTooltipId === tip.id;
            return (
              <div
                key={tip.id}
                id={tip.id}
                style={{
                  position: "fixed",
                  top: Math.max(0, tip.top),
                  left: tip.left,
                  transform: "translateX(-50%)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "2px",
                  pointerEvents: "none",
                  zIndex: isHovered ? 999999 : 999998,
                  opacity: isHovered ? 1 : 0.75,
                  transition: "opacity 0.15s ease-in-out, z-index 0.15s ease-in-out",
                }}
              >
                {/* Wrapper that holds chips + caret as a single column */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {/* Row of coloured chips */}
                  <div style={{ display: "inline-flex", gap: "2px", borderRadius: "4px", overflow: "hidden", boxShadow: "0 2px 6px rgba(0,0,0,0.45)" }}>
                    {tip.segments.map((seg, i) => (
                      <span
                        key={i}
                        style={{
                          backgroundColor: seg.bgColor,
                          color: "#f8fafc",
                          fontSize: "9px",
                          fontWeight: "700",
                          fontFamily: "monospace",
                          padding: "2px 5px",
                          lineHeight: 1.4,
                          whiteSpace: "nowrap",
                          borderRight: i < tip.segments.length - 1 ? "1px solid rgba(255,255,255,0.15)" : "none",
                        }}
                      >
                        {seg.value}
                      </span>
                    ))}
                  </div>
                  {/* Single indicator triangle centered under the chip row */}
                  <div style={{
                    width: 0,
                    height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: `5px solid ${tip.segments[0]?.bgColor ?? "#1e3a8a"}`,
                  }} />
                </div>
              </div>
            );
          })}
        </>
      )}

      {isMenuOpen && isOpen && (
        <FloatingPanel
          hidden={isEyedropperActive}
          inspectorActive={inspectorActive}
          setInspectorActive={(active) => {
            setInspectorActive(active);
            if (active) setGridInspectorActive(false);
          }}
          lockedItems={lockedItems}
          onRemoveLockedItem={handleRemoveLockedItem}
          onClearAllLocked={handleClearAllLocked}
          onClose={() => setIsOpen(false)}
          activeTab={focusedTab}
          setActiveTab={setFocusedTab}
          showContrastTooltips={showContrastTooltips}
          setShowContrastTooltips={setShowContrastTooltips}
          onTriggerEyeDropper={triggerNativeEyeDropper}
          selectedColor={selectedColor}
          setSelectedColor={setSelectedColor}
        />
      )}

      {isMenuOpen && (
        <div
          id="main-extension-menu"
          onMouseDown={startDragMenu}
          style={{
            display: (isEyedropperActive || isScreenshotActive || paintActive) ? "none" : "flex",
            position: "fixed",
            left: isMenuPositioned ? `${menuPos.x}px` : '50%',
            bottom: isMenuPositioned ? `${menuPos.y}px` : '24px',
            top: 'auto',
            transform: isMenuPositioned ? 'none' : 'translateX(-50%)',
            zIndex: 2000000,
            cursor: isDraggingMenu ? "grabbing" : "grab"
          }}
          className="flex flex-col items-center gap-2 pointer-events-none select-none"
        >
          {/* Detailed Properties Card */}
          {textInspectorActive && (() => {
            const activeItem = selectedTextElements.find(item => item.id === activeSelectedTextId);
            if (!activeItem) return null;
            return (
              <div className="bg-slate-950/95 backdrop-blur-md border border-slate-800 p-4 rounded-xl shadow-2xl w-[500px] pointer-events-auto flex flex-col gap-3 text-slate-100 text-xs select-text">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <span className="font-semibold text-blue-400 font-mono">"{activeItem.textContent}" Properties</span>
                  <button
                    onClick={() => setActiveSelectedTextId(null)}
                    className="p-1 rounded hover:bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px]">
                  <div
                    onClick={() => handleCopyField("fontFamily", activeItem.styles.fontFamily)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Font Family</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-200 text-right truncate max-w-[150px]" title={activeItem.styles.fontFamily}>
                        {copiedField === "fontFamily" ? "Copied!" : activeItem.styles.fontFamily.split(",")[0]}
                      </span>
                      {copiedField === "fontFamily" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("fontSize", activeItem.styles.fontSize)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Font Size</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-200">
                        {copiedField === "fontSize" ? "Copied!" : activeItem.styles.fontSize}
                      </span>
                      {copiedField === "fontSize" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("fontWeight", activeItem.styles.fontWeight)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Font Weight</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-200">
                        {copiedField === "fontWeight" ? "Copied!" : activeItem.styles.fontWeight}
                      </span>
                      {copiedField === "fontWeight" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("lineHeight", activeItem.styles.lineHeight)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Line Height</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-200">
                        {copiedField === "lineHeight" ? "Copied!" : activeItem.styles.lineHeight}
                      </span>
                      {copiedField === "lineHeight" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("letterSpacing", activeItem.styles.letterSpacing)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Tracking</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-200">
                        {copiedField === "letterSpacing" ? "Copied!" : activeItem.styles.letterSpacing}
                      </span>
                      {copiedField === "letterSpacing" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("color", activeItem.styles.color)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Text Color</span>
                    <div className="flex items-center gap-1.5">
                      {copiedField !== "color" && (
                        <span className="w-2.5 h-2.5 rounded-full border border-slate-700" style={{ backgroundColor: activeItem.styles.color }} />
                      )}
                      <span className="text-slate-200">
                        {copiedField === "color" ? "Copied!" : activeItem.styles.color}
                      </span>
                      {copiedField === "color" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("backgroundColor", activeItem.styles.backgroundColor)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Background</span>
                    <div className="flex items-center gap-1.5">
                      {copiedField !== "backgroundColor" && (
                        <span className="w-2.5 h-2.5 rounded-full border border-slate-700" style={{ backgroundColor: activeItem.styles.backgroundColor }} />
                      )}
                      <span className="text-slate-200">
                        {copiedField === "backgroundColor" ? "Copied!" : activeItem.styles.backgroundColor}
                      </span>
                      {copiedField === "backgroundColor" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("contrast", activeItem.styles.contrastRatio.toFixed(1) + ":1")}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Contrast</span>
                    <div className="flex items-center gap-1">
                      <span className={copiedField === "contrast" ? "text-emerald-400" : `font-bold ${activeItem.styles.contrastRatio >= 4.5 ? "text-emerald-400" : "text-rose-400"}`}>
                        {copiedField === "contrast" ? "Copied!" : `${activeItem.styles.contrastRatio.toFixed(1)}:1`}
                      </span>
                      {copiedField === "contrast" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>

                  <div
                    onClick={() => handleCopyField("textAlign", activeItem.styles.textAlign)}
                    className="flex justify-between border-b border-slate-900/50 py-1.5 px-1 hover:bg-slate-900/50 rounded cursor-pointer transition-colors group select-all"
                  >
                    <span className="text-slate-400 group-hover:text-slate-300">Text Align</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-200">
                        {copiedField === "textAlign" ? "Copied!" : activeItem.styles.textAlign}
                      </span>
                      {copiedField === "textAlign" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Secondary Top Bar for Text Inspector */}
          {textInspectorActive && (
            <div className="bg-slate-950/95 backdrop-blur-md border border-slate-800 p-2.5 rounded-xl shadow-xl w-auto min-w-[560px] max-w-[780px] pointer-events-auto flex flex-col gap-2">
              {/* Row 1: Toggles & Preview */}
              <div className="flex items-center justify-between gap-3">
                {/* Left: Toggles */}
                <div className="flex items-center gap-1.5 text-[10px] font-mono flex-wrap">
                  {(["fontSize", "fontWeight", "fontFamily", "lineHeight", "tracking", "textColor", "contrast"] as const).map(mode => {
                    const label = mode === "fontSize" ? "Font Size"
                      : mode === "fontWeight" ? "Font Weight"
                        : mode === "fontFamily" ? "Font Family"
                          : mode === "lineHeight" ? "Line Height"
                            : mode === "tracking" ? "Tracking"
                              : mode === "textColor" ? "Text Color"
                                : "Contrast";
                    const isActive = activeOverlayModes.has(mode);
                    const activeColor = mode === "fontSize" ? "bg-blue-600 border-blue-500"
                      : mode === "fontWeight" ? "bg-indigo-600 border-indigo-500"
                        : mode === "fontFamily" ? "bg-purple-600 border-purple-500"
                          : mode === "lineHeight" ? "bg-orange-600 border-orange-500"
                            : mode === "tracking" ? "bg-fuchsia-600 border-fuchsia-500"
                              : mode === "textColor" ? "bg-teal-600 border-teal-500"
                                : "bg-emerald-700 border-emerald-600";
                    return (
                      <button
                        key={mode}
                        onClick={() => {
                          setActiveOverlayModes(prev => {
                            const next = new Set(prev);
                            if (next.has(mode)) next.delete(mode);
                            else next.add(mode);
                            return next;
                          });
                        }}
                        className={`px-2 py-1 rounded-md border cursor-pointer transition-all ${isActive
                          ? `${activeColor} text-white shadow-sm font-semibold`
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                          }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Divider */}
                <div className="w-[1px] h-5 bg-slate-700/80 shrink-0" style={{ width: "1px", height: "20px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }} />

                {/* Right: Hover Preview */}
                <div className="flex items-center justify-end text-[10px] font-mono text-slate-300 truncate max-w-[160px] shrink-0">
                  {hoveredTextStyles ? (
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-slate-400 font-semibold">{hoveredTextStyles.fontSize}</span>
                      <span className="text-slate-400 truncate max-w-[50px]">{hoveredTextStyles.fontFamily.split(",")[0]}</span>
                      <span className={`font-bold ${hoveredTextStyles.contrastRatio >= 4.5 ? "text-emerald-400" : "text-rose-400"}`}>
                        {hoveredTextStyles.contrastRatio.toFixed(1)}:1
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-500 italic">Hover to preview</span>
                  )}
                </div>
              </div>

              {/* Row 2: Selected Items Pills */}
              {selectedTextElements.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 border-t border-slate-900/50">
                  <span className="text-[9px] text-slate-500 font-mono uppercase tracking-wider pr-1">Selected:</span>
                  {selectedTextElements.map(item => (
                    <div
                      key={item.id}
                      onClick={() => setActiveSelectedTextId(item.id === activeSelectedTextId ? null : item.id)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-mono border cursor-pointer transition-all ${item.id === activeSelectedTextId
                        ? "bg-blue-600/25 border-blue-500 text-blue-300"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-750"
                        }`}
                    >
                      <span className="truncate max-w-[70px]">{item.textContent}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTextElements(prev => prev.filter(x => x.id !== item.id));
                          if (activeSelectedTextId === item.id) {
                            setActiveSelectedTextId(null);
                          }
                        }}
                        className="hover:text-rose-455 p-0.5"
                      >
                        <X className="w-2 h-2" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* Main Toolbar Pill */}
          <div className="flex items-center gap-2.5 bg-slate-950/90 backdrop-blur-md border border-slate-800/80 px-3.5 py-1.5 rounded-xl shadow-2xl pointer-events-auto">
            {/* Drag Handle */}
            <div className="flex items-center justify-center text-slate-500 cursor-grab hover:text-slate-300">
              <GripVertical size={20} />
            </div>

            {/* Divider */}
            <div
              className="w-[1px] h-5 bg-slate-700/80 shrink-0"
              style={{ width: "1px", height: "20px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }}
            />

            {/* Group 1: Tools */}
            <div className="flex items-center gap-1.5">
              {/* Mouse Inspector */}
              <button
                onClick={() => {
                  setInspectorActive(!inspectorActive);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${inspectorActive
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Hover Inspector (Key: M)"
              >
                <MousePointer className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${inspectorActive ? "text-blue-200" : "text-slate-500"}`}>M</span>
              </button>

              {/* Grid/Layout Inspector Toggle — with hover box toggle pill above it */}
              <div className="relative flex flex-col items-center">
                {/* Hover Box toggle pill — floats above the grid button when active */}
                {gridInspectorActive && (
                  <button
                    onClick={() => setShowGridHoverBox(!showGridHoverBox)}
                    className={`absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-lg border cursor-pointer backdrop-blur-md ${
                      showGridHoverBox
                        ? "bg-purple-600/90 border-purple-400/60 text-white hover:bg-purple-700"
                        : "bg-slate-950/90 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                    }`}
                    title={showGridHoverBox ? "Hide hover info box" : "Show hover info box"}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      showGridHoverBox ? "bg-white animate-pulse" : "bg-slate-600"
                    }`} />
                    <Grid className="w-3 h-3" />
                    <span>Hover Box: {showGridHoverBox ? "ON" : "OFF"}</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setGridInspectorActive(!gridInspectorActive);
                    setInspectorActive(false);
                    setTextInspectorActive(false);
                  }}
                  className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${gridInspectorActive
                    ? "bg-purple-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                    }`}
                  title="Grid/Layout Inspector (Key: L)"
                >
                  <Grid className="w-3.5 h-3.5" />
                  <span className={`text-[8px] font-bold font-mono mt-0.5 ${gridInspectorActive ? "text-purple-200" : "text-slate-500"}`}>L</span>
                </button>
              </div>

              {/* Eyedropper Color Picker */}
              {"EyeDropper" in window && (
                <button
                  onClick={triggerNativeEyeDropper}
                  className="flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-all"
                  title="Color Picker / Eyedropper (Key: E)"
                >
                  <Pipette className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-bold font-mono mt-0.5 text-slate-500">E</span>
                </button>
              )}

              {/* Text Inspector Toggle */}
              <button
                onClick={() => {
                  setTextInspectorActive(!textInspectorActive);
                  setInspectorActive(false);
                  setMarginInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${textInspectorActive
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Text Inspector (Key: T)"
              >
                <Type className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${textInspectorActive ? "text-blue-200" : "text-slate-500"}`}>T</span>
              </button>

              {/* Margin & Ruler Inspector Toggle */}
              <button
                onClick={() => {
                  setMarginInspectorActive(!marginInspectorActive);
                  setInspectorActive(false);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${marginInspectorActive
                  ? "bg-cyan-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Margin & Ruler Guides (Key: R)"
              >
                <Ruler className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${marginInspectorActive ? "text-cyan-200" : "text-slate-500"}`}>R</span>
              </button>
            </div>

            {/* Divider */}
            <div
              className="w-[1px] h-5 bg-slate-700/80 shrink-0"
              style={{ width: "1px", height: "20px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }}
            />

            {/* Paint / Annotate & Screenshot Tools */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setPaintActive(prev => !prev);
                  setPaintInitialAction(undefined);
                  setInspectorActive(false);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${paintActive && !paintInitialAction
                  ? "bg-pink-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Paint / Annotate"
              >
                <PenTool className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${paintActive && !paintInitialAction ? "text-pink-200" : "text-slate-500"}`}>P</span>
              </button>

              <button
                onClick={() => {
                  setPaintInitialAction("area");
                  setPaintActive(true);
                  setInspectorActive(false);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${paintActive && paintInitialAction === "area"
                  ? "bg-purple-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Area Screenshot"
              >
                <Camera className="w-3.5 h-3.5" />
                <span className="text-[8px] font-bold font-mono mt-0.5 text-slate-500">S</span>
              </button>

              <button
                onClick={() => {
                  setPaintInitialAction("full");
                  setPaintActive(true);
                  setInspectorActive(false);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${paintActive && paintInitialAction === "full"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Visible Viewport Screenshot"
              >
                <Monitor className="w-3.5 h-3.5" />
                <span className="text-[8px] font-bold font-mono mt-0.5 text-slate-500">V</span>
              </button>

              <button
                onClick={() => {
                  setPaintInitialAction("fullpage");
                  setPaintActive(true);
                  setInspectorActive(false);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${paintActive && paintInitialAction === "fullpage"
                  ? "bg-emerald-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Full Page Screenshot (Entire Document)"
              >
                <FileDown className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[8px] font-bold font-mono mt-0.5 text-emerald-500">FP</span>
              </button>
            </div>

            {/* Divider */}
            <div
              className="w-[1px] h-5 bg-slate-700/80 shrink-0"
              style={{ width: "1px", height: "20px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }}
            />

            {/* Group 2: Sidebar Tabs */}
            <div className="flex items-center gap-1.5">
              {/* Colors tab */}
              <button
                onClick={() => {
                  setFocusedTab("colors");
                  setIsOpen(true);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${isOpen && focusedTab === "colors"
                  ? "bg-slate-800 text-blue-400 border border-slate-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Color Analyzer (Key: C)"
              >
                <Palette className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${isOpen && focusedTab === "colors" ? "text-blue-300" : "text-slate-500"}`}>C</span>
              </button>

              {/* Fonts tab */}
              <button
                onClick={() => {
                  setFocusedTab("fonts");
                  setIsOpen(true);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${isOpen && focusedTab === "fonts"
                  ? "bg-slate-800 text-blue-400 border border-slate-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Typography Analyzer (Key: F)"
              >
                <Type className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${isOpen && focusedTab === "fonts" ? "text-blue-300" : "text-slate-500"}`}>F</span>
              </button>

              {/* Images tab */}
              <button
                onClick={() => {
                  setFocusedTab("images");
                  setIsOpen(true);
                }}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${isOpen && focusedTab === "images"
                  ? "bg-slate-800 text-blue-400 border border-slate-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Image Analyzer (Key: G)"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${isOpen && focusedTab === "images" ? "text-blue-300" : "text-slate-500"}`}>G</span>
              </button>
            </div>

            {/* Divider */}
            <div
              className="w-[1px] h-5 bg-slate-700/80 shrink-0"
              style={{ width: "1px", height: "20px", backgroundColor: "rgba(255, 255, 255, 0.2)", flexShrink: 0 }}
            />

            {/* Group 3: Control Buttons */}
            <div className="flex items-center gap-1.5">
              {/* Toggle Sidebar */}
              <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer transition-all ${isOpen
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                title="Toggle Sidebar (Key: V)"
              >
                <Layout className="w-3.5 h-3.5" />
                <span className={`text-[8px] font-bold font-mono mt-0.5 ${isOpen ? "text-blue-300" : "text-slate-500"}`}>V</span>
              </button>

              {/* Close Menu */}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsOpen(false);
                  setInspectorActive(false);
                  setGridInspectorActive(false);
                  setTextInspectorActive(false);
                  setShowContrastTooltips(false);
                }}
                className="flex flex-col items-center justify-center w-9 h-9 rounded-md cursor-pointer text-rose-500 hover:text-rose-400 hover:bg-rose-950/30 transition-all"
                title="Close Visual Inspector (Key: Q)"
              >
                <Power className="w-3.5 h-3.5" />
                <span className="text-[8px] font-bold font-mono mt-0.5 text-rose-600 hover:text-rose-400">Q</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ContentApp;
