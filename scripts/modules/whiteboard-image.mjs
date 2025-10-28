import {
    MODID,
    FLAG_SCOPE,
    FLAG_KEY_IMAGES,
    screenToWorld,
    worldToScreen,
    getSharedVars,          // lastMouseX/lastMouseY etc. — only call inside functions
    setSelectedImageId,
    setCopiedImageData,
    deselectAllElements,
    createCardsLayer,
    ZIndexManager
  } from "../main.mjs";

// Scale sensitivity constant
const SCALE_SENSITIVITY = 0.005; // Sensitivity for image scaling

let copiedImageData = null; // Буфер для копирования картинок
let selectedImageId = null; // ID выделенного изображения
let isScalingImage = false; // Flag to prevent deselection during scaling
// Глобальное хранилище данных картинок для синхронизации
let globalImageData = {}; // { [id]: { maskType, circleOffset, circleRadius, crop, scale } }
// Глобальное хранилище локальных переменных картинок
let imageLocalVars = {}; // { [id]: { maskType, circleOffset, circleRadius, crop, scale } }
/* ----------------------- Image Selection Registry ------------------ */
// Registry to track all image containers for centralized selection management
const imageRegistry = new Map(); // { id: { container, selectFn, deselectFn } }
// Single global handler for ALL image selection/deselection
let globalImageSelectionHandlerInstalled = false;
let removalObserver = null;

/* ======================== Mask Control Panel System ======================== */

function killImagePanel() {
  const p = window.wbeImagePanel;
  if (p && typeof p.cleanup === "function") {
    try { p.cleanup(); } catch {}
  }
}

/**
 * Показать панель управления масками для выбранного изображения
 * Аналог showColorPicker для текстов
 */
