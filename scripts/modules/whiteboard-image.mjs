import {
  MODID,
  ZIndexManager,
  ZIndexConstants,
  FLAG_SCOPE,
  FLAG_KEY_IMAGES,
  screenToWorld,
  getSharedVars,          // lastMouseX/lastMouseY etc. — only call inside functions
  setSelectedImageId,
  wbeLog
} from "../main.mjs";

// Scale sensitivity constant
const SCALE_SENSITIVITY = 0.0025; // Sensitivity for image scaling (increased for better responsiveness)

// Freeze animation constants
const FREEZE_FADE_DURATION = 0.5; // Duration in seconds for normal panel fade when freezing

// Border and shadow default constants
const DEFAULT_BORDER_HEX = "#000000";
const DEFAULT_BORDER_OPACITY = 50;
const DEFAULT_BORDER_WIDTH = 10;
const DEFAULT_BORDER_RADIUS = 0;
const DEFAULT_SHADOW_HEX = "#000000";
const DEFAULT_SHADOW_OPACITY = 50;

// Helper functions for border color management
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

// Inject CSS for frozen selection styling (called after imports resolve)
function injectFrozenSelectionStyles() {
  if (!document.querySelector('#wbe-frozen-selection-styles')) {
    const style = document.createElement('style');
    style.id = 'wbe-frozen-selection-styles';
    style.textContent = `
      .wbe-image-selection-border.wbe-frozen-selected {
        border-color: #666666 !important;
        border-width: 2px !important;
        border-style: solid !important;
        opacity: 1 !important;
        z-index: ${ZIndexConstants.SELECTION_BORDER_FROZEN} !important;
      }
      
      .wbe-image-frozen .wbe-image-selection-border.wbe-frozen-selected {
        border-color: #666666 !important;
        border-width: 2px !important;
        z-index: ${ZIndexConstants.SELECTION_BORDER_FROZEN} !important;
      }
    `;
    document.head.appendChild(style);
  }
}

// Inject CSS after imports resolve (init runs after imports but before ready)
Hooks.once("init", injectFrozenSelectionStyles);

// Debounce function for batching rapid image updates
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

// Pending image state updates queue (keyed by object ID)
const pendingImageUpdates = new Map();



// Debounced function to flush all pending image updates
const debouncedFlushImageUpdates = debounce(async () => {
  if (pendingImageUpdates.size === 0) return;
  
  const pendingIds = Array.from(pendingImageUpdates.keys());
  
  // INSTRUMENTATION: Log flush start
  wbeLog('FlushImages', `START: pendingCount=${pendingImageUpdates.size}, pendingIds=${pendingIds.map(id => id.slice(-6)).join(',')}`);
  
  // CRITICAL FIX: Build complete state from DOM FIRST (source of truth during rapid updates)
  // Read DB state to preserve border properties that might be missing from DOM
  const dbImages = await getAllImages();
  
  // INSTRUMENTATION: Log DB state
  const dbIds = Object.keys(dbImages);
  wbeLog('FlushImages', `DB_STATE: dbCount=${dbIds.length}, dbIds=${dbIds.map(id => id.slice(-6)).slice(0, 10).join(',')}`);
  
  // Then merge with DB state, then apply pending updates
  const images = {};
  
  // First, extract ALL images from DOM (most reliable source during rapid updates)
  const layer = document.getElementById('whiteboard-experience-layer') ||
                document.querySelector('.wbe-layer') || 
                document.getElementById('board')?.parentElement?.querySelector('#whiteboard-experience-layer') ||
                document.querySelector('[class*="wbe-layer"]');
  let domExtractedCount = 0;
  if (layer) {
    const existingContainers = layer.querySelectorAll('.wbe-canvas-image-container');
    const domIds = Array.from(existingContainers).map(c => c.id);
    existingContainers.forEach(existingContainer => {
      const existingId = existingContainer.id;
      if (existingId) {
        const existingImageElement = existingContainer.querySelector('.wbe-canvas-image');
        if (existingImageElement) {
          const existingCropData = getImageCropData(existingImageElement);
          // Extract border style from permanentBorder
          const permanentBorder = existingContainer.querySelector('.wbe-image-permanent-border');
          const borderStyle = getImageBorderStyle(permanentBorder);
          
          // Extract shadow style from container
          const shadowStyle = getImageShadowStyle(existingContainer);
          
          // Preserve border properties from DB if missing from DOM
          const dbImageData = dbImages[existingId];
          const preservedBorder = borderStyle ? null : (dbImageData?.borderHex != null ? {
            hex: dbImageData.borderHex,
            opacity: dbImageData.borderOpacity,
            width: dbImageData.borderWidth,
            radius: dbImageData.borderRadius
          } : null);
          
          // Preserve shadow properties from DB if missing from DOM
          const preservedShadow = shadowStyle ? null : (dbImageData?.shadowHex != null ? {
            hex: dbImageData.shadowHex,
            opacity: dbImageData.shadowOpacity
          } : null);
          
          const existingImageData = {
            src: existingImageElement.src,
            left: parseFloat(existingContainer.style.left) || 0,
            top: parseFloat(existingContainer.style.top) || 0,
            scale: existingCropData.scale || 1,
            crop: existingCropData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
            maskType: existingCropData.maskType || 'rect',
            circleOffset: existingCropData.circleOffset || { x: 0, y: 0 },
            circleRadius: existingCropData.circleRadius || null,
            isFrozen: existingContainer.dataset.frozen === 'true' || false,
            // EXPERIMENT PHASE 1: Manager is single source of truth for z-index
            // DOM is just a view that _syncDOMZIndex keeps in sync
            zIndex: ZIndexManager.get(existingId),
            rank: ZIndexManager.getRank(existingId),
            // Extract displayWidth/displayHeight from dataset for F5 reload
            displayWidth: existingImageElement.dataset.displayWidth ? parseFloat(existingImageElement.dataset.displayWidth) : null,
            displayHeight: existingImageElement.dataset.displayHeight ? parseFloat(existingImageElement.dataset.displayHeight) : null,
            // Border style - use DOM if available, otherwise preserve from DB
            ...(borderStyle ? {
              borderHex: borderStyle.hex,
              borderOpacity: borderStyle.opacity,
              borderWidth: borderStyle.width,
              borderRadius: borderStyle.radius
            } : preservedBorder ? {
              borderHex: preservedBorder.hex,
              borderOpacity: preservedBorder.opacity,
              borderWidth: preservedBorder.width,
              borderRadius: preservedBorder.radius
            } : {}),
            // Shadow style - use DOM if available, otherwise preserve from DB
            ...(shadowStyle ? {
              shadowHex: shadowStyle.hex,
              shadowOpacity: shadowStyle.opacity
            } : preservedShadow ? {
              shadowHex: preservedShadow.hex,
              shadowOpacity: preservedShadow.opacity
            } : {})
          };
          images[existingId] = existingImageData;
          domExtractedCount++;
        }
      }
    });
  }
  
  // EXPERIMENT PHASE 1: Don't merge DB state - Manager already has all objects
  // DB is just for persistence, not a source of truth
  // If an object is missing from DOM, it was deleted - trust that
  
  // Apply all pending updates (these override DOM)
  // But preserve border and shadow properties from DB if missing from pending updates
  pendingImageUpdates.forEach((imageData, id) => {
    const dbImageData = dbImages[id];
    const hasBorder = imageData.borderHex != null;
    const hasShadow = imageData.shadowHex != null;
    
    if (!hasBorder && dbImageData?.borderHex != null) {
      imageData = {
        ...imageData,
        borderHex: dbImageData.borderHex,
        borderOpacity: dbImageData.borderOpacity,
        borderWidth: dbImageData.borderWidth,
        borderRadius: dbImageData.borderRadius
      };
    }
    
    if (!hasShadow && dbImageData?.shadowHex != null) {
      imageData = {
        ...imageData,
        shadowHex: dbImageData.shadowHex,
        shadowOpacity: dbImageData.shadowOpacity
      };
    }
    
    images[id] = imageData;
  });
  
  const finalIds = Object.keys(images);
  
  // INSTRUMENTATION: Log before setAllImages
  const domIds = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')).map(el => el.id) : [];
  const duplicates = domIds.filter((id, idx) => domIds.indexOf(id) !== idx);
  
  // [INVESTIGATE] Детальное логирование перед setAllImages из debouncedFlushImageUpdates
  const finalDbIds = Object.keys(dbImages);
  const inFinalNotInDOM = finalIds.filter(id => !domIds.includes(id));
  const inFinalNotInDB = finalIds.filter(id => !finalDbIds.includes(id));
  const inDOMNotInFinal = domIds.filter(id => !finalIds.includes(id));
  const inDBNotInFinal = finalDbIds.filter(id => !finalIds.includes(id));
  
  const stackTrace = new Error().stack?.split('\n').slice(1, 8).join(' | ') || 'unknown';
  
  console.log(`[INVESTIGATE] debouncedFlushImageUpdates → setAllImages:`, {
    userId: game.user.id,
    userName: game.user.name,
    finalCount: finalIds.length,
    finalIds: finalIds.map(id => id.slice(-6)),
    domCount: domIds.length,
    domIds: domIds.map(id => id.slice(-6)),
    dbCount: finalDbIds.length,
    dbIds: finalDbIds.map(id => id.slice(-6)),
    pendingCount: pendingIds.length,
    pendingIds: pendingIds.map(id => id.slice(-6)),
    inFinalNotInDOM: inFinalNotInDOM.map(id => id.slice(-6)),
    inFinalNotInDB: inFinalNotInDB.map(id => id.slice(-6)),
    inDOMNotInFinal: inDOMNotInFinal.map(id => id.slice(-6)),
    inDBNotInFinal: inDBNotInFinal.map(id => id.slice(-6)),
    duplicates: duplicates.length > 0 ? duplicates.map(id => id.slice(-6)) : null,
    caller: stackTrace.split('|')[0]?.trim() || 'unknown'
  });
  
  if (inFinalNotInDOM.length > 0) {
    console.error(`[INVESTIGATE] ⚠️ debouncedFlushImageUpdates: Final payload contains ${inFinalNotInDOM.length} images NOT in DOM:`, inFinalNotInDOM.map(id => id.slice(-6)));
  }
  if (inFinalNotInDB.length > 0) {
    console.warn(`[INVESTIGATE] ⚠️ debouncedFlushImageUpdates: Final payload contains ${inFinalNotInDB.length} images NOT in DB:`, inFinalNotInDB.map(id => id.slice(-6)));
  }
  
  wbeLog('FlushImages', `BEFORE_SETALL: finalCount=${finalIds.length}, domCount=${domIds.length}, domIds=${domIds.map(id => id.slice(-6)).slice(0, 10).join(',')}, duplicates=${duplicates.length > 0 ? duplicates.map(id => id.slice(-6)).join(',') : 'none'}`, {
    finalIds: finalIds.slice(0, 10),
    domIds: domIds.slice(0, 10),
    pendingIds: pendingIds.slice(0, 10),
    duplicates: duplicates.length > 0 ? duplicates : null
  });

  // [PARTIAL FLAG] Check if we have partial updates
  const partialImages = [];
  pendingImageUpdates.forEach((state, id) => {
    if (state._partial === true) {
      partialImages.push(id);
    }
  });

  // Clear pending updates before processing
  const pendingUpdatesCopy = new Map(pendingImageUpdates);
  pendingImageUpdates.clear();

  // If we have partial updates, send only those (they already contain full state)
  if (partialImages.length > 0) {
    console.log(`[PARTIAL FLAG] debouncedFlushImageUpdates: Processing ${partialImages.length} images with _partial=true:`, partialImages.map(id => id.slice(-6)));
    const partialPayload = {};
    partialImages.forEach(id => {
      const state = pendingUpdatesCopy.get(id);
      if (state) {
        // Preserve border/shadow from DB if missing from pending update
        const dbImageData = dbImages[id];
        const hasBorder = state.borderHex != null;
        const hasShadow = state.shadowHex != null;
        
        let finalState = { ...state };
        
        if (!hasBorder && dbImageData?.borderHex != null) {
          finalState = {
            ...finalState,
            borderHex: dbImageData.borderHex,
            borderOpacity: dbImageData.borderOpacity,
            borderWidth: dbImageData.borderWidth,
            borderRadius: dbImageData.borderRadius
          };
        }
        
        if (!hasShadow && dbImageData?.shadowHex != null) {
          finalState = {
            ...finalState,
            shadowHex: dbImageData.shadowHex,
            shadowOpacity: dbImageData.shadowOpacity
          };
        }
        
        // Remove _partial flag before sending
        const { _partial, ...cleanState } = finalState;
        partialPayload[id] = cleanState;
      }
    });
    await setAllImages(partialPayload, true); // true = isPartial
  } else {
    // No partial updates - use full sync (current logic)
    await setAllImages(images, false); // false = isPartial
  }
}, 200); // 300ms debounce - reduced to minimize flicker during rapid z-index changes

// Persist image state using debounced batching (similar to persistTextState)
async function persistImageState(id, imageElement, container, options = {}) {
  if (!id || !imageElement || !container) return;
  
  const cropData = getImageCropData(imageElement);
  
  // OPTIMIZATION: Only read z-index if not skipping (for high-speed operations)
  // If skipping, use cached value from pending updates or fall back to manager
  let zIndex;
  if (options.skipZIndex) {
    // Skip z-index read - use cached value from pending updates or manager
    const cached = pendingImageUpdates.get(id);
    zIndex = cached?.zIndex || ZIndexManager.get(id);
  } else {
    // Read z-index from manager (single source of truth)
    // DOM is updated by syncAllDOMZIndexes() but may not be updated yet due to requestAnimationFrame
    zIndex = ZIndexManager.get(id);
  }
  
  // Calculate display dimensions (visible area after scale and crop) for F5 reload placeholder sizing
  let displayWidth = null;
  let displayHeight = null;
  if (imageElement.complete && imageElement.naturalWidth > 0 && imageElement.naturalHeight > 0) {
    const dims = calculateCroppedDimensions(imageElement, cropData.maskType || 'rect', cropData.crop || { top: 0, right: 0, bottom: 0, left: 0 }, cropData.circleOffset || { x: 0, y: 0 }, cropData.circleRadius, cropData.scale || 1);
    displayWidth = dims.width;
    displayHeight = dims.height;
    
    // Update dataset for consistency (so DOM extraction can read them)
    imageElement.dataset.displayWidth = displayWidth;
    imageElement.dataset.displayHeight = displayHeight;
    
    console.log('[PERSIST SAVE] Calculated displayWidth/Height', {
      id,
      displayWidth,
      displayHeight,
      scale: cropData.scale,
      complete: imageElement.complete,
      naturalWidth: imageElement.naturalWidth
    });
  } else {
    console.log('[PERSIST SAVE] Image not loaded, displayWidth/Height will be null', {
      id,
      complete: imageElement.complete,
      naturalWidth: imageElement.naturalWidth
    });
  }
  
  // Extract border style from permanentBorder
  const permanentBorder = container.querySelector('.wbe-image-permanent-border');
  const borderStyle = getImageBorderStyle(permanentBorder);
  
  // Extract shadow style from container
  const shadowStyle = getImageShadowStyle(container);
  
  const imageData = {
    src: imageElement.src,
    left: parseFloat(container.style.left) || 0,
    top: parseFloat(container.style.top) || 0,
    scale: cropData.scale || 1,
    crop: cropData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    maskType: cropData.maskType || 'rect',
    circleOffset: cropData.circleOffset || { x: 0, y: 0 },
    circleRadius: cropData.circleRadius || null,
    isFrozen: container.dataset.frozen === 'true' || false,
    zIndex: zIndex,
    rank: ZIndexManager.getRank(id),
    displayWidth, // Size of visible area (for F5 reload placeholder sizing)
    displayHeight, // Size of visible area (for F5 reload placeholder sizing)
    // Border style - only include if borderStyle exists
    ...(borderStyle ? {
      borderHex: borderStyle.hex,
      borderOpacity: borderStyle.opacity,
      borderWidth: borderStyle.width,
      borderRadius: borderStyle.radius
    } : {}),
    // Shadow style - only include if shadowStyle exists
    ...(shadowStyle ? {
      shadowHex: shadowStyle.hex,
      shadowOpacity: shadowStyle.opacity
    } : {})
  };
  
  // Mark as partial update if requested (for drag/resize operations)
  if (options.partial) {
    imageData._partial = true;
    console.log(`[PARTIAL FLAG] Image ${id.slice(-6)}: _partial flag set to true`);
  }
  
  // Queue the update for debounced batching
  pendingImageUpdates.set(id, imageData);
  
  // Trigger debounced flush (will batch multiple rapid changes)
  debouncedFlushImageUpdates();
}

async function persistSwappedLayerTarget(swappedInfo) {
  if (!swappedInfo || !swappedInfo.id) return;

  const swappedId = swappedInfo.id;
  const swappedContainer = document.getElementById(swappedId);
  if (!swappedContainer) return;

  if (swappedId.startsWith('wbe-image-')) {
    const swappedImageElement = swappedContainer.querySelector('.wbe-canvas-image');
    if (swappedImageElement) {
      await persistImageState(swappedId, swappedImageElement, swappedContainer);
    }
    return;
  }

  if (swappedId.startsWith('wbe-text-')) {
    const swappedTextElement = swappedContainer.querySelector('.wbe-canvas-text');
    const persistText = window.TextTools?.persistTextState;
    if (swappedTextElement && typeof persistText === 'function') {
      await persistText(swappedId, swappedTextElement, swappedContainer);
    }
  }
}

// Expose to window for closure access
window.wbePendingImageUpdates = pendingImageUpdates;
window.wbeDebouncedFlushImageUpdates = debouncedFlushImageUpdates;

let copiedImageData = null; // Буфер для копирования картинок
let selectedImageId = null; // ID выделенного изображения
let isScalingImage = false; // Flag to prevent deselection during scaling
// Глобальное хранилище данных картинок для синхронизации
let globalImageData = {}; // { [id]: { maskType, circleOffset, circleRadius, crop, scale } }
// Глобальное хранилище локальных переменных картинок
let imageLocalVars = {}; // { [id]: { maskType, circleOffset, circleRadius, crop, scale } }
/* ----------------------- Image Selection Registry ------------------ */
// Registry to track all image containers for centralized selection management
const imageRegistry = new Map(); // { id: { container, selectFn, deselectFn, isFrozen } }
// Single global handler for ALL image selection/deselection
let globalImageSelectionHandlerInstalled = false;
let removalObserver = null;




// ======================== Image Freeze Management ========================

function setImageFrozen(id, frozen, sync = false) {
  const imageData = imageRegistry.get(id);
  if (!imageData) return;

  // Check if image is currently selected before applying freeze state
  const wasSelected = imageData.container.dataset.selected === "true";

  // Handle sync logic for players (non-GM users)
  if (sync && !game.user.isGM) {
    try {
      // Player: request GM to sync
      game.socket.emit(`module.${MODID}`, {
        type: 'gm-request',
        action: 'freeze-image',
        data: { imageId: id, frozen: frozen, userId: game.user.id }
      });
      return;
    } catch (error) {
      console.error('[WB-E] Failed to send freeze request to GM, falling back to local-only:', error);
      // Continue with local-only freeze as fallback
    }
  }

  // Apply freeze state locally
  imageData.isFrozen = frozen;
  imageData.container.dataset.frozen = frozen ? "true" : "false";

  // Ensure frozen images have the same deselected state as normal deselected images
  // This allows canvas pan/zoom to work through them (container and click target have pointer-events: none)
  if (frozen) {
    // Ensure container and click target are set to pointer-events: none (same as deselected)
    // This is already handled by the deselection process, but ensure it stays that way
    const clickTarget = imageData.container.querySelector('.wbe-image-click-target');
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }
    // Container should already be deselected, but ensure it stays deselected
    imageData.container.style.setProperty("pointer-events", "none", "important");
    
    // Setup canvas pass-through handlers (for cleanup)
    setupFrozenImageCanvasPassThrough(imageData.container);
  } else {
    // Remove canvas pass-through when unfreezing
    // Pointer events will be restored when image is selected
    removeFrozenImageCanvasPassThrough(imageData.container);
  }

  // Update visual indicator
  if (frozen) {
    imageData.container.classList.add("wbe-image-frozen");
    // Show unfreeze icon in top-left corner
    // If image was selected, wait for fade animation; otherwise show immediately
    const delay = wasSelected ? (FREEZE_FADE_DURATION * 1000 + 100) : 0;
    setTimeout(() => {
      showUnfreezeIcon(imageData.container);
    }, delay);
  } else {
    imageData.container.classList.remove("wbe-image-frozen");
    // Always clean up frozen visual elements when unfreezing
    hideFrozenSelection(imageData.container);
    hideUnfreezeIcon(imageData.container);
  }

  // Handle visual transition for selected images when freeze state changes via sync
  if (!sync && wasSelected) {
    // This is a sync update and the image was selected - handle the transition
    if (frozen) {
      // Image was selected and is now being frozen - transition to frozen state
      
      // Hide normal control panel
      if (typeof killImageControlPanel !== 'undefined') {
        killImageControlPanel();
      }
      
      // Deselect normally first to clean up normal selection state
      if (imageData.deselectFn) {
        imageData.deselectFn();
      }
      
      // Show unfreeze icon (no frozen selection/panel anymore)
      setTimeout(() => {
        showUnfreezeIcon(imageData.container);
      }, 100);
      
    } else {
      // Image was selected and is now being unfrozen - transition to normal selection
      
      // Hide unfreeze icon
      hideUnfreezeIcon(imageData.container);
      hideFrozenSelection(imageData.container);
      
      // Select normally
      setTimeout(() => {
        if (imageData.selectFn) {
          imageData.selectFn();
        }
      }, 100);
    }
  }

  // Persist freeze state to scene flags (GM only)
  // Use persistImageState to avoid race conditions with other saves
  if (game.user.isGM) {
    // Use setTimeout to avoid blocking, but ensure proper state is saved
    setTimeout(async () => {
      try {
        const container = imageData.container;
        const imageElement = container.querySelector('.wbe-canvas-image');
        if (imageElement) {
          // This will batch the save with any other pending updates
          await persistImageState(id, imageElement, container, { skipZIndex: true });
        }
      } catch (error) {
        console.error('[WB-E] Failed to persist freeze state:', error);
      }
    }, 50); // Small delay to ensure DOM state is updated
  }

  // Handle sync logic for GM users
  if (sync && game.user.isGM) {
    try {
      // GM: broadcast to all clients
      game.socket.emit(`module.${MODID}`, {
        type: 'freeze-sync',
        data: { imageId: id, frozen: frozen, userId: game.user.id }
      });
    } catch (error) {
      console.error('[WB-E] Failed to broadcast freeze sync:', error);
      // Local freeze still applied, just no sync
    }
  }
}

function isImageFrozen(id) {
  const imageData = imageRegistry.get(id);
  return imageData ? imageData.isFrozen : false;
}



/**
 * @typedef {Object} DragState
 * @property {boolean} active - Currently in drag operation (mouse down occurred)
 * @property {boolean} initialized - Drag movement has started (mouse moved > threshold)
 * @property {number} startScreenX - Initial mouse screen X coordinate
 * @property {number} startScreenY - Initial mouse screen Y coordinate
 * @property {number} startWorldX - Initial container world X position
 * @property {number} startWorldY - Initial container world Y position
 */

/**
 * @typedef {Object} DragOptions
 * @property {Function} [onDragStart] - Callback when drag starts
 * @property {Function} [onDragMove] - Callback during drag movement
 * @property {Function} [onDragEnd] - Callback when drag ends
 * @property {Function} [onSave] - Callback to save state
 * @property {Function} [getLayer] - Function to get layer element for coordinate transformation
 * @property {boolean} [disabled] - Initial disabled state
 */

/**
 * @typedef {Object} EventHandlerMap
 * @property {Function|null} mouseDown - Mouse down event handler
 * @property {Function|null} mouseMove - Mouse move event handler
 * @property {Function|null} mouseUp - Mouse up event handler
 */

/**
 * ImageDragController - Manages drag functionality for image elements
 * Encapsulates all drag-related state and behavior in a reusable class
 */
class ImageDragController {
  /**
   * @param {HTMLElement} container - The .wbe-canvas-image-container element
   * @param {HTMLElement} imageElement - The .wbe-canvas-image element
   * @param {DragOptions} options - Configuration and callbacks
   */
  constructor(container, imageElement, options = {}) {
    // Validate required parameters
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[ImageDragController] Invalid container element provided');
    }
    if (!imageElement || !(imageElement instanceof HTMLElement)) {
      throw new Error('[ImageDragController] Invalid image element provided');
    }

    this.container = container;
    this.imageElement = imageElement;
    this.options = { ...options };

    /** @type {DragState} */
    this.dragState = {
      active: false,
      initialized: false,
      startScreenX: 0,
      startScreenY: 0,
      startWorldX: 0,
      startWorldY: 0
    };

    /** @type {EventHandlerMap} */
    this.eventHandlers = {
      mouseDown: null,
      mouseMove: null,
      mouseUp: null
    };

    // Bind methods to preserve 'this' context
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    // Auto-enable unless explicitly disabled
    if (!this.options.disabled) {
      this.enable();
    }
  }

  /**
   * Enable drag functionality by attaching event listeners
   */
  enable() {
    if (this.eventHandlers.mouseDown) {
      return; // Already enabled
    }
    this.attachEventListeners();
  }

  /**
   * Temporarily disable dragging without cleanup
   */
  disable() {
    this.removeEventListeners();
  }

  /**
   * Permanently remove all event listeners and clean up resources
   */
  destroy() {
    // Guard against multiple destroy calls
    if (!this.eventHandlers) return;

    this.removeEventListeners();
    this.container = null;
    this.imageElement = null;
    this.options = null;
    this.dragState = null;
    this.eventHandlers = null;
  }

  /**
   * Check if currently dragging
   * @returns {boolean}
   */
  isDragging() {
    return this.dragState ? this.dragState.active : false;
  }

  /**
   * Get copy of current drag state for debugging
   * @returns {DragState}
   */
  getDragState() {
    return this.dragState ? { ...this.dragState } : null;
  }

  /**
   * Attach event listeners to click target (or container if click target doesn't exist yet)
   * @private
   */
  attachEventListeners() {
    if (!this.container) return;

    // FIX: Listen on click target for drag (it has pointer-events: auto when selected)
    // Fallback to container if click target doesn't exist (for backward compatibility)
    const clickTarget = this.container.querySelector('.wbe-image-click-target');
    const targetElement = clickTarget || this.container;

    this.eventHandlers.mouseDown = this._onMouseDown;
    targetElement.addEventListener('mousedown', this.eventHandlers.mouseDown);
    this.eventHandlers.targetElement = targetElement; // Store for cleanup
  }

  /**
   * Remove event listeners from click target/container and document
   * @private
   */
  removeEventListeners() {
    // Guard against multiple destroy calls
    if (!this.eventHandlers) return;

    // Remove listener from click target or container
    if (this.eventHandlers.mouseDown) {
      const targetElement = this.eventHandlers.targetElement || this.container;
      if (targetElement) {
        targetElement.removeEventListener('mousedown', this.eventHandlers.mouseDown);
      }
      this.eventHandlers.mouseDown = null;
      this.eventHandlers.targetElement = null;
    }

    // Remove document listeners
    this.removeDocumentListeners();
  }

  /**
   * Remove only document listeners (mousemove and mouseup)
   * Used during drag completion to clean up without removing container mousedown
   * @private
   */
  removeDocumentListeners() {
    // Guard against multiple destroy calls
    if (!this.eventHandlers) return;

    if (this.eventHandlers.mouseMove) {
      document.removeEventListener('mousemove', this.eventHandlers.mouseMove);
      this.eventHandlers.mouseMove = null;
    }

    if (this.eventHandlers.mouseUp) {
      document.removeEventListener('mouseup', this.eventHandlers.mouseUp);
      this.eventHandlers.mouseUp = null;
    }
  }

  /**
   * Validate if drag operation is allowed
   * @returns {boolean}
   * @private
   */
  validateDragConditions() {
    if (!this.container) return false;

    // Check if locked by another user
    if (this.container.dataset.lockedBy && this.container.dataset.lockedBy !== game.user.id) {
      return false;
    }

    // Check if image is frozen
    if (isImageFrozen && isImageFrozen(this.container.id)) {
      return false;
    }

    // Check if in crop mode - if so, let circle drag handle it instead of image drag
    if (this.container.dataset.lockedBy === game.user.id) {
      return false;
    }

    return true;
  }

  /**
   * Transform screen coordinates to world coordinates
   * @param {number} screenX - Screen X coordinate
   * @param {number} screenY - Screen Y coordinate
   * @returns {Object} World coordinates {worldX, worldY}
   * @private
   */
  transformCoordinates(screenX, screenY) {
    try {
      const layer = this.options.getLayer ? this.options.getLayer() : (typeof getOrCreateLayer !== 'undefined' ? getOrCreateLayer() : null);

      if (!layer) {
        console.warn('[ImageDragController] Layer not found, using fallback scale');
        return { worldX: screenX, worldY: screenY };
      }

      const transform = layer.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

      return {
        worldX: screenX / scale,
        worldY: screenY / scale
      };
    } catch (error) {
      console.error('[ImageDragController] Coordinate transformation failed:', error);
      return { worldX: screenX, worldY: screenY }; // Fallback
    }
  }

  /**
   * Handle mouse down event - initiate drag
   * @param {MouseEvent} event
   * @private
   */
  _onMouseDown(event) {
    
    if (event.button !== 0) return; // Only left click

    try {
      // Validate drag conditions
      const valid = this.validateDragConditions();
      if (!valid) {
        return;
      }

      // Check for control panel clicks
      if (window.wbeImageControlPanel && window.wbeImageControlPanel.contains(event.target)) {
        return;
      }
      
      if (window.wbeFrozenControlPanel && window.wbeFrozenControlPanel.contains(event.target)) {
        return;
      }

      // Handle selection logic if image not selected
      const isSelected = this.container.dataset.selected === "true";
      if (!isSelected) {
        // Check if click is on text above this image
        const elementsAtPoint = document.elementsFromPoint(event.clientX, event.clientY);
        const textIndex = elementsAtPoint.findIndex(el => 
          el.classList.contains('wbe-canvas-text-container') ||
          el.classList.contains('wbe-text-click-target')
        );
        const ourIndex = elementsAtPoint.findIndex(el => 
          el === this.container || 
          el === this.imageElement ||
          (el.classList.contains('wbe-image-click-target') && this.container.contains(el))
        );
        
        // If text is above us (lower index = higher z-index), don't select
        if (textIndex !== -1 && ourIndex !== -1 && textIndex < ourIndex) {
          return;
        }
        
        // Clear mass selection when selecting individual image
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }

        // Trigger selection callback if provided
        if (this.options.onDragStart) {
          this.options.onDragStart(this);
        }
      }

      event.preventDefault();
      event.stopPropagation();

      // Initialize drag state
      this.dragState.active = true;
      this.dragState.initialized = false;
      this.dragState.startScreenX = event.clientX;
      this.dragState.startScreenY = event.clientY;
      this.dragState.startWorldX = parseFloat(this.container.style.left) || 0;
      this.dragState.startWorldY = parseFloat(this.container.style.top) || 0;

      // Attach move and up listeners
      this.eventHandlers.mouseMove = this._onMouseMove;
      this.eventHandlers.mouseUp = this._onMouseUp;
      document.addEventListener('mousemove', this.eventHandlers.mouseMove);
      document.addEventListener('mouseup', this.eventHandlers.mouseUp);

    } catch (error) {
      console.error('[ImageDragController] Mouse down handler failed:', error);
    }
  }

  /**
   * Handle mouse move event - update position
   * @param {MouseEvent} event
   * @private
   */
  _onMouseMove(event) {
    if (!this.dragState.active) return;

    try {
      const deltaScreenX = event.clientX - this.dragState.startScreenX;
      const deltaScreenY = event.clientY - this.dragState.startScreenY;

      // Initialize drag on first movement
      if (!this.dragState.initialized && (Math.abs(deltaScreenX) > 1 || Math.abs(deltaScreenY) > 1)) {
        this.dragState.initialized = true;

        // Hide control panel on first movement
        if (typeof killImageControlPanel !== 'undefined') {
          killImageControlPanel();
        }
      }

      // Transform coordinates
      const { worldX: deltaWorldX, worldY: deltaWorldY } = this.transformCoordinates(deltaScreenX, deltaScreenY);

      // Calculate new position
      const newLeft = this.dragState.startWorldX + deltaWorldX;
      const newTop = this.dragState.startWorldY + deltaWorldY;

      // Update container position
      this.container.style.left = `${newLeft}px`;
      this.container.style.top = `${newTop}px`;

      // Trigger move callback
      if (this.options.onDragMove) {
        this.options.onDragMove(this, newLeft, newTop);
      }

    } catch (error) {
      console.error('[ImageDragController] Mouse move handler failed:', error);
    }
  }

  /**
   * Handle mouse up event - complete drag
   * @param {MouseEvent} event
   * @private
   */
  async _onMouseUp(event) {
    if (!this.dragState.active) return;

    try {
      // Clean up document event listeners (keep container mousedown listener)
      this.removeDocumentListeners();

      // Reset drag state
      this.dragState.active = false;
      this.dragState.initialized = false;

      // Trigger end callback
      if (this.options.onDragEnd) {
        await this.options.onDragEnd(this);
      }

      // NOTE: onSave is NOT called here because onDragEnd already calls saveImageState
      // Calling onSave here would overwrite the partial flag set in onDragEnd

      // Restore control panel if needed
      if (window.wbeImageControlPanel) {
        // Panel exists, update position
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      } else if (typeof showImageControlPanel !== 'undefined') {
        // Panel was killed, recreate it - this would need to be handled by the integration code
        // as it requires specific parameters that the controller doesn't have access to
      }

    } catch (error) {
      console.error('[ImageDragController] Mouse up handler failed:', error);
    } finally {
      // Ensure cleanup always occurs (only document listeners, keep container mousedown)
      this.removeDocumentListeners();
      this.dragState.active = false;
      this.dragState.initialized = false;
    }
  }
}

