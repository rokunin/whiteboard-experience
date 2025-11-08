
import {
  MODID,
  FLAG_SCOPE,
  FLAG_KEY_TEXTS,
  screenToWorld,
  worldToScreen,
  getSharedVars,
  setSelectedImageId,
  setCopiedImageData,
  setLastClickX,
  setLastClickY,
  deselectAllElements,
  getOrCreateLayer,
  ZIndexManager,
  ZIndexConstants
} from "../main.mjs";

let copiedTextData = null; // Буфер для копирования текста
let selectedTextId = null; // ID выделенного текстового элемента

// Scale sensitivity constant
const SCALE_SENSITIVITY = 0.01; // Sensitivity for text scaling

const DEFAULT_TEXT_COLOR = "#000000";
const DEFAULT_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_SPAN_BACKGROUND_COLOR = "#ffffff 0.5";
const DEFAULT_BORDER_HEX = DEFAULT_TEXT_COLOR;
const DEFAULT_BORDER_OPACITY = 100;
const DEFAULT_BORDER_WIDTH = 0;
const DEFAULT_TEXT_SCALE = 0.7;
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FONT_STYLE = "normal";
const DEFAULT_TEXT_ALIGN = "left";
const DEFAULT_FONT_FAMILY = "Arial";
const DEFAULT_FONT_SIZE = 16;

// Resize handle positioning
const RESIZE_HANDLE_OFFSET_X = -3; // pixels from right edge (negative = inside, positive = outside)
const RESIZE_HANDLE_OFFSET_Y = -3; // pixels from bottom edge (negative = inside, positive = outside)

// Map of element-id -> disposer function
let pendingColorPickerTimeout = null;
let pendingColorPickerRaf = null;
let skipNextTextDeselect = false;
const disposers = new Map();

/* ======================== Edit and Lock System ======================== */

/**
 * Apply visual lock overlay when another user is editing text
 */