async function showImagePanel(imageElement, container, currentMaskType, callbacks) {
  if (!imageElement || !container) return;
  
  killImagePanel();
  
  const panel = document.createElement("div");
  panel.className = "wbe-mask-picker-panel";
  panel.style.cssText = `
    position: fixed;
    background: white;
    border: 1px solid #d7d7d7;
    border-radius: 14px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
    padding: 6px;
    z-index: 10000;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    
    aspect-ratio: 3 / 1;
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
    btn.className = "wbe-mask-toolbar-btn";
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

  // Создаем кнопки для типов масок
  const rectBtn = makeToolbarButton("Rectangle Mask", "fas fa-square");
  const circleBtn = makeToolbarButton("Circle Mask", "fas fa-circle");

  // ✅ FIX: Use a mutable reference to track current mask type
  let panelCurrentMaskType = currentMaskType;

  // Устанавливаем активную кнопку в зависимости от текущего типа маски
  setButtonActive(rectBtn, panelCurrentMaskType === 'rect');
  setButtonActive(circleBtn, panelCurrentMaskType === 'circle');

  // ✅ FIX: Update panel's internal state and sync with external state
  const updatePanelState = (newMaskType) => {
    panelCurrentMaskType = newMaskType;
    setButtonActive(rectBtn, newMaskType === 'rect');
    setButtonActive(circleBtn, newMaskType === 'circle');
  };

  // Обработчики нажатий на кнопки
  rectBtn.addEventListener("click", () => {
    // ✅ FIX: Allow toggling off active button or switching to different type
    if (panelCurrentMaskType === 'rect') {
      // Toggle off - don't change mask type, just update visual state
      return;
    }
    
    // Switch to rect
    updatePanelState('rect');
    
    // ✅ FIX: Add error handling for callbacks
    if (callbacks?.onMaskTypeChange) {
      try {
        callbacks.onMaskTypeChange('rect');
      } catch (error) {
        console.error("[WB-E] ImagePanel callback error:", error);
      }
    }
  });

  circleBtn.addEventListener("click", () => {
    // ✅ FIX: Allow toggling off active button or switching to different type
    if (panelCurrentMaskType === 'circle') {
      // Toggle off - don't change mask type, just update visual state
      return;
    }
    
    // Switch to circle
    updatePanelState('circle');
    
    // ✅ FIX: Add error handling for callbacks
    if (callbacks?.onMaskTypeChange) {
      try {
        callbacks.onMaskTypeChange('circle');
      } catch (error) {
        console.error("[WB-E] ImagePanel callback error:", error);
      }
    }
  });

  toolbar.appendChild(rectBtn);
  toolbar.appendChild(circleBtn);
  panel.appendChild(toolbar);
  document.body.appendChild(panel);

  const updatePanelPosition = () => {
    const rect = imageElement.getBoundingClientRect();
    panel.style.left = `${rect.left + rect.width / 2}px`;
    panel.style.top = `${rect.top - 80}px`;
  };

  updatePanelPosition();
  requestAnimationFrame(() => {
    panel.style.transform = "translateX(-50%) scale(1) translateY(0)";
    panel.style.opacity = "1";
  });

  const onOutside = (ev) => {
    if (panel.contains(ev.target)) return;
    
    const clickedInsideImage = container?.contains(ev.target);
    
    if (clickedInsideImage) {
      window.wbeImagePanelUpdate?.();
      return;
    }
    
    // ✅ FIX: Prevent cleanup if clicking on crop handles or other crop UI
    const cropHandles = container.querySelectorAll(
      '.wbe-crop-handle-top, .wbe-crop-handle-right, ' +
      '.wbe-crop-handle-bottom, .wbe-crop-handle-left, ' +
      '.wbe-crop-handle-circle-resize'
    );
    
    const isCropUI = Array.from(cropHandles).some(h => 
      h === ev.target || h.contains(ev.target)
    );
    
    if (isCropUI) {
      return; // Don't close panel when interacting with crop handles
    }
    
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
    panel.remove();
    window.wbeImagePanel = null;
    window.wbeImagePanelUpdate = null;
  }

  panel.cleanup = cleanup;
  window.wbeImagePanel = panel;
  window.wbeImagePanelUpdate = updatePanelPosition;
  
  // Сохраняем ссылки на кнопки для внешнего обновления
  panel.rectBtn = rectBtn;
  panel.circleBtn = circleBtn;
  panel.setButtonActive = setButtonActive;
  panel.updatePanelState = updatePanelState; // ✅ FIX: Expose state update function
}

// Install global pan hooks for ImagePanel (similar to ColorPanel)
let __wbeMaskPanHooksInstalled = false;

function installGlobalMaskPanHooks() {
  if (__wbeMaskPanHooksInstalled) return;
  __wbeMaskPanHooksInstalled = true;

  let isCanvasPanningGlobal = false;

  // Start pan on ANY right-button down; close panel immediately
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (e.target.closest(".wbe-canvas-image-container")) {
      // If you want to keep the panel when RMB starts ON the image, comment this line:
      killImagePanel();
    } else {
      killImagePanel();
    }
    isCanvasPanningGlobal = true;
  }, true);

  // On pan end, reopen for the currently selected image (if any)
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    if (!isCanvasPanningGlobal) return;
    isCanvasPanningGlobal = false;

    if (selectedImageId && !window.wbeImagePanel) {
      // Give the canvas a tick to settle transforms
      safeReshowImagePanel(selectedImageId, 100);
    }
  }, true);

  // Zoom wheel should also temporarily hide + then restore
  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    if (!selectedImageId) return;
    killImagePanel();
    safeReshowImagePanel(selectedImageId, 150);
  }, { passive: true });
}

function safeReshowImagePanel(targetId, delayMs = 0) {
  const open = async () => {
    const container = document.getElementById(targetId);
    if (!container) return;
    
    const imageElement = container.querySelector(".wbe-canvas-image");
    if (!imageElement) return;
    
    // Check if we're in crop mode (only show panel during crop)
    const isCropping = container.getAttribute('data-cropping') === 'true';
    if (!isCropping) return;
    
    // Get current mask type from the image
    const cropData = getImageCropData(imageElement);
    const currentMaskType = cropData.maskType || 'rect';
    
    // Reassert selection target in case other handlers nulled it
    selectedImageId = targetId;
    
    showImagePanel(imageElement, container, currentMaskType, {
      onMaskTypeChange: async (newMaskType) => {
        // This callback will be handled by the existing crop mode logic
        // The panel will be updated via the existing socket system
        // Note: The panel's internal state will be updated by the external updatePanelState call
      }
    });
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
installGlobalMaskPanHooks();

/* ======================== End Mask Control Panel System ======================== */


function ensureRemovalObserver() {
  const layer = createCardsLayer();
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
document.addEventListener("keydown", (e) => {
  if (!selectedImageId) return;
  const container = document.getElementById(selectedImageId);
  if (!container) return;
  
  // Delete / Backspace
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    e.stopPropagation();

    // Clear runtime caches FIRST to prevent resurrection
    clearImageCaches(selectedImageId);
    // call the image's delete via registry
    const imageData = imageRegistry.get(selectedImageId);
    if (imageData && imageData.deselectFn) {
      imageData.deselectFn(); // ensure exit crop first
    }
    
    // Clean up z-index
    ZIndexManager.removeImage(selectedImageId);
    
    container.remove();
    (async () => {
      const images = await getAllImages();
      delete images[selectedImageId];
      await setAllImages(images);
    })();
  }
  
  // Ctrl+C - программно вызываем copy
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "c")) {
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
  
  // ✨ CRITICAL: Read fresh data from DOM instead of stale closure variables
  const { crop, maskType, circleOffset, circleRadius, scale } = getImageCropData(imageElement);
  
  copiedImageData = {
    src: imageElement.src,
    scale,
    crop: { ...crop },
    maskType,
    circleOffset: { ...circleOffset },
    circleRadius
  };
  
  e.clipboardData?.setData("text/plain", `[wbe-IMAGE-COPY:${selectedImageId}]`);
  ui.notifications.info("Картинка скопирована (Ctrl+V для вставки)");
});

// cleanup methods for socket updates
function clearImageCaches(id) {
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
    
    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;
    
    if (maskType === 'rect') {
      const croppedWidth = width - crop.left - crop.right;
      const croppedHeight = height - crop.top - crop.bottom;
      clickTarget.style.width = `${croppedWidth * scale}px`;
      clickTarget.style.height = `${croppedHeight * scale}px`;
      clickTarget.style.left = `${crop.left * scale}px`;
      clickTarget.style.top = `${crop.top * scale}px`;
      clickTarget.style.borderRadius = "0";
    } else if (maskType === 'circle') {
      const fallback = Math.min(width, height) / 2;
      const currentRadius = (circleRadius == null) ? fallback : circleRadius;
      const diameter = currentRadius * 2;
      const centerX = width / 2 + circleOffset.x;
      const centerY = height / 2 + circleOffset.y;
      
      clickTarget.style.width = `${diameter * scale}px`;
      clickTarget.style.height = `${diameter * scale}px`;
      clickTarget.style.left = `${(centerX - currentRadius) * scale}px`;
      clickTarget.style.top = `${(centerY - currentRadius) * scale}px`;
      clickTarget.style.borderRadius = "50%";
    }
}

/* ----------------------- Image Crop Data Helpers (Single Source of Truth) ------------------ */
// ✨ NEW ARCHITECTURE: All crop/mask data lives in CSS/Dataset ONLY
// These helpers provide a unified interface to read/write that data






/* ----------------------- Image Lock Visual Functions ------------------ */
function applyImageLockVisual(container, lockerId, lockerName) {
    // ✨ CRITICAL: Deselect image if this user had it selected
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
    
    // ✨ NEW ARCHITECTURE: Get current crop/scale data to size overlay correctly
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
      
      if (permanentBorder) permanentBorder.style.display = "none";
      if (selectionBorder) {
        selectionBorder.style.display = "block";
        selectionBorder.style.borderColor = "#4a9eff"; // Стандартный цвет выделения
      }
      if (resizeHandle) {
        resizeHandle.style.display = "flex";
      }
    } else {
      // Не было выделено - возвращаем в базовое состояние
      container.style.removeProperty("pointer-events");
      container.style.removeProperty("cursor");
      
      if (permanentBorder) permanentBorder.style.display = "block";
      if (selectionBorder) selectionBorder.style.display = "none";
      if (resizeHandle) resizeHandle.style.display = "none";
      
      // ✨ NEW ARCHITECTURE: Update permanent border with current crop data
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
      if (e.button !== 0) return; // Only left click
      
      // ✅ FIX: Prevent image deselection when clicking ImagePanel
      if (window.wbeImagePanel && window.wbeImagePanel.contains(e.target)) {
        return; // Don't process image selection when clicking ImagePanel
      }
      
      let clickedImageId = null;
      let clickedImageData = null;
      
      // Check which image (if any) was clicked
      for (const [id, imageData] of imageRegistry) {
        const container = imageData.container;
        
        
        // Skip locked images
        if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
          continue;
        }
        
        // ✅ PREVENT SINGLE CLICK SELECTION OF MASS-SELECTED IMAGES
        if (container.classList.contains("wbe-mass-selected")) {
          continue; // Skip mass-selected images for individual selection
        }
        
        // Temporarily enable pointer-events to check hit detection
        const originalPointerEvents = container.style.pointerEvents;
        container.style.setProperty("pointer-events", "auto", "important");
        
        // Enable click target for hit detection
        const clickTarget = container.querySelector(".wbe-image-click-target");
        if (clickTarget) {
          clickTarget.style.setProperty("pointer-events", "auto", "important");
        }

        const cropHandles = container.querySelectorAll(
          '.wbe-crop-handle-top, .wbe-crop-handle-right, ' +
          '.wbe-crop-handle-bottom, .wbe-crop-handle-left, ' +
          '.wbe-crop-handle-circle-resize'
        );

        const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
        const isCropUI = Array.from(cropHandles).some(h => 
          h === elementUnderCursor || h.contains(elementUnderCursor)
        );
        
        
        const resizeHandle = container.querySelector(".wbe-image-resize-handle");
        const clickedOnThis = elementUnderCursor === clickTarget || 
                             (clickTarget && clickTarget.contains(elementUnderCursor)) ||
                             elementUnderCursor === resizeHandle || isCropUI;
        
        


        if (clickedOnThis) {
          clickedImageId = id;
          clickedImageData = imageData;
          


          // If this image is in crop mode for THIS user, keep pointer-events enabled
          const inCropModeForMe = container.dataset.lockedBy === game.user.id;
          if (!inCropModeForMe) {
            container.style.setProperty("pointer-events", "none", "important");
            // Enable click target for selected image
            const clickTarget = container.querySelector(".wbe-image-click-target");
            if (clickTarget) {
              clickTarget.style.setProperty("pointer-events", "auto", "important");
            }
          } else {
            container.style.setProperty("pointer-events", "auto", "important");
            const clickTarget = container.querySelector(".wbe-image-click-target");
            if (clickTarget) {
              clickTarget.style.setProperty("pointer-events", "auto", "important");
            }
          }
          break;
        } else {
          // For non-clicked containers, only force none if they aren't in my crop mode
          const inCropModeForMe = container.dataset.lockedBy === game.user.id;
          if (!inCropModeForMe) {
            container.style.setProperty("pointer-events", "none", "important");
            // Disable click target for non-selected images
            const clickTarget = container.querySelector(".wbe-image-click-target");
            if (clickTarget) {
              clickTarget.style.setProperty("pointer-events", "none", "important");
            }
          } else {
            container.style.setProperty("pointer-events", "auto", "important");
            const clickTarget = container.querySelector(".wbe-image-click-target");
            if (clickTarget) {
              clickTarget.style.setProperty("pointer-events", "auto", "important");
            }
          }
        }
      }
      
      // Handle selection/deselection
      if (clickedImageId && clickedImageData) {

       
        // Clicked on an image
        const isSelected = clickedImageData.container.dataset.selected === "true";
        
        if (!isSelected) {
          e.preventDefault();
          e.stopPropagation();
          
          // ✅ CLEAR MASS SELECTION when selecting individual image
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
        }
      } else {
        

        // Clicked elsewhere - deselect all selected images (unless scaling)
        if (!isScalingImage) {
          for (const [id, imageData] of imageRegistry) {
            if (imageData.container.dataset.selected === "true") {
              await imageData.deselectFn(); // Await async deselect
            }
          }
        }
      }
    }, true); // Capture phase
    
    globalImageSelectionHandlerInstalled = true;
  }
  
  /* ----------------------- Canvas Text/Image Functions ------------------ */
  
  
  function createImageElement(id, src, left, top, scale = 1, crop = { top: 0, right: 0, bottom: 0, left: 0 }, maskType = 'rect', circleOffset = { x: 0, y: 0 }, circleRadiusParam = null, existingZIndex = null) {
    const layer = getOrCreateLayer();
    if (!layer) return;
    
    // Читаем maskType из глобальных переменных
    let currentMaskType = (maskType !== undefined && maskType !== null) ? maskType  : (getImageLocalVars(id).maskType ?? 'rect');
    
    // ✨ Вспомогательная функция для обновления глобальных переменных
    function updateGlobalVars() {
      updateImageLocalVars(id, {
        maskType: currentMaskType,
        circleOffset: { x: circleOffsetX, y: circleOffsetY },
        circleRadius: circleRadius,
        crop: { ...crop },
        scale: parseFloat(imageElement.style.transform.match(/scale\(([\d.]+)\)/)?.[1] || 1),
        isSelected: isSelected,
        isCropping: isCropping
      });
    }
    
    // Контейнер для позиционирования (БЕЗ translate)
    const container = document.createElement("div");
    container.id = id;
    container.className = "wbe-canvas-image-container";
    // ✅ Get z-index from ZIndexManager or use existing
    const zIndex = existingZIndex || ZIndexManager.assignImage(id);
    
    // If using existing z-index, make sure it's registered in the manager
    if (existingZIndex) {
      ZIndexManager.imageZIndexes.set(id, existingZIndex);
    }
    
    container.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      z-index: ${zIndex};
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
    `;
    
    // Внутренний элемент для контента + масштабирование
    const imageElement = document.createElement("img");
    imageElement.className = "wbe-canvas-image";
    
    // ✨ Progressive loading: Show placeholder IMMEDIATELY
    imageElement.style.cssText = `
      transform: scale(${scale});
      transform-origin: top left;
      max-width: 200px;
      max-height: 200px;
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
        
        // Update UI elements that depend on image dimensions
        updateClipPath();
        updateSelectionBorderSize();
        updateHandlePosition();
        
        // Update click target after image loads
        const cropData = getImageCropData(imageElement);
        const clickTarget = container.querySelector(".wbe-image-click-target");
        updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      }, remainingTime);
    });
    
    imageElement.addEventListener("error", () => {
      // Image failed to load
      imageElement.style.background = "linear-gradient(45deg, #ffcccc 25%, transparent 25%), linear-gradient(-45deg, #ffcccc 25%, transparent 25%)";
      imageElement.style.backgroundSize = "20px 20px";
      loadingIndicator.innerHTML = "❌";
      loadingIndicator.style.animation = "none";
      loadingIndicator.style.border = "2px solid #ff4444";
      console.error(`[WB-E] Failed to load image: ${src}`);
    });
    
    // Start loading the image
    imageElement.src = src;
    
    // ✨ Init circle from the *arguments* first; fall back to locals
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
    
    // ✨ Seed the single source of truth (CSS vars + dataset) from incoming state
    setImageCropData(imageElement, {
      crop,
      maskType: currentMaskType,
      circleOffset: { x: circleOffsetX, y: circleOffsetY },
      circleRadius: circleRadius,
      scale
    });
    
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
          console.warn("⚠️ Image not loaded yet, skipping clip-path");
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
        const needTop    = !cropHandles.top;
        const needRight  = !cropHandles.right;
        const needBottom = !cropHandles.bottom;
        const needLeft   = !cropHandles.left;
        if (needTop || needRight || needBottom || needLeft) {
          const handleSize = 12;
          const baseStyle = `
            position: absolute;
            width: ${handleSize}px;
            height: ${handleSize}px;
            background: rgba(128, 0, 255, 0.9);
            border: 2px solid white;
            border-radius: 50%;
            cursor: pointer;
            z-index: 1003;
            pointer-events: auto;
          `;
          if (needTop) {
            cropHandles.top = document.createElement("div");
            cropHandles.top.className = "wbe-crop-handle-top";
            cropHandles.top.style.cssText = baseStyle + `cursor: ns-resize;`;
            container.appendChild(cropHandles.top);
          }
          if (needRight) {
            cropHandles.right = document.createElement("div");
            cropHandles.right.className = "wbe-crop-handle-right";
            cropHandles.right.style.cssText = baseStyle + `cursor: ew-resize;`;
            container.appendChild(cropHandles.right);
          }
          if (needBottom) {
            cropHandles.bottom = document.createElement("div");
            cropHandles.bottom.className = "wbe-crop-handle-bottom";
            cropHandles.bottom.style.cssText = baseStyle + `cursor: ns-resize;`;
            container.appendChild(cropHandles.bottom);
          }
          if (needLeft) {
            cropHandles.left = document.createElement("div");
            cropHandles.left.className = "wbe-crop-handle-left";
            cropHandles.left.style.cssText = baseStyle + `cursor: ew-resize;`;
            container.appendChild(cropHandles.left);
          }
          // Attach drags once for these elements
          setupCropHandleDrag();
        }
        // Remove circle handle if present
        if (cropHandles.circleResize && cropHandles.circleResize.parentNode) {
          cropHandles.circleResize.parentNode.removeChild(cropHandles.circleResize);
        }
        cropHandles.circleResize = null;
        // Also stop circle drag
        cleanupCircleDrag();
      };

      const ensureCircleHandles = () => {
        // Remove rect handles if present
        ["top", "right", "bottom", "left"].forEach(k => {
          if (cropHandles[k] && cropHandles[k].parentNode) {
            cropHandles[k].parentNode.removeChild(cropHandles[k]);
          }
          cropHandles[k] = null;
        });
        // Create circle resize handle if missing
        if (!cropHandles.circleResize) {
          const handleSize = 12;
          const baseStyle = `
            position: absolute;
            width: ${handleSize}px;
            height: ${handleSize}px;
            background: rgba(128, 0, 255, 0.9);
            border: 2px solid white;
            border-radius: 50%;
            cursor: pointer;
            z-index: 1003;
            pointer-events: auto;
          `;
          cropHandles.circleResize = document.createElement("div");
          cropHandles.circleResize.className = "wbe-crop-handle-circle-resize";
          cropHandles.circleResize.style.cssText = baseStyle + `cursor: nw-resize;`;
          container.appendChild(cropHandles.circleResize);
          setupCircleResizeHandleDrag();
          setupCircleDrag();
        }
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

      // 4) Refresh permanent border and click target from current DOM data
      const dataNow = getImageCropData(imageElement);
      updateImageBorder(permanentBorder, imageElement, dataNow.maskType, dataNow.crop, dataNow.circleOffset, dataNow.circleRadius, dataNow.scale);
      const clickTarget = container.querySelector(".wbe-image-click-target");
      if (clickTarget) {
        updateClickTarget(clickTarget, imageElement, dataNow.maskType, dataNow.crop, dataNow.circleOffset, dataNow.circleRadius, dataNow.scale);
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
      border: 2px solid rgba(255, 255, 255, 0.6);
      pointer-events: none;
      display: block;
      z-index: 1001;
    `;
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
      z-index: 1002;
    `;
    container.appendChild(selectionBorder);
    
    // ✨ Click target overlay - matches ONLY visible (cropped) area
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
      z-index: 998;
    `;
    container.appendChild(clickTarget);
    
    // Двойной клик → toggle crop mode (on clickTarget since it's on top)
    clickTarget.addEventListener("dblclick", async (e) => {
      if (!isSelected) return; // Работает только на выделенной картинке
      e.preventDefault();
      e.stopPropagation();
      
      // Проверяем блокировку перед переключением
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        ui.notifications.warn("This image is being cropped by another user");
        return;
      }
      
      isCropping = !isCropping;
      
      if (isCropping) {
        enterCropMode();
      } else {
        await exitCropMode(); // Await to ensure save completes
      }
    });
  
    // Инициализируем размеры рамок (но только ПОСЛЕ загрузки картинки)
    // НЕ вызываем здесь, т.к. imageElement.offsetWidth/Height = 0
    
    layer.appendChild(container);
    
    // Click target will be updated after image loads (handled by progressive loading system)
    
    // Resize handle (круглая точка)
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "wbe-image-resize-handle";
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
      z-index: 1002;
      pointer-events: auto;
      user-select: none;
      transform-origin: center center;
    `;
    container.appendChild(resizeHandle);
    
    // Функция для обновления позиции handle
    function updateHandlePosition() {
      const transform = imageElement.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      const width = imageElement.offsetWidth;
      const height = imageElement.offsetHeight;
      
      if (currentMaskType === 'rect') {
        // Прямоугольная маска: вычитаем crop из размеров
        const croppedWidth = width - crop.left - crop.right;
        const croppedHeight = height - crop.top - crop.bottom;
        
        const scaledWidth = croppedWidth * currentScale;
        const scaledHeight = croppedHeight * currentScale;
        
        // Позиционируем handle с учетом crop offset
        resizeHandle.style.left = `${crop.left * currentScale + scaledWidth - 6}px`;
        resizeHandle.style.top = `${crop.top * currentScale + scaledHeight - 6}px`;
      } else if (currentMaskType === 'circle') {
        // Круговая маска: позиционируем на краю круга
        const currentRadius = circleRadius !== null ? circleRadius : Math.min(width, height) / 2;
        
        // Центр круга с учетом offset
        const centerX = width / 2 + circleOffsetX;
        const centerY = height / 2 + circleOffsetY;
        
        // Позиция на краю круга (справа-снизу под углом 45°)
        const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
        const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707
        
        resizeHandle.style.left = `${handleX * currentScale - 6}px`;
        resizeHandle.style.top = `${handleY * currentScale - 6}px`;
        
      }
    }
    
    function updateSelectionBorderSize() {
      // ✨ CRITICAL: Always read fresh crop data from DOM (not closure variables)
      // This ensures we use the correct scale and crop values after F5
      const cropData = getImageCropData(imageElement);
      const currentCrop = cropData.crop;
      const currentMaskTypeValue = cropData.maskType;
      const currentScale = cropData.scale;
      
      const width = imageElement.offsetWidth;
      const height = imageElement.offsetHeight;
      
      if (currentMaskTypeValue === 'rect') {
        // Прямоугольная маска: вычитаем crop из размеров
        const croppedWidth = width - currentCrop.left - currentCrop.right;
        const croppedHeight = height - currentCrop.top - currentCrop.bottom;
        
        const scaledWidth = croppedWidth * currentScale;
        const scaledHeight = croppedHeight * currentScale;
        
        const offsetLeft = currentCrop.left * currentScale;
        const offsetTop = currentCrop.top * currentScale;
        
        // Обновляем ОБЕ рамки (серую и синюю)
        [permanentBorder, selectionBorder].forEach(border => {
          border.style.width = `${scaledWidth}px`;
          border.style.height = `${scaledHeight}px`;
          border.style.left = `${offsetLeft}px`;
          border.style.top = `${offsetTop}px`;
          border.style.borderRadius = "0"; // Прямоугольная
          border.style.clipPath = "none"; // Убираем clip-path для rect
        });
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
        
        // Обновляем ОБЕ рамки (серую и синюю)
        [permanentBorder, selectionBorder].forEach(border => {
          border.style.width = `${scaledDiameter}px`;
          border.style.height = `${scaledDiameter}px`;
          border.style.left = `${offsetLeft}px`;
          border.style.top = `${offsetTop}px`;
          border.style.borderRadius = "50%"; // Круговая
          border.style.clipPath = "none"; // Убираем clip-path для circle
        });
        
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
        ui.notifications.warn("This image is being cropped by another user");
        return;
      }
      isCropping = true;
      // ✨ NEW ARCHITECTURE: Sync closure variables from CSS/Dataset (source of truth)
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
      
      // ✨ Обновляем глобальные переменные
      updateGlobalVars();
      
      // Прячем resize handle и permanent border
      resizeHandle.style.display = "none";
      permanentBorder.style.display = "none"; // ✨ Ensure gray border is hidden during crop
      
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
      
      // ✨ NEW ARCHITECTURE: Update border using synced data
      updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      ui.notifications.info("Crop mode activated (image locked)");
      
      showImagePanel(imageElement, container, currentMaskType, {
        onMaskTypeChange: async (newMaskType) => {
          currentMaskType = newMaskType;
          updateMaskType();
          // ✅ FIX: Use centralized state update instead of manual button updates
          if (window.wbeImagePanel && window.wbeImagePanel.updatePanelState) {
            window.wbeImagePanel.updatePanelState(newMaskType);
          }
          await saveImageState(); // Сохраняем изменение типа маски
        }
      });
      
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
          z-index: 1003;
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
          z-index: 1003;
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
      
      // ✨ Ensure resize handle stays hidden (in case socket update tries to show it)
      resizeHandle.style.display = "none";
    }
    
    async function exitCropMode() {
      
      isCropping = false;

      killImagePanel();
      
      // ✨ CRITICAL: Write closure modifications back to CSS/Dataset (source of truth)
      // During crop mode, we only modified closures for performance
      // Now sync everything before broadcasting/reading
      setImageCropData(imageElement, {
        crop: { ...crop },
        maskType: currentMaskType,
        circleOffset: { x: circleOffsetX, y: circleOffsetY },
        circleRadius: circleRadius
      });
      
      // ✨ FINAL SAVE - Now broadcast all crop changes to everyone
      await saveImageState(true); // Force broadcast
      
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
      
      // ✨ Обновляем глобальные переменные
      updateGlobalVars();
      
      // Показываем resize handle и восстанавливаем cursor
      if (isSelected) {
        resizeHandle.style.display = "flex";
        updateHandlePosition();
        
        // Восстанавливаем move cursor
        // container.style.setProperty("cursor", "move", "important"); // Removed move cursor
        
        // Возвращаем оригинальный цвет рамки
        selectionBorder.style.borderColor = "#4a9eff";
        updateSelectionBorderSize();
      }
      
      // ✨ NEW ARCHITECTURE: Update permanent border to reflect NEW crop state
      const cropData = getImageCropData(imageElement);
      updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Update click target to match NEW visible area and re-enable it
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Re-enable click target after crop mode
      if (clickTarget) {
        clickTarget.style.pointerEvents = "auto";
      }
      
      ui.notifications.info("Crop mode deactivated (image unlocked)");
      
      // Удаляем гизмо-точки (для rect и circle)
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
      
      // Позиционируем гизмочку на краю круга (справа-снизу)
      const fallback = Math.min(width, height) / 2;
      const currentRadius = (circleRadius == null) ? fallback : circleRadius;
      const centerX = width / 2 + circleOffsetX;
      const centerY = height / 2 + circleOffsetY;
      
      // Координаты гизмочки на краю круга
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
          
          // Получаем текущий scale
          const transform = imageElement.style.transform || "";
          const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
          const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
          
          // Вычисляем изменение радиуса (используем среднее от deltaX и deltaY)
          const deltaRadius = (deltaX + deltaY) / (2 * currentScale);
          const newRadius = Math.max(10, Math.min(Math.min(imageElement.offsetWidth, imageElement.offsetHeight) / 2, startRadius + deltaRadius));
          
          circleRadius = newRadius;
          
          // ✨ Обновляем глобальные переменные
          updateGlobalVars();
          
          updateClipPath();
          updateCircleResizeHandlePosition();
          updateSelectionBorderSize(); // Обновляем синюю рамку
          
          // ✨ CRITICAL: Update purple border during crop mode with current circle data
          if (isCropping && selectionBorder) {
            const cropData = getImageCropData(imageElement);
            // Use ALL current live values, not mixed old/new data
            updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, cropData.scale);
          }
          
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState(); // Сохраняем радиус
        }
        
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }
    
    function setupCropHandleDrag() {
      
      // TOP handle
      cropHandles.top.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        
        const startY = e.clientY;
        const startCrop = crop.top;
        
        function onMouseMove(e) {
          const deltaY = e.clientY - startY;
          // Получаем текущий scale
          const transform = imageElement.style.transform || "";
          const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
          const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
          
          // Пересчитываем deltaY с учетом scale
          const scaledDelta = deltaY / currentScale;
          crop.top = Math.max(0, startCrop + scaledDelta);
          
          // ✨ Обновляем глобальные переменные
          updateGlobalVars();
          
          updateClipPath();
          updateCropHandlesPosition();
          // Update border using same data source as gizmos for synchronization
          updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState(); // Сохраняем crop
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
          crop.right = Math.max(0, startCrop - scaledDelta); // Инвертируем для правой стороны
          
          // ✨ Обновляем глобальные переменные
          updateGlobalVars();
          
          updateClipPath();
          updateCropHandlesPosition();
          // Update border using same data source as gizmos for synchronization
          updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState();
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
          
          // ✨ Обновляем глобальные переменные
          updateGlobalVars();
          
          updateClipPath();
          updateCropHandlesPosition();
          // Update border using same data source as gizmos for synchronization
          updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState();
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
          
          // ✨ Обновляем глобальные переменные
          updateGlobalVars();
          
          updateClipPath();
          updateCropHandlesPosition();
          // Update border using same data source as gizmos for synchronization
          updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState();
        }
        
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }
    
    // Circle drag (перемещение картинки внутри круговой маски)
    let circleDragActive = false;
    let circleDragListeners = null;
    
    function setupCircleDrag() {
      circleDragActive = true;
      
      // Обработчик drag для перемещения картинки
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
          
          // Получаем scale
          const transform = imageElement.style.transform || "";
          const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
          const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
          
          // Рассчитываем новые offset'ы с чувствительностью
          const sensitivity = 0.5; // 50% чувствительность для более плавного движения
          let newOffsetX = startOffsetX + (deltaX / currentScale) * sensitivity;
          let newOffsetY = startOffsetY + (deltaY / currentScale) * sensitivity;
          
          // 🔒 ОГРАНИЧИВАЕМ ПЕРЕМЕЩЕНИЕ ГРАНИЦАМИ КАРТИНКИ
          const width = imageElement.offsetWidth;
          const height = imageElement.offsetHeight;
          
          if (width > 0 && height > 0) {
            // Используем текущий радиус круга (может быть изменен гизмочкой)
            const currentRadius = circleRadius !== null ? circleRadius : Math.min(width, height) / 2;
            
            // Максимальные смещения (чтобы круг не выходил за границы изображения)
            // Круг может двигаться так, чтобы его край не выходил за границы изображения
            const maxOffsetX = (width / 2) - currentRadius;   // Максимальное смещение вправо
            const minOffsetX = -(width / 2) + currentRadius;  // Максимальное смещение влево
            const maxOffsetY = (height / 2) - currentRadius;  // Максимальное смещение вниз
            const minOffsetY = -(height / 2) + currentRadius; // Максимальное смещение вверх
            
            // Ограничиваем смещения в пределах границ изображения
            circleOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, newOffsetX));
            circleOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, newOffsetY));
            
          } else {
            // Если размеры еще не известны, используем старые значения
            circleOffsetX = newOffsetX;
            circleOffsetY = newOffsetY;
          }
          
          // ✨ Обновляем глобальные переменные
          updateGlobalVars();
          
          updateClipPath();
          updateSelectionBorderSize(); // ✨ Обновляем рамки при перемещении круга!
          updateCircleResizeHandlePosition(); // ✨ Обновляем позицию гизмочки при перемещении круга!
          
          // ✨ CRITICAL: Ensure purple border updates during crop mode circle drag
          if (isCropping && selectionBorder) {
            const cropData = getImageCropData(imageElement);
            // Use ALL current live values, not mixed old/new data
            updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, cropData.scale);
          }
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState();
        }
        
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };
      
      // Attach to container instead of imageElement to avoid pointer-events issues
      container.addEventListener("mousedown", dragHandler);
      
      // Сохраняем ссылку для cleanup
      circleDragListeners = { dragHandler };
    }
    
    function cleanupCircleDrag() {
      if (circleDragListeners) {
        container.removeEventListener("mousedown", circleDragListeners.dragHandler);
        circleDragListeners = null;
      }
      circleDragActive = false;
    }
    
    // Обработчики событий
    // Читаем состояния из глобальных переменных
    let isSelected = getImageLocalVars(id).isSelected || false;
    let dragging = false, startScreenX = 0, startScreenY = 0, startWorldX = 0, startWorldY = 0;
    let resizing = false, resizeStartX = 0, resizeStartScale = scale;
    let isCropping = getImageLocalVars(id).isCropping || false; // Режим crop (mask)
    // maskType, circleOffsetX/Y передаются как параметры (не переобъявляем)
    
    // Функция выделения/снятия выделения
    function selectImage() {
      // Нельзя выделить заблокированную картинку
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        return;
      }
      
      // ✅ PREVENT SELECTION OF MASS-SELECTED IMAGES
      if (container.classList.contains("wbe-mass-selected")) {
        return; // Don't select mass-selected images individually
      }
      
      isSelected = true;
      selectedImageId = id; // Устанавливаем глобальный ID
      
      // Помечаем контейнер как выделенный
      container.dataset.selected = "true";
      
      // ❌ DON'T call updateGlobalVars() here - it overwrites fresh socket data with stale closure values!
      // We should READ from imageLocalVars, not WRITE to it
      
      // Do NOT call deselectAllElements() here; the global image selection handler
      // already deselects others via their proper deselectFn(), keeping state in sync.
      
      // Don't set pointer-events on container - let click target handle interactions
      // container.style.setProperty("pointer-events", "auto", "important");
      // container.style.setProperty("cursor", "move", "important");
      
      // Прячем серую рамку, показываем синюю
      permanentBorder.style.display = "none";
      selectionBorder.style.display = "block";
      selectionBorder.style.borderColor = "#4a9eff"; // ✨ Set blue border for normal selection
      
      // ✨ NEW ARCHITECTURE: Single source of truth
      const cropData = getImageCropData(imageElement);
      
      // Update selection border with current crop data
      updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Update click target to match visible area
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // ✅ FIX: Enable click target pointer events for dragging/scaling/resizing
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "auto", "important");
      }
      
      resizeHandle.style.display = "flex";
      
      // Update resize handle with current crop data
      updateImageResizeHandle(resizeHandle, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
    }
    
    async function deselectImage() {
      isSelected = false;
      delete container.dataset.selected; // Убираем метку
      if (selectedImageId === id) selectedImageId = null; // Сбрасываем глобальный ID только если это МЫ
      
      // Выходим из crop mode если он был активен
      if (isCropping) {
        isCropping = false;
        await exitCropMode(); // Await to ensure save completes
      }
      
      // ❌ DON'T call updateGlobalVars() here - same issue as selectImage!
      // We should READ current state, not overwrite with stale closure values
      
      // Always keep pointer-events: none on container - click target handles interactions
      container.style.setProperty("pointer-events", "none", "important");
      container.style.removeProperty("cursor");
      
      // Прячем синюю рамку, показываем серую
      selectionBorder.style.display = "none";
      permanentBorder.style.display = "block";
      
      // ✨ NEW ARCHITECTURE: Update permanent border with current crop data
      const cropData = getImageCropData(imageElement);
      updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Update click target to match visible area
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Disable click target pointer events when deselected to allow canvas drag/pan
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "none", "important");
      }
      
      resizeHandle.style.display = "none";
      
    }
    
    // Удаление по клавише Delete
    async function deleteImage() {
      
      // Unregister from global registry
      imageRegistry.delete(id);
      
      // Clean up z-index
      ZIndexManager.removeImage(id);
      
      container.remove();
      
      const images = await getAllImages();
      delete images[id];
      await setAllImages(images);
    }
    
    // Вставка скопированной картинки
    async function pasteImage() {
      if (!copiedImageData) return;
      
      
      // Получаем позицию слоя относительно viewport
      const { lastMouseX, lastMouseY } = getSharedVars();
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
      
      
      const newImageId = `wbe-image-${Date.now()}`;
      const cropData = copiedImageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
      const maskTypeData = copiedImageData.maskType || 'rect';
      const circleOffsetData = copiedImageData.circleOffset || { x: 0, y: 0 };
      const circleRadiusData = copiedImageData.circleRadius || null;
      createImageElement(newImageId, copiedImageData.src, worldX, worldY, copiedImageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData);
      
      const images = await getAllImages();
      images[newImageId] = {
        src: copiedImageData.src,
        left: worldX,
        top: worldY,
        scale: copiedImageData.scale,
        crop: cropData,
        maskType: maskTypeData,
        circleOffset: circleOffsetData,
        circleRadius: circleRadiusData,
        zIndex: ZIndexManager.getImage(newImageId)
      };
      await setAllImages(images);
      
      ui.notifications.info("Картинка вставлена");
    }
    
    // ⚠️ REMOVED: Per-image global handlers (moved to single global handlers at module level)
    // Keydown and copy listeners are now handled globally via selectedImageId
    
    // ⚠️ REMOVED: Per-image global handler (moved to single global handler below)
    // Selection is now handled by the unified global image selection handler
  
    // Перетаскивание контейнера
    container.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        // Блокируем drag если картинка заблокирована другим пользователем
        if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
          return;
        }
        
        // 🔒 Блокируем drag если пользователь в режиме crop
        if (isCropping) {
          return;
        }
        
        
        // Если элемент не выделен - сначала выделяем его
        if (!isSelected) {
          // ✅ CLEAR MASS SELECTION when selecting image for drag
          if (window.MassSelection && window.MassSelection.selectedCount > 0) {
            window.MassSelection.clear();
          }
          selectImage();
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        dragging = true;
        startScreenX = e.clientX;
        startScreenY = e.clientY;
        startWorldX = parseFloat(container.style.left) || 0;
        startWorldY = parseFloat(container.style.top) || 0;
        
        document.addEventListener("mousemove", handleImageMouseMove);
        document.addEventListener("mouseup", handleImageMouseUp);
      }
    });
  
    async function handleImageMouseMove(e) {
      if (!dragging) return;
      
      const deltaScreenX = e.clientX - startScreenX;
      const deltaScreenY = e.clientY - startScreenY;
      
      const layer = getOrCreateLayer();
      const transform = layer?.style?.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      const deltaWorldX = deltaScreenX / scale;
      const deltaWorldY = deltaScreenY / scale;
      
      const newLeft = startWorldX + deltaWorldX;
      const newTop = startWorldY + deltaWorldY;
      
      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
    }
  
    async function handleImageMouseUp() {
      if (dragging) {
        dragging = false;
        document.removeEventListener("mousemove", handleImageMouseMove);
        document.removeEventListener("mouseup", handleImageMouseUp);
        
        await saveImageState();
      }
    }
    
    // Resize handle
    resizeHandle.addEventListener("mousedown", (e) => {
      console.log("Global handler fired!", e.target, e.target.classList);
      if (e.button !== 0) return;
      
      // Блокируем resize если картинка заблокирована другим пользователем
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      resizing = true;
      isScalingImage = true; // Set flag to prevent deselection during scaling
      resizeStartX = e.clientX;
      
      const transform = imageElement.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      resizeStartScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      
      document.addEventListener("mousemove", handleImageResize);
      document.addEventListener("mouseup", handleImageResizeUp);
    });
    
    function handleImageResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      const newScale = resizeStartScale + (deltaX * SCALE_SENSITIVITY);
      // No scale limits - allow unlimited scaling
      const finalScale = Math.max(0.01, newScale); // Only prevent negative/zero scale
      
      imageElement.style.transform = `scale(${finalScale})`;
      
      // ✨ CRITICAL: Store scale in CSS/Dataset system for persistence
      setImageCropData(imageElement, { scale: finalScale });
      
      // Update click target to match new scale
      const clickTarget = container.querySelector(".wbe-image-click-target");
      if (clickTarget) {
        const cropData = getImageCropData(imageElement);
        updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, finalScale);
      }
      
      updateHandlePosition();
      updateSelectionBorderSize(); // ✨ Обновляем рамку при resize!
    }
    
    async function handleImageResizeUp() {
      if (resizing) {
        resizing = false;
        isScalingImage = false; // Clear flag to allow deselection again
        document.removeEventListener("mousemove", handleImageResize);
        document.removeEventListener("mouseup", handleImageResizeUp);
        
        await saveImageState();
      }
    }
    
    // Универсальная функция сохранения состояния картинки
    async function saveImageState(broadcast = true) {
      // Always snapshot the CURRENT truth from the DOM first
      const domSnap = getImageCropData(imageElement);
      const currentScale = domSnap.scale;
      let   useCrop        = { ...domSnap.crop };
      let   useMaskType    = domSnap.maskType;
      let   useCircleOffset= { ...domSnap.circleOffset };
      let   useCircleRadius= domSnap.circleRadius;

      // Defensive fallback (shouldn't trigger, but safe if DOM is incomplete)
      if (useMaskType == null)       useMaskType = currentMaskType;
      if (!useCircleOffset)          useCircleOffset = { x: circleOffsetX, y: circleOffsetY };
      if (useCircleRadius === undefined) useCircleRadius = circleRadius;


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
        zIndex: ZIndexManager.getImage(id)
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

      const images = await getAllImages();
      images[id] = imageData;
      await setAllImages(images);
    }
    
    // Register this image in the global registry for selection management
    imageRegistry.set(id, {
      container: container,
      selectFn: selectImage,
      deselectFn: deselectImage
    });
    
    // Install global handler if not already installed
    installGlobalImageSelectionHandler();
    
    return container;
  }
  
  
  
  /* ----------------------- Canvas Elements Storage ----------------- */
  
  
  
  
  async function getAllImages() {
    try {
      return await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_IMAGES) || {};
    } catch (e) {
      console.error("[WB-E] getAllImages error:", e);
      return {};
    }
  }
  
  async function setAllImages(images) {
    try {
      // Sync ZIndexManager with existing z-index values to avoid conflicts
      const existingZIndexes = Object.entries(images).map(([id, data]) => [id, data.zIndex]).filter(([id, zIndex]) => zIndex);
      ZIndexManager.syncWithExisting(existingZIndexes);
      
      if (game.user.isGM) {
        // GM сохраняет в базу
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_IMAGES);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, images);
        // Эмитим всем
        game.socket.emit(`module.${MODID}`, { type: "imageUpdate", images });
      } else {
        const layer = getOrCreateLayer();
        // Игрок отправляет запрос GM через сокет
        game.socket.emit(`module.${MODID}`, { type: "imageUpdateRequest", images, userId: game.user.id });
        
        // Обновляем локально для немедленной реакции UI у игрока
        if (layer) {
          // Получаем все существующие картинки
          const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
          const existingIds = new Set();
          
          // Обновляем существующие и создаем новые картинки локально
          for (const [id, imageData] of Object.entries(images)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
            if (existing) {
              // Обновляем существующий элемент
              updateImageElement(existing, imageData);
            } else {
              // Создаем новый элемент
              const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
              const maskTypeData = imageData.maskType || 'rect';
              const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
              const circleRadiusData = imageData.circleRadius || null;
              createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, imageData.zIndex);
            }
            
            // ✨ Обновляем глобальные переменные для каждой картинки
            updateImageLocalVars(id, {
              maskType: imageData.maskType || 'rect',
              circleOffset: imageData.circleOffset || { x: 0, y: 0 },
              circleRadius: imageData.circleRadius,
              crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
              scale: imageData.scale || 1,
              isCropping: imageData.isCropping || false
            });
          }
          
          // Удаляем элементы, которых больше нет в images
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              // Clear runtime caches to prevent resurrection
              clearImageCaches(element.id);
              // Clean up z-index
              ZIndexManager.removeImage(element.id);
              element.remove();
            }
          });
        }
      }
    } catch (e) {
      console.error("[WB-E] setAllImages error:", e);
    }
}


// Функция для обновления всех параметров картинки
function updateImageElement(existing, imageData) {
    // Обновляем базовые параметры
    existing.style.left = `${imageData.left}px`;
    existing.style.top = `${imageData.top}px`;
    
    const imageElement = existing.querySelector(".wbe-canvas-image");
    if (imageElement) {
      imageElement.style.transform = `scale(${imageData.scale})`;
      
      // Обновляем сложные параметры картинки
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

      // 🔁 Ensure visual styles/UI are applied *after* the image has size
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
    
    // ✨ CRITICAL: Update imageLocalVars so selectImage() reads fresh data
    // This ensures crop data from socket updates is preserved
    updateImageLocalVars(existing.id, {
      maskType: imageData.maskType || 'rect',
      circleOffset: imageData.circleOffset || { x: 0, y: 0 },
      circleRadius: imageData.circleRadius,
      crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      scale: imageData.scale || 1,
      isCropping: imageData.isCropping || false
    });
    
  }
  
  // Функция для применения визуальных стилей картинки
  function updateImageVisualStyles(imageElement, imageData) {
    const maskType = imageData.maskType || 'rect';
    const crop = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const circleOffset = imageData.circleOffset || { x: 0, y: 0 };
    const circleRadius = imageData.circleRadius;
    
    if (maskType === 'rect') {
      // Прямоугольная маска (inset)
      const clipPath = `inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px)`;
      imageElement.style.clipPath = clipPath;
    } else if (maskType === 'circle') {
      // Круговая маска (circle)
      const width = imageElement.offsetWidth;
      const height = imageElement.offsetHeight;
      
      if (width === 0 || height === 0) {
        console.warn("⚠️ Image not loaded yet, skipping clip-path");
        return;
      }
      
      // Используем сохраненный радиус или вычисляем по умолчанию
      const fallback = Math.min(width, height) / 2;
      const radius = (circleRadius == null) ? fallback : circleRadius;
      
      const centerX = width / 2 + circleOffset.x;
      const centerY = height / 2 + circleOffset.y;
      const clipPath = `circle(${radius}px at ${centerX}px ${centerY}px)`;
      imageElement.style.clipPath = clipPath;
    }
  }
  
  // Функция для полного обновления UI элементов картинки
  function updateImageUIElements(container, imageData) {
    const imageElement = container.querySelector(".wbe-canvas-image");
    if (!imageElement) return;
    
    const maskType = imageData.maskType || 'rect';
    const crop = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const circleOffset = imageData.circleOffset || { x: 0, y: 0 };
    const circleRadius = imageData.circleRadius;
    const scale = imageData.scale || 1;
    
    // ✨ PRESERVE local selection state - don't override with socket data
    // Selection is managed locally via global click handler
    const isSelected = container.dataset.selected === "true";
    
    // ✨ CRITICAL: Check if THIS user is cropping (locked by them)
    // Local crop mode takes precedence over socket data
    const isLockedByMe = container.dataset.lockedBy === game.user.id;
    const isCropping = isLockedByMe || imageData.isCropping || false;
    
    
    // Обновляем постоянную рамку
    const permanentBorder = container.querySelector(".wbe-image-permanent-border");
    if (permanentBorder) {
      updateImageBorder(permanentBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // Обновляем синюю рамку выделения
    const selectionBorder = container.querySelector(".wbe-image-selection-border");
    if (selectionBorder) {
      updateImageBorder(selectionBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // Обновляем позицию resize handle
    const resizeHandle = container.querySelector(".wbe-image-resize-handle");
    if (resizeHandle) {
      updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // ✨ CRITICAL: Update click target to match visible area
    // This ensures the click target stays synchronized with crop changes from socket updates
    const clickTarget = container.querySelector(".wbe-image-click-target");
    if (clickTarget) {
      updateClickTarget(clickTarget, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // Обновляем crop handles
    updateCropHandles(container, maskType, crop, circleOffset, circleRadius, scale);
    
    // Позиционируем crop handles если они видны
    updateCropHandlesPositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    updateCircleResizeHandlePositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    
    // ✨ Применяем UI состояния
    updateImageUIStates(container, isSelected, isCropping);
    
    // ✨ Обновляем локальные переменные картинки
    updateImageLocalVariables(container, imageData);
  }
  
  // Функция для применения UI состояний картинки
  function updateImageUIStates(container, isSelected, isCropping) {
    const imageElement = container.querySelector(".wbe-canvas-image");
    const permanentBorder = container.querySelector(".wbe-image-permanent-border");
    const selectionBorder = container.querySelector(".wbe-image-selection-border");
    const resizeHandle = container.querySelector(".wbe-image-resize-handle");
    const clickTarget = container.querySelector(".wbe-image-click-target");
    
    // ✨ CRITICAL: If this user is cropping (locked by them), force isCropping to true
    // This prevents socket updates from showing blue border/resize handle during crop mode
    const isLockedByMe = container.dataset.lockedBy === game.user.id;
    if (isLockedByMe) {
      isCropping = true;
    }
    
    if (isSelected) {
      // Выделена - показываем синюю рамку, прячем серую, показываем resize handle
      if (permanentBorder) permanentBorder.style.display = "none";
      if (selectionBorder) selectionBorder.style.display = "block";
      if (resizeHandle) resizeHandle.style.display = "flex";
      
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
      // Не выделена - показываем серую рамку, прячем синюю, прячем resize handle
      if (permanentBorder) permanentBorder.style.display = "block";
      if (selectionBorder) selectionBorder.style.display = "none";
      if (resizeHandle) resizeHandle.style.display = "none";
      
      // Disable click target pointer events when not selected to allow canvas drag/pan
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "none", "important");
      }
      
      // Убираем стили контейнера
      // Always keep pointer-events: none on container - click target handles interactions
      container.style.setProperty("pointer-events", "none", "important");
      container.style.removeProperty("cursor");
      delete container.dataset.selected;
    }
    
    if (isCropping) {
      // Crop режим - прячем resize handle и gray border, фиолетовая рамка, cursor default
      if (resizeHandle) resizeHandle.style.display = "none";
      if (permanentBorder) permanentBorder.style.display = "none"; // ✨ Hide gray border during crop
      if (selectionBorder) selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Фиолетовый для crop mode
      container.style.setProperty("cursor", "default", "important"); // Default cursor для crop mode
    } else {
      // Не crop режим - показываем resize handle если выделена, обычная синяя рамка
      if (isSelected && resizeHandle) resizeHandle.style.display = "flex";
      if (selectionBorder) selectionBorder.style.borderColor = "#4a9eff";
    }
  }
  
  // Функция для обновления локальных переменных картинки
  function updateImageLocalVariables(container, imageData) {
    const imageId = container.id;
    
    // Сохраняем данные в глобальное хранилище
    globalImageData[imageId] = {
      maskType: imageData.maskType || 'rect',
      circleOffset: imageData.circleOffset || { x: 0, y: 0 },
      circleRadius: imageData.circleRadius,
      crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      scale: imageData.scale || 1
    };
    
    // ✨ Обновляем глобальные локальные переменные
    updateImageLocalVarsInElement(imageId, imageData);
    
  }
  
  // Функция для принудительного обновления UI с глобальными данными
  function updateImageUIWithGlobalData(container) {
    const imageId = container.id;
    const data = getImageData(imageId);
    
    
    // Обновляем рамки
    updateImageSelectionBorderGlobal(container);
    
    // Обновляем resize handle
    updateImageResizeHandleGlobal(container);
    
    // Обновляем кнопки переключателя маски
    updateMaskTypeToggleGlobal(container, data.maskType);
  }
  
  // Функция для получения актуальных данных картинки
  function getImageData(imageId) {
    return globalImageData[imageId] || {
      maskType: 'rect',
      circleOffset: { x: 0, y: 0 },
      circleRadius: null,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      scale: 1
    };
  }
  
  // Функция для получения локальных переменных картинки
  function getImageLocalVars(imageId) {
    return imageLocalVars[imageId] || {
      maskType: 'rect',
      circleOffset: { x: 0, y: 0 },
      circleRadius: null,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      scale: 1
    };
  }
  
  // Функция для обновления локальных переменных картинки
  function updateImageLocalVars(imageId, data) {
    
    imageLocalVars[imageId] = {
      maskType: data.maskType || 'rect',
      circleOffset: data.circleOffset || { x: 0, y: 0 },
      circleRadius: data.circleRadius,
      crop: data.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      scale: data.scale || 1
    };
    
  }
  
  // Глобальная функция для обновления локальных переменных в createImageElement
  function updateImageLocalVarsInElement(imageId, data) {
    // Находим картинку в DOM
    const container = document.getElementById(imageId);
    if (!container) return;
    
    // Обновляем глобальные локальные переменные
    updateImageLocalVars(imageId, data);
    
    // Принудительно обновляем UI с актуальными данными
    setTimeout(() => {
      updateImageUIWithGlobalData(container);
    }, 10);
  }
  
  // Глобальная функция для обновления рамок картинки с актуальными данными
  function updateImageSelectionBorderGlobal(container) {
    const imageId = container.id;
    const data = getImageData(imageId);
    
    const imageElement = container.querySelector(".wbe-canvas-image");
    const selectionBorder = container.querySelector(".wbe-image-selection-border");
    
    if (!imageElement || !selectionBorder) return;
    
    updateImageBorder(selectionBorder, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
  }
  
  // Глобальная функция для обновления позиции resize handle с актуальными данными
  function updateImageResizeHandleGlobal(container) {
    const imageId = container.id;
    const data = getImageData(imageId);
    
    const imageElement = container.querySelector(".wbe-canvas-image");
    const resizeHandle = container.querySelector(".wbe-image-resize-handle");
    
    if (!imageElement || !resizeHandle) return;
    
    updateImageResizeHandle(resizeHandle, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
  }

// Функция для обновления рамок картинки
function updateImageBorder(border, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;
    
    if (width === 0 || height === 0) return;
    
    if (maskType === 'rect') {
      // Прямоугольная маска
      const croppedWidth = width - crop.left - crop.right;
      const croppedHeight = height - crop.top - crop.bottom;
      const scaledWidth = croppedWidth * scale;
      const scaledHeight = croppedHeight * scale;
      const offsetLeft = crop.left * scale;
      const offsetTop = crop.top * scale;
      
      border.style.width = `${scaledWidth}px`;
      border.style.height = `${scaledHeight}px`;
      border.style.left = `${offsetLeft}px`;
      border.style.top = `${offsetTop}px`;
      border.style.borderRadius = "0";
      border.style.clipPath = "none";
    } else if (maskType === 'circle') {
      // Круговая маска
      const fallback = Math.min(width, height) / 2;
      const currentRadius = (circleRadius == null) ? fallback : circleRadius;
      const diameter = currentRadius * 2;
      const scaledDiameter = diameter * scale;
      const centerX = width / 2 + circleOffset.x;
      const centerY = height / 2 + circleOffset.y;
      const offsetLeft = (centerX - currentRadius) * scale;
      const offsetTop = (centerY - currentRadius) * scale;
      
      border.style.width = `${scaledDiameter}px`;
      border.style.height = `${scaledDiameter}px`;
      border.style.left = `${offsetLeft}px`;
      border.style.top = `${offsetTop}px`;
      border.style.borderRadius = "50%";
      border.style.clipPath = "none";
    }
  }
  
  // Функция для обновления resize handle
  function updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
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
    // Прячем все handles если не в crop режиме
    const cropHandles = {
      top: container.querySelector(".wbe-crop-handle-top"),
      right: container.querySelector(".wbe-crop-handle-right"),
      bottom: container.querySelector(".wbe-crop-handle-bottom"),
      left: container.querySelector(".wbe-crop-handle-left"),
      circleResize: container.querySelector(".wbe-crop-handle-circle-resize")
    };
    
    // Показываем/прячем handles в зависимости от типа маски
    if (cropHandles.top) cropHandles.top.style.display = maskType === 'rect' ? 'block' : 'none';
    if (cropHandles.right) cropHandles.right.style.display = maskType === 'rect' ? 'block' : 'none';
    if (cropHandles.bottom) cropHandles.bottom.style.display = maskType === 'rect' ? 'block' : 'none';
    if (cropHandles.left) cropHandles.left.style.display = maskType === 'rect' ? 'block' : 'none';
    if (cropHandles.circleResize) cropHandles.circleResize.style.display = maskType === 'circle' ? 'block' : 'none';
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
      cropHandles.top.style.left = `${left + w/2 - 6}px`;
      cropHandles.top.style.top = `${top - 6}px`;
    }
    
    if (cropHandles.right) {
      cropHandles.right.style.left = `${left + w - 6}px`;
      cropHandles.right.style.top = `${top + h/2 - 6}px`;
    }
    
    if (cropHandles.bottom) {
      cropHandles.bottom.style.left = `${left + w/2 - 6}px`;
      cropHandles.bottom.style.top = `${top + h - 6}px`;
    }
    
    if (cropHandles.left) {
      cropHandles.left.style.left = `${left - 6}px`;
      cropHandles.left.style.top = `${top + h/2 - 6}px`;
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
    
    const newImageId = `wbe-image-${Date.now()}`;
    const cropData = copiedImageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const maskTypeData = copiedImageData.maskType || 'rect';
    const circleOffsetData = copiedImageData.circleOffset || { x: 0, y: 0 };
    const circleRadiusData = copiedImageData.circleRadius || null;
    createImageElement(newImageId, copiedImageData.src, worldPos.x, worldPos.y, copiedImageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData);
    
    const images = await getAllImages();
    images[newImageId] = {
      src: copiedImageData.src,
      left: worldPos.x,
      top: worldPos.y,
      scale: copiedImageData.scale,
      crop: cropData,
      maskType: maskTypeData,
      circleOffset: circleOffsetData,
      circleRadius: circleRadiusData,
      zIndex: ZIndexManager.getImage(newImageId)
    };
    await setAllImages(images);
    
    ui.notifications.info("Картинка вставлена");
  }

  // Вставка картинки из системного буфера
async function handleImagePasteFromClipboard(file) {
    try {
      // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
      copiedImageData = null;
      
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
          uploadResult = await foundry.applications.apps.FilePicker.implementation.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
          const directTime = Date.now() - startTime;
        } catch (error) {
          const directTime = Date.now() - startTime;
          console.error(`[WB-E] GM canvas upload failed after ${directTime}ms:`, error);
          throw new Error(`GM canvas upload failed: ${error.message}`);
        }
      } else {
        // Player: Try direct upload only (no timeout, no base64 fallback)
        try {
          uploadResult = await foundry.applications.apps.FilePicker.implementation.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
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
        const worldPos = screenToWorld(lastMouseX, lastMouseY);
        
        
        // Создаем новое изображение В ПОЗИЦИИ КУРСОРА
        const imageId = `wbe-image-${timestamp}`;
        const defaultCrop = { top: 0, right: 0, bottom: 0, left: 0 };
        createImageElement(imageId, uploadResult.path, worldPos.x, worldPos.y, 1, defaultCrop, 'rect', { x: 0, y: 0 }, null);
        
        // Сохраняем в базу
        const images = await getAllImages();
        images[imageId] = {
          src: uploadResult.path,
          left: worldPos.x,
          top: worldPos.y,
          scale: 1,
          crop: defaultCrop,
          zIndex: ZIndexManager.getImage(imageId)
        };
        await setAllImages(images);
        
        ui.notifications.info("Изображение добавлено");
      } else {
        ui.notifications.error("Не удалось загрузить изображение");
      }
    } catch (err) {
      console.error("[WB-E] Ошибка при вставке картинки:", err);
      ui.notifications.error("Ошибка при вставке изображения");
    }
  }

  export const ImageTools = {
    // create/update
    createImageElement,
    updateImageElement,
  
    // storage
    getAllImages,
    setAllImages,
  
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
    
    clearImageCaches
    
  };
  