/**
 * @typedef {Object} SelectionState
 * @property {boolean} selected - Currently selected
 * @property {boolean} borderVisible - Selection border is visible
 * @property {boolean} clickTargetActive - Click target is active
 * @property {number} lastSelectedTime - Timestamp of last selection (for debugging)
 */

/**
 * @typedef {Object} SelectionOptions
 * @property {Function} [onSelect] - Callback when selection occurs
 * @property {Function} [onDeselect] - Callback when deselection occurs
 * @property {Function} [onToggle] - Callback when selection state toggles
 * @property {Function} [showControlPanel] - Callback to show control panel
 * @property {Function} [hideControlPanel] - Callback to hide control panel
 * @property {Function} [clearMassSelection] - Callback to clear mass selection
 * @property {boolean} [disabled] - Initial disabled state
 */

/**
 * @typedef {Object} SelectionVisuals
 * @property {HTMLElement|null} border - Selection border element
 * @property {HTMLElement|null} clickTarget - Click target overlay
 * @property {HTMLElement|null} resizeHandle - Reference to resize handle (managed by ResizeController)
 */

/**
 * SelectionController - Manages image selection state and visual indicators
 * 
 * This class encapsulates all selection-related functionality for image elements
 * in the whiteboard module, replacing the closure-based selection implementation
 * with a maintainable, testable class structure.
 */
class SelectionController {
  /**
   * @param {HTMLElement} container - The .wbe-canvas-image-container element
   * @param {HTMLElement} imageElement - The .wbe-canvas-image element
   * @param {SelectionOptions} options - Configuration and callbacks
   */
  constructor(container, imageElement, options = {}) {
    // Validate required parameters
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[SelectionController] Invalid container element provided');
    }
    if (!imageElement || !(imageElement instanceof HTMLElement)) {
      throw new Error('[SelectionController] Invalid image element provided');
    }

    this.container = container;
    this.imageElement = imageElement;
    this.options = { ...options };

    /** @type {SelectionState} */
    this.selectionState = {
      selected: false,
      borderVisible: false,
      clickTargetActive: false,
      lastSelectedTime: 0
    };

    /** @type {SelectionVisuals} */
    this.visualElements = {
      border: null,
      clickTarget: null,
      resizeHandle: null
    };

    // Validate options structure
    this._validateOptions();

    // Auto-enable unless explicitly disabled
    if (!this.options.disabled) {
      this.enable();
    }
  }

  /**
   * Validate constructor options
   * @private
   */
  _validateOptions() {
    const validCallbacks = ['onSelect', 'onDeselect', 'onToggle', 'showControlPanel', 'hideControlPanel', 'clearMassSelection'];

    for (const [key, value] of Object.entries(this.options)) {
      if (validCallbacks.includes(key) && value !== undefined && typeof value !== 'function') {
        throw new Error(`[SelectionController] Option '${key}' must be a function, got ${typeof value}`);
      }
    }

    if (this.options.disabled !== undefined && typeof this.options.disabled !== 'boolean') {
      throw new Error('[SelectionController] Option \'disabled\' must be a boolean');
    }
  }

  /**
   * Select the image and show visual indicators
   */
  select() {
    try {
      // TEMPORARY FOR INVESTIGATION
      // FIX: Check DOM state to ensure consistency before early return
      const domSelected = this.container.dataset.selected === "true";

      // Prevent selection if already selected (check both internal and DOM state)
      if (this.selectionState.selected && domSelected) {
        return;
      }

      // FIX: If there's a state mismatch, reset internal state to match DOM
      if (this.selectionState.selected !== domSelected) {
        // Silently fix state mismatch - this can happen due to external DOM manipulation
        this.selectionState.selected = domSelected;
        if (domSelected) {
          // DOM says selected but we're in select() - this shouldn't happen, but handle it
          return;
        }
      }

      // Check if container is locked by another user
      if (this.container.dataset.lockedBy && this.container.dataset.lockedBy !== game?.user?.id) {
        console.warn('[SelectionController] Cannot select image locked by another user');
        return;
      }

      // Check if image is mass-selected (prevent individual selection)
      if (this.container.classList.contains('wbe-mass-selected')) {
        console.warn('[SelectionController] Cannot individually select mass-selected image');
        return;
      }

      // Clear mass selection if callback provided
      if (this.options.clearMassSelection) {
        this.options.clearMassSelection();
      }

      // Other elements should handle their own deselection via global state changes

      // Update selection state
      this.selectionState.selected = true;
      this.selectionState.borderVisible = true;
      this.selectionState.clickTargetActive = true;
      this.selectionState.lastSelectedTime = Date.now();

      // Update container dataset
      this.container.dataset.selected = "true";
      // Selection state updated

      // Create and show visual elements
      this._createSelectionBorder();
      this._createClickTarget();
      this._updateVisuals();

      // FIX: Ensure proper coordination with legacy border system
      if (this.visualElements.border) {
        this.visualElements.border.style.display = 'block';
      }

      // FIX: Re-attach drag controller to click target (for newly created images)
      // This ensures drag/resize/crop work immediately after selection
      if (this.visualElements.clickTarget) {
        const imageData = imageRegistry.get(this.container.id);
        if (imageData && imageData.dragController) {
          // Re-attach listeners to click target (it now has pointer-events: auto)
          imageData.dragController.disable();
          imageData.dragController.enable();
        }
      }

      // FIX: Keep permanent border visible like text elements do
      // Don't hide permanent border - let both borders show simultaneously
      const permanentBorder = this.container.querySelector('.wbe-image-permanent-border');
      if (permanentBorder) {
        // Ensure permanent border is visible and updated
        permanentBorder.style.display = 'block';
        const cropData = getImageCropData(this.imageElement);
        updateImageBorder(
          permanentBorder,
          this.imageElement,
          cropData.maskType,
          cropData.crop,
          cropData.circleOffset,
          cropData.circleRadius,
          cropData.scale
        );
      }

      // Trigger callbacks
      if (this.options.onSelect) {
        this.options.onSelect(this);
      }

      if (this.options.showControlPanel) {
        this.options.showControlPanel(this.imageElement, this.container);
      }

      if (this.options.onToggle) {
        this.options.onToggle(this, true);
      }

    } catch (error) {
      console.error('[SelectionController] Selection failed:', error);
      // Reset state on error
      this.selectionState.selected = false;
      this.selectionState.borderVisible = false;
      this.selectionState.clickTargetActive = false;
    }
  }

  /**
   * Deselect the image and hide visual indicators
   */
  deselect() {
    try {
      // TEMPORARY FOR INVESTIGATION
      // Prevent deselection if not selected
      if (!this.selectionState.selected) {
        console.log('[DEBUG] SelectionController deselect called but not selected:', this.container.id);
      }





      // Update selection state
      this.selectionState.selected = false;
      this.selectionState.borderVisible = false;
      this.selectionState.clickTargetActive = false;

      // Update container dataset
      delete this.container.dataset.selected;
      // Deselection state updated

      // Hide and cleanup visual elements
      this._cleanupVisuals();

      // FIX: Restore permanent border when deselected (legacy system coordination)
      const permanentBorder = this.container.querySelector('.wbe-image-permanent-border');
      if (permanentBorder) {

        permanentBorder.style.display = 'block';
        // Update permanent border with current crop data
        const cropData = getImageCropData(this.imageElement);
        updateImageBorder(
          permanentBorder,
          this.imageElement,
          cropData.maskType,
          cropData.crop,
          cropData.circleOffset,
          cropData.circleRadius,
          cropData.scale
        );
      }

      // Trigger callbacks
      if (this.options.onDeselect) {
        this.options.onDeselect(this);
      }

      if (this.options.hideControlPanel) {
        this.options.hideControlPanel();
      }

      if (this.options.onToggle) {
        this.options.onToggle(this, false);
      }

    } catch (error) {
      console.error('[SelectionController] Deselection failed:', error);
    }
  }

  /**
   * Toggle selection state
   */
  toggle() {
    if (this.selectionState.selected) {
      this.deselect();
    } else {
      this.select();
    }
  }

  /**
   * Check if image is currently selected
   * @returns {boolean}
   */
  isSelected() {
    // SAFEGUARD: Ensure internal state matches DOM state
    const domSelected = this.container.dataset.selected === "true";
    if (this.selectionState.selected !== domSelected) {
      console.warn('[SelectionController] State mismatch detected, fixing...', {
        internalState: this.selectionState.selected,
        domState: domSelected,
        containerId: this.container.id
      });
      // Fix the mismatch by updating internal state to match DOM
      this.selectionState.selected = domSelected;
      if (!domSelected) {
        // If DOM says not selected, ensure visuals are cleaned up
        this._cleanupVisuals();
      }
    }
    return this.selectionState.selected;
  }

  /**
   * Get copy of current selection state for debugging
   * @returns {SelectionState}
   */
  getSelectionState() {
    return { ...this.selectionState };
  }

  /**
   * Update visual elements based on current state
   */
  updateVisuals() {
    try {
      if (this.selectionState.selected && this.selectionState.borderVisible) {
        this._updateBorderSize();
      }
    } catch (error) {
      console.error('[SelectionController] Visual update failed:', error);
    }
  }

  /**
   * Enable selection functionality
   */
  enable() {
    // Implementation will be added in future tasks
    // For now, just mark as enabled
    this.options.disabled = false;
  }

  /**
   * Temporarily disable selection functionality
   */
  disable() {
    // Implementation will be added in future tasks
    this.options.disabled = true;
  }

  /**
   * Permanently destroy the controller and clean up resources
   */
  destroy() {
    try {
      // Clean up all visual elements
      this._cleanupVisuals();

      // Clear references to prevent memory leaks
      this.container = null;
      this.imageElement = null;
      this.options = null;
      this.selectionState = null;
      this.visualElements = null;

    } catch (error) {
      console.error('[SelectionController] Cleanup failed:', error);
    }
  }

  /**
   * Create selection border element
   * @private
   */
  _createSelectionBorder() {
    try {
      // FIX: Use existing selection border instead of creating a new one
      // This prevents multiple border elements from existing simultaneously
      const existingBorder = this.container.querySelector('.wbe-image-selection-border');
      if (existingBorder) {
        this.visualElements.border = existingBorder;
        // FIX: Ensure existing border is visible and properly configured
        existingBorder.style.display = 'block';
        existingBorder.style.zIndex = String(ZIndexConstants.SELECTION_BORDER);
        // Border size will be updated by _updateVisuals() which calls _updateBorderSize()
        return;
      }

      // Only create if no existing border found (fallback)
      const border = document.createElement('div');
      border.className = 'wbe-image-selection-border';
      border.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        border: 1px solid #4a9eff;
        pointer-events: none;
        display: block;
        z-index: ${ZIndexConstants.SELECTION_BORDER};
      `;

      this.container.appendChild(border);
      this.visualElements.border = border;

    } catch (error) {
      console.error('[SelectionController] Failed to create selection border:', error);
    }
  }

  /**
   * Create click target overlay element
   * @private
   */
  _createClickTarget() {
    try {
      // FIX: Use existing click target instead of creating a new one
      const existingClickTarget = this.container.querySelector('.wbe-image-click-target');
      if (existingClickTarget) {
        this.visualElements.clickTarget = existingClickTarget;
        return;
      }

      // Only create if no existing click target found (fallback)
      const clickTarget = document.createElement('div');
      clickTarget.className = 'wbe-image-click-target';
      clickTarget.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        background: transparent;
        pointer-events: auto;
      `;

      this.container.appendChild(clickTarget);
      this.visualElements.clickTarget = clickTarget;
      
      // FIX: Only size click target if image is loaded
      // If image is not loaded yet, updateClickTarget will be called after image loads
      // (see imageElement.addEventListener("load") in createImageElement)
      if (typeof updateClickTarget === 'function' && this.imageElement) {
        // Check if image is actually loaded (not just placeholder)
        const isImageLoaded = this.imageElement.complete && 
                             this.imageElement.naturalWidth > 0 && 
                             this.imageElement.naturalHeight > 0;
        
        // Also check if image has valid dimensions (not just placeholder max-width/height)
        const hasValidDimensions = this.imageElement.offsetWidth > 0 && 
                                   this.imageElement.offsetHeight > 0 &&
                                   (this.imageElement.offsetWidth !== 200 || this.imageElement.offsetHeight !== 200); // Not placeholder size
        
        if (isImageLoaded && hasValidDimensions) {
          const cropData = getImageCropData(this.imageElement);
          updateClickTarget(
            clickTarget,
            this.imageElement,
            cropData.maskType,
            cropData.crop,
            cropData.circleOffset,
            cropData.circleRadius,
            cropData.scale
          );
        }
        // If image not loaded, updateClickTarget will be called after load event
      }

    } catch (error) {
      console.error('[SelectionController] Failed to create click target:', error);
    }
  }

  /**
   * Update border size based on image dimensions and crop settings
   * @private
   */
  _updateBorderSize() {
    try {
      if (!this.visualElements.border || !this.imageElement) {
        return;
      }

      // FIX: Use the existing border update system instead of basic dimensions
      // This ensures proper scaling and crop handling
      const cropData = getImageCropData(this.imageElement);
      updateImageBorder(
        this.visualElements.border,
        this.imageElement,
        cropData.maskType,
        cropData.crop,
        cropData.circleOffset,
        cropData.circleRadius,
        cropData.scale
      );

    } catch (error) {
      console.error('[SelectionController] Failed to update border size:', error);
    }
  }

  /**
   * Update all visual elements
   * @private
   */
  _updateVisuals() {
    try {
      this._updateBorderSize();
      // Additional visual updates will be added in future tasks
    } catch (error) {
      console.error('[SelectionController] Failed to update visuals:', error);
    }
  }

  // Removed _clearOtherElementSelections - violates separation of concerns
  // Other elements should manage their own deselection through proper event coordination

  /**
   * Clean up all visual elements
   * @private
   */
  _cleanupVisuals() {
    try {
      // FIX: Don't remove existing elements, just hide them and clear references
      // The legacy system will manage the actual DOM elements
      if (this.visualElements.border) {
        this.visualElements.border.style.display = 'none';
      }
      this.visualElements.border = null;

      if (this.visualElements.clickTarget) {
        this.visualElements.clickTarget.style.pointerEvents = 'none';
      }
      this.visualElements.clickTarget = null;

      // Note: resizeHandle is managed by ResizeController, so we don't remove it here

    } catch (error) {
      console.error('[SelectionController] Failed to cleanup visuals:', error);
    }
  }
}

/* ======================== Frozen Selection Functions ======================== */

/**
 * Show frozen selection visual state for a frozen image
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function showFrozenSelection(container) {
  try {
    if (!container) {
      console.error('[showFrozenSelection] Invalid container provided');
      return;
    }

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) {
      console.error('[showFrozenSelection] Image element not found');
      return;
    }

    // Check if image is actually frozen
    if (!isImageFrozen(container.id)) {
      console.warn('[showFrozenSelection] Image is not frozen:', container.id);
      return;
    }

    // Find or create selection border
    let selectionBorder = container.querySelector('.wbe-image-selection-border');
    if (!selectionBorder) {
      selectionBorder = document.createElement('div');
      selectionBorder.className = 'wbe-image-selection-border';
      selectionBorder.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        border: 2px solid #666666;
        pointer-events: none;
        display: block;
        z-index: ${ZIndexConstants.SELECTION_BORDER_FROZEN};
      `;
      container.appendChild(selectionBorder);
    }

    // Apply frozen selection styling (dark gray border)
    selectionBorder.classList.add('wbe-frozen-selected');
    selectionBorder.style.borderColor = '#666666'; // Dark gray for frozen state
    selectionBorder.style.borderWidth = '2px';
    selectionBorder.style.borderStyle = 'solid';
    selectionBorder.style.zIndex = String(ZIndexConstants.SELECTION_BORDER_FROZEN); // Ensure it's above permanent border
    selectionBorder.style.display = 'block';
    
    // Mark container as selected so global selection handler can deselect it
    container.dataset.selected = "true";
    
    console.log('[showFrozenSelection] Applied frozen styling to:', container.id, {
      borderWidth: selectionBorder.style.borderWidth,
      classes: selectionBorder.className,
      display: selectionBorder.style.display
    });

    // Get current crop data
    const cropData = getImageCropData(imageElement);

    // Ensure permanent border is visible and updated (like normal selection does)
    const permanentBorder = container.querySelector('.wbe-image-permanent-border');
    if (permanentBorder) {
      permanentBorder.style.display = 'block';
      updateImageBorder(
        permanentBorder,
        imageElement,
        cropData.maskType,
        cropData.crop,
        cropData.circleOffset,
        cropData.circleRadius,
        cropData.scale
      );
    }

    // Update frozen selection border size to match permanent border
    updateImageBorder(
      selectionBorder,
      imageElement,
      cropData.maskType,
      cropData.crop,
      cropData.circleOffset,
      cropData.circleRadius,
      cropData.scale
    );

    // Hide resize handle (blue gizmo) when frozen
    const resizeHandle = container.querySelector('.wbe-image-resize-handle');
    if (resizeHandle) {
      resizeHandle.style.display = 'none';
    }

    // Mark container as having frozen selection
    container.dataset.frozenSelected = "true";

  } catch (error) {
    console.error('[showFrozenSelection] Failed to show frozen selection:', error);
  }
}

/**
 * Hide frozen selection visual state
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function hideFrozenSelection(container) {
  try {
    if (!container) {
      console.error('[hideFrozenSelection] Invalid container provided');
      return;
    }

    const selectionBorder = container.querySelector('.wbe-image-selection-border');
    if (selectionBorder) {
      console.log('[hideFrozenSelection] Hiding frozen selection for:', container.id);
      // Remove frozen selection styling
      selectionBorder.classList.remove('wbe-frozen-selected');
      selectionBorder.style.display = 'none';
      
      // Reset border color to normal blue (in case it gets reused)
      selectionBorder.style.borderColor = '#4a9eff';
      selectionBorder.style.borderWidth = '1px';
    }

    // Restore resize handle if image becomes selected again
    const resizeHandle = container.querySelector('.wbe-image-resize-handle');
    if (resizeHandle && container.dataset.selected === "true") {
      resizeHandle.style.display = 'flex';
    }

    // Remove frozen selection marker
    delete container.dataset.frozenSelected;
    
    // Remove selected dataset so global selection handler doesn't see it as selected
    delete container.dataset.selected;

  } catch (error) {
    console.error('[hideFrozenSelection] Failed to hide frozen selection:', error);
  }
}

/* ======================== End Frozen Selection Functions ======================== */

/* ======================== Frozen Unfreeze Icon Functions ======================== */

/**
 * Show unfreeze icon in top-left corner of frozen image
 * Icon requires 1.5s hold to activate unfreeze
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function showUnfreezeIcon(container) {
  try {
    if (!container) {
      console.error('[showUnfreezeIcon] Invalid container provided');
      return;
    }

    // Remove existing icon if present
    hideUnfreezeIcon(container);

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) {
      console.error('[showUnfreezeIcon] Image element not found');
      return;
    }

    // Check if image is actually frozen
    if (!isImageFrozen(container.id)) {
      console.warn('[showUnfreezeIcon] Image is not frozen:', container.id);
      return;
    }

    // Create unfreeze icon element
    const icon = document.createElement('div');
    icon.className = 'wbe-unfreeze-icon';
    // Base styles - position will be calculated by updateUnfreezeIconPosition
    icon.style.cssText = `
      position: absolute;
      background: rgba(255, 255, 255, 0.9);
      border: none;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: ${ZIndexConstants.UNFREEZE_ICON};
      pointer-events: auto !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: all 0.2s ease;
      opacity: .5;
    `;

    // Create unlock icon
    const unlockIcon = document.createElement('i');
    unlockIcon.className = 'fas fa-unlock';
    unlockIcon.style.cssText = 'color: #666666;';
    icon.appendChild(unlockIcon);

    // Create progress ring (hidden initially)
    const progressRing = document.createElement('div');
    progressRing.className = 'wbe-unfreeze-progress';
    progressRing.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-90deg);
      border: 3px solid transparent;
      border-top-color: #4a9eff;
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;
    icon.appendChild(progressRing);

    // Hold-to-activate state
    let holdTimer = null;
    let holdStartTime = 0;
    const HOLD_DURATION = 1500; // 1.5 seconds
    let isHolding = false;

    // CSS animation for progress ring
    if (!document.getElementById('wbe-unfreeze-styles')) {
      const style = document.createElement('style');
      style.id = 'wbe-unfreeze-styles';
      style.textContent = `
        @keyframes wbe-unfreeze-rotate {
          0% { transform: translate(-50%, -50%) rotate(-90deg); }
          100% { transform: translate(-50%, -50%) rotate(270deg); }
        }
        .wbe-unfreeze-icon.active .wbe-unfreeze-progress {
          animation: wbe-unfreeze-rotate 1.5s linear forwards;
        }
      `;
      document.head.appendChild(style);
    }

    // Mouse down - start hold timer
    const onMouseDown = (e) => {
      if (e.button !== 0) return; // Only left button
      e.preventDefault();
      e.stopPropagation();
      
      isHolding = true;
      holdStartTime = Date.now();
      icon.classList.add('active');
      progressRing.style.opacity = '1';
      
      // Start hold timer
      holdTimer = setTimeout(() => {
        if (isHolding && isImageFrozen(container.id)) {
          // Hold completed - unfreeze
          handleUnfreezeAction(container);
        }
      }, HOLD_DURATION);
    };

    // Mouse up - cancel hold
    const onMouseUp = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      
      isHolding = false;
      icon.classList.remove('active');
      progressRing.style.opacity = '0';
      progressRing.style.animation = 'none';
      
      // Reset animation by reflow
      void progressRing.offsetWidth;
      progressRing.style.animation = '';
    };

    // Mouse leave - cancel hold
    const onMouseLeave = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      
      isHolding = false;
      icon.classList.remove('active');
      progressRing.style.opacity = '0';
      progressRing.style.animation = 'none';
      
      // Reset animation by reflow
      void progressRing.offsetWidth;
      progressRing.style.animation = '';
    };

    // Add event listeners
    icon.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    icon.addEventListener('mouseleave', onMouseLeave);

    // Hover effects with event stopping to prevent image selection
    icon.addEventListener('mouseenter', (e) => {
      e.stopPropagation(); // Prevent event from reaching image click handlers
      icon.style.background = 'rgba(255, 255, 255, 1)';
      icon.style.borderColor = '#4a9eff';
      unlockIcon.style.color = '#4a9eff';
    });
    
    icon.addEventListener('mouseleave', (e) => {
      e.stopPropagation(); // Prevent event from reaching image click handlers
      if (!isHolding) {
        icon.style.background = 'rgba(255, 255, 255, 0.9)';
        icon.style.borderColor = '#666666';
        unlockIcon.style.color = '#666666';
      }
    });
    
    // Prevent click events from bubbling (onMouseDown/onMouseUp already handle stopPropagation)
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    // Store cleanup function
    icon.cleanup = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
      }
      document.removeEventListener('mouseup', onMouseUp);
      icon.remove();
    };

    // Add icon to container first
    container.appendChild(icon);
    
    // Store reference
    container._unfreezeIcon = icon;

    // Update position based on visible cropped area
    updateUnfreezeIconPosition(container);

  } catch (error) {
    console.error('[showUnfreezeIcon] Failed to show unfreeze icon:', error);
  }
}

/**
 * Update unfreeze icon position based on visible cropped area
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function updateUnfreezeIconPosition(container) {
  if (!container) return;
  
  const icon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
  if (!icon) return;

  const imageElement = container.querySelector('.wbe-canvas-image');
  if (!imageElement) return;

  const imageId = container.id;
  const data = getImageData(imageId);
  if (!data) return;

  const { maskType, crop, circleOffset, circleRadius, scale } = data;
  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  let offsetLeft, offsetTop;
  let iconSize = 12; // Fixed size - no scaling
  let iconOffset = 8; // Fixed offset - no scaling

  if (maskType === 'rect') {
    // Rectangular mask - position at top-left of visible area
    offsetLeft = crop.left * scale;
    offsetTop = crop.top * scale;
  } else if (maskType === 'circle') {
    // Circular mask - position at top-left of visible circle
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;
    offsetLeft = (centerX - currentRadius) * scale;
    offsetTop = (centerY - currentRadius) * scale;
  }

  // Position icon at top-left of visible area with offset
  icon.style.left = `${offsetLeft - iconOffset}px`;
  icon.style.top = `${offsetTop - iconOffset}px`;
  icon.style.width = `${iconSize}px`;
  icon.style.height = `${iconSize}px`;

  // Update unlock icon size
  const unlockIcon = icon.querySelector('.fas.fa-unlock');
  if (unlockIcon) {
    unlockIcon.style.fontSize = `${iconSize * 0.67}px`; // ~2/3 of icon size
  }

  // Update progress ring size
  const progressRing = icon.querySelector('.wbe-unfreeze-progress');
  if (progressRing) {
    progressRing.style.width = `${iconSize * 1.25}px`; // Slightly larger than icon
    progressRing.style.height = `${iconSize * 1.25}px`;
  }
}

/**
 * Hide unfreeze icon
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function hideUnfreezeIcon(container) {
  if (!container) return;
  
  const icon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
  if (icon) {
    if (typeof icon.cleanup === 'function') {
      icon.cleanup();
    } else {
      icon.remove();
    }
    container._unfreezeIcon = null;
  }
}

/**
 * Re-initialize all unfreeze icons (fix missing event listeners)
 */
function reinitializeUnfreezeIcons() {
  console.log('[reinitializeUnfreezeIcons] Re-initializing unfreeze icons...');
  const frozenImages = document.querySelectorAll('.wbe-canvas-image-container.wbe-image-frozen');
  let reinitCount = 0;
  
  frozenImages.forEach(container => {
    const imageId = container.id;
    if (isImageFrozen(imageId)) {
      // Remove existing icon and recreate with fresh event listeners
      hideUnfreezeIcon(container);
      showUnfreezeIcon(container);
      reinitCount++;
    }
  });
  
  console.log(`[reinitializeUnfreezeIcons] Re-initialized ${reinitCount} unfreeze icons`);
}

/* ======================== End Frozen Unfreeze Icon Functions ======================== */

/* ======================== Frozen Canvas Pass-Through Functions ======================== */

/**
 * Setup canvas pass-through for frozen images
 * NOTE: Since frozen images have pointer-events: none on container and click target,
 * canvas pan/zoom already works through them. This function mainly tracks state for cleanup.
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function setupFrozenImageCanvasPassThrough(container) {
  if (!container) return;
  
  // Frozen images already have pointer-events: none set (same as deselected images)
  // No special handlers needed - canvas pan/zoom works automatically
  // This function exists for cleanup tracking if needed in the future
}

/**
 * Remove canvas pass-through for frozen images
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function removeFrozenImageCanvasPassThrough(container) {
  if (!container) return;
  
  // No cleanup needed since we don't install special handlers
  // Pointer events will be restored when image is selected after unfreezing
}

/* ======================== End Frozen Canvas Pass-Through Functions ======================== */








/**
 * Handle unfreeze action from frozen control panel
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function handleUnfreezeAction(container) {
  try {
    if (!container) {
      console.error('[handleUnfreezeAction] Invalid container provided');
      return;
    }

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) {
      console.error('[handleUnfreezeAction] Image element not found');
      return;
    }

    console.log('[handleUnfreezeAction] Unfreezing image:', container.id);
    // Hide frozen selection state
    hideFrozenSelection(container);

    // Hide unfreeze icon
    hideUnfreezeIcon(container);

    // Remove frozen state from registry with synchronization
    setImageFrozen(container.id, false, true);

    // Immediately select the image after unfreezing
    setTimeout(() => {
      const imageData = imageRegistry.get(container.id);
      if (imageData && imageData.selectFn) {
        // Select the image with normal selection
        // The selectFn() will handle showing the normal control panel via SelectionController
        imageData.selectFn();
      }
    }, 50);  // Small delay to allow sync to process

    console.log('[handleUnfreezeAction] Successfully unfroze image:', container.id);
  } catch (error) {
    console.error('[handleUnfreezeAction] Failed to unfreeze image:', error);
  }
}



/* ======================== End Frozen Control Panel Functions ======================== */

class ResizeController {
  constructor(container, imageElement, options = {}) {
    this.container = container;
    this.imageElement = imageElement;
    this.onSave = options.onSave || (() => { }); // callback для сохранения
    this.onScaleChange = options.onScaleChange || (() => { }); // callback для обновления UI

    // State
    this.isResizing = false;
    this.resizeStartX = 0;
    this.resizeStartScale = 1;
    
    // Debounce timer for showing panel after resize
    this.showPanelTimeout = null;

    // Handlers (сохраняем ссылки для cleanup)
    this._mouseDownHandler = null;
    this._mouseMoveHandler = null;
    this._mouseUpHandler = null;

    // DOM
    this.handle = null;

    this.init();
  }

  init() {
    this.createHandle();
    this.attachHandlers();
  }

  createHandle() {
    this.handle = document.createElement("div");
    this.handle.className = "wbe-image-resize-handle";
    this.handle.style.cssText = `
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
      z-index: ${ZIndexConstants.RESIZE_HANDLE};
      pointer-events: auto;
      user-select: none;
      transform-origin: center center;
    `;
    this.container.appendChild(this.handle);
  }

  attachHandlers() {
    this._mouseDownHandler = (e) => this._onMouseDown(e);
    this.handle.addEventListener('mousedown', this._mouseDownHandler);
    
  }

