/*********************************************************
 * Whiteboard Mass Selection System
 * Provides Foundry-style mass selection for text and image objects
 * 
 * Features:
 * - Ctrl+Click to select multiple objects
 * - Drag selection box to select multiple objects
 * - Keyboard shortcuts: Delete, Arrow keys, Ctrl+C/V, Escape
 * - Mass operations: move, delete, copy, paste
 * - Visual feedback with selection indicators
 * 
 * Usage:
 * 1. Hold Ctrl and click objects to select them
 * 2. Or drag a selection box around objects
 * 3. Use keyboard shortcuts for operations:
 *    - Delete: Remove selected objects
 *    - Arrow keys: Move selected objects
 *    - Ctrl+C: Copy selected objects
 *    - Ctrl+V: Paste copied objects
 *    - Escape: Clear selection
 *    - Ctrl+A: Select all objects
 *********************************************************/

import {
  MODID,
  FLAG_SCOPE,
  FLAG_KEY_TEXTS,
  FLAG_KEY_IMAGES,
  screenToWorld,
  worldToScreen,
  deselectAllElements,
  getOrCreateLayer,
  getSharedVars,
  ZIndexManager,
  ZIndexConstants
} from "../main.mjs";

// Import frozen image functions from image module
import { ImageTools } from "./whiteboard-image.mjs";

// Mass selection state
let massSelectionMode = false;
let selectedObjects = new Set(); // Set of object IDs
let selectionBox = null;
let boundingBox = null; // Bounding box around all selected objects
let selectionStartX = 0;
let selectionStartY = 0;
let isSelecting = false;
let toggleState = false; // false = Ctrl+drag, true = default drag

// Mass drag state
let massDragState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  startPositions: new Map()
};

// Visual styles for mass selection
// Generate mass selection CSS (called after imports resolve)
function generateMassSelectionCSS() {
  return `
  .wbe-mass-selection-box {
    position: fixed;
    border: 2px dashed #4a9eff;
    background: rgba(74, 158, 255, 0.1);
    pointer-events: none;
    z-index: ${ZIndexConstants.SELECTION_BOX};
    display: none;
  }
  
  .wbe-mass-selected {
    outline: 1px solid #4a9eff !important;
    outline-offset: 0px !important;
  }
  
  /* For images, apply mass selection border to the click target instead of container */
  .wbe-canvas-image-container.wbe-mass-selected .wbe-image-click-target {
    outline: 1px solid #4a9eff !important;
    outline-offset: 0px !important;
  }
  
  /* Remove outline from image container when mass selected */
  .wbe-canvas-image-container.wbe-mass-selected {
    outline: none !important;
  }
  
  .wbe-mass-selection-bounding-box {
    position: absolute;
    border: 1px solid #2c5aa0;
    background: rgba(44, 90, 160, 0.05);
    pointer-events: none;
    z-index: ${ZIndexConstants.BOUNDING_BOX};
    display: none;
    box-shadow: 0 0 0 1px rgba(44, 90, 160, 0.3);
  }
  
  .wbe-mass-selection-toggle-on {
    background: #4a9eff !important;
    color: white !important;
  }
  
  .wbe-mass-selection-toggle-off {
    background: #666 !important;
    color: white !important;
  }
  
  .wbe-mass-selection-indicator {
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: bold;
    z-index: ${ZIndexConstants.SELECTION_INDICATOR};
    display: none;
  }
  
  /* Transition effects for smooth deselection */
  .wbe-mass-selected {
    transition: outline 0.2s ease;
  }
  
  /* Ensure mass selection doesn't interfere with normal object selection */
  .wbe-canvas-text-container:not(.wbe-mass-selected),
  .wbe-canvas-image-container:not(.wbe-mass-selected) {
    outline: none !important;
  }
`;
}

// Inject CSS (called after imports resolve)
function injectMassSelectionStyles() {
  if (!document.getElementById("wbe-mass-selection-style")) {
    const style = document.createElement("style");
    style.id = "wbe-mass-selection-style";
    style.textContent = generateMassSelectionCSS();
    document.head.appendChild(style);
  }
}

// Inject CSS after imports resolve (init runs after imports but before ready)
Hooks.once("init", injectMassSelectionStyles);

/**
 * Initialize mass selection system
 */
function initializeMassSelection() {
  
  // Create selection box element
  createSelectionBox();
  
  // Create bounding box element
  createBoundingBox();
  
  // Create selection indicator
  createSelectionIndicator();
  
  // Install event listeners
  installEventListeners();
  
  // Register with Foundry's selection system
  registerWithFoundrySelection();
}

/**
 * Create the selection box element
 */
function createSelectionBox() {
  selectionBox = document.createElement("div");
  selectionBox.className = "wbe-mass-selection-box";
  selectionBox.id = "wbe-selection-box";
  document.body.appendChild(selectionBox);
}

/**
 * Create the bounding box element
 */
function createBoundingBox() {
  const layer = getOrCreateLayer();
  if (!layer) {
    console.warn("[WB-E] Layer not ready, deferring bounding box creation");
    // Retry after a short delay
    setTimeout(createBoundingBox, 100);
    return;
  }
  
  boundingBox = document.createElement("div");
  boundingBox.className = "wbe-mass-selection-bounding-box";
  boundingBox.id = "wbe-bounding-box";
  
  // Add to layer instead of document.body for proper transform inheritance
  layer.appendChild(boundingBox);
  
}

/**
 * Create the selection indicator
 */
function createSelectionIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "wbe-mass-selection-indicator";
  indicator.id = "wbe-selection-indicator";
  document.body.appendChild(indicator);
}

/**
 * Update the bounding box around all selected objects
 */
