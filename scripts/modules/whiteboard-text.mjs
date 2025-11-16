
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
  ZIndexConstants,
  wbeLog
} from "../main.mjs";

let copiedTextData = null; // Буфер для копирования текста
let selectedTextId = null; // ID выделенного текстового элемента

// Scale sensitivity constant
const SCALE_SENSITIVITY = 0.01; // Sensitivity for text scaling

const DEFAULT_TEXT_COLOR = "#000000";
const DEFAULT_BACKGROUND_COLOR = "none !important";
const DEFAULT_SPAN_BACKGROUND_COLOR = "#ffffff";
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
const RESIZE_HANDLE_OFFSET_X = -6; // pixels from right edge (negative = inside, positive = outside) - half of handle width (12px)
const RESIZE_HANDLE_OFFSET_Y = -6; // pixels from bottom edge (negative = inside, positive = outside) - half of handle height (12px)

// Map of element-id -> disposer function
let pendingColorPickerTimeout = null;
let pendingColorPickerRaf = null;
let isPastingText = false;
let skipNextTextDeselect = false;
const disposers = new Map();
// Registry to track all text containers for centralized selection management (like images)
const textRegistry = new Map(); // { id: { container, selectFn, deselectFn, clickTarget } }
let globalTextSelectionHandlerInstalled = false;

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
  
  // [ZINDEX_ANALYSIS] Track z-index extraction
  if (!options.skipZIndex) {
    //console.log(`[ZINDEX_ANALYSIS] extractTextState: ${id.slice(-6)} extracted zIndex=${zIndex}, rank="${rank}" from ZIndexManager`);
  }

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

// Export to window for debugging
window.wbePendingTextUpdates = pendingTextUpdates;

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
  // [ZINDEX_ANALYSIS] Track debounced flush
  const pendingIds = Array.from(pendingTextUpdates.keys());
  //console.log(`[ZINDEX_ANALYSIS] debouncedFlushTextUpdates ENTRY: pending=${pendingTextUpdates.size}, ids=`, pendingIds.slice(0, 5));
  if (pendingTextUpdates.size === 0) {
    //console.log(`[ZINDEX_ANALYSIS] debouncedFlushTextUpdates: Early return - no pending updates`);
  }
  
  //console.log(`[WB-E] debouncedFlushTextUpdates: Flushing ${pendingTextUpdates.size} pending updates:`, pendingIds.slice(0, 5));
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
    //console.log(`[WB-E] debouncedFlushTextUpdates: DOM has ${domIds.length} elements:`, domIds.slice(0, 5));
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
  //console.log(`[WB-E] debouncedFlushTextUpdates: Final state has ${finalIds.length} texts (${domExtractedCount} from DOM):`, finalIds.slice(0, 5));
  // [ZINDEX_ANALYSIS] Track final state before sending
  //console.log(`[ZINDEX_ANALYSIS] debouncedFlushTextUpdates: Final state before setAllTexts: texts=${finalIds.length}, fromDOM=${domExtractedCount}, pending=${pendingTextUpdates.size}`);
  if (finalIds.length === 0) {
    //console.log(`[ZINDEX_ANALYSIS] debouncedFlushTextUpdates: WARNING - Final state is empty! DOM had ${domExtractedCount} elements`);
  }
  
  // [ZINDEX_ANALYSIS] Track z-index values in final state
  const zIndexMap = new Map();
  finalIds.forEach(id => {
    const textData = texts[id];
    const zIndex = textData?.zIndex || window.ZIndexManager?.get(id) || 0;
    if (!zIndexMap.has(zIndex)) zIndexMap.set(zIndex, []);
    zIndexMap.get(zIndex).push(id);
  });
  const duplicates = Array.from(zIndexMap.entries()).filter(([z, ids]) => ids.length > 1 && z > 0);
  if (duplicates.length > 0) {
    console.error(`[ZINDEX_ANALYSIS] debouncedFlushTextUpdates: DUPLICATES in final state before setAllTexts:`, duplicates.map(([z, ids]) => `z=${z}: ${ids.length} objects (${ids.map(id => id.slice(-6)).join(', ')})`));
  }
  
  logDuplicateZIndexesInTextPayload('debouncedFlushTextUpdates', texts);

  // [PARTIAL FLAG] Check if we have partial updates
  const partialTexts = [];
  pendingTextUpdates.forEach((state, id) => {
    if (state._partial === true) {
      partialTexts.push(id);
    }
  });

  // Clear pending updates before processing
  const pendingUpdatesCopy = new Map(pendingTextUpdates);
  pendingTextUpdates.clear();

  // If we have partial updates, send only those (they already contain full state)
  if (partialTexts.length > 0) {
    console.log(`[PARTIAL FLAG] debouncedFlushTextUpdates: Processing ${partialTexts.length} texts with _partial=true:`, partialTexts.map(id => id.slice(-6)));
    const partialPayload = {};
    partialTexts.forEach(id => {
      const state = pendingUpdatesCopy.get(id);
      if (state) {
        // Remove _partial flag before sending
        const { _partial, ...cleanState } = state;
        partialPayload[id] = cleanState;
      }
    });
    await setAllTexts(partialPayload, true); // true = isPartial
  } else {
    // No partial updates - use full sync (current logic)
    await setAllTexts(texts, false); // false = isPartial
  }
}, 200); // 200ms debounce for rapid z-index changes

