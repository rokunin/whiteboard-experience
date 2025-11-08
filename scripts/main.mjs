 /*********************************************************
 * FATE Table Card — v13+
 * Многокарточные визитки на столе (синхрон у всех).
 *********************************************************/
const MODID = "whiteboard-experience";
const FLAG_SCOPE = MODID;
const FLAG_KEY = "cards"; // scene.flags[MODID].cards = { [id]: state }
const FLAG_KEY_TEXTS = "texts"; // scene.flags[MODID].texts = { [id]: { text, left, top } }
const FLAG_KEY_IMAGES = "images"; // scene.flags[MODID].images = { [id]: { src, left, top } }

import { TextTools } from "./modules/whiteboard-text.mjs";
import { ImageTools } from "./modules/whiteboard-image.mjs";
import { MassSelection } from "./modules/whiteboard-select.mjs";

// Server sequence for rank updates (GM authority)
let serverSeq = 0;




// Debounce функция для предотвращения частых обновлений
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

/* ----------------------- Bootstrap ----------------------- */


Hooks.once("ready", async () => {
  // Контролы могут быть собраны до наших хуков — пересоберём мягко
  try { ui.controls?.render?.(true); } catch (e) { }

  // Создать слой для карточек на canvas
  createCardsLayer();

  // Поднять все карточки со сцены
  const all = await getAllStates();
  for (const [id, st] of Object.entries(all)) FateTableCardApp.show(id, st);

  // Поднять все тексты и картинки
  await loadCanvasElements();

  // Request active locks from all users after loading elements
  // This restores locks after page refresh (F5)
  requestActiveLocks();

  // Initialize mass selection system
  MassSelection.initialize();
  MassSelection.setToggleState(massSelectionToggleState);

 

  // Инъекция инструментов в левый тулбар
  injectMassSelectionTool(); // Mass selection first (top priority)
  TextTools.injectTextTool();
  
  // Setup keyboard shortcuts for text formatting
  TextTools.setupTextKeyboardShortcuts();
  
  Hooks.on("renderSceneControls", () => {
    injectMassSelectionTool(); // Mass selection first (top priority)
    TextTools.injectTextTool();
  });



  // Глобальный обработчик Ctrl+V для вставки из буфера
  setupGlobalPasteHandler();

  // Синхронизация трансформации карточек с canvas
  Hooks.on("canvasPan", syncCardsWithCanvas);
  Hooks.on("canvasReady", () => {
    createCardsLayer();
    syncCardsWithCanvas();
    startContinuousSync();
  });

  // Если canvas уже готов - запустить сразу
  if (canvas?.ready) {
    createCardsLayer();
    syncCardsWithCanvas();
    startContinuousSync();
  }

  // Сокеты (GM пишет флаги, клиенты — только UI)
  game.socket.on(`module.${MODID}`, async (data) => {
    if (!data || !data.type) return;

    if (data.type === "update") {
      // Только не-GM обрабатывают update (GM уже обновил локально)
      if (!game.user.isGM) {
        await updateCardState(data.id, data.state, false);
      }
      FateTableCardApp.show(data.id, data.state, { fromSocket: true });
    }

    if (data.type === "move") {
      const app = FateTableCardApp.instances.get(data.id);
      if (app) app.setPosition({ left: data.pos.left, top: data.pos.top });
    }

    if (data.type === "delete") {
      // Только не-GM обрабатывают delete (GM уже удалил локально)
      if (!game.user.isGM) {
        await deleteCardState(data.id, false);
      }
      FateTableCardApp.closeOne(data.id);
    }

    if (data.type === "bulk") {
      // Полная синхронизация: флаги уже записаны GM'ом; клиентам — перерисовать
      // GM тоже обрабатывает bulk для синхронизации UI
      FateTableCardApp.closeAll();
      for (const [id, st] of Object.entries(data.states || {})) {
        FateTableCardApp.show(id, st, { fromSocket: true });
      }
    }

    // Сокеты для текстов и картинок
    if (data.type === "textUpdateRequest") {
      // Игрок просит GM сохранить изменения
      if (game.user.isGM) {
        const requestTexts = data.texts || {};
        const requestTextIds = Object.keys(requestTexts);
        const isEmpty = requestTextIds.length === 0;
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, requestTexts);
        if (isEmpty) {
          // Also clear ZIndexManager completely when clearing all
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
          for (const [id, textData] of Object.entries(requestTexts)) {
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

        const textUpdatePayload = { type: "textUpdate", texts: requestTexts };
        if (data.userId) {
          textUpdatePayload.senderId = data.userId;
        }
        game.socket.emit(`module.${MODID}`, textUpdatePayload);
      }
    }

    if (data.type === "textUpdate") {
      // Обновляем UI у всех (включая отправителя)
      // Умное обновление: обновляем только измененные тексты
      // FIX: Skip update if this is the sender's own update
      if (data.senderId && data.senderId === game.user.id) {
        console.log("[WB-E] Skipping own textUpdate");
        return;
      }
      const layer = getOrCreateLayer();
      if (layer) {
        // Получаем все существующие текстовые элементы
        const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
        const existingIds = new Set();

        // Обновляем существующие и создаем новые тексты
        for (const [id, textData] of Object.entries(data.texts || {})) {
          existingIds.add(id);
          const existing = document.getElementById(id);
          if (existing) {
            // CRITICAL FIX: Skip locked text elements
            // Check both dataset.lockedBy AND lock overlay (more reliable - works even if lock restored after socket update)
            const hasLockOverlay = existing.querySelector(".wbe-text-lock-overlay") !== null;
            const isLockedByOther = existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id;
            if (hasLockOverlay || isLockedByOther) {
              const lockedBy = existing.dataset.lockedBy || "unknown";
              console.log(`[WB-E] Skipping socket update for ${id} - locked by user ${lockedBy} (has overlay: ${hasLockOverlay})`);
              continue; // Don't update! This prevents cursor reset and size changes!
            }

            // Обновляем существующий элемент
            const textElement = existing.querySelector(".wbe-canvas-text");
            if (textElement) {
              // ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
              if (textElement.contentEditable === "true") {
                console.log(`[WB-E] Skipping socket update for ${id} - actively being edited`);
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
              TextTools.applyFontVariantToElement?.(textElement, textData.fontWeight, textData.fontStyle); // Apply background color
              TextTools.applyTextAlignmentToElement?.(textElement, textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN);
              TextTools.applyFontFamilyToElement?.(textElement, textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY);
              TextTools.applyFontSizeToElement?.(textElement, textData.fontSize || TextTools.DEFAULT_FONT_SIZE);
              TextTools.applyBorderDataToElement?.(textElement, textData.borderColor, textData.borderWidth);

              // CRITICAL FIX: Don't update width if element is locked (lockedSize prevents size changes)
              if (!textElement.dataset.lockedSize) {
                // Apply width if it was set
                if (textData.width && textData.width > 0) {
                  textElement.style.width = `${textData.width}px`;
                } else {
                  textElement.style.width = "";
                }
              } else {
                console.log(`[WB-E] Skipping width update for ${id} - element is locked (lockedSize=true)`);
              }

              // EXPERIMENT PHASE 1: Don't update Manager z-index directly - use rank instead
              // Z-index is derived from rank order, so we should only update rank
              // The old z-index value is kept for backward compatibility but rank takes precedence
              // Rank sync is handled below

              // Sync rank if present in socket data (fractional indexing)
              // Only update if rank actually changed to avoid unnecessary DOM updates
              if (textData.rank && typeof textData.rank === 'string') {
                if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
                  const currentRank = window.ZIndexManager.getRank(id);
                  if (currentRank !== textData.rank) {
                    window.ZIndexManager.setRank(id, textData.rank);
                  }
                }
              } else if (window.ZIndexManager && typeof window.ZIndexManager.has === 'function' && !window.ZIndexManager.has(id)) {
                // If no rank and object doesn't exist in manager, assign new rank
                if (typeof window.ZIndexManager.assignText === 'function') {
                  window.ZIndexManager.assignText(id);
                }
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

          // Sync rank if present in socket data (fractional indexing) for newly created elements
          if (textData.rank && typeof textData.rank === 'string') {
            if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
              const currentRank = window.ZIndexManager.getRank(id);
              if (currentRank !== textData.rank) {
                window.ZIndexManager.setRank(id, textData.rank);
              }
            }
          } else if (window.ZIndexManager && typeof window.ZIndexManager.has === 'function' && !window.ZIndexManager.has(id)) {
            // If no rank and object doesn't exist in manager, assign new rank
            if (typeof window.ZIndexManager.assignText === 'function') {
              window.ZIndexManager.assignText(id);
            }
          }
        }

        // Sync DOM z-indexes after updating all ranks
        if (window.ZIndexManager && typeof window.ZIndexManager.syncAllDOMZIndexes === 'function') {
          await window.ZIndexManager.syncAllDOMZIndexes();
        }

        // CRITICAL FIX: Only remove elements if they're explicitly missing from socket data
        // AND not actively being edited/manipulated (to prevent race conditions during rapid updates)
        existingElements.forEach(element => {
          if (!existingIds.has(element.id)) {
            // Don't remove if element is locked/being edited
            if (element.dataset.lockedBy) {
              console.log(`[WB-E] Preserving ${element.id} - locked by user ${element.dataset.lockedBy}`);
              return;
            }
            
            const textElement = element.querySelector(".wbe-canvas-text");
            if (textElement && textElement.contentEditable === "true") {
              console.log(`[WB-E] Preserving ${element.id} - actively being edited`);
              return;
            }
            
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

    if (data.type === "imageUpdateRequest") {
      // Игрок просит GM сохранить изменения
      if (game.user.isGM) {
        const isEmpty = Object.keys(data.images || {}).length === 0;
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_IMAGES);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, data.images);

        // Обновляем локально для немедленной реакции UI у GM
        const layer = getOrCreateLayer();
        if (layer) {
          // Получаем все существующие картинки
          const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
          const existingIds = new Set();

          // Обновляем существующие и создаем новые картинки локально у GM
          for (const [id, imageData] of Object.entries(data.images)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
          if (existing) {
            // CRITICAL FIX: Skip locked image elements (GM socket handler)
            // Check both dataset.lockedBy AND lock overlay (more reliable - works even if lock restored after socket update)
            const hasLockOverlay = existing.querySelector(".wbe-image-lock-overlay") !== null;
            const isLockedByOther = existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id;
            if (hasLockOverlay || isLockedByOther) {
              const lockedBy = existing.dataset.lockedBy || "unknown";
              console.log(`[WB-E] GM skipping socket update for image ${id} - locked by user ${lockedBy} (has overlay: ${hasLockOverlay})`);
              continue; // Don't update! This prevents crop changes!
            }
            // Обновляем существующий элемент
            ImageTools.updateImageElement(existing, imageData);
            
            // Sync rank if present in socket data (fractional indexing)
            // Only update if rank actually changed to avoid unnecessary DOM updates
            if (imageData.rank && typeof imageData.rank === 'string') {
              if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
                const currentRank = window.ZIndexManager.getRank(id);
                if (currentRank !== imageData.rank) {
                  window.ZIndexManager.setRank(id, imageData.rank);
                }
              }
            } else if (window.ZIndexManager && typeof window.ZIndexManager.has === 'function' && !window.ZIndexManager.has(id)) {
              // If no rank and object doesn't exist in manager, assign new rank
              if (typeof window.ZIndexManager.assignImage === 'function') {
                window.ZIndexManager.assignImage(id);
              }
            }
          } else {
            // Создаем новый элемент
            const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
            const maskTypeData = imageData.maskType || 'rect';
            const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
            const circleRadiusData = imageData.circleRadius || null;
            ImageTools.createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, null, imageData.isFrozen || false);
          }

          // Обновляем глобальные переменные для каждой картинки
          ImageTools.updateImageLocalVars(id, {
            maskType: imageData.maskType || 'rect',
            circleOffset: imageData.circleOffset || { x: 0, y: 0 },
            circleRadius: imageData.circleRadius,
            crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
            scale: imageData.scale || 1,
            isCropping: imageData.isCropping || false
          });
        }

        // Sync DOM z-indexes after updating all ranks
        if (window.ZIndexManager && typeof window.ZIndexManager.syncAllDOMZIndexes === 'function') {
          await window.ZIndexManager.syncAllDOMZIndexes();
        }

        // CRITICAL FIX: Only remove elements if they're explicitly missing from socket data
          // AND not actively being edited/manipulated (to prevent race conditions during rapid updates)
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              // Don't remove if element is locked/being manipulated
              if (element.dataset.lockedBy) {
                console.log(`[WB-E] Preserving ${element.id} - locked by user ${element.dataset.lockedBy}`);
                return;
              }
              
              // FIX: Clean up image control panel before removing element
              if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.cleanup === "function") {
                try {
                  window.wbeImageControlPanel.cleanup();
                } catch { }
              }
              // Clear runtime caches to prevent resurrection
              ImageTools.clearImageCaches(element.id);
              // Clean up ZIndexManager
              if (window.ZIndexManager && typeof window.ZIndexManager.remove === "function") {
                window.ZIndexManager.remove(element.id);
              }
              element.remove();
            }
          });
        }

        // Эмитим всем (включая отправителя)
        game.socket.emit(`module.${MODID}`, { type: "imageUpdate", images: data.images });
      }
    }

    if (data.type === "imageUpdate") {
      // Обновляем UI у всех (включая отправителя)
      const layer = getOrCreateLayer();
      if (layer) {
        // Получаем все существующие картинки
        const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
        const existingIds = new Set();

        // Обновляем существующие и создаем новые картинки
        for (const [id, imageData] of Object.entries(data.images || {})) {
          existingIds.add(id);
          const existing = document.getElementById(id);
          if (existing) {
            // CRITICAL FIX: Skip locked image elements
            // Check both dataset.lockedBy AND lock overlay (more reliable - works even if lock restored after socket update)
            const hasLockOverlay = existing.querySelector(".wbe-image-lock-overlay") !== null;
            const isLockedByOther = existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id;
            if (hasLockOverlay || isLockedByOther) {
              const lockedBy = existing.dataset.lockedBy || "unknown";
              console.log(`[WB-E] Skipping socket update for image ${id} - locked by user ${lockedBy} (has overlay: ${hasLockOverlay})`);
              continue; // Don't update! This prevents crop changes!
            }
            // Обновляем существующий элемент
            ImageTools.updateImageElement(existing, imageData);
            
            // Sync rank if present in socket data (fractional indexing)
            // Only update if rank actually changed to avoid unnecessary DOM updates
            if (imageData.rank && typeof imageData.rank === 'string') {
              if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
                const currentRank = window.ZIndexManager.getRank(id);
                if (currentRank !== imageData.rank) {
                  window.ZIndexManager.setRank(id, imageData.rank);
                }
              }
            } else if (window.ZIndexManager && typeof window.ZIndexManager.has === 'function' && !window.ZIndexManager.has(id)) {
              // If no rank and object doesn't exist in manager, assign new rank
              if (typeof window.ZIndexManager.assignImage === 'function') {
                window.ZIndexManager.assignImage(id);
              }
            }
          } else {
            // Создаем новый элемент
            const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
            const maskTypeData = imageData.maskType || 'rect';
            const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
            const circleRadiusData = imageData.circleRadius || null;
            ImageTools.createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, null, imageData.isFrozen || false);
          }

          // Обновляем глобальные переменные для каждой картинки
          ImageTools.updateImageLocalVars(id, {
            maskType: imageData.maskType || 'rect',
            circleOffset: imageData.circleOffset || { x: 0, y: 0 },
            circleRadius: imageData.circleRadius,
            crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
            scale: imageData.scale || 1,
            isCropping: imageData.isCropping || false
          });
        }

        // Sync DOM z-indexes after updating all ranks
        if (window.ZIndexManager && typeof window.ZIndexManager.syncAllDOMZIndexes === 'function') {
          await window.ZIndexManager.syncAllDOMZIndexes();
        }

        // CRITICAL FIX: Only remove elements if they're explicitly missing from socket data
        // AND not actively being edited/manipulated (to prevent race conditions during rapid updates)
        existingElements.forEach(element => {
          if (!existingIds.has(element.id)) {
            // Don't remove if element is locked/being manipulated
            if (element.dataset.lockedBy) {
              console.log(`[WB-E] Preserving ${element.id} - locked by user ${element.dataset.lockedBy}`);
              return;
            }
            
            // FIX: Clean up image control panel before removing element
            if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.cleanup === "function") {
              try {
                window.wbeImageControlPanel.cleanup();
              } catch { }
            }
            // Clear runtime caches to prevent resurrection
            ImageTools.clearImageCaches(element.id);
            // Clean up ZIndexManager
            if (window.ZIndexManager && typeof window.ZIndexManager.remove === "function") {
              window.ZIndexManager.remove(element.id);
            }
            element.remove();
          }
        });
      }
    }


    // Запрос на обновление карточки от игрока
    if (data.type === "cardUpdateRequest") {
      console.log("[WB-E] GM received cardUpdateRequest:", data);
      // Игрок просит GM сохранить изменения карточки
      if (game.user.isGM) {
        const states = await getAllStates();
        if (states[data.id]) {
          console.log("[WB-E] GM updating card state:", data.patch);
          states[data.id] = foundry.utils.mergeObject(states[data.id], data.patch, { inplace: false });
          await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY);
          await new Promise(resolve => setTimeout(resolve, 50));
          await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY, states);

          // Обновляем локальное состояние приложения у GM
          const app = FateTableCardApp.instances.get(data.id);
          if (app) {
            app.cardData = foundry.utils.mergeObject(app.cardData, data.patch, { inplace: false });
            // Принудительно обновляем UI у GM
            app.render(true);
          }

          // Эмитим всем (включая отправителя) только изменения
          game.socket.emit(`module.${MODID}`, { type: "cardUpdate", id: data.id, state: data.patch });
        }
      }
    }

    // GM request handler for freeze actions
    if (data.type === "gm-request") {
      if (game.user.isGM && data.action === 'freeze-image') {
        try {
          console.log("[WB-E] GM received freeze request:", data.data);
          // Process freeze request authoritatively
          ImageTools.setImageFrozen(data.data.imageId, data.data.frozen, true);
        } catch (error) {
          console.error('[WB-E] Failed to process GM freeze request:', error);
        }
      }
    }

    // Freeze sync message handler
    if (data.type === "freeze-sync") {
      try {
        // Apply synchronized freeze state
        ImageTools.setImageFrozen(data.data.imageId, data.data.frozen, false);
      } catch (error) {
        console.error('[WB-E] Failed to apply freeze sync:', error);
      }
    }

    // Rank update handler (GM authority for fractional indexing)
    if (data.type === "rankUpdate") {
      if (game.user.isGM) {
        try {
          console.log(`[WB-E] GM received rank update for ${data.objectType} ${data.id}: ${data.rank}`);
          
          if (data.objectType === "image") {
            const images = await ImageTools.getAllImages();
            if (!images[data.id]) {
              console.warn(`[WB-E] Cannot update rank for non-existent image ${data.id}`);
              return;
            }
            
            // Update only the rank for this specific image in database
            images[data.id].rank = data.rank;
            // Save to database without triggering socket broadcast (we'll use rankConfirm instead)
            await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_IMAGES);
            await new Promise(resolve => setTimeout(resolve, 50));
            await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, images);
            
            // Broadcast confirmation to all clients (including sender)
            serverSeq++;
            game.socket.emit(`module.${MODID}`, {
              type: "rankConfirm",
              objectType: data.objectType,
              id: data.id,
              rank: data.rank,
              serverSeq: serverSeq
            });
            
            console.log(`[WB-E] GM confirmed rank update for ${data.id}, serverSeq: ${serverSeq}`);
          } else if (data.objectType === "text") {
            const texts = await TextTools.getAllTexts();
            if (!texts[data.id]) {
              console.warn(`[WB-E] Cannot update rank for non-existent text ${data.id}`);
              return;
            }
            
            // Update only the rank for this specific text in database
            texts[data.id].rank = data.rank;
            // Save to database without triggering socket broadcast (we'll use rankConfirm instead)
            await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
            await new Promise(resolve => setTimeout(resolve, 50));
            await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, texts);
            
            // Broadcast confirmation to all clients (including sender)
            serverSeq++;
            game.socket.emit(`module.${MODID}`, {
              type: "rankConfirm",
              objectType: data.objectType,
              id: data.id,
              rank: data.rank,
              serverSeq: serverSeq
            });
            
            console.log(`[WB-E] GM confirmed rank update for ${data.id}, serverSeq: ${serverSeq}`);
          }
        } catch (error) {
          console.error('[WB-E] GM failed to process rank update:', error);
        }
      }
    }

    // Rank confirmation handler (all clients)
    if (data.type === "rankConfirm") {
      try {
        console.log(`[WB-E] Received rank confirmation for ${data.objectType} ${data.id}: ${data.rank}, serverSeq: ${data.serverSeq}`);
        
        if (data.objectType === "image") {
          // Update local rank in manager
          if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
            const currentRank = window.ZIndexManager.getRank(data.id);
            // Only update if rank actually changed (avoid unnecessary DOM updates)
            if (currentRank !== data.rank) {
              window.ZIndexManager.setRank(data.id, data.rank);
              
              // Refresh DOM z-index order
              await window.ZIndexManager.syncAllDOMZIndexes();
              
              console.log(`[WB-E] Applied rank ${data.rank} to ${data.id} (was ${currentRank})`);
            } else {
              console.log(`[WB-E] Rank ${data.rank} already applied to ${data.id}, skipping`);
            }
          }
        } else if (data.objectType === "text") {
          // Update local rank in manager
          if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
            const currentRank = window.ZIndexManager.getRank(data.id);
            // Only update if rank actually changed (avoid unnecessary DOM updates)
            if (currentRank !== data.rank) {
              window.ZIndexManager.setRank(data.id, data.rank);
              
              // Refresh DOM z-index order
              await window.ZIndexManager.syncAllDOMZIndexes();
              
              console.log(`[WB-E] Applied rank ${data.rank} to ${data.id} (was ${currentRank})`);
            } else {
              console.log(`[WB-E] Rank ${data.rank} already applied to ${data.id}, skipping`);
            }
          }
        }
      } catch (error) {
        console.error('[WB-E] Failed to apply rank confirmation:', error);
      }
    }

    // Сохранение base64 изображения от игрока как файл
    if (data.type === "saveBase64Image") {
      console.log("[WB-E] GM received base64 image from player:", data.fileName);
      if (game.user.isGM) {
        try {
          // Convert base64 to File object
          const base64Data = data.base64.split(',')[1]; // Remove data:image/jpeg;base64, prefix
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const file = new File([bytes], data.fileName, { type: 'image/jpeg' });
          const uploadPath = `worlds/${game.world.id}`;

          console.log("[WB-E] GM saving base64 image as file:", data.fileName);
          const response = await foundry.applications.apps.FilePicker.implementation.upload("data", uploadPath, file, {}, {
            notify: false
          });

          if (response?.path) {
            console.log("[WB-E] GM successfully saved base64 image:", response.path);

            // Update the card with the proper file path
            const states = await getAllStates();
            if (states[data.cardId]) {
              states[data.cardId].portrait = response.path;
              await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY);
              await new Promise(resolve => setTimeout(resolve, 50));
              await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY, states);

              // Update GM's local app
              const app = FateTableCardApp.instances.get(data.cardId);
              if (app) {
                app.cardData.portrait = response.path;
              }

              // Broadcast the proper file path to all clients
              game.socket.emit(`module.${MODID}`, {
                type: "cardUpdate",
                id: data.cardId,
                state: { portrait: response.path }
              });

              console.log("[WB-E] GM broadcasted proper file path to all clients");
            }
          }
        } catch (error) {
          console.error("[WB-E] GM failed to save base64 image:", error);
        }
      }
    }

    // Сохранение base64 изображения от игрока для canvas как файл
    if (data.type === "saveCanvasBase64Image") {
      console.log("[WB-E] GM received canvas base64 image from player:", data.fileName);
      if (game.user.isGM) {
        try {
          // Convert base64 to File object
          const base64Data = data.base64.split(',')[1]; // Remove data:image/jpeg;base64, prefix
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const file = new File([bytes], data.fileName, { type: 'image/jpeg' });
          const uploadPath = `worlds/${game.world.id}`;

          console.log("[WB-E] GM saving canvas base64 image as file:", data.fileName);
          const response = await foundry.applications.apps.FilePicker.implementation.upload("data", uploadPath, file, {}, {
            notify: false
          });

          if (response?.path) {
            console.log("[WB-E] GM successfully saved canvas base64 image:", response.path);

            // Broadcast the proper file path to all clients for canvas image replacement
            game.socket.emit(`module.${MODID}`, {
              type: "replaceCanvasBase64WithFile",
              base64Path: data.base64,

              filePath: response.path,
              fileName: data.fileName
            });

            console.log("[WB-E] GM broadcasted canvas file path to all clients");
          }
        } catch (error) {
          console.error("[WB-E] GM failed to save canvas base64 image:", error);
        }
      }
    }

    // Замена base64 изображения на canvas на правильный файл
    if (data.type === "replaceCanvasBase64WithFile") {
      console.log("[WB-E] Replacing canvas base64 image with file:", data.filePath);
      // Найти все canvas изображения с base64 путем и заменить на файл
      const layer = getOrCreateLayer();
      if (layer) {
        const imageElements = layer.querySelectorAll(".wbe-canvas-image");
        imageElements.forEach(img => {
          if (img.src === data.base64Path || img.src.includes(data.fileName)) {
            console.log("[WB-E] Replacing canvas image source:", img.src, "->", data.filePath);
            img.src = data.filePath;

            // Обновить данные в хранилище через ImageTools
            const container = img.closest(".wbe-canvas-image-container");
            if (container) {
              const imageId = container.id;
              console.log("[WB-E] Updating image data for:", imageId);
              // Use ImageTools to update the image data properly
              ImageTools.updateImageLocalVars(imageId, { src: data.filePath });
            }
          }
        });
      }
    }

    // Обновление карточки от GM
    if (data.type === "cardUpdate") {
      // Обновляем UI у всех (включая отправителя)
      const app = FateTableCardApp.instances.get(data.id);
      if (app && data.state) {
        app.cardData = foundry.utils.mergeObject(app.cardData, data.state, { inplace: false });

        // Обновляем позицию и масштаб если они изменились
        if (data.state.pos) {
          app.setPosition(data.state.pos);
        }
        if (data.state.scale !== undefined) {
          app.applyScale();
        }

        // Если изменились другие поля - перерендерим
        const hasOtherChanges = Object.keys(data.state).some(key => key !== 'pos' && key !== 'scale');
        if (hasOtherChanges) {
          app.render(true);
        }
      }
    }

    // Блокировка изображения (вход в crop mode)
    if (data.type === "imageLock") {
      const container = document.getElementById(data.imageId);
      if (container && data.userId !== game.user.id) {
        // Показываем визуальную блокировку для других пользователей
        ImageTools.applyImageLockVisual(container, data.userId, data.userName);
      }
    }

    // Разблокировка изображения (выход из crop mode)
    if (data.type === "imageUnlock") {
      const container = document.getElementById(data.imageId);
      if (container) {
        // Убираем визуальную блокировку
        ImageTools.removeImageLockVisual(container);
      }
    }

    // NEW: Handle text lock
    if (data.type === "textLock") {
      console.log(`[WB-E] Received textLock for ${data.textId} from ${data.userName}`);
      const container = document.getElementById(data.textId);
      if (container && data.userId !== game.user.id) {
        TextTools.applyTextLockVisual(container, data.userId, data.userName, data.width, data.height);
      }
    }

    // NEW: Handle text unlock
    if (data.type === "textUnlock") {
      console.log(`[WB-E] Received textUnlock for ${data.textId}`);
      const container = document.getElementById(data.textId);
      if (container) {
        TextTools.removeTextLockVisual(container);
      }
    }

    // NEW: Handle lock request - respond with our active locks
    if (data.type === "requestLocks") {
      const activeLocks = getActiveLocks();
      if (activeLocks.textLocks.length > 0 || activeLocks.imageLocks.length > 0) {
        game.socket.emit(`module.${MODID}`, {
          type: "locksResponse",
          userId: game.user.id,
          userName: game.user.name,
          textLocks: activeLocks.textLocks,
          imageLocks: activeLocks.imageLocks
        });
      }
    }

    // NEW: Handle lock response - apply received locks to elements
    if (data.type === "locksResponse") {
      // Only apply locks from other users
      if (data.userId !== game.user.id) {
        // Apply text locks
        if (data.textLocks && Array.isArray(data.textLocks)) {
          data.textLocks.forEach(lock => {
            const container = document.getElementById(lock.textId);
            if (container) {
              TextTools.applyTextLockVisual(container, lock.userId, lock.userName, lock.width, lock.height);
            }
          });
        }
        // Apply image locks
        if (data.imageLocks && Array.isArray(data.imageLocks)) {
          data.imageLocks.forEach(lock => {
            const container = document.getElementById(lock.imageId);
            if (container) {
              ImageTools.applyImageLockVisual(container, lock.userId, lock.userName);
            }
          });
        }
      }
    }
  });
});