function updateBoundingBox() {
  if (!boundingBox) return;
  
  if (selectedObjects.size === 0) {
    boundingBox.style.display = "none";
    return;
  }
  
  // Safety check for canvas state
  if (!canvas?.ready) {
    boundingBox.style.display = "none";
    return;
  }
  
  const layer = getOrCreateLayer();
  if (!layer) return;
  
  // Get all selected objects
  const selectedContainers = Array.from(selectedObjects)
    .map(id => document.getElementById(id))
    .filter(Boolean);
  
  if (selectedContainers.length === 0) {
    boundingBox.style.display = "none";
    return;
  }
  
  // Calculate the bounding box in world coordinates (like text/images do)
  let minWorldX = Infinity, minWorldY = Infinity, maxWorldX = -Infinity, maxWorldY = -Infinity;
  
  selectedContainers.forEach(container => {
    // Get world coordinates from container's style (left/top are in world space)
    const worldX = parseFloat(container.style.left) || 0;
    const worldY = parseFloat(container.style.top) || 0;
    
    // Get the container's world dimensions using the same method as text/images
    const rect = container.getBoundingClientRect();
    const transform = layer.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    
    let worldWidth = rect.width / scale;
    let worldHeight = rect.height / scale;
    
    // For images, use the click target dimensions (which account for cropping and scaling)
    if (container.classList.contains("wbe-canvas-image-container")) {
      const clickTarget = container.querySelector(".wbe-image-click-target");
      if (clickTarget) {
        // Use the click target's actual dimensions (already cropped and scaled)
        const clickTargetRect = clickTarget.getBoundingClientRect();
        worldWidth = clickTargetRect.width / scale;
        worldHeight = clickTargetRect.height / scale;
      } else {
        // Fallback to image element if no click target
        const imageElement = container.querySelector(".wbe-canvas-image");
        if (imageElement) {
          const imageTransform = imageElement.style.transform || "";
          const imageScaleMatch = imageTransform.match(/scale\(([\d.]+)\)/);
          const imageScale = imageScaleMatch ? parseFloat(imageScaleMatch[1]) : 1;
          
          const baseWidth = imageElement.offsetWidth;
          const baseHeight = imageElement.offsetHeight;
          
          worldWidth = baseWidth * imageScale;
          worldHeight = baseHeight * imageScale;
        }
      }
    }
    
    minWorldX = Math.min(minWorldX, worldX);
    minWorldY = Math.min(minWorldY, worldY);
    maxWorldX = Math.max(maxWorldX, worldX + worldWidth);
    maxWorldY = Math.max(maxWorldY, worldY + worldHeight);
  });
  
  // Add some padding around the bounding box (in world coordinates)
  const padding = 4;
  const worldWidth = maxWorldX - minWorldX + (padding * 2);
  const worldHeight = maxWorldY - minWorldY + (padding * 2);
  
  // Position and size the bounding box in world coordinates (like text/images)
  // Let CSS transform handle the display transformation
  boundingBox.style.left = `${minWorldX - padding}px`;
  boundingBox.style.top = `${minWorldY - padding}px`;
  boundingBox.style.width = `${worldWidth}px`;
  boundingBox.style.height = `${worldHeight}px`;
  boundingBox.style.display = "block";
  
  // Ensure highest z-index to appear above all objects
  boundingBox.style.zIndex = String(ZIndexConstants.BOUNDING_BOX);
}

/**
 * Install event listeners for mass selection
 */
function installEventListeners() {
  // Install global click handler FIRST (highest priority)
  installGlobalClickHandler();
  
  // Install mass drag handler SECOND (intercepts individual drags)
  installMassDragHandler();
  
  // Mouse down - start selection
  document.addEventListener("mousedown", startBoundingBox, true);
  
  // Mouse move - update selection box
  document.addEventListener("mousemove", dragBoundingBox, true);
  
  // Mouse up - finish selection
  document.addEventListener("mouseup", releaseBoundingBox, true);
  
  // Keyboard shortcuts
  document.addEventListener("keydown", handleKeyDown, true);
  
  // Canvas events
  Hooks.on("canvasReady", () => {
    registerObjectsForMassSelection();
    
    // Recreate bounding box if layer was recreated
    if (!boundingBox || !boundingBox.parentNode) {
      createBoundingBox();
    }
  });
  
  // Re-register when new objects are added
  Hooks.on("renderSceneControls", () => {
    setTimeout(() => registerObjectsForMassSelection(), 100);
  });
  
  // No need to update bounding box during pan/zoom - it moves automatically with the layer
  // The bounding box is now a child of the layer and inherits its transform
}

/**
 * Handle clicks on mass-selected objects
 */
function handleMassSelectedObjectClick(e, clickedContainer) {
  // For mass-selected objects, we only allow:
  // 1. Mass dragging (handled by installMassDragHandler)
  // 2. Toggle selection (Ctrl+click to deselect from mass selection)
  
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+click: Toggle this object out of mass selection
    toggleObjectSelection(clickedContainer);
  }
  // Otherwise, do nothing - prevent individual selection
}

/**
 * Install global click handler for mass deselection
 */
function installGlobalClickHandler() {
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (massSelectionMode || isSelecting) return;
    
    // FIRST: Check if clicking inside mass selection bounding box
    if (selectedObjects.size > 0) {
      const boundingBox = document.getElementById("wbe-bounding-box");
      if (boundingBox && boundingBox.style.display !== "none") {
        const rect = boundingBox.getBoundingClientRect();
        const isInsideBoundingBox = (
          e.clientX >= rect.left && 
          e.clientX <= rect.right && 
          e.clientY >= rect.top && 
          e.clientY <= rect.bottom
        );
        
        if (isInsideBoundingBox) {
          // Clicked inside mass-selected area - start mass drag
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          startMassDrag(e);
          return;
        }
      }
    }
    
    // SECOND: Check if clicking on mass-selected objects (fallback)
    const clickedContainer = e.target.closest(".wbe-canvas-text-container, .wbe-canvas-image-container");
    if (!clickedContainer) {
      if (selectedObjects.size > 0) {
        // FIX: Only deselect if clicking OUTSIDE bounding box
        const boundingBox = document.getElementById("wbe-bounding-box");
        if (boundingBox && boundingBox.style.display !== "none") {
          const rect = boundingBox.getBoundingClientRect();
          const isOutsideBoundingBox = (
            e.clientX < rect.left || 
            e.clientX > rect.right || 
            e.clientY < rect.top || 
            e.clientY > rect.bottom
          );
          
          if (isOutsideBoundingBox) {
            deselectAllElements(); // Use clear() instead of deselectAllElements()
          }
        } else {
          // No bounding box visible - safe to clear
          deselectAllElements();
        }
      }
      return;
    }
  }, true);
}