async function persistTextState(id, textElement, container, options = {}) {
  if (!id || !textElement || !container) return;
  
  // [ZINDEX_ANALYSIS] Track persistTextState calls
  const currentZIndex = window.ZIndexManager?.get(id) || 0;
  const currentRank = window.ZIndexManager?.getRank(id) || '';
  //console.log(`[ZINDEX_ANALYSIS] persistTextState ENTRY: ${id.slice(-6)}, zIndex=${currentZIndex}, rank="${currentRank}", skipZIndex=${options.skipZIndex || false}`);
  const state = extractTextState(id, textElement, container, options);
  if (!state) return;
  
  // [ZINDEX_ANALYSIS] Track z-index in extracted state
  if (state.zIndex) {
    //console.log(`[ZINDEX_ANALYSIS] persistTextState: Extracted state has zIndex=${state.zIndex} for ${id.slice(-6)}`);
  } else {
    //console.log(`[ZINDEX_ANALYSIS] persistTextState: Extracted state has NO zIndex for ${id.slice(-6)}, will use Manager value`);
  }
  
  // Mark as partial update if requested (for drag/resize operations)
  if (options.partial) {
    state._partial = true;
    console.log(`[PARTIAL FLAG] Text ${id.slice(-6)}: _partial flag set to true`);
  }
  
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
    const left = activeButton.offsetLeft + activeButton.offsetWidth + 10;
    activeSubpanel.style.left = `${left}px`;
    activeSubpanel.style.top = `${activeButton.offsetTop}px`;
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
    subpanel.style.transform = "translateX(-8px)";
    panel.appendChild(subpanel);

    activeSubpanel = subpanel;
    activeButton = button;
    setButtonActive(button, true);
    positionSubpanel();

    requestAnimationFrame(() => {
      if (!activeSubpanel) return;
      activeSubpanel.style.transition = "opacity 0.16s ease, transform 0.16s ease";
      activeSubpanel.style.opacity = "1";
      activeSubpanel.style.transform = "translateX(0)";
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
    
    // Get panel dimensions (use fallback values if panel is not yet rendered)
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || 300; // Fallback panel width
    const panelHeight = panelRect.height || 120; // Fallback panel height
    
    const minMargin = 10; // Minimum margin from screen edges
    const topThreshold = 150; // Threshold for switching panel to bottom position
    
    // HORIZONTAL POSITIONING
    // Center panel relative to object
    let panelCenterX = rect.left + rect.width / 2;
    const halfPanelWidth = panelWidth / 2;
    
    // Check left boundary - shift panel if it would overflow
    if (panelCenterX - halfPanelWidth < minMargin) {
      panelCenterX = minMargin + halfPanelWidth;
    }
    
    // Check right boundary - shift panel if it would overflow
    if (panelCenterX + halfPanelWidth > window.innerWidth - minMargin) {
      panelCenterX = window.innerWidth - minMargin - halfPanelWidth;
    }
    
    panel.style.left = `${panelCenterX}px`;
    
    // VERTICAL POSITIONING
    // If object is too close to top edge, place panel below object
    if (rect.top < topThreshold) {
      // Place panel below object
      panel.style.top = `${rect.bottom + minMargin}px`;
    } else {
      // Place panel above object (original behavior: 110px above object top)
      panel.style.top = `${rect.top - 110}px`;
    }
    
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
  window.wbeSafeReshowColorPicker = safeReshowColorPicker; // Export for main.mjs socket handler
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

// DEPRECATED: Pan/zoom handling moved to main.mjs (setupIndependentPanZoomHooks)
// This function can be removed if user requests it
function installGlobalPanHooks() {
  if (__wbePanHooksInstalled) return;
  __wbePanHooksInstalled = true;

  let isCanvasPanningGlobal = false;
  const clickTargetsToRestore = new Map();

  // Helper: Temporarily disable pointer-events on click targets for canvas pan/zoom
  const disableTextClickTargets = () => {
    if (!selectedTextId) return;
    const container = document.getElementById(selectedTextId);
    if (!container) return;
    
    const clickTarget = container.querySelector('.wbe-text-click-target');
    if (clickTarget && clickTarget.style.pointerEvents !== 'none') {
      clickTargetsToRestore.set(clickTarget, clickTarget.style.pointerEvents);
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }
  };

  // Helper: Restore pointer-events on click targets
  const restoreTextClickTargets = () => {
    clickTargetsToRestore.forEach((originalValue, clickTarget) => {
      if (clickTarget.parentNode) {
        clickTarget.style.setProperty("pointer-events", originalValue || "auto", "important");
      }
    });
    clickTargetsToRestore.clear();
  };

  // Start pan on ANY right-button down; close panel immediately
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (e.target.closest(".wbe-canvas-text-container")) {
      killColorPanel();
    } else {
      killColorPanel();
    }
    disableTextClickTargets();
    isCanvasPanningGlobal = true;
  }, true);

  // On pan end, reopen for the currently selected text (if any)
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    if (!isCanvasPanningGlobal) return;
    isCanvasPanningGlobal = false;
    
    restoreTextClickTargets();

    if (selectedTextId && !window.wbeColorPanel) {
      // Give the canvas a tick to settle transforms
      safeReshowColorPicker(selectedTextId, 100);
    }
  }, true);

  // Zoom wheel should also temporarily hide + then restore
  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    
    // Temporarily disable click target to allow wheel events to pass through to canvas
    disableTextClickTargets();
    
    // CRITICAL: Restore after Foundry has processed the event (use double RAF for better timing)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreTextClickTargets();
      });
    });
    
    // Manage panel - only if text is selected
    if (selectedTextId) {
      killColorPanel();
      
      // Show panel after wheel event settles (same timing as images)
      setTimeout(() => {
        if (selectedTextId) {
          safeReshowColorPicker(selectedTextId, 150);
        }
      }, 150);
    }
  }, { capture: true, passive: true });
}

// call this once, after defining killColorPanel/safeReshowColorPicker
// DISABLED: Pan/zoom handling moved to main.mjs (setupIndependentPanZoomHooks)
// This function can be removed if user requests it
// installGlobalPanHooks();

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
    // Use elementsFromPoint to properly detect elements under cursor (works with pointer-events: none)
    const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
    const hasObjectAtPoint = elementsAtPoint.some(el => 
      el.closest(".wbe-canvas-text-container") || 
      el.closest(".wbe-color-picker-panel") ||
      el.closest(".wbe-canvas-image-container") ||
      el.closest(".wbe-image-click-target")
    );
    if (hasObjectAtPoint) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
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
    if (isPastingText) return;
    isPastingText = true;
    try {
      // Конвертируем screen → world coordinates (через Pixi.js)
      const { lastMouseX, lastMouseY } = getSharedVars();
      const worldPos = screenToWorld(lastMouseX, lastMouseY);
      
      const newTextId = `wbe-text-${Date.now()}`;
      const container = createTextElement({
        id: newTextId,
        text: copiedTextData.text,
        left: worldPos.x,
        top: worldPos.y,
        scale: copiedTextData.scale ?? DEFAULT_TEXT_SCALE,
        color: copiedTextData.color || DEFAULT_TEXT_COLOR,
        backgroundColor: copiedTextData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
        borderColor: copiedTextData.borderColor || null,
        borderWidth: copiedTextData.borderWidth ?? DEFAULT_BORDER_WIDTH,
        fontWeight: copiedTextData.fontWeight || DEFAULT_FONT_WEIGHT,
        fontStyle: copiedTextData.fontStyle || DEFAULT_FONT_STYLE,
        textAlign: copiedTextData.textAlign || DEFAULT_TEXT_ALIGN,
        fontFamily: copiedTextData.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: copiedTextData.fontSize || DEFAULT_FONT_SIZE,
        width: copiedTextData.width || null
      });
      if (!container) return;
      const textEl = container.querySelector(".wbe-canvas-text");
      if (!textEl) return;
      
      // Force layout recalculation to get proper dimensions
      textEl.offsetHeight;
      
      // Wait for DOM to fully update before reading dimensions
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Update container dimensions BEFORE persisting
      updateTextUI(container);
      
      // IMMEDIATE save to DB (like images) - no debounce to avoid race condition
      const texts = await getAllTexts();
      texts[newTextId] = extractTextState(newTextId, textEl, container);
      await setAllTexts(texts);
      
      // LOG: Track global text paste with z-index
      const zIndex = ZIndexManager.get(newTextId);
      console.log(`[Text Paste] ID: ${newTextId} | z-index: ${zIndex} (global paste)`);
    } finally {
      isPastingText = false;
    }
}

async function handleTextPasteFromClipboard(text) {
  if (isPastingText) return;
  isPastingText = true;
  try {
    // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
    setCopiedImageData(null);
    copiedTextData = null;
    
    // Конвертируем позицию курсора в world coordinates
    const { lastMouseX, lastMouseY } = getSharedVars();
    const worldPos = screenToWorld(lastMouseX, lastMouseY);
    
    
    // Создаем новый текстовый элемент
    const textId = `wbe-text-${Date.now()}`;
    const container = createTextElement({
      id: textId,
      text: text,
      left: worldPos.x,
      top: worldPos.y,
      scale: DEFAULT_TEXT_SCALE,
      color: DEFAULT_TEXT_COLOR,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      borderColor: null,
      borderWidth: DEFAULT_BORDER_WIDTH,
      fontWeight: DEFAULT_FONT_WEIGHT,
      fontStyle: DEFAULT_FONT_STYLE,
      textAlign: DEFAULT_TEXT_ALIGN,
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
      width: null
    });
    if (!container) return;
    const textEl = container.querySelector(".wbe-canvas-text");
    if (!textEl) return;
    
    // Force layout recalculation to get proper dimensions
    textEl.offsetHeight;
    
    // Wait for DOM to fully update before reading dimensions
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Update container dimensions BEFORE persisting
    updateTextUI(container);
    
    // IMMEDIATE save to DB (like images) - no debounce to avoid race condition
    const texts = await getAllTexts();
    texts[textId] = extractTextState(textId, textEl, container);
    await setAllTexts(texts);
    
    // LOG: Track clipboard text paste with z-index
    const zIndex = ZIndexManager.get(textId);
    //console.log(`[Text Paste] ID: ${textId} | z-index: ${zIndex} (clipboard paste)`);
    
  } catch (err) {
    console.error("[WB-E] Text paste error:", err);
    ui.notifications.error("Text paste error");
  } finally {
    isPastingText = false;
  }
}