  _onMouseDown(e) {
    
    if (e.button !== 0) return;

    // Проверки из оригинального кода
    if (window.wbeImageControlPanel && window.wbeImageControlPanel.contains(e.target)) {
      return;
    }
    
    if (window.wbeFrozenControlPanel && window.wbeFrozenControlPanel.contains(e.target)) {
      return;
    }

    if (this.container.dataset.lockedBy && this.container.dataset.lockedBy !== game.user.id) {
      return;
    }

    if (isImageFrozen(this.container.id)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Hide panel immediately when resize starts
    if (window.wbeImageControlPanel) {
      killImageControlPanel();
    }
    
    // Cancel any pending show panel timeout
    if (this.showPanelTimeout) {
      clearTimeout(this.showPanelTimeout);
      this.showPanelTimeout = null;
    }

    // Захватываем state
    this.isResizing = true;
    isScalingImage = true; // Глобальный флаг для предотвращения deselect
    this.resizeStartX = e.clientX;

    const transform = this.imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    this.resizeStartScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    // Подписываемся на движение
    this._mouseMoveHandler = (e) => this._onMouseMove(e);
    this._mouseUpHandler = () => this._onMouseUp();

    document.addEventListener('mousemove', this._mouseMoveHandler);
    document.addEventListener('mouseup', this._mouseUpHandler);
  }

  _onMouseMove(e) {
    if (!this.isResizing) return;

    // Calculate mouse movement delta
    const deltaX = e.clientX - this.resizeStartX;
    
    // Apply sensitivity to calculate scale change
    // Higher sensitivity = more responsive scaling
    const scaleDelta = deltaX * SCALE_SENSITIVITY;
    const newScale = this.resizeStartScale + scaleDelta;
    
    // Clamp scale to reasonable bounds (0.01 to 10)
    const finalScale = Math.max(0.01, Math.min(10, newScale));

    // Обновляем scale
    this.imageElement.style.transform = `scale(${finalScale})`;

    // Store scale в CSS/Dataset system
    setImageCropData(this.imageElement, { scale: finalScale });

    // Колбэки для обновления UI (это может переместить гизмочку)
    this.onScaleChange(finalScale);
    
    // CRITICAL FIX: Update resizeStartX after scale change to account for gizmo movement
    // When scale changes, the gizmo position updates, so we need to reset the reference point
    // This prevents accumulation of errors from gizmo position changes
    this.resizeStartX = e.clientX;
    this.resizeStartScale = finalScale;
    
    // Cancel previous show panel timeout and schedule new one (debounce)
    if (this.showPanelTimeout) {
      clearTimeout(this.showPanelTimeout);
      this.showPanelTimeout = null;
    }
    
    // Schedule panel to show after resize ends (300ms after last mouse move)
    this.showPanelTimeout = setTimeout(() => {
      this.showPanelTimeout = null;
      // Check if image is still selected and resize is finished
      if (!this.isResizing && this.container.dataset.selected === "true") {
        const imageElement = this.container.querySelector('.wbe-canvas-image');
        if (imageElement) {
          const cropData = getImageCropData(imageElement);
          const currentMaskType = cropData.maskType || 'rect';
          showImageControlPanel(imageElement, this.container, currentMaskType);
        }
      }
    }, 300);
  }

  async _onMouseUp() {
    if (!this.isResizing) return;

    this.isResizing = false;
    isScalingImage = false; // Разрешаем deselect снова

    // Cancel any pending show panel timeout from mousemove
    // We'll show panel after a short delay to ensure resize is complete
    if (this.showPanelTimeout) {
      clearTimeout(this.showPanelTimeout);
      this.showPanelTimeout = null;
    }
    
    // Schedule panel to show after resize ends (300ms after mouse up)
    this.showPanelTimeout = setTimeout(() => {
      this.showPanelTimeout = null;
      // Check if image is still selected
      if (this.container.dataset.selected === "true") {
        const imageElement = this.container.querySelector('.wbe-canvas-image');
        if (imageElement) {
          const cropData = getImageCropData(imageElement);
          const currentMaskType = cropData.maskType || 'rect';
          showImageControlPanel(imageElement, this.container, currentMaskType);
        }
      }
    }, 300);

    // Отписываемся от событий
    document.removeEventListener('mousemove', this._mouseMoveHandler);
    document.removeEventListener('mouseup', this._mouseUpHandler);
    this._mouseMoveHandler = null;
    this._mouseUpHandler = null;

    // Сохраняем состояние
    await this.onSave();
  }

  // Обновление позиции handle (вызывается извне)
  updatePosition() {
    // CRITICAL FIX: Check if element is still in DOM (prevents race condition errors)
    if (!this.imageElement || !this.imageElement.isConnected || !this.handle || !this.handle.isConnected) return;
    
    const cropData = getImageCropData(this.imageElement);
    updateImageResizeHandle(
      this.handle,
      this.imageElement,
      cropData.maskType,
      cropData.crop,
      cropData.circleOffset,
      cropData.circleRadius,
      cropData.scale
    );
  }

  // Показать/скрыть handle
  show() {
    // Only show if not frozen
    if (this.handle && !isImageFrozen(this.container.id)) {
      this.handle.style.display = 'flex';
    }
  }

  hide() {
    if (this.handle) this.handle.style.display = 'none';
  }

  // Cleanup (гарантированное удаление всех handlers)
  destroy() {
    // Удаляем обработчики mousedown
    if (this._mouseDownHandler && this.handle) {
      this.handle.removeEventListener('mousedown', this._mouseDownHandler);
      this._mouseDownHandler = null;
    }

    // Удаляем обработчики mousemove/mouseup (если ресайз был активен)
    if (this._mouseMoveHandler) {
      document.removeEventListener('mousemove', this._mouseMoveHandler);
      this._mouseMoveHandler = null;
    }

    if (this._mouseUpHandler) {
      document.removeEventListener('mouseup', this._mouseUpHandler);
      this._mouseUpHandler = null;
    }

    // Удаляем DOM
    if (this.handle && this.handle.parentNode) {
      this.handle.parentNode.removeChild(this.handle);
    }

    // Destroy dragController if it exists
    if (this.dragController) {
      this.dragController.destroy();
      this.dragController = null;
    }

    this.handle = null;
    this.container = null;
    this.imageElement = null;
  }
}


/* ======================== Mask Control Panel System ======================== */

function killImageControlPanel() {
  const p = window.wbeImageControlPanel;
  if (p && typeof p.cleanup === "function") {
    try { p.cleanup(); } catch { }
  }
      // FIX: Ensure global reference is cleared even if cleanup fails
  window.wbeImageControlPanel = null;
}

async function showImageControlPanel(imageElement, container, currentMaskType, callbacks) {
  if (!imageElement || !container) return;

  killImageControlPanel();

  const panel = document.createElement("div");
  panel.className = "wbe-image-control-panel";
  panel.style.cssText = `
  position: fixed;
  background: white;
  border: 1px solid #d7d7d7;
  border-radius: 14px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
  padding: 6px;
  z-index: ${ZIndexConstants.IMAGE_CONTROL_PANEL};
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  
  aspect-ratio: 4 / 1;
  transform: translateX(-50%) scale(.9) translateY(12px);
  opacity: 0;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);

  `;

  const toolbar = document.createElement("div");
  toolbar.style.cssText = `
    display: flex;
    gap: 12px;
    position: relative;
  `;

  // ========================================
  // HELPER FUNCTIONS (from colorpanel)
  // ========================================

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
    btn.className = "wbe-image-toolbar-btn";
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

  // ========================================
  // SUBPANEL MANAGEMENT (from colorpanel)
  // ========================================

  let activeSubpanel = null;
  let activeButton = null;
  let panelCurrentMaskType = currentMaskType;
  let isCropModeActive = false; // Track crop mode state within panel

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

  // ========================================
  // BUILD BORDER SUBPANEL (color and opacity only)
  // ========================================

  const buildBorderSubpanel = () => {
    // Read actual border style from permanentBorder element
    const permanentBorder = container.querySelector('.wbe-image-permanent-border');
    const currentBorderStyle = getImageBorderStyle(permanentBorder);
    
    const borderColorInfo = {
      hex: currentBorderStyle?.hex || DEFAULT_BORDER_HEX,
      opacity: currentBorderStyle?.opacity ?? DEFAULT_BORDER_OPACITY
    };
    const currentBorderWidth = currentBorderStyle?.width ?? DEFAULT_BORDER_WIDTH;
    const currentBorderRadius = currentBorderStyle?.radius ?? DEFAULT_BORDER_RADIUS;
    
    // Read actual shadow style from container element
    const currentShadowStyle = getImageShadowStyle(container);
    const shadowColorInfo = {
      hex: currentShadowStyle?.hex || DEFAULT_SHADOW_HEX,
      opacity: currentShadowStyle?.opacity ?? DEFAULT_SHADOW_OPACITY
    };

    const sub = document.createElement("div");
    sub.className = "wbe-image-border-subpanel";
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
      gap: 16px;
      pointer-events: auto;
    `;

    // ========================================
    // BORDER SECTION
    // ========================================
    const borderSection = document.createElement("div");
    borderSection.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

    const borderHeader = document.createElement("div");
    borderHeader.textContent = "Border";
    borderHeader.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    borderSection.appendChild(borderHeader);

    const borderRow = document.createElement("div");
    borderRow.style.cssText = "display: flex; align-items: center; gap: 12px;";
    borderSection.appendChild(borderRow);

    const borderSwatch = makeSwatch(borderColorInfo.hex);
    borderRow.appendChild(borderSwatch);

    const borderColorInput = document.createElement("input");
    borderColorInput.type = "color";
    borderColorInput.value = borderColorInfo.hex;
    borderColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    borderSection.appendChild(borderColorInput);

    const { wrapper: borderOpacityRow, slider: borderOpacitySlider, update: updateBorderOpacityLabel } = createSlider(borderColorInfo.opacity, { min: 0, max: 100 });
    borderRow.appendChild(borderOpacityRow);

    const { wrapper: borderWidthRow, slider: borderWidthSlider, update: updateBorderWidthLabel } = createSlider(currentBorderWidth, {
      min: 0,
      max: 12,
      step: 1,
      format: (v) => {
        const numeric = Number(v) || 0;
        return `${Math.round(numeric)}px`;
      }
    });
    borderSection.appendChild(borderWidthRow);

    const { wrapper: borderRadiusRow, slider: borderRadiusSlider, update: updateBorderRadiusLabel } = createSlider(currentBorderRadius, {
      min: 0,
      max: 20,
      step: 1,
      format: (v) => {
        const numeric = Number(v) || 0;
        return `${Math.round(numeric)}px`;
      }
    });
    borderSection.appendChild(borderRadiusRow);

    // Apply border style to permanentBorder
    const applyBorder = async (hex, opacity, width, radius) => {
      if (!permanentBorder) return;
      
      updateImageBorderStyle(permanentBorder, {
        hexColor: hex,
        opacity: opacity,
        width: width,
        radius: radius
      });
      
      // Persist border style to image state
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (imageElement) {
        await persistImageState(container.id, imageElement, container, { skipZIndex: true });
      }
    };

    const syncBorder = async () => {
      const opacity = Number(borderOpacitySlider.value);
      const width = Number(borderWidthSlider.value);
      const radius = Number(borderRadiusSlider.value);
      updateBorderOpacityLabel(opacity);
      updateBorderWidthLabel(width);
      updateBorderRadiusLabel(radius);
      borderSwatch.style.opacity = width > 0 ? "1" : "0.45";
      await applyBorder(borderColorInput.value, opacity, width, radius);
    };

    borderSwatch.addEventListener("click", () => borderColorInput.click());
    borderColorInput.addEventListener("change", async (e) => {
      borderSwatch.style.background = e.target.value;
      await syncBorder();
    });
    borderOpacitySlider.addEventListener("input", () => {
      updateBorderOpacityLabel(Number(borderOpacitySlider.value));
      updateBorderWidthLabel(Number(borderWidthSlider.value));
      updateBorderRadiusLabel(Number(borderRadiusSlider.value));
      borderSwatch.style.opacity = Number(borderWidthSlider.value) > 0 ? "1" : "0.45";
      // Only update visual feedback during dragging, don't persist yet
    });
    borderWidthSlider.addEventListener("input", () => {
      updateBorderOpacityLabel(Number(borderOpacitySlider.value));
      updateBorderWidthLabel(Number(borderWidthSlider.value));
      updateBorderRadiusLabel(Number(borderRadiusSlider.value));
      borderSwatch.style.opacity = Number(borderWidthSlider.value) > 0 ? "1" : "0.45";
      // Only update visual feedback during dragging, don't persist yet
    });
    borderRadiusSlider.addEventListener("input", () => {
      updateBorderOpacityLabel(Number(borderOpacitySlider.value));
      updateBorderWidthLabel(Number(borderWidthSlider.value));
      updateBorderRadiusLabel(Number(borderRadiusSlider.value));
      // Only update visual feedback during dragging, don't persist yet
    });
    borderOpacitySlider.addEventListener("change", syncBorder);
    borderWidthSlider.addEventListener("change", syncBorder);
    borderRadiusSlider.addEventListener("change", syncBorder);

    sub.appendChild(borderSection);

    // ========================================
    // SHADOW SECTION
    // ========================================
    const shadowSection = document.createElement("div");
    shadowSection.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

    const shadowHeader = document.createElement("div");
    shadowHeader.textContent = "Shadow";
    shadowHeader.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    shadowSection.appendChild(shadowHeader);

    const shadowRow = document.createElement("div");
    shadowRow.style.cssText = "display: flex; align-items: center; gap: 12px;";
    shadowSection.appendChild(shadowRow);

    const shadowSwatch = makeSwatch(shadowColorInfo.hex);
    shadowRow.appendChild(shadowSwatch);

    const shadowColorInput = document.createElement("input");
    shadowColorInput.type = "color";
    shadowColorInput.value = shadowColorInfo.hex;
    shadowColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    shadowSection.appendChild(shadowColorInput);

    const { wrapper: shadowOpacityRow, slider: shadowOpacitySlider, update: updateShadowOpacityLabel } = createSlider(shadowColorInfo.opacity, { min: 0, max: 100 });
    shadowRow.appendChild(shadowOpacityRow);

    // Apply shadow style to container
    const applyShadow = async (hex, opacity) => {
      if (!container) return;
      
      updateImageShadowStyle(container, {
        hexColor: hex,
        opacity: opacity
      });
      
      // Persist shadow style to image state
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (imageElement) {
        await persistImageState(container.id, imageElement, container, { skipZIndex: true });
      }
    };

    const syncShadow = async () => {
      const opacity = Number(shadowOpacitySlider.value);
      updateShadowOpacityLabel(opacity);
      await applyShadow(shadowColorInput.value, opacity);
    };

    shadowSwatch.addEventListener("click", () => shadowColorInput.click());
    shadowColorInput.addEventListener("change", async (e) => {
      shadowSwatch.style.background = e.target.value;
      await syncShadow();
    });
    shadowOpacitySlider.addEventListener("input", () => {
      updateShadowOpacityLabel(Number(shadowOpacitySlider.value));
      // Only update visual feedback during dragging, don't persist yet
    });
    shadowOpacitySlider.addEventListener("change", syncShadow);

    sub.appendChild(shadowSection);

    return sub;
  };

  // ========================================
  // BUILD CROP SUBPANEL (contains rect/circle buttons)
  // ========================================

  const buildCropSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "wbe-crop-subpanel";
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
    header.textContent = "Mask Type";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const buttonsRow = document.createElement("div");
    buttonsRow.style.cssText = "display: flex; gap: 8px; justify-content: center;";
    sub.appendChild(buttonsRow);

    // Mini buttons for mask types
    const makeMaskButton = (label, iconClass, maskType) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        flex: 1;
        padding: 10px;
        border-radius: 8px;
        border: 2px solid #d0d0d0;
        background: white;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
        min-height: 60px;
      `;
      btn.title = label;

      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.cssText = "font-size: 18px; color: #333;";
      btn.appendChild(icon);

      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      labelEl.style.cssText = "font-size: 11px; color: #666; font-weight: 500;";
      btn.appendChild(labelEl);

      // Set active state
      const updateActiveState = (isActive) => {
        if (isActive) {
          btn.style.background = "#e0ebff";
          btn.style.borderColor = "#4d8dff";
          icon.style.color = "#1a3f8b";
          labelEl.style.color = "#1a3f8b";
          labelEl.style.fontWeight = "600";
        } else {
          btn.style.background = "white";
          btn.style.borderColor = "#d0d0d0";
          icon.style.color = "#333";
          labelEl.style.color = "#666";
          labelEl.style.fontWeight = "500";
        }
      };

      // Initial state
      updateActiveState(maskType === panelCurrentMaskType);

      // Click handler
      btn.addEventListener("click", () => {
        if (panelCurrentMaskType === maskType) return; // Already active

        panelCurrentMaskType = maskType;

        // Update both buttons in this row
        buttonsRow.querySelectorAll("button").forEach((b, idx) => {
          updateActiveState.call({
            btn: b,
            icon: b.querySelector("i"),
            labelEl: b.querySelector("span")
          }, idx === (maskType === 'rect' ? 0 : 1));
        });

        // Fire callback
        if (callbacks?.onMaskTypeChange) {
          try {
            callbacks.onMaskTypeChange(maskType);
          } catch (error) {
            console.error("[WB-E] onMaskTypeChange callback error:", error);
          }
        }
      });

      btn.addEventListener("mouseenter", () => {
        if (maskType !== panelCurrentMaskType) {
          btn.style.background = "#f5f5f7";
        }
      });
      btn.addEventListener("mouseleave", () => {
        if (maskType !== panelCurrentMaskType) {
          btn.style.background = "white";
        }
      });

      // Store references for external updates
      btn._updateActiveState = updateActiveState;
      btn._maskType = maskType;

      return btn;
    };

    const rectBtn = makeMaskButton("Rectangle", "fas fa-square", "rect");
    const circleBtn = makeMaskButton("Circle", "fas fa-circle", "circle");

    buttonsRow.appendChild(rectBtn);
    buttonsRow.appendChild(circleBtn);

    // Store button references on subpanel for external updates
    sub.rectBtn = rectBtn;
    sub.circleBtn = circleBtn;

    return sub;
  };

  // ========================================
  // OPEN SUBPANEL (from colorpanel pattern)
  // ========================================

  const openSubpanel = (type, button) => {
    if (activeButton === button) {
      // Clicking same button - toggle off
      closeSubpanel();
      return;
    }

    closeSubpanel();

    let subpanel = null;
    if (type === "crop") {
      // Enter crop mode when opening crop subpanel
      if (!isCropModeActive) {
        isCropModeActive = true;
        if (callbacks?.onCropModeToggle) {
          callbacks.onCropModeToggle(true);
        }
      }
      subpanel = buildCropSubpanel();
    } else if (type === "border") {
      subpanel = buildBorderSubpanel();
    }

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

  // ========================================
  // CREATE TOOLBAR BUTTONS
  // ========================================

  const cropBtn = makeToolbarButton("Crop", "fas fa-crop");
  setButtonActive(cropBtn, false);

  cropBtn.addEventListener("click", () => openSubpanel("crop", cropBtn));

  const borderBtn = makeToolbarButton("Border", "fas fa-border-all");
  setButtonActive(borderBtn, false);
  borderBtn.addEventListener("click", () => openSubpanel("border", borderBtn));

  const lockBtn = makeToolbarButton("Lock", "fas fa-lock");
  setButtonActive(lockBtn, false);

  // Track frozen state for this image
  let isFrozen = false;

  lockBtn.addEventListener("click", () => {
    isFrozen = !isFrozen;

    if (isFrozen) {
      // Freeze the image - prevent all interactions
      setButtonActive(lockBtn, true);
      lockBtn.innerHTML = '<i class="fas fa-unlock"></i>';
      lockBtn.title = "Unfreeze image";

      // Hide all other buttons except lock button
      const allButtons = toolbar.querySelectorAll('.wbe-image-toolbar-btn');
      allButtons.forEach(btn => {
        if (btn !== lockBtn) {
          btn.style.display = 'none';
        }
      });

      // Start fade animation for regular panel and border
      const fadeDuration = FREEZE_FADE_DURATION * 1000; // Convert to milliseconds

      // Fade out the regular control panel
      panel.style.transition = `opacity ${FREEZE_FADE_DURATION}s ease-out`;
      panel.style.opacity = "0";

      // After fade animation completes, deselect and then freeze
      setTimeout(async () => {
        // Kill the normal panel
        killImageControlPanel();

        // Deselect the image first - it should stay deselected after freeze
        const imageData = imageRegistry.get(container.id);
        if (imageData && imageData.deselectFn) {
          await imageData.deselectFn(); // Wait for deselection to complete
        }

        // Small delay to ensure deselection state is fully applied
        await new Promise(resolve => setTimeout(resolve, 50));

        // Now set image as frozen (after deselection is complete)
        // This will show the unfreeze icon immediately since image is now deselected
        setImageFrozen(container.id, true, true);
      }, fadeDuration);

    } else {
      // This branch should not be reached in the new system
      // Unfreezing is now handled by the unfreeze icon
      console.warn('[lockBtn] Unfreeze action should be handled by unfreeze icon');
      
      // Fallback: use the new unfreeze handler
      handleUnfreezeAction(container);
    }
  });

  toolbar.appendChild(cropBtn);
  toolbar.appendChild(borderBtn);
  toolbar.appendChild(lockBtn);
  panel.appendChild(toolbar);
  document.body.appendChild(panel);

  // ========================================
  // PANEL POSITIONING & LIFECYCLE
  // ========================================

  const updatePanelPosition = () => {
    // Use selection border position (blue border when selected)
    // This represents the visible cropped area when image is selected
    // Panel is only shown when image is selected, so selection border is the correct reference
    const border = container.querySelector('.wbe-image-selection-border');
    
    let rect;
    if (border) {
      // Use selection border rect - this represents the visible cropped area
      rect = border.getBoundingClientRect();
    } else {
      // Fallback to imageElement if selection border not found
      rect = imageElement.getBoundingClientRect();
    }
    
    // Get panel dimensions (use fallback values if panel is not yet rendered)
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || 300; // Fallback panel width
    const panelHeight = panelRect.height || 120; // Fallback panel height
    
    const minMargin = 10; // Minimum margin from screen edges
    const topThreshold = 150; // Threshold for switching panel to bottom position
    
    // HORIZONTAL POSITIONING
    // Center panel relative to visible area (border)
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
    panel.style.transform = "translateX(-50%) scale(1) translateY(32px)";
    panel.style.opacity = "1";
  });

  // ========================================
  // CLICK OUTSIDE HANDLER (from colorpanel)
  // ========================================

  const onOutside = (ev) => {
    if (panel.contains(ev.target)) return;

    const clickedInsideImage = container?.contains(ev.target);

    const isCropUI = ev.target.closest(
      '.wbe-crop-handle-top, .wbe-crop-handle-right, ' +
      '.wbe-crop-handle-bottom, .wbe-crop-handle-left, ' +
      '.wbe-crop-handle-circle-resize, ' +
      '.wbe-image-selection-border'
    );

    // Если клик по crop UI - полностью игнорируем!
    if (isCropUI) {
      return;
    }

    if (activeSubpanel) {
      // Clicking outside subpanel but inside image - just close subpanel, keep panel
      if (clickedInsideImage) {
        closeSubpanel();

        window.wbeImageControlPanelUpdate?.();
        return;
      }
    }

    if (clickedInsideImage) {
      window.wbeImageControlPanelUpdate?.();
      return;
    }

    // Clicking completely outside - cleanup everything
    cleanup();
  };

  const onKey = (ev) => {
    // CRITICAL: Don't intercept Ctrl+C - let global handler process it
    // Use e.code instead of e.key for multi-language keyboard support
    if ((ev.ctrlKey || ev.metaKey) && (ev.code === "KeyC" || ev.key.toLowerCase() === "c")) {
      return; // Let event bubble to global handler
    }
    
    if (ev.key === "Escape") {
      if (activeSubpanel) {
        // 1st ESC: Закрыть субпанель
        closeSubpanel();

      } else if (isCropModeActive) {
        // 2nd ESC: Выйти из crop mode
        isCropModeActive = false;
        if (callbacks?.onCropModeToggle) {
          callbacks.onCropModeToggle(false);
        }

      } else {
        // 3rd ESC: Закрыть панель
        cleanup();
      }
    }
  };

  panel.addEventListener("mousedown", (ev) => ev.stopPropagation());
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);

  function cleanup() {
    try { document.removeEventListener("mousedown", onOutside, true); } catch { }
    document.removeEventListener("keydown", onKey);

    closeSubpanel();
    // Exit crop mode if still active
    if (isCropModeActive) {
      isCropModeActive = false;
      if (callbacks?.onCropModeToggle) {
        callbacks.onCropModeToggle(false);
      }
    }

    panel.remove();
    window.wbeImageControlPanel = null;
    window.wbeImageControlPanelUpdate = null;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  panel.cleanup = cleanup;
  panel.closeSubpanel = closeSubpanel;
  panel.updatePanelState = (newMaskType) => {
    panelCurrentMaskType = newMaskType;
    // Update subpanel buttons if subpanel is open
    if (activeSubpanel && activeSubpanel.rectBtn && activeSubpanel.circleBtn) {
      activeSubpanel.rectBtn._updateActiveState(newMaskType === 'rect');
      activeSubpanel.circleBtn._updateActiveState(newMaskType === 'circle');
    }
  };

  window.wbeImageControlPanel = panel;
  window.wbeImageControlPanelUpdate = updatePanelPosition;
  window.wbeShowImageControlPanel = showImageControlPanel; // Export for main.mjs socket handler
}




// Install global pan hooks for ImagePanel (similar to ColorPanel)
let __wbeMaskPanHooksInstalled = false;

// DEPRECATED: Pan/zoom handling moved to main.mjs (setupIndependentPanZoomHooks)
// This function can be removed if user requests it
function installGlobalMaskPanHooks() {
  if (__wbeMaskPanHooksInstalled) return;
  __wbeMaskPanHooksInstalled = true;

  let isCanvasPanningGlobal = false;
  let savedImageIdBeforePan = null;
  let rightMouseDownX = null;
  let rightMouseDownY = null;
  const RIGHT_CLICK_DRAG_THRESHOLD = 5; // pixels
  
  // Track click targets that need pointer-events restoration
  const clickTargetsToRestore = new Map();

  // Helper: Temporarily disable pointer-events on click targets to allow canvas pan/zoom
  const disableClickTargetsForCanvasEvents = () => {
    if (!selectedImageId) return;
    const container = document.getElementById(selectedImageId);
    if (!container) return;
    
    // CRITICAL: Don't disable if in crop mode - crop handles need the click target
    const isCropping = container.dataset.lockedBy === game.user.id && 
                       (container.dataset.cropping === 'true' || 
                        container.querySelector('.wbe-crop-handle-top'));
    if (isCropping) return;
    
    const clickTarget = container.querySelector('.wbe-image-click-target');
    if (clickTarget && clickTarget.style.pointerEvents !== 'none') {
      // Save original state
      clickTargetsToRestore.set(clickTarget, clickTarget.style.pointerEvents);
      // Temporarily disable to allow events to pass through to canvas
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }
  };

  // Helper: Restore pointer-events on click targets
  const restoreClickTargets = () => {
    clickTargetsToRestore.forEach((originalValue, clickTarget) => {
      if (clickTarget.parentNode) { // Element still exists
        clickTarget.style.setProperty("pointer-events", originalValue || "auto", "important");
      }
    });
    clickTargetsToRestore.clear();
  };

  // Track right mouse button drag (not just click)
  // This allows right-click menu in the future while still enabling pan on drag
  let clickRestoreTimeout = null;
  
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;

    // Save initial position to detect drag vs click
    rightMouseDownX = e.clientX;
    rightMouseDownY = e.clientY;
    isCanvasPanningGlobal = false; // Will be set to true on first movement
    
    // CRITICAL: Disable pointer-events IMMEDIATELY on right-click mousedown
    // This allows Foundry's pan handler to see events from the canvas, not our clickTarget
    // If it's just a click (no drag), we'll restore it quickly
    disableClickTargetsForCanvasEvents();
    
    // Clear any pending restore timeout
    if (clickRestoreTimeout) {
      clearTimeout(clickRestoreTimeout);
      clickRestoreTimeout = null;
    }
    
    // Set a timeout to restore pointer-events if no drag is detected
    // This allows right-click menu to work if user just clicks without dragging
    clickRestoreTimeout = setTimeout(() => {
      if (!isCanvasPanningGlobal) {
        // No drag detected - restore pointer-events for potential right-click menu
        restoreClickTargets();
      }
      clickRestoreTimeout = null;
    }, 100); // 100ms should be enough to detect a click vs drag
  }, true);

  // Detect right-button drag (mousedown + mousemove)
  document.addEventListener("mousemove", (e) => {
    if (rightMouseDownX === null || rightMouseDownY === null) return;
    if (!e.buttons || (e.buttons & 2) === 0) {
      // Right button not pressed anymore - restore click targets
      if (clickRestoreTimeout) {
        clearTimeout(clickRestoreTimeout);
        clickRestoreTimeout = null;
      }
      restoreClickTargets();
      rightMouseDownX = null;
      rightMouseDownY = null;
      return;
    }

    // Check if mouse moved enough to be considered a drag
    const deltaX = Math.abs(e.clientX - rightMouseDownX);
    const deltaY = Math.abs(e.clientY - rightMouseDownY);
    
    if (deltaX > RIGHT_CLICK_DRAG_THRESHOLD || deltaY > RIGHT_CLICK_DRAG_THRESHOLD) {
      // This is a drag, not a click - enable pan
      if (!isCanvasPanningGlobal) {
        isCanvasPanningGlobal = true;
        
        // Cancel the restore timeout - we're dragging, so keep pointer-events disabled
        if (clickRestoreTimeout) {
          clearTimeout(clickRestoreTimeout);
          clickRestoreTimeout = null;
        }
        
        // Kill panels when drag starts
        killImageControlPanel();
        // Ensure click target is disabled (it should already be from mousedown, but double-check)
        disableClickTargetsForCanvasEvents();
      }
    }
  }, true);

  // On pan end, reopen for the currently selected image (if any)
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    
    const wasPanning = isCanvasPanningGlobal;
    isCanvasPanningGlobal = false;
    
    // Clear any pending restore timeout
    if (clickRestoreTimeout) {
      clearTimeout(clickRestoreTimeout);
      clickRestoreTimeout = null;
    }
    
    // Restore click targets immediately
    restoreClickTargets();
    
    rightMouseDownX = null;
    rightMouseDownY = null;

    // Only restore panel if we were actually panning (not just a click)
    if (wasPanning && selectedImageId) {
      // Recreate appropriate panel after canvas settles (like text panels do)
      // Check if the selected image is frozen to show the right panel
      if (isImageFrozen(selectedImageId)) {
        // Show frozen panel for frozen images
        safeReshowFrozenPanel(selectedImageId, 100);
      } else if (!window.wbeImageControlPanel) {
        // Show normal panel for normal images
        safeReshowImagePanel(selectedImageId, 100);
      }
    }
  }, true);

  // Zoom wheel should always work, even over selected images
  // Temporarily disable click target to allow wheel events to reach canvas
  let wheelShowPanelTimeout = null;
  
  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    
    // Temporarily disable click target to allow wheel events to pass through to canvas
    disableClickTargetsForCanvasEvents();
    
    // CRITICAL: Restore after Foundry has processed the event (use double RAF for better timing)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreClickTargets();
      });
    });
    
    // Manage panels with debounce to prevent flickering
    if (selectedImageId) {
      // Hide panel immediately on first wheel event (only if panel exists)
      if (window.wbeImageControlPanel) {
        killImageControlPanel();
      }
      
      // Cancel previous show panel timeout
      if (wheelShowPanelTimeout) {
        clearTimeout(wheelShowPanelTimeout);
        wheelShowPanelTimeout = null;
      }
      
      // Schedule panel to show after zoom ends (300ms after last wheel event)
      wheelShowPanelTimeout = setTimeout(() => {
        wheelShowPanelTimeout = null;
        // Check if image is still selected before showing panel
        if (selectedImageId) {
          const container = document.getElementById(selectedImageId);
          if (container && container.dataset.selected === "true") {
            // Check if the selected image is frozen to show the right panel
            if (isImageFrozen(selectedImageId)) {
              safeReshowFrozenPanel(selectedImageId, 0);
            } else {
              safeReshowImagePanel(selectedImageId, 0);
            }
          }
        }
      }, 300); // Show panel 300ms after last wheel event
    }
  }, { capture: true, passive: true });
}