/**
 * Install mass drag handler for selected objects
 */
function installMassDragHandler() {
  document.addEventListener("mousedown", (e) => {
    // Only handle left mouse button
    if (e.button !== 0) return;
    
    // Check if clicking on a mass-selected object
    const clickedContainer = e.target.closest(".wbe-canvas-text-container, .wbe-canvas-image-container");
    if (!clickedContainer) return;
    
    // Check if this object is mass-selected
    if (!selectedObjects.has(clickedContainer.id)) return;
    
    // Check if we should start mass dragging based on toggle state
    const shouldStartMassDrag = toggleState ? 
      true : // Default mode - always start mass drag
      (e.ctrlKey || e.metaKey); // Ctrl mode - only with Ctrl
    
    e.preventDefault();
    e.stopPropagation();

    if (shouldStartMassDrag) {
      e.preventDefault();
      e.stopPropagation();
      
      startMassDrag(e);
    }
  }, true); // Use capture phase to intercept before individual handlers
}

/**
 * Start mass drag operation
 */
function startMassDrag(e) {
  massDragState = {
    isDragging: true,
    startX: e.clientX,
    startY: e.clientY,
    startPositions: new Map() // Store initial positions of all selected objects
  };
  canvas.controls.select.visible = false;
  // Store initial positions of all selected objects
  selectedObjects.forEach(id => {
    const container = document.getElementById(id);
    if (container) {
      massDragState.startPositions.set(id, {
        left: parseFloat(container.style.left) || 0,
        top: parseFloat(container.style.top) || 0
      });
    }
  });
  
  // Add global mouse move and mouse up handlers
  document.addEventListener("mousemove", handleMassDragMove, true);
  document.addEventListener("mouseup", handleMassDragEnd, true);
  
  // Change cursor to indicate mass dragging
  document.body.style.cursor = "move";
}

/**
 * Handle mass drag move
 */
function handleMassDragMove(e) {
  if (!massDragState.isDragging) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  // Calculate delta from start position
  const deltaX = e.clientX - massDragState.startX;
  const deltaY = e.clientY - massDragState.startY;
  
  // Convert screen delta to world delta (account for canvas scale)
  const layer = getOrCreateLayer();
  const transform = layer?.style?.transform || "";
  const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
  const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
  
  const worldDeltaX = deltaX / scale;
  const worldDeltaY = deltaY / scale;
  
  // Update positions of all selected objects
  selectedObjects.forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    
    const startPos = massDragState.startPositions.get(id);
    if (startPos) {
      container.style.left = `${startPos.left + worldDeltaX}px`;
      container.style.top = `${startPos.top + worldDeltaY}px`;
    }
  });
  
  // Update selection indicator position
  updateSelectionIndicator();
  // Update bounding box position
  updateBoundingBox();
}

/**
 * Handle mass drag end
 */
async function handleMassDragEnd(e) {
  if (!massDragState.isDragging) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  canvas.controls.select.visible = true;

  // Clean up drag state
  massDragState.isDragging = false;
  massDragState.startPositions.clear();
  
  // Remove global handlers
  document.removeEventListener("mousemove", handleMassDragMove, true);
  document.removeEventListener("mouseup", handleMassDragEnd, true);
  
  // Restore cursor
  document.body.style.cursor = "";
  
  // Save changes to scene flags and send updates to other users
  await saveSelectedObjectsWithUpdates();
  
}



// REMOVED: Object click handlers - now integrated into existing text/image selection systems
// The existing onDocMouseDown (text) and installGlobalImageSelectionHandler (image) 
// now check for mass selection and clear it before proceeding with normal selection

/**
 * Handle mouse down bounding box events
 */
function startBoundingBox(e) {
  // Only handle left mouse button
  if (e.button !== 0) return;
  
  
  // Don't interfere with existing object interactions
  if (e.target.closest(".wbe-canvas-text-container") || 
      e.target.closest(".wbe-canvas-image-container") ||
      e.target.closest(".wbe-color-picker-panel")) {
    return;
  }

  
  
  // Check if we should start mass selection based on toggle state
  const shouldStartSelection = toggleState ? 
    true : // Default drag mode - always start selection
    (e.ctrlKey || e.metaKey); // Ctrl+drag mode - only with Ctrl
  
  if (shouldStartSelection) {
    e.preventDefault();
    e.stopPropagation();
    
    massSelectionMode = true;
    isSelecting = true;
    selectionStartX = e.clientX;
    selectionStartY = e.clientY;
    
    // Show selection box
    selectionBox.style.display = "block";
    selectionBox.style.left = `${e.clientX}px`;
    selectionBox.style.top = `${e.clientY}px`;
    selectionBox.style.width = "0px";
    selectionBox.style.height = "0px";
    
    // Show indicator
    updateSelectionIndicator();
  }
}

/**
 * Handle mouse move bounding box events
 */
function dragBoundingBox(e) {
  if (!isSelecting || !massSelectionMode) return;
  
  const currentX = e.clientX;
  const currentY = e.clientY;
  
  // Update selection box
  const left = Math.min(selectionStartX, currentX);
  const top = Math.min(selectionStartY, currentY);
  const width = Math.abs(currentX - selectionStartX);
  const height = Math.abs(currentY - selectionStartY);
  
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
  
  // Update selection based on box
  updateSelectionFromBox(left, top, width, height);
}

/**
 * Handle mouse up bounding box events
 */