async function injectTextTool() {
  const sc = ui.controls;
  if (!sc || !sc.controls) return;

  const isV11 = Array.isArray(sc.controls);
  const controlsData = sc.controls;
  
  const group = isV11 
    ? controlsData.find(g => g.name === "token" || g.name === "tokens")
    : (controlsData.token || controlsData.tokens);
    
  if (!group) return;

  const toolName = "wbe-text-tool";
  
  const exists = isV11
    ? group.tools.find(t => t.name === toolName)
    : group.tools[toolName];
    
  if (exists) return;

  // Обработчик - создаёт текст в последней позиции мыши
  const handler = async () => {
    const { lastClickX, lastClickY } = getSharedVars();
    await this.addTextToCanvas(lastClickX, lastClickY);
  };

  const tool = {
    name: toolName,
    title: "Добавить текст на стол",
    icon: "fas fa-font",
    button: true,
    ...(isV11 ? { visible: true } : {}),
    [isV11 ? 'onClick' : 'onChange']: handler
  };

  if (isV11) {
    group.tools.push(tool);
  } else {
    group.tools[toolName] = tool;
  }

  setTimeout(() => sc.render(true), 10);
}

function createTextElement({
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
    rank = null
  }) {
  const layer = getOrCreateLayer();
  if (!layer) return null;

  // Контейнер для позиционирования (БЕЗ translate)
  const container = document.createElement("div");
  container.id = id;
  container.className = "wbe-canvas-text-container";

  // Register in ZIndexManager if not already registered (migration handles existing objects)
  // CRITICAL FIX: If object already exists (from syncWithExisting), don't overwrite its rank
  // syncWithExisting already registered all objects with correct ranks from DB
  const desiredRank = typeof rank === "string" ? rank : null;
  if (!ZIndexManager.has(id)) {
    // Object doesn't exist - assign new rank
    ZIndexManager.assignText(id, desiredRank);
  }
  // NOTE: Don't overwrite rank if object already exists - syncWithExisting already set it correctly
  // Get z-index AFTER assignment - assignText already marks cache as dirty
  // so get() will rebuild the cache including the new object
  const zIndex = ZIndexManager.get(id);
  const assignedRank = ZIndexManager.getRank(id);
  const allObjects = ZIndexManager.getAllObjectsSorted();
  const position = allObjects.findIndex(o => o.id === id);
  const totalObjects = allObjects.length;

  // DEBUG: Log z-index assignment
  console.log(`[ZIndexDebug] createTextElement ${id.slice(-6)}: zIndex=${zIndex}, rank="${assignedRank}", position=${position}/${totalObjects - 1}, totalObjects=${totalObjects}`);
  if (position !== totalObjects - 1) {
    console.warn(`[ZIndexDebug] WARNING: Text ${id.slice(-6)} is NOT at top! Position: ${position}/${totalObjects - 1}`);
    console.log(`[ZIndexDebug] Top 3 objects:`, allObjects.slice(-3).map(o => ({ id: o.id.slice(-6), rank: o.rank, type: o.type, zIndex: ZIndexManager.get(o.id) })));
  }

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
      padding: 4px 4px 4px 2px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      line-height: 1.53;
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
    
    // NOTE: Images don't call syncAllDOMZIndexes after creation - they just set z-index directly
    // We do the same for texts to match the working behavior of images
    // syncAllDOMZIndexes will be called later when needed (e.g., during z-index operations)
    
    applyBorderDataToElement(textElement, borderColor, borderWidth);
    
    // Resize handle (круглая точка) - в контейнере, позиционируется относительно textElement
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "wbe-text-resize-handle";
    resizeHandle.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 12px;
      height: 12px;
      display: none;
      background: #4a9eff;
      border: 2px solid white;
      border-radius: 50%;
      cursor: nwse-resize;
      z-index: ${ZIndexConstants.TEXT_RESIZE_HANDLE};
      pointer-events: auto;
      user-select: none;
    `;
    container.appendChild(resizeHandle);
    
    // Click target for drag/interaction (similar to image click-target pattern)
    // MUST be LAST to be on top of textElement and handle all interactions
    const clickTarget = document.createElement("div");
    clickTarget.className = "wbe-text-click-target";
    clickTarget.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      pointer-events: none;
      /* NEVER ADD Z-INDEX TO CLICK TARGET */
    `;
    container.appendChild(clickTarget);
    
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
    let dragging = false, dragInitialized = false, startScreenX = 0, startScreenY = 0, startWorldX = 0, startWorldY = 0;
    let resizing = false, resizeStartX = 0, resizeStartScale = scale;
    
    /* ======================== Edit and Lock ======================== */
    
    // Edit blur handler - exits edit mode when clicking outside
    const editBlurHandler = async (e) => {
      // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track editBlurHandler calls
      console.log(`[INVESTIGATE] editBlurHandler called for ${id.slice(-6)}: isEditing=${isEditing}, target=${e.target?.tagName || 'null'}, targetId=${e.target?.id || 'null'}, button=${e.button}`);
      if (!isEditing) {
        console.log(`[INVESTIGATE] editBlurHandler: Early return - isEditing=false for ${id.slice(-6)}`);
        return;
      }
      
      // Ignore if clicking anywhere inside the container (including textElement, span, and all children)
      if (container.contains(e.target)) {
        console.log(`[INVESTIGATE] editBlurHandler: Ignoring click inside container for ${id.slice(-6)}`);
        return;
      }
      
      // Ignore if clicking on color panel
      if (window.wbeColorPanel?.contains(e.target)) {
        console.log(`[INVESTIGATE] editBlurHandler: Ignoring click on color panel for ${id.slice(-6)}`);
        return;
      }
      
      // Ignore if clicking on resize handle
      if (resizeHandle.contains(e.target)) {
        console.log(`[INVESTIGATE] editBlurHandler: Ignoring click on resize handle for ${id.slice(-6)}`);
        return;
      }
      
      console.log(`[INVESTIGATE] editBlurHandler: CALLING exitEditMode for ${id.slice(-6)} - click outside`);
      await exitEditMode();
    };
    
    // NEW: Add exitEditMode function
    async function exitEditMode() {
      // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track exitEditMode calls
      console.log(`[INVESTIGATE] exitEditMode called for ${id.slice(-6)}: isEditing=${isEditing}, contentEditable=${textElement.contentEditable}, lockedBy=${container.dataset.lockedBy || 'none'}`);
      if (!isEditing) {
        console.log(`[INVESTIGATE] exitEditMode: Early return - isEditing=false for ${id.slice(-6)}`);
        return;
      }
      
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
      console.log(`[INVESTIGATE] exitEditMode: Set isEditing=false for ${id.slice(-6)}`);
      
      // Exit contentEditable from span or textElement (reuse textSpan from above scope)
      const editableElement = textSpan || textElement;
      console.log(`[INVESTIGATE] exitEditMode: Setting contentEditable=false for ${id.slice(-6)}, editableElement=${editableElement.tagName}`);
      editableElement.contentEditable = "false";
      editableElement.style.userSelect = "none";
      
      textElement.contentEditable = "false";
      textElement.style.userSelect = "none";
      console.log(`[INVESTIGATE] exitEditMode: contentEditable set to false for ${id.slice(-6)}`);
      
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
      if (container.dataset.selected !== "true") {
        selectText();
      }
      
      // Show scale gizmo again
      if (container.dataset.selected === "true") {
        resizeHandle.style.display = "flex";
        resizeHandle.style.opacity = "0";
        
        setTimeout(() => {
          requestAnimationFrame(() => {
            resizeHandle.style.transition = "opacity 0.2s ease";
            resizeHandle.style.opacity = "1";
          });
        }, 100);
      }
      
    }
    
    // Двойной клик для редактирования (on click-target, not textElement)
    clickTarget.addEventListener("dblclick", async (e) => {
      // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track dblclick handler
      console.log(`[INVESTIGATE] Text dblclick handler called for ${id.slice(-6)}: isEditing=${isEditing}, lockedBy=${container.dataset.lockedBy || 'none'}`);
      // NEW: Check if locked by another user
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        console.log(`[INVESTIGATE] Text dblclick: Locked by another user for ${id.slice(-6)}`);
        return;
      }
      
      // NEW: If already editing, don't interfere - let browser handle word selection
      if (isEditing) {
        console.log(`[INVESTIGATE] Text dblclick: Already editing, returning early for ${id.slice(-6)}`);
        // Already editing - don't prevent default, let browser select word
        return;
      }
      
      // Prevent default only when entering edit mode
      e.preventDefault();
      e.stopPropagation();
      
      // NEW: Enter edit mode with lock
      isEditing = true;
      console.log(`[INVESTIGATE] Text dblclick: Setting isEditing=true for ${id.slice(-6)}`);
      
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
      console.log(`[INVESTIGATE] Text dblclick: Set contentEditable=true for ${id.slice(-6)}, editableElement=${editableElement.tagName}`);
      
      // Add the blur handler to detect clicks outside
      document.addEventListener("mousedown", editBlurHandler, true);
      console.log(`[INVESTIGATE] Text dblclick: Added editBlurHandler listener for ${id.slice(-6)}`);
      
      // Hide color panel during editing
      killColorPanel();
      
      // Hide scale gizmo during editing with smooth animation
      if (resizeHandle.style.display !== "none") {
        resizeHandle.style.transition = "opacity 0.15s ease";
        resizeHandle.style.opacity = "0";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
      }
      
      // Don't auto-select text on double-click - let user position cursor naturally
      
    });

    // Завершение редактирования по Enter
    textElement.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        
        // Check if text is empty before exiting
        // FIX: Check textSpan content, not textElement (text is stored in span)
        const textSpan = textElement.querySelector(".wbe-text-background-span");
        const textContent = (textSpan ? textSpan.textContent : textElement.textContent).trim();
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
      
      // Prevent re-selection if already selected
      if (container.dataset.selected === "true") {
        return; // Already selected, skip
      }
      
      selectedTextId = id; // Устанавливаем глобальный ID
      //console.log(`[INVESTIGATE] Text selected: Setting selectedTextId=${id.slice(-6)}`); // TEMPORARY FOR INVESTIGATION

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
      
      // Enable click-target for drag interaction (similar to image pattern)
      clickTarget.style.setProperty("pointer-events", "auto", "important");
      textElement.style.setProperty("outline", "1px solid #4a9eff", "important");
      textElement.style.setProperty("outline-offset", "0px", "important");
      // container.style.setProperty("cursor", "move", "important"); // Removed move cursor
      resizeHandle.style.display = "flex";
      resizeHandle.style.opacity = "0";
      updateHandlePosition();
      
      // Animate scale handle appearance
      requestAnimationFrame(() => {
        resizeHandle.style.transition = "opacity 0.2s ease";
        resizeHandle.style.opacity = "1";
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
      //console.log("zindex of text element from dom", container.style.zIndex);
    }
    
    function deselectText() {
      if (!isEditing) {
        delete container.dataset.selected; // Убираем метку
        if (selectedTextId === id) {
          console.log(`[INVESTIGATE] Text deselected: Clearing selectedTextId for ${id.slice(-6)}`); // TEMPORARY FOR INVESTIGATION
          selectedTextId = null; // Сбрасываем глобальный ID только если это МЫ
        }

        
        // Disable click-target for canvas pass-through (similar to image pattern)
        clickTarget.style.setProperty("pointer-events", "none", "important");
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
      const container = createTextElement({
        id: newTextId,
        text: copiedTextData.text,
        left: worldX,
        top: worldY,
        scale: copiedTextData.scale ?? DEFAULT_TEXT_SCALE,
        color: copiedTextData.color || DEFAULT_TEXT_COLOR,
        backgroundColor: copiedTextData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
        borderColor: copiedTextData.borderColor || null,
        borderWidth: copiedTextData.borderWidth ?? DEFAULT_BORDER_WIDTH,
        fontWeight: copiedTextData.fontWeight || DEFAULT_FONT_WEIGHT,
        fontStyle: copiedTextData.fontStyle || DEFAULT_FONT_STYLE,
        textAlign: copiedTextData.textAlign || DEFAULT_TEXT_ALIGN,
        fontFamily: copiedTextData.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: copiedTextData.fontSize || DEFAULT_FONT_SIZE,
        width: copiedTextData.width || null
      });
      
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
      // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track keydown handler calls
      //console.log(`[INVESTIGATE] Text keydown handler called for ${id.slice(-6)}: key=${e.key}, selectedTextId=${selectedTextId?.slice(-6) || 'null'}, id=${id.slice(-6)}, isEditing=${isEditing}, selectedImageId=${window.ImageTools?.selectedImageId?.slice(-6) || 'null'}, massSelectionSize=${globalThis.selectedObjects?.size || 0}`);
      
      if (selectedTextId !== id) {
        //console.log(`[INVESTIGATE] Text keydown handler: selectedTextId (${selectedTextId?.slice(-6) || 'null'}) !== id (${id.slice(-6)}), returning early`);
        return;
      }
      
      // CRITICAL FIX: Don't intercept events if an image is selected (let image handler process it)
      // [INVESTIGATE] TEMPORARY: Commented out to test if this blocks handler
      // if (window.ImageTools?.selectedImageId) {
      //   console.log(`[INVESTIGATE] Text keydown handler: Image selected (${window.ImageTools.selectedImageId.slice(-6)}), returning early`);
      //   return;
      // }
      
      // Z-index controls - raise/lower z-index
      // Skip if mass selection is active (let whiteboard-select handle it)
      if (!isEditing && globalThis.selectedObjects?.size > 1) {
        console.log(`[INVESTIGATE] Text keydown handler: Mass selection active (${globalThis.selectedObjects.size} objects), returning early`);
        return;
      }
      
      if (!isEditing && (e.key === '[' || e.key === 'PageDown')) {
        console.log(`[INVESTIGATE] Text keydown handler: Processing [ or PageDown for ${id.slice(-6)}`);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Sync DOM before operation to ensure manager has correct state
        await ZIndexManager.syncAllDOMZIndexes();
        
        // Z-index operations are queued at ZIndexManager level
        const oldZIndex = ZIndexManager.get(id);
        // [ZINDEX_ANALYSIS] Track moveDown call
        //console.log(`[ZINDEX_ANALYSIS] moveDown called for ${id.slice(-6)}: oldZIndex=${oldZIndex}`);
        // [INVESTIGATE] Track DOM state before move - check ALL objects for duplicates
        const moveStartTime = Date.now();
        const elBeforeMove = document.getElementById(id);
        const domStateBeforeMove = elBeforeMove ? parseInt(elBeforeMove.style.zIndex) || 0 : null;
        
        // [INVESTIGATE] Check for duplicates in DOM before move
        const allTextsBeforeMove = Array.from(document.querySelectorAll('.wbe-canvas-text-container')).map(el => ({
          id: el.id.slice(-6),
          zIndex: parseInt(el.style.zIndex) || 0
        }));
        const duplicatesBeforeMove = new Map();
        allTextsBeforeMove.forEach(obj => {
          if (!duplicatesBeforeMove.has(obj.zIndex)) duplicatesBeforeMove.set(obj.zIndex, []);
          duplicatesBeforeMove.get(obj.zIndex).push(obj.id);
        });
        const duplicateZBeforeMove = Array.from(duplicatesBeforeMove.entries()).filter(([z, ids]) => ids.length > 1 && z >= 1000);
        if (duplicateZBeforeMove.length > 0) {
          console.warn(`[INVESTIGATE] moveDown: DUPLICATES IN DOM BEFORE move for ${id.slice(-6)}:`, duplicateZBeforeMove.map(([z, ids]) => `z=${z}: ${ids.join(', ')}`));
        }
        
        //console.log(`[INVESTIGATE] moveDown: DOM z-index BEFORE move for ${id.slice(-6)}: ${domStateBeforeMove}, Manager: ${oldZIndex}`);
        const result = await ZIndexManager.moveDown(id);
        const moveDuration = Date.now() - moveStartTime;
        const newZIndex = ZIndexManager.get(id);
        
        if (result.success && result.changes.length > 0) {
          const change = result.changes[0];
          
          // [INVESTIGATE] Track DOM state after move but before sync
          const elAfterMoveBeforeSync = document.getElementById(id);
          const domStateAfterMoveBeforeSync = elAfterMoveBeforeSync ? parseInt(elAfterMoveBeforeSync.style.zIndex) || 0 : null;
          const managerZAfterMove = ZIndexManager.get(id);
          
          // [INVESTIGATE] Check for duplicates after move but before sync
          const allTextsAfterMoveBeforeSync = Array.from(document.querySelectorAll('.wbe-canvas-text-container')).map(el => ({
            id: el.id.slice(-6),
            zIndex: parseInt(el.style.zIndex) || 0
          }));
          const duplicatesAfterMoveBeforeSync = new Map();
          allTextsAfterMoveBeforeSync.forEach(obj => {
            if (!duplicatesAfterMoveBeforeSync.has(obj.zIndex)) duplicatesAfterMoveBeforeSync.set(obj.zIndex, []);
            duplicatesAfterMoveBeforeSync.get(obj.zIndex).push(obj.id);
          });
          const duplicateZAfterMoveBeforeSync = Array.from(duplicatesAfterMoveBeforeSync.entries()).filter(([z, ids]) => ids.length > 1 && z >= 1000);
          if (duplicateZAfterMoveBeforeSync.length > 0) {
            console.warn(`[INVESTIGATE] moveDown: DUPLICATES IN DOM AFTER move, BEFORE sync for ${id.slice(-6)}:`, duplicateZAfterMoveBeforeSync.map(([z, ids]) => `z=${z}: ${ids.join(', ')}`));
          }
          
          console.log(`[INVESTIGATE] moveDown: move operation took ${moveDuration}ms, DOM z-index AFTER move, BEFORE sync for ${id.slice(-6)}: ${domStateAfterMoveBeforeSync}, Manager: ${managerZAfterMove}`);
          // Sync all DOM z-indexes (ensures consistency across all objects)
          // [ZINDEX_ANALYSIS] Track sync call after moveDown
          const syncStartTime = Date.now();
          //console.log(`[ZINDEX_ANALYSIS] Calling syncAllDOMZIndexes after moveDown for ${id.slice(-6)}`);
          await ZIndexManager.syncAllDOMZIndexes();
          const syncDuration = Date.now() - syncStartTime;
          
          // [INVESTIGATE] Track DOM state after sync
          const elAfterSync = document.getElementById(id);
          const domStateAfterSync = elAfterSync ? parseInt(elAfterSync.style.zIndex) || 0 : null;
          const managerZAfterSync = ZIndexManager.get(id);
          
          // [INVESTIGATE] Check for duplicates after sync
          const allTextsAfterSync = Array.from(document.querySelectorAll('.wbe-canvas-text-container')).map(el => ({
            id: el.id.slice(-6),
            zIndex: parseInt(el.style.zIndex) || 0
          }));
          const duplicatesAfterSync = new Map();
          allTextsAfterSync.forEach(obj => {
            if (!duplicatesAfterSync.has(obj.zIndex)) duplicatesAfterSync.set(obj.zIndex, []);
            duplicatesAfterSync.get(obj.zIndex).push(obj.id);
          });
          const duplicateZAfterSync = Array.from(duplicatesAfterSync.entries()).filter(([z, ids]) => ids.length > 1 && z >= 1000);
          if (duplicateZAfterSync.length > 0) {
            console.error(`[INVESTIGATE] moveDown: DUPLICATES IN DOM AFTER sync for ${id.slice(-6)}:`, duplicateZAfterSync.map(([z, ids]) => `z=${z}: ${ids.join(', ')}`));
          } else {
            console.log(`[INVESTIGATE] moveDown: No duplicates in DOM after sync for ${id.slice(-6)}`);
          }
          
          console.log(`[INVESTIGATE] moveDown: sync took ${syncDuration}ms, DOM z-index AFTER sync for ${id.slice(-6)}: ${domStateAfterSync}, Manager: ${managerZAfterSync}, total operation=${moveDuration + syncDuration}ms`);
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
          return;
        }
      }
      
      if (!isEditing && (e.key == ']' || e.key === 'PageUp')) {
        console.log(`[INVESTIGATE] Text keydown handler: Processing ] or PageUp for ${id.slice(-6)}`);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Sync DOM before operation to ensure manager has correct state
        await ZIndexManager.syncAllDOMZIndexes();
        
        // Z-index operations are queued at ZIndexManager level
        const oldZIndex = ZIndexManager.get(id);
        // [ZINDEX_ANALYSIS] Track moveUp call
        //console.log(`[ZINDEX_ANALYSIS] moveUp called for ${id.slice(-6)}: oldZIndex=${oldZIndex}`);
        // [INVESTIGATE] Track DOM state before move - check ALL objects for duplicates
        const moveStartTime = Date.now();
        const elBeforeMove = document.getElementById(id);
        const domStateBeforeMove = elBeforeMove ? parseInt(elBeforeMove.style.zIndex) || 0 : null;
        
        // [INVESTIGATE] Check for duplicates in DOM before move
        const allTextsBeforeMove = Array.from(document.querySelectorAll('.wbe-canvas-text-container')).map(el => ({
          id: el.id.slice(-6),
          zIndex: parseInt(el.style.zIndex) || 0
        }));
        const duplicatesBeforeMove = new Map();
        allTextsBeforeMove.forEach(obj => {
          if (!duplicatesBeforeMove.has(obj.zIndex)) duplicatesBeforeMove.set(obj.zIndex, []);
          duplicatesBeforeMove.get(obj.zIndex).push(obj.id);
        });
        const duplicateZBeforeMove = Array.from(duplicatesBeforeMove.entries()).filter(([z, ids]) => ids.length > 1 && z >= 1000);
        if (duplicateZBeforeMove.length > 0) {
          //console.warn(`[INVESTIGATE] moveUp: DUPLICATES IN DOM BEFORE move for ${id.slice(-6)}:`, duplicateZBeforeMove.map(([z, ids]) => `z=${z}: ${ids.join(', ')}`));
        }
        
        //console.log(`[INVESTIGATE] moveUp: DOM z-index BEFORE move for ${id.slice(-6)}: ${domStateBeforeMove}, Manager: ${oldZIndex}`);
        const result = await ZIndexManager.moveUp(id);
        const moveDuration = Date.now() - moveStartTime;
        const newZIndex = ZIndexManager.get(id);
        
        if (result.success && result.changes.length > 0) {
          const change = result.changes[0];
          
          // [INVESTIGATE] Track DOM state after move but before sync
          const elAfterMoveBeforeSync = document.getElementById(id);
          const domStateAfterMoveBeforeSync = elAfterMoveBeforeSync ? parseInt(elAfterMoveBeforeSync.style.zIndex) || 0 : null;
          const managerZAfterMove = ZIndexManager.get(id);
          
          // [INVESTIGATE] Check for duplicates after move but before sync
          const allTextsAfterMoveBeforeSync = Array.from(document.querySelectorAll('.wbe-canvas-text-container')).map(el => ({
            id: el.id.slice(-6),
            zIndex: parseInt(el.style.zIndex) || 0
          }));
          const duplicatesAfterMoveBeforeSync = new Map();
          allTextsAfterMoveBeforeSync.forEach(obj => {
            if (!duplicatesAfterMoveBeforeSync.has(obj.zIndex)) duplicatesAfterMoveBeforeSync.set(obj.zIndex, []);
            duplicatesAfterMoveBeforeSync.get(obj.zIndex).push(obj.id);
          });
          const duplicateZAfterMoveBeforeSync = Array.from(duplicatesAfterMoveBeforeSync.entries()).filter(([z, ids]) => ids.length > 1 && z >= 1000);
          if (duplicateZAfterMoveBeforeSync.length > 0) {
            console.warn(`[INVESTIGATE] moveUp: DUPLICATES IN DOM AFTER move, BEFORE sync for ${id.slice(-6)}:`, duplicateZAfterMoveBeforeSync.map(([z, ids]) => `z=${z}: ${ids.join(', ')}`));
          }
          
          console.log(`[INVESTIGATE] moveUp: move operation took ${moveDuration}ms, DOM z-index AFTER move, BEFORE sync for ${id.slice(-6)}: ${domStateAfterMoveBeforeSync}, Manager: ${managerZAfterMove}`);
          // Sync all DOM z-indexes (ensures consistency across all objects)
          // [ZINDEX_ANALYSIS] Track sync call after moveUp
          const syncStartTime = Date.now();
          //console.log(`[ZINDEX_ANALYSIS] Calling syncAllDOMZIndexes after moveUp for ${id.slice(-6)}`);
          await ZIndexManager.syncAllDOMZIndexes();
          const syncDuration = Date.now() - syncStartTime;
          
          // [INVESTIGATE] Track DOM state after sync
          const elAfterSync = document.getElementById(id);
          const domStateAfterSync = elAfterSync ? parseInt(elAfterSync.style.zIndex) || 0 : null;
          const managerZAfterSync = ZIndexManager.get(id);
          
          // [INVESTIGATE] Check for duplicates after sync
          const allTextsAfterSync = Array.from(document.querySelectorAll('.wbe-canvas-text-container')).map(el => ({
            id: el.id.slice(-6),
            zIndex: parseInt(el.style.zIndex) || 0
          }));
          const duplicatesAfterSync = new Map();
          allTextsAfterSync.forEach(obj => {
            if (!duplicatesAfterSync.has(obj.zIndex)) duplicatesAfterSync.set(obj.zIndex, []);
            duplicatesAfterSync.get(obj.zIndex).push(obj.id);
          });
          const duplicateZAfterSync = Array.from(duplicatesAfterSync.entries()).filter(([z, ids]) => ids.length > 1 && z >= 1000);
          if (duplicateZAfterSync.length > 0) {
            console.error(`[INVESTIGATE] moveUp: DUPLICATES IN DOM AFTER sync for ${id.slice(-6)}:`, duplicateZAfterSync.map(([z, ids]) => `z=${z}: ${ids.join(', ')}`));
          } else {
            console.log(`[INVESTIGATE] moveUp: No duplicates in DOM after sync for ${id.slice(-6)}`);
          }
          
          console.log(`[INVESTIGATE] moveUp: sync took ${syncDuration}ms, DOM z-index AFTER sync for ${id.slice(-6)}: ${domStateAfterSync}, Manager: ${managerZAfterSync}, total operation=${moveDuration + syncDuration}ms`);
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
          }
          
          console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} → ${newZIndex} | rank: ${change.rank}`);
          await persistTextState(id, textElement, container);
        } else if (result.atBoundary) {
          // At boundary - provide feedback
          console.log(`[Z-Index] TEXT | ID: ${id} | z-index: ${oldZIndex} | Cannot move up - ${result.reason}`);
        }
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
      //persistTextState(id, textElement, container, { skipZIndex: true });

      // Add marker to clipboard so paste handler knows this is a FATE text copy
      if (e.clipboardData) e.clipboardData.setData("text/plain", `[wbe-TEXT-COPY:${id}]\n${textElement.textContent}`);

    };

    // Register text in global registry for centralized selection management (like images)
    textRegistry.set(id, { container, selectFn: selectText, deselectFn: deselectText, clickTarget });

    document.addEventListener("keydown", keydownHandler);
    document.addEventListener("copy",    copyHandler);

    // Register disposer for this element (no mousedown cleanup needed - handled by global handler)
    disposers.set(id, () => {
      document.removeEventListener("keydown",  keydownHandler);
      document.removeEventListener("copy",     copyHandler);
      textRegistry.delete(id); // Remove from registry when element is destroyed
    });
  
  
    // Unified mousedown handler on click-target for drag AND border resize
    // Check border resize first (priority), then fall back to drag
    clickTarget.addEventListener("mousedown", (e) => {
      // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track mousedown event
      console.log(`[INVESTIGATE] Text mousedown: Called for text ${id.slice(-6)}, button=${e.button}, isEditing=${isEditing}`);
      
      if (isEditing) return;
      if (e.button !== 0) return; // Only left button
      
      // Auto-select if not selected (like ImageDragController does)
      // This ensures drag works on freshly pasted texts
      if (container.dataset.selected !== "true") {
        console.log(`[INVESTIGATE] Text mousedown: Auto-selecting text ${id.slice(-6)}`);
        selectText();
      }
      
      // Check if text is selected (needed for both drag and border resize)
      const isTextSelected = container.dataset.selected === "true" || 
                             selectedTextId === id ||
                             textElement.style.outline.includes("#4a9eff") ||
                             getComputedStyle(textElement).outline.includes("rgb(74, 158, 255)");
      
      // Calculate position relative to textElement for border resize check
      const rect = textElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      // PRIORITY 1: Border resize (if near left or right border)
      if (isTextSelected && (x <= 8 || x >= width - 8)) {
        console.log(`[INVESTIGATE] Text border resize: Starting for text ${id.slice(-6)}, x=${x.toFixed(1)}, width=${width.toFixed(1)}`);
        e.preventDefault();
        e.stopPropagation();
        
        killColorPanel();
        
        resizing = true;
        resizeStartX = e.clientX;
        resizeStartScale = textElement.offsetWidth;
        
        // Hide scaling gizmo
        resizeHandle.style.transition = "opacity 0.15s ease";
        resizeHandle.style.opacity = "0";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
        
        textElement.style.cursor = "ew-resize";
        
        // Choose left or right resize based on position
        if (x <= 8) {
          document.addEventListener("mousemove", handleLeftResize);
        } else {
          document.addEventListener("mousemove", handleRightResize);
        }
        document.addEventListener("mouseup", handleResizeUp);
        return; // Don't start drag
      }
      
      // PRIORITY 2: Object drag (if not on border)
      console.log(`[INVESTIGATE] Text drag: Starting for text ${id.slice(-6)}`);
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
    });
  
    async function handleMouseMove(e) {
      if (isEditing || !dragging) return;
      
      // Дельта в экранных координатах
      const deltaScreenX = e.clientX - startScreenX;
      const deltaScreenY = e.clientY - startScreenY;

      if (!dragInitialized && (Math.abs(deltaScreenX) > 1 || Math.abs(deltaScreenY) > 1)) {
        dragInitialized = true;
        container.dataset.dragging = "true";
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
        delete container.dataset.dragging;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить позицию КОНТЕЙНЕРА (skip z-index read - it doesn't change during drag)
        await persistTextState(id, textElement, container, { skipZIndex: true, partial: true });
        
        // Re-assert selection and restore panel after drag
        // CLEAR MASS SELECTION when re-asserting after drag
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }
        
        // Only restore panel if we actually dragged (not just a click)
        if (wasDragging && container.dataset.selected !== "true") {
          selectText();            // keeps outline, selection state, id, restores panel
        } else if (wasDragging && !window.wbeColorPanel) {
          // Text already selected, just restore panel
          safeReshowColorPicker(id, 0);
        }
      }
    }
    
    // Resize handle
    resizeHandle.addEventListener("mousedown", (e) => {
      // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track resize handle mousedown
      console.log(`[INVESTIGATE] Text resize handle mousedown: Called for text ${id.slice(-6)}, button=${e.button}`);
      
      if (e.button !== 0) return;
      console.log(`[INVESTIGATE] Text resize handle mousedown: Starting resize for text ${id.slice(-6)}`);
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
    // Listen on click-target (it's on top) and calculate position relative to textElement
    clickTarget.addEventListener("mousemove", (e) => {
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
    
    function handleResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      
      // Новый scale (минимум 0.3, максимум 3.0, как у карточки)
      const newScale = resizeStartScale + (deltaX * SCALE_SENSITIVITY);
      const clampedScale = Math.max(0.3, Math.min(3.0, newScale));
      
      // Применяем ТОЛЬКО scale к textElement
      textElement.style.transform = `scale(${newScale})`;
      
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
        if (container.dataset.selected === "true") {
          resizeHandle.style.display = "flex";
          resizeHandle.style.opacity = "0";
          
          // Animate scale handle reappearance with slight delay
          setTimeout(() => {
            requestAnimationFrame(() => {
              resizeHandle.style.transition = "opacity 0.2s ease";
              resizeHandle.style.opacity = "1";
            });
          }, 100);
        }
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить позицию контейнера + scale textElement (skip z-index read - it doesn't change during resize)
        await persistTextState(id, textElement, container, { skipZIndex: true, partial: true });
        
        // Re-assert selection and restore panel after resize
        // CLEAR MASS SELECTION when re-asserting after resize
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }
        if (container.dataset.selected !== "true") {
          selectText();            // keeps outline, selection state, id, restores panel
        } else if (!window.wbeColorPanel) {
          safeReshowColorPicker(id, 0);
        }
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
    const container = createTextElement({
      id: textId,
      text: autoEdit ? "" : "Двойной клик для редактирования",
      left: worldPos.x,
      top: worldPos.y,
      scale: DEFAULT_TEXT_SCALE,
      color: DEFAULT_TEXT_COLOR,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      borderColor: null,
      borderWidth: DEFAULT_BORDER_WIDTH,
      fontWeight: DEFAULT_FONT_WEIGHT,
      fontStyle: DEFAULT_FONT_STYLE,
      textAlign: DEFAULT_TEXT_ALIGN,
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
      width: null
    });
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
    //console.log(`[Text Creation] ID: ${textId} | z-index: ${zIndex} (addTextToCanvas)`);
    if (autoEdit) {
      // Get click-target for event dispatching
      const clickTarget = container.querySelector('.wbe-text-click-target');
      if (!clickTarget) return;
      
      // Select the text element first - dispatch on click-target (not container)
      const selectEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: clickX,
        clientY: clickY
      });
      clickTarget.dispatchEvent(selectEvent);
      
      // Then trigger edit mode - dispatch on click-target (where dblclick listener is)
      setTimeout(() => {
        const editEvent = new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          clientX: clickX,
          clientY: clickY
        });
        clickTarget.dispatchEvent(editEvent);
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

async function setAllTexts(texts, isPartial = false) {
    const timestamp = Date.now();
    const stackTrace = new Error().stack?.split('\n').slice(1, 4).join(' | ') || 'unknown';
    
    // [ZINDEX_ANALYSIS] Track setAllTexts calls
    const textIds = Object.keys(texts);
    const isEmptyPayload = textIds.length === 0;
    console.log(`[ZINDEX_ANALYSIS] setAllTexts ENTRY: [${timestamp}] texts=${textIds.length}, isEmpty=${isEmptyPayload}, isPartial=${isPartial}, isGM=${game.user.isGM}, caller=${stackTrace.split('|')[0]?.trim() || 'unknown'}`);
    // [ZINDEX_ANALYSIS] Track z-index values in payload
    if (!isEmptyPayload) {
      const zIndexMap = new Map();
      textIds.forEach(id => {
        const textData = texts[id];
        const zIndex = textData?.zIndex || window.ZIndexManager?.get(id) || 0;
        if (!zIndexMap.has(zIndex)) zIndexMap.set(zIndex, []);
        zIndexMap.get(zIndex).push(id);
      });
      const duplicates = Array.from(zIndexMap.entries()).filter(([z, ids]) => ids.length > 1 && z > 0);
      if (duplicates.length > 0) {
        console.error(`[ZINDEX_ANALYSIS] setAllTexts: DUPLICATES in payload:`, duplicates.map(([z, ids]) => `z=${z}: ${ids.length} objects (${ids.map(id => id.slice(-6)).join(', ')})`));
      }
    }
    
    try {
      console.log(`[WB-E] setAllTexts: [${timestamp}] Sending ${textIds.length} texts (isPartial=${isPartial}):`, textIds.slice(0, 5));
      // Manager already has correct values from local operations
      if (game.user.isGM) {
        if (isPartial) {
          // Partial update: merge with current DB state
          const currentTexts = await getAllTexts();
          const mergedTexts = { ...currentTexts, ...texts };
          await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, mergedTexts);
        } else {
          // Full update: replace entire state
          await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
          await new Promise(resolve => setTimeout(resolve, 50));
          await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, texts);
        }
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
                continue;
              }

              // Обновляем существующий элемент
              const textElement = existing.querySelector(".wbe-canvas-text");
              const textSpan = textElement?.querySelector(".wbe-text-background-span");
              if (textElement) {
                // ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
                if (textElement.contentEditable === "true") {
                  console.log(`[WB-E] GM skipping socket update for ${id} - actively being edited`);
                  continue;
                }
                // Update text content - check for span first
                if (textSpan) {
                  textSpan.textContent = textData.text;
                } else {
                  textElement.textContent = textData.text;
                }

                existing.style.left = `${textData.left}px`;
                existing.style.top = `${textData.top}px`;
                textElement.style.transform = `scale(${textData.scale})`;
                textElement.style.color = textData.color || TextTools.DEFAULT_TEXT_COLOR; // Apply color

                // Apply background to span
                if (textSpan && textData.backgroundColor) {
                  textSpan.style.backgroundColor = textData.backgroundColor;
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
                  // Skip width update - element is locked (lockedSize=true)
                }
                // Update resize handle position after scale/size changes
                TextTools.updateTextUI(existing);
              }
            } else {
              // Создаем новый элемент
              const createdContainer = TextTools.createTextElement({
                id: id,
                text: textData.text,
                left: textData.left,
                top: textData.top,
                scale: textData.scale,
                color: textData.color,
                backgroundColor: textData.backgroundColor,
                borderColor: textData.borderColor,
                borderWidth: textData.borderWidth,
                fontWeight: textData.fontWeight,
                fontStyle: textData.fontStyle,
                textAlign: textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN,
                fontFamily: textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY,
                fontSize: textData.fontSize || TextTools.DEFAULT_FONT_SIZE,
                width: textData.width,
                rank: textData.rank
              });

              // Apply color to newly created element (background already set in createTextElement via span)
              const created = createdContainer || document.getElementById(id);
              if (created) {
                const textElement = created.querySelector(".wbe-canvas-text");
                if (textElement) {
                  textElement.style.color = textData.color || TextTools.DEFAULT_TEXT_COLOR;
                  // Apply background to span (createTextElement already created span with background)
                  const textSpan = textElement.querySelector(".wbe-text-background-span");
                  if (textSpan && textData.backgroundColor) {
                    textSpan.style.backgroundColor = textData.backgroundColor;
                  }
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

          // Удаляем элементы только при full sync (not partial)
          if (!isPartial) {
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
        }

        // Send sync: full sync for full updates, partial sync for partial updates
        game.socket.emit(`module.${MODID}`, { type: "textUpdate", texts, isFullSync: !isPartial });
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
        
        // [ZINDEX_ANALYSIS] Track socket emit
        const textIdsForSocket = Object.keys(textsWithRank);
        console.log(`[ZINDEX_ANALYSIS] setAllTexts: Emitting textUpdateRequest: texts=${textIdsForSocket.length}, isEmpty=${textIdsForSocket.length === 0}`);
        
        // [INVESTIGATE] Track socket emit for non-GM
        console.log(`[INVESTIGATE] setAllTexts (non-GM): About to emit textUpdateRequest with ${textIdsForSocket.length} texts`);
        
        // Отправляем запрос GM через socket
        game.socket.emit(`module.${MODID}`, { type: "textUpdateRequest", texts: textsWithRank, isPartial });
        
        // [INVESTIGATE] Track socket emit completion
        console.log(`[INVESTIGATE] setAllTexts (non-GM): Emitted textUpdateRequest with texts:`, textIdsForSocket.slice(0, 5));
        
        // Обновляем локально для немедленной реакции UI у игрока
        const layer = getOrCreateLayer();
        if (layer) {
          // Получаем все существующие текстовые элементы
          const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
          const existingIds = new Set(Array.from(existingElements).map(el => el.id));

          for (const [id, textData] of Object.entries(texts)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
            if (existing) {
              
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
              const createdContainer = createTextElement({
                id: id,
                text: textData.text,
                left: textData.left,
                top: textData.top,
                scale: textData.scale,
                color: textData.color || DEFAULT_TEXT_COLOR,
                backgroundColor: textData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
                borderColor: textData.borderColor || null,
                borderWidth: textData.borderWidth ?? DEFAULT_BORDER_WIDTH,
                fontWeight: textData.fontWeight || DEFAULT_FONT_WEIGHT,
                fontStyle: textData.fontStyle || DEFAULT_FONT_STYLE,
                textAlign: textData.textAlign || DEFAULT_TEXT_ALIGN,
                fontFamily: textData.fontFamily || DEFAULT_FONT_FAMILY,
                fontSize: textData.fontSize || DEFAULT_FONT_SIZE,
                width: textData.width ?? null,
                rank: textData.rank
              });
              
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
                  // Skip locked elements
                } else {
                  toRemove.push(element.id);
                }
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
            // Skip DOM prune for empty payload on non-GM client; awaiting authoritative sync
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

/**
 * Install global text selection handler (like images)
 * Single handler for ALL texts - manages selection through textRegistry
 */
function installGlobalTextSelectionHandler() {
  if (globalTextSelectionHandlerInstalled) return;

  document.addEventListener("mousedown", (e) => {
    const handlerStartTime = performance.now();
    const handlerId = `TEXT-${handlerStartTime.toFixed(3)}`;
    
    if (e.button !== 0) return;

    wbeLog(handlerId, 'TEXT HANDLER START', {
      target: e.target?.className || 'none',
      clientX: e.clientX,
      clientY: e.clientY
    });

    // Skip if clicking on color panel
    if (window.wbeColorPanel && window.wbeColorPanel.contains(e.target)) {
      wbeLog(handlerId, 'TEXT HANDLER: Clicked on color panel, returning');
      return;
    }

    // Find which text was clicked (if any) using registry
    let clickedTextId = null;
    let clickedTextData = null;

    // Temporarily enable pointer-events on ALL text click-targets for hit detection
    const layer = document.getElementById('whiteboard-experience-layer') ||
                  document.querySelector('.wbe-layer') || 
                  document.getElementById('board')?.parentElement?.querySelector('#whiteboard-experience-layer') ||
                  document.querySelector('[class*="wbe-layer"]');
    const textPointerEventsMap = new Map();

    if (layer) {
      for (const [textId, textData] of textRegistry) {
        const container = textData.container;
        
        // Skip locked or mass-selected texts
        if ((container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) ||
            container.classList.contains("wbe-mass-selected")) {
          continue;
        }

        const clickTarget = textData.clickTarget;
        if (clickTarget) {
          const originalPointerEvents = clickTarget.style.pointerEvents;
          textPointerEventsMap.set(textId, originalPointerEvents);
          clickTarget.style.setProperty("pointer-events", "auto", "important");
        }
      }
    }

    // Use elementsFromPoint to check z-order
    const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
    
    // Find topmost text (lowest index in elementsAtPoint = highest z-index)
    // Same algorithm as images - iterate elementsAtPoint, not registry
    for (let i = 0; i < elementsAtPoint.length; i++) {
      const el = elementsAtPoint[i];
      
      // Check if this element belongs to a text
      const textContainer = el.closest('.wbe-canvas-text-container');
      if (textContainer) {
        const id = textContainer.id;
        const textData = textRegistry.get(id);
        
        console.log(`[GLOBAL TEXT HANDLER] Found text at index ${i}: ${id.slice(-6)}, locked=${!!(textContainer.dataset.lockedBy && textContainer.dataset.lockedBy !== game.user.id)}, massSelected=${textContainer.classList.contains("wbe-mass-selected")}`);
        
        // Validate (skip locked, mass-selected)
        if (textData &&
            !(textContainer.dataset.lockedBy && textContainer.dataset.lockedBy !== game.user.id) &&
            !textContainer.classList.contains("wbe-mass-selected")) {
          
          // Found topmost valid text (first in elementsAtPoint = highest z-index)
          clickedTextId = id;
          clickedTextData = textData;
          console.log(`[GLOBAL TEXT HANDLER] Selected topmost text: ${id.slice(-6)}`);
          break; // Stop at first valid text (topmost)
        }
      }
    }
    
    console.log(`[GLOBAL TEXT HANDLER] Final clickedTextId: ${clickedTextId ? clickedTextId.slice(-6) : 'none'}`);

    // Check if image is on top (compare with text position if text was found)
    const imageIndex = elementsAtPoint.findIndex(el => 
      el.classList.contains('wbe-image-click-target') || 
      el.classList.contains('wbe-canvas-image-container')
    );

    // If we found a text, check if any image is higher (lower index = higher z-index)
    let textIsOnTop = false;
    if (clickedTextId) {
      const textIndex = elementsAtPoint.findIndex(el => 
        el === clickedTextData.container || clickedTextData.container.contains(el)
      );
      textIsOnTop = textIndex !== -1 && (imageIndex === -1 || textIndex < imageIndex);
    }

    if (textIsOnTop) {
      const container = clickedTextData.container;
      
      // Skip locked texts
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        e.preventDefault();
        e.stopPropagation();
        restorePointerEvents(textPointerEventsMap);
        return;
      }

      // PREVENT SINGLE CLICK SELECTION OF MASS-SELECTED TEXT
      if (container.classList.contains("wbe-mass-selected")) {
        e.preventDefault();
        e.stopPropagation();
        restorePointerEvents(textPointerEventsMap);
        return;
      }

      if (container.dataset.selected !== "true") {
        // First click - select text
        // NOTE: DON'T block event - let drag handler also receive it for auto-select
        // This allows drag to work immediately after paste without separate click
        
        const selectStartTime = performance.now();
        wbeLog(handlerId, 'TEXT HANDLER: Calling selectFn()', { textId: clickedTextId.slice(-6) });
        
        // CLEAR MASS SELECTION
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }

        clickedTextData.selectFn();
        
        const selectEndTime = performance.now();
        wbeLog(handlerId, 'TEXT HANDLER: selectFn() completed', {
          textId: clickedTextId.slice(-6),
          duration: (selectEndTime - selectStartTime).toFixed(3),
          selectedTextId: window.TextTools?.selectedTextId?.slice(-6) || 'none',
          stoppedPropagation: false
        });

        // Restore pointer events (exclude selected text)
        restorePointerEvents(textPointerEventsMap, clickedTextId);
        // Don't return - let event propagate to drag handler
      } else {
        // Already selected - let drag handler receive event
        restorePointerEvents(textPointerEventsMap, clickedTextId);
        if (!window.wbeColorPanel) {
          safeReshowColorPicker(clickedTextId, 0);
        }
        return;
      }
    } else {
      // Clicked elsewhere - deselect all texts
      if (skipNextTextDeselect) {
        skipNextTextDeselect = false;
        restorePointerEvents(textPointerEventsMap);
        return;
      }

      for (const [textId, textData] of textRegistry) {
        if (textData.container.dataset.selected === "true") {
          textData.deselectFn();
        }
      }

      restorePointerEvents(textPointerEventsMap);
    }

    // Helper: restore pointer-events
    function restorePointerEvents(pointerEventsMap, excludeId = null) {
      for (const [textId, originalPointerEvents] of pointerEventsMap) {
        if (textId === excludeId) continue; // Keep selected text's pointer-events
        
        const textData = textRegistry.get(textId);
        if (textData && textData.clickTarget) {
          if (originalPointerEvents) {
            textData.clickTarget.style.setProperty("pointer-events", originalPointerEvents, "important");
          } else {
            textData.clickTarget.style.removeProperty("pointer-events");
          }
        }
      }
    }
  }, true);

  globalTextSelectionHandlerInstalled = true;
}

// Install global text selection handler once
installGlobalTextSelectionHandler();

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
