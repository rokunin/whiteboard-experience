import { test, expect } from '@playwright/test';

/**
 * Image Z-Index Test
 * Tests z-index navigation with PageUp and PageDown for images
 */

test.describe('Image Z-Index Test', () => {
  
  // Helper: Check if log matches our filter criteria
  function isRelevantLog(text) {
    return text.includes('[WB-E] Global paste handler') ||
           text.includes('[Image Creation]') ||
           text.includes('[Image Paste]') ||
           text.includes('[CompactZIndexManager] Synced') ||
           text.includes('[Z-Index] IMAGE') ||
           text.includes('[Swap DEBUG]') ||
           text.includes('Cannot move up - at_top') ||
           text.includes('Cannot move down - at_bottom');
  }
  
  // Helper: Setup browser log capture
  function setupBrowserLogCapture(page) {
    const browserLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      browserLogs.push({ type, text, timestamp: new Date().toISOString() });
      
      // Only output logs that match our filter criteria
      if (isRelevantLog(text)) {
        const logFunc = type === 'error' ? console.error :
                       type === 'warn' ? console.warn :
                       type === 'info' ? console.info :
                       console.log;
        logFunc(`[Browser ${type.toUpperCase()}] ${text}`);
      }
    });
    
    // Store logs on page for later access
    page['_browserLogs'] = browserLogs;
    return browserLogs;
  }
  
  // Helper: Login and setup
  async function setupTest(page) {
    await page.goto('http://localhost:30000/join');
    await page.getByRole('combobox').selectOption('LoZGkWmu3xRB0sXZ');
    await page.getByRole('button', { name: ' Join Game Session' }).click();
    await page.getByRole('button', { name: 'Close Window' }).click();
    await page.waitForSelector('#board', { state: 'visible' });
    await page.waitForTimeout(2000);
    
    // Simple cleanup: timeout-wait-clear
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
      await window.WhiteboardExperience.clearCanvasElements();
    });
    await page.waitForTimeout(1000);
  }
  
  // Helper: Create a simple test image data URI (1x1 red pixel)
  function createTestImageDataURI() {
    // Create a simple 100x100 red square image as data URI
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 100, 100);
    return canvas.toDataURL('image/png');
  }
  
  // Helper: Create two image objects
  async function createTestObjects(page, objects = ['ObjA', 'ObjB']) {
    console.log('Creating test images...');
    
    // Get board position to calculate visible screen coordinates
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) {
      throw new Error('Board not found');
    }
    
    // Calculate visible screen positions (center of board with offset)
    const screenX1 = boardRect.left + boardRect.width / 2 - 60;
    const screenY = boardRect.top + boardRect.height / 2;
    const screenX2 = boardRect.left + boardRect.width / 2 + 60;
    
    // Create images directly via browser, converting screen to world coordinates
    const elementIds = await page.evaluate(async ({ screenX1, screenY, screenX2 }) => {
      // Access ImageTools from the global scope (it should be available after module loads)
      let ImageTools = window.ImageTools;
      if (!ImageTools) {
        // If not on window, try to import (may not work in test context)
        try {
          const module = await import('/modules/whiteboard-experience/scripts/modules/whiteboard-image.mjs');
          ImageTools = module.ImageTools;
        } catch (e) {
          console.warn('Could not import ImageTools module:', e);
        }
      }
      
      if (!ImageTools) {
        throw new Error('ImageTools not available - module may not be loaded');
      }
      
      // Access screenToWorld function (now exposed on window)
      const screenToWorld = window.screenToWorld;
      
      // Create a simple test image data URI (100x100 red square)
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 100, 100);
      const dataURI = canvas.toDataURL('image/png');
      
      const ids = [];
      const defaultCrop = { top: 0, right: 0, bottom: 0, left: 0 };
      const screenPositions = [{ x: screenX1, y: screenY }, { x: screenX2, y: screenY }];
      const imageDataMap = {};
      
      // First, create both containers
      for (let i = 0; i < 2; i++) {
        const id = `wbe-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        // Convert screen coordinates to world coordinates
        let worldPos;
        if (screenToWorld && typeof screenToWorld === 'function') {
          worldPos = screenToWorld(screenPositions[i].x, screenPositions[i].y);
        } else if (window.canvas?.ready && window.canvas?.stage) {
          // Manual conversion using canvas transform
          try {
            const transform = window.canvas.stage.worldTransform;
            const inverted = transform.clone().invert();
            const point = inverted.apply({ x: screenPositions[i].x, y: screenPositions[i].y });
            worldPos = { x: point.x, y: point.y };
          } catch (e) {
            // Fallback: use screen coordinates if conversion fails
            worldPos = { x: screenPositions[i].x, y: screenPositions[i].y };
          }
        } else {
          // Fallback: use screen coordinates directly
          worldPos = { x: screenPositions[i].x, y: screenPositions[i].y };
        }
        
        // Create image element at world coordinates
        const container = ImageTools.createImageElement(
          id,
          dataURI,
          worldPos.x,
          worldPos.y,
          1,
          defaultCrop,
          'rect',
          { x: 0, y: 0 },
          null,
          null, // existingZIndex - let it assign
          false // isFrozen
        );
        
        if (container) {
          const imageElement = container.querySelector('.wbe-canvas-image');
          if (imageElement) {
            imageDataMap[id] = {
              src: imageElement.src || dataURI,
              left: worldPos.x,
              top: worldPos.y,
              scale: 1,
              crop: defaultCrop,
              maskType: 'rect',
              circleOffset: { x: 0, y: 0 },
              circleRadius: null,
              isFrozen: false,
              zIndex: window.ZIndexManager?.get(id) || null
            };
          }
        }
        
        ids.push(id);
        await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between creates
      }
      
      // Then, save both images together to avoid race conditions
      if (Object.keys(imageDataMap).length > 0) {
        const existingImages = await ImageTools.getAllImages();
        const allImages = { ...existingImages, ...imageDataMap };
        await ImageTools.setAllImages(allImages);
      }
      
      return ids;
    }, { screenX1, screenY, screenX2 });
    
    expect(elementIds.length).toBe(2);
    const [objAId, objBId] = elementIds;
    
    // Wait for images to be fully created and persisted
    await page.waitForTimeout(1500);
    
    // Verify containers exist in DOM and have z-index set
    const containersReady = await page.evaluate(({ objAId, objBId }) => {
      const objA = document.getElementById(objAId);
      const objB = document.getElementById(objBId);
      const objAZIndex = objA ? parseInt(objA.style.zIndex) || 0 : -1;
      const objBZIndex = objB ? parseInt(objB.style.zIndex) || 0 : -1;
      return {
        objAExists: !!objA,
        objBExists: !!objB,
        objAZIndex,
        objBZIndex,
        ready: objA && objB && objAZIndex > 0 && objBZIndex > 0
      };
    }, { objAId, objBId });
    
    if (!containersReady.ready) {
      console.warn('Containers not ready:', containersReady);
      // Wait a bit more
      await page.waitForTimeout(1000);
    }
    
    console.log(`ObjA ID: ${objAId}`);
    console.log(`ObjB ID: ${objBId}`);
    
    // Log initial z-index state
    const initialZIndex = await page.evaluate(({ objAId, objBId }) => {
      const objA = document.getElementById(objAId);
      const objB = document.getElementById(objBId);
      return {
        objAZIndex: parseInt(objA?.style.zIndex) || 0,
        objBZIndex: parseInt(objB?.style.zIndex) || 0,
        objAZIndexManager: window.ZIndexManager?.get(objAId) || 0,
        objBZIndexManager: window.ZIndexManager?.get(objBId) || 0
      };
    }, { objAId, objBId });
    
    console.log('Initial z-index state:');
    console.log(`  ObjA: DOM=${initialZIndex.objAZIndex}, ZIndexManager=${initialZIndex.objAZIndexManager}`);
    console.log(`  ObjB: DOM=${initialZIndex.objBZIndex}, ZIndexManager=${initialZIndex.objBZIndexManager}`);
    
    return { objAId, objBId, initialZIndex };
  }
  
  // Helper: Get browser logs
  function getBrowserLogs(page) {
    return page['_browserLogs'] || [];
  }
  
  // Helper: Select element and press keyboard key
  async function selectAndPressKey(page, elementId, otherId, key, delay = 200) {
    // Get the element's position and click on it via board coordinates
    const elementPos = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, elementId);
    
    if (!elementPos) {
      throw new Error(`Element ${elementId} not found`);
    }
    
    // Click at the element's screen position
    await page.mouse.click(elementPos.x, elementPos.y);
    await page.waitForTimeout(300); // Wait for selection to complete
    
    // Verify selection (images use selectedImageId)
    const isSelected = await page.evaluate((id) => {
      // Check if image is selected via ImageTools.selectedImageId getter
      const ImageTools = window.ImageTools;
      return ImageTools && ImageTools.selectedImageId === id;
    }, elementId);
    
    if (!isSelected) {
      // Try one more time with a longer wait
      await page.waitForTimeout(500);
      const isSelectedAfterWait = await page.evaluate((id) => {
        const ImageTools = window.ImageTools;
        return ImageTools && ImageTools.selectedImageId === id;
      }, elementId);
      if (!isSelectedAfterWait) {
        throw new Error(`Element ${elementId} is not selected - cannot test ${key}`);
      }
    }
    
    const before = await page.evaluate(({ id, otherId }) => {
      const obj = document.getElementById(id);
      const other = document.getElementById(otherId);
      return {
        objZIndex: parseInt(obj?.style.zIndex) || 0,
        otherZIndex: parseInt(other?.style.zIndex) || 0,
        objZIndexManager: window.ZIndexManager?.get(id) || 0,
        otherZIndexManager: window.ZIndexManager?.get(otherId) || 0
      };
    }, { id: elementId, otherId });
    
    console.log(`Before ${key}:`);
    console.log(`  Selected (${elementId}): DOM=${before.objZIndex}, ZIndexManager=${before.objZIndexManager}`);
    console.log(`  Other (${otherId}): DOM=${before.otherZIndex}, ZIndexManager=${before.otherZIndexManager}`);
    
    await page.keyboard.press(key);
    // Wait longer to allow compaction and DOM sync to complete
    await page.waitForTimeout(Math.max(delay, 1500));
    
    // Additional wait to ensure compaction has finished
    await page.waitForTimeout(500);
    
    const after = await page.evaluate(({ id, otherId }) => {
      const obj = document.getElementById(id);
      const other = document.getElementById(otherId);
      const objZIndexDOM = parseInt(obj?.style.zIndex) || 0;
      const otherZIndexDOM = parseInt(other?.style.zIndex) || 0;
      const objZIndexManager = window.ZIndexManager?.get(id) || 0;
      const otherZIndexManager = window.ZIndexManager?.get(otherId) || 0;
      
      // Also check if compaction ran by checking if all z-indexes are normalized
      const allImages = Array.from(document.querySelectorAll('[id^="wbe-image-"]'))
        .filter(el => el.offsetParent !== null)
        .map(el => ({
          id: el.id,
          zIndex: parseInt(el.style.zIndex) || 0,
          zIndexManager: window.ZIndexManager?.get(el.id) || 0
        }));
      
      // Check for compaction patterns (all at 1000, 1050, 1100, etc - stepSize intervals)
      const stepSize = 50;
      const normalizedZIndexes = allImages.map(i => i.zIndex).sort((a, b) => a - b);
      const isCompacted = normalizedZIndexes.every((z, i) => 
        z === 1000 + (i * stepSize) || // Perfect compaction
        (i === 0 && z === 1000) // At least first is 1000
      );
      
      return {
        objZIndex: objZIndexDOM,
        otherZIndex: otherZIndexDOM,
        objZIndexManager,
        otherZIndexManager,
        allImages,
        isCompacted,
        normalizedZIndexes
      };
    }, { id: elementId, otherId });
    
    console.log(`After ${key}:`);
    console.log(`  Selected (${elementId}): DOM=${after.objZIndex}, ZIndexManager=${after.objZIndexManager}`);
    console.log(`  Other (${otherId}): DOM=${after.otherZIndex}, ZIndexManager=${after.otherZIndexManager}`);
    console.log(`  All z-indexes: ${after.normalizedZIndexes.join(', ')}`);
    console.log(`  Compaction detected: ${after.isCompacted}`);
    
    // Check change based on ZIndexManager (more reliable than DOM after compaction)
    const changed = after.objZIndexManager !== before.objZIndexManager || 
                   after.otherZIndexManager !== before.otherZIndexManager ||
                   // Also check if DOM changed (might be different after compaction)
                   (after.objZIndex !== before.objZIndex && !after.isCompacted) ||
                   (after.otherZIndex !== before.otherZIndex && !after.isCompacted);
    
    console.log(`  Changed: ${changed} (Manager: ${after.objZIndexManager !== before.objZIndexManager || after.otherZIndexManager !== before.otherZIndexManager})`);
    
    return { before, after, changed };
  }
  
  // Helper: Report browser logs
  function reportBrowserLogs(page) {
    const browserLogs = getBrowserLogs(page);
    const relevantLogs = browserLogs.filter(log => isRelevantLog(log.text));
    
    if (relevantLogs.length > 0) {
      console.log('\n=== BROWSER CONSOLE LOGS (Relevant) ===');
      relevantLogs.forEach(log => {
        console.log(`[${log.type.toUpperCase()}] ${log.text}`);
      });
    }
    
    console.log(`\nTotal browser logs captured: ${browserLogs.length}`);
    console.log(`Relevant logs: ${relevantLogs.length}`);
    
    return relevantLogs;
  }

  test.beforeEach(async ({ page }) => {
    setupBrowserLogCapture(page);
  });

  test('Test 1: Move Up ImgA, then Move Up ImgB', async ({ page }) => {
    console.log('=== TEST 1: Move Up ImgA, then Move Up ImgB ===');
    
    // a. prepare login, clean, create objects
    await setupTest(page);
    const { objAId, objBId, initialZIndex } = await createTestObjects(page);
    
    // b. move Up ImgA, delay 200ms
    console.log('\n--- Step b: Move Up ImgA ---');
    const stepB = await selectAndPressKey(page, objAId, objBId, 'PageUp', 200);
    
    // c. move Up ImgB
    console.log('\n--- Step c: Move Up ImgB ---');
    const stepC = await selectAndPressKey(page, objBId, objAId, 'PageUp', 200);
    
    // Report browser logs
    const relevantLogs = reportBrowserLogs(page);
    
    // Summary
    console.log('\n=== TEST 1 SUMMARY ===');
    console.log(`Initial: ImgA=${initialZIndex.objAZIndex}, ImgB=${initialZIndex.objBZIndex}`);
    console.log(`After Step b (ImgA PageUp): ImgA=${stepB.after.objZIndex}, ImgB=${stepB.after.otherZIndex}`);
    console.log(`After Step c (ImgB PageUp): ImgA=${stepC.after.otherZIndex}, ImgB=${stepC.after.objZIndex}`);
    
    const issues = [];
    if (!stepB.changed) {
      issues.push('Step b: ImgA PageUp did not change z-index');
    }
    if (!stepC.changed) {
      issues.push('Step c: ImgB PageUp did not change z-index');
    }
    
    if (issues.length > 0) {
      const errorMessage = `Test 1 failed:\n${issues.join('\n')}\n\nBrowser Console Logs:\n${relevantLogs.map(log => `[${log.type}] ${log.text}`).join('\n')}`;
      throw new Error(errorMessage);
    } else {
      console.log('\nTest 1 passed - all steps completed successfully');
    }
  });

  test('Test 2: Move Down ImgB, then Move Up ImgB, then Move Down ImgB', async ({ page }) => {
    console.log('=== TEST 2: Move Down ImgB, then Move Up ImgB, then Move Down ImgB ===');
    
    // a. prepare login, clean, create objects
    await setupTest(page);
    const { objAId, objBId, initialZIndex } = await createTestObjects(page);
    
    // b. move Down ImgB, delay 200ms
    console.log('\n--- Step b: Move Down ImgB ---');
    const stepB = await selectAndPressKey(page, objBId, objAId, 'PageDown', 200);
    
    // c. move Up ImgB
    console.log('\n--- Step c: Move Up ImgB ---');
    const stepC = await selectAndPressKey(page, objBId, objAId, 'PageUp', 200);
    
    // d. move Down ImgB
    console.log('\n--- Step d: Move Down ImgB ---');
    const stepD = await selectAndPressKey(page, objBId, objAId, 'PageDown', 200);
    
    // Report browser logs
    const relevantLogs = reportBrowserLogs(page);
    
    // Summary
    console.log('\n=== TEST 2 SUMMARY ===');
    console.log(`Initial: ImgA=${initialZIndex.objAZIndex}, ImgB=${initialZIndex.objBZIndex}`);
    console.log(`After Step b (ImgB PageDown): ImgA=${stepB.after.otherZIndex}, ImgB=${stepB.after.objZIndex}`);
    console.log(`After Step c (ImgB PageUp): ImgA=${stepC.after.otherZIndex}, ImgB=${stepC.after.objZIndex}`);
    console.log(`After Step d (ImgB PageDown): ImgA=${stepD.after.otherZIndex}, ImgB=${stepD.after.objZIndex}`);
    
    const issues = [];
    if (!stepB.changed) {
      issues.push('Step b: ImgB PageDown did not change z-index');
    }
    if (!stepC.changed) {
      issues.push('Step c: ImgB PageUp did not change z-index');
    }
    if (!stepD.changed) {
      issues.push('Step d: ImgB PageDown did not change z-index');
    }
    
    if (issues.length > 0) {
      const errorMessage = `Test 2 failed:\n${issues.join('\n')}\n\nBrowser Console Logs:\n${relevantLogs.map(log => `[${log.type}] ${log.text}`).join('\n')}`;
      throw new Error(errorMessage);
    } else {
      console.log('\nTest 2 passed - all steps completed successfully');
    }
  });
});