function releaseBoundingBox(e) {
  if (!isSelecting || !massSelectionMode) return;
  
  isSelecting = false;
  massSelectionMode = false;
  
  // Hide selection box
  selectionBox.style.display = "none";
  
  // Check if only one object is selected
  if (selectedObjects.size === 1) {
    // Convert mass selection to regular selection
    const selectedId = Array.from(selectedObjects)[0];
    const container = document.getElementById(selectedId);
    
    if (container) {
      // Remove mass-selected class BEFORE clearing to allow selection
      container.classList.remove("wbe-mass-selected");
      
      // Clean up any active mass drag
      if (massDragState.isDragging) {
        massDragState.isDragging = false;
        massDragState.startPositions.clear();
        document.removeEventListener("mousemove", handleMassDragMove, true);
        document.removeEventListener("mouseup", handleMassDragEnd, true);
        document.body.style.cursor = "";
      }
      
      // Clear mass selection state (but container class already removed above)
      selectedObjects.clear();
      updateSelectionIndicator();
      updateBoundingBox();
      
      // Use setTimeout to ensure DOM updates and event handlers are ready
      setTimeout(() => {
        // Trigger regular selection based on object type
        if (container.classList.contains("wbe-canvas-text-container")) {
          // For text, simulate a click on the text element
          const textElement = container.querySelector(".wbe-canvas-text");
          if (textElement) {
            // Create a synthetic click event with proper coordinates
            const rect = container.getBoundingClientRect();
            const clickEvent = new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              button: 0,
              view: window
            });
            textElement.dispatchEvent(clickEvent);
          }
        } else if (container.classList.contains("wbe-canvas-image-container")) {
          // For images, simulate a click on the click target
          const clickTarget = container.querySelector(".wbe-image-click-target");
          if (clickTarget) {
            // Create a synthetic click event with proper coordinates
            const rect = container.getBoundingClientRect();
            const clickEvent = new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              button: 0,
              view: window
            });
            clickTarget.dispatchEvent(clickEvent);
          }
        }
      }, 0);
    }
  } else {
    // Multiple objects selected - keep mass selection
    updateSelectionIndicator();
  }
}

/**
 * Update selection based on selection box
 */
function updateSelectionFromBox(left, top, width, height) {
  const layer = getOrCreateLayer();
  if (!layer) return;
  
  // Get all selectable objects
  const textContainers = layer.querySelectorAll(".wbe-canvas-text-container");
  const imageContainers = layer.querySelectorAll(".wbe-canvas-image-container");
  const allContainers = [...textContainers, ...imageContainers];
  
  // Clear current selection
  selectedObjects.clear();
  
  // Check which objects intersect with selection box
  allContainers.forEach(container => {
    // Skip frozen images
    if (container.classList.contains("wbe-canvas-image-container") && ImageTools.isImageFrozen(container.id)) {
      return; // Skip frozen images completely
    }
    
    const rect = container.getBoundingClientRect();
    
    // For images, check if the selection box intersects with the click target area (cropped and scaled)
    if (container.classList.contains("wbe-canvas-image-container")) {
      const clickTarget = container.querySelector(".wbe-image-click-target");
      if (clickTarget) {
        // Use the click target's actual position and dimensions (already cropped and scaled)
        const clickTargetRect = clickTarget.getBoundingClientRect();
        
        // Check if selection box intersects with the click target area
        if (clickTargetRect.left < left + width && 
            clickTargetRect.right > left && 
            clickTargetRect.top < top + height && 
            clickTargetRect.bottom > top) {
          
          selectedObjects.add(container.id);
          container.classList.add("wbe-mass-selected");
        } else {
          container.classList.remove("wbe-mass-selected");
        }
        return;
      } else {
        // Fallback to image element if no click target
        const imageElement = container.querySelector(".wbe-canvas-image");
        if (imageElement) {
          const imageTransform = imageElement.style.transform || "";
          const imageScaleMatch = imageTransform.match(/scale\(([\d.]+)\)/);
          const imageScale = imageScaleMatch ? parseFloat(imageScaleMatch[1]) : 1;
          
          const baseWidth = imageElement.offsetWidth;
          const baseHeight = imageElement.offsetHeight;
          
          const scaledWidth = baseWidth * imageScale;
          const scaledHeight = baseHeight * imageScale;
          
          const imageLeft = rect.left + (rect.width - scaledWidth) / 2;
          const imageTop = rect.top + (rect.height - scaledHeight) / 2;
          const imageRight = imageLeft + scaledWidth;
          const imageBottom = imageTop + scaledHeight;
          
          if (imageLeft < left + width && 
              imageRight > left && 
              imageTop < top + height && 
              imageBottom > top) {
            
            selectedObjects.add(container.id);
            container.classList.add("wbe-mass-selected");
          } else {
            container.classList.remove("wbe-mass-selected");
          }
          return;
        }
      }
    }
    
    // For text and unscaled images, use the container's bounding rect
    if (rect.left < left + width && 
        rect.right > left && 
        rect.top < top + height && 
        rect.bottom > top) {
      
      selectedObjects.add(container.id);
      container.classList.add("wbe-mass-selected");
    } else {
      container.classList.remove("wbe-mass-selected");
    }
  });
  
  // Update bounding box
  updateBoundingBox();
}

/**
 * Handle keyboard shortcuts
 */