function applyTextLockVisual(container, lockerId, lockerName, providedWidth = null, providedHeight = null) {
  if (!container) return;
  
  // Auto-deselect if we're viewing a locked element
  if (container.dataset.selected === "true" && selectedTextId === container.id) {
    // Call deselect if you have it, or just clear selection
    selectedTextId = null;
    container.dataset.selected = "false";
  }
  
  // Mark as locked
  container.dataset.lockedBy = lockerId;
  
  // Get text element bounds
  const textElement = container.querySelector(".wbe-canvas-text");
  if (!textElement) return;
  
  // Use provided dimensions if available, otherwise calculate
  const scale = getTextScale(textElement);
  const width = providedWidth !== null && providedWidth > 0 ? providedWidth : (textElement.offsetWidth * scale);
  const height = providedHeight !== null && providedHeight > 0 ? providedHeight : (textElement.offsetHeight * scale);
  
  // CRITICAL FIX: Snap text element to pre-edit size and keep it fixed until unlock
  // This prevents reflow/resizing when locked, even after F5 refresh
  const textWidth = width / scale; // Convert container width to text element width (accounting for scale)
  const textHeight = height / scale; // Convert container height to text element height
  // Store original manualWidth state BEFORE locking (to restore correctly on unlock)
  const wasManualWidth = textElement.dataset.manualWidth === "true";
  textElement.style.width = `${textWidth}px`;
  textElement.style.height = `${textHeight}px`;
  textElement.style.minWidth = `${textWidth}px`; // Prevent shrinking
  textElement.style.maxWidth = `${textWidth}px`; // Prevent growing
  textElement.style.overflow = "hidden"; // Prevent content overflow from changing size
  textElement.dataset.manualWidth = wasManualWidth ? "true" : "false"; // Preserve original state
  textElement.dataset.lockedSize = "true"; // Mark as locked size (prevents auto-resize)
  textElement.dataset.preLockManualWidth = wasManualWidth ? "true" : "false"; // Store for unlock
  
  // Create or update lock overlay
  let lockOverlay = container.querySelector(".wbe-text-lock-overlay");
  if (!lockOverlay) {
    lockOverlay = document.createElement("div");
    lockOverlay.className = "wbe-text-lock-overlay";
    container.appendChild(lockOverlay);
  }
  
  lockOverlay.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${width}px;
    height: ${height}px;
    background: rgba(183, 6, 199, 0.54);
    pointer-events: none;
    z-index: ${ZIndexConstants.LOCK_OVERLAY};
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  // Add lock icon
  let lockIcon = lockOverlay.querySelector(".wbe-lock-icon");
  if (!lockIcon) {
    lockIcon = document.createElement("div");
    lockIcon.className = "wbe-lock-icon";
    lockIcon.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/>
      </svg>
    `;
    lockIcon.style.cssText = `
      background: rgb(187, 56, 248);
      color: white;
      padding: 0;
      border-radius: 4px;
      font-size: 9px;
      font-weight: bold;
      display: flex;
      align-items: center;
      gap: 0;
    `;
    lockOverlay.appendChild(lockIcon);
  } else {
    const nameDiv = lockIcon.querySelector("div");
    if (nameDiv) nameDiv.textContent = `locked`;
  }
  container.style.setProperty("pointer-events", "none", "important");
}

/**
 * Remove visual lock overlay when editing ends
 */
function removeTextLockVisual(container) {
  if (!container) return;
  
  const textElement = container.querySelector(".wbe-canvas-text");
  if (textElement) {
    // CRITICAL FIX: Restore auto-sizing when unlock (remove locked size constraints)
    if (textElement.dataset.lockedSize === "true") {
      // Restore original manualWidth state (before lock was applied)
      const preLockManualWidth = textElement.dataset.preLockManualWidth === "true";
      // Only restore auto width if it wasn't manually set before lock
      if (!preLockManualWidth) {
        textElement.style.width = ""; // Restore auto width
        textElement.style.height = ""; // Restore auto height
        textElement.dataset.manualWidth = "false";
      } else {
        // Keep manual width if it was set before lock
        textElement.dataset.manualWidth = "true";
      }
      textElement.style.minWidth = ""; // Remove min constraint
      textElement.style.maxWidth = ""; // Remove max constraint
      textElement.style.overflow = ""; // Restore overflow behavior
      delete textElement.dataset.lockedSize;
      delete textElement.dataset.preLockManualWidth;
    }
  }
  
  delete container.dataset.lockedBy;
  
  const lockOverlay = container.querySelector(".wbe-text-lock-overlay");
  if (lockOverlay) {
    lockOverlay.remove();
  }
  container.style.setProperty("pointer-events", "auto", "important");
}

// Text mode state
let isTextMode = false;
let textModeCursor = null;



function exitTextMode() {
  if (!isTextMode) return;
  
  isTextMode = false;
  
  if (textModeCursor && textModeCursor._cleanup) {
    textModeCursor._cleanup();
  }
  
  textModeCursor = null;
}

/* ======================== End Edit and Lock System ======================== */

function cancelPendingColorPicker() {
  if (pendingColorPickerTimeout) {
    clearTimeout(pendingColorPickerTimeout);
    pendingColorPickerTimeout = null;
  }
  if (pendingColorPickerRaf) {
    cancelAnimationFrame(pendingColorPickerRaf);
    pendingColorPickerRaf = null;
  }
}

function enterTextMode() {
  if (isTextMode) return;
  
  isTextMode = true;
  
  // Create custom T cursor
  textModeCursor = document.createElement("div");
  textModeCursor.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 10000;
    font-family: Arial, sans-serif;
    font-size: 20px;
    font-weight: bold;
    color: #4a9eff;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
    user-select: none;
    display: none;
  `;
  textModeCursor.textContent = "T";
  document.body.appendChild(textModeCursor);
  
  // Update cursor position on mouse move
  const updateCursor = (e) => {
    textModeCursor.style.left = `${e.clientX + 10}px`;
    textModeCursor.style.top = `${e.clientY - 10}px`;
    textModeCursor.style.display = "block";
  };
  
  document.addEventListener("mousemove", updateCursor);
  
  // Store cleanup function
  textModeCursor._cleanup = () => {
    document.removeEventListener("mousemove", updateCursor);
    if (textModeCursor && textModeCursor.parentNode) {
      textModeCursor.parentNode.removeChild(textModeCursor);
    }
    textModeCursor = null;
  };
  
}

/* ======================== Font and Style Utilities ======================== */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeFontWeight = (value) => {
  if (!value) return DEFAULT_FONT_WEIGHT;
  if (value === "bold") return 700;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_FONT_WEIGHT;
};

const normalizeFontStyle = (value) => {
  if (!value) return DEFAULT_FONT_STYLE;
  return value === "italic" ? "italic" : DEFAULT_FONT_STYLE;
};

function hexToRgba(hex, opacity = 100) {
  if (!hex || typeof hex !== "string") return null;
  const normalized = hex.replace("#", "");
  if (![3, 6].includes(normalized.length)) return null;
  const full = normalized.length === 3
    ? normalized.split("").map(ch => ch + ch).join("")
    : normalized;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const alpha = clamp(Number(opacity) / 100, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbaToHexOpacity(input, fallbackHex = DEFAULT_BORDER_HEX, fallbackOpacity = DEFAULT_BORDER_OPACITY) {
  if (!input) {
    return { hex: fallbackHex, opacity: fallbackOpacity };
  }

  const match = String(input).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!match) {
    return { hex: fallbackHex, opacity: fallbackOpacity };
  }

  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = match[4] !== undefined ? clamp(parseFloat(match[4]), 0, 1) : 1;

  const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`;
  const opacity = Math.round(a * 100);
  return { hex, opacity };
}

function updateBorderStyle(textElement, { hexColor = DEFAULT_BORDER_HEX, opacity = DEFAULT_BORDER_OPACITY, width = DEFAULT_BORDER_WIDTH } = {}) {
  if (!textElement) return;

  const safeWidth = clamp(Number(width) || 0, 0, 20);
  const safeOpacity = clamp(Number(opacity) || 0, 0, 100);
  const safeHex = hexColor || DEFAULT_BORDER_HEX;
  const rgba = hexToRgba(safeHex, safeOpacity);

  textElement.dataset.borderHex = safeHex;
  textElement.dataset.borderOpacity = String(safeOpacity);
  textElement.dataset.borderWidth = String(safeWidth);
  textElement.dataset.borderRgba = safeWidth > 0 && rgba ? rgba : "";

  if (safeWidth > 0 && rgba) {
    textElement.style.border = `${safeWidth}px solid ${rgba}`;
  } else {
    textElement.style.border = "none";
  }
}

function applyFontVariantToElement(textElement, fontWeight = DEFAULT_FONT_WEIGHT, fontStyle = DEFAULT_FONT_STYLE) {
  if (!textElement) return;
  const weight = normalizeFontWeight(fontWeight);
  const style = normalizeFontStyle(fontStyle);
  textElement.style.fontWeight = String(weight);
  textElement.style.fontStyle = style;
  textElement.dataset.fontWeight = String(weight);
  textElement.dataset.fontStyle = style;
}

function applyTextAlignmentToElement(textElement, textAlign = DEFAULT_TEXT_ALIGN) {
  if (!textElement) return;
  textElement.style.textAlign = textAlign;
  textElement.dataset.textAlign = textAlign;
}

function applyFontFamilyToElement(textElement, fontFamily = DEFAULT_FONT_FAMILY) {
  if (!textElement) return;
  textElement.style.fontFamily = fontFamily;
  textElement.dataset.fontFamily = fontFamily;
}

function applyFontSizeToElement(textElement, fontSize = DEFAULT_FONT_SIZE) {
  if (!textElement) return;
  textElement.style.fontSize = `${fontSize}px`;
  textElement.dataset.fontSize = fontSize;
}

// Function to detect available fonts using document.fonts API
async function getAvailableFonts() {
  try {
    // Check if document.fonts is available (modern browsers)
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
      const availableFonts = new Set();
      
      // Get all font faces
      for (const fontFace of document.fonts) {
        availableFonts.add(fontFace.family);
      }
      
      // Convert to array and sort
      const fontList = Array.from(availableFonts).sort();
      
      // Add common web-safe fonts if not already present
      const commonFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma'];
      for (const font of commonFonts) {
        if (!fontList.includes(font)) {
          fontList.unshift(font);
        }
      }
      
      return fontList;
    }
  } catch (error) {
    console.warn("[WB-E] Could not detect fonts:", error);
  }
  
  // Fallback to common web-safe fonts
  return [
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 
    'Verdana', 'Tahoma', 'Trebuchet MS', 'Arial Black', 'Impact'
  ];
}

/* ======================== End Font and Style Utilities ======================== */

function makeMiniButton(text, iconClass = null) {
  const button = document.createElement("button");
  if (iconClass) {
    const icon = document.createElement("i");
    icon.className = iconClass;
    icon.style.cssText = "font-size: 12px;";
    button.appendChild(icon);
  } else {
    button.textContent = text;
  }
  button.style.cssText = `
    width: 24px;
    height: 24px;
    border: 1px solid #666;
    background: #f0f0f0;
    color: #333;
    font-size: 12px;
    font-weight: bold;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  `;
  return button;
}

function setMiniActive(button, isActive) {
  if (isActive) {
    button.style.background = "#4a9eff";
    button.style.color = "white";
    button.style.borderColor = "#4a9eff";
  } else {
    button.style.background = "#f0f0f0";
    button.style.color = "#333";
    button.style.borderColor = "#666";
  }
}

function applyBorderDataToElement(textElement, borderColor, borderWidth) {
  if (!textElement) return;
  const width = clamp(Number(borderWidth) || 0, 0, 20);
  const { hex, opacity } = rgbaToHexOpacity(borderColor, textElement.dataset.borderHex || DEFAULT_BORDER_HEX, Number(textElement.dataset.borderOpacity || DEFAULT_BORDER_OPACITY));
  updateBorderStyle(textElement, { hexColor: hex, opacity, width });
}

function extractTextState(id, textElement, container, options = {}) {
  if (!textElement || !container) return null;
  const transform = textElement.style.transform || "";
  const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
  const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

  const fontWeight = normalizeFontWeight(textElement.dataset.fontWeight || textElement.style.fontWeight || getComputedStyle(textElement).fontWeight);
  const fontStyle = normalizeFontStyle(textElement.dataset.fontStyle || textElement.style.fontStyle || getComputedStyle(textElement).fontStyle);
  const textAlign = textElement.dataset.textAlign || textElement.style.textAlign || DEFAULT_TEXT_ALIGN;
  const fontFamily = textElement.dataset.fontFamily || textElement.style.fontFamily || getComputedStyle(textElement).fontFamily || DEFAULT_FONT_FAMILY;
  const fontSize = parseInt(textElement.dataset.fontSize || textElement.style.fontSize || getComputedStyle(textElement).fontSize || DEFAULT_FONT_SIZE);

  const borderWidth = Number(textElement.dataset.borderWidth || DEFAULT_BORDER_WIDTH);
  const borderColor = borderWidth > 0
    ? (textElement.dataset.borderRgba || textElement.style.borderColor || null)
    : null;
  const left = parseFloat(container.style.left);
  const top = parseFloat(container.style.top);
  const width = textElement.style.width ? parseFloat(textElement.style.width) : null;
  
  // EXPERIMENT PHASE 1: Manager is single source of truth for z-index
  // DOM is just a view that _syncDOMZIndex keeps in sync
  // This eliminates DOM as competing source of truth and prevents flicker
  const zIndex = ZIndexManager.get(id);
  const rank = ZIndexManager.getRank(id);

  // Get text from span if it exists, otherwise from textElement
  const textSpan = textElement.querySelector(".wbe-text-background-span");
  const text = textSpan ? textSpan.textContent : textElement.textContent;
  
  // Read background color from span if it exists, otherwise transparent (never from textElement)
  let backgroundColor = "transparent";
  if (textSpan) {
    const spanBg = getComputedStyle(textSpan).backgroundColor || textSpan.style.backgroundColor;
    backgroundColor = spanBg && spanBg !== "transparent" && spanBg !== "rgba(0, 0, 0, 0)" ? spanBg : "transparent";
  }
  
  return {
    text: text,
    left: Number.isFinite(left) ? left : 0,
    top: Number.isFinite(top) ? top : 0,
    scale,
    color: textElement.style.color || DEFAULT_TEXT_COLOR,
    backgroundColor: backgroundColor,
    fontWeight,
    fontStyle,
    textAlign,
    fontFamily,
    fontSize,
    borderColor,
    borderWidth,
    width,
    zIndex: zIndex,
    rank: rank
  };
}

// Debounce function for batching rapid updates
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Pending state updates queue (keyed by object ID)
const pendingTextUpdates = new Map();

function logDuplicateZIndexesInTextPayload(prefix, payload) {
  const debugEnabled = typeof window !== 'undefined' && !!window.WBE_DEBUG_ZINDEX;
  if (!debugEnabled) {
    return;
  }
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const buckets = new Map();
  Object.entries(payload).forEach(([id, data]) => {
    if (!data) return;
    const zIndex = Number(data.zIndex);
    if (!Number.isFinite(zIndex)) return;
    if (!buckets.has(zIndex)) {
      buckets.set(zIndex, []);
    }
    buckets.get(zIndex).push(id);
  });

  const collisions = [];
  buckets.forEach((ids, zIndex) => {
    if (ids.length > 1) {
      collisions.push({ zIndex, ids, sample: ids.slice(0, 5) });
    }
  });

  if (collisions.length > 0) {
    console.error(`[WB-E] ${prefix}: 🚨 Payload contains duplicate z-index assignments`, {
      timestamp: Date.now(),
      collisions,
      totalCollisions: collisions.length
    });
  }
}

// Z-index operations are now queued at the ZIndexManager level in main.mjs

// Debounced function to flush all pending text updates
const debouncedFlushTextUpdates = debounce(async () => {
  if (pendingTextUpdates.size === 0) return;
  
  const pendingIds = Array.from(pendingTextUpdates.keys());
  console.log(`[WB-E] debouncedFlushTextUpdates: Flushing ${pendingTextUpdates.size} pending updates:`, pendingIds.slice(0, 5));
  
  // CRITICAL FIX: Build complete state from DOM FIRST (source of truth during rapid updates)
  // Then merge with DB state, then apply pending updates
  const texts = {};
  
  // First, extract ALL texts from DOM (most reliable source during rapid updates)
  const layer = document.getElementById('whiteboard-experience-layer') ||
                document.querySelector('.wbe-layer') || 
                document.getElementById('board')?.parentElement?.querySelector('#whiteboard-experience-layer') ||
                document.querySelector('[class*="wbe-layer"]');
  let domExtractedCount = 0;
  if (layer) {
    const existingContainers = layer.querySelectorAll('.wbe-canvas-text-container');
    const domIds = Array.from(existingContainers).map(c => c.id);
    console.log(`[WB-E] debouncedFlushTextUpdates: DOM has ${domIds.length} elements:`, domIds.slice(0, 5));
    
    existingContainers.forEach(existingContainer => {
      const existingId = existingContainer.id;
      if (existingId) {
        const existingTextElement = existingContainer.querySelector('.wbe-canvas-text');
        if (existingTextElement) {
          const existingState = extractTextState(existingId, existingTextElement, existingContainer);
          if (existingState) {
            texts[existingId] = existingState;
            domExtractedCount++;
          }
        }
      }
    });
  }
  
  // EXPERIMENT PHASE 1: Don't merge DB state - Manager already has all objects
  // DB is just for persistence, not a source of truth
  // If an object is missing from DOM, it was deleted - trust that
  
  // Apply all pending updates (these override DOM)
  pendingTextUpdates.forEach((state, id) => {
    texts[id] = state;
  });
  
  const finalIds = Object.keys(texts);
  console.log(`[WB-E] debouncedFlushTextUpdates: Final state has ${finalIds.length} texts (${domExtractedCount} from DOM):`, finalIds.slice(0, 5));
  
  logDuplicateZIndexesInTextPayload('debouncedFlushTextUpdates', texts);

  // Clear pending updates
  pendingTextUpdates.clear();
  
  // Send complete state
  await setAllTexts(texts);
}, 200); // 200ms debounce for rapid z-index changes

async function persistTextState(id, textElement, container, options = {}) {
  if (!id || !textElement || !container) return;
  const state = extractTextState(id, textElement, container, options);
  if (!state) return;
  
  // Queue the update for debounced batching
  pendingTextUpdates.set(id, state);
  
  // Trigger debounced flush (will batch multiple rapid changes)
  debouncedFlushTextUpdates();
}

async function persistSwappedZIndexTarget(swappedId) {
  if (!swappedId) return;

  const swappedContainer = document.getElementById(swappedId);
  if (!swappedContainer) return;

  if (swappedId.startsWith('wbe-text-')) {
    const swappedTextElement = swappedContainer.querySelector('.wbe-canvas-text');
    if (swappedTextElement) {
      await persistTextState(swappedId, swappedTextElement, swappedContainer);
    }
    return;
  }

  if (swappedId.startsWith('wbe-image-')) {
    const swappedImageElement = swappedContainer.querySelector('.wbe-canvas-image');
    const persistImage = window.ImageTools?.persistImageState;
    if (swappedImageElement && typeof persistImage === 'function') {
      await persistImage(swappedId, swappedImageElement, swappedContainer);
    }
  }
}

/* ======================== Color Picker System ======================== */

function killColorPanel() {
  cancelPendingColorPicker();
  const p = window.wbeColorPanel;
  if (p && typeof p.cleanup === "function") {
    try { p.cleanup(); } catch {}
  }
}

function destroyTextElementById(id) {
  const dispose = disposers.get(id);
  if (dispose) {
    try { dispose(); } catch {}
    disposers.delete(id);
  }
  const el = document.getElementById(id);
  if (el) el.remove();
  
  // FIX: Remove z-index from manager
  ZIndexManager.remove(id);
  
  killColorPanel(); // ensure stray panel listeners are gone
}

// Global showColorPicker function
async function showColorPicker() {
  if (!selectedTextId) return;

  const container = document.getElementById(selectedTextId);
  const textElement = container?.querySelector(".wbe-canvas-text");
  if (!textElement) return;

  killColorPanel();

  const computed = getComputedStyle(textElement);
  const textColorInfo = rgbaToHexOpacity(
    computed.color || textElement.style.color || DEFAULT_TEXT_COLOR,
    DEFAULT_TEXT_COLOR,
    100
  );
  // Read background color from span if it exists, otherwise from textElement
  const textSpan = textElement.querySelector(".wbe-text-background-span");
  const bgColorSource = textSpan || textElement;
  const bgComputed = getComputedStyle(bgColorSource);
  const backgroundColorInfo = rgbaToHexOpacity(
    bgComputed.backgroundColor || bgColorSource.style.backgroundColor || DEFAULT_SPAN_BACKGROUND_COLOR,
    DEFAULT_SPAN_BACKGROUND_COLOR,
    0
  );
  const currentBorderWidth = Number(textElement.dataset.borderWidth || DEFAULT_BORDER_WIDTH);
  const borderColorInfo = rgbaToHexOpacity(
    currentBorderWidth > 0 ? (textElement.dataset.borderRgba || computed.borderColor || null) : null,
    textElement.dataset.borderHex || DEFAULT_BORDER_HEX,
    Number(textElement.dataset.borderOpacity || DEFAULT_BORDER_OPACITY)
  );

  const panel = document.createElement("div");
  panel.className = "wbe-color-picker-panel";
  panel.style.cssText = `
    position: fixed;
    background: white;
    border: 1px solid #d7d7d7;
    border-radius: 14px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
    padding: 6px;
    z-index: ${ZIndexConstants.TEXT_COLOR_PICKER};
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    
    aspect-ratio: 4 / 1;
    transform: translateX(-50%) scale(0.9) translateY(12px);
    opacity: 0;
    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;

  const toolbar = document.createElement("div");
  toolbar.style.cssText = `
    display: flex;
    gap: 12px;
    position: relative;
  `;

  const setButtonActive = (button, isActive) => {
    if (!button) return;
    if (isActive) {
      button.dataset.active = "1";
      button.style.background = "#e0ebff";
      button.style.borderColor = "#4d8dff";
      button.style.color = "#1a3f8b";
    } else {
      button.dataset.active = "0";
      button.style.background = "#f5f5f7";
      button.style.borderColor = "#d2d2d8";
      button.style.color = "#333";
    }
  };

  const makeToolbarButton = (label, iconClass) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wbe-color-toolbar-btn";
    btn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 40px;
      padding: 0;
      border-radius: 10px;
      border: 1px solid #d2d2d8;
      background: #f5f5f7;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
    `;
    btn.dataset.active = "0";
    btn.title = label;

    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.cssText = "font-size: 18px;";
      btn.appendChild(icon);
    }

    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active === "1") return;
      btn.style.background = "#ededf8";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active === "1") return;
      setButtonActive(btn, false);
    });

    return btn;
  };

  const makeSwatch = (hex, size = 30) => {
    const swatch = document.createElement("div");
    swatch.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
      cursor: pointer;
      background: ${hex};
      position: relative;
      overflow: hidden;
    `;
    return swatch;
  };

  const createSlider = (value, { min, max, step = 1, format = (v) => `${Math.round(v)}%` }) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
    `;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = `
      flex: 1;
      height: 6px;
    `;

    const label = document.createElement("span");
    label.textContent = format(Number(value));
    label.style.cssText = `
      font-size: 12px;
      color: #555;
      width: 48px;
      text-align: right;
    `;

    wrapper.appendChild(slider);
    wrapper.appendChild(label);

    return { wrapper, slider, label, update: (v) => { label.textContent = format(Number(v)); } };
  };

  const applyTextColor = async (hex, opacity) => {
    const rgba = hexToRgba(hex, opacity) || hex;
    textElement.style.color = rgba;
    await persistTextState(selectedTextId, textElement, container);
  };

  const applyBackgroundColor = async (hex, opacity) => {
    const rgba = hexToRgba(hex, opacity) || hex;
    // Apply to span only - never touch textElement background
    const textSpan = textElement.querySelector(".wbe-text-background-span");
    if (textSpan) {
      textSpan.style.backgroundColor = rgba;
    }
    await persistTextState(selectedTextId, textElement, container);
  };

  const applyBorder = async (hex, opacity, width) => {
    updateBorderStyle(textElement, { hexColor: hex, opacity, width });
    await persistTextState(selectedTextId, textElement, container);
  };

  let activeSubpanel = null;
  let activeButton = null;

  const closeSubpanel = () => {
    if (activeSubpanel) activeSubpanel.remove();
    if (activeButton) setButtonActive(activeButton, false);
    activeSubpanel = null;
    activeButton = null;
  };

  const positionSubpanel = () => {
    if (!activeSubpanel || !activeButton) return;
    const left = activeButton.offsetLeft + activeButton.offsetWidth / 2;
    activeSubpanel.style.left = `${left}px`;
    activeSubpanel.style.top = `-${activeSubpanel.offsetHeight + 10}px`;
  };

  const buildTextSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Text";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 12px;";
    sub.appendChild(row);

    const swatch = makeSwatch(textColorInfo.hex);
    row.appendChild(swatch);

    const textColorInput = document.createElement("input");
    textColorInput.type = "color";
    textColorInput.value = textColorInfo.hex;
    textColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(textColorInput);

    const { wrapper: sliderRow, slider, update: updateLabel } = createSlider(textColorInfo.opacity, { min: 0, max: 100 });
    row.appendChild(sliderRow);

    const fontControls = document.createElement("div");
    fontControls.style.cssText = "display: flex; gap: 8px;";
    sub.appendChild(fontControls);

    const boldBtn = makeMiniButton("B");
    const italicBtn = makeMiniButton("I");
    const regularBtn = makeMiniButton("Aa");
    const textAlignLeftBtn = makeMiniButton("", "fas fa-align-left");
    const textAlignCenterBtn = makeMiniButton("", "fas fa-align-center");
    const textAlignRightBtn = makeMiniButton("", "fas fa-align-right");

    const computedFont = getComputedStyle(textElement);
    let isBold = normalizeFontWeight(textElement.dataset.fontWeight || textElement.style.fontWeight || computedFont.fontWeight) >= 600;
    let isItalic = normalizeFontStyle(textElement.dataset.fontStyle || textElement.style.fontStyle || computedFont.fontStyle) === "italic";
    let currentTextAlign = textElement.dataset.textAlign || textElement.style.textAlign || DEFAULT_TEXT_ALIGN;
    let currentFontFamily = textElement.dataset.fontFamily || textElement.style.fontFamily || computedFont.fontFamily || DEFAULT_FONT_FAMILY;
    let currentFontSize = parseInt(textElement.dataset.fontSize || textElement.style.fontSize || computedFont.fontSize || DEFAULT_FONT_SIZE);

    const syncFontButtons = () => {
      setMiniActive(boldBtn, isBold);
      setMiniActive(italicBtn, isItalic);
      setMiniActive(regularBtn, !isBold && !isItalic);
    };

    const syncAlignmentButtons = () => {
      setMiniActive(textAlignLeftBtn, currentTextAlign === "left");
      setMiniActive(textAlignCenterBtn, currentTextAlign === "center");
      setMiniActive(textAlignRightBtn, currentTextAlign === "right");
    };

    const applyFontSelection = async () => {
      const weight = isBold ? 700 : DEFAULT_FONT_WEIGHT;
      const style = isItalic ? "italic" : DEFAULT_FONT_STYLE;
      applyFontVariantToElement(textElement, weight, style);
      await persistTextState(selectedTextId, textElement, container);
      syncFontButtons();
    };

    const applyAlignmentSelection = async (alignment) => {
      currentTextAlign = alignment;
      applyTextAlignmentToElement(textElement, alignment);
      await persistTextState(selectedTextId, textElement, container);
      syncAlignmentButtons();
    };

    const applyFontFamilySelection = async (fontFamily) => {
      currentFontFamily = fontFamily;
      applyFontFamilyToElement(textElement, fontFamily);
      await persistTextState(selectedTextId, textElement, container);
    };

    const applyFontSizeSelection = async (fontSize) => {
      currentFontSize = fontSize;
      applyFontSizeToElement(textElement, fontSize);
      await persistTextState(selectedTextId, textElement, container);
    };

    boldBtn.addEventListener("click", async () => {
      isBold = !isBold;
      await applyFontSelection();
    });

    italicBtn.addEventListener("click", async () => {
      isItalic = !isItalic;
      await applyFontSelection();
    });

    regularBtn.addEventListener("click", async () => {
      isBold = false;
      isItalic = false;
      await applyFontSelection();
    });

    textAlignLeftBtn.addEventListener("click", async () => {
      await applyAlignmentSelection("left");
    });

    textAlignCenterBtn.addEventListener("click", async () => {
      await applyAlignmentSelection("center");
    });

    textAlignRightBtn.addEventListener("click", async () => {
      await applyAlignmentSelection("right");
    });

    fontControls.appendChild(regularBtn);
    fontControls.appendChild(boldBtn);
    fontControls.appendChild(italicBtn);
    fontControls.appendChild(textAlignLeftBtn);
    fontControls.appendChild(textAlignCenterBtn);
    fontControls.appendChild(textAlignRightBtn);
    syncFontButtons();
    syncAlignmentButtons();

    // Font family dropdown
    const fontFamilyRow = document.createElement("div");
    fontFamilyRow.style.cssText = "display: flex; align-items: center; gap: 8px;";
    sub.appendChild(fontFamilyRow);

    const fontLabel = document.createElement("span");
    fontLabel.textContent = "Font:";
    fontLabel.style.cssText = "font-size: 12px; color: #555; min-width: 40px;";
    fontFamilyRow.appendChild(fontLabel);

    const fontSelect = document.createElement("select");
    fontSelect.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      border: 1px solid #d0d0d0;
      border-radius: 6px;
      background: white;
      font-size: 12px;
      color: #333;
      cursor: pointer;
    `;
    fontFamilyRow.appendChild(fontSelect);

    // Populate font dropdown
    const populateFontDropdown = async () => {
      const availableFonts = await getAvailableFonts();
      fontSelect.innerHTML = '';
      
      for (const font of availableFonts) {
        const option = document.createElement("option");
        option.value = font;
        option.textContent = font;
        option.style.fontFamily = font;
        if (font === currentFontFamily) {
          option.selected = true;
        }
        fontSelect.appendChild(option);
      }
    };

    // Set initial font and populate dropdown
    fontSelect.value = currentFontFamily;
    populateFontDropdown();

    // Handle font change
    fontSelect.addEventListener("change", async (e) => {
      await applyFontFamilySelection(e.target.value);
    });

    // Font size slider
    const fontSizeRow = document.createElement("div");
    fontSizeRow.style.cssText = "display: flex; align-items: center; gap: 8px;";
    sub.appendChild(fontSizeRow);

    const fontSizeLabel = document.createElement("span");
    fontSizeLabel.textContent = "Size:";
    fontSizeLabel.style.cssText = "font-size: 12px; color: #555; min-width: 40px;";
    fontSizeRow.appendChild(fontSizeLabel);

    const { wrapper: fontSizeSliderRow, slider: fontSizeSlider, update: updateFontSizeLabel } = createSlider(currentFontSize, {
      min: 8,
      max: 72,
      step: 1,
      format: (v) => `${Math.round(v)}px`
    });
    fontSizeRow.appendChild(fontSizeSliderRow);

    // Handle font size change
    fontSizeSlider.addEventListener("input", (e) => {
      updateFontSizeLabel(e.target.value);
      // Only update visual feedback during dragging, don't persist yet
    });
    fontSizeSlider.addEventListener("change", async (e) => {
      updateFontSizeLabel(e.target.value);
      await applyFontSizeSelection(Number(e.target.value));
    });

    swatch.addEventListener("click", () => textColorInput.click());
    textColorInput.addEventListener("change", async (e) => {
      swatch.style.background = e.target.value;
      await applyTextColor(e.target.value, Number(slider.value));
    });
    slider.addEventListener("input", (e) => {
      updateLabel(e.target.value);
      // Only update visual feedback during dragging, don't persist yet
    });
    slider.addEventListener("change", async (e) => {
      updateLabel(e.target.value);
      await applyTextColor(textColorInput.value, Number(e.target.value));
    });

    return sub;
  };

  const buildBackgroundSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Background";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 12px;";
    sub.appendChild(row);

    const swatch = makeSwatch(backgroundColorInfo.hex);
    row.appendChild(swatch);

    const bgColorInput = document.createElement("input");
    bgColorInput.type = "color";
    bgColorInput.value = backgroundColorInfo.hex;
    bgColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(bgColorInput);

    const { wrapper: sliderRow, slider, update: updateLabel } = createSlider(backgroundColorInfo.opacity, { min: 0, max: 100 });
    row.appendChild(sliderRow);

    swatch.addEventListener("click", () => bgColorInput.click());
    bgColorInput.addEventListener("change", async (e) => {
      swatch.style.background = e.target.value;
      await applyBackgroundColor(e.target.value, Number(slider.value));
    });
    slider.addEventListener("input", (e) => {
      updateLabel(e.target.value);
      // Only update visual feedback during dragging, don't persist yet
    });
    slider.addEventListener("change", async (e) => {
      updateLabel(e.target.value);
      await applyBackgroundColor(bgColorInput.value, Number(e.target.value));
    });

    return sub;
  };

  const buildBorderSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Border";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 12px;";
    sub.appendChild(row);

    const swatch = makeSwatch(borderColorInfo.hex);
    swatch.style.opacity = currentBorderWidth > 0 ? "1" : "0.45";
    row.appendChild(swatch);

    const borderColorInput = document.createElement("input");
    borderColorInput.type = "color";
    borderColorInput.value = borderColorInfo.hex;
    borderColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(borderColorInput);

    const { wrapper: opacityRow, slider: opacitySlider, update: updateOpacityLabel } = createSlider(borderColorInfo.opacity, { min: 0, max: 100 });
    row.appendChild(opacityRow);

    const { wrapper: widthRow, slider: widthSlider, update: updateWidthLabel } = createSlider(currentBorderWidth, {
      min: 0,
      max: 12,
      step: 1,
      format: (v) => {
        const numeric = Number(v) || 0;
        return `${Math.round(numeric)}px`;
      }
    });
    sub.appendChild(widthRow);

    const sync = async () => {
      const width = Number(widthSlider.value);
      const opacity = Number(opacitySlider.value);
      updateOpacityLabel(opacity);
      updateWidthLabel(width);
      swatch.style.opacity = width > 0 ? "1" : "0.45";
      await applyBorder(borderColorInput.value, opacity, width);
    };

    swatch.addEventListener("click", () => borderColorInput.click());
    borderColorInput.addEventListener("change", async (e) => {
      swatch.style.background = e.target.value;
      await sync();
    });
    opacitySlider.addEventListener("input", () => {
      updateOpacityLabel(Number(opacitySlider.value));
      updateWidthLabel(Number(widthSlider.value));
      swatch.style.opacity = Number(widthSlider.value) > 0 ? "1" : "0.45";
      // Only update visual feedback during dragging, don't persist yet
    });
    widthSlider.addEventListener("input", () => {
      updateOpacityLabel(Number(opacitySlider.value));
      updateWidthLabel(Number(widthSlider.value));
      swatch.style.opacity = Number(widthSlider.value) > 0 ? "1" : "0.45";
      // Only update visual feedback during dragging, don't persist yet
    });
    opacitySlider.addEventListener("change", sync);
    widthSlider.addEventListener("change", sync);

    return sub;
  };

  const openSubpanel = (type, button) => {
    if (activeButton === button) {
      closeSubpanel();
      return;
    }

    closeSubpanel();

    let subpanel = null;
    if (type === "text") subpanel = buildTextSubpanel();
    else if (type === "background") subpanel = buildBackgroundSubpanel();
    else if (type === "border") subpanel = buildBorderSubpanel();

    if (!subpanel) return;

    subpanel.style.opacity = "0";
    subpanel.style.transform = "translateY(-8px)";
    panel.appendChild(subpanel);

    activeSubpanel = subpanel;
    activeButton = button;
    setButtonActive(button, true);
    positionSubpanel();

    requestAnimationFrame(() => {
      if (!activeSubpanel) return;
      activeSubpanel.style.transition = "opacity 0.16s ease, transform 0.16s ease";
      activeSubpanel.style.opacity = "1";
      activeSubpanel.style.transform = "translateY(0)";
    });
  };

  const textBtn = makeToolbarButton("Text", "fas fa-font");
  const bgBtn = makeToolbarButton("Background", "fas fa-fill");
  const borderBtn = makeToolbarButton("Border", "fas fa-border-all");

  setButtonActive(textBtn, false);
  setButtonActive(bgBtn, false);
  setButtonActive(borderBtn, false);

  textBtn.addEventListener("click", () => openSubpanel("text", textBtn));
  bgBtn.addEventListener("click", () => openSubpanel("background", bgBtn));
  borderBtn.addEventListener("click", () => openSubpanel("border", borderBtn));

  toolbar.appendChild(textBtn);
  toolbar.appendChild(bgBtn);
  toolbar.appendChild(borderBtn);
  panel.appendChild(toolbar);
  document.body.appendChild(panel);

  const updatePanelPosition = () => {
    const rect = textElement.getBoundingClientRect();
    panel.style.left = `${rect.left + rect.width / 2}px`;
    panel.style.top = `${rect.top - 110}px`;
    positionSubpanel();
  };

  updatePanelPosition();
  requestAnimationFrame(() => {
    panel.style.transform = "translateX(-50%) scale(.9) translateY(32px)";
    panel.style.opacity = "1";
  });

  const onOutside = (ev) => {
    if (panel.contains(ev.target)) return;

    const activeContainer = selectedTextId ? document.getElementById(selectedTextId) : null;
    const clickedInsideText = activeContainer?.contains(ev.target);

    if (activeSubpanel) {
      closeSubpanel();
      window.wbeColorPanelUpdate?.();
    }

    if (clickedInsideText) {
      window.wbeColorPanelUpdate?.();
      return;
    }

    if (activeContainer) skipNextTextDeselect = true;
    cleanup();
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") cleanup();
  };

  panel.addEventListener("mousedown", (ev) => ev.stopPropagation());
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);

  function cleanup() {
    try { document.removeEventListener("mousedown", onOutside, true); } catch {}
    document.removeEventListener("keydown", onKey);
    closeSubpanel();
    panel.remove();
    window.wbeColorPanel = null;
    window.wbeColorPanelUpdate = null;
  }

  panel.cleanup = cleanup;
  window.wbeColorPanel = panel;
  window.wbeColorPanelUpdate = updatePanelPosition;
}

