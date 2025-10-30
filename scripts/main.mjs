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
import { FateTableCardApp, CARD_CSS } from './modules/fate-card.mjs';

// Inject CSS globally for all users as early as possible
if (!document.getElementById("wbe-table-card-style")) {
  const style = document.createElement("style");
  style.id = "wbe-table-card-style";
  style.textContent = CARD_CSS;
  document.head.appendChild(style);
  console.log("[WB-E] CSS injected globally");
}

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
Hooks.once("init", async () => {
  // HBS helpers
  if (!Handlebars.helpers.array) Handlebars.registerHelper("array", (...args) => args.slice(0, -1));
  if (!Handlebars.helpers.inc) Handlebars.registerHelper("inc", v => Number(v) + 1);

  // Preload templates
  await loadTemplates([
    `modules/${MODID}/templates/card.hbs`,
    `modules/${MODID}/templates/partials/approaches.hbs`
  ]);
});

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

  // Initialize mass selection system
  MassSelection.initialize();
  MassSelection.setToggleState(massSelectionToggleState);

  // Верхняя кнопка (справа у навигации) — только ГМ
  if (game.user.isGM && !document.getElementById("whiteboard-experience-topbtn")) {
    const bar = document.querySelector("#navigation .scene-controls")
      || document.querySelector("#controls .scene-controls")
      || document.querySelector("#logo")
      || document.querySelector("#navigation");
    if (bar) {
      const a = document.createElement("a");
      a.id = "whiteboard-experience-topbtn";
      a.className = "control-tool";
      a.title = "Добавить FATE Card";
      a.innerHTML = '<i class="fas fa-id-card"></i>';
      a.style.marginLeft = "6px";
      a.addEventListener("click", async () => {
        if (!game.user.isGM) return ui.notifications.warn("Добавлять карточки может только GM.");
        const { id, state } = await createCardState();
        FateTableCardApp.show(id, state);
      });
      bar.appendChild(a);
    }
  }

  // Инъекция инструментов в левый тулбар
  injectMassSelectionTool(); // Mass selection first (top priority)
  injectFateCardTool();
  TextTools.injectTextTool();
  Hooks.on("renderSceneControls", () => {
    injectMassSelectionTool(); // Mass selection first (top priority)
    injectFateCardTool();
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
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, data.texts);

        // Обновляем локально для немедленной реакции UI у GM
        const layer = getOrCreateLayer();
        if (layer) {
          // Получаем все существующие текстовые элементы
          const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
          const existingIds = new Set();

          // Обновляем существующие и создаем новые тексты локально у GM
          for (const [id, textData] of Object.entries(data.texts)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
            if (existing) {
              // 🔥 CRITICAL FIX: Skip locked text elements (GM socket handler)
              if (existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id) {
                console.log(`[WB-E] GM skipping socket update for ${id} - locked by user ${existing.dataset.lockedBy}`);
                continue; // Don't update! This prevents cursor reset!
              }

              // Обновляем существующий элемент
              const textElement = existing.querySelector(".wbe-canvas-text");
              if (textElement) {
                // ✅ ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
                if (textElement.contentEditable === "true") {
                  console.log(`[WB-E] GM skipping socket update for ${id} - actively being edited`);
                  continue;
                }

                // Safe to update now
                textElement.textContent = textData.text;
                existing.style.left = `${textData.left}px`;
                existing.style.top = `${textData.top}px`;
                textElement.style.transform = `scale(${textData.scale})`;
                textElement.style.color = textData.color || TextTools.DEFAULT_TEXT_COLOR; // Apply color
                textElement.style.backgroundColor = textData.backgroundColor || TextTools.DEFAULT_BACKGROUND_COLOR;
                TextTools.applyFontVariantToElement?.(textElement, textData.fontWeight, textData.fontStyle);
                TextTools.applyTextAlignmentToElement?.(textElement, textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN);
                TextTools.applyFontFamilyToElement?.(textElement, textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY);
                TextTools.applyFontSizeToElement?.(textElement, textData.fontSize || TextTools.DEFAULT_FONT_SIZE);
                TextTools.applyBorderDataToElement?.(textElement, textData.borderColor, textData.borderWidth);

                // ✅ FIX: Apply width if present
                if (textData.width && textData.width > 0) {
                  textElement.style.width = `${textData.width}px`;
                  textElement.dataset.manualWidth = "true";
                } else {
                  textElement.style.width = "";
                  textElement.dataset.manualWidth = "false";
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
                textData.width
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
              // ✅ FIX: Clean up color panel before removing element
              if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
                try {
                  window.wbeColorPanel.cleanup();
                } catch { }
              }
              // Clean up color pickers before removing element
              document.querySelectorAll(".wbe-color-picker-panel").forEach(d => d.remove());
              element.remove();
            }
          });
        }

        // Эмитим всем (включая отправителя)
        game.socket.emit(`module.${MODID}`, { type: "textUpdate", texts: data.texts });
      }
    }

    if (data.type === "textUpdate") {
      // Обновляем UI у всех (включая отправителя)
      // Умное обновление: обновляем только измененные тексты
      // ✅ FIX: Skip update if this is the sender's own update
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
            // 🔥 CRITICAL FIX: Skip locked text elements
            if (existing.dataset.lockedBy && existing.dataset.lockedBy !== game.user.id) {
              console.log(`[WB-E] Skipping socket update for ${id} - locked by user ${existing.dataset.lockedBy}`);
              continue; // Don't update! This prevents cursor reset!
            }

            // Обновляем существующий элемент
            const textElement = existing.querySelector(".wbe-canvas-text");
            if (textElement) {
              // ✅ ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
              if (textElement.contentEditable === "true") {
                console.log(`[WB-E] Skipping socket update for ${id} - actively being edited`);
                continue;
              }

              // Safe to update now
              textElement.textContent = textData.text;
              existing.style.left = `${textData.left}px`;
              existing.style.top = `${textData.top}px`;
              textElement.style.transform = `scale(${textData.scale})`;
              textElement.style.color = textData.color || TextTools.DEFAULT_TEXT_COLOR; // Apply color
              textElement.style.backgroundColor = textData.backgroundColor || TextTools.DEFAULT_BACKGROUND_COLOR;
              TextTools.applyFontVariantToElement?.(textElement, textData.fontWeight, textData.fontStyle); // Apply background color
              TextTools.applyTextAlignmentToElement?.(textElement, textData.textAlign || TextTools.DEFAULT_TEXT_ALIGN);
              TextTools.applyFontFamilyToElement?.(textElement, textData.fontFamily || TextTools.DEFAULT_FONT_FAMILY);
              TextTools.applyFontSizeToElement?.(textElement, textData.fontSize || TextTools.DEFAULT_FONT_SIZE);
              TextTools.applyBorderDataToElement?.(textElement, textData.borderColor, textData.borderWidth);

              // Apply width if it was set
              if (textData.width && textData.width > 0) {
                textElement.style.width = `${textData.width}px`;
              } else {
                textElement.style.width = "";
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
              textData.width
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
            // ✅ FIX: Clean up color panel before removing element
            if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
              try {
                window.wbeColorPanel.cleanup();
              } catch { }
            }
            // Clean up color pickers before removing element
            document.querySelectorAll(".wbe-color-picker-panel").forEach(d => d.remove());
            element.remove();
          }
        });
      }
    }

    if (data.type === "imageUpdateRequest") {
      // Игрок просит GM сохранить изменения
      if (game.user.isGM) {
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
              // Обновляем существующий элемент
              ImageTools.updateImageElement(existing, imageData);
            } else {
              // Создаем новый элемент
              const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
              const maskTypeData = imageData.maskType || 'rect';
              const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
              const circleRadiusData = imageData.circleRadius || null;
              ImageTools.createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, imageData.zIndex, imageData.isFrozen || false);
            }

            // ✨ Обновляем глобальные переменные для каждой картинки
            ImageTools.updateImageLocalVars(id, {
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
              // ✅ FIX: Clean up image control panel before removing element
              if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.cleanup === "function") {
                try {
                  window.wbeImageControlPanel.cleanup();
                } catch { }
              }
              // Clear runtime caches to prevent resurrection
              ImageTools.clearImageCaches(element.id);
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
            // Обновляем существующий элемент
            ImageTools.updateImageElement(existing, imageData);
          } else {
            // Создаем новый элемент
            const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
            const maskTypeData = imageData.maskType || 'rect';
            const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
            const circleRadiusData = imageData.circleRadius || null;
            ImageTools.createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, imageData.zIndex, imageData.isFrozen || false);
          }

          // ✨ Обновляем глобальные переменные для каждой картинки
          ImageTools.updateImageLocalVars(id, {
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
            // ✅ FIX: Clean up image control panel before removing element
            if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.cleanup === "function") {
              try {
                window.wbeImageControlPanel.cleanup();
              } catch { }
            }
            // Clear runtime caches to prevent resurrection
            ImageTools.clearImageCaches(element.id);
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

    // ✅ NEW: Handle text lock
    if (data.type === "textLock") {
      console.log(`[WB-E] Received textLock for ${data.textId} from ${data.userName}`);
      const container = document.getElementById(data.textId);
      if (container && data.userId !== game.user.id) {
        TextTools.applyTextLockVisual(container, data.userId, data.userName);
      }
    }

    // ✅ NEW: Handle text unlock
    if (data.type === "textUnlock") {
      console.log(`[WB-E] Received textUnlock for ${data.textId}`);
      const container = document.getElementById(data.textId);
      if (container) {
        TextTools.removeTextLockVisual(container);
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

// Z-Index Manager - Global for both text and image objects
const ZIndexManager = {
  // Track z-indexes for each object
  textZIndexes: new Map(), // id -> zIndex
  imageZIndexes: new Map(), // id -> zIndex
  nextTextZIndex: 1000,    // Text range: 1000+
  nextImageZIndex: 2000,   // Image range: 2000+

  // Get next available z-index for text
  getNextText() {
    return ++this.nextTextZIndex;
  },

  // Get next available z-index for image
  getNextImage() {
    return ++this.nextImageZIndex;
  },

  // Sync with existing z-index values to avoid conflicts
  syncWithExisting(existingZIndexes) {
    if (!Array.isArray(existingZIndexes)) return;

    let maxTextZIndex = this.nextTextZIndex;
    let maxImageZIndex = this.nextImageZIndex;

    existingZIndexes.forEach(([id, zIndex]) => {
      if (typeof zIndex === 'number') {
        if (id.startsWith('wbe-text-') && zIndex >= 1000 && zIndex < 2000) {
          // Text z-index (1000-1999 range)
          if (zIndex > maxTextZIndex) {
            maxTextZIndex = zIndex;
          }
        } else if (id.startsWith('wbe-image-') && zIndex >= 2000) {
          // Image z-index (2000+ range)
          if (zIndex > maxImageZIndex) {
            maxImageZIndex = zIndex;
          }
        }
      }
    });

    // Update nextZIndex values to be higher than any existing values
    this.nextTextZIndex = maxTextZIndex;
    this.nextImageZIndex = maxImageZIndex;
  },

  // Assign z-index to text
  assignText(textId) {
    const zIndex = this.getNextText();
    this.textZIndexes.set(textId, zIndex);
    return zIndex;
  },

  // Assign z-index to image
  assignImage(imageId) {
    const zIndex = this.getNextImage();
    this.imageZIndexes.set(imageId, zIndex);
    return zIndex;
  },

  // Get z-index for text
  getText(textId) {
    return this.textZIndexes.get(textId) || 1000;
  },

  // Get z-index for image
  getImage(imageId) {
    return this.imageZIndexes.get(imageId) || 2000;
  },

  // Get z-index for any object (tries both text and image)
  get(id) {
    if (id.startsWith('wbe-text-')) {
      return this.getText(id);
    } else if (id.startsWith('wbe-image-')) {
      return this.getImage(id);
    }
    return 1000; // Default fallback
  },

  // Remove z-index for text
  removeText(textId) {
    this.textZIndexes.delete(textId);
  },

  // Remove z-index for image
  removeImage(imageId) {
    this.imageZIndexes.delete(imageId);
  },

  // Remove z-index for any object
  remove(id) {
    this.removeText(id);
    this.removeImage(id);
  },

  // Check if text has z-index
  hasText(textId) {
    return this.textZIndexes.has(textId);
  },

  // Check if image has z-index
  hasImage(imageId) {
    return this.imageZIndexes.has(imageId);
  },

  // Get all tracked texts
  getAllTexts() {
    return Array.from(this.textZIndexes.entries());
  },

  // Get all tracked images
  getAllImages() {
    return Array.from(this.imageZIndexes.entries());
  }
};



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

// Export ZIndexManager for use by text and image modules
export { ZIndexManager };

// Make ZIndexManager globally accessible for console debugging
window.ZIndexManager = ZIndexManager;

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

  // ✅ CLEAR MASS SELECTION when deselecting all elements
  if (window.MassSelection && window.MassSelection.selectedCount > 0) {
    window.MassSelection.clear();
  }

  // ✅ FIX: Clean up all panels before deselecting elements
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

    ImageTools.createImageElement(newId, imageData.src, newLeft, newTop, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, imageData.zIndex, imageData.isFrozen || false);

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






async function loadCanvasElements() {
  const texts = await TextTools.getAllTexts();
  const images = await ImageTools.getAllImages();

  // Sync ZIndexManager with existing z-index values to avoid conflicts
  const textZIndexes = Object.entries(texts).map(([id, data]) => [id, data.zIndex]).filter(([id, zIndex]) => zIndex);
  const imageZIndexes = Object.entries(images).map(([id, data]) => [id, data.zIndex]).filter(([id, zIndex]) => zIndex);
  const allZIndexes = [...textZIndexes, ...imageZIndexes];
  ZIndexManager.syncWithExisting(allZIndexes);

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
      ImageTools.createImageElement(id, data.src, data.left, data.top, data.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, data.zIndex, data.isFrozen || false);
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
  border: 2px solid rgba(255, 255, 255, 0.6);
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
  border-color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.9);
}

.wbe-canvas-text[contenteditable="true"] {
  outline: 2px solid #4a9eff;
  outline-offset: 2px;
  user-select: text;
  white-space: normal;
  overflow: visible;
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
window.FateTableCardApp = FateTableCardApp;
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

    // ✅ FIX: Clean up all panels before removing elements
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

    // Очищаем флаги (только GM)
    if (game.user.isGM) {
      try {
        await canvas.scene?.unsetFlag("whiteboard-experience", "texts");
        await canvas.scene?.unsetFlag("whiteboard-experience", "images");
      } catch (e) {
        console.error("  ❌ Ошибка очистки флагов:", e);
      }
    } else {
    }

  },

  // Mass selection helper
  get massSelection() { return MassSelection; }
};

// ✅ NEW: Expose MassSelection globally for integration with text/image handlers
window.MassSelection = MassSelection;