async function handleKeyDown(e) {
  // Only handle if we have selected objects
  if (selectedObjects.size === 0) return;
  
  // Z-index controls for mass selection
  if (e.key === '[' || e.key === 'PageDown') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const objectIds = Array.from(selectedObjects);
    
    // For single selection, use moveDown() instead of moveDownGroup()
    if (objectIds.length === 1) {
      const objectId = objectIds[0];
      const oldZIndex = ZIndexManager.get(objectId);
      const result = ZIndexManager.moveDown(objectId);
      
      if (result.success) {
        const change = result.changes[0];
        const objectType = objectId.startsWith('wbe-text-') ? 'TEXT' : objectId.startsWith('wbe-image-') ? 'IMAGE' : 'UNKNOWN';
        console.log(`[Z-Index] SINGLE SELECTION | ${objectType} | ID: ${objectId} | z-index: ${oldZIndex} → ${change.newZIndex}`);
        
        if (result.swappedWith) {
          console.log(`    ↳ Swapped with: ${result.swappedWith.id} → z-index: ${result.swappedWith.newZIndex}`);
        }
        
        // Persist swapped occupant if any
        const { TextTools } = await import("./whiteboard-text.mjs");
        const { ImageTools } = await import("./whiteboard-image.mjs");
        
        if (result.swappedWith) {
          const swappedContainer = document.getElementById(result.swappedWith.id);
          if (swappedContainer) {
            if (swappedContainer.classList.contains("wbe-canvas-text-container")) {
              const swappedTextElement = swappedContainer.querySelector(".wbe-canvas-text");
              if (swappedTextElement) {
                const texts = await TextTools.getAllTexts();
                if (texts[result.swappedWith.id]) {
                  texts[result.swappedWith.id].zIndex = result.swappedWith.newZIndex;
                  await TextTools.persistTextState(result.swappedWith.id, swappedTextElement, swappedContainer);
                }
              }
            } else if (swappedContainer.classList.contains("wbe-canvas-image-container")) {
              const images = await ImageTools.getAllImages();
              if (images[result.swappedWith.id]) {
                images[result.swappedWith.id].zIndex = result.swappedWith.newZIndex;
                await ImageTools.setAllImages(images);
              }
            }
          }
        }
        
        // Save selected object
        await saveSelectedObjectsWithUpdates();
      }
      return;
    }
    
    // Multi-selection: use moveDownGroup()
    const oldZIndexes = objectIds.map(id => ZIndexManager.get(id));
    const results = ZIndexManager.moveDownGroup(objectIds);
    
    // Collect all swapped objects
    const swappedObjects = new Map(); // id -> newZIndex
    
    // Log all objects and collect swaps
    console.log(`[Z-Index] MASS SELECTION | ${objectIds.length} object(s) | (moved down):`);
    objectIds.forEach((id, index) => {
      const result = results[index];
      const objectType = id.startsWith('wbe-text-') ? 'TEXT' : id.startsWith('wbe-image-') ? 'IMAGE' : 'UNKNOWN';
      
      if (result.success) {
        const change = result.changes[0];
        console.log(`  ${objectType} | ID: ${id} | z-index: ${oldZIndexes[index]} → ${change.newZIndex}`);
        
        // FIX #2 & #3: Track swapped objects for DOM update and persistence
        if (result.swappedWith) {
          swappedObjects.set(result.swappedWith.id, result.swappedWith.newZIndex);
          console.log(`    ↳ Swapped with: ${result.swappedWith.id} → z-index: ${result.swappedWith.newZIndex}`);
        }
      } else {
        console.log(`  ${objectType} | ID: ${id} | Cannot move down - ${result.reason}`);
      }
    });
    
    // DOM already updated by CompactZIndexManager.set() via _syncDOMZIndex()
    // No need to manually update DOM
    
    // FIX #2: Update DOM for all swapped objects
    // FIX #3: Persist all swapped objects
    const { TextTools } = await import("./whiteboard-text.mjs");
    const { ImageTools } = await import("./whiteboard-image.mjs");
    
    const texts = await TextTools.getAllTexts();
    const images = await ImageTools.getAllImages();
    
    for (const [swappedId, swappedZIndex] of swappedObjects) {
      const swappedContainer = document.getElementById(swappedId);
      if (swappedContainer) {
        // DOM already updated by CompactZIndexManager.set() via _syncDOMZIndex()
        // Persist swapped object
        if (swappedContainer.classList.contains("wbe-canvas-text-container")) {
          const swappedTextElement = swappedContainer.querySelector(".wbe-canvas-text");
          if (swappedTextElement && texts[swappedId]) {
            texts[swappedId].zIndex = swappedZIndex;
            await TextTools.persistTextState(swappedId, swappedTextElement, swappedContainer);
          }
        } else if (swappedContainer.classList.contains("wbe-canvas-image-container")) {
          if (images[swappedId]) {
            images[swappedId].zIndex = swappedZIndex;
          }
        }
      }
    }
    
    // Save images if any were swapped
    if (swappedObjects.size > 0 && Array.from(swappedObjects.keys()).some(id => id.startsWith('wbe-image-'))) {
      await ImageTools.setAllImages(images);
    }
    
    // Save selected objects
    await saveSelectedObjectsWithUpdates();
    return;
  }
  
  if (e.key === ']' || e.key === 'PageUp') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const objectIds = Array.from(selectedObjects);
    
    // For single selection, use moveUp() instead of moveUpGroup()
    if (objectIds.length === 1) {
      const objectId = objectIds[0];
      const oldZIndex = ZIndexManager.get(objectId);
      const result = ZIndexManager.moveUp(objectId);
      
      if (result.success) {
        const change = result.changes[0];
        const objectType = objectId.startsWith('wbe-text-') ? 'TEXT' : objectId.startsWith('wbe-image-') ? 'IMAGE' : 'UNKNOWN';
        console.log(`[Z-Index] SINGLE SELECTION | ${objectType} | ID: ${objectId} | z-index: ${oldZIndex} → ${change.newZIndex}`);
        
        if (result.swappedWith) {
          console.log(`    ↳ Swapped with: ${result.swappedWith.id} → z-index: ${result.swappedWith.newZIndex}`);
        }
        
        // Persist swapped occupant if any
        const { TextTools } = await import("./whiteboard-text.mjs");
        const { ImageTools } = await import("./whiteboard-image.mjs");
        
        if (result.swappedWith) {
          const swappedContainer = document.getElementById(result.swappedWith.id);
          if (swappedContainer) {
            if (swappedContainer.classList.contains("wbe-canvas-text-container")) {
              const swappedTextElement = swappedContainer.querySelector(".wbe-canvas-text");
              if (swappedTextElement) {
                const texts = await TextTools.getAllTexts();
                if (texts[result.swappedWith.id]) {
                  texts[result.swappedWith.id].zIndex = result.swappedWith.newZIndex;
                  await TextTools.persistTextState(result.swappedWith.id, swappedTextElement, swappedContainer);
                }
              }
            } else if (swappedContainer.classList.contains("wbe-canvas-image-container")) {
              const images = await ImageTools.getAllImages();
              if (images[result.swappedWith.id]) {
                images[result.swappedWith.id].zIndex = result.swappedWith.newZIndex;
                await ImageTools.setAllImages(images);
              }
            }
          }
        }
        
        // Save selected object
        await saveSelectedObjectsWithUpdates();
      }
      return;
    }
    
    // Multi-selection: use moveUpGroup()
    const oldZIndexes = objectIds.map(id => ZIndexManager.get(id));
    const results = ZIndexManager.moveUpGroup(objectIds);
    
    // Collect all swapped objects
    const swappedObjects = new Map(); // id -> newZIndex
    
    // Log all objects and collect swaps
    console.log(`[Z-Index] MASS SELECTION | ${objectIds.length} object(s) | (moved up):`);
    objectIds.forEach((id, index) => {
      const result = results[index];
      const objectType = id.startsWith('wbe-text-') ? 'TEXT' : id.startsWith('wbe-image-') ? 'IMAGE' : 'UNKNOWN';
      
      if (result.success) {
        const change = result.changes[0];
        console.log(`  ${objectType} | ID: ${id} | z-index: ${oldZIndexes[index]} → ${change.newZIndex}`);
        
        // FIX #2 & #3: Track swapped objects for DOM update and persistence
        if (result.swappedWith) {
          swappedObjects.set(result.swappedWith.id, result.swappedWith.newZIndex);
          console.log(`    ↳ Swapped with: ${result.swappedWith.id} → z-index: ${result.swappedWith.newZIndex}`);
        }
      } else {
        console.log(`  ${objectType} | ID: ${id} | Cannot move up - ${result.reason}`);
      }
    });
    
    // DOM already updated by CompactZIndexManager.set() via _syncDOMZIndex()
    // No need to manually update DOM
    
    // FIX #2: Update DOM for all swapped objects
    // FIX #3: Persist all swapped objects
    const { TextTools } = await import("./whiteboard-text.mjs");
    const { ImageTools } = await import("./whiteboard-image.mjs");
    
    const texts = await TextTools.getAllTexts();
    const images = await ImageTools.getAllImages();
    
    for (const [swappedId, swappedZIndex] of swappedObjects) {
      const swappedContainer = document.getElementById(swappedId);
      if (swappedContainer) {
        // DOM already updated by CompactZIndexManager.set() via _syncDOMZIndex()
        // Persist swapped object
        if (swappedContainer.classList.contains("wbe-canvas-text-container")) {
          const swappedTextElement = swappedContainer.querySelector(".wbe-canvas-text");
          if (swappedTextElement && texts[swappedId]) {
            texts[swappedId].zIndex = swappedZIndex;
            await TextTools.persistTextState(swappedId, swappedTextElement, swappedContainer);
          }
        } else if (swappedContainer.classList.contains("wbe-canvas-image-container")) {
          if (images[swappedId]) {
            images[swappedId].zIndex = swappedZIndex;
          }
        }
      }
    }
    
    // Save images if any were swapped
    if (swappedObjects.size > 0 && Array.from(swappedObjects.keys()).some(id => id.startsWith('wbe-image-'))) {
      await ImageTools.setAllImages(images);
    }
    
    // Save selected objects
    await saveSelectedObjectsWithUpdates();
    return;
  }
  
  // Delete selected objects
  if (e.key === "Delete") {
    e.preventDefault();
    massDeleteSelected();
  }
  
  // Arrow keys for movement
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    
    let deltaX = 0, deltaY = 0;
    switch(e.key) {
      case "ArrowUp": deltaY = -step; break;
      case "ArrowDown": deltaY = step; break;
      case "ArrowLeft": deltaX = -step; break;
      case "ArrowRight": deltaX = step; break;
    }
    
    massMoveSelected(deltaX, deltaY);
  }
  
  // Copy selected objects
  if ((e.ctrlKey || e.metaKey) && e.key === "c") {
    e.preventDefault();
    copySelectedObjects();
  }
  
  // Paste copied objects
  if ((e.ctrlKey || e.metaKey) && e.key === "v") {
    e.preventDefault();
    pasteCopiedObjects();
  }
  
  // Escape to clear selection
  if (e.key === "Escape") {
    clearMassSelection();
  }
  
  // Ctrl+A to select all
  if ((e.ctrlKey || e.metaKey) && e.key === "a") {
    e.preventDefault();
    selectAllObjects();
  }
}

