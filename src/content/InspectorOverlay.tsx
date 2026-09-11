import React from "react";
import { extractElementStyles, rgbToHex } from "./styleExtractor";

interface InspectorOverlayProps {
  element: HTMLElement;
  label?: string;
  borderColor?: string;
  borderStyle?: string;
  backgroundColor?: string;
  interactive?: boolean; // Added to enable interactions when selection is locked
  onClose?: () => void;  // Callback to close/clear lock state
  showPopover?: boolean; // Controls whether to show the hover popover
  mode?: "default" | "grid";
}

// Fallback clipboard copying method using document.execCommand
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

// Inline SVGs for copy action feedback
const CopyIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

// Click-to-copy wrapper component with hover and success state styles
const CopyableValue: React.FC<{
  value: string;
  displayValue?: React.ReactNode;
  label: string;
  interactive?: boolean;
}> = ({ value, displayValue, label, interactive }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    
    const runCopy = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(runCopy).catch(() => {
        fallbackCopyText(value);
        runCopy();
      });
    } else {
      fallbackCopyText(value);
      runCopy();
    }
  };

  if (!interactive) {
    return <span style={{ userSelect: "none" }}>{displayValue || value}</span>;
  }

  return (
    <span
      onClick={handleCopy}
      className="overlay-copyable-field"
      style={{
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "1px 4px",
        borderRadius: "3px",
        backgroundColor: copied ? "rgba(16, 185, 129, 0.15)" : "transparent",
        color: copied ? "#10b981" : "inherit",
        transition: "all 0.15s ease",
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
      title={`Click to copy ${label}`}
    >
      <span style={{ userSelect: "text", WebkitUserSelect: "text" }}>{displayValue || value}</span>
      {copied ? <CheckIcon /> : <span className="overlay-copy-icon" style={{ opacity: 0, transition: "opacity 0.15s ease" }}><CopyIcon /></span>}
    </span>
  );
};

export const InspectorOverlay: React.FC<InspectorOverlayProps> = ({
  element,
  label,
  borderColor = "#3b82f6",
  borderStyle = "solid",
  backgroundColor = "rgba(59, 130, 246, 0.05)",
  interactive = false,
  onClose,
  showPopover = true,
  mode = "default"
}) => {
  const rect = element.getBoundingClientRect();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  const style = window.getComputedStyle(element);

  // Track mouse position for cursor-following popover
  const [mousePos, setMousePos] = React.useState<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Extract computed styles dynamically for the popover
  let styles;
  try {
    styles = extractElementStyles(element);
  } catch (err) {
    console.warn("Failed style extraction in overlay:", err);
  }

  // Padding dimensions
  const pTop = parseFloat(style.paddingTop) || 0;
  const pRight = parseFloat(style.paddingRight) || 0;
  const pBottom = parseFloat(style.paddingBottom) || 0;
  const pLeft = parseFloat(style.paddingLeft) || 0;

  // Margin dimensions
  const mTop = parseFloat(style.marginTop) || 0;
  const mRight = parseFloat(style.marginRight) || 0;
  const mBottom = parseFloat(style.marginBottom) || 0;
  const mLeft = parseFloat(style.marginLeft) || 0;

  // Border dimensions
  const bTop = parseFloat(style.borderTopWidth) || 0;
  const bRight = parseFloat(style.borderRightWidth) || 0;
  const bBottom = parseFloat(style.borderBottomWidth) || 0;
  const bLeft = parseFloat(style.borderLeftWidth) || 0;

  // Position of outline
  const outlineStyle: React.CSSProperties = {
    position: "absolute",
    top: rect.top + scrollY,
    left: rect.left + scrollX,
    width: rect.width,
    height: rect.height,
    border: `2px ${mode === "grid" ? "dashed" : borderStyle} ${mode === "grid" ? "#a855f7" : borderColor}`,
    backgroundColor: mode === "grid" ? "transparent" : backgroundColor,
    pointerEvents: "none",
    zIndex: 999999,
    boxSizing: "border-box",
  };

  const marginOverlayStyle: React.CSSProperties = {
    position: "absolute",
    top: rect.top + scrollY - mTop,
    left: rect.left + scrollX - mLeft,
    width: rect.width + mLeft + mRight,
    height: rect.height + mTop + mBottom,
    borderTop: `${mTop}px solid rgba(249, 115, 22, 0.25)`,
    borderRight: `${mRight}px solid rgba(249, 115, 22, 0.25)`,
    borderBottom: `${mBottom}px solid rgba(249, 115, 22, 0.25)`,
    borderLeft: `${mLeft}px solid rgba(249, 115, 22, 0.25)`,
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: 999997,
  };

  const paddingOverlayStyle: React.CSSProperties = {
    position: "absolute",
    top: rect.top + scrollY + bTop,
    left: rect.left + scrollX + bLeft,
    width: rect.width - bLeft - bRight,
    height: rect.height - bTop - bBottom,
    borderTop: `${pTop}px solid rgba(16, 185, 129, 0.25)`,
    borderRight: `${pRight}px solid rgba(16, 185, 129, 0.25)`,
    borderBottom: `${pBottom}px solid rgba(16, 185, 129, 0.25)`,
    borderLeft: `${pLeft}px solid rgba(16, 185, 129, 0.25)`,
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: 999998,
  };

  const contentOverlayStyle: React.CSSProperties = {
    position: "absolute",
    top: rect.top + scrollY + bTop + pTop,
    left: rect.left + scrollX + bLeft + pLeft,
    width: Math.max(0, rect.width - bLeft - bRight - pLeft - pRight),
    height: Math.max(0, rect.height - bTop - bBottom - pTop - pBottom),
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    border: "1px dashed rgba(59, 130, 246, 0.35)",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: 999999,
  };

  const popoverWidth = 280;
  const popoverHeight = mode === "grid" ? 340 : 320;

  let finalLeft: number;
  let finalTop: number;

  if (mode === "grid") {
    // --- GRID MODE: popover follows the mouse cursor closely ---
    const cursorOffset = 16;
    const cursorX = mousePos ? mousePos.x : rect.right;
    const cursorY = mousePos ? mousePos.y : rect.bottom;

    // Prefer right of cursor; flip left if not enough space
    if (cursorX + cursorOffset + popoverWidth <= window.innerWidth - 8) {
      finalLeft = cursorX + cursorOffset + scrollX;
    } else {
      finalLeft = cursorX - cursorOffset - popoverWidth + scrollX;
    }

    // Prefer below cursor; flip up if not enough space
    if (cursorY + cursorOffset + popoverHeight <= window.innerHeight - 8) {
      finalTop = cursorY + cursorOffset + scrollY;
    } else {
      finalTop = cursorY - cursorOffset - popoverHeight + scrollY;
    }

    // Clamp to viewport
    finalLeft = Math.max(8 + scrollX, Math.min(finalLeft, window.innerWidth - popoverWidth - 8 + scrollX));
    finalTop = Math.max(8 + scrollY, finalTop);
  } else {
    // --- DEFAULT MODE: popover placed beside/above/below the hovered element ---
    const margin = 12;
    const spaceRight = window.innerWidth - rect.right;
    const spaceLeft = rect.left;

    let popoverLeft = rect.left;
    let popoverTop = rect.bottom;
    let placement: "right" | "left" | "below" | "above" = "below";

    if (spaceRight >= popoverWidth + 24) {
      popoverLeft = rect.right + margin;
      popoverTop = rect.top;
      placement = "right";
    } else if (spaceLeft >= popoverWidth + 24) {
      popoverLeft = rect.left - popoverWidth - margin;
      popoverTop = rect.top;
      placement = "left";
    } else {
      const spaceBelow = window.innerHeight - rect.bottom;
      const showAbove = spaceBelow < popoverHeight + 20 && rect.top > popoverHeight + 20;
      popoverLeft = rect.left;
      popoverTop = showAbove
        ? rect.top - popoverHeight - margin
        : rect.bottom + margin;
      placement = showAbove ? "above" : "below";
    }

    if (popoverLeft + popoverWidth > window.innerWidth - 16) popoverLeft = window.innerWidth - popoverWidth - 16;
    if (popoverLeft < 16) popoverLeft = 16;

    if (placement === "right" || placement === "left") {
      if (popoverTop + popoverHeight > window.innerHeight - 16) popoverTop = window.innerHeight - popoverHeight - 16;
      if (popoverTop < 16) popoverTop = 16;
    } else {
      if (placement === "below" && popoverTop + popoverHeight > window.innerHeight - 16) {
        popoverTop = rect.top > popoverHeight + 20
          ? rect.top - popoverHeight - margin
          : window.innerHeight - popoverHeight - 16;
      } else if (placement === "above" && popoverTop < 16) {
        popoverTop = window.innerHeight - rect.bottom > popoverHeight + 20
          ? rect.bottom + margin
          : 16;
      }
    }

    finalLeft = popoverLeft + scrollX;
    finalTop = popoverTop + scrollY;
  }

  const popoverStyle: React.CSSProperties = {
    position: "absolute",
    top: finalTop,
    left: finalLeft,
    width: `${popoverWidth}px`,
    backgroundColor: "#0B1329", // Deep Navy/Slate background
    color: "#E2E8F0",
    borderRadius: "8px",
    border: "1px solid #1C2B3C",
    boxShadow: "0 12px 30px -10px rgba(0,0,0,0.7), 0 8px 12px -8px rgba(0,0,0,0.5)",
    padding: "16px",
    fontSize: "11px",
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    pointerEvents: interactive ? "auto" : "none", // Enable cursor actions only when interactive
    userSelect: interactive ? "text" : "none",    // Enable text selection only when interactive
    WebkitUserSelect: interactive ? "text" : "none",
    zIndex: 1000000,
    boxSizing: "border-box",
  };

  // Weight name mapping helper
  const getWeightName = (weight: string) => {
    const w = parseInt(weight) || 400;
    if (w <= 100) return `${w} (Thin)`;
    if (w <= 200) return `${w} (Extra Light)`;
    if (w <= 300) return `${w} (Light)`;
    if (w <= 400) return `${w} (Regular)`;
    if (w <= 500) return `${w} (Medium)`;
    if (w <= 600) return `${w} (Semi Bold)`;
    if (w <= 700) return `${w} (Bold)`;
    if (w <= 800) return `${w} (Extra Bold)`;
    return `${w} (Black)`;
  };

  // Contrast value formatting
  const contrastRatio = styles ? styles.contrastRatio : 1;
  const isLargeText = styles 
    ? (parseFloat(styles.fontSize) >= 24 || (parseFloat(styles.fontSize) >= 18.6 && parseInt(styles.fontWeight, 10) >= 700))
    : false;
  const aaPassed = isLargeText ? contrastRatio >= 3.0 : contrastRatio >= 4.5;
  const contrastColor = aaPassed ? "#10b981" : "#f97316"; // Green if passed, orange/red if not

  // Format label values for separate styling
  let labelTag = "";
  let labelClasses = "";
  if (styles) {
    if (label) {
      if (label.startsWith("selected: ")) {
        labelTag = "selected";
        labelClasses = `: ${label.substring(10)}`;
      } else {
        labelTag = label;
      }
    } else {
      labelTag = styles.tagName;
      labelClasses = styles.className
        ? " " + styles.className.split(/\s+/).filter(Boolean).map(c => `.${c}`).join(" ")
        : "";
    }
  }

  return (
    <>
      {/* Margin Visual Overlay */}
      {mode === "grid" && (mTop > 0 || mRight > 0 || mBottom > 0 || mLeft > 0) && (
        <div style={marginOverlayStyle} />
      )}

      {/* Padding Visual Overlay */}
      {mode === "grid" && (pTop > 0 || pRight > 0 || pBottom > 0 || pLeft > 0) && (
        <div style={paddingOverlayStyle} />
      )}

      {/* Content Visual Overlay */}
      {mode === "grid" && (
        <div style={contentOverlayStyle} />
      )}

      {/* Dashed outline around element */}
      <div style={outlineStyle} />

      {/* Inject animation styles for blinking dot and copy buttons */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes overlay-dot-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .inspecting-dot-blink {
          animation: overlay-dot-blink 1.5s infinite;
        }
        .overlay-copyable-field:hover {
          background-color: rgba(255, 255, 255, 0.08) !important;
        }
        .overlay-copyable-field:hover .overlay-copy-icon {
          opacity: 0.7 !important;
        }
        .popover-close-btn:hover {
          background-color: rgba(239, 68, 68, 0.2) !important;
          color: #ef4444 !important;
        }
      `}} />

      {/* Styled Popover tooltip */}
      {showPopover && styles && (
        <div style={popoverStyle}>
          {/* Header Row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1C2B3C", paddingBottom: "8px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", overflow: "hidden", whiteSpace: "nowrap", marginRight: "8px" }}>
              <span style={{ fontWeight: "bold", color: mode === "grid" ? "#a855f7" : "#D0BCFF", fontSize: "13px", fontFamily: "monospace" }}>
                {labelTag}
              </span>
              <span style={{ color: "#64748B", fontSize: "11px", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                {labelClasses}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ 
                border: "1px solid #1C2B3C", 
                borderRadius: "4px", 
                padding: "2px 6px", 
                fontSize: "9px", 
                color: mode === "grid" ? "#a855f7" : "#94A3B8", 
                fontFamily: "monospace",
                letterSpacing: "0.5px",
                fontWeight: "bold"
              }}>
                {mode === "grid" ? "GRID / LAYOUT" : "FDT v1.2.0"}
              </span>
              {interactive && onClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94A3B8",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: "1",
                    fontWeight: "bold",
                    padding: "2px 5px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                    transition: "all 0.15s ease",
                  }}
                  className="popover-close-btn"
                  title="Close Inspector Overlay"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Grid Layout specialized rendering */}
          {mode === "grid" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* Dimensions and Display Type */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px", textTransform: "uppercase" }}>Dimensions</div>
                  <div style={{ color: "#F1F5F9", fontSize: "12px", fontWeight: "bold", fontFamily: "monospace" }}>
                    <CopyableValue 
                      value={`${styles.dimensions.width} × ${styles.dimensions.height}`} 
                      label="Dimensions" 
                      interactive={interactive} 
                    />
                  </div>
                </div>
                <div>
                  <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px", textTransform: "uppercase" }}>Display</div>
                  <div style={{ color: "#a855f7", fontSize: "12px", fontWeight: "bold", fontFamily: "monospace" }}>
                    <CopyableValue 
                      value={styles.display} 
                      label="Display" 
                      interactive={interactive} 
                    />
                  </div>
                </div>
              </div>

              {/* Paddings & Margins Detailed List */}
              <div style={{ borderTop: "1px solid #1C2B3C", paddingTop: "8px" }}>
                <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                  📐 BOX MODEL SPACING
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "10px", fontFamily: "monospace" }}>
                  {/* Padding Row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(16, 185, 129, 0.08)", padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(16, 185, 129, 0.15)" }}>
                    <span style={{ color: "#10b981", fontWeight: "bold" }}>PADDING</span>
                    <span style={{ color: "#F1F5F9" }} title={`T: ${style.paddingTop} R: ${style.paddingRight} B: ${style.paddingBottom} L: ${style.paddingLeft}`}>
                      <CopyableValue 
                        value={styles.padding} 
                        label="Padding Shorthand" 
                        interactive={interactive} 
                      />
                    </span>
                  </div>

                  {/* Margin Row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(249, 115, 22, 0.08)", padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(249, 115, 22, 0.15)" }}>
                    <span style={{ color: "#f97316", fontWeight: "bold" }}>MARGIN</span>
                    <span style={{ color: "#F1F5F9" }} title={`T: ${style.marginTop} R: ${style.marginRight} B: ${style.marginBottom} L: ${style.marginLeft}`}>
                      <CopyableValue 
                        value={styles.margin} 
                        label="Margin Shorthand" 
                        interactive={interactive} 
                      />
                    </span>
                  </div>
                </div>
              </div>

              {/* Gap and Roundness */}
              <div style={{ borderTop: "1px solid #1C2B3C", paddingTop: "8px" }}>
                <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                  ⚙️ LAYOUT PROPERTIES
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>GAP</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={styles.gap} 
                        label="Gap" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>ROUNDNESS</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={styles.borderRadius} 
                        label="Border Radius" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Text Properties */}
              <div style={{ borderTop: "1px solid #1C2B3C", paddingTop: "8px", marginBottom: "2px" }}>
                <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                  Tt TEXT PROPERTIES
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "8px" }}>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>FONT FAMILY</div>
                    <div style={{ color: "#F1F5F9", fontSize: "10px", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={styles.fontFamily}>
                      <CopyableValue 
                        value={styles.fontFamilyChain[0] || styles.fontFamily} 
                        label="Font Family" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>SIZE / WT</div>
                    <div style={{ color: "#F1F5F9", fontSize: "10px", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={`${styles.fontSize} / ${styles.fontWeight}`} 
                        label="Font Size / Weight" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: styles.color, border: "1px solid rgba(255,255,255,0.15)" }} />
                    <span style={{ color: "#94A3B8", fontSize: "10px" }}>Text Color</span>
                  </div>
                  <span style={{ color: "#F1F5F9", fontSize: "10px", fontFamily: "monospace" }}>
                    <CopyableValue 
                      value={rgbToHex(styles.textColorRGB)} 
                      label="Text Color" 
                      interactive={interactive} 
                    />
                  </span>
                </div>
              </div>

              {/* Footer Indicator */}
              <div style={{ borderTop: "1px solid #1C2B3C", paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "9px" }}>
                <span style={{ color: "#64748B" }}>ⓘ Hovering Grid Overlay</span>
                <span style={{ color: "#a855f7", display: "flex", alignItems: "center", gap: "4px", fontWeight: "bold", letterSpacing: "0.5px" }}>
                  <span className="inspecting-dot-blink" style={{ width: "6px", height: "6px", backgroundColor: "#a855f7", borderRadius: "50%", display: "inline-block" }} />
                  GRID ACTIVE
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Typography Row */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontFamily: "serif", fontSize: "11px", fontStyle: "italic", fontWeight: "bold" }}>Tt</span> TYPOGRAPHY
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>FAMILY</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={styles.fontFamily}>
                      <CopyableValue 
                        value={styles.fontFamilyChain[0] || styles.fontFamily} 
                        label="Font Family" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>SIZE / LEADING</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={`${styles.fontSize} / ${styles.lineHeight === "normal" ? "normal" : styles.lineHeight}`} 
                        label="Font Size / Leading" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>WEIGHT</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={styles.fontWeight} 
                        displayValue={getWeightName(styles.fontWeight)}
                        label="Font Weight" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>STYLE</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={styles.fontStyle} 
                        displayValue={styles.fontStyle.charAt(0).toUpperCase() + styles.fontStyle.slice(1)}
                        label="Font Style" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748B", fontSize: "8px", letterSpacing: "0.5px", marginBottom: "2px" }}>TRACKING</div>
                    <div style={{ color: "#F1F5F9", fontSize: "11px", fontWeight: "500", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={styles.letterSpacing} 
                        label="Tracking / Letter Spacing" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Appearance Row */}
              <div style={{ marginBottom: "12px", borderTop: "1px solid #1C2B3C", paddingTop: "8px" }}>
                <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                  🎨 APPEARANCE
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {/* Primary Color */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: styles.color, border: "1px solid rgba(255,255,255,0.15)" }} />
                      <span style={{ color: "#94A3B8", fontSize: "11px" }}>Primary Color</span>
                    </div>
                    <span style={{ color: "#F1F5F9", fontSize: "11px", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={rgbToHex(styles.textColorRGB)} 
                        label="Primary Color Hex" 
                        interactive={interactive} 
                      />
                    </span>
                  </div>
                  
                  {/* Background */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "12px", height: "12px", borderRadius: "3px", backgroundColor: styles.backgroundColor, border: "1px solid rgba(255,255,255,0.15)" }} />
                      <span style={{ color: "#94A3B8", fontSize: "11px" }}>Background</span>
                    </div>
                    <span style={{ color: "#F1F5F9", fontSize: "11px", fontFamily: "monospace" }}>
                      <CopyableValue 
                        value={rgbToHex(styles.bgColorRGB)} 
                        label="Background Color Hex" 
                        interactive={interactive} 
                      />
                    </span>
                  </div>

                  {/* Contrast */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: contrastColor, border: "1px solid rgba(255,255,255,0.15)" }} />
                      <span style={{ color: "#94A3B8", fontSize: "11px" }}>Contrast Ratio</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ color: contrastColor, fontSize: "11px", fontWeight: "bold", fontFamily: "monospace" }}>
                        <CopyableValue 
                          value={`${contrastRatio.toFixed(2)}:1`} 
                          label="Contrast Ratio" 
                          interactive={interactive} 
                        />
                      </span>
                      <span style={{ 
                        fontSize: "8px", 
                        color: "#0B1329", 
                        backgroundColor: contrastColor, 
                        padding: "1px 4px", 
                        borderRadius: "3px",
                        fontWeight: "bold",
                        fontFamily: "monospace"
                      }}>
                        {aaPassed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Box Model Row */}
              <div style={{ marginBottom: "12px", borderTop: "1px solid #1C2B3C", paddingTop: "8px" }}>
                <div style={{ color: "#94A3B8", fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                  📐 BOX MODEL
                </div>
                
                <div style={{ 
                  border: "1px dashed rgba(148, 163, 184, 0.3)", 
                  borderRadius: "4px", 
                  padding: "10px", 
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "8px",
                  backgroundColor: "rgba(30, 41, 59, 0.1)"
                }}>
                  <span style={{ position: "absolute", top: "2px", left: "6px", fontSize: "8px", color: "#64748B", fontFamily: "monospace" }}>
                    margin: <CopyableValue value={styles.margin} label="Margin shorthand" interactive={interactive} />
                  </span>
                  
                  <div style={{ 
                    border: "1px solid rgba(148, 163, 184, 0.25)", 
                    borderRadius: "3px", 
                    padding: "8px 12px", 
                    width: "90%",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    backgroundColor: "rgba(30, 41, 59, 0.15)"
                  }}>
                    <span style={{ position: "absolute", top: "2px", left: "6px", fontSize: "8px", color: "#64748B", fontFamily: "monospace" }}>
                      padding: <CopyableValue value={styles.padding} label="Padding shorthand" interactive={interactive} />
                    </span>
                    
                    <div style={{ 
                      backgroundColor: "rgba(208, 188, 255, 0.15)", 
                      border: "1px solid rgba(208, 188, 255, 0.3)",
                      borderRadius: "2px",
                      padding: "4px 8px",
                      fontSize: "10px",
                      color: "#D0BCFF",
                      fontFamily: "monospace",
                      fontWeight: "bold",
                      textAlign: "center",
                      width: "100%",
                      boxSizing: "border-box"
                    }}>
                      <CopyableValue 
                        value={`${styles.dimensions.width} × ${styles.dimensions.height}`} 
                        label="Width × Height" 
                        interactive={interactive} 
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", color: "#64748B", fontSize: "10px", fontFamily: "monospace" }}>
                  <div>
                    <span>Width</span>
                    <span style={{ color: "#F1F5F9", marginLeft: "8px" }}>
                      <CopyableValue 
                        value={`${styles.dimensions.width.toFixed(1)}px`} 
                        label="Element Width" 
                        interactive={interactive} 
                      />
                    </span>
                  </div>
                  <div>
                    <span>Height</span>
                    <span style={{ color: "#F1F5F9", marginLeft: "8px" }}>
                      <CopyableValue 
                        value={`${styles.dimensions.height.toFixed(1)}px`} 
                        label="Element Height" 
                        interactive={interactive} 
                      />
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer Action */}
              <div style={{ 
                borderTop: "1px solid #1C2B3C", 
                paddingTop: "8px", 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                fontSize: "9px"
              }}>
                <span style={{ color: "#64748B", display: "flex", alignItems: "center", gap: "3px" }}>
                  ⓘ Alt + Click to Lock
                </span>
                <span style={{ color: "#10b981", display: "flex", alignItems: "center", gap: "4px", fontWeight: "bold", letterSpacing: "0.5px" }}>
                  <span className="inspecting-dot-blink" style={{ 
                    width: "6px", 
                    height: "6px", 
                    backgroundColor: "#10b981", 
                    borderRadius: "50%",
                    display: "inline-block"
                  }} />
                  INSPECTING
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};
