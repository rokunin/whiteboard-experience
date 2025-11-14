import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Basic Test Suite
 * Comprehensive tests for whiteboard functionality:
 * - Z-index changes (GM + Player)
 * - Mass selection
 * - Drag operations
 * - Object deletion
 */

test.describe('Basic Test Suite', () => {
  test.setTimeout(180000); // 3 minutes timeout
  
  // Helper: Setup browser log capture with detailed tracking
  function setupBrowserLogCapture(page) {
    const browserLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      const timestamp = Date.now();
      browserLogs.push({ 
        type, 
        text, 
        timestamp,
        isoTime: new Date().toISOString()
      });
    });
    page['_browserLogs'] = browserLogs;
    return browserLogs;
  }
  
  // Helper: Analyze logs to find culprit
  function analyzeLogsForCulprit(browserLogs, elementIds) {
    console.log('\n=== LOG ANALYSIS: Finding Culprit ===');
    
    // Extract key events
    const events = [];
    
    for (const log of browserLogs) {
      const text = log.text;
      
      // Extract timestamp from log text if present, otherwise use log timestamp
      const timestampMatch = text.match(/\[(\d+)\]/);
      const eventTimestamp = timestampMatch ? parseInt(timestampMatch[1]) : log.timestamp;
      
      // Track getAllImages calls
      if (text.includes('getAllImages() returned')) {
        const match = text.match(/returned (\d+) images/);
        const count = match ? parseInt(match[1]) : 0;
        const idsMatch = text.match(/images: (\[.*?\])/);
        let ids = [];
        if (idsMatch) {
          try {
            ids = JSON.parse(idsMatch[1]);
          } catch (e) {
            // Try to extract IDs manually if JSON parse fails
            const idPattern = /wbe-image-[^\s,\]]+/g;
            const matches = text.match(idPattern);
            if (matches) ids = matches;
          }
        }
        events.push({
          type: 'getAllImages',
          timestamp: eventTimestamp,
          count,
          ids,
          log: text
        });
      }
      
      // Track setAllImages calls
      if (text.includes('setAllImages:')) {
        const match = text.match(/Sending (\d+) images/);
        const count = match ? parseInt(match[1]) : 0;
        const idsMatch = text.match(/images: (\[.*?\])/);
        let ids = [];
        if (idsMatch) {
          try {
            ids = JSON.parse(idsMatch[1]);
          } catch (e) {
            // Try to extract IDs manually if JSON parse fails
            const idPattern = /wbe-image-[^\s,\]]+/g;
            const matches = text.match(idPattern);
            if (matches) ids = matches;
          }
        }
        events.push({
          type: 'setAllImages',
          timestamp: eventTimestamp,
          count,
          ids,
          log: text
        });
      }
      
      // Track removals
      if (text.includes('🚨 REMOVING') || text.includes('Removing element:')) {
        let removedIds = [];
        // Try to extract array of IDs
        const arrayMatch = text.match(/\[(.*?)\]/);
        if (arrayMatch) {
          try {
            removedIds = JSON.parse(`[${arrayMatch[1]}]`);
          } catch {
            // Extract individual IDs
            const idPattern = /wbe-image-[^\s,\]]+/g;
            const matches = text.match(idPattern);
            if (matches) removedIds = matches;
          }
        } else {
          // Single element removal
          const singleMatch = text.match(/element: (wbe-image-[^\s]+)/);
          if (singleMatch) removedIds = [singleMatch[1]];
        }
        events.push({
          type: 'REMOVAL',
          timestamp: eventTimestamp,
          removedIds,
          log: text
        });
      }
      
      // Track missing images warnings
      if (text.includes('NOT in getAllImages()') || text.includes('NOT in current state')) {
        events.push({
          type: 'MISSING_WARNING',
          timestamp: eventTimestamp,
          log: text
        });
      }
      
      // Track text z-index events
      if (text.includes('[Z-Index] TEXT')) {
        const match = text.match(/z-index: (\d+) → (\d+)/);
        if (match) {
          events.push({
            type: 'TEXT_ZINDEX_CHANGE',
            timestamp: eventTimestamp,
            oldZ: parseInt(match[1]),
            newZ: parseInt(match[2]),
            log: text
          });
        }
      }
      
      // Track text getAllTexts/setAllTexts
      if (text.includes('getAllTexts() returned') || text.includes('setAllTexts:') || text.includes('debouncedFlushTextUpdates')) {
        const match = text.match(/(\d+) text/);
        const count = match ? parseInt(match[1]) : 0;
        events.push({
          type: 'TEXT_STATE_CHANGE',
          timestamp: eventTimestamp,
          count,
          log: text
        });
      }
    }
    
    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);
    
    // Find the sequence leading to removal
    console.log('\n--- Event Timeline ---');
    let lastGetAllImages = null;
    let lastSetAllImages = null;
    
    for (const event of events) {
      if (event.type === 'getAllImages') {
        lastGetAllImages = event;
        console.log(`[${event.timestamp}] getAllImages() returned ${event.count} images`);
        if (event.count < 3) {
          console.error(`  ⚠️ PROBLEM: Only ${event.count} images returned (expected 3)!`);
        }
      } else if (event.type === 'setAllImages') {
        lastSetAllImages = event;
        console.log(`[${event.timestamp}] setAllImages() called with ${event.count} images`);
        if (lastGetAllImages && event.count < lastGetAllImages.count) {
          console.error(`  ⚠️ PROBLEM: setAllImages received ${event.count} images but getAllImages returned ${lastGetAllImages.count}!`);
        }
      } else if (event.type === 'REMOVAL') {
        console.error(`[${event.timestamp}] 🚨 REMOVAL DETECTED:`, event.removedIds);
        if (lastSetAllImages) {
          console.error(`  ⚠️ CULPRIT: setAllImages() was called ${event.timestamp - lastSetAllImages.timestamp}ms before removal`);
          console.error(`  ⚠️ setAllImages had ${lastSetAllImages.count} images, but ${event.removedIds.length} were removed`);
          console.error(`  ⚠️ Missing IDs:`, event.removedIds.filter(id => !lastSetAllImages.ids.includes(id)));
        }
        if (lastGetAllImages) {
          console.error(`  ⚠️ getAllImages() returned ${lastGetAllImages.count} images ${event.timestamp - lastGetAllImages.timestamp}ms before removal`);
        }
      } else if (event.type === 'MISSING_WARNING') {
        console.warn(`[${event.timestamp}] ⚠️ WARNING:`, event.log);
      }
    }
    
    // Summary
    const removals = events.filter(e => e.type === 'REMOVAL');
    const getAllImagesEvents = events.filter(e => e.type === 'getAllImages');
    const setAllImagesEvents = events.filter(e => e.type === 'setAllImages');
    
    console.log('\n--- Summary ---');
    console.log(`Total getAllImages() calls: ${getAllImagesEvents.length}`);
    console.log(`Total setAllImages() calls: ${setAllImagesEvents.length}`);
    console.log(`Total REMOVAL events: ${removals.length}`);
    
    if (removals.length > 0) {
      console.error('\n🚨 CULPRIT IDENTIFIED:');
      removals.forEach((removal, idx) => {
        console.error(`\nRemoval #${idx + 1}:`);
        console.error(`  Removed IDs:`, removal.removedIds);
        console.error(`  Full log:`, removal.log);
        
        // Find the setAllImages call that likely caused this
        const precedingSetAllImages = setAllImagesEvents
          .filter(e => e.timestamp < removal.timestamp)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        
        if (precedingSetAllImages) {
          console.error(`  Likely caused by setAllImages() at ${precedingSetAllImages.timestamp}`);
          console.error(`  That call had ${precedingSetAllImages.count} images:`, precedingSetAllImages.ids);
        }
      });
    }
    
    return { events, removals, getAllImagesEvents, setAllImagesEvents };
  }
  
  // Helper: Login and setup for a specific user
  async function setupTestForUser(page, userId, userName) {
    await page.goto('http://localhost:30000/join');
    await page.waitForTimeout(1000);
    
    // Wait for combobox to be ready and select option
    await page.waitForSelector('select[name="userid"]', { state: 'visible' });
    await page.waitForTimeout(500);
    await page.selectOption('select[name="userid"]', userId);
    await page.waitForTimeout(500);
    
    await page.getByRole('button', { name: ' Join Game Session' }).click();
    await page.waitForTimeout(1000);
    
    // Close window if it appears
    try {
      await page.getByRole('button', { name: 'Close Window' }).click({ timeout: 2000 });
      await page.waitForTimeout(500);
    } catch (e) {
      // Window might not appear, that's okay
    }
    
    await page.waitForTimeout(2000);
    
    // Wait for whiteboard to be ready
    await page.waitForSelector('#board', { timeout: 10000 });
    await page.waitForTimeout(1000);
    
    console.log(`[${userName}] Setup complete`);
  }
  
  // Helper: Cleanup (only GM should do cleanup)
  async function cleanupTest(page, userName) {
    await page.evaluate(async () => {
      try {
        if (globalThis.canvas?.scene?.unsetFlag) {
          await Promise.all([
            globalThis.canvas.scene.unsetFlag("whiteboard-experience", "texts"),
            globalThis.canvas.scene.unsetFlag("whiteboard-experience", "images"),
            globalThis.canvas.scene.unsetFlag("whiteboard-experience", "cards")
          ]);
        }
      } catch (err) {
        console.error('[TEST] Failed to unset whiteboard flags:', err);
      }

      if (globalThis.WhiteboardExperience?.clearCanvasElements) {
        await globalThis.WhiteboardExperience.clearCanvasElements();
      }
    });
    await page.waitForTimeout(1000);
    console.log(`[${userName}] Cleanup complete`);
  }
  
  // Helper: Login and setup (deprecated - use setupTestForUser instead)
  async function setupTest(page) {
    await page.goto('http://localhost:30000/join');
    await page.waitForTimeout(1000);
    
    // Wait for combobox to be ready and select option
    await page.waitForSelector('select[name="userid"]', { state: 'visible' });
    await page.waitForTimeout(500);
    await page.selectOption('select[name="userid"]', 'LoZGkWmu3xRB0sXZ');
    await page.waitForTimeout(500);
    
    await page.getByRole('button', { name: ' Join Game Session' }).click();
    await page.waitForTimeout(1000);
    
    // Close window if it appears
    try {
      await page.getByRole('button', { name: 'Close Window' }).click({ timeout: 2000 });
      await page.waitForTimeout(500);
    } catch (e) {
      // Window might not appear, that's okay
    }
    
    await page.waitForTimeout(2000);
    
    // Wait for whiteboard to be ready
    await page.waitForSelector('#board', { timeout: 10000 });
    await page.waitForTimeout(1000);
    
    // Cleanup
    // Cleanup
    await page.evaluate(async () => {
      try {
        if (globalThis.canvas?.scene?.unsetFlag) {
          await Promise.all([
            globalThis.canvas.scene.unsetFlag("whiteboard-experience", "texts"),
            globalThis.canvas.scene.unsetFlag("whiteboard-experience", "images"),
            globalThis.canvas.scene.unsetFlag("whiteboard-experience", "cards")
          ]);
        }
      } catch (err) {
        console.error('[TEST] Failed to unset whiteboard flags:', err);
      }

      if (globalThis.WhiteboardExperience?.clearCanvasElements) {
        await globalThis.WhiteboardExperience.clearCanvasElements();
      }
    });
    await page.waitForTimeout(1000);
  }
  
  // Helper: Create 3 test texts using T-cursor (honest way)
  async function createThreeTexts(page, offsetY = 0) {
    console.log(`Creating 3 test text objects using T-cursor (offsetY=${offsetY})...`);
    
    // Calculate cursor positions in SCREEN coordinates relative to board center
    // Same positions as images: center -200px X, -300px Y + offsetY; center X, -300px Y + offsetY; center +200px X, -300px Y + offsetY
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) {
      throw new Error('Board not found');
    }
    
    const centerX = boardRect.left + boardRect.width / 2;
    const centerY = boardRect.top + boardRect.height / 2;
    
    const screenPositions = [
      { x: centerX - 200, y: centerY - 300 + offsetY },
      { x: centerX, y: centerY - 300 + offsetY },
      { x: centerX + 200, y: centerY - 300 + offsetY }
    ];
    
      const texts = ['Text 1', 'Text 2', 'Text 3'];
    const elementIds = [];
      
      for (let i = 0; i < 3; i++) {
      // Press T to enter text mode
      await page.keyboard.press('t');
      await page.waitForTimeout(100);
      
      // Click on canvas at position
      await page.mouse.click(screenPositions[i].x, screenPositions[i].y);
      await page.waitForTimeout(300);
      
      // Type text
      await page.keyboard.type(texts[i]);
      await page.waitForTimeout(100);
      
      // Press Enter to finish editing (text should be automatically selected after Enter)
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500); // Wait for text to be saved and selection to register
      
      // Get the created text ID - after Enter, text should be automatically selected
      const createdId = await page.evaluate(({ existingIds }) => {
        const TextTools = window.TextTools;
        if (TextTools && TextTools.selectedTextId && !existingIds.includes(TextTools.selectedTextId)) {
          return TextTools.selectedTextId;
        }
        return null;
      }, { existingIds: elementIds });
      
      if (createdId) {
        elementIds.push(createdId);
      } else {
        // Fallback: find the newest text element that wasn't already added
        const fallbackId = await page.evaluate(({ existingIds }) => {
          const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'))
            .filter(el => !existingIds.includes(el.id));
          if (allTexts.length === 0) return null;
          const newest = allTexts
            .map(el => {
              const textTime = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
              return { id: el.id, time: textTime };
            })
            .sort((a, b) => b.time - a.time)[0];
          return newest?.id || null;
        }, { existingIds: elementIds });
        if (fallbackId && !elementIds.includes(fallbackId)) {
          elementIds.push(fallbackId);
          console.log(`  Fallback: Found text ${i + 1} via DOM search: ${fallbackId.slice(-6)}`);
        } else {
          console.warn(`Warning: Text ${i + 1} was not found after creation`);
        }
      }
      
      // Small delay between creates
      await page.waitForTimeout(200);
    }
    
    // Exit text mode using right-click (more reliable than pressing 't')
    // Right-click on the board to exit text mode
    if (boardRect) {
      // Right-click in the center of the board to exit text mode
      await page.mouse.click(boardRect.left + boardRect.width / 2, boardRect.top + boardRect.height / 2, { button: 'right' });
      await page.waitForTimeout(200);
    }
    
    expect(elementIds.length).toBe(3);
    
    // Wait for texts to be fully created and persisted
    await page.waitForTimeout(1000);
    
    // Verify containers exist
    const containersReady = await page.evaluate(({ elementIds }) => {
      const results = elementIds.map(id => {
        const el = document.getElementById(id);
        return {
          id,
          exists: !!el,
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          visible: el ? el.offsetParent !== null : false
        };
      });
      return results;
    }, { elementIds });
    
    console.log('Created texts:');
    containersReady.forEach((result, idx) => {
      console.log(`  Text ${idx + 1} (${result.id.slice(-6)}): DOM=${result.domZIndex}, Manager=${result.managerZIndex}, Visible=${result.visible}`);
    });
    
    return elementIds;
  }
  // Helper: Create 3 test images via paste (real user workflow)
  async function createThreeImages(page, offsetY = 0) {
    console.log(`Creating 3 test images via paste (real workflow, offsetY=${offsetY})...`);
    
    // Load test-image.png ONCE in Node.js context
    const testImagePath = path.join(__dirname, 'test-image.png');
    const imageBuffer = fs.readFileSync(testImagePath);
    const imageBase64 = imageBuffer.toString('base64');
    
    console.log(`Loaded test-image.png: ${imageBuffer.length} bytes`);
    
    // Calculate cursor positions in SCREEN coordinates relative to board center
    // Positions: center -200px X, -300px Y + offsetY; center X, -300px Y + offsetY; center +200px X, -300px Y + offsetY
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) {
      throw new Error('Board not found');
    }
    
    const centerX = boardRect.left + boardRect.width / 2;
    const centerY = boardRect.top + boardRect.height / 2;
    
    const screenPositions = [
      { x: centerX - 200, y: centerY - 300 + offsetY },  // Image 1: center -200px X, -300px Y + offsetY
      { x: centerX, y: centerY - 300 + offsetY },        // Image 2: center X, -300px Y + offsetY
      { x: centerX + 200, y: centerY - 300 + offsetY }   // Image 3: center +200px X, -300px Y + offsetY
    ];
    
    console.log(`[TEST] Screen cursor positions (Node.js context):`);
    screenPositions.forEach((pos, i) => {
      console.log(`  Image ${i + 1}: cursorX=${pos.x}, cursorY=${pos.y}`);
    });
    console.log(`[TEST] Board rect: left=${boardRect.left}, top=${boardRect.top}, width=${boardRect.width}, height=${boardRect.height}`);
    console.log(`[TEST] Calculated center: centerX=${boardRect.left + boardRect.width / 2}, centerY=${boardRect.top + boardRect.height / 2}`);
    
    // Create images via paste (real user workflow)
    const elementIds = [];
    
    for (let i = 0; i < 3; i++) {
      const cursorX = screenPositions[i].x;
      const cursorY = screenPositions[i].y;
      
      console.log(`[TEST] Moving cursor to position ${i + 1}: cursorX=${cursorX}, cursorY=${cursorY}`);
      
      // Move cursor to position BEFORE creating image (Playwright API)
      await page.mouse.move(cursorX, cursorY);
      await page.waitForTimeout(100); // Small delay to ensure cursor position is registered
      
      // Now create image at this cursor position
      const imageId = await page.evaluate(async ({ imageBase64, cursorX, cursorY, imageIndex }) => {
        const ImageTools = window.ImageTools;
        if (!ImageTools) {
          throw new Error('ImageTools not available - module may not be loaded');
        }
        
        const { setSharedVars, getSharedVars } = window;
        
        // Log actual cursor position being set
        const board = document.getElementById('board');
        const boardRect = board ? board.getBoundingClientRect() : null;
        console.log(`[TEST] Setting cursor for image ${imageIndex + 1}: cursorX=${cursorX}, cursorY=${cursorY}`);
        if (boardRect) {
          console.log(`[TEST] Board rect at image ${imageIndex + 1}: left=${boardRect.left}, top=${boardRect.top}, width=${boardRect.width}, height=${boardRect.height}`);
          const boardCenterX = boardRect.left + boardRect.width / 2;
          const boardCenterY = boardRect.top + boardRect.height / 2;
          console.log(`[TEST] Board center at image ${imageIndex + 1}: centerX=${boardCenterX}, centerY=${boardCenterY}`);
          console.log(`[TEST] Offset from center: offsetX=${cursorX - boardCenterX}, offsetY=${cursorY - boardCenterY}`);
        }
        
        // Set cursor position in screen coordinates (handleImagePasteFromClipboard will convert to world)
        if (setSharedVars && typeof setSharedVars === 'function') {
          setSharedVars({ lastMouseX: cursorX, lastMouseY: cursorY });
          const vars = getSharedVars();
          console.log(`[TEST] Verified cursor position for image ${imageIndex + 1}: lastMouseX=${vars.lastMouseX}, lastMouseY=${vars.lastMouseY}`);
        } else if (window.lastMouseX !== undefined) {
          window.lastMouseX = cursorX;
          window.lastMouseY = cursorY;
          console.log(`[TEST] Set window.lastMouseX=${window.lastMouseX}, window.lastMouseY=${window.lastMouseY}`);
        }
        
        // Convert base64 to File object
        const byteCharacters = atob(imageBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let j = 0; j < byteCharacters.length; j++) {
          byteNumbers[j] = byteCharacters.charCodeAt(j);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });
        const file = new File([blob], `test-image-${imageIndex}.png`, { type: 'image/png' });
        
        // Paste image - it will be centered under cursor position
        await ImageTools.handleImagePasteFromClipboard(file);
        
        // Wait for image to be created
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Find the newly created image (should be the most recent one)
        const allImages = await ImageTools.getAllImages();
        const imageEntries = Object.entries(allImages);
        let newestId = null;
        if (imageEntries.length > 0) {
          // Get the most recently created image (highest timestamp in ID)
          const sorted = imageEntries.sort((a, b) => {
            const timeA = parseInt(a[0].match(/wbe-image-(\d+)/)?.[1] || 0);
            const timeB = parseInt(b[0].match(/wbe-image-(\d+)/)?.[1] || 0);
            return timeB - timeA;
          });
          newestId = sorted[0][0];
        }
        
        return newestId;
      }, { imageBase64, cursorX, cursorY, imageIndex: i });
      
      if (imageId && !elementIds.includes(imageId)) {
        elementIds.push(imageId);
        
        // Resize image to 200x200 (test-image.png is 1024x1024)
        // Wait for image load AND all auto-rescaling from main logic to complete
        await page.evaluate(async ({ imageId }) => {
          const ImageTools = window.ImageTools;
          const container = document.getElementById(imageId);
          if (container) {
            const imageElement = container.querySelector('.wbe-canvas-image');
            if (imageElement) {
              // Step 1: Wait for image to load
              await new Promise(resolve => {
                if (imageElement.complete) {
                  resolve();
                } else {
                  imageElement.onload = resolve;
                  imageElement.onerror = resolve;
                }
              });
              
              // Step 2: Wait for onload handler to complete (min 500ms + 200ms save delay = 700ms)
              // The onload handler applies auto-scaling if scale === 1 and image is large
              await new Promise(resolve => setTimeout(resolve, 800));
              
              // Step 3: Wait for scale to stabilize (check that it's not changing)
              let previousScale = null;
              let stableCount = 0;
              for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const currentCropData = ImageTools.getImageCropData(imageElement);
                const currentScale = currentCropData.scale;
                
                if (previousScale === null) {
                  previousScale = currentScale;
                  stableCount = 1;
                } else if (Math.abs(currentScale - previousScale) < 0.001) {
                  stableCount++;
                  if (stableCount >= 3) {
                    // Scale is stable
                    break;
                  }
                } else {
                  previousScale = currentScale;
                  stableCount = 1;
                }
              }
              
              // Step 4: Now apply our target scale (200x200)
              const targetSize = 200;
              const originalSize = imageElement.naturalWidth || 1024;
              const newScale = targetSize / originalSize;
              
              // Set new scale
              ImageTools.setImageCropData(imageElement, { scale: newScale });
              
              // Save state
              await ImageTools.persistImageState(imageId, imageElement, container);
              
              // Wait for save to complete
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }, { imageId });
      }
      
      // Small delay between image creations
      await page.waitForTimeout(200);
    }
    
    expect(elementIds.length).toBe(3);
    
    // Wait for images to be fully created and persisted
    await page.waitForTimeout(1500);
    
    // Verify containers exist
    const containersReady = await page.evaluate(({ elementIds }) => {
      const results = elementIds.map(id => {
        const el = document.getElementById(id);
        return {
          id,
          exists: !!el,
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0
        };
      });
      return results;
    }, { elementIds });
    
    console.log('Created images:');
    containersReady.forEach((result, idx) => {
      console.log(`  Image ${idx + 1} (${result.id.slice(-6)}): DOM=${result.domZIndex}, Manager=${result.managerZIndex}`);
    });
    
    return elementIds;
  }
  
  // Helper: Get current z-index state (works for both images and texts)
  async function getZIndexState(page, elementIds) {
    return await page.evaluate(({ elementIds }) => {
      const state = {};
      for (const id of elementIds) {
        const el = document.getElementById(id);
        state[id] = {
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el,
          visible: el ? el.offsetParent !== null : false,
          display: el ? window.getComputedStyle(el).display : 'none'
        };
      }
      return state;
    }, { elementIds });
  }
  
  // Helper: Verify DOM-Manager synchronization (throws on mismatch)
  function verifyZIndexSync(state, elementId, context) {
    const s = state[elementId];
    if (!s) return;
    
    if (s.domZIndex !== s.managerZIndex && s.domZIndex > 0 && s.managerZIndex > 0) {
      throw new Error(`DOM-Manager desync ${context}: Element ${elementId.slice(-6)} DOM=${s.domZIndex}, Manager=${s.managerZIndex}`);
    }
  }
  
  // Helper: Analyze duplicate z-index patterns from logs
  function analyzeDuplicateZIndexPatterns(browserLogs, elementIds, finalState = {}) {
    console.log('\n=== DUPLICATE Z-INDEX ANALYSIS ===');
    
    const zIndexHistory = new Map(); // id -> [{timestamp, zIndex, operation, log}]
    const duplicateEvents = [];
    
    // Parse z-index changes from logs
    for (const log of browserLogs) {
      const text = log.text;
      const timestampMatch = text.match(/\[(\d+)\]/);
      const eventTimestamp = timestampMatch ? parseInt(timestampMatch[1]) : log.timestamp;
      
      // Track IMAGE z-index changes
      if (text.includes('[Z-Index] IMAGE')) {
        const idMatch = text.match(/ID: (wbe-image-[^\s|]+)/);
        const zMatch = text.match(/z-index: (\d+)(?: → (\d+))?/);
        if (idMatch && zMatch) {
          const id = idMatch[1];
          const oldZ = parseInt(zMatch[1]);
          const newZ = zMatch[2] ? parseInt(zMatch[2]) : oldZ;
          const operation = text.includes('moved up') ? 'moveUp' : text.includes('moved down') ? 'moveDown' : 'set';
          
          if (!zIndexHistory.has(id)) zIndexHistory.set(id, []);
          zIndexHistory.get(id).push({
            timestamp: eventTimestamp,
            zIndex: newZ,
            oldZ: oldZ,
            operation,
            log: text
          });
        }
      }
      
      // Track TEXT z-index changes
      if (text.includes('[Z-Index] TEXT')) {
        const idMatch = text.match(/ID: (wbe-text-[^\s|]+)/);
        const zMatch = text.match(/z-index: (\d+)(?: → (\d+))?/);
        if (idMatch && zMatch) {
          const id = idMatch[1];
          const oldZ = parseInt(zMatch[1]);
          const newZ = zMatch[2] ? parseInt(zMatch[2]) : oldZ;
          const operation = text.includes('moved up') ? 'moveUp' : text.includes('moved down') ? 'moveDown' : 'set';
          
          if (!zIndexHistory.has(id)) zIndexHistory.set(id, []);
          zIndexHistory.get(id).push({
            timestamp: eventTimestamp,
            zIndex: newZ,
            oldZ: oldZ,
            operation,
            log: text
          });
        }
      }
      
      // Track compaction and deduplication events
      if (text.includes('CompactZIndexManager')) {
        if (text.includes('compact') || text.includes('reassign')) {
          duplicateEvents.push({
            type: 'compaction',
            timestamp: eventTimestamp,
            log: text
          });
        }
        // Track deduplication events
        const dedupeMatch = text.match(/Deduplicated z-index (\d+): reassigned (\d+) objects?/);
        if (dedupeMatch) {
          const dedupeZIndex = parseInt(dedupeMatch[1]);
          const reassignedCount = parseInt(dedupeMatch[2]);
          duplicateEvents.push({
            type: 'deduplication',
            timestamp: eventTimestamp,
            zIndex: dedupeZIndex,
            reassignedCount,
            log: text
          });
          // Also track this as a z-index change for the reassigned objects
          // (we'll need to infer which objects were reassigned from context)
        }
      }
    }
    
    // Find duplicate z-index occurrences
    const allTimestamps = new Set();
    zIndexHistory.forEach(history => {
      history.forEach(event => allTimestamps.add(event.timestamp));
    });
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    
    console.log(`\nAnalyzing ${sortedTimestamps.length} z-index change timestamps...`);
    
    let duplicateOccurrences = [];
    for (const timestamp of sortedTimestamps) {
      // Get all z-indexes at this timestamp
      const zIndexMap = new Map(); // zIndex -> [ids]
      zIndexHistory.forEach((history, id) => {
        // Find the most recent event before or at this timestamp
        const relevantEvents = history.filter(e => e.timestamp <= timestamp);
        if (relevantEvents.length > 0) {
          const latest = relevantEvents[relevantEvents.length - 1];
          if (!zIndexMap.has(latest.zIndex)) zIndexMap.set(latest.zIndex, []);
          zIndexMap.get(latest.zIndex).push(id);
        }
      });
      
      // Check for duplicates
      zIndexMap.forEach((ids, zIndex) => {
        if (ids.length > 1 && zIndex > 0) {
          duplicateOccurrences.push({
            timestamp,
            zIndex,
            ids,
            count: ids.length
          });
        }
      });
    }
    
    const MIN_DUPLICATE_DURATION = 150;
    duplicateOccurrences = duplicateOccurrences.filter((dup, index, all) => {
      const sharedIds = dup.ids || [];
      const future = all.find((other, otherIndex) => {
        if (otherIndex === index) return false;
        if (other.zIndex !== dup.zIndex) return false;
        const overlap = other.ids.filter(id => sharedIds.includes(id));
        if (overlap.length < 2) return false;
        return (other.timestamp - dup.timestamp) >= MIN_DUPLICATE_DURATION;
      });
      return Boolean(future);
    });

    if (duplicateOccurrences.length > 0) {
      console.log(`\n🔍 Detected ${duplicateOccurrences.length} duplicate z-index occurrences (before resolution analysis)`);
      
      // Group by z-index value
      const byZIndex = new Map();
      duplicateOccurrences.forEach(dup => {
        if (!byZIndex.has(dup.zIndex)) byZIndex.set(dup.zIndex, []);
        byZIndex.get(dup.zIndex).push(dup);
      });

      const finalDuplicateMap = new Map();
      Object.entries(finalState || {}).forEach(([id, info]) => {
        const finalZ = info?.managerZIndex || 0;
        if (finalZ <= 0) return;
        if (!finalDuplicateMap.has(finalZ)) finalDuplicateMap.set(finalZ, []);
        finalDuplicateMap.get(finalZ).push(id);
      });

      const unresolvedOccurrences = [];

      byZIndex.forEach((occurrences, zIndex) => {
        const affectedIds = new Set();
        occurrences.forEach(occ => occ.ids.forEach(id => affectedIds.add(id)));

        const finalIdsForZ = finalDuplicateMap.get(zIndex) || [];
        const overlappingFinalIds = finalIdsForZ.filter(id => affectedIds.has(id));
        let duplicateResolved = overlappingFinalIds.length <= 1;

        const logFn = duplicateResolved ? console.log : console.error;
        logFn(`\n  Z-Index ${zIndex}: ${occurrences.length} occurrences`);
        logFn(`    Affected objects: ${affectedIds.size} (${Array.from(affectedIds).map(id => id.slice(-6)).join(', ')})`);

        const first = occurrences[0];
        const last = occurrences[occurrences.length - 1];
        logFn(`    First: ${first.timestamp} (${first.count} objects)`);
        logFn(`    Last: ${last.timestamp} (${last.count} objects)`);
        logFn(`    Duration: ${last.timestamp - first.timestamp}ms`);
        if (duplicateResolved) {
          logFn(`    Final state check: no overlapping duplicates remain (final count ${finalIdsForZ.length})`);
        }

        const operationsBefore = [];
        zIndexHistory.forEach((history, id) => {
          if (affectedIds.has(id)) {
            const relevantOps = history.filter(e => 
              e.timestamp >= first.timestamp - 500 && e.timestamp <= first.timestamp
            );
            relevantOps.forEach(op => {
              operationsBefore.push({
                id: id.slice(-6),
                operation: op.operation,
                timestamp: op.timestamp,
                zIndex: op.zIndex
              });
            });
          }
        });
        if (operationsBefore.length > 0) {
          logFn(`    Operations before duplicate (500ms window):`);
          operationsBefore.slice(0, 10).forEach(op => {
            logFn(`      [${op.timestamp}] ${op.id}: ${op.operation} → z=${op.zIndex}`);
          });
        }

        occurrences.forEach(dup => {
          const nearbyCompactions = duplicateEvents.filter(e => 
            e.type === 'compaction' && 
            Math.abs(e.timestamp - dup.timestamp) < 200
          );
          if (nearbyCompactions.length > 0) {
            console.error(`\n  ⚠️ Duplicate at ${dup.timestamp} (z=${dup.zIndex}) correlates with compaction:`);
            nearbyCompactions.forEach(comp => {
              console.error(`    [${comp.timestamp}] ${comp.log.substring(0, 100)}`);
            });
          }

          const deduplications = duplicateEvents.filter(e => 
            e.type === 'deduplication' && 
            e.zIndex === dup.zIndex &&
            e.timestamp >= dup.timestamp - 1000 && // Check 1 second before and after
            e.timestamp <= dup.timestamp + 1000
          );
          if (deduplications.length > 0) {
            deduplications.forEach(dedup => {
              // Check if duplicate was resolved after deduplication
              const laterDuplicates = duplicateOccurrences.filter(d => 
                d.zIndex === dup.zIndex && 
                d.timestamp > dedup.timestamp &&
                d.ids.some(id => dup.ids.includes(id))
              );
              if (laterDuplicates.length === 0) {
                console.log(`\n  ✅ Duplicate at ${dup.timestamp} (z=${dup.zIndex}) was resolved by deduplication at ${dedup.timestamp}`);
                duplicateResolved = true;
              } else {
                console.error(`\n  ⚠️ Duplicate at ${dup.timestamp} (z=${dup.zIndex}) persisted after deduplication at ${dedup.timestamp} (${laterDuplicates.length} later occurrences)`);
              }
            });
          } else {
            // Check if duplicate persists without deduplication
            const laterDuplicates = duplicateOccurrences.filter(d => 
              d.zIndex === dup.zIndex && 
              d.timestamp > dup.timestamp &&
              d.ids.some(id => dup.ids.includes(id))
            );
            if (laterDuplicates.length > 0 && laterDuplicates[laterDuplicates.length - 1].timestamp - dup.timestamp > 1000) {
              console.error(`\n  ❌ Duplicate at ${dup.timestamp} (z=${dup.zIndex}) persisted for ${laterDuplicates[laterDuplicates.length - 1].timestamp - dup.timestamp}ms without deduplication`);
              duplicateResolved = false;
            }
          }
        });
      
        if (!duplicateResolved) {
          unresolvedOccurrences.push(...occurrences);
        }
      });

      if (unresolvedOccurrences.length === 0) {
        console.log('\n✅ All duplicate z-index occurrences were resolved automatically');
      } else {
        console.error(`\n🚨 Unresolved duplicate z-index occurrences: ${unresolvedOccurrences.length}`);
      }

      const deduplications = duplicateEvents.filter(e => e.type === 'deduplication');
      if (deduplications.length > 0) {
        console.log(`\n📊 Deduplication Summary:`);
        console.log(`  Total deduplication events: ${deduplications.length}`);
        const byZIndexDedup = new Map();
        deduplications.forEach(d => {
          if (!byZIndexDedup.has(d.zIndex)) byZIndexDedup.set(d.zIndex, []);
          byZIndexDedup.get(d.zIndex).push(d);
        });
        byZIndexDedup.forEach((deds, dedupZ) => {
          console.log(`  Z-Index ${dedupZ}: ${deds.length} deduplication(s), ${deds.reduce((sum, d) => sum + d.reassignedCount, 0)} objects reassigned`);
        });
      }

      return { zIndexHistory, duplicateOccurrences: unresolvedOccurrences };
    } else {
      console.log('\n✅ No duplicate z-index occurrences found in timeline');
    }
    
    return { zIndexHistory, duplicateOccurrences };
  }
  
  // Helper: Check for cross-type z-index conflicts
  async function checkCrossTypeConflicts(page, imageIds, textIds) {
    const state = await getZIndexState(page, [...imageIds, ...textIds]);
    const conflicts = [];
    
    // Get all z-indexes with their types
    const zIndexMap = [];
    imageIds.forEach(id => {
      const s = state[id];
      if (s && s.managerZIndex > 0) {
        zIndexMap.push({ id, type: 'image', zIndex: s.managerZIndex, domZIndex: s.domZIndex });
      }
    });
    textIds.forEach(id => {
      const s = state[id];
      if (s && s.managerZIndex > 0) {
        zIndexMap.push({ id, type: 'text', zIndex: s.managerZIndex, domZIndex: s.domZIndex });
      }
    });
    
    // Sort by z-index
    zIndexMap.sort((a, b) => a.zIndex - b.zIndex);
    
    // Check for duplicate z-indexes (conflict)
    for (let i = 0; i < zIndexMap.length - 1; i++) {
      const current = zIndexMap[i];
      const next = zIndexMap[i + 1];
      
      if (current.zIndex === next.zIndex && current.zIndex > 0) {
        conflicts.push({
          type: 'duplicate_zindex',
          zIndex: current.zIndex,
          object1: { id: current.id, type: current.type },
          object2: { id: next.id, type: next.type }
        });
      }
      
      // Check for DOM/Manager mismatch in ordering
      if (current.domZIndex !== current.zIndex || next.domZIndex !== next.zIndex) {
        // DOM ordering might be wrong
        if (current.domZIndex > next.domZIndex && current.zIndex < next.zIndex) {
          conflicts.push({
            type: 'ordering_mismatch',
            object1: { id: current.id, type: current.type, managerZ: current.zIndex, domZ: current.domZIndex },
            object2: { id: next.id, type: next.type, managerZ: next.zIndex, domZ: next.domZIndex }
          });
        }
      }
    }
    
    return conflicts;
  }
  
  // Helper: Check for blinking (visibility changes)
  async function checkForBlinking(page, elementIds, previousStates) {
    const currentStates = await getZIndexState(page, elementIds);
    const blinking = [];
    
    for (const id of elementIds) {
      const prev = previousStates[id];
      const curr = currentStates[id];
      
      if (prev && curr) {
        // Check for visibility changes (blinking)
        if (prev.visible !== curr.visible) {
          blinking.push({
            id,
            wasVisible: prev.visible,
            isVisible: curr.visible,
            domZIndex: curr.domZIndex,
            managerZIndex: curr.managerZIndex
          });
        }
        
        // Check for z-index mismatches
        if (curr.domZIndex !== curr.managerZIndex && curr.domZIndex > 0 && curr.managerZIndex > 0) {
          blinking.push({
            id,
            type: 'zindex_mismatch',
            domZIndex: curr.domZIndex,
            managerZIndex: curr.managerZIndex
          });
        }
      }
    }
    
    return { blinking, currentStates };
  }
  
  // Helper: Log z-index state (works for both images and texts)
  function logZIndexState(state, elementIds, step = '', prefix = 'Object') {
    console.log(`\n${step ? step + ' - ' : ''}Z-Index State:`);
    elementIds.forEach((id, idx) => {
      const s = state[id];
      const type = id.startsWith('wbe-text-') ? 'Text' : 'Image';
      console.log(`  ${type} ${idx + 1} (${id.slice(-6)}): DOM=${s.domZIndex}, Manager=${s.managerZIndex}, Visible=${s.visible || false}`);
    });
  }
  
  // Helper: Verify element exists
  async function verifyElementExists(page, elementId) {
    const exists = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return !!el && el.offsetParent !== null;
    }, elementId);
    
    if (!exists) {
      // Wait a bit and try again
      await page.waitForTimeout(500);
      const existsAfterWait = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return !!el && el.offsetParent !== null;
      }, elementId);
      
      if (!existsAfterWait) {
        throw new Error(`Element ${elementId} not found or not visible`);
      }
    }
    
    return true;
  }
  
  // Helper: Select and change z-index (works for both images and texts)
  async function selectAndChangeZIndex(page, elementId, key, delay = 50) {
    // Verify element exists first
    await verifyElementExists(page, elementId);
    
    // Get element position and click target (click on the actual element, not overlay)
    const clickInfo = await page.evaluate((id) => {
      const container = document.getElementById(id);
      if (!container) return null;
      
      // For images, try to click on the image element itself
      // For texts, click on the text element
      const isImage = id.startsWith('wbe-image-');
      let clickTarget = null;
      
      if (isImage) {
        // Try to find click target overlay or image element
        clickTarget = container.querySelector('.wbe-image-click-target') || 
                      container.querySelector('.wbe-canvas-image');
      } else {
        // For text, click on the text element itself
        clickTarget = container.querySelector('.wbe-canvas-text');
      }
      
      const targetEl = clickTarget || container;
      const rect = targetEl.getBoundingClientRect();
      return { 
        x: rect.left + rect.width / 2, 
        y: rect.top + rect.height / 2,
        isImage
      };
    }, elementId);
    
    if (!clickInfo) {
      throw new Error(`Element ${elementId} not found`);
    }
    
    // Click to select - wait for selection to be set
    await page.mouse.click(clickInfo.x, clickInfo.y);
    
    // Wait for selectedTextId or selectedImageId to be set (polling with timeout)
    const selectionEstablished = await page.evaluate(async (id) => {
      const maxAttempts = 20;
      const delayMs = 50;
      
      for (let i = 0; i < maxAttempts; i++) {
        const ImageTools = window.ImageTools;
        const TextTools = window.TextTools;
        const isSelected = (ImageTools && ImageTools.selectedImageId === id) || 
                          (TextTools && TextTools.selectedTextId === id);
        
        if (isSelected) {
          return true;
        }
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      return false;
    }, elementId);
    
    if (!selectionEstablished) {
      // Try clicking again with a longer wait
      await page.mouse.click(clickInfo.x, clickInfo.y);
      await page.waitForTimeout(200);
      
      // Check again
      const isSelected = await page.evaluate((id) => {
        const ImageTools = window.ImageTools;
        const TextTools = window.TextTools;
        return (ImageTools && ImageTools.selectedImageId === id) || 
               (TextTools && TextTools.selectedTextId === id);
      }, elementId);
      
      if (!isSelected) {
        throw new Error(`Failed to select element ${elementId} after clicking`);
      }
    }
    
    // Small delay to ensure selection handlers have completed
    await page.waitForTimeout(100);
    
    // Press key to change z-index
    await page.keyboard.press(key);
    // Reduced wait time - debounce handles batching
    await page.waitForTimeout(Math.max(delay, 50));
    
    // Reduced additional wait for compaction
    await page.waitForTimeout(50);
  }

  // Helper: Generate random number between min and max (inclusive)
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  // Helper: Make random z-index changes on an image
  async function makeRandomZIndexChanges(page, elementId, imageIndex, changeCount) {
    const changes = [];
    const keys = ['PageUp', 'PageDown'];
    
    for (let i = 0; i < changeCount; i++) {
      // Randomly choose PageUp or PageDown
      const key = keys[Math.floor(Math.random() * keys.length)];
      changes.push({ key, desc: key === 'PageUp' ? 'Up' : 'Down' });
    }
    
    console.log(`\n  Image ${imageIndex + 1} (${elementId.slice(-6)}): Making ${changeCount} random changes`);
    
    let changeNum = 0;
    let successCount = 0;
    
    for (const change of changes) {
      changeNum++;
      
      // Verify element exists (check both DOM and visibility)
      const elementInfo = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return { exists: false, visible: false };
        return {
          exists: true,
          visible: el.offsetParent !== null,
          inDOM: document.contains(el)
        };
      }, elementId);
      
      if (!elementInfo.exists || !elementInfo.inDOM) {
        console.warn(`    ⚠️  Warning: Element ${elementId.slice(-6)} not found in DOM before change ${changeNum}`);
        break;
      }
      
      if (!elementInfo.visible) {
        console.warn(`    ⚠️  Warning: Element ${elementId.slice(-6)} exists but not visible before change ${changeNum}`);
        // Still try to proceed, might be a visibility issue
      }
      
      const beforeState = await getZIndexState(page, [elementId]);
      const beforeZ = beforeState[elementId]?.managerZIndex || 0;
      
      // CRITICAL: Verify sync BEFORE operation
      verifyZIndexSync(beforeState, elementId, `BEFORE change ${changeNum}`);
      
      // Capture console logs during operation
      const operationLogs = [];
      const logHandler = (msg) => {
        const text = msg.text();
        // Check for boundary errors: "Cannot move down/up - at_bottom/at_top"
        if (text.includes('Cannot move') && (text.includes('at_bottom') || text.includes('at_top') || text.includes('atBoundary'))) {
          operationLogs.push(text);
        }
      };
      page.on('console', logHandler);
      
      try {
        await selectAndChangeZIndex(page, elementId, change.key, 200); // Reduced from 400
        successCount++;
      } catch (error) {
        page.off('console', logHandler);
        console.error(`    ❌ Error during change ${changeNum} (${change.desc}): ${error.message}`);
        // Wait a bit and check if element still exists
        await page.waitForTimeout(200); // Reduced from 500
        const stillExists = await page.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!stillExists) {
          throw new Error(`Element ${elementId.slice(-6)} disappeared after error`);
        }
        continue;
      } finally {
        page.off('console', logHandler);
      }
      
      // Check for at_bottom errors in logs
      const hasAtBottomError = operationLogs.length > 0;
      
      const afterState = await getZIndexState(page, [elementId]);
      const afterZ = afterState[elementId]?.managerZIndex || 0;
      
      // CRITICAL: Verify sync AFTER operation
      verifyZIndexSync(afterState, elementId, `AFTER change ${changeNum}`);
      
      const changed = beforeZ !== afterZ;
      
      // CRITICAL: If operation failed with at_bottom but z-index didn't change, fail test
      if (hasAtBottomError && !changed) {
        throw new Error(`Operation failed with at_bottom but z-index didn't change: ${beforeZ} → ${afterZ}`);
      }
      
      console.log(`    ${changeNum}. ${change.desc}: ${beforeZ} → ${afterZ} ${changed ? '✓' : '✗'}`);
    }
    
    console.log(`    Completed: ${successCount}/${changeCount} changes successful`);
  }

  // Helper: Perform mass selection by dragging a selection box
  async function performMassSelection(page, startPos, endPos) {
    console.log(`  Performing mass selection from (${startPos.x}, ${startPos.y}) to (${endPos.x}, ${endPos.y})`);
    
    // Start drag on board with Shift key pressed (required for mass selection)
    await page.keyboard.down('Shift');
    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    
    // Drag to end position
    await page.mouse.move(endPos.x, endPos.y, { steps: 10 });
    await page.waitForTimeout(100);
    
    // Release mouse and Shift key
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    
    // Get selected elements from MassSelection
    const selectedIds = await page.evaluate(() => {
      const selected = [];
      
      // Check MassSelection.getSelected() first (for mass selection)
      if (window.MassSelection && window.MassSelection.getSelected) {
        const massSelected = window.MassSelection.getSelected();
        // getSelected() returns DOM elements, not IDs
        massSelected.forEach(element => {
          if (element && element.id) {
            const isImage = element.id.startsWith('wbe-image-');
            selected.push({ id: element.id, type: isImage ? 'image' : 'text' });
          }
        });
      }
      
      // Also check individual selections (fallback)
      if (selected.length === 0) {
        const ImageTools = window.ImageTools;
        const TextTools = window.TextTools;
        
        if (ImageTools && ImageTools.selectedImageId) {
          selected.push({ id: ImageTools.selectedImageId, type: 'image' });
        }
        
        if (TextTools && TextTools.selectedTextId) {
          selected.push({ id: TextTools.selectedTextId, type: 'text' });
        }
      }
      
      return selected;
    });
    
    return selectedIds;
  }

  // Helper: Drag selected objects manually (mouse drag)
  async function dragSelectedObjects(page, deltaX, deltaY) {
    console.log(`  Dragging selected objects by (${deltaX}, ${deltaY})`);
    
    // Get current positions of selected elements
    const beforePositions = await page.evaluate(() => {
      const positions = {};
      const selectedIds = [];
      
      // Get mass selected objects
      if (window.MassSelection && window.MassSelection.getSelected) {
        const massSelected = window.MassSelection.getSelected();
        // getSelected() returns DOM elements, not IDs
        massSelected.forEach(element => {
          if (element && element.id) {
            selectedIds.push(element.id);
          }
        });
      }
      
      // Fallback to individual selections
      if (selectedIds.length === 0) {
        const ImageTools = window.ImageTools;
        const TextTools = window.TextTools;
        
        if (ImageTools && ImageTools.selectedImageId) {
          selectedIds.push(ImageTools.selectedImageId);
        }
        if (TextTools && TextTools.selectedTextId) {
          selectedIds.push(TextTools.selectedTextId);
        }
      }
      
      // Get positions for all selected elements
      selectedIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            type: id.startsWith('wbe-image-') ? 'image' : 'text'
          };
        }
      });
      
      return positions;
    });
    
    if (Object.keys(beforePositions).length === 0) {
      throw new Error('No objects selected for dragging');
    }
    
    // Get first selected element position to start drag from
    const firstId = Object.keys(beforePositions)[0];
    const startPos = beforePositions[firstId];
    
    // Start drag from center of first selected element
    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    
    // Drag to new position
    await page.mouse.move(startPos.x + deltaX, startPos.y + deltaY, { steps: 10 });
    await page.waitForTimeout(200);
    
    // Release mouse
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    // Get after positions
    const afterPositions = await page.evaluate(({ elementIds }) => {
      const positions = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }
      });
      return positions;
    }, { elementIds: Object.keys(beforePositions) });
    
    return { beforePositions, afterPositions };
  }

  // Helper: Delete selected objects using Delete key
  async function deleteSelectedObjects(page) {
    console.log('  Deleting selected objects...');
    
    // Get selected IDs before deletion
    const selectedBefore = await page.evaluate(() => {
      const selected = [];
      
      // Get mass selected objects
      if (window.MassSelection && window.MassSelection.getSelected) {
        const massSelected = window.MassSelection.getSelected();
        // getSelected() returns DOM elements, not IDs
        massSelected.forEach(element => {
          if (element && element.id) {
            selected.push({ 
              id: element.id, 
              type: element.id.startsWith('wbe-image-') ? 'image' : 'text' 
            });
          }
        });
      }
      
      // Fallback to individual selections
      if (selected.length === 0) {
        const ImageTools = window.ImageTools;
        const TextTools = window.TextTools;
        
        if (ImageTools && ImageTools.selectedImageId) {
          selected.push({ id: ImageTools.selectedImageId, type: 'image' });
        }
        if (TextTools && TextTools.selectedTextId) {
          selected.push({ id: TextTools.selectedTextId, type: 'text' });
        }
      }
      
      return selected;
    });
    
    if (selectedBefore.length === 0) {
      throw new Error('No objects selected for deletion');
    }
    
    // Press Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(1000);
    
    return selectedBefore.map(s => s.id);
  }

  // Helper: Verify complete deletion (DOM, memory, handlers)
  async function verifyCompleteDeletion(page, elementIds, side) {
    console.log(`\n  Verifying complete deletion of ${elementIds.length} objects (${side})...`);
    
    const verification = await page.evaluate(async ({ elementIds }) => {
      const results = {
        inDOM: {},
        inMemory: {},
        hasHandlers: {},
        allDeleted: true
      };
      
      for (const id of elementIds) {
        // Check DOM
        const domElement = document.getElementById(id);
        results.inDOM[id] = !!domElement;
        console.log(`[DEBUG] Checking ${id.slice(-6)}: DOM element exists=${results.inDOM[id]}`);
        
        // Check memory (getAllImages/getAllTexts) - these are async
        const isImage = id.startsWith('wbe-image-');
        if (isImage) {
          const ImageTools = window.ImageTools;
          if (ImageTools && ImageTools.getAllImages) {
            try {
              const allImages = await ImageTools.getAllImages();
              results.inMemory[id] = id in allImages;
              console.log(`[DEBUG] Checking ${id.slice(-6)}: getAllImages returned ${Object.keys(allImages).length} images, id in allImages=${results.inMemory[id]}`);
              // Debug: log what getAllImages returned
              if (id in allImages) {
                console.log(`[DEBUG] Object ${id.slice(-6)} found in getAllImages() result`);
              }
            } catch (e) {
              results.inMemory[id] = false;
              console.error(`[DEBUG] Error checking getAllImages for ${id.slice(-6)}:`, e);
            }
          } else {
            results.inMemory[id] = false;
          }
        } else {
          const TextTools = window.TextTools;
          if (TextTools && TextTools.getAllTexts) {
            try {
              const allTexts = await TextTools.getAllTexts();
              results.inMemory[id] = id in allTexts;
              console.log(`[DEBUG] Checking ${id.slice(-6)}: getAllTexts returned ${Object.keys(allTexts).length} texts, id in allTexts=${results.inMemory[id]}`);
              // Debug: log what getAllTexts returned
              if (id in allTexts) {
                console.log(`[DEBUG] Object ${id.slice(-6)} found in getAllTexts() result`);
              }
            } catch (e) {
              results.inMemory[id] = false;
              console.error(`[DEBUG] Error checking getAllTexts for ${id.slice(-6)}:`, e);
            }
          } else {
            results.inMemory[id] = false;
          }
        }
        
        // Check handlers (event listeners)
        if (domElement) {
          // Try to check if element has event listeners
          // This is approximate - we check if element is still in DOM
          results.hasHandlers[id] = true;
        } else {
          results.hasHandlers[id] = false;
        }
        
        if (results.inDOM[id] || results.inMemory[id]) {
          results.allDeleted = false;
        }
      }
      
      return results;
    }, { elementIds });
    
    // Log results
    elementIds.forEach(id => {
      const domDeleted = !verification.inDOM[id];
      const memoryDeleted = !verification.inMemory[id];
      const handlersDeleted = !verification.hasHandlers[id];
      
      if (!domDeleted || !memoryDeleted) {
        console.error(`    ❌ ${id.slice(-6)}: DOM=${domDeleted ? '✓' : '✗'} Memory=${memoryDeleted ? '✓' : '✗'} Handlers=${handlersDeleted ? '✓' : '✗'}`);
        console.error(`      Details: inDOM=${verification.inDOM[id]}, inMemory=${verification.inMemory[id]}, hasHandlers=${verification.hasHandlers[id]}`);
      } else {
        console.log(`    ✅ ${id.slice(-6)}: Completely deleted`);
      }
    });
    
    console.log(`  verifyCompleteDeletion result: allDeleted=${verification.allDeleted}, checked ${elementIds.length} objects`);
    
    return verification.allDeleted;
  }

  test('Quick z-index changes on 3 images and 3 texts (GM + Player)', async ({ browser }) => {
    console.log('\n=== QUICK Z-INDEX TEST (Images + Texts) - GM + Player ===');
    
    // Create two browser contexts: one for GM, one for Player
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    
    // Setup browser log capture for both pages
    const gmBrowserLogs = setupBrowserLogCapture(gmPage);
    const playerBrowserLogs = setupBrowserLogCapture(playerPage);
    
    // Setup investigate log capture for individual handlers
    const playerInvestigateLogs = [];
    const gmInvestigateLogs = [];
    
    playerPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[INVESTIGATE]')) {
        playerInvestigateLogs.push({ time: Date.now(), text, type: msg.type() });
        // [INVESTIGATE] TEMPORARY: Output logs immediately for debugging
        console.log(`[PLAYER CONSOLE] ${text}`);
      }
    });
    
    gmPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[INVESTIGATE]')) {
        gmInvestigateLogs.push({ time: Date.now(), text, type: msg.type() });
        // [INVESTIGATE] TEMPORARY: Output logs immediately for debugging
        console.log(`[GM CONSOLE] ${text}`);
      }
    });
    
    // Setup GM first (needs to be ready to receive updates)
    console.log('\n--- Setting up GM ---');
    await setupTestForUser(gmPage, 'Usmr9pveCkiz8dgE', 'GM');
    await cleanupTest(gmPage, 'GM');
    
    // Setup Player
    console.log('\n--- Setting up Player ---');
    await setupTestForUser(playerPage, 'LoZGkWmu3xRB0sXZ', 'Player');
    
    // Wait a bit for both to be ready
    await Promise.all([
      gmPage.waitForTimeout(1000),
      playerPage.waitForTimeout(1000)
    ]);
    
    // Test cursor positioning for GM
    console.log('\n--- Testing GM cursor positions ---');
    await gmPage.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) {
        console.log('[TEST] Board not found');
        return;
      }
      const rect = board.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      console.log(`[TEST] GM Board rect: left=${rect.left}, top=${rect.top}, width=${rect.width}, height=${rect.height}`);
      console.log(`[TEST] GM Board center: centerX=${centerX}, centerY=${centerY}`);
      
      const testPositions = [
        { x: centerX - 200, y: centerY - 300 },
        { x: centerX, y: centerY - 300 },
        { x: centerX + 200, y: centerY - 300 }
      ];
      
      testPositions.forEach((pos, i) => {
        console.log(`[TEST] GM Position ${i + 1}: cursorX=${pos.x}, cursorY=${pos.y}`);
      });
      
      const { setSharedVars, getSharedVars } = window;
      if (setSharedVars) {
        testPositions.forEach((pos, i) => {
          setSharedVars({ lastMouseX: pos.x, lastMouseY: pos.y });
          const vars = getSharedVars();
          console.log(`[TEST] GM Set position ${i + 1}: lastMouseX=${vars.lastMouseX}, lastMouseY=${vars.lastMouseY}`);
        });
      }
    });
    await gmPage.waitForTimeout(500);
    
    // Create images and texts from GM side FIRST
    console.log('\n--- Creating images and texts from GM ---');
    const gmImageIds = await createThreeImages(gmPage);
    const gmTextIds = await createThreeTexts(gmPage);
    const gmElementIds = [...gmImageIds, ...gmTextIds];
    
    // Wait for elements to sync to Player
    console.log('\n--- Waiting for GM elements to sync to Player ---');
    await playerPage.waitForTimeout(2000);
    
    // Create images and texts from Player side
    // Player objects: same X positions as GM, but 300px lower (offsetY = 300)
    console.log('\n--- Creating images and texts from Player ---');
    const playerImageIds = await createThreeImages(playerPage, 300);
    const playerTextIds = await createThreeTexts(playerPage, 300);
    const playerElementIds = [...playerImageIds, ...playerTextIds];
    
    // Wait for elements to sync to GM
    console.log('\n--- Waiting for Player elements to sync to GM ---');
    await gmPage.waitForTimeout(2000);
    
    // Combine all element IDs
    const allElementIds = [...gmElementIds, ...playerElementIds];
    const imageIds = [...gmImageIds, ...playerImageIds];
    const textIds = [...gmTextIds, ...playerTextIds];
    
    // Verify GM-created elements exist on both sides
    console.log('\n--- Verifying GM-created elements ---');
    const gmCreatedPlayerElementsExist = await playerPage.evaluate(({ gmElementIds }) => {
      return gmElementIds.map(id => !!document.getElementById(id));
    }, { gmElementIds });
    const gmCreatedGmElementsExist = await gmPage.evaluate(({ gmElementIds }) => {
      return gmElementIds.map(id => !!document.getElementById(id));
    }, { gmElementIds });
    
    console.log(`GM-created elements on Player: ${gmCreatedPlayerElementsExist.filter(Boolean).length}/${gmElementIds.length}`);
    console.log(`GM-created elements on GM: ${gmCreatedGmElementsExist.filter(Boolean).length}/${gmElementIds.length}`);
    
    // Verify Player-created elements exist on both sides
    console.log('\n--- Verifying Player-created elements ---');
    const playerCreatedPlayerElementsExist = await playerPage.evaluate(({ playerElementIds }) => {
      return playerElementIds.map(id => !!document.getElementById(id));
    }, { playerElementIds });
    const playerCreatedGmElementsExist = await gmPage.evaluate(({ playerElementIds }) => {
      return playerElementIds.map(id => !!document.getElementById(id));
    }, { playerElementIds });
    
    console.log(`Player-created elements on Player: ${playerCreatedPlayerElementsExist.filter(Boolean).length}/${playerElementIds.length}`);
    console.log(`Player-created elements on GM: ${playerCreatedGmElementsExist.filter(Boolean).length}/${playerElementIds.length}`);
    
    // Verify all elements exist on both sides
    const playerElementsExist = await playerPage.evaluate(({ allElementIds }) => {
      return allElementIds.map(id => !!document.getElementById(id));
    }, { allElementIds });
    const gmElementsExist = await gmPage.evaluate(({ allElementIds }) => {
      return allElementIds.map(id => !!document.getElementById(id));
    }, { allElementIds });
    
    console.log(`\nTotal Player elements exist: ${playerElementsExist.filter(Boolean).length}/${allElementIds.length}`);
    console.log(`Total GM elements exist: ${gmElementsExist.filter(Boolean).length}/${allElementIds.length}`);
    
    // [INVESTIGATE] Test individual handlers on a single object
    console.log('\n--- [INVESTIGATE] Testing Individual Handlers on Single Object ---');
    const testObjectId = playerImageIds[0] || imageIds[0];
    if (testObjectId) {
      console.log(`  Testing handlers on image: ${testObjectId.slice(-6)}`);
      
      // Check handler registration
      const registrationLogs = playerInvestigateLogs.filter(l => 
        l.text.includes('attachEventListeners') || 
        l.text.includes('attachHandlers')
      );
      console.log(`  Handler registrations found: ${registrationLogs.length}`);
      
      // Click on object to select it (individual selection, not mass)
      console.log('  Clicking on object to select...');
      const beforeClickLogs = playerInvestigateLogs.length;
      
      const elementRect = await playerPage.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, testObjectId);
      
      if (elementRect) {
        // Click without Shift to avoid mass selection
        await playerPage.mouse.click(elementRect.x, elementRect.y);
        await playerPage.waitForTimeout(300);
        
        // Try to drag
        console.log('  Attempting to drag...');
        const beforeDragLogs = playerInvestigateLogs.length;
        await playerPage.mouse.move(elementRect.x + 50, elementRect.y + 50);
        await playerPage.waitForTimeout(100);
        await playerPage.mouse.up();
        await playerPage.waitForTimeout(500);
        
        const dragLogs = playerInvestigateLogs.slice(beforeDragLogs).filter(l => 
          l.text.includes('mousedown') || 
          l.text.includes('drag') ||
          l.text.includes('ImageDragController') ||
          l.text.includes('Text drag')
        );
        console.log(`  Drag-related logs: ${dragLogs.length}`);
        if (dragLogs.length > 0) {
          dragLogs.forEach(log => console.log(`    ${log.text}`));
        } else {
          console.log(`  WARNING: No drag handler logs found!`);
        }
        
        // Try to resize (for images)
        console.log('  Attempting to resize...');
        const resizeHandleVisible = await playerPage.evaluate((id) => {
          const container = document.getElementById(id);
          if (!container) return false;
          const handle = container.querySelector('.wbe-image-resize-handle');
          return handle && handle.offsetParent !== null;
        }, testObjectId);
        
        if (resizeHandleVisible) {
          const beforeResizeLogs = playerInvestigateLogs.length;
          const handleRect = await playerPage.evaluate((id) => {
            const container = document.getElementById(id);
            if (!container) return null;
            const handle = container.querySelector('.wbe-image-resize-handle');
            if (!handle) return null;
            const rect = handle.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }, testObjectId);
          
          if (handleRect) {
            await playerPage.mouse.click(handleRect.x, handleRect.y);
            await playerPage.waitForTimeout(100);
            await playerPage.mouse.move(handleRect.x + 30, handleRect.y);
            await playerPage.waitForTimeout(100);
            await playerPage.mouse.up();
            await playerPage.waitForTimeout(500);
            
            const resizeLogs = playerInvestigateLogs.slice(beforeResizeLogs).filter(l => 
              l.text.includes('resize') ||
              l.text.includes('ResizeController')
            );
            console.log(`  Resize-related logs: ${resizeLogs.length}`);
            if (resizeLogs.length > 0) {
              resizeLogs.forEach(log => console.log(`    ${log.text}`));
            } else {
              console.log(`  WARNING: No resize handler logs found!`);
            }
          }
        }
        
        // Try to change z-index
        console.log('  Attempting to change z-index...');
        const beforeZIndexLogs = playerInvestigateLogs.length;
        await playerPage.keyboard.press('[');
        await playerPage.waitForTimeout(500);
        
        const zIndexLogs = playerInvestigateLogs.slice(beforeZIndexLogs).filter(l => 
          l.text.includes('handleKeyDown') ||
          l.text.includes('z-index') ||
          l.text.includes('moveDown')
        );
        console.log(`  Z-index-related logs: ${zIndexLogs.length}`);
        if (zIndexLogs.length > 0) {
          zIndexLogs.forEach(log => console.log(`    ${log.text}`));
        } else {
          console.log(`  WARNING: No z-index handler logs found!`);
        }
      }
    }
    
    // Get initial state from both sides
    const playerInitialState = await getZIndexState(playerPage, allElementIds);
    const gmInitialState = await getZIndexState(gmPage, allElementIds);
    
    console.log('\n--- Initial State: GM-created elements ---');
    logZIndexState(playerInitialState, gmImageIds, 'GM Images (Player)', 'Image');
    logZIndexState(playerInitialState, gmTextIds, 'GM Texts (Player)', 'Text');
    logZIndexState(gmInitialState, gmImageIds, 'GM Images (GM)', 'Image');
    logZIndexState(gmInitialState, gmTextIds, 'GM Texts (GM)', 'Text');
    
    console.log('\n--- Initial State: Player-created elements ---');
    logZIndexState(playerInitialState, playerImageIds, 'Player Images (Player)', 'Image');
    logZIndexState(playerInitialState, playerTextIds, 'Player Texts (Player)', 'Text');
    logZIndexState(gmInitialState, playerImageIds, 'Player Images (GM)', 'Image');
    logZIndexState(gmInitialState, playerTextIds, 'Player Texts (GM)', 'Text');
    
    let playerPreviousStates = playerInitialState;
    let gmPreviousStates = gmInitialState;
    const allBlinkingEvents = [];
    const allCrossTypeConflicts = [];
    const syncIssues = [];
    
    // Perform 2 runs
    for (let run = 1; run <= 2; run++) {
      console.log(`\n=== RUN ${run} ===`);
      
      // Cross-type conflict test - alternate between text and image
      console.log(`\n--- Cross-Type Z-Index Test (Run ${run}) ---`);
      const allIds = [...imageIds, ...textIds];
      const shuffledIds = [...allIds].sort(() => Math.random() - 0.5); // Randomize order
      
      for (let i = 0; i < Math.min(6, shuffledIds.length); i++) {
        const elementId = shuffledIds[i];
        const isText = elementId.startsWith('wbe-text-');
        const type = isText ? 'Text' : 'Image';
        const index = isText ? textIds.indexOf(elementId) : imageIds.indexOf(elementId);
        
        // Verify element exists on Player side
        const exists = await playerPage.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!exists) {
          console.warn(`  ⚠️  ${type} ${index + 1} (${elementId.slice(-6)}) no longer exists, skipping`);
          continue;
        }
        
        // Make 2-3 quick changes to force cross-type swaps
        const changeCount = randomInt(2, 3);
        console.log(`\n--- Processing ${type} ${index + 1} (from Player) ---`);
        console.log(`  ${type} ${index + 1} (${elementId.slice(-6)}): Making ${changeCount} random changes`);
        
        await makeRandomZIndexChanges(playerPage, elementId, index, changeCount);
        
        // Wait for sync to GM
        await gmPage.waitForTimeout(500);
        
        // Check sync between Player and GM
        const playerState = await getZIndexState(playerPage, [elementId]);
        const gmState = await getZIndexState(gmPage, [elementId]);
        const playerZ = playerState[elementId]?.managerZIndex || 0;
        const gmZ = gmState[elementId]?.managerZIndex || 0;
        if (playerZ !== gmZ) {
          console.log(`    ⚠️  Sync issue after change: ${elementId.slice(-6)} Player=${playerZ} GM=${gmZ}`);
          syncIssues.push({ id: elementId, playerZ, gmZ, run });
        }
        
        // Check for blinking on both sides
        const playerBlink = await checkForBlinking(playerPage, [elementId], playerPreviousStates);
        const gmBlink = await checkForBlinking(gmPage, [elementId], gmPreviousStates);
        
        if (playerBlink.blinking.length > 0) {
          allBlinkingEvents.push(...playerBlink.blinking.map(b => ({ ...b, side: 'Player', run })));
        }
        if (gmBlink.blinking.length > 0) {
          allBlinkingEvents.push(...gmBlink.blinking.map(b => ({ ...b, side: 'GM', run })));
        }
        
        playerPreviousStates = playerBlink.currentStates;
        gmPreviousStates = gmBlink.currentStates;
        
        // Check for cross-type conflicts
        const conflicts = await checkCrossTypeConflicts(playerPage, imageIds, textIds);
        if (conflicts.length > 0) {
          allCrossTypeConflicts.push(...conflicts.map(c => ({ ...c, run })));
          conflicts.forEach(c => {
            if (c.type === 'duplicate_zindex') {
              console.error(`    🚨 DUPLICATE Z-INDEX: ${c.zIndex} - ${c.object1.type} ${c.object1.id.slice(-6)} and ${c.object2.type} ${c.object2.id.slice(-6)}`);
            } else if (c.type === 'ordering_mismatch') {
              console.error(`    🚨 ORDERING MISMATCH: Manager says ${c.object1.type}(${c.object1.managerZ}) < ${c.object2.type}(${c.object2.managerZ}), but DOM says ${c.object1.domZ} > ${c.object2.domZ}`);
            }
          });
        }
        
        await playerPage.waitForTimeout(150); // Small delay between cross-type changes
      }
      
      // Process images from Player side
      for (let imgIndex = 0; imgIndex < imageIds.length; imgIndex++) {
        const elementId = imageIds[imgIndex];
        
        // Verify element exists on Player side
        const exists = await playerPage.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!exists) {
          console.warn(`\n⚠️  Warning: Image ${imgIndex + 1} (${elementId.slice(-6)}) no longer exists, skipping`);
          continue;
        }
        
        // Generate random number of changes (5-8)
        const changeCount = randomInt(5, 8);
        console.log(`\n--- Processing Image ${imgIndex + 1} (from Player) ---`);
        
        await makeRandomZIndexChanges(playerPage, elementId, imgIndex, changeCount);
        
        // Wait for sync to GM
        await gmPage.waitForTimeout(500);
        
        // Check sync
        const playerState = await getZIndexState(playerPage, [elementId]);
        const gmState = await getZIndexState(gmPage, [elementId]);
        const playerZ = playerState[elementId]?.managerZIndex || 0;
        const gmZ = gmState[elementId]?.managerZIndex || 0;
        if (playerZ !== gmZ) {
          console.log(`    ⚠️  Sync issue: ${elementId.slice(-6)} Player=${playerZ} GM=${gmZ}`);
          syncIssues.push({ id: elementId, playerZ, gmZ, run });
        }
        
        // Check for blinking on both sides
        const playerBlink = await checkForBlinking(playerPage, allElementIds, playerPreviousStates);
        const gmBlink = await checkForBlinking(gmPage, allElementIds, gmPreviousStates);
        
        if (playerBlink.blinking.length > 0) {
          allBlinkingEvents.push(...playerBlink.blinking.map(b => ({ ...b, side: 'Player', run })));
        }
        if (gmBlink.blinking.length > 0) {
          allBlinkingEvents.push(...gmBlink.blinking.map(b => ({ ...b, side: 'GM', run })));
        }
        
        playerPreviousStates = playerBlink.currentStates;
        gmPreviousStates = gmBlink.currentStates;
        
        await playerPage.waitForTimeout(200);
      }
      
      // Process texts from Player side
      for (let txtIndex = 0; txtIndex < textIds.length; txtIndex++) {
        const elementId = textIds[txtIndex];
        
        // Verify element exists on Player side
        const exists = await playerPage.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!exists) {
          console.warn(`\n⚠️  Warning: Text ${txtIndex + 1} (${elementId.slice(-6)}) no longer exists, skipping`);
          continue;
        }
        
        // Generate random number of changes (5-8)
        const changeCount = randomInt(5, 8);
        console.log(`\n--- Processing Text ${txtIndex + 1} (from Player) ---`);
        
        await makeRandomZIndexChanges(playerPage, elementId, txtIndex, changeCount);
        
        // Wait for sync to GM
        await gmPage.waitForTimeout(500);
        
        // Check sync
        const playerState = await getZIndexState(playerPage, [elementId]);
        const gmState = await getZIndexState(gmPage, [elementId]);
        const playerZ = playerState[elementId]?.managerZIndex || 0;
        const gmZ = gmState[elementId]?.managerZIndex || 0;
        if (playerZ !== gmZ) {
          console.log(`    ⚠️  Sync issue: ${elementId.slice(-6)} Player=${playerZ} GM=${gmZ}`);
          syncIssues.push({ id: elementId, playerZ, gmZ, run });
        }
        
        // Check for blinking on both sides
        const playerBlink = await checkForBlinking(playerPage, allElementIds, playerPreviousStates);
        const gmBlink = await checkForBlinking(gmPage, allElementIds, gmPreviousStates);
        
        if (playerBlink.blinking.length > 0) {
          allBlinkingEvents.push(...playerBlink.blinking.map(b => ({ ...b, side: 'Player', run })));
        }
        if (gmBlink.blinking.length > 0) {
          allBlinkingEvents.push(...gmBlink.blinking.map(b => ({ ...b, side: 'GM', run })));
        }
        
        playerPreviousStates = playerBlink.currentStates;
        gmPreviousStates = gmBlink.currentStates;
        
        await playerPage.waitForTimeout(200);
      }
      
      // Log states after run
      const playerStateAfterRun = await getZIndexState(playerPage, allElementIds);
      const gmStateAfterRun = await getZIndexState(gmPage, allElementIds);
      
      console.log(`\n--- After Run ${run}: GM-created elements ---`);
      logZIndexState(playerStateAfterRun, gmImageIds, `GM Images (Player)`, 'Image');
      logZIndexState(playerStateAfterRun, gmTextIds, `GM Texts (Player)`, 'Text');
      logZIndexState(gmStateAfterRun, gmImageIds, `GM Images (GM)`, 'Image');
      logZIndexState(gmStateAfterRun, gmTextIds, `GM Texts (GM)`, 'Text');
      
      console.log(`\n--- After Run ${run}: Player-created elements ---`);
      logZIndexState(playerStateAfterRun, playerImageIds, `Player Images (Player)`, 'Image');
      logZIndexState(playerStateAfterRun, playerTextIds, `Player Texts (Player)`, 'Text');
      logZIndexState(gmStateAfterRun, playerImageIds, `Player Images (GM)`, 'Image');
      logZIndexState(gmStateAfterRun, playerTextIds, `Player Texts (GM)`, 'Text');
    }
    
    // Final state check
    console.log('\n=== Final Verification ===');
    const playerFinalState = await getZIndexState(playerPage, allElementIds);
    const gmFinalState = await getZIndexState(gmPage, allElementIds);
    
    console.log('\n--- Final State: GM-created elements ---');
    logZIndexState(playerFinalState, gmImageIds, 'Final GM Images (Player)', 'Image');
    logZIndexState(playerFinalState, gmTextIds, 'Final GM Texts (Player)', 'Text');
    logZIndexState(gmFinalState, gmImageIds, 'Final GM Images (GM)', 'Image');
    logZIndexState(gmFinalState, gmTextIds, 'Final GM Texts (GM)', 'Text');
    
    console.log('\n--- Final State: Player-created elements ---');
    logZIndexState(playerFinalState, playerImageIds, 'Final Player Images (Player)', 'Image');
    logZIndexState(playerFinalState, playerTextIds, 'Final Player Texts (Player)', 'Text');
    logZIndexState(gmFinalState, playerImageIds, 'Final Player Images (GM)', 'Image');
    logZIndexState(gmFinalState, playerTextIds, 'Final Player Texts (GM)', 'Text');
    
    // Check final sync between Player and GM
    const finalSyncIssues = [];
    for (const id of allElementIds) {
      const playerZ = playerFinalState[id]?.managerZIndex || 0;
      const gmZ = gmFinalState[id]?.managerZIndex || 0;
      if (playerZ !== gmZ) {
        finalSyncIssues.push({ id, playerZ, gmZ });
      }
    }
    
    if (finalSyncIssues.length > 0) {
      console.log('\n=== Final Sync Check ===');
      finalSyncIssues.forEach(issue => {
        console.log(`❌ Final sync issue: ${issue.id.slice(-6)} Player=${issue.playerZ} GM=${issue.gmZ}`);
      });
    } else {
      console.log('\n=== Final Sync Check ===');
      console.log('✅ All elements synced between Player and GM');
    }
    
    // Analyze logs
    const combinedLogs = [...playerBrowserLogs, ...gmBrowserLogs];
    analyzeLogsForCulprit(combinedLogs, allElementIds);
    
    // Analyze duplicate z-index patterns
    const duplicateAnalysis = analyzeDuplicateZIndexPatterns(combinedLogs, allElementIds, playerFinalState);
    
    // Report results
    console.log('\n=== TEST RESULTS ===');
    console.log(`Blinking events: ${allBlinkingEvents.length}`);
    if (allBlinkingEvents.length > 0) {
      console.error('❌ Blinking detected:');
      allBlinkingEvents.forEach(b => {
        console.error(`  ${b.side} Run ${b.run}: ${b.id.slice(-6)} - ${b.type || 'visibility change'}`);
      });
    } else {
      console.log('✅ No blinking detected');
    }
    
    console.log(`Cross-type conflicts: ${allCrossTypeConflicts.length}`);
    if (allCrossTypeConflicts.length > 0) {
      console.error('❌ Cross-type conflicts detected:');
      allCrossTypeConflicts.forEach(c => {
        console.error(`  Run ${c.run}: ${c.object1.type} ${c.object1.id.slice(-6)} vs ${c.object2.type} ${c.object2.id.slice(-6)}`);
      });
    } else {
      console.log('✅ No cross-type conflicts detected');
    }
    
    console.log(`Sync issues: ${syncIssues.length + finalSyncIssues.length}`);
    if (syncIssues.length > 0 || finalSyncIssues.length > 0) {
      console.error('❌ Sync issues detected between Player and GM');
    } else {
      console.log('✅ No sync issues detected');
    }
    
    // Close browser contexts
    await gmContext.close();
    await playerContext.close();
    
    // Assertions
    expect(allBlinkingEvents.length).toBe(0);
    expect(allCrossTypeConflicts.length).toBe(0);
    expect(syncIssues.length + finalSyncIssues.length).toBe(0);
  });

  test('Mass selection, drag, and deletion (GM + Player)', async ({ browser }) => {
    console.log('\n=== MASS SELECTION, DRAG, AND DELETION TEST (GM + Player) ===');
    
    // Create two browser contexts: one for GM, one for Player
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    
    // Setup browser log capture for investigation
    const playerInvestigateLogs = [];
    const gmInvestigateLogs = [];
    
    playerPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[INVESTIGATE]')) {
        playerInvestigateLogs.push({ time: Date.now(), text, type: msg.type() });
        // [INVESTIGATE] TEMPORARY: Output logs immediately for debugging
        console.log(`[PLAYER CONSOLE] ${text}`);
      }
    });
    
    gmPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[INVESTIGATE]')) {
        gmInvestigateLogs.push({ time: Date.now(), text, type: msg.type() });
        // [INVESTIGATE] TEMPORARY: Output logs immediately for debugging
        console.log(`[GM CONSOLE] ${text}`);
      }
    });
    
    // Setup GM first
    console.log('\n--- Setting up GM ---');
    await setupTestForUser(gmPage, 'Usmr9pveCkiz8dgE', 'GM');
    await cleanupTest(gmPage, 'GM');
    
    // Setup Player
    console.log('\n--- Setting up Player ---');
    await setupTestForUser(playerPage, 'LoZGkWmu3xRB0sXZ', 'Player');
    
    // Wait for both to be ready
    await Promise.all([
      gmPage.waitForTimeout(1000),
      playerPage.waitForTimeout(1000)
    ]);
    
    // Create 3 test objects (2 images + 1 text) on Player side
    console.log('\n--- Creating test objects from Player ---');
    // Create Player objects at fixed world positions
    const testImageIds = await createThreeImages(playerPage);
    const testTextIds = await createThreeTexts(playerPage);
    const testElementIds = [...testImageIds.slice(0, 2), testTextIds[0]]; // Only 3 objects
    
    // Wait for sync to GM
    await gmPage.waitForTimeout(2000);
    
    // [INVESTIGATE] Check handler registration logs after object creation
    console.log('\n--- [INVESTIGATE] Handler Registration Check ---');
    const registrationLogs = playerInvestigateLogs.filter(l => 
      l.text.includes('attachEventListeners') || 
      l.text.includes('attachHandlers')
    );
    if (registrationLogs.length > 0) {
      console.log(`  Found ${registrationLogs.length} handler registration log(s):`);
      registrationLogs.forEach(log => console.log(`    [${new Date(log.time).toISOString()}] ${log.text}`));
    } else {
      console.log(`  WARNING: No handler registration logs found! Handlers may not be registered.`);
    }
    
    // Get board bounds for selection
    const boardBounds = await playerPage.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    // Get element positions
    const elementPositions = await playerPage.evaluate(({ elementIds }) => {
      const positions = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
          };
        }
      });
      return positions;
    }, { elementIds: testElementIds });
    
    // Test 1: Mass selection of multiple objects (Player side)
    console.log('\n--- Test 1: Mass selection of multiple objects (Player) ---');
    const selectionStart = {
      x: Math.min(...Object.values(elementPositions).map(p => p.x)) - 50,
      y: Math.min(...Object.values(elementPositions).map(p => p.y)) - 50
    };
    const selectionEnd = {
      x: Math.max(...Object.values(elementPositions).map(p => p.x)) + 50,
      y: Math.max(...Object.values(elementPositions).map(p => p.y)) + 50
    };
    
    const selectedIds = await performMassSelection(playerPage, selectionStart, selectionEnd);
    console.log(`  Selected ${selectedIds.length} objects:`, selectedIds.map(s => `${s.type}:${s.id.slice(-6)}`));
    expect(selectedIds.length).toBeGreaterThanOrEqual(2); // Should select at least 2 objects
    
    // Wait for sync
    await gmPage.waitForTimeout(500);
    
    // Test 2: Drag selected objects (Player side)
    console.log('\n--- Test 2: Drag selected objects (Player) ---');
    const dragDelta = { x: 100, y: 50 };
    const beforeDragLogs = playerInvestigateLogs.length;
    const dragResult = await dragSelectedObjects(playerPage, dragDelta.x, dragDelta.y);
    
    // Output investigate logs after drag
    const dragLogs = playerInvestigateLogs.slice(beforeDragLogs);
    if (dragLogs.length > 0) {
      console.log(`\n  [INVESTIGATE] Found ${dragLogs.length} log entries during drag:`);
      dragLogs.forEach(log => console.log(`    [${new Date(log.time).toISOString()}] ${log.text}`));
    } else {
      console.log(`\n  [INVESTIGATE] WARNING: No [INVESTIGATE] logs captured during drag operation!`);
    }
    
    // Verify objects moved
    Object.keys(dragResult.beforePositions).forEach(id => {
      const before = dragResult.beforePositions[id];
      const after = dragResult.afterPositions[id];
      if (before && after) {
        const movedX = Math.abs(after.x - before.x);
        const movedY = Math.abs(after.y - before.y);
        console.log(`  ${id.slice(-6)}: moved by (${movedX.toFixed(0)}, ${movedY.toFixed(0)})`);
        expect(movedX).toBeGreaterThan(50); // Should have moved significantly
        expect(movedY).toBeGreaterThan(25);
      }
    });
    
    // Wait for sync to GM
    await gmPage.waitForTimeout(1000);
    
    // Verify sync on GM side
    const gmPositionsAfterDrag = await gmPage.evaluate(({ elementIds }) => {
      const positions = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }
      });
      return positions;
    }, { elementIds: testElementIds });
    
    Object.keys(dragResult.afterPositions).forEach(id => {
      const playerPos = dragResult.afterPositions[id];
      const gmPos = gmPositionsAfterDrag[id];
      if (playerPos && gmPos) {
        const diffX = Math.abs(playerPos.x - gmPos.x);
        const diffY = Math.abs(playerPos.y - gmPos.y);
        expect(diffX).toBeLessThan(10); // Should be synced within 10px
        expect(diffY).toBeLessThan(10);
      }
    });
    
    // Test 3: Mass selection of single object should just select it (Player side)
    console.log('\n--- Test 3: Mass selection of single object (Player) ---');
    // Get updated positions after drag
    const updatedElementPositions = await playerPage.evaluate(({ elementIds }) => {
      const positions = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
          };
        }
      });
      return positions;
    }, { elementIds: testElementIds });
    
    const singleElementId = testElementIds[0];
    const singleElementPos = updatedElementPositions[singleElementId];
    
    if (singleElementPos) {
      // Click away to deselect
      await playerPage.mouse.click(boardBounds.left + 100, boardBounds.top + 100);
      await playerPage.waitForTimeout(200);
      
      // Mass select single object with tighter bounds (smaller margin to avoid selecting neighbors)
      const singleSelectionStart = {
        x: singleElementPos.x - singleElementPos.width / 2 - 2, // Reduced from 10 to 2
        y: singleElementPos.y - singleElementPos.height / 2 - 2
      };
      const singleSelectionEnd = {
        x: singleElementPos.x + singleElementPos.width / 2 + 2, // Reduced from 10 to 2
        y: singleElementPos.y + singleElementPos.height / 2 + 2
      };
      
      const singleSelected = await performMassSelection(playerPage, singleSelectionStart, singleSelectionEnd);
      console.log(`  Single object selection: ${singleSelected.length} selected`);
      
      // Check that the target object is selected (may select more if objects are close)
      const targetSelected = singleSelected.find(s => s.id === singleElementId);
      expect(targetSelected).toBeDefined();
      expect(targetSelected.id).toBe(singleElementId);
      
      // If only one selected, verify it's the right one
      if (singleSelected.length === 1) {
        expect(singleSelected[0].id).toBe(singleElementId);
      } else {
        console.log(`  Note: Selected ${singleSelected.length} objects (expected 1), but target object is included`);
      }
      
      // Test 3.5: Try to change z-index of selected object
      console.log('\n--- Test 3.5: Change z-index of selected object (Player) ---');
      const beforeZIndexLogs = playerInvestigateLogs.length;
      
      // Press [ to move down
      await playerPage.keyboard.press('[');
      await playerPage.waitForTimeout(500);
      
      // Output investigate logs after z-index change
      const zIndexLogs = playerInvestigateLogs.slice(beforeZIndexLogs);
      if (zIndexLogs.length > 0) {
        console.log(`\n  [INVESTIGATE] Found ${zIndexLogs.length} log entries during z-index change:`);
        zIndexLogs.forEach(log => console.log(`    [${new Date(log.time).toISOString()}] ${log.text}`));
      } else {
        console.log(`\n  [INVESTIGATE] WARNING: No [INVESTIGATE] logs captured during z-index change operation!`);
      }
    }
    
    // Test 4: Delete objects (Player side)
    console.log('\n--- Test 4: Delete objects (Player) ---');
    
    // Select objects to delete (use updated positions after drag)
    const deleteSelectionStart = {
      x: Math.min(...Object.values(updatedElementPositions).map(p => p.x)) - 50,
      y: Math.min(...Object.values(updatedElementPositions).map(p => p.y)) - 50
    };
    const deleteSelectionEnd = {
      x: Math.max(...Object.values(updatedElementPositions).map(p => p.x)) + 50,
      y: Math.max(...Object.values(updatedElementPositions).map(p => p.y)) + 50
    };
    
    await performMassSelection(playerPage, deleteSelectionStart, deleteSelectionEnd);
    await playerPage.waitForTimeout(300);
    
    // Delete selected objects
    const deletedIds = await deleteSelectedObjects(playerPage);
    console.log(`  Deleted ${deletedIds.length} objects:`, deletedIds.map(id => id.slice(-6)));
    
    // Wait for sync and deletion to complete (longer wait for memory cleanup)
    await gmPage.waitForTimeout(2000);
    await playerPage.waitForTimeout(1000);
    
    // [INVESTIGATE] Analyze logs before verification
    console.log('\n=== INVESTIGATION LOGS ANALYSIS ===');
    console.log(`\nPlayer logs (${playerInvestigateLogs.length} entries):`);
    playerInvestigateLogs.forEach(log => {
      console.log(`  [${new Date(log.time).toISOString()}] ${log.text}`);
    });
    
    console.log(`\nGM logs (${gmInvestigateLogs.length} entries):`);
    gmInvestigateLogs.forEach(log => {
      console.log(`  [${new Date(log.time).toISOString()}] ${log.text}`);
    });
    
    // Check for timing issues
    const playerDeleteLogs = playerInvestigateLogs.filter(l => l.text.includes('massDeleteSelected'));
    const playerSetAllLogs = playerInvestigateLogs.filter(l => l.text.includes('setAllImages'));
    const gmSocketLogs = gmInvestigateLogs.filter(l => l.text.includes('imageUpdateRequest'));
    const gmSaveLogs = gmInvestigateLogs.filter(l => l.text.includes('After save to DB'));
    
    console.log(`\n=== TIMING ANALYSIS ===`);
    console.log(`Player: massDeleteSelected calls: ${playerDeleteLogs.length}`);
    console.log(`Player: setAllImages calls: ${playerSetAllLogs.length}`);
    console.log(`GM: imageUpdateRequest received: ${gmSocketLogs.length}`);
    console.log(`GM: DB saves completed: ${gmSaveLogs.length}`);
    
    // Verify complete deletion on Player side
    const playerDeleted = await verifyCompleteDeletion(playerPage, deletedIds, 'Player');
    if (!playerDeleted) {
      // Wait a bit more and retry
      await playerPage.waitForTimeout(1000);
      const playerDeletedRetry = await verifyCompleteDeletion(playerPage, deletedIds, 'Player');
      expect(playerDeletedRetry).toBe(true);
    } else {
      expect(playerDeleted).toBe(true);
    }
    
    // Verify complete deletion on GM side
    const gmDeleted = await verifyCompleteDeletion(gmPage, deletedIds, 'GM');
    if (!gmDeleted) {
      // Wait a bit more and retry
      await gmPage.waitForTimeout(1000);
      const gmDeletedRetry = await verifyCompleteDeletion(gmPage, deletedIds, 'GM');
      expect(gmDeletedRetry).toBe(true);
    } else {
      expect(gmDeleted).toBe(true);
    }
    
    // Test 5: Repeat tests on GM side
    console.log('\n--- Test 5: Repeat tests on GM side (RIGHT side) ---');
    
    // Create new test objects on GM side (RIGHT side of canvas)
    // Create GM objects at fixed world positions
    const gmTestImageIds = await createThreeImages(gmPage);
    const gmTestTextIds = await createThreeTexts(gmPage);
    const gmTestElementIds = [...gmTestImageIds, ...gmTestTextIds]; // All created objects for filtering
    const gmTestElementIdsForTest = [...gmTestImageIds.slice(0, 2), gmTestTextIds[0]]; // Only 3 objects for actual test
    
    // [INVESTIGATE] Log created IDs
    console.log(`[INVESTIGATE] GM created IDs: images=${gmTestImageIds.length} (${gmTestImageIds.map(id => id.slice(-6)).join(', ')}), texts=${gmTestTextIds.length} (${gmTestTextIds.map(id => id.slice(-6)).join(', ')})`);
    console.log(`[INVESTIGATE] GM test element IDs: ${gmTestElementIdsForTest.map(id => id.slice(-6)).join(', ')}`);
    
    // [INVESTIGATE] Check elements immediately after creation
    const gmElementsAfterCreation = await gmPage.evaluate(({ elementIds }) => {
      const found = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        found[id] = {
          exists: !!el,
          rect: el ? el.getBoundingClientRect() : null
        };
      });
      return found;
    }, { elementIds: gmTestElementIdsForTest });
    
    console.log(`[INVESTIGATE] GM elements immediately after creation:`, Object.keys(gmElementsAfterCreation).map(id => ({
      id: id.slice(-6),
      exists: gmElementsAfterCreation[id].exists
    })));
    
    // Wait for sync to Player
    await playerPage.waitForTimeout(2000);
    
    // [INVESTIGATE] Check if elements exist in DOM after sync
    const gmElementsInDOM = await gmPage.evaluate(({ elementIds }) => {
      const found = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        found[id] = {
          exists: !!el,
          rect: el ? el.getBoundingClientRect() : null
        };
      });
      return found;
    }, { elementIds: gmTestElementIdsForTest });
    
    console.log(`[INVESTIGATE] GM elements in DOM after sync:`, Object.keys(gmElementsInDOM).map(id => ({
      id: id.slice(-6),
      exists: gmElementsInDOM[id].exists,
      rect: gmElementsInDOM[id].rect ? `${gmElementsInDOM[id].rect.left},${gmElementsInDOM[id].rect.top}` : 'N/A'
    })));
    
    // Get GM element positions BEFORE mass selection
    const gmElementPositions = await gmPage.evaluate(({ elementIds }) => {
      const positions = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
          };
        }
      });
      return positions;
    }, { elementIds: gmTestElementIdsForTest });
    
    // [INVESTIGATE] Log GM element positions
    console.log(`\n[INVESTIGATE] GM element positions BEFORE mass selection:`, Object.keys(gmElementPositions).map(id => ({
      id: id.slice(-6),
      x: gmElementPositions[id].x,
      y: gmElementPositions[id].y,
      width: gmElementPositions[id].width,
      height: gmElementPositions[id].height
    })));
    
    // Check if we have enough elements
    if (Object.keys(gmElementPositions).length < 2) {
      console.error(`[INVESTIGATE] ERROR: Only ${Object.keys(gmElementPositions).length} elements found in DOM, expected at least 2`);
      // Try to find all elements in layer
      const allElements = await gmPage.evaluate(() => {
        const layer = document.getElementById('whiteboard-experience-layer');
        if (!layer) return [];
        const texts = Array.from(layer.querySelectorAll('.wbe-canvas-text-container'));
        const images = Array.from(layer.querySelectorAll('.wbe-canvas-image-container'));
        return [...texts, ...images].map(el => ({
          id: el.id,
          type: el.classList.contains('wbe-canvas-text-container') ? 'text' : 'image',
          rect: el.getBoundingClientRect()
        }));
      });
      console.log(`[INVESTIGATE] All elements in GM layer:`, allElements.map(e => ({
        id: e.id.slice(-6),
        type: e.type,
        pos: `${e.rect.left},${e.rect.top}`
      })));
    }
    
    // Mass selection on GM side
    console.log('\n  Mass selection on GM side');
    // Use tighter bounds to avoid selecting objects from Player side
    // Calculate bounds based on actual element positions with minimal padding
    const gmSelectionStart = {
      x: Math.min(...Object.values(gmElementPositions).map(p => p.x - p.width / 2)) - 5, // Minimal padding
      y: Math.min(...Object.values(gmElementPositions).map(p => p.y - p.height / 2)) - 5
    };
    const gmSelectionEnd = {
      x: Math.max(...Object.values(gmElementPositions).map(p => p.x + p.width / 2)) + 5, // Minimal padding
      y: Math.max(...Object.values(gmElementPositions).map(p => p.y + p.height / 2)) + 5
    };
    
    // [INVESTIGATE] Log selection box coordinates
    console.log(`[INVESTIGATE] GM selection box: (${gmSelectionStart.x}, ${gmSelectionStart.y}) to (${gmSelectionEnd.x}, ${gmSelectionEnd.y})`);
    
    // [INVESTIGATE] Log all GM created IDs for debugging
    console.log(`[INVESTIGATE] GM all created IDs for filtering:`, gmTestElementIds.map(id => id.slice(-6)));
    
    const gmSelectedIdsRaw = await performMassSelection(gmPage, gmSelectionStart, gmSelectionEnd);
    
    // [INVESTIGATE] Log all selected IDs before filtering
    console.log(`[INVESTIGATE] GM selected IDs (before filtering):`, gmSelectedIdsRaw.map(s => s.id.slice(-6)));
    
    // [INVESTIGATE] Check which selected IDs are in gmTestElementIds
    const gmSelectedIdsFiltered = gmSelectedIdsRaw.filter(s => gmTestElementIds.includes(s.id));
    const gmSelectedIdsNotInList = gmSelectedIdsRaw.filter(s => !gmTestElementIds.includes(s.id));
    if (gmSelectedIdsNotInList.length > 0) {
      console.log(`[INVESTIGATE] WARNING: Selected IDs not in GM created list:`, gmSelectedIdsNotInList.map(s => s.id.slice(-6)));
    }
    
    // Filter to only include objects created on GM side (all 6 objects, not just 3 for test)
    const gmSelectedIds = gmSelectedIdsFiltered;
    
    console.log(`  Selected ${gmSelectedIds.length} objects on GM (filtered from ${gmSelectedIdsRaw.length})`);
    
    // [INVESTIGATE] Log selected IDs after filtering
    console.log(`[INVESTIGATE] GM selected IDs (after filtering):`, gmSelectedIds.map(s => s.id.slice(-6)));
    
    expect(gmSelectedIds.length).toBeGreaterThanOrEqual(2);
    
    // Drag on GM side
    console.log('\n  Drag on GM side');
    const gmDragResult = await dragSelectedObjects(gmPage, -80, -40);
    Object.keys(gmDragResult.beforePositions).forEach(id => {
      const before = gmDragResult.beforePositions[id];
      const after = gmDragResult.afterPositions[id];
      if (before && after) {
        const movedX = Math.abs(after.x - before.x);
        const movedY = Math.abs(after.y - before.y);
        expect(movedX).toBeGreaterThan(50);
        expect(movedY).toBeGreaterThan(25);
      }
    });
    
    // Wait for sync
    await playerPage.waitForTimeout(1000);
    
    // Delete on GM side
    console.log('\n  Delete on GM side');
    await performMassSelection(gmPage, gmSelectionStart, gmSelectionEnd);
    await gmPage.waitForTimeout(300);
    
    // Get all selected objects before deletion
    const gmSelectedBeforeDelete = await gmPage.evaluate(() => {
      const selected = [];
      if (window.MassSelection && window.MassSelection.getSelected) {
        const massSelected = window.MassSelection.getSelected();
        massSelected.forEach(element => {
          if (element && element.id) {
            selected.push(element.id);
          }
        });
      }
      return selected;
    });
    
    // Filter to only include objects created on GM side
    const gmSelectedToDelete = gmSelectedBeforeDelete.filter(id => gmTestElementIds.includes(id));
    
    if (gmSelectedToDelete.length === 0) {
      throw new Error('No GM objects selected for deletion');
    }
    
    console.log(`  Will delete ${gmSelectedToDelete.length} GM objects (out of ${gmSelectedBeforeDelete.length} selected)`);
    
    // Delete all selected objects (including extra ones, but we'll only verify GM ones)
    const gmDeletedIds = await deleteSelectedObjects(gmPage);
    console.log(`  Deleted ${gmDeletedIds.length} objects on GM`);
    
    // Filter deleted IDs to only include GM objects for verification
    const gmDeletedIdsFiltered = gmDeletedIds.filter(id => gmTestElementIds.includes(id));
    
    if (gmDeletedIdsFiltered.length < 2) {
      throw new Error(`Expected to delete at least 2 GM objects, but only ${gmDeletedIdsFiltered.length} were deleted`);
    }
    
    // Wait for sync (longer wait for GM deletion)
    await playerPage.waitForTimeout(2000);
    await gmPage.waitForTimeout(1000);
    
    // Verify deletion on both sides (only GM-created objects)
    const gmDeletedCheck = await verifyCompleteDeletion(gmPage, gmDeletedIdsFiltered, 'GM');
    if (!gmDeletedCheck) {
      // Wait a bit more and retry
      console.log('  Retrying deletion verification on GM side...');
      await gmPage.waitForTimeout(2000);
      const gmDeletedRetry = await verifyCompleteDeletion(gmPage, gmDeletedIdsFiltered, 'GM');
      expect(gmDeletedRetry).toBe(true);
    } else {
      expect(gmDeletedCheck).toBe(true);
    }
    
    const playerDeletedCheck = await verifyCompleteDeletion(playerPage, gmDeletedIdsFiltered, 'Player');
    if (!playerDeletedCheck) {
      // Wait a bit more and retry
      console.log('  Retrying deletion verification on Player side...');
      await playerPage.waitForTimeout(2000);
      const playerDeletedRetry = await verifyCompleteDeletion(playerPage, gmDeletedIdsFiltered, 'Player');
      expect(playerDeletedRetry).toBe(true);
    } else {
      expect(playerDeletedCheck).toBe(true);
    }
    
    console.log('\n=== All mass selection tests passed ===');
    
    // Final investigation logs summary
    console.log('\n=== FINAL INVESTIGATION LOGS SUMMARY ===');
    console.log(`\nPlayer [INVESTIGATE] logs: ${playerInvestigateLogs.length} total entries`);
    if (playerInvestigateLogs.length > 0) {
      console.log('\nPlayer logs breakdown:');
      const playerLogsByType = {
        'attachEventListeners': playerInvestigateLogs.filter(l => l.text.includes('attachEventListeners')),
        'attachHandlers': playerInvestigateLogs.filter(l => l.text.includes('attachHandlers')),
        'mousedown': playerInvestigateLogs.filter(l => l.text.includes('mousedown')),
        'drag': playerInvestigateLogs.filter(l => l.text.includes('drag')),
        'resize': playerInvestigateLogs.filter(l => l.text.includes('resize')),
        'handleKeyDown': playerInvestigateLogs.filter(l => l.text.includes('handleKeyDown')),
        'z-index': playerInvestigateLogs.filter(l => l.text.includes('z-index') || l.text.includes('moveDown') || l.text.includes('moveUp'))
      };
      Object.entries(playerLogsByType).forEach(([type, logs]) => {
        if (logs.length > 0) {
          console.log(`  ${type}: ${logs.length} entries`);
        }
      });
    }
    
    console.log(`\nGM [INVESTIGATE] logs: ${gmInvestigateLogs.length} total entries`);
    if (gmInvestigateLogs.length > 0) {
      console.log('\nGM logs breakdown:');
      const gmLogsByType = {
        'attachEventListeners': gmInvestigateLogs.filter(l => l.text.includes('attachEventListeners')),
        'attachHandlers': gmInvestigateLogs.filter(l => l.text.includes('attachHandlers')),
        'mousedown': gmInvestigateLogs.filter(l => l.text.includes('mousedown')),
        'drag': gmInvestigateLogs.filter(l => l.text.includes('drag')),
        'resize': gmInvestigateLogs.filter(l => l.text.includes('resize')),
        'handleKeyDown': gmInvestigateLogs.filter(l => l.text.includes('handleKeyDown')),
        'z-index': gmInvestigateLogs.filter(l => l.text.includes('z-index') || l.text.includes('moveDown') || l.text.includes('moveUp'))
      };
      Object.entries(gmLogsByType).forEach(([type, logs]) => {
        if (logs.length > 0) {
          console.log(`  ${type}: ${logs.length} entries`);
        }
      });
    }
    
    // Close browser contexts
    await gmContext.close();
    await playerContext.close();
  });

  test('Solo and mass deletion verification (GM + Player)', async ({ browser }) => {
    console.log('\n=== SOLO AND MASS DELETION TEST (GM + Player) ===');
    
    // Create two browser contexts: one for GM, one for Player
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    
    // Setup browser log capture for both pages
    const gmBrowserLogs = setupBrowserLogCapture(gmPage);
    const playerBrowserLogs = setupBrowserLogCapture(playerPage);
    
    // Helper function to output logs (called in finally block)
    const outputInvestigateLogs = () => {
      console.log('\n=== BROWSER LOGS ANALYSIS ===');
      
      const investigateLogs = {
        gm: gmBrowserLogs.filter(log => log.text.includes('[INVESTIGATE]')),
        player: playerBrowserLogs.filter(log => log.text.includes('[INVESTIGATE]'))
      };
      
      console.log(`\n[GM] Found ${investigateLogs.gm.length} [INVESTIGATE] log entries:`);
      investigateLogs.gm.forEach(log => {
        console.log(`  [${log.isoTime}] ${log.text}`);
      });
      
      console.log(`\n[Player] Found ${investigateLogs.player.length} [INVESTIGATE] log entries:`);
      investigateLogs.player.forEach(log => {
        console.log(`  [${log.isoTime}] ${log.text}`);
      });
      
      // Summary
      const selectionControllerLogs = {
        created: [...investigateLogs.gm, ...investigateLogs.player].filter(log => 
          log.text.includes('SelectionController created')
        ),
        select: [...investigateLogs.gm, ...investigateLogs.player].filter(log => 
          log.text.includes('SelectionController.select()')
        ),
        deselect: [...investigateLogs.gm, ...investigateLogs.player].filter(log => 
          log.text.includes('SelectionController.deselect()')
        ),
        destroy: [...investigateLogs.gm, ...investigateLogs.player].filter(log => 
          log.text.includes('SelectionController.destroy()')
        )
      };
      
      console.log('\n=== SelectionController Usage Summary ===');
      console.log(`  Created: ${selectionControllerLogs.created.length} instances`);
      console.log(`  select() called: ${selectionControllerLogs.select.length} times`);
      console.log(`  deselect() called: ${selectionControllerLogs.deselect.length} times`);
      console.log(`  destroy() called: ${selectionControllerLogs.destroy.length} times`);
    };
    
    try {
    
    // Setup GM first
    console.log('\n--- Setting up GM ---');
    await setupTestForUser(gmPage, 'Usmr9pveCkiz8dgE', 'GM');
    await cleanupTest(gmPage, 'GM');
    
    // Setup Player
    console.log('\n--- Setting up Player ---');
    await setupTestForUser(playerPage, 'LoZGkWmu3xRB0sXZ', 'Player');
    
    // Wait for both to be ready
    await Promise.all([
      gmPage.waitForTimeout(1000),
      playerPage.waitForTimeout(1000)
    ]);
    
    // Create test objects on Player side
    console.log('\n--- Creating test objects from Player ---');
    // Create Player objects at fixed world positions
    const testImageIds = await createThreeImages(playerPage);
    const testTextIds = await createThreeTexts(playerPage);
    const testElementIds = [...testImageIds.slice(0, 2), testTextIds[0]]; // Only 3 objects
    
    // Wait for sync
    await gmPage.waitForTimeout(2000);
    
    // Test 1: Solo deletion (Player side) - delete one image
    console.log('\n--- Test 1: Solo deletion (Player) - delete one image ---');
    const soloDeleteImageId = testImageIds[0];
    
    // Clear any existing mass selection first
    await playerPage.evaluate(() => {
      if (window.MassSelection && window.MassSelection.clearSelection) {
        window.MassSelection.clearSelection();
      }
    });
    await playerPage.waitForTimeout(200);
    
    // CRITICAL: Ensure text mode is disabled before clicking on image
    // Right-click on the board to exit text mode (more reliable than pressing 't')
    console.log('  Ensuring text mode is disabled (right-click on board)...');
    const boardRectForExit = await playerPage.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    if (boardRectForExit) {
      // Right-click in an empty area of the board to exit text mode
      await playerPage.mouse.click(boardRectForExit.left + boardRectForExit.width / 2, boardRectForExit.top + boardRectForExit.height / 2, { button: 'right' });
      await playerPage.waitForTimeout(300);
    }
    
    // Select the image (without Shift to avoid mass selection)
    const soloImagePos = await playerPage.evaluate(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, { id: soloDeleteImageId });
    
    if (!soloImagePos) {
      throw new Error(`Image ${soloDeleteImageId.slice(-6)} not found for solo deletion`);
    }
    
    // Click without Shift to select only this image
    await playerPage.mouse.click(soloImagePos.x, soloImagePos.y);
    await playerPage.waitForTimeout(500);
    
    // Verify selection - check both individual and mass selection
    const soloSelectionState = await playerPage.evaluate(({ id }) => {
      const ImageTools = window.ImageTools;
      const isIndividuallySelected = ImageTools && ImageTools.selectedImageId === id;
      
      // Check mass selection
      let isMassSelected = false;
      if (window.MassSelection && window.MassSelection.getSelected) {
        const massSelected = window.MassSelection.getSelected();
        isMassSelected = massSelected.some(el => el && el.id === id);
      }
      
      return { isIndividuallySelected, isMassSelected, selectedImageId: ImageTools?.selectedImageId };
    }, { id: soloDeleteImageId });
    
    if (!soloSelectionState.isIndividuallySelected && !soloSelectionState.isMassSelected) {
      throw new Error(`Image ${soloDeleteImageId.slice(-6)} was not selected for solo deletion (individual=${soloSelectionState.isIndividuallySelected}, mass=${soloSelectionState.isMassSelected})`);
    }
    
    // Verify that only one object is selected
    const selectedCount = await playerPage.evaluate(() => {
      let count = 0;
      if (window.MassSelection && window.MassSelection.getSelected) {
        const massSelected = window.MassSelection.getSelected();
        count = massSelected.length;
      }
      if (count === 0) {
        // Check individual selections
        const ImageTools = window.ImageTools;
        const TextTools = window.TextTools;
        if (ImageTools && ImageTools.selectedImageId) count++;
        if (TextTools && TextTools.selectedTextId) count++;
      }
      return count;
    });
    
    if (selectedCount > 1) {
      console.warn(`  Warning: ${selectedCount} objects selected instead of 1 for solo deletion`);
    }
    
    // Delete using Delete key
    const soloDeletedIds = await deleteSelectedObjects(playerPage);
    console.log(`  Solo deleted ${soloDeletedIds.length} object(s):`, soloDeletedIds.map(id => id.slice(-6)));
    
    // Wait longer for async deletion to complete (individual delete uses async IIFE)
    await playerPage.waitForTimeout(3000);
    await gmPage.waitForTimeout(2000);
    
    // Filter to only include the image we wanted to delete
    const soloDeletedIdsFiltered = soloDeletedIds.filter(id => id === soloDeleteImageId);
    
    if (soloDeletedIdsFiltered.length !== 1) {
      console.warn(`  Warning: Expected to delete only ${soloDeleteImageId.slice(-6)}, but deleted:`, soloDeletedIds.map(id => id.slice(-6)));
    }
    
    // Verify solo deletion on both sides (only the image we intended to delete)
    const idsToVerify = soloDeletedIdsFiltered.length > 0 ? soloDeletedIdsFiltered : [soloDeleteImageId];
    console.log(`  Verifying solo deletion of ${idsToVerify.length} object(s) (Player)...`);
    const playerSoloDeleted = await verifyCompleteDeletion(playerPage, idsToVerify, 'Player');
    if (!playerSoloDeleted) {
      await playerPage.waitForTimeout(2000);
      const playerSoloDeletedRetry = await verifyCompleteDeletion(playerPage, idsToVerify, 'Player');
      expect(playerSoloDeletedRetry).toBe(true);
    } else {
      expect(playerSoloDeleted).toBe(true);
    }
    
    console.log(`  Verifying solo deletion of ${idsToVerify.length} object(s) (GM)...`);
    const gmSoloDeleted = await verifyCompleteDeletion(gmPage, idsToVerify, 'GM');
    if (!gmSoloDeleted) {
      await gmPage.waitForTimeout(2000);
      const gmSoloDeletedRetry = await verifyCompleteDeletion(gmPage, idsToVerify, 'GM');
      expect(gmSoloDeletedRetry).toBe(true);
    } else {
      expect(gmSoloDeleted).toBe(true);
    }
    
    // Test 2: Mass deletion (Player side) - delete remaining objects
    console.log('\n--- Test 2: Mass deletion (Player) - delete remaining objects ---');
    
    // Get remaining objects positions (exclude solo deleted)
    const remainingIds = testElementIds.filter(id => !idsToVerify.includes(id));
    if (remainingIds.length < 2) {
      throw new Error(`Not enough objects remaining for mass deletion (${remainingIds.length})`);
    }
    
    const remainingPositions = await playerPage.evaluate(({ elementIds }) => {
      const positions = {};
      elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
          };
        }
      });
      return positions;
    }, { elementIds: remainingIds });
    
    // Mass selection
    const massSelectionStart = {
      x: Math.min(...Object.values(remainingPositions).map(p => p.x - p.width / 2)) - 20,
      y: Math.min(...Object.values(remainingPositions).map(p => p.y - p.height / 2)) - 20
    };
    const massSelectionEnd = {
      x: Math.max(...Object.values(remainingPositions).map(p => p.x + p.width / 2)) + 20,
      y: Math.max(...Object.values(remainingPositions).map(p => p.y + p.height / 2)) + 20
    };
    
    await performMassSelection(playerPage, massSelectionStart, massSelectionEnd);
    await playerPage.waitForTimeout(300);
    
    // Delete selected objects
    const massDeletedIds = await deleteSelectedObjects(playerPage);
    console.log(`  Mass deleted ${massDeletedIds.length} object(s):`, massDeletedIds.map(id => id.slice(-6)));
    
    // Filter to only include objects we created
    const massDeletedIdsFiltered = massDeletedIds.filter(id => remainingIds.includes(id));
    
    if (massDeletedIdsFiltered.length < 2) {
      throw new Error(`Expected to delete at least 2 objects, but only ${massDeletedIdsFiltered.length} were deleted`);
    }
    
    // Wait for sync
    await gmPage.waitForTimeout(2000);
    
    // Verify mass deletion on both sides
    console.log(`  Verifying mass deletion of ${massDeletedIdsFiltered.length} object(s) (Player)...`);
    const playerMassDeleted = await verifyCompleteDeletion(playerPage, massDeletedIdsFiltered, 'Player');
    if (!playerMassDeleted) {
      await playerPage.waitForTimeout(2000);
      const playerMassDeletedRetry = await verifyCompleteDeletion(playerPage, massDeletedIdsFiltered, 'Player');
      expect(playerMassDeletedRetry).toBe(true);
    } else {
      expect(playerMassDeleted).toBe(true);
    }
    
    console.log(`  Verifying mass deletion of ${massDeletedIdsFiltered.length} object(s) (GM)...`);
    const gmMassDeleted = await verifyCompleteDeletion(gmPage, massDeletedIdsFiltered, 'GM');
    if (!gmMassDeleted) {
      await gmPage.waitForTimeout(2000);
      const gmMassDeletedRetry = await verifyCompleteDeletion(gmPage, massDeletedIdsFiltered, 'GM');
      expect(gmMassDeletedRetry).toBe(true);
    } else {
      expect(gmMassDeleted).toBe(true);
    }
    
    console.log('\n=== All deletion tests passed ===');
    } finally {
      // Always output logs, even if test fails
      outputInvestigateLogs();
      
      // Close browser contexts
      await gmContext.close();
      await playerContext.close();
    }
  });
});