/**
 * Register objects for mass selection
 */
function registerObjectsForMassSelection() {
  const layer = getOrCreateLayer();
  if (!layer) return;
  
  // Get all text and image containers
  const textContainers = layer.querySelectorAll(".wbe-canvas-text-container");
  const imageContainers = layer.querySelectorAll(".wbe-canvas-image-container");
  const allContainers = [...textContainers, ...imageContainers];
  
  // REMOVED: Object click handlers - now handled by existing text/image selection systems
  // The existing onDocMouseDown (text) and installGlobalImageSelectionHandler (image) 
  // now check for mass selection and clear it before proceeding with normal selection
}

/**
 * Toggle object selection
 */
function toggleObjectSelection(container) {
  const isSelected = selectedObjects.has(container.id);
  
  if (isSelected) {
    selectedObjects.delete(container.id);
    container.classList.remove("wbe-mass-selected");
  } else {
    selectedObjects.add(container.id);
    container.classList.add("wbe-mass-selected");
  }
  
  updateSelectionIndicator();
  updateBoundingBox();
}

/**
 * Select all objects
 */
function selectAllObjects() {
  const layer = getOrCreateLayer();
  if (!layer) return;
  
  // Clear current selection
  clearMassSelection();
  
  // Get all objects
  const textContainers = layer.querySelectorAll(".wbe-canvas-text-container");
  const imageContainers = layer.querySelectorAll(".wbe-canvas-image-container");
  const allContainers = [...textContainers, ...imageContainers];
  
  // Select all
  allContainers.forEach(container => {
    // Skip frozen images
    if (container.classList.contains("wbe-canvas-image-container") && ImageTools.isImageFrozen(container.id)) {
      return; // Skip frozen images completely
    }
    
    selectedObjects.add(container.id);
    container.classList.add("wbe-mass-selected");
  });
  
  updateSelectionIndicator();
  updateBoundingBox();
}