function safeReshowColorPicker(targetId, delayMs = 0) {
  cancelPendingColorPicker();
  const open = async () => {
    const el = document.getElementById(targetId);
    if (!el) return;
    // Reassert selection target in case other handlers nulled it
    selectedTextId = targetId;

    await showColorPicker();
  };

  if (delayMs <= 0) {
    pendingColorPickerRaf = requestAnimationFrame(() => {
      pendingColorPickerRaf = requestAnimationFrame(() => {
        pendingColorPickerRaf = null;
        open();
      });
    });
  } else {
    pendingColorPickerTimeout = setTimeout(() => {
      pendingColorPickerTimeout = null;
      pendingColorPickerRaf = requestAnimationFrame(() => {
        pendingColorPickerRaf = requestAnimationFrame(() => {
          pendingColorPickerRaf = null;
          open();
        });
      });
    }, delayMs);
  }
}

// Install global pan hooks (module scope, once)
let __wbePanHooksInstalled = false;

function installGlobalPanHooks() {
  if (__wbePanHooksInstalled) return;
  __wbePanHooksInstalled = true;

  let isCanvasPanningGlobal = false;

  // Start pan on ANY right-button down; close panel immediately
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (e.target.closest(".wbe-canvas-text-container")) {
      // If you want to keep the panel when RMB starts ON the text, comment this line:
      killColorPanel();
    } else {
      killColorPanel();
    }
    isCanvasPanningGlobal = true;
  }, true);

  // On pan end, reopen for the currently selected text (if any)
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    if (!isCanvasPanningGlobal) return;
    isCanvasPanningGlobal = false;

    if (selectedTextId && !window.wbeColorPanel) {
      // Give the canvas a tick to settle transforms
      safeReshowColorPicker(selectedTextId, 100);
    }
  }, true);

  // Zoom wheel should also temporarily hide + then restore
  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    if (!selectedTextId) return;
    killColorPanel();
    safeReshowColorPicker(selectedTextId, 150);
  }, { passive: true });
}

