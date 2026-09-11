import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Sparkles,
  MousePointer,
  Pipette,
  Palette,
  Type,
  Image,
  FileDown,
  Camera,
  Monitor
} from "lucide-react";
import "./index.css";

const Popup = () => {
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");
  const [isHoverActive, setIsHoverActive] = useState(false);

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          setActiveTab(tabs[0]);
          // Sync state with content script
          chrome.tabs.sendMessage(tabs[0].id!, { action: "query-status" }, (response) => {
            if (chrome.runtime.lastError) {
              console.log("Content script not active on this page.");
            } else if (response) {
              setIsHoverActive(response.inspectorActive);
            }
          });
        }
      });
    }
  }, []);

  const sendTabMessage = (action: string, payload?: any) => {
    if (!activeTab || !activeTab.id) {
      setStatusMessage("No active page detected");
      return;
    }

    setStatusMessage("Connecting to page...");
    chrome.tabs.sendMessage(activeTab.id, { action, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        // Fallback: try injecting content script if not already running
        setStatusMessage("Injecting script...");
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id! },
          files: ["assets/content.js"]
        }, () => {
          if (chrome.runtime.lastError) {
            setStatusMessage("Cannot run on this page");
            console.error(chrome.runtime.lastError.message);
          } else {
            // Re-send message after small delay
            setTimeout(() => {
              chrome.tabs.sendMessage(activeTab.id!, { action, ...payload }, (res) => {
                if (chrome.runtime.lastError || !res) {
                  setStatusMessage("Failed to connect. Please refresh the page.");
                } else {
                  setStatusMessage("Connected");
                  if (action === "toggle-inspector") setIsHoverActive(res.inspectorActive);
                }
              });
            }, 300);
          }
        });
      } else {
        setStatusMessage("Connected");
        if (action === "toggle-inspector" && response) {
          setIsHoverActive(response.inspectorActive);
        }
      }
    });
  };

  return (
    <div className="w-80 bg-slate-950 text-slate-100 p-4 font-sans select-none border border-slate-900 rounded-xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 border-b border-slate-900 pb-3">
        <Sparkles className="text-blue-500 w-5 h-5 animate-pulse" />
        <div>
          <h1 className="text-sm font-bold tracking-wide uppercase text-white">Visual Inspector</h1>
          <p className="text-[10px] text-slate-400">Design & Accessibility Toolkit</p>
        </div>
      </div>

      {/* Main Feature Menu */}
      <div className="space-y-2">
        {/* Toggle Inspector Row */}
        <button
          onClick={() => sendTabMessage("toggle-inspector")}
          className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${isHoverActive
              ? "bg-blue-600/10 border-blue-500 text-blue-400 font-bold"
              : "bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-300"
            }`}
        >
          <div className="flex items-center gap-2.5">
            <MousePointer className={`w-4 h-4 ${isHoverActive ? "text-blue-400 animate-bounce" : "text-slate-400"}`} />
            <div className="text-left">
              <div className="text-xs font-bold">Hover Inspector</div>
              <div className="text-[9px] text-slate-400 font-normal">Hover and click elements to inspect styles</div>
            </div>
          </div>
          <div className={`text-[10px] px-2 py-0.5 rounded font-black ${isHoverActive ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-400"}`}>
            {isHoverActive ? "ON" : "OFF"}
          </div>
        </button>

        {/* Color Picker Row */}
        <button
          onClick={() => sendTabMessage("activate-eyedropper")}
          className="w-full flex items-center justify-between p-3 rounded-xl border bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-300 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Pipette className="w-4 h-4 text-emerald-400" />
            <div className="text-left">
              <div className="text-xs font-bold">Color Picker (Eyedropper)</div>
              <div className="text-[9px] text-slate-400 font-normal">Select any pixel color on your screen</div>
            </div>
          </div>
          <span className="text-[8px] tracking-wider font-bold bg-slate-850 px-2 py-0.5 rounded text-emerald-400 uppercase font-mono">
            API
          </span>
        </button>

        <div className="border-t border-slate-900 my-2 pt-2">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">Screen Capture</div>
          <div className="grid grid-cols-3 gap-2">
            {/* Full Page Screenshot */}
            <button
              onClick={() => {
                sendTabMessage("trigger-fullpage-screenshot");
                window.close();
              }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-900/40 border border-slate-850 hover:border-emerald-500/50 hover:bg-emerald-950/20 transition-all text-slate-300 cursor-pointer group"
              title="Capture entire scrollable page"
            >
              <FileDown className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="text-[9px] font-bold">Full Page</span>
            </button>

            {/* Viewport Screenshot */}
            <button
              onClick={() => {
                sendTabMessage("trigger-viewport-screenshot");
                window.close();
              }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-900/40 border border-slate-850 hover:border-blue-500/50 hover:bg-blue-950/20 transition-all text-slate-300 cursor-pointer group"
              title="Capture visible screen area"
            >
              <Monitor className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
              <span className="text-[9px] font-bold">Viewport</span>
            </button>

            {/* Area Screenshot */}
            <button
              onClick={() => {
                sendTabMessage("trigger-area-screenshot");
                window.close();
              }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-900/40 border border-slate-850 hover:border-purple-500/50 hover:bg-purple-950/20 transition-all text-slate-300 cursor-pointer group"
              title="Drag to select region"
            >
              <Camera className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
              <span className="text-[9px] font-bold">Area</span>
            </button>
          </div>
        </div>

        <div className="border-t border-slate-900 my-2 pt-2">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">Page Analyzers</div>
          <div className="grid grid-cols-3 gap-2">
            {/* Color Extractor */}
            <button
              onClick={() => sendTabMessage("open-colors")}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-900/40 border border-slate-850 hover:border-slate-700 hover:bg-slate-900/80 transition-all text-slate-300 cursor-pointer"
            >
              <Palette className="w-4 h-4 text-purple-400" />
              <span className="text-[9px] font-bold">Colors</span>
            </button>

            {/* Font Family Extractor */}
            <button
              onClick={() => sendTabMessage("open-fonts")}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-900/40 border border-slate-850 hover:border-slate-700 hover:bg-slate-900/80 transition-all text-slate-300 cursor-pointer"
            >
              <Type className="w-4 h-4 text-pink-400" />
              <span className="text-[9px] font-bold">Fonts</span>
            </button>

            {/* Image Extractor */}
            <button
              onClick={() => sendTabMessage("open-images")}
              className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-900/40 border border-slate-850 hover:border-slate-700 hover:bg-slate-900/80 transition-all text-slate-300 cursor-pointer"
            >
              <Image className="w-4 h-4 text-amber-400" />
              <span className="text-[9px] font-bold">Images</span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer / Status Bar */}
      <div className="mt-4 pt-3 border-t border-slate-900 flex items-center justify-between text-[8px] text-slate-500 uppercase tracking-wider font-mono">
        <span>Status: <span className="text-slate-400">{statusMessage}</span></span>
        <button
          onClick={() => {
            sendTabMessage("toggle-sidebar");
            window.close();
          }}
          className="text-blue-500 hover:text-blue-400 transition-all cursor-pointer font-bold"
        >
          Toggle Sidebar
        </button>
      </div>
    </div>
  );
};

// Mount to DOM
const container = document.getElementById("popup-root");
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
export default Popup;