function safeReshowImagePanel(targetId, delayMs = 0) {
  const open = async () => {
    const container = document.getElementById(targetId);
    if (!container) return;

    const imageElement = container.querySelector(".wbe-canvas-image");
    if (!imageElement) return;

    // Get current mask type from the image
    const cropData = getImageCropData(imageElement);
    const currentMaskType = cropData.maskType || 'rect';

    // Reassert selection target in case other handlers nulled it
    selectedImageId = targetId;

    showImageControlPanel(imageElement, container, currentMaskType);
  };

  if (delayMs <= 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        open();
      });
    });
  } else {
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          open();
        });
      });
    }, delayMs);
  }
}

function safeReshowFrozenPanel(targetId, delayMs = 0) {
  const open = async () => {
    const container = document.getElementById(targetId);
    if (!container) return;

    const imageElement = container.querySelector(".wbe-canvas-image");
    if (!imageElement) return;

    // NOTE: Frozen panel is disabled - frozen images use unfreeze icon instead
    // showFrozenSelection(container);
    // showFrozenControlPanel(container);
    
    // Just ensure unfreeze icon is visible (should already be there)
    if (isImageFrozen(targetId)) {
      showUnfreezeIcon(container);
    }
  };

  if (delayMs <= 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        open();
      });
    });
  } else {
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          open();
        });
      });
    }, delayMs);
  }
}

// Install global pan hooks
// DISABLED: Pan/zoom handling moved to main.mjs (setupIndependentPanZoomHooks)
// This function can be removed if user requests it
// installGlobalMaskPanHooks();

/* ======================== End Mask Control Panel System ======================== */


function ensureRemovalObserver() {
  const layer = getOrCreateLayer();
  if (!layer) return;
  if (removalObserver) return;

  removalObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = /** @type {HTMLElement} */ (node);
        const elementId = element.id;

        if (!elementId) continue;

        if (imageRegistry.has(elementId)) {
          clearImageCaches(elementId);
        }
      }
    }
  });

  removalObserver.observe(layer, { childList: true });
}

Hooks.on("canvasReady", ensureRemovalObserver);
Hooks.on("canvasTearDown", () => {
  if (removalObserver) {
    removalObserver.disconnect();
    removalObserver = null;
  }
});

if (globalThis.canvas?.ready) ensureRemovalObserver();

/* ----------------------- Global Event Listeners ------------------ */
// Single global keydown listener for all images
document.addEventListener("keydown", async (e) => {
  if (!selectedImageId) return;
  const container = document.getElementById(selectedImageId);
  if (!container) return;

  // CRITICAL FIX: Don't intercept events if a text is selected (let text handler process it)
  if (window.TextTools?.selectedTextId) return;

  // Z-index controls - raise/lower z-index
  // Skip if mass selection is active (let whiteboard-select handle it)
  if (globalThis.selectedObjects?.size > 1) return;
  
  if (e.key === '[' || e.key === 'PageDown') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Z-index operations are queued at ZIndexManager level
    const oldZIndex = ZIndexManager.get(selectedImageId);
    const result = await ZIndexManager.moveDown(selectedImageId);
    
    if (result.success && result.changes.length > 0) {
      const change = result.changes[0];
      
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (!imageElement) {
        console.error(`[Z-Index] IMAGE | PageDown: Image element not found for ${selectedImageId}`);
        return;
      }
      
      // Sync all DOM z-indexes (ensures consistency across all objects)
      await ZIndexManager.syncAllDOMZIndexes();
      const newZIndex = ZIndexManager.get(selectedImageId);
      
      // Emit rank update to GM (player sends request, GM broadcasts confirmation)
      const rank = ZIndexManager.getRank(selectedImageId);
      game.socket.emit('module.whiteboard-experience', {
        type: 'rankUpdate',
        objectType: 'image',
        id: selectedImageId,
        rank: rank,
        userId: game.user.id
      });
      
      console.log(`[Z-Index] IMAGE | ID: ${selectedImageId} | z-index: ${oldZIndex} → ${newZIndex} | rank: ${change.rank}`);
      // Persist selected image using debounced batching
      await persistImageState(selectedImageId, imageElement, container);
    } else if (result.atBoundary) {
      // At boundary - provide feedback
      console.log(`[Z-Index] IMAGE | ID: ${selectedImageId} | Cannot move down - ${result.reason}`);
      return;
    }
  }
  
  if (e.key === ']' || e.key === 'PageUp') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Z-index operations are queued at ZIndexManager level
    const oldZIndex = ZIndexManager.get(selectedImageId);
    const result = await ZIndexManager.moveUp(selectedImageId);
    
    if (result.success && result.changes.length > 0) {
      const change = result.changes[0];
      
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (!imageElement) {
        console.error(`[Z-Index] IMAGE | PageUp: Image element not found for ${selectedImageId}`);
        return;
      }
      
      // Sync all DOM z-indexes (ensures consistency across all objects)
      await ZIndexManager.syncAllDOMZIndexes();
      const newZIndex = ZIndexManager.get(selectedImageId);
      
      // Emit rank update to GM (player sends request, GM broadcasts confirmation)
      const rank = ZIndexManager.getRank(selectedImageId);
      game.socket.emit('module.whiteboard-experience', {
        type: 'rankUpdate',
        objectType: 'image',
        id: selectedImageId,
        rank: rank,
        userId: game.user.id
      });
      
      console.log(`[Z-Index] IMAGE | ID: ${selectedImageId} | z-index: ${oldZIndex} → ${newZIndex} | rank: ${change.rank}`);
      // Persist selected image using debounced batching
      await persistImageState(selectedImageId, imageElement, container);
    } else if (result.atBoundary) {
      // At boundary - provide feedback
      console.log(`[Z-Index] IMAGE | ID: ${selectedImageId} | Cannot move up - ${result.reason}`);
      return;
    }
  }

  // Delete / Backspace
  if (e.key === "Delete" || e.key === "Backspace") {
    // CRITICAL FIX: Don't handle if mass selection is active
    if (window.MassSelection && window.MassSelection.selectedCount > 0) {
      return; // Let mass selection handler handle it
    }
    
    e.preventDefault();
    e.stopPropagation();

    // FIX: Kill image control panel before deletion
    killImageControlPanel();

    // Clear runtime caches FIRST to prevent resurrection
    clearImageCaches(selectedImageId);
    // call the image's delete via registry
    const imageData = imageRegistry.get(selectedImageId);
    if (imageData && imageData.deselectFn) {
      imageData.deselectFn(); // ensure exit crop first
    }

    // Clean up z-index
    ZIndexManager.remove(selectedImageId);

    container.remove();
    (async () => {
      const images = await getAllImages();
      delete images[selectedImageId];
      await setAllImages(images);
    })();
  }

  // Ctrl+C - программно вызываем copy
  // Use e.code for multi-language keyboard support (KeyC works for all layouts)
  if ((e.ctrlKey || e.metaKey) && (e.code === "KeyC" || e.key.toLowerCase() === "c")) {
    e.preventDefault();
    document.execCommand("copy");
  }
});

// Single global copy listener for all images
document.addEventListener("copy", (e) => {
  if (!selectedImageId) return;
  const container = document.getElementById(selectedImageId);
  const imageElement = container?.querySelector(".wbe-canvas-image");
  if (!imageElement) return;

  e.preventDefault();
  e.stopPropagation();

  // CRITICAL: Read fresh data from DOM instead of stale closure variables
  const { crop, maskType, circleOffset, circleRadius, scale } = getImageCropData(imageElement);

  // Calculate visible display dimensions (after scale and crop)
  // This is the size the user sees, which we'll use for placeholder sizing
  let displayWidth = 200; // Default fallback
  let displayHeight = 200; // Default fallback
  
  if (imageElement.complete && imageElement.naturalWidth > 0 && imageElement.naturalHeight > 0) {
    const dims = calculateCroppedDimensions(imageElement, maskType, crop, circleOffset, circleRadius, scale);
    displayWidth = dims.width;
    displayHeight = dims.height;
  }

  copiedImageData = {
    src: imageElement.src,
    scale,
    crop: { ...crop },
    maskType,
    circleOffset: { ...circleOffset },
    circleRadius,
    isFrozen: isImageFrozen(selectedImageId),
    displayWidth, // Size of visible area (after scale and crop)
    displayHeight // Size of visible area (after scale and crop)
  };

  e.clipboardData?.setData("text/plain", `[wbe-IMAGE-COPY:${selectedImageId}]`);
});

// cleanup methods for socket updates
function clearImageCaches(id) {
  // Cleanup controllers if they exist in registry
  const imageData = imageRegistry.get(id);
  if (imageData) {
    if (imageData.dragController) {
      imageData.dragController.destroy();
    }
    if (imageData.resizeController) {
      imageData.resizeController.destroy();
    }
    if (imageData.selectionController) {
      // TEMPORARY FOR INVESTIGATION
      imageData.selectionController.destroy();
    }
  }

  // Clear from registry
  imageRegistry.delete(id);
  // Clear from global data
  delete globalImageData[id];
  delete imageLocalVars[id];
}

/**
 * Get ALL crop/mask data from an image element (CSS/Dataset = source of truth)
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element
 * @returns {Object} Complete crop data
 */
function getImageCropData(imageElement) {
  if (!imageElement) {
    return {
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      maskType: 'rect',
      circleOffset: { x: 0, y: 0 },
      circleRadius: null,
      scale: 1
    };
  }

  return {
    crop: {
      top: parseFloat(imageElement.style.getPropertyValue('--crop-top')) || 0,
      right: parseFloat(imageElement.style.getPropertyValue('--crop-right')) || 0,
      bottom: parseFloat(imageElement.style.getPropertyValue('--crop-bottom')) || 0,
      left: parseFloat(imageElement.style.getPropertyValue('--crop-left')) || 0
    },
    maskType: imageElement.dataset.maskType || 'rect',
    circleOffset: {
      x: parseFloat(imageElement.dataset.circleOffsetX) || 0,
      y: parseFloat(imageElement.dataset.circleOffsetY) || 0
    },
    circleRadius: (imageElement.dataset.circleRadius !== undefined && imageElement.dataset.circleRadius !== 'null')
      ? parseFloat(imageElement.dataset.circleRadius)
      : null,
    scale: parseFloat(imageElement.style.transform.match(/scale\(([\d.]+)\)/)?.[1] || 1)
  };
}

function getUnscaledSize(imageElement) {
  // Get scale from transform
  const scaleMatch = (imageElement.style.transform || "").match(/scale\(([\d.]+)\)/);
  const s = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
  
  // Use naturalWidth/naturalHeight for base dimensions (actual image file dimensions)
  // This is the source of truth for image size, independent of CSS styling
  const naturalWidth = imageElement.naturalWidth || 0;
  const naturalHeight = imageElement.naturalHeight || 0;
  
  // If natural dimensions are available (image loaded), use them
  if (naturalWidth > 0 && naturalHeight > 0) {
    return { width: naturalWidth, height: naturalHeight, scale: s };
  }
  
  // Fallback: if image not loaded yet, use getBoundingClientRect
  // This accounts for placeholder sizing (max-width/max-height)
  const rect = imageElement.getBoundingClientRect();
  // rect.width/height включают transform; делим на scale и получаем "локальные" размеры
  return { width: rect.width / s, height: rect.height / s, scale: s };
}

/**
 * Set crop/mask data on an image element (updates CSS/Dataset)
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element
 * @param {Object} data - Crop data to set
 */
function setImageCropData(imageElement, data) {
  if (!imageElement) return;

  if (data.crop) {
    imageElement.style.setProperty('--crop-top', `${data.crop.top}px`);
    imageElement.style.setProperty('--crop-right', `${data.crop.right}px`);
    imageElement.style.setProperty('--crop-bottom', `${data.crop.bottom}px`);
    imageElement.style.setProperty('--crop-left', `${data.crop.left}px`);
  }

  if (data.maskType !== undefined) {
    imageElement.dataset.maskType = data.maskType;
  }

  if (data.circleOffset) {
    imageElement.dataset.circleOffsetX = data.circleOffset.x;
    imageElement.dataset.circleOffsetY = data.circleOffset.y;
  }

  if (data.circleRadius !== undefined) {
    imageElement.dataset.circleRadius = data.circleRadius;
  }

  if (data.scale !== undefined) {
    imageElement.style.transform = `scale(${data.scale})`;
  }
}

/**
 * Update click target overlay to match visible (cropped) area
 * This prevents clicking/dragging invisible cropped parts
 * @param {HTMLElement} clickTarget - The click target overlay element
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element  
 * @param {string} maskType - 'rect' or 'circle'
 * @param {Object} crop - Crop values {top, right, bottom, left}
 * @param {Object} circleOffset - Circle offset {x, y}
 * @param {number} circleRadius - Circle radius
 * @param {number} scale - Image scale
 */
function updateClickTarget(clickTarget, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  if (!clickTarget || !imageElement) return;

  // Get unscaled dimensions first
  const unscaledSize = getUnscaledSize(imageElement);
  const baseWidth = unscaledSize.width;
  const baseHeight = unscaledSize.height;
  
  // If dimensions are invalid (0 or placeholder), skip update
  if (baseWidth === 0 || baseHeight === 0) {
    return; // Skip update until image loads
  }
  
  // Also skip if dimensions are placeholder size (200px max-width/height from loading state)
  if (baseWidth === 200 && baseHeight === 200 && !imageElement.complete) {
    return; // Skip update until image loads (will be called again after load event)
  }

  // Use unified calculation function
  const dims = calculateCroppedDimensions(imageElement, maskType, crop, circleOffset, circleRadius, scale);
  
  clickTarget.style.width = `${dims.width}px`;
  clickTarget.style.height = `${dims.height}px`;
  clickTarget.style.left = `${dims.left}px`;
  clickTarget.style.top = `${dims.top}px`;
  clickTarget.style.borderRadius = maskType === 'circle' ? "50%" : "0";
}

/* ----------------------- Image Crop Data Helpers (Single Source of Truth) ------------------ */
// NEW ARCHITECTURE: All crop/mask data lives in CSS/Dataset ONLY
// These helpers provide a unified interface to read/write that data






/* ----------------------- Image Lock Visual Functions ------------------ */
function applyImageLockVisual(container, lockerId, lockerName) {
  // CRITICAL: Deselect image if this user had it selected
  // This prevents stale selection UI when lock is removed
  const wasSelected = container.dataset.selected === "true";
  if (wasSelected) {
    const imageData = imageRegistry.get(container.id);
    if (imageData && imageData.deselectFn) {
      imageData.deselectFn();
    }
  }

  // Блокируем все взаимодействия
  container.dataset.lockedBy = lockerId;
  container.style.pointerEvents = "none";

  const imageElement = container.querySelector(".wbe-canvas-image");
  if (!imageElement) return;

  // NEW ARCHITECTURE: Get current crop/scale data to size overlay correctly
  const cropData = getImageCropData(imageElement);
  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  // Calculate overlay dimensions based on mask type (same logic as borders)
  let overlayWidth, overlayHeight, overlayLeft, overlayTop, borderRadius;

  if (cropData.maskType === 'rect') {
    const croppedWidth = width - cropData.crop.left - cropData.crop.right;
    const croppedHeight = height - cropData.crop.top - cropData.crop.bottom;
    overlayWidth = croppedWidth * cropData.scale;
    overlayHeight = croppedHeight * cropData.scale;
    overlayLeft = cropData.crop.left * cropData.scale;
    overlayTop = cropData.crop.top * cropData.scale;
    borderRadius = "0";
  } else if (cropData.maskType === 'circle') {
    const currentRadius = cropData.circleRadius !== null ? cropData.circleRadius : Math.min(width, height) / 2;
    const diameter = currentRadius * 2;
    overlayWidth = diameter * cropData.scale;
    overlayHeight = diameter * cropData.scale;
    const centerX = width / 2 + cropData.circleOffset.x;
    const centerY = height / 2 + cropData.circleOffset.y;
    overlayLeft = (centerX - currentRadius) * cropData.scale;
    overlayTop = (centerY - currentRadius) * cropData.scale;
    borderRadius = "50%";
  }


  // Создаём overlay с фиолетовой рамкой и opacity
  let lockOverlay = container.querySelector(".wbe-image-lock-overlay");
  if (!lockOverlay) {
    lockOverlay = document.createElement("div");
    lockOverlay.className = "wbe-image-lock-overlay";
    container.appendChild(lockOverlay);
  }

  // Update overlay styles with calculated dimensions
  lockOverlay.style.cssText = `
      position: absolute;
      left: ${overlayLeft}px;
      top: ${overlayTop}px;
      width: ${overlayWidth}px;
      height: ${overlayHeight}px;
      background: rgba(128, 0, 128, 0.1);
      border: 1px solid rgba(128, 0, 255, 0.8);
      border-radius: ${borderRadius};
      pointer-events: none;
      z-index: 1010;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

  // Add lock icon if not exists
  let lockIcon = lockOverlay.querySelector(".wbe-lock-icon");
  if (!lockIcon) {
    lockIcon = document.createElement("div");
    lockIcon.className = "wbe-lock-icon";
    lockIcon.innerHTML = `
        <i class="fas fa-crop-alt" style="font-size: 32px; color: rgba(128, 0, 255, 0.9); text-shadow: 0 0 8px rgba(0,0,0,0.8);"></i>
        <div style="
          margin-top: 8px;
          font-size: 14px;
          font-weight: bold;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 0 6px rgba(0,0,0,0.9);
          text-align: center;
        ">${lockerName} is cropping</div>
      `;
    lockIcon.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
      `;
    lockOverlay.appendChild(lockIcon);
  } else {
    // Update locker name if already exists
    const nameDiv = lockIcon.querySelector("div");
    if (nameDiv) nameDiv.textContent = `${lockerName} is cropping`;
  }

  // Применяем opacity к самому изображению
  imageElement.style.opacity = "0.7";
}

function removeImageLockVisual(container) {

  // Убираем блокировку
  delete container.dataset.lockedBy;

  // Удаляем overlay
  const lockOverlay = container.querySelector(".wbe-image-lock-overlay");
  if (lockOverlay) {
    lockOverlay.remove();
  }

  // Возвращаем opacity
  const imageElement = container.querySelector(".wbe-canvas-image");
  if (imageElement) {
    imageElement.style.opacity = "1";
  }

  // Восстанавливаем UI в зависимости от состояния выделения
  const wasSelected = container.dataset.selected === "true";
  const permanentBorder = container.querySelector(".wbe-image-permanent-border");
  const selectionBorder = container.querySelector(".wbe-image-selection-border");
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");

  if (wasSelected) {
    // Было выделено - восстанавливаем полный UI выделения
    // Don't set pointer-events on container - let click target handle interactions
    // container.style.setProperty("pointer-events", "auto", "important");
    // container.style.setProperty("cursor", "move", "important");

    // FIX: Let SelectionController manage permanent border
    if (selectionBorder) {
      selectionBorder.style.display = "block";
      selectionBorder.style.borderColor = "#4a9eff"; // Стандартный цвет выделения
    }
    if (resizeHandle && !isImageFrozen(container.id)) {
      resizeHandle.style.display = "flex";
    }
  } else {
    // Не было выделено - возвращаем в базовое состояние
    container.style.removeProperty("pointer-events");
    container.style.removeProperty("cursor");

    // FIX: Let SelectionController manage permanent border
    if (selectionBorder) selectionBorder.style.display = "none";
    if (resizeHandle) resizeHandle.style.display = "none";

    // NEW ARCHITECTURE: Update permanent border with current crop data
    if (permanentBorder && imageElement) {
      const cropData = getImageCropData(imageElement);
      updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

      // Update click target to match visible area
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

      // Set move cursor on click target when restoring selected state
      if (clickTarget) {
        // clickTarget.style.cursor = "move"; // Removed move cursor
      }
    }
  }
}

function installGlobalImageSelectionHandler() {
  if (globalImageSelectionHandlerInstalled) return;


  document.addEventListener("mousedown", async (e) => {
    const handlerStartTime = performance.now();
    const handlerId = `IMAGE-${handlerStartTime.toFixed(3)}`;
    
    // EARLY RETURN: Skip if no images exist
    if (imageRegistry.size === 0) {
      wbeLog(handlerId, 'IMAGE HANDLER START: SKIPPED (no images in registry)', {
        target: e.target?.className || 'none',
        clientX: e.clientX,
        clientY: e.clientY,
        imageRegistrySize: imageRegistry.size
      });
      return;
    }
    
    wbeLog(handlerId, 'IMAGE HANDLER START', {
      target: e.target?.className || 'none',
      clientX: e.clientX,
      clientY: e.clientY,
      imageRegistrySize: imageRegistry.size
    });

    if (e.button !== 0) return; // Only left click

    // FIX: Prevent image deselection when clicking ImageControlPanel or FrozenControlPanel
    if (window.wbeImageControlPanel && window.wbeImageControlPanel.contains(e.target)) {
      return; // Don't process image selection when clicking ImageControlPanel
    }
    
    if (window.wbeFrozenControlPanel && window.wbeFrozenControlPanel.contains(e.target)) {
      return; // Don't process image selection when clicking FrozenControlPanel
    }
    
    // FIX: Prevent image selection when clicking on unfreeze icon
    const unfreezeIcon = e.target.closest('.wbe-unfreeze-icon');
    if (unfreezeIcon) {
      return; // Don't process image selection when clicking unfreeze icon
    }

    // FIX: Prevent dual selection - check if clicking on other element types first
    const textContainer = e.target.closest(".wbe-canvas-text-container");
    const colorPanel = e.target.closest(".wbe-color-picker-panel");

    // FIX: Text elements have pointer-events: none, so we need to enable them before checking
    // Same logic as text handler - enable pointer-events on all texts for accurate hit detection
    // ALWAYS check elementsFromPoint to see what's actually on top (not just for canvas clicks)
    let clickedOnText = !!textContainer;
    
    // Always check elementsFromPoint to ensure accurate hit detection (even if textContainer was found)
    {
      // Temporarily enable pointer-events on ALL text click-targets for hit detection (same as text handler)
      const textPointerEventsMap = new Map();
      const textContainers = document.querySelectorAll('.wbe-canvas-text-container');
      
      for (const container of textContainers) {
        // Skip locked or mass-selected texts
        if ((container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) ||
            container.classList.contains("wbe-mass-selected")) {
          continue;
        }
        
        const clickTarget = container.querySelector('.wbe-text-click-target');
        if (clickTarget) {
          const originalPointerEvents = clickTarget.style.pointerEvents;
          textPointerEventsMap.set(container.id, originalPointerEvents);
          clickTarget.style.setProperty("pointer-events", "auto", "important");
        }
      }
      
      // Force a reflow to ensure pointer-events are applied before elementsFromPoint
      void document.body.offsetHeight;
      
      // Now check what elements are at the click point (in z-order from top to bottom)
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      
      // LOG: Log all elements at point for debugging
      const elementsInfo = elementsAtPoint.map((el, idx) => ({
        index: idx,
        tag: el.tagName,
        id: el.id || 'no-id',
        className: el.className || 'no-class',
        pointerEvents: window.getComputedStyle(el).pointerEvents,
        zIndex: window.getComputedStyle(el).zIndex
      }));
      
      // Find indices of text and image elements in the stack
      const textIndex = elementsAtPoint.findIndex(el =>
        el.classList.contains('wbe-canvas-text-container') ||
        el.classList.contains('wbe-canvas-text') ||
        el.classList.contains('wbe-text-click-target')
      );
      const imageIndex = elementsAtPoint.findIndex(el =>
        el.classList.contains('wbe-image-click-target') ||
        el.classList.contains('wbe-canvas-image-container')
      );
      
      // If text appears before image in stack (text is on top), user clicked on text
      clickedOnText = textIndex !== -1 && (imageIndex === -1 || textIndex < imageIndex);
      
      // Restore pointer-events on texts
      textPointerEventsMap.forEach((originalPointerEvents, textId) => {
        const container = document.getElementById(textId);
        if (container) {
          const clickTarget = container.querySelector('.wbe-text-click-target');
          if (clickTarget) {
            if (originalPointerEvents) {
              clickTarget.style.setProperty("pointer-events", originalPointerEvents, "important");
            } else {
              clickTarget.style.removeProperty("pointer-events");
            }
          }
        }
      });
      
      wbeLog(handlerId, 'IMAGE HANDLER: clickedOnText check', {
        initial: !!textContainer,
        elementsCount: elementsAtPoint.length,
        elementsInfo: elementsInfo.slice(0, 10), // Log first 10 elements
        textIndex,
        imageIndex,
        final: clickedOnText
      });
    }

    // If clicking on text, or color panels, don't process image selection
    if (clickedOnText || colorPanel) {
      wbeLog(handlerId, 'IMAGE HANDLER: clicked on text or color panel, skipping image selection (RETURNING)', {
        clickedOnText,
        colorPanel: !!colorPanel
      });
      // Don't wait for async deselection - text handler will manage deselection
      killImageControlPanel();
      
      // FIX: Skip async deselection when clicking on text
      // Text handler will handle deselection via deselectAllElements() synchronously
      // Calling async deselectFn() here creates race condition where it completes AFTER text selection,
      // potentially removing text border/gizmo or recreating image panel
      
      return; // Let text handler deal with text selection
    }

    let clickedImageId = null;
    let clickedImageData = null;

    // Debug: Check if we have any selected images before processing
    // Track currently selected images for deselection logic
    const currentlySelectedImages = Array.from(imageRegistry.entries())
      .filter(([id, data]) => data.container.dataset.selected === "true")
      .map(([id]) => id);

    // FIX: Enable pointer-events on ALL images first, then use elementsFromPoint to find topmost
    // This ensures z-order is respected when images overlap
    const imagePointerEventsMap = new Map();
    
    // First pass: Enable pointer-events on all eligible images
    for (const [id, imageData] of imageRegistry) {
      const container = imageData.container;
      
      // Skip frozen, locked, or mass-selected images
      if (isImageFrozen(id) ||
          (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) ||
          container.classList.contains("wbe-mass-selected")) {
        continue;
      }
      
      // Store original pointer-events state
      const originalContainer = container.style.pointerEvents;
      const clickTarget = container.querySelector(".wbe-image-click-target");
      const originalClickTarget = clickTarget?.style.pointerEvents;
      imagePointerEventsMap.set(id, { container: originalContainer, clickTarget: originalClickTarget });
      
      // Temporarily enable pointer-events for hit detection
      container.style.setProperty("pointer-events", "auto", "important");
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "auto", "important");
      }
    }
    
    // Second pass: Use elementsFromPoint to find topmost image (respects z-order)
    const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
    let topmostImageId = null;
    let topmostImageIndex = -1;
    let topmostElement = null;
    
    
    // Find the topmost image element in the stack (lowest index = highest z-index)
    for (let i = 0; i < elementsAtPoint.length; i++) {
      const el = elementsAtPoint[i];
      
      // Check if this element belongs to an image
      const imageContainer = el.closest('.wbe-canvas-image-container');
      if (imageContainer) {
        const id = imageContainer.id;
        const imageData = imageRegistry.get(id);
        
        
        if (imageData && 
            !isImageFrozen(id) &&
            !(imageContainer.dataset.lockedBy && imageContainer.dataset.lockedBy !== game.user.id) &&
            !imageContainer.classList.contains("wbe-mass-selected")) {
          
          // Found a valid image - this is the topmost one (first in stack = highest z-index)
          topmostImageId = id;
          topmostImageIndex = i;
          topmostElement = el;
          break; // Stop at first valid image (topmost)
        }
      }
    }
    
    
    // Third pass: If we found a topmost image, check if click is on its interactive elements
    if (topmostImageId) {
      const imageData = imageRegistry.get(topmostImageId);
      const container = imageData.container;
      const clickTarget = container.querySelector(".wbe-image-click-target");
      
      const cropHandles = container.querySelectorAll(
        '.wbe-crop-handle-top, .wbe-crop-handle-right, ' +
        '.wbe-crop-handle-bottom, .wbe-crop-handle-left, ' +
        '.wbe-crop-handle-circle-resize'
      );
      
      const resizeHandle = container.querySelector(".wbe-image-resize-handle");
      
      // Check if topmost element is part of this image's interactive area
      const isCropUI = Array.from(cropHandles).some(h =>
        topmostElement === h || h.contains(topmostElement)
      );
      
      // Check if click is on clickTarget, resizeHandle, or cropUI (always allow these)
      const isOnInteractiveElement = topmostElement === clickTarget ||
        (clickTarget && (clickTarget === topmostElement || clickTarget.contains(topmostElement))) ||
        topmostElement === resizeHandle ||
        isCropUI;
      
      // If click is on container or its children, check if it's in the "dead zone"
      let isInDeadZone = false;
      if (!isOnInteractiveElement && (topmostElement === container || container.contains(topmostElement))) {
        // Calculate local coordinates relative to container
        const containerRect = container.getBoundingClientRect();
        const localX = e.clientX - containerRect.left;
        const localY = e.clientY - containerRect.top;
        
        // Get crop dimensions to check dead zone
        const imageElement = container.querySelector('.wbe-canvas-image');
        if (imageElement) {
          const cropData = getImageCropData(imageElement);
          const dims = calculateCroppedDimensions(imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
          
          // Dead zone is area before dims.left/top (where borders and clickTarget are positioned)
          isInDeadZone = localX < dims.left || localY < dims.top;
          
          console.log(`[CLICK ZONE CHECK] localX=${localX.toFixed(2)}, localY=${localY.toFixed(2)}, dims.left=${dims.left.toFixed(2)}, dims.top=${dims.top.toFixed(2)}, isInDeadZone=${isInDeadZone}`);
        }
      }
      
      // Only consider it a click on the image if:
      // 1. It's on an interactive element (clickTarget, resizeHandle, cropUI), OR
      // 2. It's on container/children AND NOT in the dead zone
      const clickedOnThis = isOnInteractiveElement || 
        (!isInDeadZone && (topmostElement === container || container.contains(topmostElement)));
      
      if (clickedOnThis) {
        clickedImageId = topmostImageId;
        clickedImageData = imageData;
        
        
        // Set proper pointer-events for selected image
        const inCropModeForMe = container.dataset.lockedBy === game.user.id;
        if (!inCropModeForMe) {
          container.style.setProperty("pointer-events", "none", "important");
          if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "auto", "important");
          }
        } else {
          container.style.setProperty("pointer-events", "auto", "important");
          if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "auto", "important");
          }
        }
      } else {
      }
    }
    
    // Restore original pointer-events on all images that were temporarily enabled
    imagePointerEventsMap.forEach((original, id) => {
      const imageData = imageRegistry.get(id);
      if (imageData && id !== clickedImageId) {
        const container = imageData.container;
        const clickTarget = container.querySelector(".wbe-image-click-target");
        
        // Only restore if not the clicked image (already set above)
        const inCropModeForMe = container.dataset.lockedBy === game.user.id;
        if (!inCropModeForMe) {
          if (original.container) {
            container.style.setProperty("pointer-events", original.container, "important");
          } else {
            container.style.setProperty("pointer-events", "none", "important");
          }
          
          if (clickTarget) {
            if (original.clickTarget) {
              clickTarget.style.setProperty("pointer-events", original.clickTarget, "important");
            } else {
              clickTarget.style.setProperty("pointer-events", "none", "important");
            }
          }
        }
      }
    });

    // Handle selection/deselection
    if (clickedImageId && clickedImageData) {

      // Clicked on an image
      const isSelected = clickedImageData.container.dataset.selected === "true";

      if (!isSelected) {
        // Selecting image
        wbeLog(handlerId, 'IMAGE HANDLER: Selecting image', { imageId: clickedImageId.slice(-6) });

        // CRITICAL: Prevent event propagation to avoid dual selection
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Stop other handlers on same element
        
        wbeLog(handlerId, 'IMAGE HANDLER: STOPPED event propagation', {
          preventDefault: true,
          stopPropagation: true,
          stopImmediatePropagation: true
        });

        // CLEAR MASS SELECTION when selecting individual image
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }

        // Deselect all others first
        for (const [otherId, otherData] of imageRegistry) {
          if (otherId !== clickedImageId && otherData.container.dataset.selected === "true") {
            await otherData.deselectFn(); // Await async deselect
          }
        }

        // Select this one
        clickedImageData.selectFn();
        
      } else {
        // Already selected - no action needed
      }
    } else {
      // Clicked elsewhere - deselect images

      // Clicked elsewhere - deselect all selected images (unless scaling)
      // The only exception is the image control panel, which is already handled above
      if (!isScalingImage) {
        // FIX: Check if text is selected before deselecting images
        // Prevents async deselection from overwriting text selection state
        const textSelected = document.querySelector('.wbe-canvas-text-container[data-selected="true"]');
        
        if (!textSelected) {
          // No text selected - safe to deselect images
          for (const [id, imageData] of imageRegistry) {
            if (imageData.container.dataset.selected === "true") {
              await imageData.deselectFn(); // Await async deselect
            }
          }
        } else {
          // Text is selected - just kill panel, don't interfere with text selection
          killImageControlPanel();
          for (const [id, imageData] of imageRegistry) {
            if (imageData.container.dataset.selected === "true") {
              // Update DOM state synchronously
              imageData.container.dataset.selected = "false";
              delete imageData.container.dataset.selected;
            }
          }
        }
        // REMOVED: Redundant SelectionController check that caused state mismatch loop
        // The deselectFn() already handles SelectionController deselection properly
      }
    }
  }, true); // Capture phase

  globalImageSelectionHandlerInstalled = true;
}