// call this once, after defining killColorPanel/safeReshowColorPicker
installGlobalPanHooks();

/* ======================== End Color Picker System ======================== */

// Global text mode key handler
let textModeKeyHandler = null;

function installTextModeKeys() {
  if (textModeKeyHandler) return;
  
  textModeKeyHandler = (e) => {
    // T key to toggle text mode - use keyCode for international support
    if (e.keyCode === 84) { // KeyCode 84 is 'T' in any language
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Don't interfere with shortcuts
      
      // CRITICAL FIX: Ignore T-key when user is editing text
      // Check if any text element is currently being edited
      const activeElement = document.activeElement;
      if (activeElement && activeElement.contentEditable === "true") {
        return; // Don't interfere with text editing!
      }
      
      // Also check selected text element as backup
      if (selectedTextId) {
        const container = document.getElementById(selectedTextId);
        const textElement = container?.querySelector(".wbe-canvas-text");
        if (textElement && textElement.contentEditable === "true") {
          return; // Don't interfere with text editing!
        }
      }
      
      e.preventDefault();
      
      if (isTextMode) {
        exitTextMode();
      } else {
        enterTextMode();
      }
    }
  };
  
  document.addEventListener("keydown", textModeKeyHandler);
}

// Install text mode keys
installTextModeKeys();

// Right-click handler to exit text mode
let textModeMouseHandler = null;

function installTextModeMouseHandler() {
  if (textModeMouseHandler) return;
  
  let rightClickStartX = 0;
  let rightClickStartY = 0;
  let isRightClickDragging = false;
  
  textModeMouseHandler = (e) => {
    if (!isTextMode) return;
    
    // Right mouse button down - start tracking
    if (e.button === 2 && e.type === "mousedown") {
      rightClickStartX = e.clientX;
      rightClickStartY = e.clientY;
      isRightClickDragging = false;
    }
    
    // Mouse move during right click - check if dragging
    if (e.type === "mousemove" && e.buttons === 2) {
      const deltaX = Math.abs(e.clientX - rightClickStartX);
      const deltaY = Math.abs(e.clientY - rightClickStartY);
      if (deltaX > 3 || deltaY > 3) {
        isRightClickDragging = true;
      }
    }
    
    // Right mouse button up - exit text mode if not dragging
    if (e.button === 2 && e.type === "mouseup") {
      if (!isRightClickDragging) {
        exitTextMode();
      }
      isRightClickDragging = false;
    }
  };
  
  document.addEventListener("mousedown", textModeMouseHandler);
  document.addEventListener("mouseup", textModeMouseHandler);
  document.addEventListener("mousemove", textModeMouseHandler);
}

// Install text mode mouse handler
installTextModeMouseHandler();

// Canvas click handler for text mode
let canvasClickHandler = null;

function installCanvasTextModeHandler() {
  if (canvasClickHandler) return;
  
  canvasClickHandler = (e) => {
    if (!isTextMode) return;
    
    // Only handle left clicks
    if (e.button !== 0) return;
    
    // Don't create text if clicking on existing elements
    if (e.target.closest(".wbe-canvas-text-container") || 
        e.target.closest(".wbe-color-picker-panel")) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Create text in text mode with auto-edit
    addTextToCanvas(e.clientX, e.clientY, true);
    
    // Exit text mode after creating text
    exitTextMode();
  };
  
  // Listen for clicks on the canvas layer
  document.addEventListener("mousedown", canvasClickHandler, true);
}

// Install canvas text mode handler
installCanvasTextModeHandler();
// Глобальная функция вставки текста
async function globalPasteText() {
    if (!copiedTextData) return;
    
    // Конвертируем screen → world coordinates (через Pixi.js)
    const { lastMouseX, lastMouseY } = getSharedVars();
    const worldPos = screenToWorld(lastMouseX, lastMouseY);
    
    const newTextId = `wbe-text-${Date.now()}`;
    const container = createTextElement(
      newTextId,
      copiedTextData.text,
      worldPos.x,
      worldPos.y,
      copiedTextData.scale ?? DEFAULT_TEXT_SCALE,
      copiedTextData.color || DEFAULT_TEXT_COLOR,
      copiedTextData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
      copiedTextData.borderColor || null,
      copiedTextData.borderWidth ?? DEFAULT_BORDER_WIDTH,
      copiedTextData.fontWeight || DEFAULT_FONT_WEIGHT,
      copiedTextData.fontStyle || DEFAULT_FONT_STYLE,
      copiedTextData.textAlign || DEFAULT_TEXT_ALIGN,
      copiedTextData.fontFamily || DEFAULT_FONT_FAMILY,
      copiedTextData.fontSize || DEFAULT_FONT_SIZE,
      copiedTextData.width || null
    );
    if (!container) return;
    const textEl = container.querySelector(".wbe-canvas-text");
    if (!textEl) return;
    await persistTextState(newTextId, textEl, container);
    
    // LOG: Track global text paste with z-index
    const zIndex = ZIndexManager.get(newTextId);
    console.log(`[Text Paste] ID: ${newTextId} | z-index: ${zIndex} (global paste)`);
    
}

async function handleTextPasteFromClipboard(text) {
  try {
    // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
    setCopiedImageData(null);
    copiedTextData = null;
    
    // Конвертируем позицию курсора в world coordinates
    const { lastMouseX, lastMouseY } = getSharedVars();
    const worldPos = screenToWorld(lastMouseX, lastMouseY);
    
    
    // Создаем новый текстовый элемент
    const textId = `wbe-text-${Date.now()}`;
    const container = createTextElement(textId, text, worldPos.x, worldPos.y, DEFAULT_TEXT_SCALE, DEFAULT_TEXT_COLOR, DEFAULT_BACKGROUND_COLOR, null, DEFAULT_BORDER_WIDTH, DEFAULT_FONT_WEIGHT, DEFAULT_FONT_STYLE, DEFAULT_TEXT_ALIGN, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, null);
    if (!container) return;
    const textEl = container.querySelector(".wbe-canvas-text");
    if (!textEl) return;
    await persistTextState(textId, textEl, container);
    
    // LOG: Track clipboard text paste with z-index
    const zIndex = ZIndexManager.get(textId);
    console.log(`[Text Paste] ID: ${textId} | z-index: ${zIndex} (clipboard paste)`);
    
    // Update container dimensions after paste
    updateTextUI(container);
    
  } catch (err) {
    console.error("[WB-E] Text paste error:", err);
    ui.notifications.error("Text paste error");
  }
}

async function injectTextTool() {
    const sc = ui.controls;
    if (!sc || !sc.controls) return;
  
    const groupsObj = sc.controls;
    const group =
      groupsObj.tokens || groupsObj.token || groupsObj.notes ||
      Object.values(groupsObj)[0];
  
    if (!group) return;
  
    const toolName = "wbe-text-tool";
    const tool = {
      name: toolName,
      title: "Добавить текст на стол",
      icon: "fas fa-font",
      button: true,
      onChange: async () => {
        const { lastClickX, lastClickY } = getSharedVars();
        await addTextToCanvas(lastClickX, lastClickY);
      }
    };
  
    const t = group.tools;
    const exists = Array.isArray(t) ? t.some(x => x?.name === toolName) : t?.[toolName];
    if (exists) return;
  
    if (Array.isArray(t)) t.push(tool);
    else if (t && typeof t === "object") {
      t[toolName] = tool;
      if (Array.isArray(group._toolOrder)) group._toolOrder.push(toolName);
    } else group.tools = [tool];
  
    await sc.render?.(true);
    
    // Отслеживаем клики на кнопке инструмента
    setTimeout(() => {
      const toolButton = document.querySelector(`[data-tool="${toolName}"]`);
      if (toolButton && !toolButton.dataset.wbeTextListener) {
        toolButton.addEventListener("click", (e) => {
          setLastClickX(e.clientX);
          setLastClickY(e.clientY);
        });
        toolButton.dataset.wbeTextListener = "1";
      }
    }, 100);
}

