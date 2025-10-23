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
    createCardsLayer
  } from "../main.mjs";

let copiedImageData = null; // Буфер для копирования картинок
let selectedImageId = null; // ID выделенного изображения
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
  const imageElement = container?.querySelector(".fate-canvas-image");
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
  
  e.clipboardData?.setData("text/plain", `[FATE-IMAGE-COPY:${selectedImageId}]`);
  ui.notifications.info("Картинка скопирована (Ctrl+V для вставки)");
});

// cleanup methods for socket updates
function clearImageCaches(id) {
    // Clear from registry
    imageRegistry.delete(id);
    // Clear from global data
    delete globalImageData[id];
    delete imageLocalVars[id];
    console.log(`[FATE-TC] Cleared caches for image ${id}`);
  }

/**
 * Get ALL crop/mask data from an image element (CSS/Dataset = source of truth)
 * @param {HTMLElement} imageElement - The .fate-canvas-image element
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
 * @param {HTMLElement} imageElement - The .fate-canvas-image element
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
 * @param {HTMLElement} imageElement - The .fate-canvas-image element  
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
      console.log(`[FATE-TC] Auto-deselecting ${container.id} because it was locked by ${lockerName}`);
      const imageData = imageRegistry.get(container.id);
      if (imageData && imageData.deselectFn) {
        imageData.deselectFn();
      }
    }
    
    // Блокируем все взаимодействия
    container.dataset.lockedBy = lockerId;
    container.style.pointerEvents = "none";
    
    const imageElement = container.querySelector(".fate-canvas-image");
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
    
    console.log(`[FATE-TC] Lock overlay for ${container.id}: ${overlayWidth}x${overlayHeight}, crop:`, cropData.crop);
    
    // Создаём overlay с фиолетовой рамкой и opacity
    let lockOverlay = container.querySelector(".fate-image-lock-overlay");
    if (!lockOverlay) {
      lockOverlay = document.createElement("div");
      lockOverlay.className = "fate-image-lock-overlay";
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
      border: 3px solid rgba(128, 0, 255, 0.8);
      border-radius: ${borderRadius};
      pointer-events: none;
      z-index: 1010;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // Add lock icon if not exists
    let lockIcon = lockOverlay.querySelector(".fate-lock-icon");
    if (!lockIcon) {
      lockIcon = document.createElement("div");
      lockIcon.className = "fate-lock-icon";
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
    console.log(`[FATE-TC] Removing lock from ${container.id}, wasSelected: ${container.dataset.selected}`);
    
    // Убираем блокировку
    delete container.dataset.lockedBy;
    
    // Удаляем overlay
    const lockOverlay = container.querySelector(".fate-image-lock-overlay");
    if (lockOverlay) {
      lockOverlay.remove();
    }
    
    // Возвращаем opacity
    const imageElement = container.querySelector(".fate-canvas-image");
    if (imageElement) {
      imageElement.style.opacity = "1";
    }
    
    // Восстанавливаем UI в зависимости от состояния выделения
    const wasSelected = container.dataset.selected === "true";
    const permanentBorder = container.querySelector(".fate-image-permanent-border");
    const selectionBorder = container.querySelector(".fate-image-selection-border");
    const resizeHandle = container.querySelector(".fate-image-resize-handle");
    
    if (wasSelected) {
      // Было выделено - восстанавливаем полный UI выделения
      console.log(`[FATE-TC] Restoring selected state for ${container.id}`);
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
        console.log(`[FATE-TC] Restored resize handle for ${container.id}`);
      }
    } else {
      // Не было выделено - возвращаем в базовое состояние
      console.log(`[FATE-TC] Restoring unselected state for ${container.id}`);
      container.style.removeProperty("pointer-events");
      container.style.removeProperty("cursor");
      
      if (permanentBorder) permanentBorder.style.display = "block";
      if (selectionBorder) selectionBorder.style.display = "none";
      if (resizeHandle) resizeHandle.style.display = "none";
      
      // ✨ NEW ARCHITECTURE: Update permanent border with current crop data
      if (permanentBorder && imageElement) {
        const cropData = getImageCropData(imageElement);
        console.log(`[FATE-TC] Updating permanent border after unlock, crop:`, cropData.crop);
        updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
        
        // Update click target to match visible area
        const clickTarget = container.querySelector(".fate-image-click-target");
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
    
    console.log("[FATE-TC] Installing global image selection handler");
    
    document.addEventListener("mousedown", async (e) => {
      if (e.button !== 0) return; // Only left click
      
      let clickedImageId = null;
      let clickedImageData = null;
      
      // Check which image (if any) was clicked
      for (const [id, imageData] of imageRegistry) {
        const container = imageData.container;
        
        // Skip locked images
        if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
          continue;
        }
        
        // Temporarily enable pointer-events to check hit detection
        const originalPointerEvents = container.style.pointerEvents;
        container.style.setProperty("pointer-events", "auto", "important");
        
        const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
        const clickedOnThis = elementUnderCursor === container || container.contains(elementUnderCursor);
        
        if (clickedOnThis) {
          clickedImageId = id;
          clickedImageData = imageData;
          console.log(`[FATE-TC] Clicked on image ${id}`);
          // If this image is in crop mode for THIS user, keep pointer-events enabled
          const inCropModeForMe = container.dataset.lockedBy === game.user.id;
          if (!inCropModeForMe) {
            container.style.setProperty("pointer-events", "none", "important");
          } else {
            container.style.setProperty("pointer-events", "auto", "important");
          }
          break;
        } else {
          // For non-clicked containers, only force none if they aren't in my crop mode
          const inCropModeForMe = container.dataset.lockedBy === game.user.id;
          if (!inCropModeForMe) {
            container.style.setProperty("pointer-events", "none", "important");
          } else {
            container.style.setProperty("pointer-events", "auto", "important");
          }
        }
      }
      
      // Handle selection/deselection
      if (clickedImageId && clickedImageData) {
        // Clicked on an image
        const isSelected = clickedImageData.container.dataset.selected === "true";
        
        if (!isSelected) {
          console.log(`[FATE-TC] Selecting image ${clickedImageId}`);
          e.preventDefault();
          e.stopPropagation();
          
          // Deselect all others first
          for (const [otherId, otherData] of imageRegistry) {
            if (otherId !== clickedImageId && otherData.container.dataset.selected === "true") {
              console.log(`[FATE-TC] Deselecting other image ${otherId}`);
              await otherData.deselectFn(); // Await async deselect
            }
          }
          
          // Select this one
          clickedImageData.selectFn();
        }
      } else {
        // Clicked elsewhere - deselect all selected images
        console.log(`[FATE-TC] Clicked outside all images, deselecting all`);
        for (const [id, imageData] of imageRegistry) {
          if (imageData.container.dataset.selected === "true") {
            console.log(`[FATE-TC] Deselecting image ${id}`);
            await imageData.deselectFn(); // Await async deselect
          }
        }
      }
    }, true); // Capture phase
    
    globalImageSelectionHandlerInstalled = true;
  }
  
  /* ----------------------- Canvas Text/Image Functions ------------------ */
  
  
  function createImageElement(id, src, left, top, scale = 1, crop = { top: 0, right: 0, bottom: 0, left: 0 }, maskType = 'rect', circleOffset = { x: 0, y: 0 }, circleRadiusParam = null) {
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
    container.className = "fate-canvas-image-container";
    container.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      z-index: 1000;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
    `;
    
    // Внутренний элемент для контента + масштабирование
    const imageElement = document.createElement("img");
    imageElement.className = "fate-canvas-image";
    imageElement.src = src;
    imageElement.style.cssText = `
      transform: scale(${scale});
      transform-origin: top left;
      max-width: 200px;
      max-height: 200px;
      display: block;
      border: none !important;
      pointer-events: none;
    `;
    
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
            cropHandles.top.className = "fate-crop-handle-top";
            cropHandles.top.style.cssText = baseStyle + `cursor: ns-resize;`;
            container.appendChild(cropHandles.top);
          }
          if (needRight) {
            cropHandles.right = document.createElement("div");
            cropHandles.right.className = "fate-crop-handle-right";
            cropHandles.right.style.cssText = baseStyle + `cursor: ew-resize;`;
            container.appendChild(cropHandles.right);
          }
          if (needBottom) {
            cropHandles.bottom = document.createElement("div");
            cropHandles.bottom.className = "fate-crop-handle-bottom";
            cropHandles.bottom.style.cssText = baseStyle + `cursor: ns-resize;`;
            container.appendChild(cropHandles.bottom);
          }
          if (needLeft) {
            cropHandles.left = document.createElement("div");
            cropHandles.left.className = "fate-crop-handle-left";
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
          cropHandles.circleResize.className = "fate-crop-handle-circle-resize";
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
        if (maskTypeToggle) maskTypeToggle.style.display = "flex";
        if (rectBtn && circleBtn) {
          rectBtn.style.background = currentMaskType === 'rect' ? '#4a9eff' : '#333';
          circleBtn.style.background = currentMaskType === 'circle' ? '#4a9eff' : '#333';
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
      const clickTarget = container.querySelector(".fate-image-click-target");
      if (clickTarget) {
        updateClickTarget(clickTarget, imageElement, dataNow.maskType, dataNow.crop, dataNow.circleOffset, dataNow.circleRadius, dataNow.scale);
      }
    }
    
    
    
    container.appendChild(imageElement);
    
    // Permanent border (серая рамка, показывается только когда НЕ выделена)
    const permanentBorder = document.createElement("div");
    permanentBorder.className = "fate-image-permanent-border";
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
    selectionBorder.className = "fate-image-selection-border";
    selectionBorder.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      border: 2px solid #4a9eff;
      pointer-events: none;
      display: none;
      z-index: 1002;
    `;
    container.appendChild(selectionBorder);
    
    // ✨ Click target overlay - matches ONLY visible (cropped) area
    // This prevents clicking/dragging by invisible cropped parts
    // Positioned exactly where the visible image is
    const clickTarget = document.createElement("div");
    clickTarget.className = "fate-image-click-target";
    clickTarget.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      background: transparent;
      pointer-events: auto;
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
    
    // Обновляем размеры рамок после загрузки картинки
    imageElement.addEventListener("load", () => {
      updateClipPath(); // ✨ Обновляем clip-path после загрузки!
      updateSelectionBorderSize();
      updateHandlePosition();
      
      // Update click target on load
      const cropData = getImageCropData(imageElement);
      const clickTarget = container.querySelector(".fate-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
    });
    
    // Resize handle (круглая точка)
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "fate-image-resize-handle";
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
    
    // UI переключатели типа маски
    let maskTypeToggle = null;
    let rectBtn = null;
    let circleBtn = null;
    
    function updateMaskToggleButtons() {
      if (rectBtn && circleBtn) {
        rectBtn.style.background = currentMaskType === 'rect' ? '#4a9eff' : '#333';
        circleBtn.style.background = currentMaskType === 'circle' ? '#4a9eff' : '#333';
      }
    }
    
    function enterCropMode() {
      // Проверяем, не заблокирована ли картинка другим пользователем
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        ui.notifications.warn("This image is being cropped by another user");
        return;
      }
      
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
      
      console.log(`[FATE-TC] enterCropMode - synced closure from CSS:`, cropData);
      
      isCropping = true;
      
      // Broadcast lock to all users
      game.socket.emit(`module.${MODID}`, {
        type: "imageLock",
        imageId: id,
        userId: game.user.id,
        userName: game.user.name
      });
      
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
      const clickTarget = container.querySelector(".fate-image-click-target");
      if (clickTarget) {
        clickTarget.style.pointerEvents = "none";
      }
      
      // Change cursor to default (not move) during crop mode
      container.style.setProperty("cursor", "default", "important");
      
      // Показываем фиолетовую рамку для crop mode
      selectionBorder.style.display = "block";
      selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Фиолетовый для crop mode
      
      // ✨ NEW ARCHITECTURE: Update border using synced data
      console.log(`[FATE-TC] enterCropMode - updating border with synced crop:`, cropData);
      updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      ui.notifications.info("Crop mode activated (image locked)");
      
      // Создаем UI переключатели типа маски (квадрат/круг)
      if (!maskTypeToggle) {
        maskTypeToggle = document.createElement("div");
        maskTypeToggle.className = "fate-mask-type-toggle";
        maskTypeToggle.style.cssText = `
          position: absolute;
          top: -35px;
          left: 50%;
          transform: translateX(-50%);
          display: flex; /* Показываем в crop mode */
          gap: 8px;
          z-index: 1004;
        `;
        
        // Кнопка "Квадрат"
        rectBtn = document.createElement("div");
        rectBtn.className = "fate-mask-btn fate-mask-rect-btn";
        rectBtn.innerHTML = '<i class="fas fa-square"></i>';
        rectBtn.title = "Прямоугольная маска";
        rectBtn.style.cssText = `
          width: 28px;
          height: 28px;
          background: ${currentMaskType === 'rect' ? '#4a9eff' : '#333'};
          border: 2px solid white;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: white;
          font-size: 14px;
        `;
        rectBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (currentMaskType !== 'rect') {
            currentMaskType = 'rect';
            updateMaskType();
            updateMaskToggleButtons();
            saveImageState(); // ✨ Сохраняем изменение типа маски!
          }
        });
        
        // Кнопка "Круг"
        circleBtn = document.createElement("div");
        circleBtn.className = "fate-mask-btn fate-mask-circle-btn";
        circleBtn.innerHTML = '<i class="fas fa-circle"></i>';
        circleBtn.title = "Круговая маска";
        circleBtn.style.cssText = `
          width: 28px;
          height: 28px;
          background: ${currentMaskType === 'circle' ? '#4a9eff' : '#333'};
          border: 2px solid white;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: white;
          font-size: 14px;
        `;
        circleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (currentMaskType !== 'circle') {
            currentMaskType = 'circle';
            updateMaskType();
            updateMaskToggleButtons();
            saveImageState(); // ✨ Сохраняем изменение типа маски!
          }
        });
        
        maskTypeToggle.appendChild(rectBtn);
        maskTypeToggle.appendChild(circleBtn);
        container.appendChild(maskTypeToggle);
      } else {
        // Кнопки уже созданы, просто показываем их
        maskTypeToggle.style.display = "flex";
        updateMaskToggleButtons(); // Обновляем подсветку
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
          z-index: 1003;
          pointer-events: auto;
        `;
        
        // Top handle
        cropHandles.top = document.createElement("div");
        cropHandles.top.className = "fate-crop-handle-top";
        cropHandles.top.style.cssText = handleStyle + `cursor: ns-resize;`;
        container.appendChild(cropHandles.top);
        
        // Right handle
        cropHandles.right = document.createElement("div");
        cropHandles.right.className = "fate-crop-handle-right";
        cropHandles.right.style.cssText = handleStyle + `cursor: ew-resize;`;
        container.appendChild(cropHandles.right);
        
        // Bottom handle
        cropHandles.bottom = document.createElement("div");
        cropHandles.bottom.className = "fate-crop-handle-bottom";
        cropHandles.bottom.style.cssText = handleStyle + `cursor: ns-resize;`;
        container.appendChild(cropHandles.bottom);
        
        // Left handle
        cropHandles.left = document.createElement("div");
        cropHandles.left.className = "fate-crop-handle-left";
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
        cropHandles.circleResize.className = "fate-crop-handle-circle-resize";
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
      console.log(`[FATE-TC] Exiting crop mode for ${id}`);
      
      isCropping = false;
      
      // ✨ CRITICAL: Write closure modifications back to CSS/Dataset (source of truth)
      // During crop mode, we only modified closures for performance
      // Now sync everything before broadcasting/reading
      console.log(`[FATE-TC] Syncing closure changes to CSS/Dataset:`, { crop, maskType: currentMaskType });
      setImageCropData(imageElement, {
        crop: { ...crop },
        maskType: currentMaskType,
        circleOffset: { x: circleOffsetX, y: circleOffsetY },
        circleRadius: circleRadius
      });
      
      // ✨ FINAL SAVE - Now broadcast all crop changes to everyone
      console.log(`[FATE-TC] Broadcasting final crop state for ${id}`);
      await saveImageState(true); // Force broadcast
      
      // Broadcast unlock to all users
      game.socket.emit(`module.${MODID}`, {
        type: "imageUnlock",
        imageId: id
      });
      
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
      console.log(`[FATE-TC] exitCropMode - updating permanent border with crop:`, cropData.crop);
      updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Update click target to match NEW visible area and re-enable it
      const clickTarget = container.querySelector(".fate-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Re-enable click target after crop mode
      if (clickTarget) {
        clickTarget.style.pointerEvents = "auto";
      }
      
      // Прячем UI переключатели
      if (maskTypeToggle) {
        maskTypeToggle.style.display = "none";
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
          
          // Рассчитываем новые offset'ы
          let newOffsetX = startOffsetX + deltaX / currentScale;
          let newOffsetY = startOffsetY + deltaY / currentScale;
          
          // 🔒 ОГРАНИЧИВАЕМ ПЕРЕМЕЩЕНИЕ ГРАНИЦАМИ КАРТИНКИ
          const width = imageElement.offsetWidth;
          const height = imageElement.offsetHeight;
          
          if (width > 0 && height > 0) {
            // Используем текущий радиус круга (может быть изменен гизмочкой)
            const currentRadius = circleRadius !== null ? circleRadius : Math.min(width, height) / 2;
            
            // Максимальные смещения (чтобы круг не выходил за границы)
            const maxOffsetX = (width / 2) - currentRadius;
            const maxOffsetY = (height / 2) - currentRadius;
            
            // Ограничиваем смещения
            circleOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
            circleOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));
            
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
        }
        
        function onMouseUp() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          saveImageState();
        }
        
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };
      
      imageElement.addEventListener("mousedown", dragHandler);
      
      // Сохраняем ссылку для cleanup
      circleDragListeners = { dragHandler };
    }
    
    function cleanupCircleDrag() {
      if (circleDragListeners) {
        imageElement.removeEventListener("mousedown", circleDragListeners.dragHandler);
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
        console.log(`[FATE-TC] Cannot select ${id} - locked by ${container.dataset.lockedBy}`);
        return;
      }
      
      console.log(`[FATE-TC] Selecting image ${id}`);
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
      console.log(`[FATE-TC] selectImage ${id} - crop data from CSS/Dataset:`, cropData);
      
      // Update selection border with current crop data
      updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Update click target to match visible area
      const clickTarget = container.querySelector(".fate-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Set move cursor on click target when selected
      if (clickTarget) {
        // clickTarget.style.cursor = "move"; // Removed move cursor
      }
      
      resizeHandle.style.display = "flex";
      
      // Update resize handle with current crop data
      updateImageResizeHandle(resizeHandle, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      console.log(`[FATE-TC] Image ${id} selected, pointer-events: ${container.style.pointerEvents}, resize handle visible: ${resizeHandle.style.display}`);
    }
    
    async function deselectImage() {
      console.log(`[FATE-TC] Deselecting image ${id}`);
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
      console.log(`[FATE-TC] deselectImage ${id} - Using crop for permanent border:`, cropData.crop);
      updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Update click target to match visible area
      const clickTarget = container.querySelector(".fate-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
      
      // Remove cursor from click target when deselected
      if (clickTarget) {
        // clickTarget.style.cursor = "default"; // Removed cursor change
      }
      
      resizeHandle.style.display = "none";
      
      console.log(`[FATE-TC] Image ${id} deselected, pointer-events: ${container.style.pointerEvents}`);
    }
    
    // Удаление по клавише Delete
    async function deleteImage() {
      console.log(`[FATE-TC] Deleting image ${id}`);
      
      // Unregister from global registry
      imageRegistry.delete(id);
      console.log(`[FATE-TC] Unregistered image ${id}, remaining images: ${imageRegistry.size}`);
      
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
      
      
      const newImageId = `fate-image-${Date.now()}`;
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
        circleRadius: circleRadiusData
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
          console.log(`[FATE-TC] Drag blocked - image ${id} is in crop mode`);
          return;
        }
        
        // Если элемент не выделен - сначала выделяем его
        if (!isSelected) {
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
      if (e.button !== 0) return;
      
      // Блокируем resize если картинка заблокирована другим пользователем
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      resizing = true;
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
      const newScale = resizeStartScale + (deltaX * 0.002);
      const clampedScale = Math.max(0.3, Math.min(3.0, newScale));
      
      imageElement.style.transform = `scale(${clampedScale})`;
      
      // ✨ CRITICAL: Store scale in CSS/Dataset system for persistence
      setImageCropData(imageElement, { scale: clampedScale });
      
      updateHandlePosition();
      updateSelectionBorderSize(); // ✨ Обновляем рамку при resize!
    }
    
    async function handleImageResizeUp() {
      if (resizing) {
        resizing = false;
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

      console.log(`[FATE-TC] saveImageState(SNAPSHOT) for ${id}:`, {
        useMaskType, useCrop, useCircleOffset, useCircleRadius, currentScale
      });

      const imageData = {
        src: imageElement.src,
        left: parseFloat(container.style.left),
        top: parseFloat(container.style.top),
        scale: currentScale,
        crop: useCrop,
        maskType: useMaskType,
        circleOffset: useCircleOffset,
        circleRadius: useCircleRadius,
        isCropping: isCropping
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
        console.log(`[FATE-TC] Image ${id} in crop mode - saving locally only, no broadcast`);
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
    console.log(`[FATE-TC] Registered image ${id} in global registry, total images: ${imageRegistry.size}`);
    
    // Install global handler if not already installed
    installGlobalImageSelectionHandler();
    
    return container;
  }
  
  
  
  /* ----------------------- Canvas Elements Storage ----------------- */
  
  
  
  
  async function getAllImages() {
    try {
      return await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_IMAGES) || {};
    } catch (e) {
      console.error("[FATE-TC] getAllImages error:", e);
      return {};
    }
  }
  
  async function setAllImages(images) {
    try {
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
          const existingElements = layer.querySelectorAll(".fate-canvas-image-container");
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
              createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData);
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
              element.remove();
            }
          });
        }
      }
    } catch (e) {
      console.error("[FATE-TC] setAllImages error:", e);
    }
}


// Функция для обновления всех параметров картинки
function updateImageElement(existing, imageData) {
    // Обновляем базовые параметры
    existing.style.left = `${imageData.left}px`;
    existing.style.top = `${imageData.top}px`;
    
    const imageElement = existing.querySelector(".fate-canvas-image");
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
    
    console.log(`[FATE-TC] updateImageElement updated imageLocalVars for ${existing.id}, crop:`, imageData.crop);
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
    const imageElement = container.querySelector(".fate-canvas-image");
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
    
    console.log(`[FATE-TC] updateImageUIElements for ${container.id}, preserving isSelected: ${isSelected}, isCropping: ${isCropping} (lockedByMe: ${isLockedByMe})`);
    
    // Обновляем постоянную рамку
    const permanentBorder = container.querySelector(".fate-image-permanent-border");
    if (permanentBorder) {
      updateImageBorder(permanentBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // Обновляем синюю рамку выделения
    const selectionBorder = container.querySelector(".fate-image-selection-border");
    if (selectionBorder) {
      updateImageBorder(selectionBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // Обновляем позицию resize handle
    const resizeHandle = container.querySelector(".fate-image-resize-handle");
    if (resizeHandle) {
      updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    }
    
    // ✨ CRITICAL: Update click target to match visible area
    // This ensures the click target stays synchronized with crop changes from socket updates
    const clickTarget = container.querySelector(".fate-image-click-target");
    if (clickTarget) {
      console.log(`[FATE-TC] updateImageUIElements - updating click target for ${container.id}`);
      updateClickTarget(clickTarget, imageElement, maskType, crop, circleOffset, circleRadius, scale);
    } else {
      console.log(`[FATE-TC] updateImageUIElements - click target not found for ${container.id}`);
    }
    
    // Обновляем переключатель типа маски
    const maskTypeToggle = container.querySelector(".fate-mask-type-toggle");
    if (maskTypeToggle) {
      updateMaskTypeToggle(maskTypeToggle, maskType);
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
    const imageElement = container.querySelector(".fate-canvas-image");
    const permanentBorder = container.querySelector(".fate-image-permanent-border");
    const selectionBorder = container.querySelector(".fate-image-selection-border");
    const resizeHandle = container.querySelector(".fate-image-resize-handle");
    const maskTypeToggle = container.querySelector(".fate-mask-type-toggle");
    
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
      
      // Убираем стили контейнера
      // Always keep pointer-events: none on container - click target handles interactions
      container.style.setProperty("pointer-events", "none", "important");
      container.style.removeProperty("cursor");
      delete container.dataset.selected;
    }
    
    if (isCropping) {
      // Crop режим - прячем resize handle и gray border, показываем переключатель, фиолетовая рамка, cursor default
      if (resizeHandle) resizeHandle.style.display = "none";
      if (permanentBorder) permanentBorder.style.display = "none"; // ✨ Hide gray border during crop
      if (selectionBorder) selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Фиолетовый для crop mode
      if (maskTypeToggle) maskTypeToggle.style.display = "flex";
      container.style.setProperty("cursor", "default", "important"); // Default cursor для crop mode
    } else {
      // Не crop режим - показываем resize handle если выделена, прячем переключатель, обычная синяя рамка
      if (isSelected && resizeHandle) resizeHandle.style.display = "flex";
      if (selectionBorder) selectionBorder.style.borderColor = "#4a9eff";
      if (maskTypeToggle) maskTypeToggle.style.display = "none";
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
    console.log(`[FATE-TC] updateImageLocalVars called for ${imageId}, data.crop:`, data.crop);
    
    imageLocalVars[imageId] = {
      maskType: data.maskType || 'rect',
      circleOffset: data.circleOffset || { x: 0, y: 0 },
      circleRadius: data.circleRadius,
      crop: data.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      scale: data.scale || 1
    };
    
    console.log(`[FATE-TC] imageLocalVars[${imageId}] now:`, JSON.stringify(imageLocalVars[imageId], null, 2));
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
    
    const imageElement = container.querySelector(".fate-canvas-image");
    const selectionBorder = container.querySelector(".fate-image-selection-border");
    
    if (!imageElement || !selectionBorder) return;
    
    updateImageBorder(selectionBorder, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
  }
  
  // Глобальная функция для обновления позиции resize handle с актуальными данными
  function updateImageResizeHandleGlobal(container) {
    const imageId = container.id;
    const data = getImageData(imageId);
    
    const imageElement = container.querySelector(".fate-canvas-image");
    const resizeHandle = container.querySelector(".fate-image-resize-handle");
    
    if (!imageElement || !resizeHandle) return;
    
    updateImageResizeHandle(resizeHandle, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
  }
  
  // Глобальная функция для обновления кнопок переключателя маски
  function updateMaskTypeToggleGlobal(container, maskType) {
    const maskTypeToggle = container.querySelector(".fate-mask-type-toggle");
    if (!maskTypeToggle) return;
    
    const rectBtn = maskTypeToggle.querySelector(".fate-mask-btn");
    const circleBtn = maskTypeToggle.querySelector(".fate-mask-btn:last-child");
    
    if (rectBtn && circleBtn) {
      if (maskType === 'rect') {
        rectBtn.style.backgroundColor = "#4a9eff";
        rectBtn.style.color = "white";
        circleBtn.style.backgroundColor = "#333";
        circleBtn.style.color = "white";
      } else if (maskType === 'circle') {
        circleBtn.style.backgroundColor = "#4a9eff";
        circleBtn.style.color = "white";
        rectBtn.style.backgroundColor = "#333";
        rectBtn.style.color = "white";
      }
      
  
    }
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
  
  // Функция для обновления переключателя типа маски
  function updateMaskTypeToggle(maskTypeToggle, maskType) {
    const rectBtn = maskTypeToggle.querySelector(".fate-mask-rect-btn");
    const circleBtn = maskTypeToggle.querySelector(".fate-mask-circle-btn");
    
    if (rectBtn && circleBtn) {
      if (maskType === 'rect') {
        rectBtn.style.backgroundColor = "#4a9eff";
        rectBtn.style.color = "white";
        circleBtn.style.backgroundColor = "transparent";
        circleBtn.style.color = "#4a9eff";
      } else if (maskType === 'circle') {
        circleBtn.style.backgroundColor = "#4a9eff";
        circleBtn.style.color = "white";
        rectBtn.style.backgroundColor = "transparent";
        rectBtn.style.color = "#4a9eff";
      }
    }
  }
  
  // Функция для обновления crop handles
  function updateCropHandles(container, maskType, crop, circleOffset, circleRadius, scale) {
    // Прячем все handles если не в crop режиме
    const cropHandles = {
      top: container.querySelector(".fate-crop-handle-top"),
      right: container.querySelector(".fate-crop-handle-right"),
      bottom: container.querySelector(".fate-crop-handle-bottom"),
      left: container.querySelector(".fate-crop-handle-left"),
      circleResize: container.querySelector(".fate-crop-handle-circle-resize")
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
      top: container.querySelector(".fate-crop-handle-top"),
      right: container.querySelector(".fate-crop-handle-right"),
      bottom: container.querySelector(".fate-crop-handle-bottom"),
      left: container.querySelector(".fate-crop-handle-left")
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
      circleResize: container.querySelector(".fate-crop-handle-circle-resize")
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
    
    const newImageId = `fate-image-${Date.now()}`;
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
      circleRadius: circleRadiusData
    };
    await setAllImages(images);
    
    ui.notifications.info("Картинка вставлена");
  }

  // Вставка картинки из системного буфера
async function handleImagePasteFromClipboard(file) {
    console.log("[FATE-TC] handleImagePasteFromClipboard called with file:", file.name, file.type);
    try {
      // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
      copiedImageData = null;
      
      // Создаем уникальное имя файла
      const timestamp = Date.now();
      const extension = file.type.split('/')[1] || 'png';
      const filename = `fate-image-${timestamp}.${extension}`;
      
      // Создаем новый File объект
      const newFile = new File([file], filename, { type: file.type });
      
      // Загружаем файл (оптимизированный подход)
      let uploadResult;
      const isGM = game.user.isGM;
      const startTime = Date.now();
      
      if (isGM) {
        // GM: Try direct upload only
        try {
          console.log("[FATE-TC] GM canvas upload - using direct method only");
          uploadResult = await foundry.applications.apps.FilePicker.implementation.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
          const directTime = Date.now() - startTime;
          console.log(`[FATE-TC] GM canvas upload successful in ${directTime}ms:`, uploadResult);
        } catch (error) {
          const directTime = Date.now() - startTime;
          console.error(`[FATE-TC] GM canvas upload failed after ${directTime}ms:`, error);
          throw new Error(`GM canvas upload failed: ${error.message}`);
        }
      } else {
        // Player: Try direct upload only (no timeout, no base64 fallback)
        try {
          console.log("[FATE-TC] Player canvas upload - using direct method only");
          uploadResult = await foundry.applications.apps.FilePicker.implementation.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
          const directTime = Date.now() - startTime;
          console.log(`[FATE-TC] Player canvas direct upload successful in ${directTime}ms:`, uploadResult);
        } catch (error) {
          const directTime = Date.now() - startTime;
          console.error(`[FATE-TC] Player canvas direct upload failed after ${directTime}ms:`, error);
          throw new Error(`Player canvas upload failed: ${error.message}`);
        }
      }
      
      if (uploadResult && uploadResult.path) {
        // Конвертируем позицию курсора в world coordinates
        const { lastMouseX, lastMouseY } = getSharedVars();
        const worldPos = screenToWorld(lastMouseX, lastMouseY);
        
        
        // Создаем новое изображение В ПОЗИЦИИ КУРСОРА
        const imageId = `fate-image-${timestamp}`;
        const defaultCrop = { top: 0, right: 0, bottom: 0, left: 0 };
        createImageElement(imageId, uploadResult.path, worldPos.x, worldPos.y, 1, defaultCrop, 'rect', { x: 0, y: 0 }, null);
        
        // Сохраняем в базу
        const images = await getAllImages();
        images[imageId] = {
          src: uploadResult.path,
          left: worldPos.x,
          top: worldPos.y,
          scale: 1,
          crop: defaultCrop
        };
        await setAllImages(images);
        
        ui.notifications.info("Изображение добавлено");
      } else {
        ui.notifications.error("Не удалось загрузить изображение");
      }
    } catch (err) {
      console.error("[FATE-TC] Ошибка при вставке картинки:", err);
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
  