/* ----------------------- Canvas Text/Image Functions ------------------ */

/**
 * Create image element with named parameters (refactored to avoid parameter order bugs)
 * @param {Object} params - Image parameters
 * @param {string} params.id - Unique identifier for the image
 * @param {string} params.src - Image source URL
 * @param {number} params.left - X position
 * @param {number} params.top - Y position
 * @param {number} [params.scale=1] - Image scale
 * @param {Object} [params.crop] - Crop data
 * @param {string} [params.maskType='rect'] - Mask type ('rect' or 'circle')
 * @param {Object} [params.circleOffset] - Circle mask offset
 * @param {number} [params.circleRadius=null] - Circle mask radius
 * @param {number} [params.existingZIndex=null] - Existing z-index (for migration)
 * @param {boolean} [params.isFrozen=false] - Whether image is frozen
 * @param {number} [params.displayWidth=null] - Display width for F5 reload
 * @param {number} [params.displayHeight=null] - Display height for F5 reload
 * @param {string} [params.borderHex] - Border color hex
 * @param {number} [params.borderOpacity] - Border opacity (0-100)
 * @param {number} [params.borderWidth] - Border width in pixels
 * @param {number} [params.borderRadius] - Border radius in pixels
 * @param {string} [params.shadowHex] - Shadow color hex
 * @param {number} [params.shadowOpacity] - Shadow opacity (0-100)
 */