function createTextElement(
    id,
    text,
    left,
    top,
    scale = DEFAULT_TEXT_SCALE,
    color = DEFAULT_TEXT_COLOR,
    backgroundColor = DEFAULT_BACKGROUND_COLOR,
    borderColor = null,
    borderWidth = DEFAULT_BORDER_WIDTH,
    fontWeight = DEFAULT_FONT_WEIGHT,
    fontStyle = DEFAULT_FONT_STYLE,
    textAlign = DEFAULT_TEXT_ALIGN,
    fontFamily = DEFAULT_FONT_FAMILY,
    fontSize = DEFAULT_FONT_SIZE,
    width = null,
    existingZIndex = null
  ) {
    const layer = getOrCreateLayer();
    if (!layer) return null;
    
    // Контейнер для позиционирования (БЕЗ translate)
    const container = document.createElement("div");
    container.id = id;
    container.className = "wbe-canvas-text-container";
    
    // FIX: Get z-index from manager
    // If existingZIndex is provided, the object should already be registered via syncWithExisting
    // But we check anyway to be safe - if not registered, assignText() will register it
    let zIndex;
    if (existingZIndex !== null && existingZIndex !== undefined) {
      // Object should already be registered by syncWithExisting, but check to be safe
      if (ZIndexManager.has && typeof ZIndexManager.has === 'function' && ZIndexManager.has(id)) {
        // Object is registered, use its current z-index from manager
        zIndex = ZIndexManager.get(id);
      } else {
        // Object not registered yet - assign new rank (will be corrected by syncAllDOMZIndexes if rank exists)
        // This can happen if syncWithExisting hasn't run yet or if object was added after migration
        zIndex = ZIndexManager.assignText(id);
      }
    } else {
      // No existing z-index provided - assign new rank (places at top)
      zIndex = ZIndexManager.assignText(id);
    }
    
    // LOG: Track text creation with z-index
    console.log(`[Text Creation] ID: ${id} | z-index: ${zIndex} ${existingZIndex ? '(existing provided, using manager)' : '(newly assigned)'}`);
    
    container.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      z-index: ${zIndex};
    `;
    
    // Внутренний элемент для контента + масштабирование
    const textElement = document.createElement("div");
    textElement.className = "wbe-canvas-text";
    textElement.contentEditable = "false";
    
    // Create span wrapper for text background
    const textSpan = document.createElement("span");
    textSpan.className = "wbe-text-background-span";
    textSpan.textContent = text;
    // Use provided backgroundColor or default to black
    const spanBgColor = backgroundColor && backgroundColor !== "transparent" && backgroundColor !== DEFAULT_BACKGROUND_COLOR 
      ? backgroundColor 
      : DEFAULT_SPAN_BACKGROUND_COLOR;
    textSpan.style.cssText = `
      display: inline;
      background-color: ${spanBgColor};
      padding: 4px 8px 4px 2px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      line-height: 1.68;
    `;
    
    textElement.appendChild(textSpan);
    
    textElement.style.cssText = `
      transform: scale(${scale});
      transform-origin: top left;
      background: transparent;
      color: ${color};
      padding: 0;
      border: none;
      font-size: 16px;
      font-weight: 400;
      user-select: none;
      min-width: 100px;
      text-align: left;
      overflow-wrap: break-word;
      word-wrap: break-word;
      word-break: break-word;
      overflow: hidden;
    
    `;
    
    // Apply width if it was manually set
    if (width && width > 0) {
      textElement.style.width = `${width}px`;
      textElement.dataset.manualWidth = "true"; // Mark as manually set
    }
    
    // Apply font weight and style
    applyFontVariantToElement(textElement, fontWeight, fontStyle);
    
    // Apply text alignment
    applyTextAlignmentToElement(textElement, textAlign);
    
    // Apply font family
    applyFontFamilyToElement(textElement, fontFamily);
    
    // Apply font size
    applyFontSizeToElement(textElement, fontSize);
    
    container.appendChild(textElement);
    layer.appendChild(container);
    applyBorderDataToElement(textElement, borderColor, borderWidth);
    
    // Resize handle (круглая точка) - в контейнере, позиционируется относительно textElement
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "wbe-text-resize-handle";
    resizeHandle.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 6px;
      height: 6px;
      display: none;
      background:rgb(255, 255, 255);
      border: 1px solid #4a9eff;
      border-radius: 50%;
      cursor: nwse-resize;
      z-index: ${ZIndexConstants.TEXT_RESIZE_HANDLE};
      pointer-events: auto;
      user-select: none;
      transform-origin: right center;
    `;
    container.appendChild(resizeHandle);
    
    // No separate resize handles - borders will be directly draggable
    
    // Color picker will be shown automatically when text is selected
    // No button needed - we'll trigger the color picker directly
    
    // Функция для обновления позиции handle относительно масштабированного textElement
    function updateHandlePosition() {
      // Читаем текущий scale
      const transform = textElement.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      // Получаем размеры textElement БЕЗ масштаба
      const width = textElement.offsetWidth;
      const height = textElement.offsetHeight;
      
      // Вычисляем позицию правого нижнего угла С УЧЁТОМ масштаба
      const scaledWidth = width * currentScale;
      const scaledHeight = height * currentScale;
      
      // Позиционируем resize handle в правом нижнем углу
      resizeHandle.style.left = `${scaledWidth + RESIZE_HANDLE_OFFSET_X}px`;
      resizeHandle.style.top = `${scaledHeight + RESIZE_HANDLE_OFFSET_Y}px`;
    }
    
    // Обработчики событий
    let isEditing = false;
    let isSelected = false;
    let dragging = false, dragInitialized = false, startScreenX = 0, startScreenY = 0, startWorldX = 0, startWorldY = 0;
    let resizing = false, resizeStartX = 0, resizeStartScale = scale;
    
    /* ======================== Edit and Lock ======================== */
    
    // Edit blur handler - exits edit mode when clicking outside
    const editBlurHandler = async (e) => {
      if (!isEditing) return;
      
      // Ignore if clicking on the text element itself or the span
      const textSpan = textElement.querySelector(".wbe-text-background-span");
      if (textElement.contains(e.target) || (textSpan && textSpan.contains(e.target))) return;
      
      // Ignore if clicking on color panel
      if (window.wbeColorPanel?.contains(e.target)) return;
      
      // Ignore if clicking on resize handle
      if (resizeHandle.contains(e.target)) return;
      
      // User clicked somewhere else in Foundry - exit edit mode
      await exitEditMode();
    };
    
    // NEW: Add exitEditMode function
    async function exitEditMode() {
      if (!isEditing) return;
      
      // Check if text is empty - delete if so
      const textSpan = textElement.querySelector(".wbe-text-background-span");
      const textContent = (textSpan ? textSpan.textContent : textElement.textContent).trim();
      if (textContent === "") {
        // Text is empty - delete it
        isEditing = false;
        
        // Exit contentEditable from span or textElement
        const editableElement = textSpan || textElement;
        editableElement.contentEditable = "false";
        editableElement.style.userSelect = "none";
        
        textElement.contentEditable = "false";
        textElement.style.userSelect = "none";
        
        // Remove the blur handler
        document.removeEventListener("mousedown", editBlurHandler, true);
        
        // Remove lock locally
        delete container.dataset.lockedBy;
        
        // Broadcast unlock before deletion
        game.socket.emit(`module.${MODID}`, {
          type: "textUnlock",
          textId: id
        });
        
        // Delete the text element
        const texts = await getAllTexts();
        delete texts[id];
        await setAllTexts(texts);
        
        // Destroy the element
        destroyTextElementById(id);
        
        return;
      }
      
      isEditing = false;
      
      // Exit contentEditable from span or textElement (reuse textSpan from above scope)
      const editableElement = textSpan || textElement;
      editableElement.contentEditable = "false";
      editableElement.style.userSelect = "none";
      
      textElement.contentEditable = "false";
      textElement.style.userSelect = "none";
      
      // Remove the blur handler
      document.removeEventListener("mousedown", editBlurHandler, true);

      // Remove lock locally
      delete container.dataset.lockedBy;
      
      
      
      // Broadcast unlock to all users
      game.socket.emit(`module.${MODID}`, {
        type: "textUnlock",
        textId: id
      });
      
      // Save changes (skip z-index read - it doesn't change during text editing)
      await persistTextState(id, textElement, container, { skipZIndex: true });
      
      // Return to selected state
      // CLEAR MASS SELECTION when exiting edit mode
      if (window.MassSelection && window.MassSelection.selectedCount > 0) {
        window.MassSelection.clear();
      }
      selectText();
      
      // Show scale gizmo again
      if (isSelected) {
        resizeHandle.style.display = "flex";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        
        setTimeout(() => {
          requestAnimationFrame(() => {
            resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
            resizeHandle.style.opacity = "1";
            resizeHandle.style.transform = "scale(1)";
          });
        }, 100);
      }
      
    }
    
    // Двойной клик для редактирования
    textElement.addEventListener("dblclick", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // NEW: Check if locked by another user
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        return;
      }
      
      // NEW: Toggle edit mode
      if (isEditing) {
        // Already editing - exit edit mode
        await exitEditMode();
        return;
      }
      
      // NEW: Enter edit mode with lock
      isEditing = true;
      
      // Get current dimensions for lock overlay
      const scale = getTextScale(textElement);
      const width = textElement.offsetWidth * scale;
      const height = textElement.offsetHeight * scale;
      
      // Broadcast lock to all users with dimensions
      game.socket.emit(`module.${MODID}`, {
        type: "textLock",
        textId: id,
        userId: game.user.id,
        userName: game.user.name,
        width: width,
        height: height
      });
      
      // Mark locked locally
      container.dataset.lockedBy = game.user.id;
      
      // Make span contentEditable if it exists, otherwise textElement
      const textSpan = textElement.querySelector(".wbe-text-background-span");
      const editableElement = textSpan || textElement;
      
      editableElement.contentEditable = "true";
      editableElement.style.userSelect = "text";
      editableElement.style.outline = "none";
      editableElement.focus();
      
      // Add the blur handler to detect clicks outside
      document.addEventListener("mousedown", editBlurHandler, true);
      
      // Hide color panel during editing
      killColorPanel();
      
      // Hide scale gizmo during editing with smooth animation
      if (resizeHandle.style.display !== "none") {
        resizeHandle.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
      }
      
      // Выделяем весь текст
      const range = document.createRange();
      range.selectNodeContents(editableElement);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      
    });

    // Завершение редактирования по Enter
    textElement.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        
        // Check if text is empty before exiting
        const textContent = textElement.textContent.trim();
        if (textContent === "") {
          // Text is empty - delete it
          isEditing = false;
          textElement.contentEditable = "false";
          textElement.style.userSelect = "none";
          
          // Remove the blur handler
          document.removeEventListener("mousedown", editBlurHandler, true);
          
          // Remove lock locally
          delete container.dataset.lockedBy;
          
          // Broadcast unlock before deletion
          game.socket.emit(`module.${MODID}`, {
            type: "textUnlock",
            textId: id
          });
          
          // Delete the text element
          const texts = await getAllTexts();
          delete texts[id];
          await setAllTexts(texts);
          
          // Destroy the element
          destroyTextElementById(id);
          
          return;
        }
        
        await exitEditMode();
      }
    });
    
    // Auto-expand width during typing
    textElement.addEventListener("input", async () => {
      if (isEditing) {
        // Check if width was manually set (not auto-expanded)
        const hasManualWidth = textElement.dataset.manualWidth === "true";
        
        if (!hasManualWidth) {
          // Only auto-expand if width wasn't manually set
          // Temporarily remove width constraint to measure natural width
          const currentWidth = textElement.style.width;
          textElement.style.width = "auto";
          
          // Get the natural width of the content
          const naturalWidth = textElement.scrollWidth;
          const minWidth = 100; // Minimum width
          const maxWidth = 800; // Maximum width to prevent excessive expansion
          
          // Set width to natural width, but within bounds
          const newWidth = Math.max(minWidth, Math.min(maxWidth, naturalWidth));
          textElement.style.width = `${newWidth}px`;
        }
        
        // Update panel position if it's open
        if (window.wbeColorPanelUpdate) {
          window.wbeColorPanelUpdate();
        }
        
        // Save the width change to sync with other clients
        //await persistTextState(id, textElement, container);
        
        // Update container dimensions after size change
        updateTextUI(container);
      }
    });

    /* ======================== End Edit and Lock ======================== */
    
    // Функция выделения/снятия выделения
    function selectText() {
      // PREVENT SELECTION OF MASS-SELECTED TEXT
      if (container.classList.contains("wbe-mass-selected")) {
        return; // Don't select mass-selected text individually
      }
      
      isSelected = true;
      selectedTextId = id; // Устанавливаем глобальный ID

      setSelectedImageId(null); // Сбрасываем выделение картинки
      
      // Clear any existing mass selection before individual selection
      if (window.MassSelection && window.MassSelection.selectedCount > 0) {
        window.MassSelection.clear();
      }
      
      // Register with mass selection system for keyboard handlers
      if (window.MassSelection && typeof window.MassSelection.addObject === 'function') {
        window.MassSelection.addObject(id);
      }
      
      // Снимаем выделение со ВСЕХ других элементов (кроме текущего)
      deselectAllElements(id);
      
      // Mark container as selected
      container.dataset.selected = "true";
      
      container.style.setProperty("pointer-events", "auto", "important");
      textElement.style.setProperty("outline", "1px solid #4a9eff", "important");
      textElement.style.setProperty("outline-offset", "0px", "important");
      // container.style.setProperty("cursor", "move", "important"); // Removed move cursor
      resizeHandle.style.display = "flex";
      resizeHandle.style.opacity = "0";
      resizeHandle.style.transform = "scale(0.8)";
      updateHandlePosition();
      
      // Animate scale handle appearance
      requestAnimationFrame(() => {
        resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        resizeHandle.style.opacity = "1";
        resizeHandle.style.transform = "scale(1)";
      });
      
      
      // Automatically show color pickers when text is selected (but not during editing)
      if (!isEditing) {
        // FIX: Always ensure fresh panel
        killColorPanel(); // Clean up any existing panel
        
        // FIX: Ensure selection state is maintained during color panel creation
        const maintainSelection = () => {
          if (selectedTextId === id && !isEditing) {
            textElement.style.setProperty("outline", "1px solid #4a9eff", "important");
            textElement.style.setProperty("outline-offset", "0px", "important");
            resizeHandle.style.display = "flex";
          }
        };
        
        // Maintain selection state during panel creation delay
        setTimeout(maintainSelection, 50);
        safeReshowColorPicker(id, 100); // Show fresh panel for this text
      }
      
      // Создаем программный selection, чтобы Ctrl+C работал
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textElement);
      selection.removeAllRanges();
      selection.addRange(range);
      console.log("zindex of text element from dom", container.style.zIndex);
      console.log("zindex of text element from zindex manager",ZIndexManager.get(id));
    }
    
    function deselectText() {
      if (!isEditing) {
        isSelected = false;
        delete container.dataset.selected; // Убираем метку
        if (selectedTextId === id) selectedTextId = null; // Сбрасываем глобальный ID только если это МЫ

        
        container.style.removeProperty("pointer-events");
        textElement.style.removeProperty("outline");
        textElement.style.removeProperty("outline-offset");
        container.style.removeProperty("cursor");
        resizeHandle.style.display = "none";
        
        // Очищаем selection
        window.getSelection().removeAllRanges();
        
      }
    }
    
    // Удаление по клавише Delete
    async function deleteText() {
      killColorPanel();
      destroyTextElementById(id);
      
      const texts = await getAllTexts();
      delete texts[id];
      await setAllTexts(texts);
    }
    
    // Вставка скопированного текста
    async function pasteText() {
      if (!copiedTextData) return;
      
      const { lastMouseX, lastMouseY } = getSharedVars();
      
      // Получаем позицию слоя относительно viewport
      const layer = getOrCreateLayer();
      if (!layer) return;
      
      const layerRect = layer.getBoundingClientRect();
      
      // Конвертируем screen coordinates → layer coordinates → world coordinates
      const layerX = lastMouseX - layerRect.left;
      const layerY = lastMouseY - layerRect.top;
      
      // Учитываем масштаб слоя и translate
      const transform = layer.style.transform || "";
      
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const translateMatch = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      const translateX = translateMatch ? parseFloat(translateMatch[1]) : 0;
      const translateY = translateMatch ? parseFloat(translateMatch[2]) : 0;
      
      
      // Учитываем translate И scale
      const worldX = (layerX - translateX) / scale;
      const worldY = (layerY - translateY) / scale;
      
      
      // Создаём новый текст
      const newTextId = `wbe-text-${Date.now()}`;
      const container = createTextElement(
        newTextId,
        copiedTextData.text,
        worldX,
        worldY,
        copiedTextData.scale ?? DEFAULT_TEXT_SCALE,
        copiedTextData.color || DEFAULT_TEXT_COLOR,
        copiedTextData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
        copiedTextData.borderColor || null,
        copiedTextData.borderWidth ?? DEFAULT_BORDER_WIDTH,
        copiedTextData.fontWeight || DEFAULT_FONT_WEIGHT,
        copiedTextData.fontStyle || DEFAULT_FONT_STYLE,
        copiedTextData.textAlign || DEFAULT_TEXT_ALIGN,
        copiedTextData.fontFamily || DEFAULT_FONT_FAMILY,
        copiedTextData.fontSize || DEFAULT_FONT_SIZE,
        copiedTextData.width || null
      );
      
    if (container) {
      const textEl = container.querySelector(".wbe-canvas-text");
      if (textEl) await persistTextState(newTextId, textEl, container, { skipZIndex: true });
      
      // LOG: Track text paste with z-index
      const zIndex = ZIndexManager.get(newTextId);
      console.log(`[Text Paste] ID: ${newTextId} | z-index: ${zIndex} (pasteText closure)`);
      
      // Update container dimensions after paste
      updateTextUI(container);
    }
    
    }
    
    // ---- Document-level handlers bound to this element ----
    const keydownHandler = async (e) => {
      if (selectedTextId !== id) return;
      
      // CRITICAL FIX: Don't intercept events if an image is selected (let image handler process it)
      if (window.ImageTools?.selectedImageId) return;
      
      // Z-index controls - raise/lower z-index
      // Skip if mass selection is active (let whiteboard-select handle it)
      if (!isEditing && globalThis.selectedObjects?.size > 1) return;
      
      if (!isEditing && (e.key === '[' || e.key === 'PageDown')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Z-index operations are queued at ZIndexManager level
        const oldZIndex = ZIndexManager.get(id);
        const result = await ZIndexManager.moveDown(id);
        if (result.success && result.changes.length > 0) {
          const change = result.changes[0];
          
          // Sync all DOM z-indexes (ensures consistency across all objects)
          await ZIndexManager.syncAllDOMZIndexes();
          const newZIndex = ZIndexManager.get(id);
          
          // Emit rank update to GM (player sends request, GM broadcasts confirmation)
          const rank = ZIndexManager.getRank(id);
          game.socket.emit('module.whiteboard-experience', {
            type: 'rankUpdate',
            objectType: 'text',
            id: id,
            rank: rank,
            userId: game.user.id
          });
          
          // FIX #3: Persist swapped occupant to database
          if (result.swappedWith) {
            await persistSwappedZIndexTarget(result.swappedWith.id);
            console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} (moved down, swapped with ${result.swappedWith.id}: ${result.swappedWith.newZIndex})`);
          } else {
            console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} (moved down to next object)`);
          }
          
          console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} | rank: ${change.rank}`);
          
          // Persist text state using debounced batching
          await persistTextState(id, textElement, container);
        } else if (result.atBoundary) {
          // At boundary - provide feedback
          console.log(`[Z-Index] TEXT | ID: ${id} | Cannot move down - ${result.reason}`);
        }
        return;
      }
      
      if (!isEditing && (e.key == ']' || e.key === 'PageUp')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Z-index operations are queued at ZIndexManager level
        const oldZIndex = ZIndexManager.get(id);
        const result = await ZIndexManager.moveUp(id);
        if (result.success && result.changes.length > 0) {
          const change = result.changes[0];
          
          // Sync all DOM z-indexes (ensures consistency across all objects)
          await ZIndexManager.syncAllDOMZIndexes();
          const newZIndex = ZIndexManager.get(id);
          
          // Emit rank update to GM (player sends request, GM broadcasts confirmation)
          const rank = ZIndexManager.getRank(id);
          game.socket.emit('module.whiteboard-experience', {
            type: 'rankUpdate',
            objectType: 'text',
            id: id,
            rank: rank,
            userId: game.user.id
          });
          
          // FIX #3: Persist swapped occupant to database
          if (result.swappedWith) {
            await persistSwappedZIndexTarget(result.swappedWith.id);
            console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} (moved up, swapped with ${result.swappedWith.id}: ${result.swappedWith.newZIndex})`);
          } else {
            console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} (moved up to next object)`);
          }
          
          console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} | rank: ${change.rank}`);
          
          // Persist text state using debounced batching
          await persistTextState(id, textElement, container);
        } else if (result.atBoundary) {
          // At boundary - provide feedback
          console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} | Cannot move up - ${result.reason}`);
        }
        return;
      }
      
      if (!isEditing && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault(); e.stopPropagation();
        deleteText();
      }
      if (!isEditing && (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "с" || e.code === "KeyC")) {
        e.preventDefault();
        document.execCommand('copy');
      }
    };

    const copyHandler = (e) => {
      if (selectedTextId !== id || isEditing) return;
      e.preventDefault(); e.stopPropagation();
      const transform = textElement.style.transform || "";
      const m = transform.match(/scale\(([\d.]+)\)/);
      const currentScale = m ? parseFloat(m[1]) : 1;
      const currentColor = textElement.style.color || DEFAULT_TEXT_COLOR;
      
      // Extract background color from span if it exists (same as extractTextState)
      const textSpan = textElement.querySelector(".wbe-text-background-span");
      let currentBackgroundColor = "transparent";
      if (textSpan) {
        const spanBg = getComputedStyle(textSpan).backgroundColor || textSpan.style.backgroundColor;
        currentBackgroundColor = spanBg && spanBg !== "transparent" && spanBg !== "rgba(0, 0, 0, 0)" ? spanBg : "transparent";
      }
      
      const currentBorderWidth = Number(textElement.dataset.borderWidth || DEFAULT_BORDER_WIDTH);
      const currentBorderColor = currentBorderWidth > 0
        ? (textElement.dataset.borderRgba || textElement.style.borderColor || null)
        : null;
      
      // Normalize font properties before copying
      const rawFontWeight = textElement.dataset.fontWeight || textElement.style.fontWeight || getComputedStyle(textElement).fontWeight;
      const rawFontStyle = textElement.dataset.fontStyle || textElement.style.fontStyle || getComputedStyle(textElement).fontStyle;
      
      // Get text from span if it exists, otherwise from textElement
      const text = textSpan ? textSpan.textContent : textElement.textContent;
      
      // Capture current state for copying (includes font data)
      copiedTextData = {
        text: text,
        scale: currentScale,
        color: currentColor,
        backgroundColor: currentBackgroundColor,
        borderColor: currentBorderColor,
        borderWidth: currentBorderWidth,
        fontWeight: normalizeFontWeight(rawFontWeight),
        fontStyle: normalizeFontStyle(rawFontStyle),
        textAlign: textElement.dataset.textAlign || textElement.style.textAlign || DEFAULT_TEXT_ALIGN,
        fontFamily: textElement.dataset.fontFamily || textElement.style.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: parseInt(textElement.dataset.fontSize || textElement.style.fontSize || DEFAULT_FONT_SIZE),
        width: textElement.style.width ? parseFloat(textElement.style.width) : null
      };
      setCopiedImageData(null);
      
      // Persist current state to scene flags to ensure fonts are saved across socket hops (skip z-index read - it doesn't change during copy)
      persistTextState(id, textElement, container, { skipZIndex: true });

      // Add marker to clipboard so paste handler knows this is a FATE text copy
      if (e.clipboardData) e.clipboardData.setData("text/plain", `[wbe-TEXT-COPY:${id}]\n${textElement.textContent}`);

    };;

    const onDocMouseDown = (e) => {
      if (window.wbeColorPanel && window.wbeColorPanel.contains(e.target)) {
        return;
      }
      if (e.button !== 0) return;
      
      // PREVENT SINGLE CLICK SELECTION OF MASS-SELECTED TEXT
      if (container.classList.contains("wbe-mass-selected")) {
        e.preventDefault();
        e.stopPropagation();
        return; // Don't select mass-selected text on single click
      }
      
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        container.style.setProperty("pointer-events", "none", "important");
        return; // Let everything pass through to canvas
      }
      
      // CRITICAL FIX: Enable pointer-events BEFORE checking elementsFromPoint
      // This ensures clicks register even when container has pointer-events: none
      // Must be done before elementsFromPoint to get accurate z-order
      container.style.setProperty("pointer-events", "auto", "important");
      
      // CRITICAL FIX: Also check if click target is directly on text element/container
      // This handles cases where elementsFromPoint might not include elements with pointer-events: none
      const clickedDirectlyOnText = container.contains(e.target) || 
                                     e.target === container || 
                                     e.target === textElement ||
                                     textElement.contains(e.target);
      
      // FIX: Check elementsFromPoint to see if text is actually on top
      // Use elementsFromPoint (not elementFromPoint) to check z-order when overlapping with images
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      const textInStack = elementsAtPoint.some(el => el === container || container.contains(el));
      const textIndex = elementsAtPoint.findIndex(el => el === container || container.contains(el));
      const imageIndex = elementsAtPoint.findIndex(el => 
        el.classList.contains('wbe-image-click-target') || 
        el.classList.contains('wbe-canvas-image-container')
      );
      
      // Only proceed if text is on top (or no image found) OR if clicked directly on text
      // Direct click check handles cases where pointer-events was none initially
      const textIsOnTop = clickedDirectlyOnText || (textInStack && (imageIndex === -1 || textIndex < imageIndex));
      
      if (textIsOnTop) {
        if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
          e.preventDefault(); e.stopPropagation();
          return; // Don't select locked text
        }
        if (!isSelected) {
          e.preventDefault(); e.stopPropagation();
          
          // CLEAR MASS SELECTION when selecting individual text
          if (window.MassSelection && window.MassSelection.selectedCount > 0) {
            window.MassSelection.clear();
          }
          
          selectText();
          
      // FIX: Ensure drag works and visual feedback is applied immediately after selection
      // Re-apply styles to prevent async image deselection from removing them
      container.style.setProperty("pointer-events", "auto", "important");
      textElement.style.setProperty("outline", "1px solid #4a9eff", "important");
      textElement.style.setProperty("outline-offset", "0px", "important");
      
      // FIX: Ensure border persists even if image handler runs after
      // Use requestAnimationFrame to re-apply after any pending DOM updates
      requestAnimationFrame(() => {
        if (container.dataset.selected === "true") {
          textElement.style.setProperty("outline", "1px solid #4a9eff", "important");
          textElement.style.setProperty("outline-offset", "0px", "important");
        }
      });
        } else if (!window.wbeColorPanel) {
          safeReshowColorPicker(id, 0);
        }
      } else {
        if (skipNextTextDeselect) {
          skipNextTextDeselect = false;
          return;
        }
        if (isSelected) {
          deselectText();
        } else {
          container.style.removeProperty("pointer-events");
        }
      }
    };

    document.addEventListener("keydown", keydownHandler);
    document.addEventListener("copy",    copyHandler);
    document.addEventListener("mousedown", onDocMouseDown, true);

    // Register disposer for this element
    disposers.set(id, () => {
      document.removeEventListener("keydown",  keydownHandler);
      document.removeEventListener("copy",     copyHandler);
      document.removeEventListener("mousedown", onDocMouseDown, true);
    });
  
  
    // Перетаскивание — только левой кнопкой (на container)
    container.addEventListener("mousedown", (e) => {
      if (isEditing) return;
      
      // Только левая кнопка (0) → перетаскивание объекта
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        
        dragging = true;
        dragInitialized = false;
        startScreenX = e.clientX;
        startScreenY = e.clientY;
      
        // Запоминаем НАЧАЛЬНУЮ позицию КОНТЕЙНЕРА в пикселях
        startWorldX = parseFloat(container.style.left) || 0;
        startWorldY = parseFloat(container.style.top) || 0;
        
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      }
    });
  
    async function handleMouseMove(e) {
      if (isEditing || !dragging) return;
      
      // Дельта в экранных координатах
      const deltaScreenX = e.clientX - startScreenX;
      const deltaScreenY = e.clientY - startScreenY;

      if (!dragInitialized && (Math.abs(deltaScreenX) > 1 || Math.abs(deltaScreenY) > 1)) {
        dragInitialized = true;
        killColorPanel();
      }
      
      // Получаем текущий масштаб canvas (scale)
      const layer = getOrCreateLayer();
      const transform = layer?.style?.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      // Конвертируем дельту в world space (делим на scale)
      const deltaWorldX = deltaScreenX / scale;
      const deltaWorldY = deltaScreenY / scale;
      
      // Новая позиция в world coordinates - двигаем КОНТЕЙНЕР
      const newLeft = startWorldX + deltaWorldX;
      const newTop = startWorldY + deltaWorldY;
      
      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
      
      // Panel should be killed during drag, don't update it
    }
  
    async function handleMouseUp() {
      if (dragging) {
        const wasDragging = dragInitialized; // Remember if we actually dragged
        dragging = false;
        dragInitialized = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить позицию КОНТЕЙНЕРА (skip z-index read - it doesn't change during drag)
        await persistTextState(id, textElement, container, { skipZIndex: true });
        
        // Re-assert selection and restore panel after drag
        // CLEAR MASS SELECTION when re-asserting after drag
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }
        
        // Only restore panel if we actually dragged (not just a click)
        if (wasDragging) {
          selectText();            // keeps outline, selection state, id, restores panel
        } else {
          // Just a click on already selected text - don't kill/restore panel
          // Panel update already handled in onDocMouseDown
        }
      }
    }
    
    // Resize handle
    resizeHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      
      // Kill color panel during resize
      killColorPanel();
      
      resizing = true;
      resizeStartX = e.clientX;
      
      // Читаем ТЕКУЩИЙ scale из transform
      const transform = textElement.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      resizeStartScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      
      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", handleResizeUp);
    });
    
    // Show resize cursor when hovering over borders - ONLY if text is selected (blue border visible)
    textElement.addEventListener("mousemove", (e) => {
      if (isEditing || resizing) return;
      
      // CRITICAL FIX: Only show ew-resize cursor if text is selected (blue outline visible in DOM)
      // Check if blue selection outline is present (text must be selected to resize)
      const isTextSelected = container.dataset.selected === "true" || 
                             selectedTextId === id ||
                             textElement.style.outline.includes("#4a9eff") ||
                             getComputedStyle(textElement).outline.includes("rgb(74, 158, 255)");
      
      if (!isTextSelected) {
        // Text not selected - no blue border, no resize cursor
        textElement.style.cursor = "";
        return;
      }
      
      const rect = textElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      // Check if mouse is near left or right border (within 8px)
      if (x <= 8 || x >= width - 8) {
        textElement.style.cursor = "ew-resize";
      } else {
        textElement.style.cursor = "";
      }
    });
    
    // Border dragging functionality - detect when dragging left or right border
    textElement.addEventListener("mousedown", (e) => {
      if (isEditing || e.button !== 0) return;
      
      // CRITICAL FIX: Only allow border resize if text is selected (blue outline visible)
      const isTextSelected = container.dataset.selected === "true" || 
                             selectedTextId === id ||
                             textElement.style.outline.includes("#4a9eff") ||
                             getComputedStyle(textElement).outline.includes("rgb(74, 158, 255)");
      
      if (!isTextSelected) {
        // Text not selected - no blue border, no border resize
        return;
      }
      
      const rect = textElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      // Check if click is near left border (within 8px)
      if (x <= 8) {
        e.preventDefault();
        e.stopPropagation();
        
        // Kill color panel during width resize
        killColorPanel();
        
        resizing = true;
        resizeStartX = e.clientX;
        resizeStartScale = textElement.offsetWidth;
        
        // Hide scaling gizmo during resize with smooth animation
        resizeHandle.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
        
        // Set cursor to ew-resize
        textElement.style.cursor = "ew-resize";
        
        document.addEventListener("mousemove", handleLeftResize);
        document.addEventListener("mouseup", handleResizeUp);
      }
      // Check if click is near right border (within 8px)
      else if (x >= width - 8) {
        e.preventDefault();
        e.stopPropagation();
        
        // Kill color panel during width resize
        killColorPanel();
        
        resizing = true;
        resizeStartX = e.clientX;
        resizeStartScale = textElement.offsetWidth;
        
        // Hide scaling gizmo during resize with smooth animation
        resizeHandle.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
        
        // Set cursor to ew-resize
        textElement.style.cursor = "ew-resize";
        
        document.addEventListener("mousemove", handleRightResize);
        document.addEventListener("mouseup", handleResizeUp);
      }
    });
    
    function handleResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      
      // Новый scale (минимум 0.3, максимум 3.0, как у карточки)
      const newScale = resizeStartScale + (deltaX * SCALE_SENSITIVITY);
      const clampedScale = Math.max(0.3, Math.min(3.0, newScale));
      
      // Применяем ТОЛЬКО scale к textElement
      textElement.style.transform = `scale(${clampedScale})`;
      
      // Обновляем позицию handle
      updateHandlePosition();
      
      // Update container dimensions after scale change
      updateTextUI(container);
      
      // Panel should be killed during resize, don't update it
    }
    
    function handleLeftResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      const newWidth = Math.max(50, resizeStartScale - deltaX);
      
      textElement.style.width = `${newWidth}px`;
      textElement.dataset.manualWidth = "true"; // Mark as manually set
      
      // Panel should be killed during resize, don't update it
    }
    
    function handleRightResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      const newWidth = Math.max(50, resizeStartScale + deltaX);
      
      textElement.style.width = `${newWidth}px`;
      textElement.dataset.manualWidth = "true"; // Mark as manually set
      
      // Panel should be killed during resize, don't update it
    }
    
    async function handleResizeUp() {
      if (resizing) {
        resizing = false;
        document.removeEventListener("mousemove", handleResize);
        document.removeEventListener("mousemove", handleLeftResize);
        document.removeEventListener("mousemove", handleRightResize);
        document.removeEventListener("mouseup", handleResizeUp);
        
        // Reset cursor and show scaling gizmo again after resize
        textElement.style.cursor = "";
        if (isSelected) {
          resizeHandle.style.display = "flex";
          resizeHandle.style.opacity = "0";
          resizeHandle.style.transform = "scale(0.8)";
          
          // Animate scale handle reappearance with slight delay
          setTimeout(() => {
            requestAnimationFrame(() => {
              resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
              resizeHandle.style.opacity = "1";
              resizeHandle.style.transform = "scale(1)";
            });
          }, 100);
        }
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить позицию контейнера + scale textElement (skip z-index read - it doesn't change during resize)
        await persistTextState(id, textElement, container, { skipZIndex: true });
        
        // Re-assert selection and restore panel after resize
        // CLEAR MASS SELECTION when re-asserting after resize
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }
        selectText();            // keeps outline, selection state, id, restores panel
      }
    }
    
    
    
    updateTextUI(container);
    return container;
}

async function addTextToCanvas(clickX, clickY, autoEdit = false) {
    // Проверяем готовность canvas
    if (!canvas || !canvas.ready) {
      ui.notifications.warn("Canvas not ready");
      return;
    }
  
    const layer = getOrCreateLayer();
  
    // Позиция: клик + 30px вправо (в screen space)
    const screenX = clickX + 30;
    const screenY = clickY;
    
    // Конвертируем screen → world coordinates
    const worldPos = screenToWorld(screenX, screenY);
    
    // Создаем новый текст в world coordinates
    const textId = `wbe-text-${Date.now()}`;
    const container = createTextElement(textId, autoEdit ? "" : "Двойной клик для редактирования", worldPos.x, worldPos.y, DEFAULT_TEXT_SCALE, DEFAULT_TEXT_COLOR, DEFAULT_BACKGROUND_COLOR, null, DEFAULT_BORDER_WIDTH, DEFAULT_FONT_WEIGHT, DEFAULT_FONT_STYLE, DEFAULT_TEXT_ALIGN, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, null);
    if (!container) return;
    const textEl = container.querySelector(".wbe-canvas-text");
    if (!textEl) return;
    
    // Force layout recalculation to get proper dimensions
    // This ensures the text element has real dimensions before we persist
    textEl.offsetHeight; // Force reflow
    const scale = getTextScale(textEl);
    const currentWidth = textEl.offsetWidth || 100; // Default to 100px if still 0
    const currentHeight = textEl.offsetHeight || 20; // Default to 20px if still 0
    
    // Set explicit width if not already set (for proper initial sizing)
    if (!textEl.style.width || textEl.style.width === 'auto') {
      textEl.style.width = `${Math.max(currentWidth, 100)}px`;
      textEl.dataset.manualWidth = "false"; // Mark as auto
    }
    
    // Update container dimensions after creation
    updateTextUI(container);
    
    // Persist state with proper dimensions
    await persistTextState(textId, textEl, container);
    
    // LOG: Track main text creation with z-index
    const zIndex = ZIndexManager.get(textId);
    console.log(`[Text Creation] ID: ${textId} | z-index: ${zIndex} (addTextToCanvas)`);
    
    // If in text mode, automatically enter edit mode
    if (autoEdit) {
      // Select the text element first
      const selectEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: clickX,
        clientY: clickY
      });
      container.dispatchEvent(selectEvent);
      
      // Then trigger edit mode
      setTimeout(() => {
        const editEvent = new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          clientX: clickX,
          clientY: clickY
        });
        textEl.dispatchEvent(editEvent);
      }, 100);
    }
    
  }

async function getAllTexts() {
  try {
    return await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_TEXTS) || {};
  } catch (e) {
    console.error("[WB-E] getAllTexts error:", e);
    return {};
  }
}

async function setAllTexts(texts) {
    const timestamp = Date.now();
    const stackTrace = new Error().stack?.split('\n').slice(1, 4).join(' | ') || 'unknown';
    try {
      const textIds = Object.keys(texts);
      const isEmptyPayload = textIds.length === 0;
      console.log(`[WB-E] setAllTexts: [${timestamp}] Sending ${textIds.length} texts:`, textIds.slice(0, 5));
      console.log(`[WB-E] setAllTexts: [${timestamp}] Call stack:`, stackTrace);
      
      // EXPERIMENT PHASE 1: Don't sync z-indexes - Manager is already authoritative
      // syncWithExisting was causing conflicts when non-GM sends updates
      // Manager already has correct values from local operations
      
      if (game.user.isGM) {
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, texts);
        if (isEmptyPayload) {
          if (window.ZIndexManager && typeof window.ZIndexManager.clear === "function") {
            window.ZIndexManager.clear();
          }
        }

        // Обновляем локально для немедленной реакции UI у GM
        const layer = getOrCreateLayer();
        if (layer) {
          // Получаем все существующие текстовые элементы
          const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
          const existingIds = new Set();

          // Обновляем существующие и создаем новые тексты локально у GM
          for (const [id, textData] of Object.entries(texts)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
            if (existing) {
              // CRITICAL FIX: Skip locked text elements (GM socket handler)
              // Check both dataset.lockedBy AND lock overlay (more reliable - works even if lock restored after socket update)
              const hasLockOverlay = existing.querySelector(".wbe-text-lock-overlay") !== null;
              const isLockedByOther = existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id;
              if (hasLockOverlay || isLockedByOther) {
                const lockedBy = existing.dataset.lockedBy || "unknown";
                console.log(`[WB-E] GM skipping socket update for ${id} - locked by user ${lockedBy} (has overlay: ${hasLockOverlay})`);
                continue; // Don't update! This prevents cursor reset and size changes!
              }

              // Обновляем существующий элемент
              const textElement = existing.querySelector(".wbe-canvas-text");
              if (textElement) {
                // ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
                if (textElement.contentEditable === "true") {
                  console.log(`[WB-E] GM skipping socket update for ${id} - actively being edited`);
                  continue;
                }

                // Safe to update now
                // Update text content - check for span first
                const textSpan = textElement.querySelector(".wbe-text-background-span");
                if (textSpan) {
                  textSpan.textContent = textData.text;
                } else {
                  textElement.textContent = textData.text;
                }

                existing.style.left = `${textData.left}px`;
                existing.style.top = `${textData.top}px`;
                textElement.style.transform = `scale(${textData.scale})`;
                textElement.style.color = textData.color || TextTools.DEFAULT_TEXT_COLOR; // Apply color

                // Apply background to span if it exists, otherwise to textElement (backward compat)
                if (textSpan && textData.backgroundColor) {
                  textSpan.style.backgroundColor = textData.backgroundColor;
                } else if (!textSpan) {
                  textElement.style.backgroundColor = textData.backgroundColor || TextTools.DEFAULT_BACKGROUND_COLOR;
                }
                TextTools.applyFontVariantToElement?.(textElement, textData.fontWeight, textData.fontStyle);
                TextTools.applyTextAlignmentToElement?.(textElement, textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN);
                TextTools.applyFontFamilyToElement?.(textElement, textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY);
                TextTools.applyFontSizeToElement?.(textElement, textData.fontSize || TextTools.DEFAULT_FONT_SIZE);
                TextTools.applyBorderDataToElement?.(textElement, textData.borderColor, textData.borderWidth);

                // CRITICAL FIX: Don't update width if element is locked (lockedSize prevents size changes)
                if (!textElement.dataset.lockedSize) {
                  // FIX: Apply width if present
                  if (textData.width && textData.width > 0) {
                    textElement.style.width = `${textData.width}px`;
                    textElement.dataset.manualWidth = "true";
                  } else {
                    textElement.style.width = "";
                    textElement.dataset.manualWidth = "false";
                  }
                } else {
                  console.log(`[WB-E] GM skipping width update for ${id} - element is locked (lockedSize=true)`);
                }

                // Update resize handle position after scale/size changes
                TextTools.updateTextUI(existing);
              }
            } else {
              // Создаем новый элемент
              const createdContainer = TextTools.createTextElement(
                id,
                textData.text,
                textData.left,
                textData.top,
                textData.scale,
                textData.color,
                textData.backgroundColor,
                textData.borderColor,
                textData.borderWidth,
                textData.fontWeight,
                textData.fontStyle,
                textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN,
                textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY,
                textData.fontSize || TextTools.DEFAULT_FONT_SIZE,
                textData.width,
                textData.zIndex ?? null // Use null instead of undefined so default parameter works
              );

              // Apply color and background to newly created element
              const created = createdContainer || document.getElementById(id);
              if (created) {
                const textElement = created.querySelector(".wbe-canvas-text");
                if (textElement) {
                  textElement.style.color = textData.color || TextTools.DEFAULT_TEXT_COLOR;
                  textElement.style.backgroundColor = textData.backgroundColor || TextTools.DEFAULT_BACKGROUND_COLOR;
                  TextTools.applyFontVariantToElement?.(textElement, textData.fontWeight, textData.fontStyle);
                  TextTools.applyTextAlignmentToElement?.(textElement, textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN);
                  TextTools.applyFontFamilyToElement?.(textElement, textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY);
                  TextTools.applyFontSizeToElement?.(textElement, textData.fontSize || TextTools.DEFAULT_FONT_SIZE);
                  TextTools.applyBorderDataToElement?.(textElement, textData.borderColor, textData.borderWidth);
                }
                TextTools.updateTextUI(created);
              }
            }
          }

          // Удаляем элементы, которых больше нет в texts
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              // FIX: Clean up color panel before removing element
              if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
                try {
                  window.wbeColorPanel.cleanup();
                } catch { }
              }
              // Clean up color pickers before removing element
              document.querySelectorAll(".wbe-color-picker-panel").forEach(d => d.remove());
              // Clean up ZIndexManager
              if (window.ZIndexManager && typeof window.ZIndexManager.remove === "function") {
                window.ZIndexManager.remove(element.id);
              }
              element.remove();
            }
          });
        }

        game.socket.emit(`module.${MODID}`, { type: "textUpdate", texts });
      } else {
        // Игрок отправляет запрос GM через сокет
        // CRITICAL FIX: Добавить rank из Manager для всех текстов без rank
        const textsWithRank = {};
        for (const [id, textData] of Object.entries(texts)) {
          textsWithRank[id] = { ...textData };
          // Если rank отсутствует, получить из Manager
          if (!textsWithRank[id].rank && window.ZIndexManager && typeof window.ZIndexManager.getRank === 'function') {
            const rank = window.ZIndexManager.getRank(id);
            if (rank) {  // Защита: добавляем только если rank существует
              textsWithRank[id].rank = rank;
            }
          }
        }
        
        game.socket.emit(`module.${MODID}`, { type: "textUpdateRequest", texts: textsWithRank, userId: game.user.id });
        
        // Обновляем локально для немедленной реакции UI у игрока
        const layer = getOrCreateLayer();
        if (layer) {
          // Получаем все существующие текстовые элементы
          const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
          const existingIds = new Set(Array.from(existingElements).map(el => el.id));
          console.log(`[WB-E] setAllTexts: [${timestamp}] Found ${existingIds.size} existing DOM elements:`, Array.from(existingIds).slice(0, 5));
          
          // Обновляем существующие и создаем новые тексты локально
          for (const [id, textData] of Object.entries(texts)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
            if (existing) {
              // CRITICAL FIX: Skip locked text elements
              if (existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id) {
                continue; // Don't update! This prevents cursor reset!
              }
              
              // Обновляем существующий элемент
              const textElement = existing.querySelector(".wbe-canvas-text");
              if (textElement) {
                // ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
                if (textElement.contentEditable === "true") {
                  continue;
                }
                
                // Safe to update now
                const textSpan = textElement.querySelector(".wbe-text-background-span");
                if (textSpan) {
                  textSpan.textContent = textData.text;
                } else {
                  textElement.textContent = textData.text;
                }
                existing.style.left = `${textData.left}px`;
                existing.style.top = `${textData.top}px`;
                textElement.style.transform = `scale(${textData.scale})`;
                textElement.style.color = textData.color || DEFAULT_TEXT_COLOR;
                // Apply background to span only - never touch textElement background
                const existingTextSpan = textElement.querySelector(".wbe-text-background-span");
                if (existingTextSpan && textData.backgroundColor) {
                  existingTextSpan.style.backgroundColor = textData.backgroundColor;
                }
                applyBorderDataToElement(textElement, textData.borderColor, textData.borderWidth);
                
                // Apply font weight and style to existing elements
                applyFontVariantToElement(textElement, textData.fontWeight || DEFAULT_FONT_WEIGHT, textData.fontStyle || DEFAULT_FONT_STYLE);

                // Apply text alignment to existing elements
                applyTextAlignmentToElement(textElement, textData.textAlign || DEFAULT_TEXT_ALIGN);

                // Apply font family to existing elements
                applyFontFamilyToElement(textElement, textData.fontFamily || DEFAULT_FONT_FAMILY);

                // Apply font size to existing elements
                applyFontSizeToElement(textElement, textData.fontSize || DEFAULT_FONT_SIZE);

                // Apply width if present
                if (textData.width && textData.width > 0) {
                  textElement.style.width = `${textData.width}px`;
                  textElement.dataset.manualWidth = "true"; // Mark as manually set
                } else {
                  textElement.style.width = '';
                  textElement.dataset.manualWidth = "false"; // Mark as auto
                }
                
                // FIX: Update z-index from database
                if (textData.zIndex) {
                  existing.style.zIndex = textData.zIndex;
                  // TEMPORARILY DISABLED: Don't overwrite manager with potentially stale DB values
                  // ZIndexManager.set(id, textData.zIndex);
                }
                
                // Clamp container to scaled dimensions
                const scale = getTextScale(textElement);
                const width = textElement.offsetWidth * scale;
                const height = textElement.offsetHeight * scale;
                existing.style.width = `${width}px`;
                existing.style.height = `${height}px`;
                
                // Update resize handle position after scale/size changes
                updateTextUI(existing);
              }
            } else {
              // Создаем новый элемент
              const createdContainer = createTextElement(
                id,
                textData.text,
                textData.left,
                textData.top,
                textData.scale,
                textData.color || DEFAULT_TEXT_COLOR,
                textData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
                textData.borderColor || null,
                textData.borderWidth ?? DEFAULT_BORDER_WIDTH,
                textData.fontWeight || DEFAULT_FONT_WEIGHT,
                textData.fontStyle || DEFAULT_FONT_STYLE,
                textData.textAlign || DEFAULT_TEXT_ALIGN,
                textData.fontFamily || DEFAULT_FONT_FAMILY,
                textData.fontSize || DEFAULT_FONT_SIZE,
                textData.width ?? null,
                textData.zIndex // Pass existing z-index
              );
              
              if (createdContainer) {
                const textElement = createdContainer.querySelector(".wbe-canvas-text");
                if (textElement) {
                  textElement.style.color = textData.color || DEFAULT_TEXT_COLOR;
                  // Apply background to span only - never touch textElement background
                  const createdTextSpan = textElement.querySelector(".wbe-text-background-span");
                  if (createdTextSpan && textData.backgroundColor) {
                    createdTextSpan.style.backgroundColor = textData.backgroundColor;
                  }
                  applyBorderDataToElement(textElement, textData.borderColor, textData.borderWidth);
                  
                  // Apply manual width flag if width was set
                  if (textData.width && textData.width > 0) {
                    textElement.dataset.manualWidth = "true";
                  } else {
                    textElement.dataset.manualWidth = "false";
                  }
                  
                  // FIX: Update z-index from database for new elements
                  if (textData.zIndex) {
                    createdContainer.style.zIndex = textData.zIndex;
                    // TEMPORARILY DISABLED: Don't overwrite manager with potentially stale DB values
                    // ZIndexManager.set(id, textData.zIndex);
                  }
                  
                  // Clamp container to scaled dimensions for new elements
                  const scale = getTextScale(textElement);
                  const width = textElement.offsetWidth * scale;
                  const height = textElement.offsetHeight * scale;
                  createdContainer.style.width = `${width}px`;
                  createdContainer.style.height = `${height}px`;
                }
                updateTextUI(createdContainer);
              }
            }
          }
          
          // Удаляем элементы, которых больше нет в texts (skip for empty payload until authoritative response)
          if (!isEmptyPayload) {
            const toRemove = [];
            existingElements.forEach(element => {
              if (!existingIds.has(element.id)) {
                // Don't remove if element is locked/being manipulated
                if (element.dataset.lockedBy) {
                  console.log(`[WB-E] Preserving text ${element.id} - locked by user ${element.dataset.lockedBy}`);
                  return;
                }
                toRemove.push(element.id);
              }
            });

            if (toRemove.length > 0) {
              console.error(`[WB-E] setAllTexts: [${timestamp}] 🚨 REMOVING ${toRemove.length} text elements from DOM:`, toRemove);
              toRemove.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                  // Clean up color pickers before removing element
                  killColorPanel();
                  // Clear runtime caches to prevent resurrection
                  if (window.TextTools && typeof window.TextTools.clearTextCaches === "function") {
                    try {
                      window.TextTools.clearTextCaches(id);
                    } catch { }
                  }
                  // Clean up ZIndexManager
                  if (window.ZIndexManager && typeof window.ZIndexManager.remove === "function") {
                    window.ZIndexManager.remove(id);
                  }
                  destroyTextElementById(id);
                }
              });
            }
          } else {
            console.log(`[WB-E] setAllTexts: [${timestamp}] Skipping DOM prune for empty payload on non-GM client; awaiting authoritative sync.`);
          }
        }
      }
    } catch (e) {
      console.error("[WB-E] setAllTexts error:", e);
    }
}

function getTextScale(textEl) {
  const m = (textEl.style.transform || "").match(/scale\(([\d.]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}

function updateTextResizeHandlePosition(container) {
  if (!container) return;
  const textEl = container.querySelector(".wbe-canvas-text");
  const handle = container.querySelector(".wbe-text-resize-handle");
  if (!textEl || !handle) return;

  const scale = getTextScale(textEl);
  const w = textEl.offsetWidth * scale;
  const h = textEl.offsetHeight * scale;

  // sync container to the visual footprint so selection hits match what you see
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;

  handle.style.left = `${w + RESIZE_HANDLE_OFFSET_X}px`;
  handle.style.top  = `${h + RESIZE_HANDLE_OFFSET_Y}px`;
}

/** Public one-shot refresher used after socket-driven updates */
function updateTextUI(containerOrId) {
  const container = typeof containerOrId === "string"
    ? document.getElementById(containerOrId)
    : containerOrId;
  if (!container) return;
  updateTextResizeHandlePosition(container);
}

/**
 * Toggle bold formatting for selected text
 * Updates the text element and color panel state
 */
async function toggleTextBold() {
  if (!selectedTextId) return;
  
  const container = document.getElementById(selectedTextId);
  if (!container) return;
  
  const textElement = container.querySelector(".wbe-canvas-text");
  if (!textElement) return;
  
  // Get current bold state
  const computedFont = getComputedStyle(textElement);
  const currentWeight = normalizeFontWeight(
    textElement.dataset.fontWeight || 
    textElement.style.fontWeight || 
    computedFont.fontWeight
  );
  const isCurrentlyBold = currentWeight >= 600;
  
  // Toggle bold state
  const newWeight = isCurrentlyBold ? DEFAULT_FONT_WEIGHT : 700;
  const currentStyle = normalizeFontStyle(
    textElement.dataset.fontStyle || 
    textElement.style.fontStyle || 
    computedFont.fontStyle
  );
  
  // Apply the new font weight
  applyFontVariantToElement(textElement, newWeight, currentStyle);
  
  // Persist the change
  await persistTextState(selectedTextId, textElement, container);
  
  // Update color panel bold button state if panel exists
  if (window.wbeColorPanel) {
    const panel = window.wbeColorPanel;
    // Find the bold button (button with text "B")
    const boldBtn = Array.from(panel.querySelectorAll("button")).find(
      btn => btn.textContent.trim() === "B"
    );
    
    if (boldBtn) {
      // Update button active state using the same logic as setMiniActive
      const isBold = newWeight >= 600;
      if (isBold) {
        boldBtn.dataset.active = "1";
        boldBtn.style.background = "#e0ebff";
        boldBtn.style.borderColor = "#4d8dff";
        boldBtn.style.color = "#1a3f8b";
      } else {
        boldBtn.dataset.active = "0";
        boldBtn.style.background = "#f5f5f7";
        boldBtn.style.borderColor = "#d2d2d8";
        boldBtn.style.color = "#333";
      }
      
      // Also update regular button state
      const regularBtn = Array.from(panel.querySelectorAll("button")).find(
        btn => btn.textContent.trim() === "Aa"
      );
      if (regularBtn) {
        const isItalic = currentStyle === "italic";
        const isRegular = !isBold && !isItalic;
        if (isRegular) {
          regularBtn.dataset.active = "1";
          regularBtn.style.background = "#e0ebff";
          regularBtn.style.borderColor = "#4d8dff";
          regularBtn.style.color = "#1a3f8b";
        } else {
          regularBtn.dataset.active = "0";
          regularBtn.style.background = "#f5f5f7";
          regularBtn.style.borderColor = "#d2d2d8";
          regularBtn.style.color = "#333";
        }
      }
    }
  }
}

/**
 * Setup keyboard shortcuts for text formatting
 */
function setupTextKeyboardShortcuts() {
  document.addEventListener("keydown", async (e) => {
    // Only handle if text is selected and not editing
    if (!selectedTextId) return;
    
    const container = document.getElementById(selectedTextId);
    if (!container) return;
    
    const textElement = container.querySelector(".wbe-canvas-text");
    if (!textElement) return;
    
    // Check if text is in editing mode (contentEditable)
    if (textElement.contentEditable === "true") return;
    
    // Ctrl+B or Cmd+B for bold
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
      // Don't prevent default if in input/textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      await toggleTextBold();
    }
  });
}

export const TextTools = {
  // UI and actions
  createTextElement,
  injectTextTool,
  handleTextPasteFromClipboard,
  globalPasteText,
  addTextToCanvas,

  // scene storage
  getAllTexts,
  setAllTexts,

  // controlled access to mutable state
  get selectedTextId() { return selectedTextId; },
  set selectedTextId(v) { selectedTextId = v; },

  get copiedTextData() { return copiedTextData; },
  set copiedTextData(v) { copiedTextData = v; },

  // re-export helpers for convenience
  screenToWorld,
  worldToScreen,

  // UI refresher
  updateTextUI,

  // border helper for external callers
  applyBorderDataToElement,

  // font helper for external callers
  applyFontVariantToElement,

  // text alignment helper for external callers
  applyTextAlignmentToElement,

  // font family helper for external callers
  applyFontFamilyToElement,

  // font size helper for external callers
  applyFontSizeToElement,

  // font detection helper
  getAvailableFonts,

  // text lock visual functions
  applyTextLockVisual,
  removeTextLockVisual,

  // keyboard shortcuts
  setupTextKeyboardShortcuts,

  // defaults
  DEFAULT_TEXT_COLOR,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_SPAN_BACKGROUND_COLOR,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_TEXT_SCALE,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_FONT_STYLE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,

  // cross-module helpers
  persistTextState
};