/**
 * Clear mass selection
 */
function clearMassSelection() {
  // Clean up any active mass drag
  if (massDragState.isDragging) {
    massDragState.isDragging = false;
    massDragState.startPositions.clear();
    document.removeEventListener("mousemove", handleMassDragMove, true);
    document.removeEventListener("mouseup", handleMassDragEnd, true);
    document.body.style.cursor = "";
  }
  
  selectedObjects.forEach(id => {
    const container = document.getElementById(id);
    if (container) {
      container.classList.remove("wbe-mass-selected");
    }
  });
  
  selectedObjects.clear();
  updateSelectionIndicator();
  updateBoundingBox();
  
  // Restore normal object selection behavior
  restoreNormalSelection();
}

/**
 * Restore normal object selection behavior
 */
function restoreNormalSelection() {
  // Clear any existing individual selections
  deselectAllElements();
  
  // This ensures that when mass selection is cleared,
  // objects return to their normal selection state
}

/**
 * Get selected objects
 */
function getSelectedObjects() {
  return Array.from(selectedObjects).map(id => document.getElementById(id)).filter(Boolean);
}

/**
 * Mass delete selected objects
 */
async function massDeleteSelected() {
  if (selectedObjects.size === 0) return;
  
  try {
    // Import TextTools and ImageTools dynamically to avoid circular imports
    const { TextTools } = await import("./whiteboard-text.mjs");
    const { ImageTools } = await import("./whiteboard-image.mjs");
    
    // Get current state of all texts and images
    const texts = await TextTools.getAllTexts();
    const images = await ImageTools.getAllImages();
    
    // Remove selected objects from the data
    selectedObjects.forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      
      if (container.classList.contains("wbe-canvas-text-container")) {
        // Remove from texts data
        delete texts[id];
        // Clean up z-index
        ZIndexManager.remove(id);
        // Remove from DOM
        container.remove();
      } else if (container.classList.contains("wbe-canvas-image-container")) {
        // Remove from images data
        delete images[id];
        // Clean up z-index
        ZIndexManager.remove(id);
        // Remove from DOM
        container.remove();
      }
    });
    
    // Save all texts and images with socket updates
    await TextTools.setAllTexts(texts);
    await ImageTools.setAllImages(images);
    
    // Clear selection
    clearMassSelection();
    
    ui.notifications.info(`Deleted ${selectedObjects.size} objects`);
    
  } catch (error) {
    console.error("[WB-E] Error deleting selected objects:", error);
  }
}


/**
 * Mass move selected objects
 */
function massMoveSelected(deltaX, deltaY) {
  if (selectedObjects.size === 0) return;
  
  
  selectedObjects.forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    
    const currentLeft = parseFloat(container.style.left) || 0;
    const currentTop = parseFloat(container.style.top) || 0;
    
    container.style.left = `${currentLeft + deltaX}px`;
    container.style.top = `${currentTop + deltaY}px`;
  });
  
  // Update bounding box position
  updateBoundingBox();
  
  // Save changes
  saveSelectedObjects();
}

/**
 * Save selected objects with proper socket updates using existing individual object system
 */
async function saveSelectedObjectsWithUpdates() {
  if (selectedObjects.size === 0) return;
  
  try {
    // Import TextTools and ImageTools dynamically to avoid circular imports
    const { TextTools } = await import("./whiteboard-text.mjs");
    const { ImageTools } = await import("./whiteboard-image.mjs");
    
    // Get current state of all texts and images
    const texts = await TextTools.getAllTexts();
    const images = await ImageTools.getAllImages();
    
    // Update the positions of selected objects
    selectedObjects.forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      
      if (container.classList.contains("wbe-canvas-text-container")) {
        const textElement = container.querySelector(".wbe-canvas-text");
        if (textElement && texts[id]) {
          // Update the text data with new position and z-index
          texts[id].left = parseFloat(container.style.left) || 0;
          texts[id].top = parseFloat(container.style.top) || 0;
          texts[id].zIndex = parseInt(container.style.zIndex) || ZIndexManager.get(id);
        }
      } else if (container.classList.contains("wbe-canvas-image-container")) {
        const imageElement = container.querySelector(".wbe-canvas-image");
        if (imageElement && images[id]) {
          // Update the image data with new position and z-index
          images[id].left = parseFloat(container.style.left) || 0;
          images[id].top = parseFloat(container.style.top) || 0;
          images[id].zIndex = parseInt(container.style.zIndex) || ZIndexManager.get(id);
        }
      }
    });
    
    // Save all texts and images with socket updates
    await TextTools.setAllTexts(texts);
    await ImageTools.setAllImages(images);
    
  } catch (error) {
    console.error("[WB-E] Error saving selected objects with updates:", error);
  }
}

/**
 * Save selected objects to scene flags
 */
async function saveSelectedObjects() {
  if (!game.user.isGM) return;
  
  try {
    // Save text objects
    const texts = await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_TEXTS) || {};
    const images = await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_IMAGES) || {};
    
    selectedObjects.forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      
      if (container.classList.contains("wbe-canvas-text-container")) {
        const textElement = container.querySelector(".wbe-canvas-text");
        if (textElement) {
          texts[id] = {
            text: textElement.textContent,
            left: parseFloat(container.style.left) || 0,
            top: parseFloat(container.style.top) || 0,
            scale: parseFloat(textElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1,
            color: textElement.style.color || "#000000",
            backgroundColor: textElement.style.backgroundColor || "#ffffff",
            // Add other properties as needed
          };
        }
      } else if (container.classList.contains("wbe-canvas-image-container")) {
        const imageElement = container.querySelector(".wbe-canvas-image");
        if (imageElement) {
          images[id] = {
            src: imageElement.src,
            left: parseFloat(container.style.left) || 0,
            top: parseFloat(container.style.top) || 0,
            scale: parseFloat(imageElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1,
            isFrozen: ImageTools.isImageFrozen(id),
            zIndex: ZIndexManager.get(id),
            // Add other properties as needed
          };
        }
      }
    });
    
    // Save to scene flags
    await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, texts);
    await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, images);
    
  } catch (error) {
    console.error("[WB-E] Error saving selected objects:", error);
  }
}

