 /*********************************************************
 * Whiteboard Experience - v11-13
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

// Global handler logs collector for debugging (can be read via page.evaluate())
if (!window.wbeHandlerLogs) {
  window.wbeHandlerLogs = [];
}

export function wbeLog(handlerId, message, data = null) {
  const logEntry = {
    timestamp: performance.now(),
    handlerId,
    message,
    data,
    time: new Date().toISOString()
  };
  
  window.wbeHandlerLogs.push(logEntry);
  
  // Limit array size to prevent memory issues
  if (window.wbeHandlerLogs.length > 1000) {
    window.wbeHandlerLogs.shift();
  }
  
  // Also output to console for normal debugging
  console.log(`[${handlerId}] ${message}`, data || '');
}

/* ----------------------- Bootstrap ----------------------- */


Hooks.once("ready", async () => {

  try { ui.controls?.render?.(true); } catch (e) { }

  // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track all keydown events
  document.addEventListener("keydown", (e) => {
    if (e.key === '[' || e.key === ']' || e.key === 'PageDown' || e.key === 'PageUp') {
      console.log(`[INVESTIGATE] GLOBAL keydown: key=${e.key}, target=${e.target?.tagName || 'null'}, selectedTextId=${window.TextTools?.selectedTextId?.slice(-6) || 'null'}, selectedImageId=${window.ImageTools?.selectedImageId?.slice(-6) || 'null'}`);
    }
  }, true); // Capture phase to see all events

  createCardsLayer();

  const all = await getAllStates();
  for (const [id, st] of Object.entries(all)) FateTableCardApp.show(id, st);

  await loadCanvasElements();

  // Request active locks from all users after loading elements
  // This restores locks after page refresh (F5)
  requestActiveLocks();

  // Initialize mass selection system
  MassSelection.initialize();
  MassSelection.setToggleState(massSelectionToggleState);

  injectMassSelectionTool(); // Mass selection first (top priority)
  TextTools.injectTextTool();
  
  // Setup keyboard shortcuts for text formatting
  TextTools.setupTextKeyboardShortcuts();
  
  Hooks.on("renderSceneControls", () => {
    injectMassSelectionTool(); // Mass selection first (top priority)
    TextTools.injectTextTool();
  });

  setupGlobalPasteHandler();
  setupIndependentPanZoomHooks();

  Hooks.on("canvasPan", syncCardsWithCanvas);
  Hooks.on("canvasReady", () => {
    createCardsLayer();
    syncCardsWithCanvas();
    startContinuousSync();
  });

  if (canvas?.ready) {
    createCardsLayer();
    syncCardsWithCanvas();
    startContinuousSync();
  }

  game.socket.on(`module.${MODID}`, async (data) => {
    if (!data || !data.type) return;

    if (data.type === "update") {

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

      if (!game.user.isGM) {
        await deleteCardState(data.id, false);
      }
      FateTableCardApp.closeOne(data.id);
    }

    if (data.type === "bulk") {


      FateTableCardApp.closeAll();
      for (const [id, st] of Object.entries(data.states || {})) {
        FateTableCardApp.show(id, st, { fromSocket: true });
      }
    }

    if (data.type === "textUpdateRequest") {
      // [INVESTIGATE] Track GM receiving textUpdateRequest
      console.log(`[INVESTIGATE] GM received textUpdateRequest: texts=${Object.keys(data.texts || {}).length}, isEmpty=${Object.keys(data.texts || {}).length === 0}`);

      if (game.user.isGM) {
        // [ZINDEX_ANALYSIS] Track GM socket handler
        const timestamp = Date.now();
        const requestTexts = data.texts || {};
        const requestTextIds = Object.keys(requestTexts);
        const isEmpty = requestTextIds.length === 0;
        
        
        // Check if this is a deletion
        const currentTexts = await TextTools.getAllTexts();
        const currentTextIds = Object.keys(currentTexts);
        const isDeletion = requestTextIds.length < currentTextIds.length;
        const deletedIds = currentTextIds.filter(id => !requestTextIds.includes(id));
        
        if (isDeletion && deletedIds.length > 0) {
        }
        
        if (isEmpty) {
        }
        
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, requestTexts);
        if (isEmpty) {
          // Also clear ZIndexManager completely when clearing all
          if (window.ZIndexManager && typeof window.ZIndexManager.clear === "function") {
            window.ZIndexManager.clear();
          }
        }

        const layer = getOrCreateLayer();
        if (layer) {

          const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
          const existingIds = new Set();

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
                continue; // Don't update! This prevents cursor reset and size changes!
              }

              const textElement = existing.querySelector(".wbe-canvas-text");
              if (textElement) {
                // ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
                if (textElement.contentEditable === "true") {
                  continue;
                }

                // Safe to update now
                const isSelected = TextTools.selectedTextId === id;
                
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
                }

                // Update resize handle position after scale/size changes
                TextTools.updateTextUI(existing);
                
                // FIX: Always update panel position if text is selected (like local drag does)
                if (isSelected) {
                  requestAnimationFrame(() => {
                    // Double-check selection is still valid after DOM update
                    if (TextTools.selectedTextId === id) {
                      if (window.wbeColorPanel && window.wbeColorPanelUpdate) {
                        // Panel exists - just update position
                        window.wbeColorPanelUpdate();
                      } else if (window.wbeSafeReshowColorPicker) {
                        // Panel was killed - recreate it
                        window.wbeSafeReshowColorPicker(id, 0);
                      }
                    }
                  });
                }
              }
            } else {
              // Create new text element - createTextElement will handle rank assignment
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

        // [ZINDEX_ANALYSIS] Track GM socket broadcast
        const broadcastTextIds = Object.keys(requestTexts);
        
        // [ZINDEX_ANALYSIS] Track if GM will call setAllTexts
        
        // [INVESTIGATE] Track GM broadcasting textUpdate
        console.log(`[INVESTIGATE] GM broadcasting textUpdate: texts=${broadcastTextIds.length}`);
        // CRITICAL FIX: Always send full sync to prevent "ghost" texts in Player cache
        game.socket.emit(`module.${MODID}`, { type: "textUpdate", texts: requestTexts, isFullSync: true });
      }
    }

    if (data.type === "textUpdate") {
      // [INVESTIGATE] Track non-GM receiving textUpdate
      console.log(`[INVESTIGATE] Non-GM received textUpdate: texts=${Object.keys(data.texts || {}).length}, isEmpty=${Object.keys(data.texts || {}).length === 0}`);
      
      // [ZINDEX_ANALYSIS] Track textUpdate socket handler (non-GM receives broadcast)
      const timestamp = Date.now();
      const updateTextIds = Object.keys(data.texts || {});
      const isEmpty = updateTextIds.length === 0;
      
      // CRITICAL FIX: Sync ZIndexManager with ranks from socket data before creating elements
      // This ensures correct z-index order when receiving initial state after F5
      if (data.isFullSync && window.ZIndexManager && typeof window.ZIndexManager.syncWithExisting === 'function') {
        const textData = Object.entries(data.texts || {}).map(([id, textData]) => ({
          id,
          zIndex: textData.zIndex,
          rank: textData.rank,
          type: 'text'
        }));
        // Also get images from DOM to include them in sync (they may arrive later)
        const layer = getOrCreateLayer();
        const imageElements = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-image-container')) : [];
        const imageData = imageElements.map(el => {
          const id = el.id;
          const rank = window.ZIndexManager?.getRank?.(id) || null;
          const zIndex = window.ZIndexManager?.get?.(id) || 0;
          return { id, rank, zIndex, type: 'image' };
        });
        const allData = [...textData, ...imageData];
        window.ZIndexManager.syncWithExisting(allData);
      }
      
      // [ZINDEX_ANALYSIS] Track if this will trigger setAllTexts
      if (isEmpty) {
      } else {
      }

      const layer = getOrCreateLayer();
      if (layer) {

        const existingElements = layer.querySelectorAll(".wbe-canvas-text-container");
        const existingIds = new Set();

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
              continue; // Don't update! This prevents cursor reset and size changes!
            }

            const textElement = existing.querySelector(".wbe-canvas-text");
            if (textElement) {
              // Update text content - check for span first (need to check span for contentEditable too!)
              const textSpan = textElement.querySelector(".wbe-text-background-span");
              
              // ADDITIONAL GUARD: Skip if contentEditable (belt and suspenders)
              // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track contentEditable check
              // CRITICAL: Check BOTH textElement AND span for contentEditable!
              const editableElement = textSpan || textElement;
              const isContentEditable = editableElement.contentEditable === "true" || textElement.contentEditable === "true";
              console.log(`[INVESTIGATE] textUpdate socket handler: id=${id.slice(-6)}, textElement.contentEditable=${textElement.contentEditable}, span.contentEditable=${textSpan?.contentEditable || 'N/A'}, isContentEditable=${isContentEditable}, lockedBy=${existing.dataset.lockedBy || 'none'}, incomingText="${textData.text?.substring(0, 20)}..."`);
              if (isContentEditable) {
                console.log(`[INVESTIGATE] textUpdate socket handler: SKIPPING update for ${id.slice(-6)} - contentEditable=true`);
                continue;
              }

              // Safe to update now
              const isSelected = TextTools.selectedTextId === id;
              
              // Skip position update if user is actively dragging this object
              if (existing.dataset.dragging === "true") {
                console.log(`[INVESTIGATE] textUpdate socket handler: SKIPPING position update for ${id.slice(-6)} - dragging=true`);
                // Still update other properties (text, scale, colors, etc.) but skip position
              } else {
                existing.style.left = `${textData.left}px`;
                existing.style.top = `${textData.top}px`;
              }
              
              // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track text content update
              const currentText = textSpan ? textSpan.textContent : textElement.textContent;
              console.log(`[INVESTIGATE] textUpdate socket handler: UPDATING ${id.slice(-6)} - currentText="${currentText?.substring(0, 20)}..." -> newText="${textData.text?.substring(0, 20)}..."`);
              if (textSpan) {
                textSpan.textContent = textData.text;
              } else {
                textElement.textContent = textData.text;
              }
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
                // Apply width if it was set
                if (textData.width && textData.width > 0) {
                  textElement.style.width = `${textData.width}px`;
                } else {
                  textElement.style.width = "";
                }
              } else {
              }

              // NOTE: Rank sync is handled by rankUpdate/rankConfirm handlers, not here
              // This handler only updates object properties, not z-index order

              // Update resize handle position after scale/size changes
              TextTools.updateTextUI(existing);
              
              // FIX: Always update panel position if text is selected (like local drag does)
              if (isSelected) {
                requestAnimationFrame(() => {
                  // Double-check selection is still valid after DOM update
                  if (TextTools.selectedTextId === id) {
                    if (window.wbeColorPanel && window.wbeColorPanelUpdate) {
                      // Panel exists - just update position
                      window.wbeColorPanelUpdate();
                    } else if (window.wbeSafeReshowColorPicker) {
                      // Panel was killed - recreate it
                      window.wbeSafeReshowColorPicker(id, 0);
                    }
                  }
                });
              }
            }
          } else {
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
          // NOTE: Rank is already handled in createTextElement - no need to duplicate here
          // This was causing rank to be reassigned incorrectly, overwriting the correct rank
        }

        // CRITICAL FIX: Sync DOM z-indexes after creating/updating all texts
        // This ensures correct z-index order after receiving updates (especially after F5)
        if (window.ZIndexManager && typeof window.ZIndexManager.syncAllDOMZIndexes === 'function') {
          await window.ZIndexManager.syncAllDOMZIndexes();
        }

        // CRITICAL FIX: Remove elements missing from socket data
        // If isFullSync: true, remove ALL missing elements (except actively edited) to clear "ghosts"
        // Otherwise, only remove if not actively being edited/manipulated
        const isFullSync = data.isFullSync === true;
        existingElements.forEach(element => {
          if (!existingIds.has(element.id)) {
            // Skip removal if element is actively being edited (contentEditable or dragging)
            const textElement = element.querySelector(".wbe-canvas-text");
            if (textElement && textElement.contentEditable === "true") {
              return;
            }
            if (element.dataset.dragging === "true") {
              return;
            }
            
            // For full sync: remove even if locked (clears "ghosts" from stale cache)
            // For incremental sync: skip if locked (prevents interrupting user)
            if (!isFullSync && element.dataset.lockedBy) {
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

      if (game.user.isGM) {
        const socketTime = Date.now();
        const requestImages = data.images || {};
        const requestImageIds = Object.keys(requestImages);
        const isEmpty = requestImageIds.length === 0;
        
        // [INVESTIGATE] Детальное логирование получения imageUpdateRequest от Player
        const senderUserId = data.userId || 'unknown';
        const senderName = game.users?.get(senderUserId)?.name || 'unknown';
        const requestLayer = getOrCreateLayer();
        const domElements = requestLayer ? Array.from(requestLayer.querySelectorAll('.wbe-canvas-image-container')) : [];
        const domIds = domElements.map(el => el.id);
        const currentImages = await ImageTools.getAllImages();
        const currentImageIds = Object.keys(currentImages);
        
        const inRequestNotInDOM = requestImageIds.filter(id => !domIds.includes(id));
        const inRequestNotInDB = requestImageIds.filter(id => !currentImageIds.includes(id));
        const inDOMNotInRequest = domIds.filter(id => !requestImageIds.includes(id));
        const inDBNotInRequest = currentImageIds.filter(id => !requestImageIds.includes(id));
        
        const isDeletion = requestImageIds.length < currentImageIds.length;
        const deletedIds = currentImageIds.filter(id => !requestImageIds.includes(id));
        
        console.log(`[INVESTIGATE] GM received imageUpdateRequest:`, {
          socketTime,
          senderUserId,
          senderName,
          requestCount: requestImageIds.length,
          requestIds: requestImageIds.map(id => id.slice(-6)),
          domCount: domIds.length,
          domIds: domIds.map(id => id.slice(-6)),
          dbCount: currentImageIds.length,
          dbIds: currentImageIds.map(id => id.slice(-6)),
          inRequestNotInDOM: inRequestNotInDOM.map(id => id.slice(-6)),
          inRequestNotInDB: inRequestNotInDB.map(id => id.slice(-6)),
          inDOMNotInRequest: inDOMNotInRequest.map(id => id.slice(-6)),
          inDBNotInRequest: inDBNotInRequest.map(id => id.slice(-6)),
          isDeletion,
          deletedIds: deletedIds.map(id => id.slice(-6)),
          // Детали каждого изображения в запросе
          requestDetails: requestImageIds.map(id => ({
            id: id.slice(-6),
            fullId: id,
            inDOM: domIds.includes(id),
            inDB: currentImageIds.includes(id),
            imageData: requestImages[id] ? {
              src: requestImages[id].src?.substring(0, 50) || 'no-src',
              left: requestImages[id].left,
              top: requestImages[id].top,
              scale: requestImages[id].scale,
              timestamp: id.match(/\d+$/)?.[0] || 'unknown'
            } : null
          }))
        });
        
        if (inRequestNotInDOM.length > 0) {
          console.error(`[INVESTIGATE] ⚠️ GM: Request contains ${inRequestNotInDOM.length} images NOT in DOM:`, inRequestNotInDOM.map(id => id.slice(-6)));
        }
        if (inRequestNotInDB.length > 0) {
          console.warn(`[INVESTIGATE] ⚠️ GM: Request contains ${inRequestNotInDB.length} images NOT in DB:`, inRequestNotInDB.map(id => id.slice(-6)));
        }
        
        if (isDeletion && deletedIds.length > 0) {
          console.log(`[INVESTIGATE] GM imageUpdateRequest: Detected deletion of ${deletedIds.length} images:`, deletedIds.map(id => id.slice(-6)));
        }
        
        // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Track before save
        console.log(`[INVESTIGATE] GM imageUpdateRequest: Before save - current=${currentImageIds.length}, request=${requestImageIds.length}`);
        
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_IMAGES);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, requestImages);
        
        // [INVESTIGATE] TEMPORARY FOR INVESTIGATION - Verify save to database
        const verifyImages = await ImageTools.getAllImages();
        const verifyIds = Object.keys(verifyImages);
        console.log(`[INVESTIGATE] GM imageUpdateRequest: After save to DB, getAllImages returned ${verifyIds.length} images:`, verifyIds.slice(0, 5));
        if (verifyIds.length !== requestImageIds.length) {
          console.error(`[INVESTIGATE] GM imageUpdateRequest: MISMATCH! Saved ${requestImageIds.length} but getAllImages returned ${verifyIds.length}`);
        }

        const layer = getOrCreateLayer();
        if (layer) {

          const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
          const existingIds = new Set();

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
              continue; // Don't update! This prevents crop changes!
            }
            const isSelected = ImageTools.selectedImageId === id;

            ImageTools.updateImageElement(existing, imageData);
            
            // FIX: Always update panel position if image is selected (like local drag does)
            if (isSelected) {
              requestAnimationFrame(() => {
                // Double-check selection is still valid after DOM update
                if (ImageTools.selectedImageId === id) {
                  if (window.wbeImageControlPanel && window.wbeImageControlPanelUpdate) {
                    // Panel exists - just update position
                    window.wbeImageControlPanelUpdate();
                  } else if (window.wbeShowImageControlPanel) {
                    // Panel was killed - recreate it
                    const imageElement = existing.querySelector(".wbe-canvas-image");
                    if (imageElement) {
                      const maskType = ImageTools.getImageLocalVars(id)?.maskType || 'rect';
                      // Create panel without callbacks - they're only needed for crop mode
                      // and will be set up when crop mode is activated
                      window.wbeShowImageControlPanel(imageElement, existing, maskType, {});
                    }
                  }
                }
              });
            }
            
            // NOTE: Rank sync is handled by rankUpdate/rankConfirm handlers, not here
            // This handler only updates object properties, not z-index order
          } else {
            // [INVESTIGATE] Проверка: изображение отсутствует в DOM и БД GM
            // Это может быть старое изображение, которое было удалено у GM, но осталось у Player
            const imageTimestamp = id.match(/\d+$/)?.[0] || 'unknown';
            const currentTime = Date.now();
            const imageAge = imageTimestamp ? (currentTime - parseInt(imageTimestamp)) : Infinity;
            const isOldImage = imageAge > 60000; // Старше 1 минуты
            
            console.log(`[INVESTIGATE] GM creating image from Player request:`, {
              id: id.slice(-6),
              fullId: id,
              imageTimestamp,
              imageAge: imageAge > 60000 ? `${Math.round(imageAge / 1000)}s` : `${imageAge}ms`,
              isOldImage,
              notInDOM: true,
              notInDB: true,
              senderUserId: data.userId || 'unknown',
              senderName: data.userName || 'unknown'
            });
            
            if (isOldImage) {
              console.error(`[INVESTIGATE] ⚠️⚠️⚠️ GM BLOCKING: Player sent OLD image (${Math.round(imageAge / 1000)}s old) that doesn't exist in GM's DB/DOM!`, {
                id: id.slice(-6),
                fullId: id,
                senderUserId: data.userId || 'unknown',
                senderName: data.userName || 'unknown',
                imageData: {
                  src: imageData.src?.substring(0, 50) || 'no-src',
                  left: imageData.left,
                  top: imageData.top,
                  scale: imageData.scale
                }
              });
              // НЕ создаем старое изображение - оно было удалено у GM
              // Вместо этого пропускаем его - Player должен получить обновление от GM с правильным списком
              continue;
            }

            // Socket update - recreate image from other client's data
            // Только для новых изображений (созданных недавно)
            ImageTools.createImageElement({
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
              borderHex: imageData.borderHex,
              borderOpacity: imageData.borderOpacity,
              borderWidth: imageData.borderWidth,
              borderRadius: imageData.borderRadius,
              shadowHex: imageData.shadowHex,
              shadowOpacity: imageData.shadowOpacity,
              rank: imageData.rank
              // displayWidth/displayHeight not passed for socket updates
            });
          }

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

        // CRITICAL FIX: Always send full sync to prevent "ghost" images in Player cache
        game.socket.emit(`module.${MODID}`, { type: "imageUpdate", images: requestImages, isFullSync: true });
      }
    }

    if (data.type === "imageUpdate") {

      // [INVESTIGATE] Детальное логирование получения imageUpdate (может быть от самого себя для GM)
      const updateTime = Date.now();
      const updateImages = data.images || {};
      const updateImageIds = Object.keys(updateImages);
      const updateLayer = getOrCreateLayer();
      const updateDomElements = updateLayer ? Array.from(updateLayer.querySelectorAll('.wbe-canvas-image-container')) : [];
      const updateDomIds = updateDomElements.map(el => el.id);
      const updateCurrentImages = await ImageTools.getAllImages();
      const updateCurrentIds = Object.keys(updateCurrentImages);
      
      const inUpdateNotInDOM = updateImageIds.filter(id => !updateDomIds.includes(id));
      const inUpdateNotInDB = updateImageIds.filter(id => !updateCurrentIds.includes(id));
      const inDOMNotInUpdate = updateDomIds.filter(id => !updateImageIds.includes(id));
      const inDBNotInUpdate = updateCurrentIds.filter(id => !updateImageIds.includes(id));
      
      console.log(`[INVESTIGATE] Received imageUpdate:`, {
        updateTime,
        userId: game.user.id,
        userName: game.user.name,
        isGM: game.user.isGM,
        updateCount: updateImageIds.length,
        updateIds: updateImageIds.map(id => id.slice(-6)),
        domCount: updateDomIds.length,
        domIds: updateDomIds.map(id => id.slice(-6)),
        dbCount: updateCurrentIds.length,
        dbIds: updateCurrentIds.map(id => id.slice(-6)),
        inUpdateNotInDOM: inUpdateNotInDOM.map(id => id.slice(-6)),
        inUpdateNotInDB: inUpdateNotInDB.map(id => id.slice(-6)),
        inDOMNotInUpdate: inDOMNotInUpdate.map(id => id.slice(-6)),
        inDBNotInUpdate: inDBNotInUpdate.map(id => id.slice(-6)),
        // Детали каждого изображения в обновлении
        updateDetails: updateImageIds.map(id => ({
          id: id.slice(-6),
          fullId: id,
          inDOM: updateDomIds.includes(id),
          inDB: updateCurrentIds.includes(id),
          imageData: updateImages[id] ? {
            src: updateImages[id].src?.substring(0, 50) || 'no-src',
            left: updateImages[id].left,
            top: updateImages[id].top,
            scale: updateImages[id].scale,
            timestamp: id.match(/\d+$/)?.[0] || 'unknown'
          } : null
        }))
      });
      
      if (inUpdateNotInDOM.length > 0) {
        console.error(`[INVESTIGATE] ⚠️ Received imageUpdate: Contains ${inUpdateNotInDOM.length} images NOT in DOM:`, inUpdateNotInDOM.map(id => id.slice(-6)));
      }
      if (inUpdateNotInDB.length > 0) {
        console.warn(`[INVESTIGATE] ⚠️ Received imageUpdate: Contains ${inUpdateNotInDB.length} images NOT in DB:`, inUpdateNotInDB.map(id => id.slice(-6)));
      }

      // CRITICAL FIX: Sync ZIndexManager with ranks from socket data before creating elements
      // This ensures correct z-index order when receiving initial state after F5
      if (data.isFullSync && window.ZIndexManager && typeof window.ZIndexManager.syncWithExisting === 'function') {
        const imageData = Object.entries(data.images || {}).map(([id, imageData]) => ({
          id,
          zIndex: imageData.zIndex,
          rank: imageData.rank,
          type: 'image'
        }));
        // Also get texts from DOM to include them in sync (they may arrive later)
        const layer = getOrCreateLayer();
        const textElements = layer ? Array.from(layer.querySelectorAll('.wbe-canvas-text-container')) : [];
        const textData = textElements.map(el => {
          const id = el.id;
          const rank = window.ZIndexManager?.getRank?.(id) || null;
          const zIndex = window.ZIndexManager?.get?.(id) || 0;
          return { id, rank, zIndex, type: 'text' };
        });
        const allData = [...imageData, ...textData];
        window.ZIndexManager.syncWithExisting(allData);
      }

      const layer = getOrCreateLayer();
      if (layer) {

        const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
        const existingIds = new Set();

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
              continue; // Don't update! This prevents crop changes!
            }
            const isSelected = ImageTools.selectedImageId === id;

            ImageTools.updateImageElement(existing, imageData);
            
            // FIX: Always update panel position if image is selected (like local drag does)
            if (isSelected) {
              requestAnimationFrame(() => {
                // Double-check selection is still valid after DOM update
                if (ImageTools.selectedImageId === id) {
                  if (window.wbeImageControlPanel && window.wbeImageControlPanelUpdate) {
                    // Panel exists - just update position
                    window.wbeImageControlPanelUpdate();
                  } else if (window.wbeShowImageControlPanel) {
                    // Panel was killed - recreate it
                    const imageElement = existing.querySelector(".wbe-canvas-image");
                    if (imageElement) {
                      const maskType = ImageTools.getImageLocalVars(id)?.maskType || 'rect';
                      // Create panel without callbacks - they're only needed for crop mode
                      // and will be set up when crop mode is activated
                      window.wbeShowImageControlPanel(imageElement, existing, maskType, {});
                    }
                  }
                }
              });
            }
            
            // NOTE: Rank sync is handled by rankUpdate/rankConfirm handlers, not here
            // This handler only updates object properties, not z-index order
          } else {

            // Socket update - recreate image from other client's data
            ImageTools.createImageElement({
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
              borderHex: imageData.borderHex,
              borderOpacity: imageData.borderOpacity,
              borderWidth: imageData.borderWidth,
              borderRadius: imageData.borderRadius,
              shadowHex: imageData.shadowHex,
              shadowOpacity: imageData.shadowOpacity,
              rank: imageData.rank
              // displayWidth/displayHeight not passed for socket updates
            });
          }

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

        // CRITICAL FIX: Remove elements missing from socket data
        // If isFullSync: true, remove ALL missing elements (except actively edited) to clear "ghosts"
        // Otherwise, only remove if not actively being edited/manipulated
        const isFullSync = data.isFullSync === true;
        existingElements.forEach(element => {
          if (!existingIds.has(element.id)) {
            // Skip removal if element is actively being dragged
            if (element.dataset.dragging === "true") {
              return;
            }
            
            // For full sync: remove even if locked (clears "ghosts" from stale cache)
            // For incremental sync: skip if locked (prevents interrupting user)
            if (!isFullSync && element.dataset.lockedBy) {
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

    if (data.type === "cardUpdateRequest") {

      if (game.user.isGM) {
        const states = await getAllStates();
        if (states[data.id]) {
          states[data.id] = foundry.utils.mergeObject(states[data.id], data.patch, { inplace: false });
          await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY);
          await new Promise(resolve => setTimeout(resolve, 50));
          await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY, states);

          const app = FateTableCardApp.instances.get(data.id);
          if (app) {
            app.cardData = foundry.utils.mergeObject(app.cardData, data.patch, { inplace: false });

            app.render(true);
          }

          game.socket.emit(`module.${MODID}`, { type: "cardUpdate", id: data.id, state: data.patch });
        }
      }
    }

    // GM request handler for freeze actions
    if (data.type === "gm-request") {
      if (game.user.isGM && data.action === 'freeze-image') {
        try {
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
          
          if (data.objectType === "image") {
            const images = await ImageTools.getAllImages();
            if (!images[data.id]) {
              console.warn(`[WB-E] Cannot update rank for non-existent image ${data.id}`);
              return;
            }
            
            // CRITICAL FIX: Update Manager FIRST (before DB) so rankConfirm handler can skip if already applied
            // This ensures GM's DOM is updated immediately when receiving rankUpdate from player
            if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
              window.ZIndexManager.setRank(data.id, data.rank);
              await window.ZIndexManager.syncAllDOMZIndexes();
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
            
          } else if (data.objectType === "text") {
            const texts = await TextTools.getAllTexts();
            if (!texts[data.id]) {
              console.warn(`[WB-E] Cannot update rank for non-existent text ${data.id}`);
              return;
            }
            
            // CRITICAL FIX: Update Manager FIRST (before DB) so rankConfirm handler can skip if already applied
            // This ensures GM's DOM is updated immediately when receiving rankUpdate from player
            if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
              window.ZIndexManager.setRank(data.id, data.rank);
              await window.ZIndexManager.syncAllDOMZIndexes();
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
            
          }
        } catch (error) {
          console.error('[WB-E] GM failed to process rank update:', error);
        }
      }
    }

    // Rank confirmation handler (all clients)
    if (data.type === "rankConfirm") {
      try {
        
        if (data.objectType === "image") {
          // Update local rank in manager
          if (window.ZIndexManager && typeof window.ZIndexManager.setRank === 'function') {
            const currentRank = window.ZIndexManager.getRank(data.id);
            // Only update if rank actually changed (avoid unnecessary DOM updates)
            if (currentRank !== data.rank) {
              window.ZIndexManager.setRank(data.id, data.rank);
              
              // Refresh DOM z-index order
              await window.ZIndexManager.syncAllDOMZIndexes();
              
            } else {
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
              
            } else {
            }
          }
        }
      } catch (error) {
        console.error('[WB-E] Failed to apply rank confirmation:', error);
      }
    }

    if (data.type === "saveBase64Image") {
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

          const response = await foundry.applications.apps.FilePicker.implementation.upload("data", uploadPath, file, {}, {
            notify: false
          });

          if (response?.path) {

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

            }
          }
        } catch (error) {
          console.error("[WB-E] GM failed to save base64 image:", error);
        }
      }
    }

    if (data.type === "saveCanvasBase64Image") {
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

          const response = await foundry.applications.apps.FilePicker.implementation.upload("data", uploadPath, file, {}, {
            notify: false
          });

          if (response?.path) {

            // Broadcast the proper file path to all clients for canvas image replacement
            game.socket.emit(`module.${MODID}`, {
              type: "replaceCanvasBase64WithFile",
              base64Path: data.base64,

              filePath: response.path,
              fileName: data.fileName
            });

          }
        } catch (error) {
          console.error("[WB-E] GM failed to save canvas base64 image:", error);
        }
      }
    }

    if (data.type === "replaceCanvasBase64WithFile") {

      const layer = getOrCreateLayer();
      if (layer) {
        const imageElements = layer.querySelectorAll(".wbe-canvas-image");
        imageElements.forEach(img => {
          if (img.src === data.base64Path || img.src.includes(data.fileName)) {
            img.src = data.filePath;

            const container = img.closest(".wbe-canvas-image-container");
            if (container) {
              const imageId = container.id;
              // Use ImageTools to update the image data properly
              ImageTools.updateImageLocalVars(imageId, { src: data.filePath });
            }
          }
        });
      }
    }

    if (data.type === "cardUpdate") {

      const app = FateTableCardApp.instances.get(data.id);
      if (app && data.state) {
        app.cardData = foundry.utils.mergeObject(app.cardData, data.state, { inplace: false });

        if (data.state.pos) {
          app.setPosition(data.state.pos);
        }
        if (data.state.scale !== undefined) {
          app.applyScale();
        }

        const hasOtherChanges = Object.keys(data.state).some(key => key !== 'pos' && key !== 'scale');
        if (hasOtherChanges) {
          app.render(true);
        }
      }
    }

    if (data.type === "imageLock") {
      const container = document.getElementById(data.imageId);
      if (container && data.userId !== game.user.id) {

        ImageTools.applyImageLockVisual(container, data.userId, data.userName);
      }
    }

    if (data.type === "imageUnlock") {
      const container = document.getElementById(data.imageId);
      if (container) {

        ImageTools.removeImageLockVisual(container);
      }
    }

    // NEW: Handle text lock
    if (data.type === "textLock") {
      const container = document.getElementById(data.textId);
      if (container && data.userId !== game.user.id) {
        TextTools.applyTextLockVisual(container, data.userId, data.userName, data.width, data.height);
      }
    }

    // NEW: Handle text unlock
    if (data.type === "textUnlock") {
      const container = document.getElementById(data.textId);
      if (container) {
        TextTools.removeTextLockVisual(container);
      }
    }

    // NEW: Handle lock request - respond with our active locks
    if (data.type === "requestInitialState") {
      // CRITICAL FIX: GM sends current state to Player on F5 refresh
      // This prevents Player from loading "ghosts" from stale cache
      if (game.user.isGM) {
        const texts = await TextTools.getAllTexts();
        const images = await ImageTools.getAllImages();
        
        // CRITICAL FIX: Ensure ZIndexManager is synced with DB before sending to Player
        // This ensures ranks are up-to-date and z-index order is correct
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
        if (window.ZIndexManager && typeof window.ZIndexManager.syncWithExisting === 'function') {
          window.ZIndexManager.syncWithExisting(allData);
        }
        
        // Send full sync to Player - this will clear any "ghosts" from stale cache
        game.socket.emit(`module.${MODID}`, { 
          type: "textUpdate", 
          texts, 
          isFullSync: true 
        });
        game.socket.emit(`module.${MODID}`, { 
          type: "imageUpdate", 
          images, 
          isFullSync: true 
        });
      }
    }

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

  const boardRect = board.getBoundingClientRect();

  const transform = canvas.stage.worldTransform;
  const { a: scale, tx, ty } = transform;

  if (window._debugFateSync && _syncLogCounter++ % 60 === 0) {
    const card = document.querySelector("#whiteboard-experience-layer > *");
    const cardRect = card?.getBoundingClientRect();
  }

  layer.style.left = boardRect.left + 'px';
  layer.style.top = boardRect.top + 'px';
  layer.style.width = boardRect.width + 'px';
  layer.style.height = boardRect.height + 'px';
  layer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