function createImageElement({
  id,
  src,
  left,
  top,
  scale = 1,
  crop = { top: 0, right: 0, bottom: 0, left: 0 },
  maskType = 'rect',
  circleOffset = { x: 0, y: 0 },
  circleRadius: circleRadiusParam = null,
  existingZIndex = null,
  isFrozen = false,
  displayWidth = null,
  displayHeight = null,
  borderHex = null,
  borderOpacity = null,
  borderWidth = null,
  borderRadius = null,
  shadowHex = null,
  shadowOpacity = null,
  rank = null
}) {
  const layer = document.getElementById('whiteboard-experience-layer') ||
                document.querySelector('.wbe-layer') || 
                document.getElementById('board')?.parentElement?.querySelector('#whiteboard-experience-layer') ||
                document.querySelector('[class*="wbe-layer"]');
  if (!layer) return;

  // Читаем maskType из глобальных переменных
  let currentMaskType = (maskType !== undefined && maskType !== null) ? maskType : (getImageLocalVars(id).maskType ?? 'rect');

  // Вспомогательная функция для обновления глобальных переменных
  function updateGlobalVars() {
    updateImageLocalVars(id, {
      maskType: currentMaskType,
      circleOffset: { x: circleOffsetX, y: circleOffsetY },
      circleRadius: circleRadius,
      crop: { ...crop },
      scale: parseFloat(imageElement.style.transform.match(/scale\(([\d.]+)\)/)?.[1] || 1),
      isSelected: selectionController.isSelected(),
      isCropping: isCropping
    });
  }

  // Контейнер для позиционирования (БЕЗ translate)
  const container = document.createElement("div");
  container.id = id;
  container.className = "wbe-canvas-image-container";
  
  // Register in ZIndexManager if not already registered (migration handles existing objects)
  // CRITICAL FIX: If object already exists (from syncWithExisting), don't overwrite its rank
  // syncWithExisting already registered all objects with correct ranks from DB
  const desiredRank = typeof rank === "string" ? rank : null;
  if (!ZIndexManager.has(id)) {
    // Object doesn't exist - assign new rank
    ZIndexManager.assignImage(id, desiredRank);
  }
  // NOTE: Don't overwrite rank if object already exists - syncWithExisting already set it correctly
  const zIndex = ZIndexManager.get(id);

  container.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      z-index: ${zIndex};
    `;
  
  // Initialize shadow style from parameters or defaults
  const shadowParams = {};
  if (shadowHex != null) shadowParams.hexColor = shadowHex;
  if (shadowOpacity != null) shadowParams.opacity = shadowOpacity;
  updateImageShadowStyle(container, shadowParams);

  // Внутренний элемент для контента + масштабирование
  const imageElement = document.createElement("img");
  imageElement.className = "wbe-canvas-image";

  // Calculate placeholder size based on image type:
  // 1. Copy-paste: Use displayWidth/displayHeight from copiedImageData (already accounts for scale and crop)
  // 2. New image (scale = 1): Use maxDisplaySize (350px) if will be auto-scaled, else natural size
  // 3. F5 reload (scale != 1): Use saved scale * natural size (with crop)
  // CRITICAL: Use nullish coalescing (??) instead of || to allow 0 values
  let placeholderWidth = (displayWidth != null && displayWidth !== false) ? displayWidth : 200;
  let placeholderHeight = (displayHeight != null && displayHeight !== false) ? displayHeight : 200;
  
  console.log('[PLACEHOLDER INIT] Raw params', {
    id,
    displayWidth,
    displayHeight,
    displayWidthType: typeof displayWidth,
    displayHeightType: typeof displayHeight,
    placeholderWidth,
    placeholderHeight
  });
  
  // Preload image to get natural dimensions for placeholder sizing
  // Always preload to get naturalWidth/naturalHeight, even for copy-paste/F5
  // This ensures correct aspect ratio and dimensions
  const preloadImg = new Image();
  let finalScale = scale; // Will be updated by preload
  
  preloadImg.onload = () => {
    const naturalWidth = preloadImg.naturalWidth;
    const naturalHeight = preloadImg.naturalHeight;
    
    // Determine final scale and display dimensions
    const maxDisplaySize = 350;
    
    // For new images (scale = 1), check if auto-scaling will be applied
    if (scale === 1 && (naturalWidth > maxDisplaySize || naturalHeight > maxDisplaySize)) {
      const maxDimension = Math.max(naturalWidth, naturalHeight);
      finalScale = maxDisplaySize / maxDimension;
    } else {
      finalScale = scale;
    }
    
    // Calculate display dimensions based on mask type and crop
    let calculatedDisplayWidth, calculatedDisplayHeight;
    if (currentMaskType === 'rect') {
      const croppedWidth = naturalWidth - crop.left - crop.right;
      const croppedHeight = naturalHeight - crop.top - crop.bottom;
      calculatedDisplayWidth = croppedWidth * finalScale;
      calculatedDisplayHeight = croppedHeight * finalScale;
    } else {
      // Circle mask
      const currentRadius = circleRadiusParam !== null ? circleRadiusParam : Math.min(naturalWidth, naturalHeight) / 2;
      const diameter = currentRadius * 2;
      calculatedDisplayWidth = diameter * finalScale;
      calculatedDisplayHeight = diameter * finalScale;
    }
    
    console.log('[PRELOAD] Preload callback', {
      id,
      naturalWidth,
      naturalHeight,
      scale,
      finalScale,
      displayWidth,
      displayHeight,
      calculatedDisplayWidth,
      calculatedDisplayHeight,
      imageElementComplete: imageElement.complete,
      imageElementNaturalWidth: imageElement.naturalWidth
    });
    
    // For copy-paste/F5: verify calculated size matches saved displayWidth/displayHeight
    // If they match (within tolerance), use natural dimensions directly
    // If they don't match, use calculated size (may have changed)
    if (displayWidth && displayHeight) {
      const tolerance = 1; // Allow 1px difference for rounding
      const widthMatch = Math.abs(calculatedDisplayWidth - displayWidth) <= tolerance;
      const heightMatch = Math.abs(calculatedDisplayHeight - displayHeight) <= tolerance;
      
      console.log('[PRELOAD] Size comparison', {
        id,
        widthMatch,
        heightMatch,
        calculatedDisplayWidth,
        displayWidth,
        diff: Math.abs(calculatedDisplayWidth - displayWidth)
      });
      
      if (widthMatch && heightMatch) {
        // Saved size matches calculated size - use natural dimensions
        placeholderWidth = calculatedDisplayWidth;
        placeholderHeight = calculatedDisplayHeight;
      } else {
        // Size mismatch - use calculated size (image may have changed)
        placeholderWidth = calculatedDisplayWidth;
        placeholderHeight = calculatedDisplayHeight;
      }
    } else {
      // New image: use calculated size
      placeholderWidth = calculatedDisplayWidth;
      placeholderHeight = calculatedDisplayHeight;
    }
    
    // Update placeholder size if image hasn't loaded yet
    // CRITICAL: For F5, imageElement may already be loaded from cache, so this block won't execute!
    // We need to update placeholder size ALWAYS, not just when imageElement is not complete
    const shouldUpdatePlaceholder = !imageElement.complete || imageElement.naturalWidth === 0;
    console.log('[PRELOAD] Should update placeholder?', {
      id,
      shouldUpdatePlaceholder,
      imageElementComplete: imageElement.complete,
      imageElementNaturalWidth: imageElement.naturalWidth,
      placeholderWidth,
      placeholderHeight
    });
    
    if (shouldUpdatePlaceholder) {
      placeholderWidth = Math.max(placeholderWidth, 50); // Minimum 50px
      placeholderHeight = Math.max(placeholderHeight, 50); // Minimum 50px
      
      // Set natural dimensions and apply finalScale transform
      // This ensures placeholder matches final image size exactly
      imageElement.style.width = `${naturalWidth}px`;
      imageElement.style.height = `${naturalHeight}px`;
      imageElement.style.transform = `scale(${finalScale})`;
      imageElement.style.maxWidth = `${naturalWidth}px`;
      imageElement.style.maxHeight = `${naturalHeight}px`;
      
      console.log('[PRELOAD] Updated placeholder', {
        id,
        width: `${naturalWidth}px`,
        height: `${naturalHeight}px`,
        transform: `scale(${finalScale})`
      });
    } else {
      console.log('[PRELOAD] Skipped placeholder update (imageElement already complete)', {
        id,
        currentWidth: imageElement.style.width,
        currentHeight: imageElement.style.height,
        currentTransform: imageElement.style.transform
      });
    }
  };
  preloadImg.onerror = () => {
    // If preload fails, use default size or saved displayWidth/displayHeight
    if (displayWidth && displayHeight) {
      placeholderWidth = displayWidth;
      placeholderHeight = displayHeight;
    } else {
      placeholderWidth = 200;
      placeholderHeight = 200;
    }
  };
  preloadImg.src = src;

  // Progressive loading: Show placeholder IMMEDIATELY
  // Size will be updated by preload callback when image dimensions are known
  // For now, use displayWidth/displayHeight if available, otherwise use default placeholder size
  // Calculate base width/height for imageElement (before scale transform)
  let baseWidth, baseHeight;
  if (displayWidth && displayHeight) {
    // Copy-paste/F5/Clipboard paste: displayWidth/displayHeight is the FINAL visible size (after scale and crop)
    // For NEW paste from clipboard: scale is ALREADY APPLIED in displayWidth calculation
    // So displayWidth = naturalWidth * finalScale, we need baseWidth = naturalWidth for correct placeholder
    // CRITICAL: When pasting new image from clipboard, scale is pre-calculated and displayWidth is final size
    // We need to REVERSE the calculation to get base size before scale transform
    baseWidth = Math.max(displayWidth / scale, 50);
    baseHeight = Math.max(displayHeight / scale, 50);
    
    console.log('[PLACEHOLDER INIT] Using displayWidth/Height', {
      id,
      displayWidth,
      displayHeight,
      scale,
      baseWidth,
      baseHeight,
      calculatedVisibleWidth: baseWidth * scale,
      calculatedVisibleHeight: baseHeight * scale
    });
  } else {
    // New image: use default placeholder size (will be updated by preload)
    baseWidth = placeholderWidth / scale;
    baseHeight = placeholderHeight / scale;
    
    console.log('[PLACEHOLDER INIT] Using default placeholder', {
      id,
      placeholderWidth,
      placeholderHeight,
      scale,
      baseWidth,
      baseHeight
    });
  }
  
  imageElement.style.cssText = `
      transform: scale(${scale});
      transform-origin: top left;
      width: ${baseWidth}px;
      height: ${baseHeight}px;
      max-width: ${baseWidth}px;
      max-height: ${baseHeight}px;
      display: block;
      border: none !important;
      pointer-events: none;
      background: linear-gradient(45deg, #f0f0f0 25%, transparent 25%), 
                  linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), 
                  linear-gradient(45deg, transparent 75%, #f0f0f0 75%), 
                  linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
      opacity: 0.8;
      transition: opacity 0.3s ease;
    `;

  // Add loading indicator
  const loadingIndicator = document.createElement("div");
  loadingIndicator.className = "wbe-image-loading";
  loadingIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 24px;
      height: 24px;
      border: 2px solid #4a9eff;
      border-top: 2px solid transparent;
      border-radius: 50%;
      animation: wbe-spin 1s linear infinite;
      z-index: 10;
    `;

  // Add CSS animation for spinner
  if (!document.getElementById("wbe-loading-styles")) {
    const style = document.createElement("style");
    style.id = "wbe-loading-styles";
    style.textContent = `
        @keyframes wbe-spin {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `;
    document.head.appendChild(style);
  }

  container.appendChild(loadingIndicator);

  // Track loading start time for minimum display duration
  const loadingStartTime = Date.now();
  const minDisplayDuration = 500; // 0.5 seconds

  // Set up progressive loading
  imageElement.addEventListener("load", () => {
    const elapsedTime = Date.now() - loadingStartTime;
    const remainingTime = Math.max(0, minDisplayDuration - elapsedTime);

    // Ensure placeholder is visible for at least 0.5 seconds
    setTimeout(() => {
      // Image loaded successfully
      imageElement.style.opacity = "1";
      imageElement.style.background = "none";
      loadingIndicator.remove();
      
      // Set natural dimensions (placeholder already has correct size from preload)
      const naturalWidth = imageElement.naturalWidth || 0;
      const naturalHeight = imageElement.naturalHeight || 0;
      
      // Ensure dimensions are set to natural size (preload may have already set them)
      imageElement.style.width = `${naturalWidth}px`;
      imageElement.style.height = `${naturalHeight}px`;
      imageElement.style.maxWidth = `${naturalWidth}px`;
      imageElement.style.maxHeight = `${naturalHeight}px`;

      // Auto-scale large images to a reasonable size (only for new images with scale = 1)
      // This prevents huge images from being inserted at full size
      const maxDisplaySize = 350; // Maximum size for the larger dimension
      
      if (scale === 1 && (naturalWidth > maxDisplaySize || naturalHeight > maxDisplaySize)) {
        // Calculate scale to fit within maxDisplaySize while preserving aspect ratio
        const maxDimension = Math.max(naturalWidth, naturalHeight);
        const autoScale = maxDisplaySize / maxDimension;
        
        // Apply the auto-calculated scale (preload already set transform, but update it)
        imageElement.style.transform = `scale(${autoScale})`;
        setImageCropData(imageElement, { scale: autoScale });
        
        // Update the scale variable for this image
        updateImageLocalVars(id, {
          ...getImageLocalVars(id),
          scale: autoScale
        });
        
        // Update global data
        const currentData = getImageData(id);
        if (currentData) {
          currentData.scale = autoScale;
        }
        
        // Save the updated scale to database
        // Use setTimeout to ensure this happens after initial save in handleImagePasteFromClipboard
        // and after all dimensions are updated
        setTimeout(async () => {
          // Use the saveImageState function if available (defined in createImageElement closure)
          if (typeof saveImageState === 'function') {
            await saveImageState(true, { skipZIndex: true });
          } else {
            // Fallback: direct save if function not available
            const images = await getAllImages();
            if (images[id]) {
              images[id].scale = autoScale;
              await setAllImages(images);
            }
          }
        }, 200);
      } else {
        // For F5/copy-paste: ensure transform matches the passed scale
        // (preload should have already set it correctly)
        imageElement.style.transform = `scale(${scale})`;
        
        // CRITICAL: Save image state after load to capture displayWidth/displayHeight
        // This ensures F5 reload will have correct placeholder dimensions
        setTimeout(async () => {
          if (typeof saveImageState === 'function') {
            await saveImageState(true, { skipZIndex: true });
          }
        }, 200);
      }

      // CRITICAL FIX: Check if element is still in DOM before updating UI (prevents race condition errors)
      if (!imageElement.isConnected || !container.isConnected) return;
      
      // Update UI elements that depend on image dimensions
      updateClipPath();
      
      // Update all dimensions after image loads
      updateAllImageDimensions(container);
      
      updateHandlePosition();
    }, remainingTime);
  });

  imageElement.addEventListener("error", () => {
    // Image failed to load - show error state with proper dimensions
    console.error(`[WB-E] Failed to load image: ${src}`);

    // Set a reasonable fallback size for the error state
    imageElement.style.width = "200px";
    imageElement.style.height = "150px";
    imageElement.style.background = "linear-gradient(45deg, #ffcccc 25%, transparent 25%), linear-gradient(-45deg, #ffcccc 25%, transparent 25%)";
    imageElement.style.backgroundSize = "20px 20px";
    imageElement.style.opacity = "1";

    // Update loading indicator to show error
    loadingIndicator.innerHTML = "X";
    loadingIndicator.style.animation = "none";
    loadingIndicator.style.border = "2px solid #ff4444";
    loadingIndicator.style.backgroundColor = "rgba(255, 255, 255, 0.9)";

      // Update UI elements with fallback dimensions
      setTimeout(() => {
        // CRITICAL FIX: Check if element is still in DOM before updating UI (prevents race condition errors)
        if (!imageElement.isConnected || !container.isConnected) return;
        
        updateClipPath();
        
        // Update all dimensions with error state dimensions
        updateAllImageDimensions(container);
        
        updateHandlePosition();
      }, 100);
  });

  // Start loading the image
  imageElement.src = src;

  // Init circle from the *arguments* first; fall back to locals
  const local = getImageLocalVars(id);
  let circleOffsetX = (circleOffset && typeof circleOffset.x === "number")
    ? circleOffset.x
    : (local.circleOffset?.x ?? 0);
  let circleOffsetY = (circleOffset && typeof circleOffset.y === "number")
    ? circleOffset.y
    : (local.circleOffset?.y ?? 0);

  // Normalize radius: use param if provided, else local, else null
  let circleRadius = (circleRadiusParam !== undefined)
    ? circleRadiusParam
    : (local.circleRadius ?? null);
  if (circleRadius === undefined) circleRadius = null;

  // Seed the single source of truth (CSS vars + dataset) from incoming state
  setImageCropData(imageElement, {
    crop,
    maskType: currentMaskType,
    circleOffset: { x: circleOffsetX, y: circleOffsetY },
    circleRadius: circleRadius,
    scale
  });
  
  // Store displayWidth/displayHeight in dataset for F5 reload
  // These will be updated after image loads with actual calculated dimensions
  if (displayWidth != null) {
    imageElement.dataset.displayWidth = displayWidth;
  }
  if (displayHeight != null) {
    imageElement.dataset.displayHeight = displayHeight;
  }

  // Function to clamp circle offset to bounds (moved inside createImageElement for scope access)
  function clampCircleOffsetToBounds() {
    const { width: baseW, height: baseH } = getUnscaledSize(imageElement);
    if (baseW <= 0 || baseH <= 0) return;
    const r = (circleRadius == null) ? Math.min(baseW, baseH) / 2 : circleRadius;
    const minOffX = -(baseW / 2 - r);
    const maxOffX = (baseW / 2 - r);
    const minOffY = -(baseH / 2 - r);
    const maxOffY = (baseH / 2 - r);
    circleOffsetX = Math.max(minOffX, Math.min(maxOffX, circleOffsetX));
    circleOffsetY = Math.max(minOffY, Math.min(maxOffY, circleOffsetY));
    setImageCropData(imageElement, { circleOffset: { x: circleOffsetX, y: circleOffsetY } });
  }

  // Применяем маску (crop)
  function updateClipPath() {
    if (currentMaskType === 'rect') {
      // Прямоугольная маска (inset)
      const clipPath = `inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px)`;
      imageElement.style.clipPath = clipPath;
    } else if (currentMaskType === 'circle') {
      // Круговая маска (circle)
      const width = imageElement.offsetWidth;
      const height = imageElement.offsetHeight;

      if (width === 0 || height === 0) {
        console.warn("WARNING: Image not loaded yet, skipping clip-path");
        return; // Пропускаем если картинка еще не загружена
      }

      // Используем сохраненный радиус или вычисляем по умолчанию
      if (circleRadius === null) {
        circleRadius = Math.min(width, height) / 2; // Радиус = половина меньшей стороны
      }

      const centerX = width / 2 + circleOffsetX;
      const centerY = height / 2 + circleOffsetY;
      const clipPath = `circle(${circleRadius}px at ${centerX}px ${centerY}px)`;
      imageElement.style.clipPath = clipPath;
    }
  }
  updateClipPath();

  // Robust mask-type toggle that creates/destroys the right handles
  function updateMaskType() {
    // 0) Write mask to the single source of truth (CSS/dataset) first
    setImageCropData(imageElement, { maskType: currentMaskType });

    // 1) Mirror to our local vars cache
    updateGlobalVars();

    // 2) Apply visual clip immediately
    updateClipPath();

    // 3) Ensure correct handles exist for the new mode; remove wrong ones
    const ensureRectHandles = () => {
      // ALWAYS force clean slate to avoid stale listeners
      // Remove any existing rect handles (even if partial)

      // Check for orphaned gizmos in DOM
      const allGizmos = container.querySelectorAll('[class*="wbe-crop-handle"]');
      if (allGizmos.length > 0) {
      }

      ["top", "right", "bottom", "left"].forEach(k => {
        if (cropHandles[k] && cropHandles[k].parentNode) {
          cropHandles[k].parentNode.removeChild(cropHandles[k]);
        }
        cropHandles[k] = null;
      });

      // Create all 4 rect handles as a unit (always fresh)
      const handleSize = 12;
      const baseStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: ${ZIndexConstants.CROP_HANDLE};
          pointer-events: auto;
        `;

      const gizmoId = `gizmo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;


      cropHandles.top = document.createElement("div");
      cropHandles.top.className = "wbe-crop-handle-top";
      cropHandles.top.style.cssText = baseStyle + `cursor: ns-resize;`;
      cropHandles.top.dataset.gizmoId = `${gizmoId}-top`;
      container.appendChild(cropHandles.top);

      cropHandles.right = document.createElement("div");
      cropHandles.right.className = "wbe-crop-handle-right";
      cropHandles.right.style.cssText = baseStyle + `cursor: ew-resize;`;
      cropHandles.right.dataset.gizmoId = `${gizmoId}-right`;
      container.appendChild(cropHandles.right);

      cropHandles.bottom = document.createElement("div");
      cropHandles.bottom.className = "wbe-crop-handle-bottom";
      cropHandles.bottom.style.cssText = baseStyle + `cursor: ns-resize;`;
      cropHandles.bottom.dataset.gizmoId = `${gizmoId}-bottom`;
      container.appendChild(cropHandles.bottom);

      cropHandles.left = document.createElement("div");
      cropHandles.left.className = "wbe-crop-handle-left";
      cropHandles.left.style.cssText = baseStyle + `cursor: ew-resize;`;
      cropHandles.left.dataset.gizmoId = `${gizmoId}-left`;
      container.appendChild(cropHandles.left);

      // ALWAYS attach listeners (to fresh handles)
      setupCropHandleDrag();

      // Remove circle handle if present
      if (cropHandles.circleResize && cropHandles.circleResize.parentNode) {
        cropHandles.circleResize.parentNode.removeChild(cropHandles.circleResize);
      }
      cropHandles.circleResize = null;
      // Also stop circle drag
      cleanupCircleDrag();
    };

    const ensureCircleHandles = () => {
      // ALWAYS force clean slate - remove all rect handles

      // Check for orphaned gizmos in DOM
      const allGizmos = container.querySelectorAll('[class*="wbe-crop-handle"]');
      if (allGizmos.length > 0) {
      }

      ["top", "right", "bottom", "left"].forEach(k => {
        if (cropHandles[k] && cropHandles[k].parentNode) {
          cropHandles[k].parentNode.removeChild(cropHandles[k]);
        }
        cropHandles[k] = null;
      });

      // ALWAYS clean up old circle handle and listeners
      cleanupCircleDrag();
      if (cropHandles.circleResize && cropHandles.circleResize.parentNode) {
        cropHandles.circleResize.parentNode.removeChild(cropHandles.circleResize);
      }
      cropHandles.circleResize = null;

      // ALWAYS create fresh circle handle
      const handleSize = 12;
      const baseStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: ${ZIndexConstants.CROP_HANDLE};
          pointer-events: auto;
        `;
      const gizmoId = `gizmo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      cropHandles.circleResize = document.createElement("div");
      cropHandles.circleResize.className = "wbe-crop-handle-circle-resize";
      cropHandles.circleResize.style.cssText = baseStyle + `cursor: nw-resize;`;
      cropHandles.circleResize.dataset.gizmoId = `${gizmoId}-circle`;
      container.appendChild(cropHandles.circleResize);

      // ALWAYS attach fresh listeners
      setupCircleResizeHandleDrag();
      setupCircleDrag();
    };

    if (isCropping) {
      selectionBorder.style.display = "block";
      selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)";
      if (currentMaskType === "rect") {
        ensureRectHandles();
      } else {
        ensureCircleHandles();
      }
      updateSelectionBorderSize();
      updateCropHandlesPosition();
      updateCircleResizeHandlePosition();
    } else {
      updateSelectionBorderSize();
      updateCircleResizeHandlePosition();
    }

    // 4) Update all dimensions to sync everything (borders, clickTarget, imageElement position)
    // CRITICAL: Call updateAllImageDimensions FIRST to ensure imageElement position is correct
    // This function will also update borders and clickTarget, so we don't need to call them separately
    // This prevents desynchronization between imageElement position and border positions
    updateAllImageDimensions(container);
    
    // Update panel position if panel is open and in crop mode
    if (isCropping && window.wbeImageControlPanelUpdate) {
      window.wbeImageControlPanelUpdate();
    }
  }



  container.appendChild(imageElement);

  // Permanent border (серая рамка, показывается только когда НЕ выделена)
  const permanentBorder = document.createElement("div");
  permanentBorder.className = "wbe-image-permanent-border";
  permanentBorder.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      box-sizing: border-box;
      pointer-events: none;
      display: block;
      z-index: ${ZIndexConstants.SELECTION_BORDER};
    `;
  // Initialize border style from parameters or defaults
  const borderParams = {};
  if (borderHex != null) borderParams.hexColor = borderHex;
  if (borderOpacity != null) borderParams.opacity = borderOpacity;
  if (borderWidth != null) borderParams.width = borderWidth;
  if (borderRadius != null) borderParams.radius = borderRadius;
  updateImageBorderStyle(permanentBorder, borderParams);
  container.appendChild(permanentBorder);

  // Selection border overlay (синяя рамка при выделении)
  const selectionBorder = document.createElement("div");
  selectionBorder.className = "wbe-image-selection-border";
  selectionBorder.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      border: 1px solid #4a9eff;
      pointer-events: none;
      display: none;
      z-index: ${ZIndexConstants.SELECTION_BORDER};
    `;
  container.appendChild(selectionBorder);

  // Click target overlay - matches ONLY visible (cropped) area
  // This prevents clicking/dragging by invisible cropped parts
  // Positioned exactly where the visible image is
  const clickTarget = document.createElement("div");
  clickTarget.className = "wbe-image-click-target";
  clickTarget.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      background: transparent;
      pointer-events: none;
      /* NEVER ADD Z-INDEX TO CLICK TARGET */
    `;
  container.appendChild(clickTarget);


  layer.appendChild(container);

  // Click target will be updated after image loads (handled by progressive loading system)

  const resizeController = new ResizeController(container, imageElement, {
    onSave: async () => {
      clampCircleOffsetToBounds();
      
      // INSTRUMENTATION: Log scale save start
      const layer = getOrCreateLayer();
      const domElements = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')).map(el => ({
        id: el.id,
        found: el.id === id,
        scale: el.querySelector('.wbe-canvas-image')?.style.transform || 'none'
      })) : [];
      const managerZIndex = ZIndexManager.get(id);
      const managerRank = ZIndexManager.getRank(id);
      const pendingCount = window.wbePendingImageUpdates?.size || 0;
      
      wbeLog('ScaleSave', `START: id=${id.slice(-6)}, DOM elements=${domElements.length}, foundInDOM=${domElements.some(e => e.found)}, managerZIndex=${managerZIndex}, managerRank=${managerRank}, pendingUpdates=${pendingCount}`, {
        domElements: domElements.slice(0, 5),
        containerExists: !!container,
        imageElementExists: !!imageElement,
        containerInDOM: container?.isConnected
      });
      
      await saveImageState(true, { skipZIndex: true, partial: true }); // Skip z-index read - it doesn't change during resize

      if (window.wbeImageControlPanelUpdate) {
        window.wbeImageControlPanelUpdate();
      }
    },
    onScaleChange: (newScale) => {
      if (window.wbeImageControlPanelUpdate) {
        window.wbeImageControlPanelUpdate();
      }

      // Update all dimensions after scale change
      updateAllImageDimensions(container);
      
      resizeController.updatePosition();
    }
  });

  // Initialize SelectionController to replace closure-based selection
  // TEMPORARY FOR INVESTIGATION
  const selectionController = new SelectionController(container, imageElement, {
    onSelect: (controller) => {
      // Clear mass selection when selecting individual image
      if (window.MassSelection && window.MassSelection.selectedCount > 0) {
        window.MassSelection.clear();
      }
    },
    onDeselect: (controller) => {
      // Hide control panel when deselecting
      killImageControlPanel();
    },
    showControlPanel: (imageElement, container) => {
      // NOTE: Frozen images cannot be selected, so this callback won't be called for them
      // But keeping the check for safety
      if (isImageFrozen(container.id)) {
        // Frozen images don't show control panel - they have unfreeze icon instead
        // showFrozenControlPanel(container); // COMMENTED OUT - using unfreeze icon
        return;
      } else {
        // Show normal control panel for non-frozen images
        showImageControlPanel(imageElement, container, currentMaskType, {
          onCropModeToggle: async (enabled) => {
            if (enabled) {
              await enterCropMode();
            } else {
              await exitCropMode();
            }
          },
          onMaskTypeChange: async (newMaskType) => {
            currentMaskType = newMaskType;
            updateMaskType();

            if (window.wbeImageControlPanel?.updatePanelState) {
              window.wbeImageControlPanel.updatePanelState(newMaskType);
            }

            await saveImageState();
          }
        });
      }
    },
    hideControlPanel: () => {
      // Hide both normal and frozen panels
      killImageControlPanel();
    },
    clearMassSelection: () => {
      if (window.MassSelection && window.MassSelection.selectedCount > 0) {
        window.MassSelection.clear();
      }
    }
  });



  const resizeHandle = resizeController.handle;


  // Функция для обновления позиции handle
  function updateHandlePosition() {
    // CRITICAL FIX: Check if element is still in DOM (prevents race condition errors)
    if (!imageElement || !imageElement.isConnected || !resizeController || !resizeController.handle || !resizeController.handle.isConnected) return;
    
    resizeController.updatePosition();

    // Старая логика для fallback
    const transform = imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (currentMaskType === 'rect') {
      const croppedWidth = width - crop.left - crop.right;
      const croppedHeight = height - crop.top - crop.bottom;

      const scaledWidth = croppedWidth * currentScale;
      const scaledHeight = croppedHeight * currentScale;

      resizeController.handle.style.left = `${crop.left * currentScale + scaledWidth - 6}px`;
      resizeController.handle.style.top = `${crop.top * currentScale + scaledHeight - 6}px`;
    } else if (currentMaskType === 'circle') {
      const currentRadius = circleRadius !== null ? circleRadius : Math.min(width, height) / 2;

      const centerX = width / 2 + circleOffsetX;
      const centerY = height / 2 + circleOffsetY;

      const handleX = centerX + currentRadius * 0.707;
      const handleY = centerY + currentRadius * 0.707;

      resizeController.handle.style.left = `${handleX * currentScale - 6}px`;
      resizeController.handle.style.top = `${handleY * currentScale - 6}px`;
    }
  }

  function updateSelectionBorderSize() {
    // CRITICAL: Always read fresh crop data from DOM (not closure variables)
    // This ensures we use the correct scale and crop values after F5
    const cropData = getImageCropData(imageElement);
    const currentCrop = cropData.crop;
    const currentMaskTypeValue = cropData.maskType;
    const currentScale = cropData.scale;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    // Preserve user-set border-radius for permanentBorder
    const userBorderRadius = permanentBorder.dataset.borderRadius;

    if (currentMaskTypeValue === 'rect') {
      // Прямоугольная маска: вычитаем crop из размеров
      const croppedWidth = width - currentCrop.left - currentCrop.right;
      const croppedHeight = height - currentCrop.top - currentCrop.bottom;

      const scaledWidth = croppedWidth * currentScale;
      const scaledHeight = croppedHeight * currentScale;

      const offsetLeft = currentCrop.left * currentScale;
      const offsetTop = currentCrop.top * currentScale;

      // Update permanent border - preserve user-set borderRadius
      permanentBorder.style.width = `${scaledWidth}px`;
      permanentBorder.style.height = `${scaledHeight}px`;
      permanentBorder.style.left = `${offsetLeft}px`;
      permanentBorder.style.top = `${offsetTop}px`;
      if (userBorderRadius) {
        permanentBorder.style.borderRadius = `${userBorderRadius}px`;
      } else {
        permanentBorder.style.borderRadius = "0";
      }
      permanentBorder.style.clipPath = "none";

      // Update selection border - always use mask-based borderRadius
      if (selectionBorder) {
        selectionBorder.style.width = `${scaledWidth}px`;
        selectionBorder.style.height = `${scaledHeight}px`;
        selectionBorder.style.left = `${offsetLeft}px`;
        selectionBorder.style.top = `${offsetTop}px`;
        selectionBorder.style.borderRadius = "0";
        selectionBorder.style.clipPath = "none";
      }
    } else if (currentMaskTypeValue === 'circle') {
      // Круговая маска: используем диаметр круга
      const currentRadius = cropData.circleRadius !== null ? cropData.circleRadius : Math.min(width, height) / 2;
      const diameter = currentRadius * 2;

      const scaledDiameter = diameter * currentScale;

      // Центр круга с учетом offset
      const centerX = width / 2 + cropData.circleOffset.x;
      const centerY = height / 2 + cropData.circleOffset.y;

      const offsetLeft = (centerX - currentRadius) * currentScale;
      const offsetTop = (centerY - currentRadius) * currentScale;

      // Update permanent border - for circle mask, always use 50% (overrides user radius)
      permanentBorder.style.width = `${scaledDiameter}px`;
      permanentBorder.style.height = `${scaledDiameter}px`;
      permanentBorder.style.left = `${offsetLeft}px`;
      permanentBorder.style.top = `${offsetTop}px`;
      permanentBorder.style.borderRadius = "50%";
      permanentBorder.style.clipPath = "none";

      // Update selection border - always use 50% for circle mask
      if (selectionBorder) {
        selectionBorder.style.width = `${scaledDiameter}px`;
        selectionBorder.style.height = `${scaledDiameter}px`;
        selectionBorder.style.left = `${offsetLeft}px`;
        selectionBorder.style.top = `${offsetTop}px`;
        selectionBorder.style.borderRadius = "50%";
        selectionBorder.style.clipPath = "none";
      }
    }
  }

  // Crop mode (mask) - гизмо-точки для обрезки
  const cropHandles = {
    top: null,
    right: null,
    bottom: null,
    left: null,
    circleResize: null
  };

  function enterCropMode() {
    // Проверяем, не заблокирована ли картинка другим пользователем
    if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
   
      return;
    }
    isCropping = true;
    // NEW ARCHITECTURE: Sync closure variables from CSS/Dataset (source of truth)
    // This ensures crop handles start at correct position
    const cropData = getImageCropData(imageElement);
    crop.top = cropData.crop.top;
    crop.right = cropData.crop.right;
    crop.bottom = cropData.crop.bottom;
    crop.left = cropData.crop.left;
    currentMaskType = cropData.maskType;
    circleOffsetX = cropData.circleOffset.x;
    circleOffsetY = cropData.circleOffset.y;
    circleRadius = cropData.circleRadius;




    // Broadcast lock to all users
    game.socket.emit(`module.${MODID}`, {
      type: "imageLock",
      imageId: id,
      userId: game.user.id,
      userName: game.user.name
    });

    // Mark as cropping
    container.setAttribute('data-cropping', 'true');
    // Mark as locked locally
    container.dataset.lockedBy = game.user.id;

    // Allow clicks on UI inside the container while cropping
    container.style.setProperty("pointer-events", "auto", "important");

    // Обновляем глобальные переменные
    updateGlobalVars();

    // Прячем resize handle и permanent border
    resizeController.handle.style.display = "none";
    permanentBorder.style.display = "none"; // Ensure gray border is hidden during crop

    // Disable click target during crop mode to allow deselection
    const clickTarget = container.querySelector(".wbe-image-click-target");
    if (clickTarget) {
      clickTarget.style.pointerEvents = "none";
    }

    // Change cursor to default (not move) during crop mode
    container.style.setProperty("cursor", "default", "important");

    // Показываем фиолетовую рамку для crop mode
    selectionBorder.style.display = "block";
    selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Фиолетовый для crop mode

    // NEW ARCHITECTURE: Update border using synced data
    updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
    
    // Update panel position after border update in crop mode
    if (window.wbeImageControlPanelUpdate) {
      window.wbeImageControlPanelUpdate();
    }




    // Создаем элементы управления в зависимости от типа маски
    if (currentMaskType === 'rect') {
      // Прямоугольная маска: 4 гизмо-точки (top, right, bottom, left)
      const handleSize = 12;
      const handleStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: ${ZIndexConstants.CROP_HANDLE};
          pointer-events: auto;
        `;

      // Top handle
      cropHandles.top = document.createElement("div");
      cropHandles.top.className = "wbe-crop-handle-top";
      cropHandles.top.style.cssText = handleStyle + `cursor: ns-resize;`;
      container.appendChild(cropHandles.top);

      // Right handle
      cropHandles.right = document.createElement("div");
      cropHandles.right.className = "wbe-crop-handle-right";
      cropHandles.right.style.cssText = handleStyle + `cursor: ew-resize;`;
      container.appendChild(cropHandles.right);

      // Bottom handle
      cropHandles.bottom = document.createElement("div");
      cropHandles.bottom.className = "wbe-crop-handle-bottom";
      cropHandles.bottom.style.cssText = handleStyle + `cursor: ns-resize;`;
      container.appendChild(cropHandles.bottom);

      // Left handle
      cropHandles.left = document.createElement("div");
      cropHandles.left.className = "wbe-crop-handle-left";
      cropHandles.left.style.cssText = handleStyle + `cursor: ew-resize;`;
      container.appendChild(cropHandles.left);

      // Позиционируем ручки
      updateCropHandlesPosition();

      // Добавляем обработчики drag для каждой ручки
      setupCropHandleDrag();
    } else if (currentMaskType === 'circle') {
      // Круговая маска: гизмочка для изменения размера + drag для перемещения
      const handleSize = 12;
      const handleStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: ${ZIndexConstants.CROP_HANDLE};
          pointer-events: auto;
        `;

      // Создаем гизмочку для изменения размера круга
      cropHandles.circleResize = document.createElement("div");
      cropHandles.circleResize.className = "wbe-crop-handle-circle-resize";
      cropHandles.circleResize.style.cssText = handleStyle + `cursor: nw-resize;`;
      container.appendChild(cropHandles.circleResize);

      // Позиционируем гизмочку
      updateCircleResizeHandlePosition();

      // Добавляем обработчик для изменения размера
      setupCircleResizeHandleDrag();

      // Включаем режим drag для перемещения картинки внутри круга
      setupCircleDrag();
    }

    // Ensure resize handle stays hidden (in case socket update tries to show it)
    resizeController.handle.style.display = "none";
  }

  async function exitCropMode() {

    isCropping = false;

    if (window.wbeImageControlPanel?.closeSubpanel) {
      window.wbeImageControlPanel.closeSubpanel();
    }

    // CRITICAL: Write closure modifications back to CSS/Dataset (source of truth)
    // During crop mode, we only modified closures for performance
    // Now sync everything before broadcasting/reading
    setImageCropData(imageElement, {
      crop: { ...crop },
      maskType: currentMaskType,
      circleOffset: { x: circleOffsetX, y: circleOffsetY },
      circleRadius: circleRadius
    });

    // FINAL SAVE - Now broadcast all crop changes to everyone (skip z-index read - it doesn't change during crop)
    await saveImageState(true, { skipZIndex: true }); // Force broadcast

    // Broadcast unlock to all users
    game.socket.emit(`module.${MODID}`, {
      type: "imageUnlock",
      imageId: id
    });

    // Remove cropping flag
    container.removeAttribute('data-cropping');

    // Remove lock locally
    delete container.dataset.lockedBy;

    // Go back to clickTarget-only interactions outside crop mode
    container.style.setProperty("pointer-events", "none", "important");

    // Обновляем глобальные переменные
    updateGlobalVars();

    // CRITICAL: Clean up crop handles
    Object.values(cropHandles).forEach(handle => {
      if (handle && handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });
    cropHandles.top = null;
    cropHandles.right = null;
    cropHandles.bottom = null;
    cropHandles.left = null;
    cropHandles.circleResize = null;

    // Cleanup для circle drag
    cleanupCircleDrag();

    // Показываем resize handle и восстанавливаем cursor
    if (selectionController.isSelected() && !isImageFrozen(container.id)) {
      resizeController.handle.style.display = "flex";
      updateHandlePosition();

      // Восстанавливаем move cursor
      // container.style.setProperty("cursor", "move", "important"); // Removed move cursor

      // Возвращаем оригинальный цвет рамки
      selectionBorder.style.borderColor = "#4a9eff";
      updateSelectionBorderSize();
    }

    // NEW ARCHITECTURE: Update all dimensions to reflect NEW crop state
    // This ensures container, imageElement, borders, and clickTarget are all in sync
    updateAllImageDimensions(container);

    // Re-enable click target after crop mode
    if (clickTarget) {
      clickTarget.style.pointerEvents = "auto";
    }


    // Remove gizmo points (for rect and circle)
    Object.values(cropHandles).forEach(handle => {
      if (handle && handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });
    cropHandles.top = null;
    cropHandles.right = null;
    cropHandles.bottom = null;
    cropHandles.left = null;
    cropHandles.circleResize = null;

    // Cleanup для circle drag
    cleanupCircleDrag();
  }

  function updateCropHandlesPosition() {
    if (!isCropping) return;

    const transform = imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    const scaledWidth = width * currentScale;
    const scaledHeight = height * currentScale;

    // Calculate the center of the cropped area
    const croppedWidth = width - crop.left - crop.right;
    const croppedHeight = height - crop.top - crop.bottom;
    const croppedCenterX = crop.left + croppedWidth / 2;
    const croppedCenterY = crop.top + croppedHeight / 2;

    // Top (center top of cropped area)
    if (cropHandles.top) {
      cropHandles.top.style.left = `${croppedCenterX * currentScale - 6}px`;
      cropHandles.top.style.top = `${crop.top * currentScale - 6}px`;
    }

    // Right (center right of cropped area)
    if (cropHandles.right) {
      cropHandles.right.style.left = `${(width - crop.right) * currentScale - 6}px`;
      cropHandles.right.style.top = `${croppedCenterY * currentScale - 6}px`;
    }

    // Bottom (center bottom of cropped area)
    if (cropHandles.bottom) {
      cropHandles.bottom.style.left = `${croppedCenterX * currentScale - 6}px`;
      cropHandles.bottom.style.top = `${(height - crop.bottom) * currentScale - 6}px`;
    }

    // Left (center left of cropped area)
    if (cropHandles.left) {
      cropHandles.left.style.left = `${crop.left * currentScale - 6}px`;
      cropHandles.left.style.top = `${croppedCenterY * currentScale - 6}px`;
    }
  }

  function updateCircleResizeHandlePosition() {
    if (!isCropping || !cropHandles.circleResize) return;

    const transform = imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (width === 0 || height === 0) return;

    // Position gizmo at the edge of the circle (right-bottom)
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const centerX = width / 2 + circleOffsetX;
    const centerY = height / 2 + circleOffsetY;

    // Gizmo coordinates at the edge of the circle
    const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
    const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707

    cropHandles.circleResize.style.left = `${handleX * currentScale - 6}px`;
    cropHandles.circleResize.style.top = `${handleY * currentScale - 6}px`;

  }

  function setupCircleResizeHandleDrag() {

    cropHandles.circleResize.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startRadius = circleRadius;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // Get current scale
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        // Calculate change in radius (use average of deltaX and deltaY)
        const deltaRadius = (deltaX + deltaY) / (2 * currentScale);
        const newRadius = Math.max(10, Math.min(Math.min(imageElement.offsetWidth, imageElement.offsetHeight) / 2, startRadius + deltaRadius));

        circleRadius = newRadius;

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCircleResizeHandlePosition();

        // CRITICAL: Update purple border during crop mode with current circle data
        if (isCropping && selectionBorder) {
          const cropData = getImageCropData(imageElement);
          // Use ALL current live values, not mixed old/new data
          updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, cropData.scale);
          
          // Update panel position after border update in crop mode
          if (window.wbeImageControlPanelUpdate) {
            window.wbeImageControlPanelUpdate();
          }
        } else {
          // Only update selection border size if not in crop mode
          updateSelectionBorderSize();
        }

      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(true, { skipZIndex: true }); // Save radius (skip z-index read)
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  function setupCropHandleDrag() {
    container.dataset.lockedBy = game.user.id;
    // TOP handle
    cropHandles.top.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startY = e.clientY;
      const startCrop = crop.top;

      let firstMove = true;
      function onMouseMove(e) {
        const deltaY = e.clientY - startY;
        // Get current scale
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        // Recalculate deltaY with scale
        const scaledDelta = deltaY / currentScale;
        crop.top = Math.max(0, startCrop + scaledDelta);

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        
        // Update panel position after border update in crop mode
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }

        if (firstMove) {
          firstMove = false;
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(true, { skipZIndex: true }); // Save crop (skip z-index read)
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // RIGHT handle
    cropHandles.right.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startCrop = crop.right;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        const scaledDelta = deltaX / currentScale;
        crop.right = Math.max(0, startCrop - scaledDelta); // Invert for right side

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        
        // Update panel position after border update in crop mode
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(true, { skipZIndex: true }); // Skip z-index read - it doesn't change during crop
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // BOTTOM handle
    cropHandles.bottom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startY = e.clientY;
      const startCrop = crop.bottom;

      function onMouseMove(e) {
        const deltaY = e.clientY - startY;
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        const scaledDelta = deltaY / currentScale;
        crop.bottom = Math.max(0, startCrop - scaledDelta); // Инвертируем для нижней стороны

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        
        // Update panel position after border update in crop mode
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(true, { skipZIndex: true }); // Skip z-index read - it doesn't change during crop
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // LEFT handle
    cropHandles.left.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startCrop = crop.left;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        const scaledDelta = deltaX / currentScale;
        crop.left = Math.max(0, startCrop + scaledDelta);

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        
        // Update panel position after border update in crop mode
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(true, { skipZIndex: true }); // Skip z-index read - it doesn't change during crop
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // Circle drag (moving image inside circle mask)
  let circleDragActive = false;
  let circleDragListeners = null;

  function setupCircleDrag() {
    circleDragActive = true;

    // Drag handler for moving image inside circle mask
    const dragHandler = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startOffsetX = circleOffsetX;
      const startOffsetY = circleOffsetY;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // Get scale
        const { width: baseW, height: baseH, scale: currentScale } = getUnscaledSize(imageElement);

        // Calculate new offsets with sensitivity
        const sensitivity = 0.5; // 50% чувствительность для более плавного движения
        let newOffsetX = startOffsetX + (deltaX / currentScale) * sensitivity;
        let newOffsetY = startOffsetY + (deltaY / currentScale) * sensitivity;

        // 🔒 Limit movement by image boundaries
        const width = imageElement.offsetWidth;
        const height = imageElement.offsetHeight;

        if (baseW > 0 && baseH > 0) {
          const r = (circleRadius == null) ? Math.min(baseW, baseH) / 2 : circleRadius;
          // Circle clamp by center in local coordinates
          const centerX = baseW / 2 + newOffsetX;
          const centerY = baseH / 2 + newOffsetY;
          const clampedCenterX = Math.max(r, Math.min(baseW - r, centerX));
          const clampedCenterY = Math.max(r, Math.min(baseH - r, centerY));
          circleOffsetX = clampedCenterX - baseW / 2;
          circleOffsetY = clampedCenterY - baseH / 2;
        } else {
          circleOffsetX = newOffsetX;
          circleOffsetY = newOffsetY;
        }

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCircleResizeHandlePosition(); // Update gizmo position when circle is moved!

        // CRITICAL: Ensure purple border updates during crop mode circle drag
        if (isCropping && selectionBorder) {
          const cropData = getImageCropData(imageElement);
          // Use ALL current live values, not mixed old/new data
          updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, cropData.scale);
          
          // Update panel position after border update in crop mode
          if (window.wbeImageControlPanelUpdate) {
            window.wbeImageControlPanelUpdate();
          }
        } else {
          // Only update selection border size if not in crop mode
          updateSelectionBorderSize(); // Update borders when circle is moved!
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(true, { skipZIndex: true }); // Skip z-index read - it doesn't change during crop
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    // Attach to container instead of imageElement to avoid pointer-events issues
    container.addEventListener("mousedown", dragHandler);

    // Save link for cleanup
    circleDragListeners = { dragHandler };
  }

  function cleanupCircleDrag() {
    if (circleDragListeners) {
      container.removeEventListener("mousedown", circleDragListeners.dragHandler);
      circleDragListeners = null;
    }
    circleDragActive = false;
  }

  // Event handlers
  // Read states from global variables
  let isCropping = getImageLocalVars(id).isCropping || false; // Crop mode (mask)
  // maskType, circleOffsetX/Y passed as parameters (don't redeclare)

  // Function for selecting/deselecting
  function selectImage() {
    // Check if image is frozen - frozen images cannot be selected
    if (isImageFrozen(id)) {
      // Frozen images cannot be selected - only unfreeze icon is interactive
      console.log('[selectImage] Attempted to select frozen image - blocked:', id);
    }

    // Normal selection behavior for non-frozen images
    // Selecting image via SelectionController

    // FIX: Only kill text color panel and deselect text elements, don't kill image panels
    if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
      try {
        window.wbeColorPanel.cleanup();
      } catch { }
    }

    // Deselect text elements manually without killing image panels
    document.querySelectorAll(".wbe-canvas-text-container").forEach(container => {
      if (container.id === id) return; // Skip current (shouldn't match anyway)

      const textElement = container.querySelector(".wbe-canvas-text");
      const resizeHandle = container.querySelector(".wbe-text-resize-handle");
      if (textElement && resizeHandle) {
        delete container.dataset.selected;
        container.style.removeProperty("pointer-events");
        textElement.style.removeProperty("outline");
        textElement.style.removeProperty("outline-offset");
        container.style.removeProperty("cursor");
        resizeHandle.style.display = "none";
      }
    });

    // Clear text selection state (mirrors setSelectedImageId(null) in text selection)
    if (window.TextTools) {
      window.TextTools.selectedTextId = null;
    }

    // Use SelectionController for selection logic
    selectionController.select();

    // Update global state for backward compatibility
    selectedImageId = id;

    // Update global selection state - other elements should listen to this
    if (typeof setSelectedImageId === 'function') {
      setSelectedImageId(id); // This notifies other modules to deselect themselves
    }

    // Show resize handle when selected
    resizeController.show();
    resizeController.updatePosition();

    // Update visual elements with current crop data
    const cropData = getImageCropData(imageElement);

    // Show blue border (SelectionController handles permanent border)
    selectionBorder.style.display = "block";
    selectionBorder.style.borderColor = "#4a9eff";

    // Update selection border with current crop data
    updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Update click target to match visible area
    const clickTarget = container.querySelector(".wbe-image-click-target");
    updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Enable click target pointer events for dragging/scaling/resizing
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "auto", "important");
    }
  }

  async function deselectImage() {
    // Check if image is frozen - frozen images cannot be deselected (they're already deselected)
    if (isImageFrozen(id)) {
      // Frozen images are always deselected - only unfreeze icon is interactive
      // No action needed
      return; // Exit early for frozen images
    }

    // Normal deselection behavior for non-frozen images
    // Deselect image and clean up state

    // Use SelectionController for deselection logic
    selectionController.deselect();

    // Update global state for backward compatibility
    if (selectedImageId === id) {
      selectedImageId = null;
      // Clear global selection state
      if (typeof setSelectedImageId === 'function') {
        setSelectedImageId(null);
      }
    }

    // Exit crop mode if it was active
    if (isCropping) {
      isCropping = false;
      await exitCropMode(); // Await to ensure save completes
    }

    // DON'T call updateGlobalVars() here - same issue as selectImage!
    // We should READ current state, not overwrite with stale closure values

    // Always keep pointer-events: none on container - click target handles interactions
    container.style.setProperty("pointer-events", "none", "important");
    container.style.removeProperty("cursor");

    // Hide blue border (SelectionController handles permanent border)
    selectionBorder.style.display = "none";

    // NEW ARCHITECTURE: Update permanent border with current crop data
    const cropData = getImageCropData(imageElement);
    updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Update click target to match visible area
    const clickTarget = container.querySelector(".wbe-image-click-target");
    updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Disable click target pointer events when deselected to allow canvas drag/pan
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }

    resizeController.hide();

    // CRITICAL FIX: Update all dimensions to sync imageElement position with container
    // This ensures imageElement position (left/top) is correct after deselection
    // especially after crop operations that may have changed the offset
    updateAllImageDimensions(container);

  }

  // Delete by Delete key
  async function deleteImage() {
    // FIX: Kill image control panel before deletion
    killImageControlPanel();

    resizeController.destroy();
    // Destroy dragController if it exists
    if (resizeController.dragController) {
      resizeController.dragController.destroy();
    }
    // Destroy selectionController
    if (selectionController) {
      selectionController.destroy();
    }
    // Unregister from global registry
    imageRegistry.delete(id);

    // Clean up z-index
    ZIndexManager.remove(id);

    container.remove();

    const images = await getAllImages();
    delete images[id];
    await setAllImages(images);
  }

  // Paste copied image
  async function pasteImage() {
    if (!copiedImageData) return;


    // Get position of layer relative to viewport
    const { lastMouseX, lastMouseY } = getSharedVars();
    const layer = getOrCreateLayer();
    if (!layer) return;

    const layerRect = layer.getBoundingClientRect();

    // Convert screen coordinates → layer coordinates → world coordinates
    const layerX = lastMouseX - layerRect.left;
    const layerY = lastMouseY - layerRect.top;

    // Consider layer scale and translate
    const transform = layer.style.transform || "";

    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const translateMatch = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);

    const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    const translateX = translateMatch ? parseFloat(translateMatch[1]) : 0;
    const translateY = translateMatch ? parseFloat(translateMatch[2]) : 0;


    // Consider translate and scale
    const worldX = (layerX - translateX) / scale;
    const worldY = (layerY - translateY) / scale;

    // Center image under cursor using displayWidth/displayHeight if available
    const displayWidth = copiedImageData.displayWidth || null;
    const displayHeight = copiedImageData.displayHeight || null;
    const centeredX = displayWidth ? worldX - displayWidth / 2 : worldX;
    const centeredY = displayHeight ? worldY - displayHeight / 2 : worldY;

    const newImageId = `wbe-image-${Date.now()}`;
    createImageElement({
      id: newImageId,
      src: copiedImageData.src,
      left: centeredX,
      top: centeredY,
      scale: copiedImageData.scale,
      crop: copiedImageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      maskType: copiedImageData.maskType || 'rect',
      circleOffset: copiedImageData.circleOffset || { x: 0, y: 0 },
      circleRadius: copiedImageData.circleRadius || null,
      isFrozen: copiedImageData.isFrozen || false,
      displayWidth,
      displayHeight
    });

    const images = await getAllImages();
    images[newImageId] = {
      src: copiedImageData.src,
      left: centeredX,
      top: centeredY,
      scale: copiedImageData.scale,
      crop: cropData,
      maskType: maskTypeData,
      circleOffset: circleOffsetData,
      circleRadius: circleRadiusData,
      isFrozen: copiedImageData.isFrozen || false,
      zIndex: ZIndexManager.get(newImageId),
      rank: ZIndexManager.getRank(newImageId)
    };
    await setAllImages(images);

  }

  // REMOVED: Per-image global handlers (moved to single global handlers at module level)
  // Keydown and copy listeners are now handled globally via selectedImageId

  // REMOVED: Per-image global handler (moved to single global handler below)
  // Selection is now handled by the unified global image selection handler

  // Initialize ImageDragController to replace inline drag handlers
  const dragController = new ImageDragController(container, imageElement, {
    onDragStart: (controller) => {
      // If element is not selected - first select it
      if (!selectionController.isSelected()) {
        // CLEAR MASS SELECTION when selecting image for drag
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }
        selectImage();
      }
    },
    onDragMove: (controller, newX, newY) => {
      // Position updates are handled internally by the controller
    },
    onDragEnd: async (controller) => {
      await saveImageState(true, { skipZIndex: true, partial: true }); // Skip z-index read - it doesn't change during drag

      // FIX: Show panel again after drag (like text module)
      if (window.wbeImageControlPanel) {
        // Panel already exists, just update position
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      } else {
        // Panel was killed, recreate it
        showImageControlPanel(imageElement, container, currentMaskType, {
          onCropModeToggle: async (enabled) => {
            if (enabled) {
              await enterCropMode();
            } else {
              await exitCropMode();
            }
          },
          onMaskTypeChange: async (newMaskType) => {
            currentMaskType = newMaskType;
            updateMaskType();

            if (window.wbeImageControlPanel?.updatePanelState) {
              window.wbeImageControlPanel.updatePanelState(newMaskType);
            }

            await saveImageState();
          }
        });
      }
    },
    onSave: async () => {
      await saveImageState();
    },
    getLayer: () => getOrCreateLayer()
  });

  // Add dragController reference to resizeController for cleanup
  resizeController.dragController = dragController;









  // Universal function for saving image state
  // Universal function for saving image state
  async function saveImageState(broadcast = true, options = {}) {
    // Always snapshot the CURRENT truth from the DOM first
    const domSnap = getImageCropData(imageElement);
    const currentScale = domSnap.scale;
    
    // INSTRUMENTATION: Log saveImageState entry
    const layer = getOrCreateLayer();
    const domCheck = {
      containerInDOM: container?.isConnected,
      imageElementInDOM: imageElement?.isConnected,
      getElementById: !!document.getElementById(id),
      querySelectorAll: layer ? layer.querySelectorAll(`#${CSS.escape(id)}`).length : 0,
      allContainers: layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')).map(el => el.id).slice(0, 10) : []
    };
    const managerState = {
      zIndex: ZIndexManager.get(id),
      rank: ZIndexManager.getRank(id)
    };
    const dbState = await getAllImages();
    const dbImage = dbState[id];
    
    wbeLog('SaveImageState', `ENTRY: id=${id.slice(-6)}, scale=${currentScale}, broadcast=${broadcast}, skipZIndex=${options.skipZIndex}`, {
      domCheck,
      managerState,
      dbExists: !!dbImage,
      dbScale: dbImage?.scale,
      pendingUpdates: window.wbePendingImageUpdates?.size || 0
    });
    let useCrop = { ...domSnap.crop };
    let useMaskType = domSnap.maskType;
    let useCircleOffset = { ...domSnap.circleOffset };
    let useCircleRadius = domSnap.circleRadius;

    // Defensive fallback (shouldn't trigger, but safe if DOM is incomplete)
    if (useMaskType == null) useMaskType = currentMaskType;
    if (!useCircleOffset) useCircleOffset = { x: circleOffsetX, y: circleOffsetY };
    if (useCircleRadius === undefined) useCircleRadius = circleRadius;

    // OPTIMIZATION: Only read z-index if not skipping (for high-speed operations like drag/resize/crop)
    // If skipping, use cached value from pending updates or fall back to manager
    let zIndex;
    if (options.skipZIndex) {
      // Skip z-index read - use cached value from pending updates or manager
      const cached = window.wbePendingImageUpdates?.get(id);
      zIndex = cached?.zIndex || ZIndexManager.get(id);
    } else {
      // Read z-index from manager (normal case)
      zIndex = ZIndexManager.get(id);
    }
    
    // Calculate display dimensions (visible area after scale and crop) for F5 reload placeholder sizing
    let displayWidth = null;
    let displayHeight = null;
    if (imageElement.complete && imageElement.naturalWidth > 0 && imageElement.naturalHeight > 0) {
      const dims = calculateCroppedDimensions(imageElement, useMaskType, useCrop, useCircleOffset, useCircleRadius, currentScale);
      displayWidth = dims.width;
      displayHeight = dims.height;
      console.log('[SAVE STATE] Calculated displayWidth/Height', {
        id,
        displayWidth,
        displayHeight,
        scale: currentScale,
        complete: imageElement.complete,
        naturalWidth: imageElement.naturalWidth
      });
    } else {
      console.log('[SAVE STATE] Image not loaded, displayWidth/Height will be null', {
        id,
        complete: imageElement.complete,
        naturalWidth: imageElement.naturalWidth
      });
    }

    // CRITICAL FIX: Always include rank from ZIndexManager (even with skipZIndex)
    // Rank doesn't change during drag/resize/crop, but we need to preserve it
    const rank = ZIndexManager.getRank(id);
    
    const imageData = {
      src: imageElement.src,
      left: parseFloat(container.style.left),
      top: parseFloat(container.style.top),
      scale: currentScale,
      crop: useCrop,
      maskType: useMaskType,
      circleOffset: useCircleOffset,
      circleRadius: useCircleRadius,
      isCropping: isCropping,
      isFrozen: isFrozen,
      zIndex: zIndex,
      rank: rank,
      displayWidth,
      displayHeight
    };

    // Keep caches in sync with what we're persisting
    globalImageData[id] = {
      maskType: useMaskType,
      circleOffset: useCircleOffset,
      circleRadius: useCircleRadius,
      crop: useCrop,
      scale: currentScale
    };
    updateImageLocalVars(id, globalImageData[id]);

    // While actively cropping, don't spam sockets/db with intermediate states
    if (isCropping && broadcast) {
      return;
    }

    // Mark as partial update if requested (for drag/resize operations)
    if (options.partial) {
      imageData._partial = true;
      console.log(`[PARTIAL FLAG] Image ${id.slice(-6)} (saveImageState): _partial flag set to true`);
    }
    
    // Queue the update for debounced batching (handled by module-level debounce)
    window.wbePendingImageUpdates.set(id, imageData);
    
    // INSTRUMENTATION: Log before flush
    wbeLog('SaveImageState', `QUEUED: id=${id.slice(-6)}, scale=${imageData.scale}, pendingSize=${window.wbePendingImageUpdates.size}, partial=${options.partial || false}`, {
      imageData: {
        scale: imageData.scale,
        zIndex: imageData.zIndex,
        rank: imageData.rank,
        displayWidth: imageData.displayWidth,
        displayHeight: imageData.displayHeight
      }
    });
    
    window.wbeDebouncedFlushImageUpdates?.();
  }

  // Register this image in the global registry for selection management
  imageRegistry.set(id, {
    container: container,
    selectFn: selectImage,
    deselectFn: deselectImage,
    isFrozen: isFrozen,
    dragController: dragController,
    resizeController: resizeController,
    selectionController: selectionController
  });

  // Apply freeze state if needed (without sync to avoid loops during loading)
  if (isFrozen) {
    setImageFrozen(id, true, false);
  }

  // Install global handler if not already installed
  installGlobalImageSelectionHandler();

  return container;
}