/**
 * Update selection indicator
 */
function updateSelectionIndicator() {
  const indicator = document.getElementById("wbe-selection-indicator");
  if (!indicator) return;
  
  if (selectedObjects.size > 0) {
    indicator.textContent = `${selectedObjects.size} objects selected`;
    indicator.style.display = "block";
  } else {
    indicator.style.display = "none";
  }
}

/**
 * Register with Foundry's selection system
 */
function registerWithFoundrySelection() {
  // Override Foundry's selection behavior for our objects
  if (canvas?.tokens) {
    // Hook into Foundry's token selection system
    Hooks.on("canvasPan", () => {
      // Update selection indicator position during pan
      updateSelectionIndicator();
    });
  }
}

/**
 * Copy selected objects
 */
function copySelectedObjects() {
  if (selectedObjects.size === 0) return;
  
  const copiedData = {
    texts: {},
    images: {}
  };
  
  selectedObjects.forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    
    if (container.classList.contains("wbe-canvas-text-container")) {
      const textElement = container.querySelector(".wbe-canvas-text");
      if (textElement) {
        copiedData.texts[id] = {
          text: textElement.textContent,
          left: parseFloat(container.style.left) || 0,
          top: parseFloat(container.style.top) || 0,
          scale: parseFloat(textElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1,
          color: textElement.style.color || "#000000",
          backgroundColor: textElement.style.backgroundColor || "#ffffff",
        };
      }
    } else if (container.classList.contains("wbe-canvas-image-container")) {
      const imageElement = container.querySelector(".wbe-canvas-image");
      if (imageElement) {
        copiedData.images[id] = {
          src: imageElement.src,
          left: parseFloat(container.style.left) || 0,
          top: parseFloat(container.style.top) || 0,
          scale: parseFloat(imageElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1,
          isFrozen: ImageTools.isImageFrozen(id),
        };
      }
    }
  });
  
  // Store in global variable for paste
  window.wbeCopiedMultiSelection = copiedData;
  
  ui.notifications.info(`Copied ${selectedObjects.size} objects`);
}

/**
 * Paste copied objects
 */
async function pasteCopiedObjects() {
  if (!window.wbeCopiedMultiSelection) return;
  
  const { texts, images } = window.wbeCopiedMultiSelection;
  const offset = 20; // Offset for pasted objects
  
  // Get current mouse position
  const { lastMouseX, lastMouseY } = getSharedVars();
  const worldPos = screenToWorld(lastMouseX, lastMouseY);
  
  // Import TextTools and ImageTools dynamically to avoid circular imports
  const { TextTools } = await import("./whiteboard-text.mjs");
  const { ImageTools } = await import("./whiteboard-image.mjs");
  
  // Paste texts
  for (const [id, textData] of Object.entries(texts)) {
    const newId = `wbe-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newLeft = worldPos.x + (textData.left || 0) + offset;
    const newTop = worldPos.y + (textData.top || 0) + offset;
    
    // Create new text element using TextTools
    const container = TextTools.createTextElement(
      newId,
      textData.text,
      newLeft,
      newTop,
      textData.scale,
      textData.color,
      textData.backgroundColor,
      textData.borderColor,
      textData.borderWidth,
      textData.fontWeight,
      textData.fontStyle,
      textData.textAlign,
      textData.fontFamily,
      textData.fontSize,
      textData.width
    );
    
    if (container) {
      // Save to scene flags
      await TextTools.persistTextState(newId, container.querySelector(".wbe-canvas-text"), container);
    }
  }
  
  // Paste images
  for (const [id, imageData] of Object.entries(images)) {
    const newId = `wbe-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newLeft = worldPos.x + (imageData.left || 0) + offset;
    const newTop = worldPos.y + (imageData.top || 0) + offset;
    
    // Create new image element using ImageTools
    const container = ImageTools.createImageElement(
      newId,
      imageData.src,
      newLeft,
      newTop,
      imageData.scale,
      imageData.crop,
      imageData.maskType,
      imageData.circleOffset,
      imageData.circleRadius
    );
    
    if (container) {
      // Save to scene flags
      await ImageTools.persistImageState(newId, container.querySelector(".wbe-canvas-image"), container);
    }
  }
  
  ui.notifications.info(`Pasted ${Object.keys(texts).length + Object.keys(images).length} objects`);
}

/**
 * Set toggle state for mass selection behavior
 */
function setToggleState(state) {
  toggleState = state;
}

// Export the mass selection system
export const MassSelection = {
  initialize: initializeMassSelection,
  selectAll: selectAllObjects,
  clear: clearMassSelection,
  getSelected: getSelectedObjects,
  copy: copySelectedObjects,
  paste: pasteCopiedObjects,
  delete: massDeleteSelected,
  move: massMoveSelected,
  setToggleState: setToggleState,
  
  // Deselection functions
  restoreNormalSelection: restoreNormalSelection,
  
  // Mass drag functions
  startMassDrag: startMassDrag,
  handleMassDragMove: handleMassDragMove,
  handleMassDragEnd: handleMassDragEnd,
  
  // Bounding box functions
  updateBoundingBox: updateBoundingBox,
  
  // Add single object to selection (for individual selections)
  addObject: (objectId) => {
    const container = document.getElementById(objectId);
    if (container && !selectedObjects.has(objectId)) {
      selectedObjects.add(objectId);
      container.classList.add("wbe-mass-selected");
      updateSelectionIndicator();
      updateBoundingBox();
    }
  },
  
  // Getters
  get isActive() { return massSelectionMode; },
  get selectedCount() { return selectedObjects.size; },
  get toggleState() { return toggleState; }
};