let syncAnimationId = null;
function startContinuousSync() {
  if (syncAnimationId) return;

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

  const groupsObj = sc.controls;
  const group =
    groupsObj.tokens || groupsObj.token || groupsObj.notes ||
    Object.values(groupsObj)[0];

  if (!group) return;

  const toolName = "wbe-table-card";
  const tool = {
    name: toolName,
    title: "FATE Card",
    icon: "fas fa-id-card",
    button: true,
    onChange: async () => {
      if (!game.user.isGM) return ui.notifications.warn("Only GM can create cards.");
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
// Load toggle state from localStorage, default to false (Shift+drag mode)
let massSelectionToggleState = localStorage.getItem('wbe-mass-selection-toggle') === 'true';

async function injectMassSelectionTool() {
  const sc = ui.controls;
  if (!sc || !sc.controls) return;

  const isV11 = Array.isArray(sc.controls);
  const controlsData = sc.controls;

  const group = isV11 
    ? controlsData.find(g => g.name === "token" || g.name === "tokens")
    : (controlsData.token || controlsData.tokens);
    
  if (!group) return;

  const toolName = "wbe-mass-selection";

  const exists = isV11
    ? group.tools.find(t => t.name === toolName)
    : group.tools[toolName];
    
  if (exists) return;

  const handler = async () => {
    massSelectionToggleState = !massSelectionToggleState;
    localStorage.setItem('wbe-mass-selection-toggle', massSelectionToggleState.toString());
    
    MassSelection.setToggleState(massSelectionToggleState);
    MassSelection.clear();
    
    if (massSelectionToggleState) {
      ui.notifications.info("Mass Selection: ON - Default mouse drag to select objects");
    } else {
      ui.notifications.info("Mass Selection: OFF - Shift+drag to select objects");
    }
    
    setTimeout(() => sc.render(true), 10);
  };

  const tool = {
    name: toolName,
    title: massSelectionToggleState 
      ? "Mass Selection: ON (Default drag to select)" 
      : "Mass Selection: OFF (Shift+drag to select)",
    icon: "fas fa-mouse-pointer",
    button: true,
    ...(isV11 ? { visible: true } : { active: massSelectionToggleState }),
    [isV11 ? 'onClick' : 'onChange']: handler // Computed property name!
  };

  if (isV11) {
    group.tools.unshift(tool);
  } else {
    group.tools[toolName] = tool;
  }

  setTimeout(() => sc.render(true), 10);
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
    const clickTarget = container.querySelector('.wbe-text-click-target');
    
    if (isSelected) {
      // Selected text: container has pointer-events: none, click target has auto
      container.style.setProperty("pointer-events", "none", "important");
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "auto", "important");
      }
    } else {
      // Deselected text: both have pointer-events: none for canvas pass-through
      container.style.setProperty("pointer-events", "none", "important");
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "none", "important");
      }
    }
    pointerFixCount++;
  });
  
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

  document.querySelectorAll(".wbe-canvas-text-container").forEach(container => {
    if (exceptId && container.id === exceptId) return;

    const textElement = container.querySelector(".wbe-canvas-text");
    const resizeHandle = container.querySelector(".wbe-text-resize-handle");
    if (textElement && resizeHandle) {
      delete container.dataset.selected;
      container.style.removeProperty("pointer-events");
      textElement.style.removeProperty("outline");
      textElement.style.removeProperty("outline-offset");
      container.style.removeProperty("cursor");
      resizeHandle.style.display = "none";
    } else {
    }
  });

  document.querySelectorAll(".wbe-canvas-image-container").forEach(container => {
    if (exceptId && container.id === exceptId) {
      return;
    }

    const imageElement = container.querySelector(".wbe-canvas-image");
    const resizeHandle = container.querySelector(".wbe-image-resize-handle");
    const selectionBorder = container.querySelector(".wbe-image-selection-border");
    if (imageElement && resizeHandle) {
      delete container.dataset.selected;
      container.style.removeProperty("pointer-events");
      container.style.removeProperty("cursor");
      resizeHandle.style.display = "none";
      if (selectionBorder) selectionBorder.style.display = "none";
    } else {
    }
  });

  window.getSelection().removeAllRanges();
}