/* ----------------------- Canvas Layer -------------------- */
function getOrCreateLayer() {
  // Check if layer already exists
  let layer = document.getElementById("whiteboard-experience-layer");
  if (layer) return layer;

  // Find canvas board
  const board = document.getElementById("board");
  if (!board) {
    console.warn("[WB-E] #board not found, cannot create cards layer");
    return null;
  }

  // Create layer NEXT to board (not inside!), as sibling
  layer = document.createElement("div");
  layer.id = "whiteboard-experience-layer";
  layer.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
    transform-origin: 0 0;
  `;

  // Insert after board, not inside
  board.parentElement.insertBefore(layer, board.nextSibling);

  // Enable pointer-events for child elements
  layer.addEventListener("pointerdown", (e) => {
    if (e.target !== layer) e.stopPropagation();
  });

  return layer;
}

function createCardsLayer() {
  return getOrCreateLayer();
}

// Make getOrCreateLayer globally available
window.getOrCreateLayer = getOrCreateLayer;

let _syncLogCounter = 0;
function syncCardsWithCanvas() {
  const layer = getOrCreateLayer();
  const board = document.getElementById("board");
  if (!layer || !board || !canvas?.ready || !canvas.stage) return;

  // Получить позицию board для синхронизации
  const boardRect = board.getBoundingClientRect();

  // Применить трансформацию canvas
  const transform = canvas.stage.worldTransform;
  const { a: scale, tx, ty } = transform;

  // DEBUG: Логировать каждый 60й кадр
  if (window._debugFateSync && _syncLogCounter++ % 60 === 0) {
    const card = document.querySelector("#whiteboard-experience-layer > *");
    const cardRect = card?.getBoundingClientRect();
  }

  // Синхронизировать позицию и трансформацию с board
  layer.style.left = boardRect.left + 'px';
  layer.style.top = boardRect.top + 'px';
  layer.style.width = boardRect.width + 'px';
  layer.style.height = boardRect.height + 'px';
  layer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

// Непрерывная синхронизация через requestAnimationFrame для плавности
let syncAnimationId = null;
function startContinuousSync() {
  if (syncAnimationId) return; // Уже запущена

  function tick() {
    syncCardsWithCanvas();
    syncAnimationId = requestAnimationFrame(tick);
  }

  syncAnimationId = requestAnimationFrame(tick);
}

function stopContinuousSync() {
  if (syncAnimationId) {
    cancelAnimationFrame(syncAnimationId);
    syncAnimationId = null;
  }
}

// Конвертация экранных координат в world coordinates (координаты на canvas)
function screenToWorld(screenX, screenY) {
  if (!canvas?.ready || !canvas?.stage?.worldTransform) {
    console.warn("[WB-E] Canvas not ready, using screen coordinates");
    return { x: screenX, y: screenY };
  }
  try {
    const transform = canvas.stage.worldTransform;
    const inverted = transform.clone().invert();
    const point = inverted.apply({ x: screenX, y: screenY });
    return { x: point.x, y: point.y };
  } catch (e) {
    console.error("[WB-E] screenToWorld error:", e);
    return { x: screenX, y: screenY };
  }
}

// Конвертация world coordinates в экранные координаты
function worldToScreen(worldX, worldY) {
  if (!canvas?.ready) return { x: worldX, y: worldY };
  const transform = canvas.stage.worldTransform;
  const point = transform.apply({ x: worldX, y: worldY });
  return { x: point.x, y: point.y };
}

/* ----------------------- Toolbar inject ------------------ */
async function injectFateCardTool() {
  const sc = ui.controls;
  if (!sc || !sc.controls) return;

  const groupsObj = sc.controls; // объект групп в некоторых системах
  const group =
    groupsObj.tokens || groupsObj.token || groupsObj.notes ||
    Object.values(groupsObj)[0];

  if (!group) return;

  const toolName = "wbe-table-card";
  const tool = {
    name: toolName,
    title: "Добавить FATE Card",
    icon: "fas fa-id-card",
    button: true,
    onChange: async () => {
      if (!game.user.isGM) return ui.notifications.warn("Добавлять карточки может только GM.");
      const { id, state } = await createCardState();
      FateTableCardApp.show(id, state);
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
}

/* ----------------------- Mass Selection Tool ------------------ */
// Load toggle state from localStorage, default to false (Ctrl+drag mode)
let massSelectionToggleState = localStorage.getItem('wbe-mass-selection-toggle') === 'true';

async function injectMassSelectionTool() {
  const sc = ui.controls;
  if (!sc || !sc.controls) return;

  const groupsObj = sc.controls;
  const group =
    groupsObj.tokens || groupsObj.token || groupsObj.notes ||
    Object.values(groupsObj)[0];

  if (!group) return;

  const toolName = "wbe-mass-selection";
  const tool = {
    name: toolName,
    title: massSelectionToggleState ?
      "Mass Selection: ON (Default drag to select)" :
      "Mass Selection: OFF (Ctrl+drag to select)",
    icon: massSelectionToggleState ? "fas fa-mouse-pointer" : "fas fa-mouse-pointer",
    button: true,
    active: massSelectionToggleState,
    onChange: async () => {
      // Toggle mass selection mode
      massSelectionToggleState = !massSelectionToggleState;

      // Save toggle state to localStorage
      localStorage.setItem('wbe-mass-selection-toggle', massSelectionToggleState.toString());

      // Update the tool state
      tool.active = massSelectionToggleState;
      tool.title = massSelectionToggleState ?
        "Mass Selection: ON (Default drag to select)" :
        "Mass Selection: OFF (Ctrl+drag to select)";

      // Update MassSelection system
      MassSelection.setToggleState(massSelectionToggleState);

      // Clear any current selection when toggling
      MassSelection.clear();

      // Update button visual state
      setTimeout(() => {
        const toolButton = document.querySelector(`[data-tool="wbe-mass-selection"]`);
        if (toolButton) {
          toolButton.classList.remove("wbe-mass-selection-toggle-on", "wbe-mass-selection-toggle-off");
          toolButton.classList.add(massSelectionToggleState ? "wbe-mass-selection-toggle-on" : "wbe-mass-selection-toggle-off");
        }
      }, 100);

      // Show notification
      if (massSelectionToggleState) {
        ui.notifications.info("Mass Selection: ON - Default mouse drag to select objects");
      } else {
        ui.notifications.info("Mass Selection: OFF - Ctrl+drag to select objects");
      }

      // Re-render to update button appearance
      await sc.render?.(true);
    }
  };

  const t = group.tools;
  const exists = Array.isArray(t) ? t.some(x => x?.name === toolName) : t?.[toolName];
  if (exists) {
    // Update existing tool
    const existingTool = Array.isArray(t) ? t.find(x => x?.name === toolName) : t[toolName];
    if (existingTool) {
      existingTool.active = massSelectionToggleState;
      existingTool.title = massSelectionToggleState ?
        "Mass Selection: ON (Default drag to select)" :
        "Mass Selection: OFF (Ctrl+drag to select)";
    }
    return;
  }

  if (Array.isArray(t)) t.push(tool);
  else if (t && typeof t === "object") {
    t[toolName] = tool;
    if (Array.isArray(group._toolOrder)) group._toolOrder.unshift(toolName); // Add to beginning
  } else group.tools = [tool];

  await sc.render?.(true);

  // Apply initial visual state
  setTimeout(() => {
    const toolButton = document.querySelector(`[data-tool="wbe-mass-selection"]`);
    if (toolButton) {
      toolButton.classList.add(massSelectionToggleState ? "wbe-mass-selection-toggle-on" : "wbe-mass-selection-toggle-off");
    }
  }, 100);
}

/* ----------------------- Text Tool ------------------ */
let lastClickX = window.innerWidth / 2;
let lastClickY = window.innerHeight / 2;
let lastMouseX = window.innerWidth / 2;
let lastMouseY = window.innerHeight / 2;

// Z-Index Ranges - Reserved ranges for different element types
const ZIndexRanges = {
  // Editable content objects (text, images, cards) - shared range
  EDITABLE_MIN: 1000,
  EDITABLE_MAX: 8999,
  
  // UI Gizmos & Overlays (immutable, always on top)
  UI_GIZMOS_MIN: 10000,
  UI_GIZMOS_MAX: 19999,
  
  // Control Panels & Dialogs (immutable, always on top)
  UI_PANELS_MIN: 20000,
  UI_PANELS_MAX: 29999,
  
  // Mass Selection UI (immutable, always on top)
  UI_MASS_SELECTION_MIN: 30000,
};

// Z-Index Constants - Specific values for UI elements
const ZIndexConstants = {
  // Selection borders
  SELECTION_BORDER: 10000,
  SELECTION_BORDER_ACTIVE: 10001,
  SELECTION_BORDER_FROZEN: 10200,
  
  // Resize handles
  RESIZE_HANDLE: 10100,
  TEXT_RESIZE_HANDLE: 10101,
  CROP_HANDLE: 10102,
  
  // Lock overlays
  LOCK_OVERLAY: 10200,
  UNFREEZE_ICON: 10201,
  
  // Control panels
  IMAGE_CONTROL_PANEL: 20000,
  TEXT_COLOR_PICKER: 20100,
  FROZEN_CONTROL_PANEL: 20200,
  
  // Mass selection
  SELECTION_BOX: 30000,
  SELECTION_INDICATOR: 30001,
  BOUNDING_BOX: 30002,
};

// Import the compact z-index management system directly
import { CompactZIndexManager } from "./modules/compact-zindex-manager.mjs";

// Z-Index Manager - Direct usage of CompactZIndexManager (no wrapper!)
const ZIndexManagerInstance = new CompactZIndexManager();

// Shared queue for z-index operations to prevent race conditions across all modules
const zIndexOperationQueue = [];
let isProcessingZIndexOperation = false;

// Process z-index operations one at a time (shared across all modules)
async function processZIndexOperation(operation) {
  if (isProcessingZIndexOperation) {
    zIndexOperationQueue.push(operation);
    return;
  }
  
  isProcessingZIndexOperation = true;
  try {
    await operation();
  } finally {
    isProcessingZIndexOperation = false;
    if (zIndexOperationQueue.length > 0) {
      const nextOp = zIndexOperationQueue.shift();
      processZIndexOperation(nextOp);
    }
  }
}

// Wrap ZIndexManager.moveUp and moveDown with queue system
const ZIndexManager = new Proxy(ZIndexManagerInstance, {
  get(target, prop) {
    if (prop === 'moveUp' || prop === 'moveDown') {
      return async function(objectId) {
        return new Promise((resolve) => {
          processZIndexOperation(async () => {
            const result = target[prop](objectId);
            // With fractional indexing, no deduplication needed - each object has a unique rank
            resolve(result);
          });
        });
      };
    }
    // Bind methods to preserve 'this' context
    if (typeof target[prop] === 'function') {
      return target[prop].bind(target);
    }
    return target[prop];
  }
});

// ===== Utility Functions =====
// Helper functions for prefix-based filtering and migration

/**
 * Get all text objects with their z-indexes
 * @returns {Array} Array of [id, zIndex] tuples for text objects
 */
function getAllTexts() {
  const texts = [];
  const allObjects = ZIndexManager.getAllObjectsSorted();
  for (const obj of allObjects) {
    if (obj.id.startsWith('wbe-text-')) {
      texts.push([obj.id, ZIndexManager.get(obj.id)]);
    }
  }
  return texts;
}

/**
 * Get all image objects with their z-indexes
 * @returns {Array} Array of [id, zIndex] tuples for image objects
 */
function getAllImages() {
  const images = [];
  const allObjects = ZIndexManager.getAllObjectsSorted();
  for (const obj of allObjects) {
    if (obj.id.startsWith('wbe-image-')) {
      images.push([obj.id, ZIndexManager.get(obj.id)]);
    }
  }
  return images;
}

/**
 * Check if a text object exists
 * @param {string} textId - The text object ID
 * @returns {boolean} True if object exists
 */
function hasText(textId) {
  return ZIndexManager.has(textId);
}

/**
 * Check if an image object exists
 * @param {string} imageId - The image object ID
 * @returns {boolean} True if object exists
 */
function hasImage(imageId) {
  return ZIndexManager.has(imageId);
}

// Attach utility functions to ZIndexManager for backward compatibility
ZIndexManager.getAllTexts = getAllTexts;
ZIndexManager.getAllImages = getAllImages;
ZIndexManager.hasText = hasText;
ZIndexManager.hasImage = hasImage;



// Expose shared variables for text module (mutable primitives only)
export function getSharedVars() {
  return {
    lastMouseX,
    lastMouseY,
    lastClickX,
    lastClickY,
    copiedImageData: ImageTools.copiedImageData,
    selectedImageId: ImageTools.selectedImageId,
  };
}

// Export ZIndexManager, ZIndexRanges, and ZIndexConstants for use by text and image modules
export { ZIndexManager, ZIndexRanges, ZIndexConstants, fixInteractionIssues };

// Make ZIndexManager globally accessible for console debugging
window.ZIndexManager = ZIndexManager;
window.ZIndexRanges = ZIndexRanges;
window.ZIndexConstants = ZIndexConstants;

/**
 * Fix interaction issues after z-index system changes
 * Call this to restore proper functionality after major z-index operations
 */
async function fixInteractionIssues() {
  console.log('[WB-E] Fixing interaction issues after z-index changes...');
  
  // Fix 1: Sync all DOM z-index values with manager
  await ZIndexManager.syncAllDOMZIndexes();
  
  // Fix 2: Re-initialize unfreeze icons
  let unfreezeCount = 0;
  if (typeof ImageTools !== 'undefined' && ImageTools.reinitializeUnfreezeIcons) {
    unfreezeCount = ImageTools.reinitializeUnfreezeIcons();
  }
  
  // Fix 3: Reset pointer-events for interactive objects
  let pointerFixCount = 0;
  
  // Fix image containers
  const imageContainers = document.querySelectorAll('.wbe-canvas-image-container');
  imageContainers.forEach(container => {
    const isFrozen = container.classList.contains('wbe-image-frozen');
    const isSelected = container.classList.contains('selected');
    const clickTarget = container.querySelector('.wbe-image-click-target');
    
    if (!isFrozen) {
      // Non-frozen images should be interactive
      if (isSelected) {
        // Selected images: container has pointer-events: none, click target has auto
        container.style.setProperty("pointer-events", "none", "important");
        if (clickTarget) {
          clickTarget.style.setProperty("pointer-events", "auto", "important");
        }
      } else {
        // Deselected images: both have pointer-events: none for canvas pass-through
        container.style.setProperty("pointer-events", "none", "important");
        if (clickTarget) {
          clickTarget.style.setProperty("pointer-events", "none", "important");
        }
      }
      pointerFixCount++;
    }
  });
  
  // Fix text containers
  const textContainers = document.querySelectorAll('.wbe-canvas-text-container');
  textContainers.forEach(container => {
    const isSelected = container.dataset.selected === 'true';
    const textElement = container.querySelector('.wbe-canvas-text');
    
    if (isSelected) {
      // Selected text: container auto, text element auto
      container.style.setProperty("pointer-events", "auto", "important");
      if (textElement) {
        textElement.style.setProperty("pointer-events", "auto", "important");
      }
    } else {
      // Deselected text: both have pointer-events: none
      container.style.setProperty("pointer-events", "none", "important");
      if (textElement) {
        textElement.style.setProperty("pointer-events", "none", "important");
      }
    }
    pointerFixCount++;
  });
  
  console.log(`[WB-E] Fixed interactions: ${syncCount} z-indexes synced, ${unfreezeCount} unfreeze icons, ${pointerFixCount} pointer-events fixed`);
}

// Make fix function globally accessible
window.fixInteractionIssues = fixInteractionIssues;

export function setSelectedImageId(value) {
  ImageTools.selectedImageId = value;
}

export function setCopiedImageData(value) {
  ImageTools.copiedImageData = value;
}

export function setLastClickX(value) {
  lastClickX = value;
}

export function setLastClickY(value) {
  lastClickY = value;
}




// Функция для снятия выделения со ВСЕХ элементов (кроме exceptId)
function deselectAllElements(exceptId = null) {

  // CLEAR MASS SELECTION when deselecting all elements
  if (window.MassSelection && window.MassSelection.selectedCount > 0) {
    window.MassSelection.clear();
  }

  // FIX: Clean up all panels before deselecting elements
  // Kill color panel for text elements
  if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
    try {
      window.wbeColorPanel.cleanup();
    } catch { }
  }

  // Kill image control panel
  if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.cleanup === "function") {
    try {
      window.wbeImageControlPanel.cleanup();
    } catch { }
  }

  // Снимаем выделение со всех текстов
  document.querySelectorAll(".wbe-canvas-text-container").forEach(container => {
    if (exceptId && container.id === exceptId) return; // Пропускаем текущий

    const textElement = container.querySelector(".wbe-canvas-text");
    const resizeHandle = container.querySelector(".wbe-text-resize-handle");
    if (textElement && resizeHandle) {
      delete container.dataset.selected; // Убираем метку
      container.style.removeProperty("pointer-events");
      textElement.style.removeProperty("outline");
      textElement.style.removeProperty("outline-offset");
      container.style.removeProperty("cursor");
      resizeHandle.style.display = "none";
    } else {
    }
  });

  // Снимаем выделение со всех картинок
  document.querySelectorAll(".wbe-canvas-image-container").forEach(container => {
    if (exceptId && container.id === exceptId) {
      return; // Пропускаем текущий
    }

    const imageElement = container.querySelector(".wbe-canvas-image");
    const resizeHandle = container.querySelector(".wbe-image-resize-handle");
    const selectionBorder = container.querySelector(".wbe-image-selection-border");
    if (imageElement && resizeHandle) {
      delete container.dataset.selected; // Убираем метку
      container.style.removeProperty("pointer-events");
      container.style.removeProperty("cursor");
      resizeHandle.style.display = "none";
      if (selectionBorder) selectionBorder.style.display = "none";
    } else {
    }
  });

  // Очищаем selection
  window.getSelection().removeAllRanges();
}

// Отслеживаем позицию мыши для вставки
document.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

// Глобальная функция вставки картинки




// Глобальный обработчик COPY для сброса наших буферов при копировании внешнего контента
document.addEventListener("copy", (e) => {
  // Если копирование происходит НЕ от наших элементов → сбрасываем буферы
  if (!TextTools.selectedTextId && !ImageTools.selectedImageId) {
    TextTools.copiedTextData = null;
    ImageTools.copiedImageData = null;
  }
}, true); // capture phase - раньше всех

// Paste multi-selection functionality
async function pasteMultiSelection() {
  if (!window.wbeCopiedMultiSelection) return;

  console.log("[WB-E] Pasting multi-selection");

  const { texts, images } = window.wbeCopiedMultiSelection;
  const offset = 20; // Offset for pasted elements

  // Get current mouse position
  const { lastMouseX, lastMouseY } = getSharedVars();
  const worldPos = screenToWorld(lastMouseX, lastMouseY);

  // Paste texts
  for (const [id, textData] of Object.entries(texts)) {
    const newId = `wbe-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newLeft = worldPos.x + (textData.left || 0) + offset;
    const newTop = worldPos.y + (textData.top || 0) + offset;

    TextTools.createTextElement(
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

    // Save the new text
    await TextTools.persistTextState(newId, document.getElementById(newId)?.querySelector(".wbe-canvas-text"), document.getElementById(newId));
  }

  // Paste images
  for (const [id, imageData] of Object.entries(images)) {
    const newId = `wbe-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newLeft = worldPos.x + (imageData.left || 0) + offset;
    const newTop = worldPos.y + (imageData.top || 0) + offset;

    const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const maskTypeData = imageData.maskType || 'rect';
    const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
    const circleRadiusData = imageData.circleRadius || null;

    ImageTools.createImageElement(newId, imageData.src, newLeft, newTop, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, null, imageData.isFrozen || false);

    // Save the new image
    await ImageTools.persistImageState(newId, document.getElementById(newId)?.querySelector(".wbe-canvas-image"), document.getElementById(newId));
  }

  console.log("[WB-E] Multi-selection pasted successfully");
}

// Глобальный обработчик Ctrl+V для вставки из системного буфера
function setupGlobalPasteHandler() {
  document.addEventListener("paste", async (e) => {
    console.log("[WB-E] Global paste handler triggered, activeElement:", document.activeElement);

    // Игнорируем если фокус на input/textarea (чтобы не мешать обычной вставке)
    if (document.activeElement &&
      (document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA" ||
        document.activeElement.isContentEditable)) {
      console.log("[WB-E] Global paste handler: ignoring paste for input/textarea");
      return;
    }

    // Игнорируем если фокус на fate card portrait (чтобы не мешать вставке в аватар)
    if (document.activeElement &&
      document.activeElement.classList &&
      document.activeElement.classList.contains("ftc-portrait")) {
      console.log("[WB-E] Global paste handler: ignoring paste for fate card portrait");
      return;
    }

    // Сначала проверяем системный буфер - что РЕАЛЬНО там сейчас
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    if (!items) return;

    // Проверяем что в буфере
    let hasImage = false;
    let hasText = false;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        hasImage = true;
        break;
      }
      if (items[i].type === "text/plain") {
        hasText = true;
      }
    }

    // ПРИОРИТЕТ 1: Картинка из системного буфера
    if (hasImage) {
      console.log("[WB-E] Global paste handler: processing image paste");
      e.preventDefault();
      e.stopPropagation();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            console.log("[WB-E] Global paste handler: calling ImageTools.handleImagePasteFromClipboard");
            await ImageTools.handleImagePasteFromClipboard(file);
            return;
          }
        }
      }
    }

    // ПРИОРИТЕТ 2: Текст из системного буфера (или маркер картинки/текста)
    if (hasText) {
      const text = clipboardData.getData("text/plain");
      if (text && text.trim()) {
        // Проверяем - это маркер нашей картинки?
        if (text.startsWith("[wbe-IMAGE-COPY:") && ImageTools.copiedImageData) {
          e.preventDefault();
          e.stopPropagation();
          await ImageTools.globalPasteImage();
          return;
        }

        // Проверяем - это маркер нашего текста с форматированием?
        if (text.startsWith("[wbe-TEXT-COPY:") && TextTools.copiedTextData) {
          e.preventDefault();
          e.stopPropagation();
          await TextTools.globalPasteText();
          return;
        }

        // Обычный текст из внешнего источника
        e.preventDefault();
        e.stopPropagation();
        await TextTools.handleTextPasteFromClipboard(text.trim());
        return;
      }
    }

    // FALLBACK: Если системный буфер пуст, используем наши скопированные элементы
    // Check for multi-selection paste first
    if (window.wbeCopiedMultiSelection) {
      e.preventDefault();
      e.stopPropagation();
      await pasteMultiSelection();
      return;
    }

    // Check for mass selection paste
    if (MassSelection.selectedCount > 0) {
      e.preventDefault();
      e.stopPropagation();
      await MassSelection.paste();
      return;
    }

    if (ImageTools.copiedImageData) {
      e.preventDefault();
      e.stopPropagation();
      await ImageTools.globalPasteImage();
      return;
    }

    if (TextTools.copiedTextData) {
      e.preventDefault();
      e.stopPropagation();
      await TextTools.globalPasteText();
      return;
    }
  });
}



// Вставка текста из системного буфера






/**
 * Get all currently active locks from DOM
 * Returns locks that are currently set (user is actively editing/cropping)
 */
function getActiveLocks() {
  const textLocks = [];
  const imageLocks = [];
  
  const layer = getOrCreateLayer();
  if (!layer) return { textLocks, imageLocks };
  
  // Find all locked text elements (only return if actively editing)
  const textContainers = layer.querySelectorAll('.wbe-canvas-text-container');
  textContainers.forEach(container => {
    const textElement = container.querySelector('.wbe-canvas-text');
    // Only return locks if user is actively editing (contentEditable === 'true')
    if (textElement && textElement.contentEditable === 'true') {
      const scale = parseFloat(textElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1;
      const width = textElement.offsetWidth * scale;
      const height = textElement.offsetHeight * scale;
      textLocks.push({
        textId: container.id,
        userId: game.user.id,
        userName: game.user.name,
        width: width,
        height: height
      });
    }
  });
  
  // Find all locked image elements (only return if actively cropping)
  const imageContainers = layer.querySelectorAll('.wbe-canvas-image-container');
  imageContainers.forEach(container => {
    // Only return locks if user is actively cropping (data-cropping === 'true')
    if (container.dataset.cropping === 'true') {
      imageLocks.push({
        imageId: container.id,
        userId: game.user.id,
        userName: game.user.name
      });
    }
  });
  
  return { textLocks, imageLocks };
}

/**
 * Request active locks from all connected users
 * This is called after page load to restore locks after refresh (F5)
 */
function requestActiveLocks() {
  // Broadcast request to all users
  game.socket.emit(`module.${MODID}`, {
    type: "requestLocks",
    userId: game.user.id
  });
}

async function loadCanvasElements() {
  const texts = await TextTools.getAllTexts();
  const images = await ImageTools.getAllImages();

  // Sync ZIndexManager with existing z-index and rank values
  // IMPORTANT: Include ALL objects even without zIndex/rank - migration will assign ranks to them
  const textData = Object.entries(texts).map(([id, data]) => ({
    id,
    zIndex: data.zIndex,
    rank: data.rank,
    type: 'text'
  }));
  
  const imageData = Object.entries(images).map(([id, data]) => ({
    id,
    zIndex: data.zIndex,
    rank: data.rank,
    type: 'image'
  }));
  
  const allData = [...textData, ...imageData];
  ZIndexManager.syncWithExisting(allData);

  // Восстановить тексты
  for (const [id, data] of Object.entries(texts)) {
    TextTools.createTextElement(
      id,
      data.text,
      data.left,
      data.top,
      data.scale,
      data.color,
      data.backgroundColor,
      data.borderColor,
      data.borderWidth,
      data.fontWeight,
      data.fontStyle,
      data.textAlign || TextTools.DEFAULT_TEXT_ALIGN,
      data.fontFamily || TextTools.DEFAULT_FONT_FAMILY,
      data.fontSize || TextTools.DEFAULT_FONT_SIZE,
      data.width,
      data.zIndex // Pass existing z-index
    );
  }

  for (const [id, data] of Object.entries(texts)) {
    if (data.width && data.width > 0) {
      console.log('textData.width', data.width);
    }
  }

  // Восстановить картинки
  for (const [id, data] of Object.entries(images)) {
    // Validate image data before creating element
    if (!data.src || typeof data.src !== 'string') {
      console.warn(`[WB-E] Skipping image ${id}: invalid or missing src`);
      continue;
    }

    const cropData = data.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const maskTypeData = data.maskType || 'rect';
    const circleOffsetData = data.circleOffset || { x: 0, y: 0 };
    const circleRadiusData = data.circleRadius || null;

    try {
      ImageTools.createImageElement(id, data.src, data.left, data.top, data.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, null, data.isFrozen || false);
    } catch (error) {
      console.error(`[WB-E] Failed to restore image ${id}:`, error);
    }
  }
}

/* ----------------------- Storage (multi) ----------------- */
// scene.flags[MODID].cards = { [id]: state }

async function getAllStates() {
  try {
    const states = await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY) || {};
    return states;
  }
  catch (e) {
    console.error("[WB-E] getAllStates error:", e);
    return {};
  }
}

async function setAllStates(states, broadcast = true) {
  try {
    // ИСПРАВЛЕНИЕ: unsetFlag + setFlag для надёжного сохранения в базу
    await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY);
    await new Promise(resolve => setTimeout(resolve, 50)); // Небольшая пауза
    await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY, states);

    if (broadcast) game.socket.emit(`module.${MODID}`, { type: "bulk", states });
  } catch (e) {
    console.error("[WB-E] setAllStates error:", e);
  }
}

function newCardId() {
  return "fc_" + Math.random().toString(36).slice(2, 8) + "_" + Date.now().toString(36);
}

async function createCardState() {
  const states = await getAllStates();
  const id = newCardId();
  const offset = Object.keys(states).length * 24;

  // Создаём карточку в центре экрана, но храним в world coordinates
  const centerScreen = { x: window.innerWidth / 2 - 280, y: window.innerHeight / 2 - 200 };
  const worldPos = screenToWorld(centerScreen.x + offset, centerScreen.y + offset);

  const def = {
    pos: { left: worldPos.x, top: worldPos.y, width: 1060, height: "auto" },
    scale: 1.0,
    name: "Имя Персонажа",
    portrait: "",
    approaches: [
      { label: "CAREFUL", value: 0 },
      { label: "CLEVER", value: 0 },
      { label: "FLASHY", value: 0 },
      { label: "FORCEFUL", value: 0 },
      { label: "QUICK", value: 0 },
      { label: "SNEAKY", value: 0 }
    ],
    aspects: { concept: "", problem: "", aspect1: "" },
    aspectsOrder: ["concept", "problem", "aspect1"],
    stunts: "",
    notes: "",
    stress: { 1: false, 2: false, 3: false },
    consequences: { 2: false, 4: false, 6: false },
    consequencesText: ""
  };
  states[id] = def;
  await setAllStates(states);
  game.socket.emit(`module.${MODID}`, { type: "update", id, state: def });
  return { id, state: def };
}

async function updateCardState(id, patch, broadcast = true) {
  // Если игрок - отправляем запрос GM через сокет
  if (!game.user.isGM) {
    console.log("[WB-E] Player sending cardUpdateRequest:", { id, patch, userId: game.user.id });
    game.socket.emit(`module.${MODID}`, { type: "cardUpdateRequest", id, patch, userId: game.user.id });
    // Обновляем локально для немедленной реакции UI
    const app = FateTableCardApp.instances.get(id);
    if (app) {
      app.cardData = foundry.utils.mergeObject(app.cardData, patch, { inplace: false });
      console.log("[WB-E] Player updated local app data");
    }
    return;
  }

  // GM сохраняет напрямую
  const states = await getAllStates();
  if (!states[id]) return;
  states[id] = foundry.utils.mergeObject(states[id], patch, { inplace: false });
  await setAllStates(states, false); // Сохраняем без bulk broadcast

  // Обновляем локальное состояние приложения у GM
  const app = FateTableCardApp.instances.get(id);
  if (app) {
    app.cardData = foundry.utils.mergeObject(app.cardData, patch, { inplace: false });
  }

  // Broadcast конкретное обновление карточки
  if (broadcast) {
    game.socket.emit(`module.${MODID}`, { type: "cardUpdate", id, state: patch });
  }

  return states[id];
}

// Debounced версия для input событий (300ms задержка)
const debouncedUpdateCardState = debounce((id, patch, broadcast) => {
  return updateCardState(id, patch, broadcast);
}, 300);




async function deleteCardState(id, broadcast = true) {
  const states = await getAllStates();
  if (!states[id]) return;
  delete states[id];
  await setAllStates(states, broadcast);
  if (broadcast) game.socket.emit(`module.${MODID}`, { type: "delete", id });
}

// Export utilities for wbe-card.mjs
export {
  MODID,
  FLAG_SCOPE,
  FLAG_KEY_TEXTS,
  FLAG_KEY_IMAGES,
  createCardsLayer,
  updateCardState,
  deleteCardState,
  screenToWorld,
  worldToScreen,
  deselectAllElements,
  getOrCreateLayer
};

/* ----------------------- CSS ---------------------------- */
const OTHER_CSS = `
/* Canvas Text and Image Elements */
.wbe-canvas-text-container {
  pointer-events: none;
  cursor: default;
}

.wbe-canvas-text {
  background: transparent;
  color: white;
  padding: 8px 12px;
  border: none !important;
  font-size: 16px;
  font-weight: bold;
  text-shadow: 0 0 4px rgba(0,0,0,0.8);
  user-select: none;
  min-width: 100px;
  text-align: center;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
}

.wbe-canvas-text:hover {
  border: none !important;
  background: rgba(0, 0, 0, 0.9);
}

.wbe-canvas-text[contenteditable="true"] {
  border: none !important;
  outline: none !important;
  user-select: text;
  white-space: normal;
  overflow: hidden;
  pointer-events: none;
}

.wbe-canvas-image-container {
  pointer-events: none;
  cursor: default;
}

.wbe-canvas-image {
  pointer-events: none !important;              /* make the image itself transparent to pointer hit-testing */
  -webkit-user-drag: none !important;           /* Chrome/Safari: disable native image drag */
  user-drag: none !important;                   /* spec-ish fallback */
  user-select: none !important;                 /* no selection handles on long-press */
  touch-action: none !important;
  max-width: 200px;
  max-height: 200px;
  display: block;
}

/* Text Lock Overlay Styles */
.wbe-text-lock-overlay {
  position: absolute;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: none;
  z-index: 1001;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wbe-lock-icon {
  background: rgba(255, 69, 0, 0.9);
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: bold;
  display: flex;
  align-items: center;
  gap: 8px;
}

.wbe-lock-icon svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

`;

/* ----------------------- Expose (optional) --------------- */

// Expose ImageTools and TextTools for browser console access and testing
window.ImageTools = ImageTools;
window.TextTools = TextTools;
// Expose utility functions for testing
window.screenToWorld = screenToWorld;
window.worldToScreen = worldToScreen;
window.WhiteboardExperience = {
  getAllStates, setAllStates, createCardState, updateCardState, deleteCardState,
  startContinuousSync, stopContinuousSync, syncCardsWithCanvas,
  getAllTexts: TextTools.getAllTexts,
  setAllTexts: TextTools.setAllTexts,
  getAllImages: ImageTools.getAllImages,
  setAllImages: ImageTools.setAllImages,
  cleanupBrokenImages: ImageTools.cleanupBrokenImages,

  // Хелпер для очистки текстов и картинок
  async clearCanvasElements() {

    // FIX: Clean up all panels before removing elements
    if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
      try {
        window.wbeColorPanel.cleanup();
      } catch { }
    }

    if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.cleanup === "function") {
      try {
        window.wbeImageControlPanel.cleanup();
      } catch { }
    }

    // Удаляем из DOM
    const layer = getOrCreateLayer();
    if (layer) {
      const texts = layer.querySelectorAll(".wbe-canvas-text-container");
      const images = layer.querySelectorAll(".wbe-canvas-image-container");


      // Clean up color pickers before removing elements
      document.querySelectorAll(".wbe-color-picker-panel").forEach(d => d.remove());

      texts.forEach(el => el.remove());
      images.forEach(el => el.remove());

    }

    // FIX: Clear ZIndexManager state to prevent accumulation and collisions
    if (window.ZIndexManager && typeof window.ZIndexManager.clear === "function") {
      try {
        window.ZIndexManager.clear();
        console.log('[clearCanvasElements] ZIndexManager cleared');
      } catch (e) {
        console.error('[clearCanvasElements] Error clearing ZIndexManager:', e);
      }
    }

    // FIX: Clear MassSelection state
    if (window.MassSelection && typeof window.MassSelection.clear === "function") {
      try {
        window.MassSelection.clear();
        console.log('[clearCanvasElements] MassSelection cleared');
      } catch (e) {
        console.error('[clearCanvasElements] Error clearing MassSelection:', e);
      }
    }

    // Очищаем флаги - используем setAllTexts/setAllImages для автоматической синхронизации
    // Это отправляет socket запрос для non-GM, или очищает напрямую для GM
    try {
      await TextTools.setAllTexts({});
      await ImageTools.setAllImages({});
    } catch (e) {
      console.error("[clearCanvasElements] Ошибка очистки флагов:", e);
    }

  },

  // Mass selection helper
  get massSelection() { return MassSelection; }
};

// NEW: Expose MassSelection globally for integration with text/image handlers
window.MassSelection = MassSelection;