/* ----------------------- Canvas Elements Storage ----------------- */




async function getAllImages() {
  try {
    const result = await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_IMAGES) || {};
    return result;
  } catch (e) {
    console.error("[WB-E] getAllImages error:", e);
    return {};
  }
}

async function setAllImages(images, isPartial = false) {
  const timestamp = Date.now();
  const stackTrace = new Error().stack?.split('\n').slice(1, 10).join(' | ') || 'unknown';
  
  const imageIds = Object.keys(images);
  const isEmptyPayload = imageIds.length === 0;
  const isGM = game.user.isGM;
  
  // [INVESTIGATE] Логирование входа в setAllImages
  const layer = getOrCreateLayer();
  const domElements = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')) : [];
  const domIds = domElements.map(el => el.id);
  const dbImages = await getAllImages();
  const dbIds = Object.keys(dbImages);
  
  console.log(`[INVESTIGATE] setAllImages ENTRY:`, {
    userId: game.user.id,
    userName: game.user.name,
    isGM,
    isPartial,
    payloadCount: imageIds.length,
    payloadIds: imageIds.map(id => id.slice(-6)),
    domCount: domIds.length,
    domIds: domIds.map(id => id.slice(-6)),
    dbCount: dbIds.length,
    dbIds: dbIds.map(id => id.slice(-6)),
    caller: stackTrace.split('|')[0]?.trim() || 'unknown',
    stackTrace: stackTrace.split('|').slice(0, 3).join(' → ')
  });
  
  try {
    if (game.user.isGM) {
      if (isPartial) {
        // Partial update: merge with current DB state
        const currentImages = await getAllImages();
        const mergedImages = { ...currentImages, ...images };
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, mergedImages);
      } else {
        // Full update: replace entire state
        // CRITICAL FIX: For mass deletion, we receive the authoritative state (without deleted items)
        // Do NOT merge with current state - use the passed images as authoritative
        // This ensures deletions are properly propagated
        const currentImages = await getAllImages();
        const currentImageIds = Object.keys(currentImages);
        // Check if this is a deletion (fewer images than current)
        const isDeletion = imageIds.length < currentImageIds.length;
        const deletedIds = currentImageIds.filter(id => !imageIds.includes(id));
        
        if (isDeletion && deletedIds.length > 0) {
        }
        
        // CRITICAL FIX: Use images as authoritative state (not merged)
        // This ensures deletions are properly saved and broadcast
        // GM saves to database
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_IMAGES);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, images);
      }
      
      
      // CRITICAL FIX: Remove elements from DOM that are no longer in images
      const layer = getOrCreateLayer();
      if (layer) {
        const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
        const existingIds = new Set();
        
        // INSTRUMENTATION: Log setAllImages start (GM)
        const payloadIds = Object.keys(images);
        const domIdsBefore = Array.from(existingElements).map(el => el.id);
        const duplicatesBefore = domIdsBefore.filter((id, idx) => domIdsBefore.indexOf(id) !== idx);
        
        wbeLog('SetAllImages', `GM_START: payloadCount=${payloadIds.length}, domCount=${domIdsBefore.length}, duplicatesBefore=${duplicatesBefore.length > 0 ? duplicatesBefore.map(id => id.slice(-6)).join(',') : 'none'}`, {
          payloadIds: payloadIds.slice(0, 10),
          domIdsBefore: domIdsBefore.slice(0, 10),
          duplicatesBefore: duplicatesBefore.length > 0 ? duplicatesBefore : null
        });
        
        // Remove duplicate elements before processing (keep only first occurrence)
        const idToElement = new Map();
        const removedDuplicates = [];
        existingElements.forEach(element => {
          if (!idToElement.has(element.id)) {
            idToElement.set(element.id, element);
          } else {
            // Duplicate found - remove it
            removedDuplicates.push(element.id);
            clearImageCaches(element.id);
            ZIndexManager.remove(element.id);
            element.remove();
          }
        });
        
        if (removedDuplicates.length > 0) {
          wbeLog('SetAllImages', `GM_DEDUP: removedDuplicates=${removedDuplicates.map(id => id.slice(-6)).join(',')}`);
        }
        
        // Update existing and create new images locally
        for (const [id, imageData] of Object.entries(images)) {
          existingIds.add(id);
          const existing = document.getElementById(id);
          if (existing) {
            // Update existing element
            updateImageElement(existing, imageData);
          } else {
            // Check for duplicates using querySelectorAll before creating
            const duplicates = layer.querySelectorAll(`#${CSS.escape(id)}`);
            if (duplicates.length > 0) {
              // Element exists but getElementById didn't find it - update first occurrence
              updateImageElement(duplicates[0], imageData);
              // Remove other duplicates
              for (let i = 1; i < duplicates.length; i++) {
                clearImageCaches(duplicates[i].id);
                ZIndexManager.remove(duplicates[i].id);
                duplicates[i].remove();
              }
            } else {
              // Create new element - use saved displayWidth/displayHeight for correct placeholder sizing on F5 reload
              createImageElement({
                id,
                src: imageData.src,
                left: imageData.left,
                top: imageData.top,
                scale: imageData.scale,
                crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
                maskType: imageData.maskType || 'rect',
                circleOffset: imageData.circleOffset || { x: 0, y: 0 },
                circleRadius: imageData.circleRadius || null,
                isFrozen: imageData.isFrozen || false,
                displayWidth: imageData.displayWidth || null,
                displayHeight: imageData.displayHeight || null,
                borderHex: imageData.borderHex,
                borderOpacity: imageData.borderOpacity,
                borderWidth: imageData.borderWidth,
                borderRadius: imageData.borderRadius,
                shadowHex: imageData.shadowHex,
                shadowOpacity: imageData.shadowOpacity
              });
            }
          }
          
          // Update global variables for each image
          updateImageLocalVars(id, {
            maskType: imageData.maskType || 'rect',
            circleOffset: imageData.circleOffset || { x: 0, y: 0 },
            circleRadius: imageData.circleRadius,
            crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
            scale: imageData.scale || 1,
            isCropping: imageData.isCropping || false
          });
        }
        
        // Remove elements only at full sync (not partial)
        const removedIds = [];
        if (!isPartial) {
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              removedIds.push(element.id);
              // Clear runtime caches to prevent resurrection
              clearImageCaches(element.id);
              // Clean up z-index
              ZIndexManager.remove(element.id);
              // Actually remove from DOM
              element.remove();
            }
          });
        }
        
        // INSTRUMENTATION: Log setAllImages end (GM)
        const domIdsAfter = Array.from(layer.querySelectorAll('.wbe-canvas-image-container')).map(el => el.id);
        const duplicatesAfter = domIdsAfter.filter((id, idx) => domIdsAfter.indexOf(id) !== idx);
        
        wbeLog('SetAllImages', `GM_END: domCountAfter=${domIdsAfter.length}, removedCount=${removedIds.length}, duplicatesAfter=${duplicatesAfter.length > 0 ? duplicatesAfter.map(id => id.slice(-6)).join(',') : 'none'}`, {
          domIdsAfter: domIdsAfter.slice(0, 10),
          removedIds: removedIds.length > 0 ? removedIds.map(id => id.slice(-6)) : null,
          duplicatesAfter: duplicatesAfter.length > 0 ? duplicatesAfter : null
        });
      }
      
      // [INVESTIGATE] Детальное логирование перед отправкой imageUpdate от GM
      const gmDomElements = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')) : [];
      const gmDomIds = gmDomElements.map(el => el.id);
      const gmDbImages = await getAllImages();
      const gmDbIds = Object.keys(gmDbImages);
      const gmPayloadIds = Object.keys(images);
      
      const inGmPayloadNotInDOM = gmPayloadIds.filter(id => !gmDomIds.includes(id));
      const inGmPayloadNotInDB = gmPayloadIds.filter(id => !gmDbIds.includes(id));
      const inGmDOMNotInPayload = gmDomIds.filter(id => !gmPayloadIds.includes(id));
      const inGmDBNotInPayload = gmDbIds.filter(id => !gmPayloadIds.includes(id));
      
      console.log(`[INVESTIGATE] GM sending imageUpdate:`, {
        userId: game.user.id,
        userName: game.user.name,
        isPartial,
        payloadCount: gmPayloadIds.length,
        payloadIds: gmPayloadIds.map(id => id.slice(-6)),
        domCount: gmDomIds.length,
        domIds: gmDomIds.map(id => id.slice(-6)),
        dbCount: gmDbIds.length,
        dbIds: gmDbIds.map(id => id.slice(-6)),
        inPayloadNotInDOM: inGmPayloadNotInDOM.map(id => id.slice(-6)),
        inPayloadNotInDB: inGmPayloadNotInDB.map(id => id.slice(-6)),
        inDOMNotInPayload: inGmDOMNotInPayload.map(id => id.slice(-6)),
        inDBNotInPayload: inGmDBNotInPayload.map(id => id.slice(-6))
      });
      
      if (inGmPayloadNotInDOM.length > 0) {
        console.error(`[INVESTIGATE] ⚠️ GM: Payload contains ${inGmPayloadNotInDOM.length} images NOT in DOM:`, inGmPayloadNotInDOM.map(id => id.slice(-6)));
      }
      if (inGmPayloadNotInDB.length > 0) {
        console.warn(`[INVESTIGATE] ⚠️ GM: Payload contains ${inGmPayloadNotInDB.length} images NOT in DB:`, inGmPayloadNotInDB.map(id => id.slice(-6)));
      }
      
      // Send sync: full sync for full updates, partial sync for partial updates
      game.socket.emit(`module.${MODID}`, { type: "imageUpdate", images, isFullSync: !isPartial });
    } else {
      const layer = getOrCreateLayer();
      
      // [INVESTIGATE] Детальное логирование перед отправкой imageUpdateRequest от Player
      const domElements = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')) : [];
      const domIds = domElements.map(el => el.id);
      const dbImages = await getAllImages();
      const dbIds = Object.keys(dbImages);
      const payloadIds = Object.keys(images);
      
      // Проверка на несоответствия
      const inPayloadNotInDOM = payloadIds.filter(id => !domIds.includes(id));
      const inPayloadNotInDB = payloadIds.filter(id => !dbIds.includes(id));
      const inDOMNotInPayload = domIds.filter(id => !payloadIds.includes(id));
      const inDBNotInPayload = dbIds.filter(id => !payloadIds.includes(id));
      
      const stackTrace = new Error().stack?.split('\n').slice(1, 8).join(' | ') || 'unknown';
      
      console.log(`[INVESTIGATE] PLAYER sending imageUpdateRequest:`, {
        userId: game.user.id,
        userName: game.user.name,
        payloadCount: payloadIds.length,
        payloadIds: payloadIds.map(id => id.slice(-6)),
        domCount: domIds.length,
        domIds: domIds.map(id => id.slice(-6)),
        dbCount: dbIds.length,
        dbIds: dbIds.map(id => id.slice(-6)),
        inPayloadNotInDOM: inPayloadNotInDOM.map(id => id.slice(-6)),
        inPayloadNotInDB: inPayloadNotInDB.map(id => id.slice(-6)),
        inDOMNotInPayload: inDOMNotInPayload.map(id => id.slice(-6)),
        inDBNotInPayload: inDBNotInPayload.map(id => id.slice(-6)),
        caller: stackTrace.split('|')[0]?.trim() || 'unknown',
        fullStackTrace: stackTrace,
        // Детали каждого изображения в payload
        payloadDetails: payloadIds.map(id => ({
          id: id.slice(-6),
          fullId: id,
          inDOM: domIds.includes(id),
          inDB: dbIds.includes(id),
          imageData: images[id] ? {
            src: images[id].src?.substring(0, 50) || 'no-src',
            left: images[id].left,
            top: images[id].top,
            scale: images[id].scale
          } : null
        }))
      });
      
      if (inPayloadNotInDOM.length > 0) {
        console.error(`[INVESTIGATE] ⚠️ PLAYER: Payload contains ${inPayloadNotInDOM.length} images NOT in DOM:`, inPayloadNotInDOM.map(id => id.slice(-6)));
      }
      if (inPayloadNotInDB.length > 0) {
        console.warn(`[INVESTIGATE] ⚠️ PLAYER: Payload contains ${inPayloadNotInDB.length} images NOT in DB:`, inPayloadNotInDB.map(id => id.slice(-6)));
      }
      
      // Player sends request GM through socket
      game.socket.emit(`module.${MODID}`, { type: "imageUpdateRequest", images, userId: game.user.id, isPartial });

      // Update locally for immediate UI reaction of the player
      if (layer) {
        // Get all existing images
        const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
        const existingIds = new Set();

        // INSTRUMENTATION: Log setAllImages start (Player)
        const payloadIds = Object.keys(images);
        const domIdsBefore = Array.from(existingElements).map(el => el.id);
        const duplicatesBefore = domIdsBefore.filter((id, idx) => domIdsBefore.indexOf(id) !== idx);
        
        wbeLog('SetAllImages', `PLAYER_START: payloadCount=${payloadIds.length}, domCount=${domIdsBefore.length}, duplicatesBefore=${duplicatesBefore.length > 0 ? duplicatesBefore.map(id => id.slice(-6)).join(',') : 'none'}`, {
          payloadIds: payloadIds.slice(0, 10),
          domIdsBefore: domIdsBefore.slice(0, 10),
          duplicatesBefore: duplicatesBefore.length > 0 ? duplicatesBefore : null
        });

        // Remove duplicate elements before processing (keep only first occurrence)
        const idToElement = new Map();
        const removedDuplicates = [];
        existingElements.forEach(element => {
          if (!idToElement.has(element.id)) {
            idToElement.set(element.id, element);
          } else {
            // Duplicate found - remove it
            removedDuplicates.push(element.id);
            clearImageCaches(element.id);
            ZIndexManager.remove(element.id);
            element.remove();
          }
        });
        
        if (removedDuplicates.length > 0) {
          wbeLog('SetAllImages', `PLAYER_DEDUP: removedDuplicates=${removedDuplicates.map(id => id.slice(-6)).join(',')}`);
        }

        // Update existing and create new images locally
        for (const [id, imageData] of Object.entries(images)) {
          existingIds.add(id);
          const existing = document.getElementById(id);
          const querySelectorResult = layer.querySelectorAll(`#${CSS.escape(id)}`);
          const querySelectorCount = querySelectorResult.length;
          
          if (existing) {
            // Update existing element
            wbeLog('SetAllImages', `PLAYER_UPDATE: id=${id.slice(-6)}, scale=${imageData.scale}, getElementById=found, querySelectorCount=${querySelectorCount}`);
            updateImageElement(existing, imageData);
          } else {
            // Check for duplicates using querySelectorAll before creating
            const duplicates = querySelectorResult;
            if (duplicates.length > 0) {
              // Element exists but getElementById didn't find it - update first occurrence
              wbeLog('SetAllImages', `PLAYER_RACE: id=${id.slice(-6)}, scale=${imageData.scale}, getElementById=null BUT querySelectorCount=${duplicates.length}, updating first`);
              updateImageElement(duplicates[0], imageData);
              // Remove other duplicates
              for (let i = 1; i < duplicates.length; i++) {
                clearImageCaches(duplicates[i].id);
                ZIndexManager.remove(duplicates[i].id);
                duplicates[i].remove();
              }
            } else {
              // Create new element - use saved displayWidth/displayHeight for correct placeholder sizing on F5 reload
              wbeLog('SetAllImages', `PLAYER_CREATE: id=${id.slice(-6)}, scale=${imageData.scale}, getElementById=null, querySelectorCount=0, creating new`);
              createImageElement({
                id,
                src: imageData.src,
                left: imageData.left,
                top: imageData.top,
                scale: imageData.scale,
                crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
                maskType: imageData.maskType || 'rect',
                circleOffset: imageData.circleOffset || { x: 0, y: 0 },
                circleRadius: imageData.circleRadius || null,
                isFrozen: imageData.isFrozen || false,
                displayWidth: imageData.displayWidth || null,
                displayHeight: imageData.displayHeight || null,
                borderHex: imageData.borderHex,
                borderOpacity: imageData.borderOpacity,
                borderWidth: imageData.borderWidth,
                borderRadius: imageData.borderRadius,
                shadowHex: imageData.shadowHex,
                shadowOpacity: imageData.shadowOpacity
              });
            }
          }

          // Update global variables for each image
          updateImageLocalVars(id, {
            maskType: imageData.maskType || 'rect',
            circleOffset: imageData.circleOffset || { x: 0, y: 0 },
            circleRadius: imageData.circleRadius,
            crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
            scale: imageData.scale || 1,
            isCropping: imageData.isCropping || false
          });
        }

        // Only run destructive prune when payload carries authoritative state
        // For partial updates (isPartial=true), do NOT remove any elements - only update existing ones
        const shouldSkipPrune = isEmptyPayload || isPartial;
        if (!shouldSkipPrune) {
          // Remove elements that are no longer in images
          const toRemove = [];
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              toRemove.push(element.id);
            }
          });
          
          if (toRemove.length > 0) {
            console.error(`[WB-E] setAllImages: [${timestamp}] 🚨 REMOVING ${toRemove.length} elements from DOM:`, toRemove);
            console.error(`[WB-E] setAllImages: [${timestamp}] 🚨 Elements in DOM but NOT in images object:`, toRemove);
            console.error(`[WB-E] setAllImages: [${timestamp}] 🚨 Images object has:`, imageIds);
            console.error(`[WB-E] setAllImages: [${timestamp}] 🚨 Call stack:`, stackTrace);
          }
          
          const removedIds = [];
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              removedIds.push(element.id);
              // Clear runtime caches to prevent resurrection
              clearImageCaches(element.id);
              // Clean up z-index
              ZIndexManager.remove(element.id);
              console.error(`[WB-E] setAllImages: [${timestamp}] 🚨 Removing element: ${element.id}`);
              element.remove();
            }
          });
          
          // INSTRUMENTATION: Log setAllImages end (Player)
          const domIdsAfter = Array.from(layer.querySelectorAll('.wbe-canvas-image-container')).map(el => el.id);
          const duplicatesAfter = domIdsAfter.filter((id, idx) => domIdsAfter.indexOf(id) !== idx);
          
          wbeLog('SetAllImages', `PLAYER_END: domCountAfter=${domIdsAfter.length}, removedCount=${removedIds.length}, duplicatesAfter=${duplicatesAfter.length > 0 ? duplicatesAfter.map(id => id.slice(-6)).join(',') : 'none'}`, {
            domIdsAfter: domIdsAfter.slice(0, 10),
            removedIds: removedIds.length > 0 ? removedIds.map(id => id.slice(-6)) : null,
            duplicatesAfter: duplicatesAfter.length > 0 ? duplicatesAfter : null
          });
        } else {
        }
      }
    }
  } catch (e) {
    console.error("[WB-E] setAllImages error:", e);
  }
}


// Function for updating all image parameters
function updateImageElement(existing, imageData) {
  // CRITICAL: Skip socket updates for images locked by current user (actively being manipulated)
  if (existing.dataset.lockedBy && existing.dataset.lockedBy === game.user.id) {
    return; // Don't update position, scale, crop when user is actively manipulating
  }

  // Update basic parameters
  existing.style.left = `${imageData.left}px`;
  existing.style.top = `${imageData.top}px`;

  const imageElement = existing.querySelector(".wbe-canvas-image");
  if (imageElement) {
    imageElement.style.transform = `scale(${imageData.scale})`;

    // Update complex image parameters
    if (imageData.crop) {
      const cropData = imageData.crop;
      if (cropData.top !== undefined) imageElement.style.setProperty('--crop-top', `${cropData.top}px`);
      if (cropData.right !== undefined) imageElement.style.setProperty('--crop-right', `${cropData.right}px`);
      if (cropData.bottom !== undefined) imageElement.style.setProperty('--crop-bottom', `${cropData.bottom}px`);
      if (cropData.left !== undefined) imageElement.style.setProperty('--crop-left', `${cropData.left}px`);
    }

    if (imageData.maskType) {
      imageElement.dataset.maskType = imageData.maskType;
    }

    if (imageData.circleOffset) {
      imageElement.dataset.circleOffsetX = imageData.circleOffset.x;
      imageElement.dataset.circleOffsetY = imageData.circleOffset.y;
    }

    if (imageData.circleRadius !== undefined) {
      imageElement.dataset.circleRadius = (imageData.circleRadius ?? null);
    }
    
    // Update displayWidth/displayHeight in dataset if provided
    if (imageData.displayWidth !== undefined && imageData.displayWidth !== null) {
      imageElement.dataset.displayWidth = imageData.displayWidth;
    }
    if (imageData.displayHeight !== undefined && imageData.displayHeight !== null) {
      imageElement.dataset.displayHeight = imageData.displayHeight;
    }

    // Apply border styles if provided
    if (imageData.borderHex != null || imageData.borderOpacity != null || 
        imageData.borderWidth != null || imageData.borderRadius != null) {
      const permanentBorder = existing.querySelector('.wbe-image-permanent-border');
      if (permanentBorder) {
        updateImageBorderStyle(permanentBorder, {
          hexColor: imageData.borderHex,
          opacity: imageData.borderOpacity,
          width: imageData.borderWidth,
          radius: imageData.borderRadius
        });
      }
    }

    // Apply shadow style if provided
    if (imageData.shadowHex != null || imageData.shadowOpacity != null) {
      updateImageShadowStyle(existing, {
        hexColor: imageData.shadowHex,
        opacity: imageData.shadowOpacity
      });
    }

    // Ensure visual styles/UI are applied *after* the image has size
    const applyAll = () => {
      updateImageVisualStyles(imageElement, imageData);
      updateImageUIElements(existing, imageData);
    };
    if (imageElement.complete && imageElement.naturalWidth) {
      applyAll();
    } else {
      imageElement.addEventListener("load", applyAll, { once: true });
    }
  }

  // CRITICAL: Update imageLocalVars so selectImage() reads fresh data
  // This ensures crop data from socket updates is preserved
  // BUT: Don't update if image is locked by current user (actively being manipulated)
  if (!existing.dataset.lockedBy || existing.dataset.lockedBy !== game.user.id) {
    updateImageLocalVars(existing.id, {
      maskType: imageData.maskType || 'rect',
      circleOffset: imageData.circleOffset || { x: 0, y: 0 },
      circleRadius: imageData.circleRadius,
      crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      scale: imageData.scale || 1,
      isCropping: imageData.isCropping || false
    });
  }

  // Note: Controllers are already enabled when created and remain enabled
  // The real issue was pointer-events being set to none by updateImageUIStates
  // which is now fixed by preserving local selection state in updateImageUIElements

}

// Function for applying visual styles of the image
function updateImageVisualStyles(imageElement, imageData) {
  const maskType = imageData.maskType || 'rect';
  const crop = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const circleOffset = imageData.circleOffset || { x: 0, y: 0 };
  const circleRadius = imageData.circleRadius;

  if (maskType === 'rect') {
    // Rectangular mask (inset)
    const clipPath = `inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px)`;
    imageElement.style.clipPath = clipPath;
  } else if (maskType === 'circle') {
    // Circular mask (circle)
    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (width === 0 || height === 0) {
      console.warn("WARNING: Image not loaded yet, skipping clip-path");
      return;
    }

    // Use saved radius or calculate by default
    const fallback = Math.min(width, height) / 2;
    const radius = (circleRadius == null) ? fallback : circleRadius;

    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;
    const clipPath = `circle(${radius}px at ${centerX}px ${centerY}px)`;
    imageElement.style.clipPath = clipPath;
  }
}