document.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});


document.addEventListener("copy", (e) => {

  if (!TextTools.selectedTextId && !ImageTools.selectedImageId) {
    TextTools.copiedTextData = null;
    ImageTools.copiedImageData = null;
  }
}, true); // capture phase

// Paste multi-selection functionality
async function pasteMultiSelection() {
  if (!window.wbeCopiedMultiSelection) return;


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

    TextTools.createTextElement({
      id: newId,
      text: textData.text,
      left: newLeft,
      top: newTop,
      scale: textData.scale,
      color: textData.color,
      backgroundColor: textData.backgroundColor,
      borderColor: textData.borderColor,
      borderWidth: textData.borderWidth,
      fontWeight: textData.fontWeight,
      fontStyle: textData.fontStyle,
      textAlign: textData.textAlign,
      fontFamily: textData.fontFamily,
      fontSize: textData.fontSize,
      width: textData.width
    });

    // Save the new text
    await TextTools.persistTextState(newId, document.getElementById(newId)?.querySelector(".wbe-canvas-text"), document.getElementById(newId));
  }

  // Paste images
  for (const [id, imageData] of Object.entries(images)) {
    const newId = `wbe-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newLeft = worldPos.x + (imageData.left || 0) + offset;
    const newTop = worldPos.y + (imageData.top || 0) + offset;

    ImageTools.createImageElement({
      id: newId,
      src: imageData.src,
      left: newLeft,
      top: newTop,
      scale: imageData.scale,
      crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
      maskType: imageData.maskType || 'rect',
      circleOffset: imageData.circleOffset || { x: 0, y: 0 },
      circleRadius: imageData.circleRadius || null,
      isFrozen: imageData.isFrozen || false,
      borderHex: imageData.borderHex,
      borderOpacity: imageData.borderOpacity,
      borderWidth: imageData.borderWidth,
      borderRadius: imageData.borderRadius,
      shadowHex: imageData.shadowHex,
      shadowOpacity: imageData.shadowOpacity
      // displayWidth/displayHeight not passed - will be calculated after paste
    });

    // Save the new image
    await ImageTools.persistImageState(newId, document.getElementById(newId)?.querySelector(".wbe-canvas-image"), document.getElementById(newId));
  }

}

function setupGlobalPasteHandler() {
  document.addEventListener("paste", async (e) => {
    if (document.activeElement &&
      (document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA" ||
        document.activeElement.isContentEditable)) {
      return;
    }

    if (document.activeElement &&
      document.activeElement.classList &&
      document.activeElement.classList.contains("ftc-portrait")) {
      return;
    }

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    if (!items) return;

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

    if (hasImage) {
      e.preventDefault();
      e.stopPropagation();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            await ImageTools.handleImagePasteFromClipboard(file);
            return;
          }
        }
      }
    }

    if (hasText) {
      const text = clipboardData.getData("text/plain");
      if (text && text.trim()) {

        if (text.startsWith("[wbe-IMAGE-COPY:") && ImageTools.copiedImageData) {
          e.preventDefault();
          e.stopPropagation();
          await ImageTools.globalPasteImage();
          return;
        }

        if (text.startsWith("[wbe-TEXT-COPY:") && TextTools.copiedTextData) {
          e.preventDefault();
          e.stopPropagation();
          await TextTools.globalPasteText();
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        await TextTools.handleTextPasteFromClipboard(text.trim());
        return;
      }
    }

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

function setupIndependentPanZoomHooks() {
  const closePanels = () => {
    window.wbeColorPanel?.cleanup();
    window.wbeImageControlPanel?.cleanup();
  };

  const disableClickTargets = () => {
    document.querySelectorAll('.wbe-text-click-target, .wbe-image-click-target').forEach(target => {
      if (target.style.pointerEvents !== 'none') {
        target.dataset.wbeOriginalPointerEvents = target.style.pointerEvents || '';
        target.style.setProperty('pointer-events', 'none', 'important');
      }
    });
  };

  const restoreClickTargets = () => {
    document.querySelectorAll('.wbe-text-click-target, .wbe-image-click-target').forEach(target => {
      if (target.dataset.wbeOriginalPointerEvents !== undefined) {
        const original = target.dataset.wbeOriginalPointerEvents;
        if (original) {
          target.style.setProperty('pointer-events', original, 'important');
        } else {
          target.style.removeProperty('pointer-events');
        }
        delete target.dataset.wbeOriginalPointerEvents;
      }
    });
  };

  let panStartX = null;
  let panStartY = null;
  let panStartPivot = null;
  let isPanning = false;
  const RIGHT_CLICK_DRAG_THRESHOLD = 5;

  // Capture phase: отключаем pointer-events ДО того, как событие обработается другими обработчиками
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const clickTarget = elements.find(el => 
      el.classList.contains('wbe-text-click-target') || 
      el.classList.contains('wbe-image-click-target')
    );
    
    // Если нет clickTarget - пропускаем событие дальше к Foundry (canvas сам обработает пан)
    if (!clickTarget) {
      return;
    }
    
    // Проверяем, что под мышкой не canvas элемент
    const canvasElement = elements.find(el => el.id === 'board' || el.classList.contains('board'));
    if (canvasElement && elements.indexOf(canvasElement) < elements.indexOf(clickTarget)) {
      // Canvas находится выше clickTarget - пропускаем событие к Foundry
      return;
    }
    
    if (!canvas?.stage) {
      return;
    }
    
    e.preventDefault();
    
    // Отключаем pointer-events СРАЗУ в capture phase
    disableClickTargets();
    
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPivot = {
      x: canvas.stage.pivot.x,
      y: canvas.stage.pivot.y
    };
    isPanning = false;
    
    closePanels();
  }, true);

  document.addEventListener("mousemove", (e) => {
    if (!e.buttons || (e.buttons & 2) === 0) {
      if (panStartX !== null || panStartY !== null) {
        restoreClickTargets();
      }
      panStartX = null;
      panStartY = null;
      panStartPivot = null;
      isPanning = false;
      return;
    }

    // Если пан не начат (нет panStartX) - пропускаем событие дальше к Foundry
    if (panStartX === null || panStartY === null || !panStartPivot) {
      return;
    }

    if (!canvas?.stage) {
      return;
    }

    const deltaX = Math.abs(e.clientX - panStartX);
    const deltaY = Math.abs(e.clientY - panStartY);
    
    if (deltaX > RIGHT_CLICK_DRAG_THRESHOLD || deltaY > RIGHT_CLICK_DRAG_THRESHOLD) {
      if (!isPanning) {
        wbeLog('PanZoom', `mousemove: STARTING PAN via Foundry API`);
        isPanning = true;
      }
      
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      
      canvas.pan({
        x: panStartPivot.x - dx / canvas.stage.scale.x,
        y: panStartPivot.y - dy / canvas.stage.scale.y
      });
    }
  }, true);

  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    
    if (isPanning || panStartX !== null) {
      restoreClickTargets();
    }
    
    panStartX = null;
    panStartY = null;
    panStartPivot = null;
    isPanning = false;
  }, true);

  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    disableClickTargets();
    closePanels();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreClickTargets();
      });
    });
  }, { capture: true, passive: true });
}






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
  // CRITICAL FIX: Player should request current state from GM instead of reading stale cache
  // GM is the source of truth - cache may contain "ghosts" from previous deletions
  if (!game.user.isGM) {
    // Player requests current state from GM
    game.socket.emit(`module.${MODID}`, { 
      type: "requestInitialState",
      userId: game.user.id 
    });
    // Don't load from cache - wait for GM response
    return;
  }
  
  // GM reads from database (source of truth)
  const texts = await TextTools.getAllTexts();
  const images = await ImageTools.getAllImages();

  // DEBUG: Log what we're reading from DB
  console.log(`[ZIndexDebug] loadCanvasElements: Found ${Object.keys(texts).length} texts, ${Object.keys(images).length} images`);
  Object.entries(texts).forEach(([id, data]) => {
    console.log(`[ZIndexDebug] Text ${id.slice(-6)} from DB: rank="${data.rank}", zIndex=${data.zIndex}`);
  });
  Object.entries(images).forEach(([id, data]) => {
    console.log(`[ZIndexDebug] Image ${id.slice(-6)} from DB: rank="${data.rank}", zIndex=${data.zIndex}, rankType=${typeof data.rank}`);
  });

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

  for (const [id, data] of Object.entries(texts)) {
    // NOTE: syncRankEntry not needed here - syncWithExisting already registered all objects with their ranks
    // createTextElement will use the rank from data.rank parameter
    TextTools.createTextElement({
      id: id,
      text: data.text,
      left: data.left,
      top: data.top,
      scale: data.scale,
      color: data.color,
      backgroundColor: data.backgroundColor,
      borderColor: data.borderColor,
      borderWidth: data.borderWidth,
      fontWeight: data.fontWeight,
      fontStyle: data.fontStyle,
      textAlign: data.textAlign || TextTools.DEFAULT_TEXT_ALIGN,
      fontFamily: data.fontFamily || TextTools.DEFAULT_FONT_FAMILY,
      fontSize: data.fontSize || TextTools.DEFAULT_FONT_SIZE,
      width: data.width,
      rank: data.rank
    });
  }

  for (const [id, data] of Object.entries(images)) {
    // NOTE: syncRankEntry not needed here - syncWithExisting already registered all objects with their ranks
    // createImageElement will use the rank from data.rank parameter
    // Validate image data before creating element
    if (!data.src || typeof data.src !== 'string') {
      console.warn(`[WB-E] Skipping image ${id}: invalid or missing src`);
      continue;
    }

    console.log('[F5 LOAD] Loading image from DB', {
      id,
      scale: data.scale,
      displayWidth: data.displayWidth,
      displayHeight: data.displayHeight,
      displayWidthType: typeof data.displayWidth,
      displayHeightType: typeof data.displayHeight,
      hasDisplayDims: !!(data.displayWidth && data.displayHeight)
    });

    try {
      console.log('[F5 LOAD] Calling createImageElement with', {
        id,
        displayWidth: data.displayWidth,
        displayHeight: data.displayHeight,
        displayWidthType: typeof data.displayWidth,
        displayHeightType: typeof data.displayHeight
      });
      
      // F5 reload - pass saved displayWidth/displayHeight for correct placeholder sizing
      ImageTools.createImageElement({
        id,
        src: data.src,
        left: data.left,
        top: data.top,
        scale: data.scale,
        crop: data.crop || { top: 0, right: 0, bottom: 0, left: 0 },
        maskType: data.maskType || 'rect',
        circleOffset: data.circleOffset || { x: 0, y: 0 },
        circleRadius: data.circleRadius || null,
        isFrozen: data.isFrozen || false,
        displayWidth: data.displayWidth,
        displayHeight: data.displayHeight,
        borderHex: data.borderHex,
        borderOpacity: data.borderOpacity,
        borderWidth: data.borderWidth,
        borderRadius: data.borderRadius,
        shadowHex: data.shadowHex,
        shadowOpacity: data.shadowOpacity,
        rank: data.rank
      });
    } catch (error) {
      console.error(`[WB-E] Failed to restore image ${id}:`, error);
    }
  }
  
  // CRITICAL FIX: Sync all DOM z-indexes after loading all elements
  // This ensures correct z-index order after F5 reload
  if (window.ZIndexManager && typeof window.ZIndexManager.syncAllDOMZIndexes === 'function') {
    await window.ZIndexManager.syncAllDOMZIndexes();
    
    // DEBUG: Verify z-index order after sync
    const allObjects = window.ZIndexManager.getAllObjectsSorted();
    console.log(`[ZIndexDebug] After syncAllDOMZIndexes: ${allObjects.length} objects total`);
    allObjects.forEach((obj, idx) => {
      const el = document.getElementById(obj.id);
      const domZIndex = el ? parseInt(el.style.zIndex) || 0 : null;
      const managerZIndex = window.ZIndexManager.get(obj.id);
      console.log(`[ZIndexDebug] ${idx}: ${obj.type} ${obj.id.slice(-6)} rank="${obj.rank}" Manager z-index=${managerZIndex} DOM z-index=${domZIndex}`);
    });
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

    await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY);
    await new Promise(resolve => setTimeout(resolve, 50));
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

  const centerScreen = { x: window.innerWidth / 2 - 280, y: window.innerHeight / 2 - 200 };
  const worldPos = screenToWorld(centerScreen.x + offset, centerScreen.y + offset);

  const def = {
    pos: { left: worldPos.x, top: worldPos.y, width: 1060, height: "auto" },
    scale: 1.0,
    name: "New Card",
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

  if (!game.user.isGM) {
    game.socket.emit(`module.${MODID}`, { type: "cardUpdateRequest", id, patch, userId: game.user.id });

    const app = FateTableCardApp.instances.get(id);
    if (app) {
      app.cardData = foundry.utils.mergeObject(app.cardData, patch, { inplace: false });
    }
    return;
  }

  const states = await getAllStates();
  if (!states[id]) return;
  states[id] = foundry.utils.mergeObject(states[id], patch, { inplace: false });
  await setAllStates(states, false);

  const app = FateTableCardApp.instances.get(id);
  if (app) {
    app.cardData = foundry.utils.mergeObject(app.cardData, patch, { inplace: false });
  }

  if (broadcast) {
    game.socket.emit(`module.${MODID}`, { type: "cardUpdate", id, state: patch });
  }

  return states[id];
}

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
      } catch (e) {
        console.error('[clearCanvasElements] Error clearing ZIndexManager:', e);
      }
    }

    // FIX: Clear MassSelection state
    if (window.MassSelection && typeof window.MassSelection.clear === "function") {
      try {
        window.MassSelection.clear();
      } catch (e) {
        console.error('[clearCanvasElements] Error clearing MassSelection:', e);
      }
    }


    try {
      // [ZINDEX_ANALYSIS] Track clearCanvasElements call
      await TextTools.setAllTexts({});
      await ImageTools.setAllImages({});
    } catch (e) {
      console.error("[clearCanvasElements] Error clearing elements:", e);
    }

  },

  // Mass selection helper
  get massSelection() { return MassSelection; }
};

// NEW: Expose MassSelection globally for integration with text/image handlers
window.MassSelection = MassSelection;