// Function for full update of UI elements of the image
function updateImageUIElements(container, imageData) {
  const imageElement = container.querySelector(".wbe-canvas-image");
  if (!imageElement) return;

  const maskType = imageData.maskType || 'rect';
  const crop = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const circleOffset = imageData.circleOffset || { x: 0, y: 0 };
  const circleRadius = imageData.circleRadius;
  const scale = imageData.scale || 1;

  // ✅ FIX: PRESERVE local selection state - don't override with socket data
  // Selection is managed locally via SelectionController and should not be affected by socket updates
  // Check both dataset.selected AND registry to ensure we preserve selection
  const registry = imageRegistry.get(container.id);
  const isSelected = container.dataset.selected === "true" || 
                     (registry && registry.selectionController && registry.selectionController.isSelected());

  // CRITICAL: Check if THIS user is cropping (locked by them)
  // Local crop mode takes precedence over socket data
  const isLockedByMe = container.dataset.lockedBy === game.user.id;
  const isCropping = isLockedByMe || imageData.isCropping || false;


  // Update permanent border
  const permanentBorder = container.querySelector(".wbe-image-permanent-border");
  if (permanentBorder) {
    updateImageBorder(permanentBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    // Apply border styles if provided (after updateImageBorder to preserve user-set radius)
    if (imageData.borderHex != null || imageData.borderOpacity != null || 
        imageData.borderWidth != null || imageData.borderRadius != null) {
      updateImageBorderStyle(permanentBorder, {
        hexColor: imageData.borderHex,
        opacity: imageData.borderOpacity,
        width: imageData.borderWidth,
        radius: imageData.borderRadius
      });
    }
  }

  // Update shadow style if provided
  if (imageData.shadowHex != null || imageData.shadowOpacity != null) {
    updateImageShadowStyle(container, {
      hexColor: imageData.shadowHex,
      opacity: imageData.shadowOpacity
    });
  }

  // Update selection border
  const selectionBorder = container.querySelector(".wbe-image-selection-border");
  if (selectionBorder) {
    updateImageBorder(selectionBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // Update position of resize handle
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");
  if (resizeHandle) {
    updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // CRITICAL: Update click target to match visible area
  // This ensures the click target stays synchronized with crop changes from socket updates
  const clickTarget = container.querySelector(".wbe-image-click-target");
  if (clickTarget) {
    updateClickTarget(clickTarget, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // Update crop handles
  updateCropHandles(container, maskType, crop, circleOffset, circleRadius, scale);

  // Position crop handles if they are visible
  updateCropHandlesPositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  updateCircleResizeHandlePositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale);

  // Apply UI states
  updateImageUIStates(container, isSelected, isCropping);

  // Update local variables of the image
  updateImageLocalVariables(container, imageData);
}

// Function for applying UI states of the image
function updateImageUIStates(container, isSelected, isCropping) {
  const imageElement = container.querySelector(".wbe-canvas-image");
  const permanentBorder = container.querySelector(".wbe-image-permanent-border");
  const selectionBorder = container.querySelector(".wbe-image-selection-border");
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");
  const clickTarget = container.querySelector(".wbe-image-click-target");

  // CRITICAL: If this user is cropping (locked by them), force isCropping to true
  // This prevents socket updates from showing blue border/resize handle during crop mode
  const isLockedByMe = container.dataset.lockedBy === game.user.id;
  if (isLockedByMe) {
    isCropping = true;
  }

  if (isSelected) {
    // Selected - show blue border, show resize handle (SelectionController manages permanent border)
    if (selectionBorder) selectionBorder.style.display = "block";
    // Only show resize handle if not frozen
    if (resizeHandle && !isImageFrozen(container.id)) {
      resizeHandle.style.display = "flex";
    }

    // Enable click target pointer events when selected
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "auto", "important");
    }

    // Don't set pointer-events on container - let click target handle interactions
    // container.style.setProperty("pointer-events", "auto", "important");
    // Cursor will be set based on crop mode below
    // if (!isCropping) {
    //   container.style.setProperty("cursor", "move", "important");
    // }
    container.dataset.selected = "true";
  } else {
    // Not selected - hide blue border, hide resize handle (SelectionController manages permanent border)
    if (selectionBorder) selectionBorder.style.display = "none";
    if (resizeHandle) resizeHandle.style.display = "none";

    // CRITICAL: Ensure permanent border has pointer-events: none to allow canvas pan/zoom
    if (permanentBorder) {
      permanentBorder.style.setProperty("pointer-events", "none", "important");
    }

    // Disable click target pointer events when not selected to allow canvas drag/pan
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }

    // Remove container styles
    // Always keep pointer-events: none on container - click target handles interactions
    container.style.setProperty("pointer-events", "none", "important");
    container.style.removeProperty("cursor");
    delete container.dataset.selected;
  }

  if (isCropping) {
    // Crop mode - hide resize handle and gray border, purple border, cursor default
    if (resizeHandle) resizeHandle.style.display = "none";
    if (permanentBorder) permanentBorder.style.display = "none"; // Hide gray border during crop
    if (selectionBorder) selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Purple for crop mode
    container.style.setProperty("cursor", "default", "important"); // Default cursor for crop mode
  } else {
    // Not crop mode - show resize handle if selected and not frozen, normal blue border
    if (isSelected && resizeHandle && !isImageFrozen(container.id)) {
      resizeHandle.style.display = "flex";
    }
    if (selectionBorder) selectionBorder.style.borderColor = "#4a9eff";
  }
}

// Function for updating local variables of the image
function updateImageLocalVariables(container, imageData) {
  const imageId = container.id;

  // Save data to global storage
  globalImageData[imageId] = {
    maskType: imageData.maskType || 'rect',
    circleOffset: imageData.circleOffset || { x: 0, y: 0 },
    circleRadius: imageData.circleRadius,
    crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    scale: imageData.scale || 1
  };

  // Update global local variables
  updateImageLocalVarsInElement(imageId, imageData);

}

// Function for forced update of UI with global data
function updateImageUIWithGlobalData(container) {
  const imageId = container.id;
  const data = getImageData(imageId);


  // Update borders
  updateImageSelectionBorderGlobal(container);

  // Update resize handle
  updateImageResizeHandleGlobal(container);

  // Update mask type toggle buttons
  updateMaskTypeToggleGlobal(container, data.maskType);
}

// Function for getting actual data of the image
function getImageData(imageId) {
  return globalImageData[imageId] || {
    maskType: 'rect',
    circleOffset: { x: 0, y: 0 },
    circleRadius: null,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    scale: 1
  };
}

// Function for getting local variables of the image
function getImageLocalVars(imageId) {
  return imageLocalVars[imageId] || {
    maskType: 'rect',
    circleOffset: { x: 0, y: 0 },
    circleRadius: null,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    scale: 1
  };
}

// Function for updating local variables of the image
function updateImageLocalVars(imageId, data) {

  imageLocalVars[imageId] = {
    maskType: data.maskType || 'rect',
    circleOffset: data.circleOffset || { x: 0, y: 0 },
    circleRadius: data.circleRadius,
    crop: data.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    scale: data.scale || 1
  };

}

// Global function for updating local variables in createImageElement
function updateImageLocalVarsInElement(imageId, data) {
  // Find image in DOM
  const container = document.getElementById(imageId);
  if (!container) return;

  // Update global local variables
  updateImageLocalVars(imageId, data);

  // Force update UI with actual data
  setTimeout(() => {
    updateImageUIWithGlobalData(container);
  }, 10);
}

// Global function for updating borders of the image with actual data
function updateImageSelectionBorderGlobal(container) {
  const imageId = container.id;
  const data = getImageData(imageId);

  const imageElement = container.querySelector(".wbe-canvas-image");
  const selectionBorder = container.querySelector(".wbe-image-selection-border");

  if (!imageElement || !selectionBorder) return;

  updateImageBorder(selectionBorder, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
  
  // Update unfreeze icon position if image is frozen
  if (isImageFrozen(imageId)) {
    updateUnfreezeIconPosition(container);
  }
}

// Global function for updating mask type toggle buttons with actual data
function updateMaskTypeToggleGlobal(container, maskType) {
  // Update the control panel mask type buttons if panel exists
  if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.updatePanelState === 'function') {
    window.wbeImageControlPanel.updatePanelState(maskType);
  }
}

// Глобальная функция для обновления позиции resize handle с актуальными данными
function updateImageResizeHandleGlobal(container) {
  const imageId = container.id;
  const data = getImageData(imageId);

  const imageElement = container.querySelector(".wbe-canvas-image");
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");

  if (!imageElement || !resizeHandle) return;

  updateImageResizeHandle(resizeHandle, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
  
  // Update unfreeze icon position if image is frozen
  if (isImageFrozen(imageId)) {
    updateUnfreezeIconPosition(container);
  }
}

/**
 * Update all image-related dimensions (container, borders, clickTarget) after crop/scale changes
 * This ensures everything stays in sync
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function updateAllImageDimensions(container) {
  const imageId = container.id;
  const imageElement = container.querySelector('.wbe-canvas-image');
  if (!imageElement) return;
  
  const data = getImageData(imageId);
  if (!data) return;
  
  const cropData = getImageCropData(imageElement);
  const dims = calculateCroppedDimensions(imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
  
  if (dims.width === 0 || dims.height === 0) return;
  
  // Update container size to match cropped area
  // Container should be exactly the size of the visible (cropped) area
  // Note: We use overflow: visible to allow gizmos (resize handles) to be visible outside the container
  // The image itself is clipped via clip-path, so overflow: hidden is not needed
  container.style.width = `${dims.width}px`;
  container.style.height = `${dims.height}px`;
  container.style.overflow = 'visible';
  
  
  // Update imageElement position to match border positioning
  // Borders are positioned at (dims.left, dims.top) relative to container
  // ImageElement should be at (0, 0) so the visible cropped area aligns with borders
  // The clip-path on imageElement handles the actual cropping
  const currentPosition = imageElement.style.position || getComputedStyle(imageElement).position;
  if (currentPosition !== 'absolute') {
    imageElement.style.position = 'absolute';
  }
  imageElement.style.left = `0px`;
  imageElement.style.top = `0px`;
  
  // Note: We keep width: auto; height: auto; to preserve image aspect ratio
  // The image will display at its natural size (or constrained by max-width/max-height)
  // and the transform: scale() will be applied on top of that
  
  // Update borders
  const permanentBorder = container.querySelector('.wbe-image-permanent-border');
  if (permanentBorder) {
    updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
  }
  
  const selectionBorder = container.querySelector('.wbe-image-selection-border');
  if (selectionBorder) {
    updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
  }
  
  // Update clickTarget
  const clickTarget = container.querySelector('.wbe-image-click-target');
  if (clickTarget) {
    updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
  }
  
  // Update resize handle
  const resizeHandle = container.querySelector('.wbe-image-resize-handle');
  if (resizeHandle) {
    updateImageResizeHandle(resizeHandle, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
  }
  
  // DIAGNOSTIC: Setup click logging to debug clickable area issue
  setupClickDiagnostics(container, dims);
}

/**
 * Diagnostic function to log what element receives clicks
 * @param {HTMLElement} container - The container element
 * @param {Object} dims - Dimensions object with left, top, width, height
 */
function setupClickDiagnostics(container, dims) {
  // Remove old handler if exists
  if (container._clickDiagnosticHandler) {
    container.removeEventListener('click', container._clickDiagnosticHandler, true);
    container._clickDiagnosticHandler = null;
  }
  
  // Add new handler
  container._clickDiagnosticHandler = (e) => {
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX;
    const clickY = e.clientY;
    const localX = clickX - rect.left;
    const localY = clickY - rect.top;
    
    // Get all elements at click point
    const elementsAtPoint = document.elementsFromPoint(clickX, clickY);
    
    // Get computed styles for pointer-events
    const containerPE = getComputedStyle(container).pointerEvents;
    const clickTarget = container.querySelector('.wbe-image-click-target');
    const clickTargetPE = clickTarget ? getComputedStyle(clickTarget).pointerEvents : 'N/A';
    const clickTargetRect = clickTarget ? clickTarget.getBoundingClientRect() : null;
    
    // Check if click is in the "dead zone" (area before dims.left/top)
    const isInDeadZone = localX < dims.left || localY < dims.top;
    
    console.group(`[CLICK DIAGNOSTIC] Container: ${container.id}`);
    console.log('Click coordinates:', { 
      client: { x: clickX, y: clickY },
      local: { x: localX, y: localY },
      inDeadZone: isInDeadZone,
      deadZoneBounds: { left: dims.left, top: dims.top }
    });
    console.log('Container:', {
      position: { left: container.style.left, top: container.style.top },
      size: { width: container.style.width, height: container.style.height },
      pointerEvents: containerPE,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    });
    console.log('ClickTarget:', {
      exists: !!clickTarget,
      position: clickTarget ? { left: clickTarget.style.left, top: clickTarget.style.top } : null,
      size: clickTarget ? { width: clickTarget.style.width, height: clickTarget.style.height } : null,
      pointerEvents: clickTargetPE,
      rect: clickTargetRect
    });
    console.log('All elements at click point:', elementsAtPoint.map(el => ({
      tag: el.tagName,
      class: el.className,
      id: el.id,
      pointerEvents: getComputedStyle(el).pointerEvents,
      zIndex: getComputedStyle(el).zIndex,
      position: getComputedStyle(el).position,
      rect: el.getBoundingClientRect()
    })));
    console.log('Target element:', {
      tag: e.target.tagName,
      class: e.target.className,
      id: e.target.id,
      pointerEvents: getComputedStyle(e.target).pointerEvents
    });
    console.log('Current target:', {
      tag: e.currentTarget.tagName,
      class: e.currentTarget.className,
      id: e.currentTarget.id
    });
    console.groupEnd();
  };
  
  // Add capture phase listener to catch all clicks
  container.addEventListener('click', container._clickDiagnosticHandler, true);
}

/**
 * Calculate cropped dimensions for an image
 * Returns the visible area dimensions and position after applying crop and scale
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element
 * @param {string} maskType - 'rect' or 'circle'
 * @param {Object} crop - Crop values {top, right, bottom, left}
 * @param {Object} circleOffset - Circle offset {x, y}
 * @param {number} circleRadius - Circle radius
 * @param {number} scale - Image scale
 * @returns {Object} { width, height, left, top, baseWidth, baseHeight } - Dimensions in scaled pixels
 */
function calculateCroppedDimensions(imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  // Get unscaled base dimensions
  const unscaledSize = getUnscaledSize(imageElement);
  const baseWidth = unscaledSize.width;
  const baseHeight = unscaledSize.height;
  const currentScale = unscaledSize.scale;
  
  if (baseWidth === 0 || baseHeight === 0) {
    return { width: 0, height: 0, left: 0, top: 0, baseWidth: 0, baseHeight: 0 };
  }

  if (maskType === 'rect') {
    const croppedWidth = baseWidth - crop.left - crop.right;
    const croppedHeight = baseHeight - crop.top - crop.bottom;
    const scaledWidth = croppedWidth * currentScale;
    const scaledHeight = croppedHeight * currentScale;
    const offsetLeft = crop.left * currentScale;
    const offsetTop = crop.top * currentScale;
    
    return {
      width: scaledWidth,
      height: scaledHeight,
      left: offsetLeft,
      top: offsetTop,
      baseWidth: baseWidth,
      baseHeight: baseHeight
    };
  } else if (maskType === 'circle') {
    const fallback = Math.min(baseWidth, baseHeight) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const diameter = currentRadius * 2;
    const scaledDiameter = diameter * currentScale;
    const centerX = baseWidth / 2 + circleOffset.x;
    const centerY = baseHeight / 2 + circleOffset.y;
    const offsetLeft = (centerX - currentRadius) * currentScale;
    const offsetTop = (centerY - currentRadius) * currentScale;
    
    return {
      width: scaledDiameter,
      height: scaledDiameter,
      left: offsetLeft,
      top: offsetTop,
      baseWidth: baseWidth,
      baseHeight: baseHeight
    };
  }
  
  return { width: 0, height: 0, left: 0, top: 0, baseWidth: 0, baseHeight: 0 };
}

// Функция для обновления рамок картинки
function updateImageBorder(border, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const dims = calculateCroppedDimensions(imageElement, maskType, crop, circleOffset, circleRadius, scale);
  
  if (dims.width === 0 || dims.height === 0) return;
  
  // Preserve user-set border-radius if it exists (for permanentBorder)
  const userBorderRadius = border.dataset.borderRadius;
  const isPermanentBorder = border.classList.contains('wbe-image-permanent-border');
  
  if (maskType === 'rect') {
    border.style.width = `${dims.width}px`;
    border.style.height = `${dims.height}px`;
    border.style.left = `${dims.left}px`;
    border.style.top = `${dims.top}px`;
    // Only override border-radius for selection border, preserve user-set radius for permanentBorder
    if (!isPermanentBorder || !userBorderRadius) {
      border.style.borderRadius = "0";
    } else if (isPermanentBorder && userBorderRadius) {
      // Restore user-set border-radius for permanentBorder
      border.style.borderRadius = `${userBorderRadius}px`;
    }
    border.style.clipPath = "none";
  } else if (maskType === 'circle') {
    border.style.width = `${dims.width}px`;
    border.style.height = `${dims.height}px`;
    border.style.left = `${dims.left}px`;
    border.style.top = `${dims.top}px`;
    // For circle mask, always use 50% (overrides user radius)
    border.style.borderRadius = "50%";
    border.style.clipPath = "none";
  }
}

/**
 * Update permanent border style (color, width, opacity, radius)
 * Border grows inward using box-sizing: border-box
 */
function updateImageBorderStyle(permanentBorder, { hexColor = DEFAULT_BORDER_HEX, opacity = DEFAULT_BORDER_OPACITY, width = DEFAULT_BORDER_WIDTH, radius = DEFAULT_BORDER_RADIUS } = {}) {
  if (!permanentBorder) return;

  const safeWidth = clamp(Number(width), 0, 12);
  const safeOpacity = clamp(Number(opacity), 0, 100);
  const safeHex = hexColor || DEFAULT_BORDER_HEX;
  const safeRadius = clamp(Number(radius), 0, 20);
  const rgba = hexToRgba(safeHex, safeOpacity);

  // Determine mask type from image element
  const container = permanentBorder.closest('.wbe-canvas-image-container');
  const imageElement = container?.querySelector('.wbe-canvas-image');
  const maskType = imageElement ? (getImageCropData(imageElement).maskType || 'rect') : 'rect';

  // Store values in dataset for persistence
  permanentBorder.dataset.borderHex = safeHex;
  permanentBorder.dataset.borderOpacity = String(safeOpacity);
  permanentBorder.dataset.borderWidth = String(safeWidth);
  permanentBorder.dataset.borderRadius = String(safeRadius);
  permanentBorder.dataset.borderRgba = safeWidth > 0 && rgba ? rgba : "";

  // Apply border style - border grows inward with box-sizing: border-box
  // For circle mask, always use 50% (overrides user radius)
  const borderRadius = maskType === 'circle' ? '50%' : `${safeRadius}px`;
  
  if (safeWidth > 0 && rgba) {
    permanentBorder.style.boxSizing = "border-box";
    permanentBorder.style.border = `${safeWidth}px solid ${rgba}`;
    permanentBorder.style.borderRadius = borderRadius;
  } else {
    permanentBorder.style.border = "none";
    permanentBorder.style.borderRadius = borderRadius;
  }
}

/**
 * Update shadow style (color, opacity) on image container
 */
function updateImageShadowStyle(container, { hexColor = DEFAULT_SHADOW_HEX, opacity = DEFAULT_SHADOW_OPACITY } = {}) {
  if (!container) return;

  const safeOpacity = clamp(Number(opacity), 0, 100);
  const safeHex = hexColor || DEFAULT_SHADOW_HEX;
  const rgba = hexToRgba(safeHex, safeOpacity);

  // Store values in dataset for persistence
  container.dataset.shadowHex = safeHex;
  container.dataset.shadowOpacity = String(safeOpacity);
  container.dataset.shadowRgba = rgba || "";

  // Apply shadow style using filter: drop-shadow
  if (rgba) {
    container.style.filter = `drop-shadow(0 4px 8px ${rgba})`;
  } else {
    container.style.filter = "none";
  }
}

/**
 * Read current shadow style from container element
 */
function getImageShadowStyle(container) {
  if (!container) {
    return null;
  }

  // Try to read from dataset first (most reliable)
  const shadowHex = container.dataset.shadowHex;
  const shadowOpacity = container.dataset.shadowOpacity;

  // If dataset values exist, use them
  if (shadowHex !== undefined) {
    return {
      hex: shadowHex || DEFAULT_SHADOW_HEX,
      opacity: shadowOpacity !== undefined ? Number(shadowOpacity) : DEFAULT_SHADOW_OPACITY
    };
  }

  // Fallback: read from computed styles
  const computed = window.getComputedStyle(container);
  const filterValue = computed.filter || container.style.filter || "";
  const dropShadowMatch = filterValue.match(/drop-shadow\([^)]+rgba?\(([^)]+)\)\)/);
  
  if (dropShadowMatch) {
    const rgbaMatch = dropShadowMatch[1].match(/(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1]);
      const g = parseInt(rgbaMatch[2]);
      const b = parseInt(rgbaMatch[3]);
      const a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
      const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
      const opacity = Math.round(a * 100);
      return {
        hex,
        opacity
      };
    }
  }

  return {
    hex: DEFAULT_SHADOW_HEX,
    opacity: DEFAULT_SHADOW_OPACITY
  };
}

/**
 * Read current border style from permanentBorder element
 */
function getImageBorderStyle(permanentBorder) {
  if (!permanentBorder) {
    return null;
  }

  // Try to read from dataset first (most reliable)
  const borderHex = permanentBorder.dataset.borderHex;
  const borderOpacity = permanentBorder.dataset.borderOpacity;
  const borderWidth = permanentBorder.dataset.borderWidth;
  const borderRadius = permanentBorder.dataset.borderRadius;

  // If dataset values exist, use them
  if (borderHex !== undefined) {
    return {
      hex: borderHex || DEFAULT_BORDER_HEX,
      opacity: borderOpacity !== undefined ? Number(borderOpacity) : DEFAULT_BORDER_OPACITY,
      width: borderWidth !== undefined ? Number(borderWidth) : DEFAULT_BORDER_WIDTH,
      radius: borderRadius !== undefined ? Number(borderRadius) : DEFAULT_BORDER_RADIUS
    };
  }

  // Fallback: read from computed styles
  const computed = window.getComputedStyle(permanentBorder);
  const borderColorInfo = rgbaToHexOpacity(
    computed.borderColor || permanentBorder.style.borderColor || null,
    DEFAULT_BORDER_HEX,
    DEFAULT_BORDER_OPACITY
  );
  const borderWidthFromStyle = parseFloat(computed.borderWidth || permanentBorder.style.borderWidth || "0") || 0;
  const borderRadiusFromStyle = parseFloat(computed.borderRadius || permanentBorder.style.borderRadius || "0") || 0;

  return {
    hex: borderColorInfo.hex,
    opacity: borderColorInfo.opacity,
    width: borderWidthFromStyle,
    radius: borderRadiusFromStyle
  };
}

// Функция для обновления resize handle
function updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  // CRITICAL FIX: Check if element is still in DOM (prevents race condition errors)
  if (!imageElement || !imageElement.isConnected || !resizeHandle || !resizeHandle.isConnected) return;
  
  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  if (maskType === 'rect') {
    // Прямоугольная маска: handle в правом нижнем углу
    const croppedWidth = width - crop.left - crop.right;
    const croppedHeight = height - crop.top - crop.bottom;
    const scaledWidth = croppedWidth * scale;
    const scaledHeight = croppedHeight * scale;
    const offsetLeft = crop.left * scale;
    const offsetTop = crop.top * scale;

    resizeHandle.style.left = `${offsetLeft + scaledWidth - 6}px`;
    resizeHandle.style.top = `${offsetTop + scaledHeight - 6}px`;
  } else if (maskType === 'circle') {
    // Круговая маска: handle на краю круга
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;
    const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
    const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707

    resizeHandle.style.left = `${handleX * scale - 6}px`;
    resizeHandle.style.top = `${handleY * scale - 6}px`;
  }
}

// Функция для обновления crop handles
function updateCropHandles(container, maskType, crop, circleOffset, circleRadius, scale) {
  // Kill and recreate handles based on mask type (following updateMaskType() principle)

  if (maskType === 'rect') {
    // Remove circle handles if they exist
    const circleHandle = container.querySelector(".wbe-crop-handle-circle-resize");
    if (circleHandle && circleHandle.parentNode) {
      circleHandle.parentNode.removeChild(circleHandle);
    }

    // Keep rect handles visible (they should exist if in crop mode)
    const rectHandles = [
      container.querySelector(".wbe-crop-handle-top"),
      container.querySelector(".wbe-crop-handle-right"),
      container.querySelector(".wbe-crop-handle-bottom"),
      container.querySelector(".wbe-crop-handle-left")
    ];
    rectHandles.forEach(h => {
      if (h) h.style.display = 'block';
    });

  } else if (maskType === 'circle') {
    // Remove rect handles if they exist
    ["top", "right", "bottom", "left"].forEach(side => {
      const handle = container.querySelector(`.wbe-crop-handle-${side}`);
      if (handle && handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });

    // Keep circle handle visible (should exist if in crop mode)
    const circleHandle = container.querySelector(".wbe-crop-handle-circle-resize");
    if (circleHandle) {
      circleHandle.style.display = 'block';
    }
  }
}

// Глобальная функция для позиционирования crop handles
function updateCropHandlesPositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const cropHandles = {
    top: container.querySelector(".wbe-crop-handle-top"),
    right: container.querySelector(".wbe-crop-handle-right"),
    bottom: container.querySelector(".wbe-crop-handle-bottom"),
    left: container.querySelector(".wbe-crop-handle-left")
  };

  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  // Calculate visible region dimensions (same math as updateImageBorder)
  const croppedW = width - crop.left - crop.right;
  const croppedH = height - crop.top - crop.bottom;
  const left = crop.left * scale;
  const top = crop.top * scale;
  const w = croppedW * scale;
  const h = croppedH * scale;

  // Position handles at edges of visible region
  if (cropHandles.top) {
    cropHandles.top.style.left = `${left + w / 2 - 6}px`;
    cropHandles.top.style.top = `${top - 6}px`;
  }

  if (cropHandles.right) {
    cropHandles.right.style.left = `${left + w - 6}px`;
    cropHandles.right.style.top = `${top + h / 2 - 6}px`;
  }

  if (cropHandles.bottom) {
    cropHandles.bottom.style.left = `${left + w / 2 - 6}px`;
    cropHandles.bottom.style.top = `${top + h - 6}px`;
  }

  if (cropHandles.left) {
    cropHandles.left.style.left = `${left - 6}px`;
    cropHandles.left.style.top = `${top + h / 2 - 6}px`;
  }
}

// Глобальная функция для позиционирования circle resize handle
function updateCircleResizeHandlePositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const cropHandles = {
    circleResize: container.querySelector(".wbe-crop-handle-circle-resize")
  };

  if (!cropHandles.circleResize) return;

  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  const fallback = Math.min(width, height) / 2;
  const currentRadius = (circleRadius == null) ? fallback : circleRadius;
  const centerX = width / 2 + circleOffset.x;
  const centerY = height / 2 + circleOffset.y;

  // Координаты гизмочки на краю круга
  const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
  const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707

  cropHandles.circleResize.style.left = `${handleX * scale - 6}px`;
  cropHandles.circleResize.style.top = `${handleY * scale - 6}px`;
}

async function globalPasteImage() {
  if (!copiedImageData) return;


  // Конвертируем screen → world coordinates (через Pixi.js)
  const { lastMouseX, lastMouseY } = getSharedVars();
  const worldPos = screenToWorld(lastMouseX, lastMouseY);

  // Center image under cursor using displayWidth/displayHeight if available
  const displayWidth = copiedImageData.displayWidth || null;
  const displayHeight = copiedImageData.displayHeight || null;
  const centeredLeft = displayWidth ? worldPos.x - displayWidth / 2 : worldPos.x;
  const centeredTop = displayHeight ? worldPos.y - displayHeight / 2 : worldPos.y;

  const newImageId = `wbe-image-${Date.now()}`;
  // Pass displayWidth/displayHeight for correct placeholder sizing
  createImageElement({
    id: newImageId,
    src: copiedImageData.src,
    left: centeredLeft,
    top: centeredTop,
    scale: copiedImageData.scale,
    crop: copiedImageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    maskType: copiedImageData.maskType || 'rect',
    circleOffset: copiedImageData.circleOffset || { x: 0, y: 0 },
    circleRadius: copiedImageData.circleRadius || null,
    isFrozen: copiedImageData.isFrozen || false,
    displayWidth,
    displayHeight
  });

  const images = await getAllImages();
  images[newImageId] = {
    src: copiedImageData.src,
    left: centeredLeft,
    top: centeredTop,
    scale: copiedImageData.scale,
    crop: cropData,
    maskType: maskTypeData,
    circleOffset: circleOffsetData,
    circleRadius: circleRadiusData,
    isFrozen: copiedImageData.isFrozen || false,
      zIndex: ZIndexManager.get(newImageId),
      rank: ZIndexManager.getRank(newImageId)
  };
  await setAllImages(images);

}

// Вставка картинки из системного буфера
async function handleImagePasteFromClipboard(file) {
  try {
    // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
    copiedImageData = null;

    // 🚀 OPTIMIZATION: Preload image from File object to get dimensions BEFORE upload
    // This allows us to create placeholder with correct size immediately (no size jumps)
    const objectURL = URL.createObjectURL(file);
    const preloadImg = new Image();
    
    const dimensions = await new Promise((resolve, reject) => {
      preloadImg.onload = () => {
        URL.revokeObjectURL(objectURL); // Cleanup memory
        resolve({
          width: preloadImg.naturalWidth,
          height: preloadImg.naturalHeight
        });
      };
      preloadImg.onerror = (_error) => {
        URL.revokeObjectURL(objectURL); // Cleanup on error too
        reject(new Error('Failed to preload image'));
      };
      preloadImg.src = objectURL; // Load from local blob (RAM) - instant!
    });
    
    // Calculate auto-scale (same logic as in createImageElement's onload handler)
    const maxDisplaySize = 350; // Maximum size for the larger dimension
    let finalScale = 1;
    if (dimensions.width > maxDisplaySize || dimensions.height > maxDisplaySize) {
      const maxDimension = Math.max(dimensions.width, dimensions.height);
      finalScale = maxDisplaySize / maxDimension;
    }
    

    // Создаем уникальное имя файла
    const timestamp = Date.now();
    const extension = file.type.split('/')[1] || 'png';
    const filename = `wbe-image-${timestamp}.${extension}`;

    // Создаем новый File объект
    const newFile = new File([file], filename, { type: file.type });

    // Загружаем файл (оптимизированный подход)
    let uploadResult;
    const isGM = game.user.isGM;
    const startTime = Date.now();

    if (isGM) {
      // GM: Try direct upload only
      try {
        let uploadMethod;
    
        // V12+ использует новый путь
        if (foundry.applications?.apps?.FilePicker?.implementation) {
            uploadMethod = foundry.applications.apps.FilePicker.implementation;
        } else {
            // V11 и ниже используют глобальный FilePicker
            uploadMethod = FilePicker;
        }
        
        uploadResult = await uploadMethod.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
        const directTime = Date.now() - startTime;
      } catch (error) {
        const directTime = Date.now() - startTime;
        console.error(`[WB-E] GM canvas upload failed after ${directTime}ms:`, error);
        throw new Error(`GM canvas upload failed: ${error.message}`);
      }
    } else {
      // Player: Try direct upload only (no timeout, no base64 fallback)
      try {
        
        let uploadMethod;
    
        // V12+ использует новый путь
        if (foundry.applications?.apps?.FilePicker?.implementation) {
            uploadMethod = foundry.applications.apps.FilePicker.implementation;
        } else {
            // V11 и ниже используют глобальный FilePicker
            uploadMethod = FilePicker;
        }
        uploadResult = await uploadMethod.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
        
        
        const directTime = Date.now() - startTime;
      } catch (error) {
        const directTime = Date.now() - startTime;
        console.error(`[WB-E] Player canvas direct upload failed after ${directTime}ms:`, error);
        throw new Error(`Player canvas upload failed: ${error.message}`);
      }
    }

    if (uploadResult && uploadResult.path) {
      // Конвертируем позицию курсора в world coordinates
      const { lastMouseX, lastMouseY } = getSharedVars();
      console.log(`[TEST] handleImagePasteFromClipboard: Received lastMouseX=${lastMouseX}, lastMouseY=${lastMouseY}`);
      const worldPos = screenToWorld(lastMouseX, lastMouseY);
      console.log(`[TEST] handleImagePasteFromClipboard: Converted to worldPos.x=${worldPos.x}, worldPos.y=${worldPos.y}`);

      // Calculate scaled dimensions to center image under cursor
      const scaledWidth = dimensions.width * finalScale;
      const scaledHeight = dimensions.height * finalScale;
      console.log(`[TEST] handleImagePasteFromClipboard: Image dimensions: width=${dimensions.width}, height=${dimensions.height}, scale=${finalScale}, scaledWidth=${scaledWidth}, scaledHeight=${scaledHeight}`);
      
      // Position image so its center is under cursor (not top-left corner)
      const centeredLeft = worldPos.x - scaledWidth / 2;
      const centeredTop = worldPos.y - scaledHeight / 2;
      console.log(`[TEST] handleImagePasteFromClipboard: Final position: left=${centeredLeft}, top=${centeredTop}`);

      // Создаем новое изображение с центром под курсором
      const imageId = `wbe-image-${timestamp}`;
      
      // DON'T pass displayWidth/displayHeight - let preload handle sizing
      createImageElement({
        id: imageId,
        src: uploadResult.path,
        left: centeredLeft,
        top: centeredTop,
        scale: finalScale, // Use calculated scale (not 1!)
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        maskType: 'rect',
        circleOffset: { x: 0, y: 0 },
        isFrozen: false
        // displayWidth/displayHeight will be set by preload callback
      });

      // Сохраняем в базу с правильными параметрами
      const images = await getAllImages();
      const container = document.getElementById(imageId);
      const permanentBorder = container?.querySelector('.wbe-image-permanent-border');
      const borderStyle = permanentBorder ? getImageBorderStyle(permanentBorder) : null;
      
      images[imageId] = {
        src: uploadResult.path,
        left: centeredLeft,
        top: centeredTop,
        scale: finalScale, // Save calculated scale (not 1!)
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        isFrozen: false,
        zIndex: ZIndexManager.get(imageId),
        rank: ZIndexManager.getRank(imageId),
        ...(borderStyle ? {
          borderHex: borderStyle.hex,
          borderOpacity: borderStyle.opacity,
          borderWidth: borderStyle.width,
          borderRadius: borderStyle.radius
        } : {})
        // displayWidth/displayHeight will be saved by saveImageState after image loads
      };
      await setAllImages(images);

    } else {
      ui.notifications.error("Image upload failed");
    }
  } catch (err) {
    console.error("[WB-E] Image paste error:", err);
    ui.notifications.error("Image paste error");
  }
}

// Utility function to clean up broken images from scene flags
async function cleanupBrokenImages() {
  if (!game.user.isGM) {
    ui.notifications.warn("Only GMs can clean up broken images");
    return;
  }

  const images = await getAllImages();
  const brokenImages = [];

  // Check each image in the scene flags
  for (const [id, data] of Object.entries(images)) {
    const element = document.getElementById(id);
    if (element) {
      const img = element.querySelector('.wbe-canvas-image');
      if (img && (img.style.background.includes('#ffcccc') || !img.complete || img.naturalWidth === 0)) {
        brokenImages.push(id);
      }
    } else if (!data.src || typeof data.src !== 'string') {
      brokenImages.push(id);
    }
  }

  if (brokenImages.length === 0) {
    return;
  }

  // Ask for confirmation
  const confirmed = await Dialog.confirm({
    title: "Clean Up Broken Images",
    content: `<p>Found ${brokenImages.length} broken image(s). Remove them from the scene?</p>
              <p><small>IDs: ${brokenImages.join(', ')}</small></p>`,
    yes: () => true,
    no: () => false
  });

  if (confirmed) {
    // Remove broken images from scene flags
    for (const id of brokenImages) {
      delete images[id];
      // Also remove from DOM if present
      const element = document.getElementById(id);
      if (element) element.remove();
    }

    await setAllImages(images);
  }
}

export const ImageTools = {
  // create/update
  createImageElement,
  updateImageElement,

  // storage
  getAllImages,
  setAllImages,
  persistImageState,

  // paste impl
  globalPasteImage,
  handleImagePasteFromClipboard,

  // locks (socket helpers)
  applyImageLockVisual,
  removeImageLockVisual,

  // selection infra
  installGlobalImageSelectionHandler,

  // state getters/setters (so main can read/write if ever needed)
  get selectedImageId() { return selectedImageId; },
  set selectedImageId(v) { selectedImageId = v; },

  get copiedImageData() { return copiedImageData; },
  set copiedImageData(v) { copiedImageData = v; },

  // if you need to poke local vars from sockets:
  updateImageLocalVars,
  getImageLocalVars,

  // freeze management
  setImageFrozen,
  isImageFrozen,

  // frozen selection functions
  showFrozenSelection,
  hideFrozenSelection,

  // frozen panel functions (kept for backward compatibility, but not used)
 
 
  handleUnfreezeAction,

  // frozen unfreeze icon functions
  showUnfreezeIcon,
  hideUnfreezeIcon,
  reinitializeUnfreezeIcons,

  // frozen canvas pass-through functions
  setupFrozenImageCanvasPassThrough,
  removeFrozenImageCanvasPassThrough,

  clearImageCaches,

  // utility functions
  cleanupBrokenImages,

  // crop/mask data management
  setImageCropData,
  getImageCropData

};
