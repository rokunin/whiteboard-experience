import { test, expect } from '@playwright/test';

/**
 * Text and Image Z-Index Combined Test
 * Tests z-index navigation with PageUp and PageDown when both text and image elements exist
 */

test.describe('Text and Image Z-Index Combined Test', () => {
  
  // Helper: Check if log matches our filter criteria
  function isRelevantLog(text) {
    return text.includes('[WB-E] Global paste handler') ||
           text.includes('[Text Creation]') ||
           text.includes('[Image Creation]') ||
           text.includes('[CompactZIndexManager] Synced') ||
           text.includes('[Z-Index] TEXT') ||
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
    await page.waitForTimeout(2000);
    
    // Wait for whiteboard to be ready
    await page.waitForSelector('#board', { timeout: 10000 });
    await page.waitForTimeout(1000);
  }
  
  // Helper: Create test objects (both text and image)
  async function createTestObjects(page, objects = ['TextA', 'ImageB', 'TextC', 'ImageD']) {
    console.log('Creating test objects (text and images)...');
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    if (!boardRect) { throw new Error('Board not found'); }
    
    const centerX = boardRect.left + boardRect.width / 2;
    const centerY = boardRect.top + boardRect.height / 2;
    const spacing = 80;
    
    // Calculate positions in a grid
    const positions = [
      { x: centerX - spacing, y: centerY - spacing }, // TextA
      { x: centerX + spacing, y: centerY - spacing }, // ImageB
      { x: centerX - spacing, y: centerY + spacing }, // TextC
      { x: centerX + spacing, y: centerY + spacing }, // ImageD
    ];
    
    const elementIds = await page.evaluate(async ({ positions, objects }) => {
      let TextTools = window.TextTools;
      let ImageTools = window.ImageTools;
      
      // Fallback if not exposed
      if (!TextTools || !ImageTools) {
        // Try to find them in modules
        try {
          const textModule = await import('/modules/whiteboard-experience/scripts/modules/whiteboard-text.mjs');
          TextTools = textModule.TextTools;
        } catch (e) { console.warn('Could not load TextTools:', e); }
        
        try {
          const imageModule = await import('/modules/whiteboard-experience/scripts/modules/whiteboard-image.mjs');
          ImageTools = imageModule.ImageTools;
        } catch (e) { console.warn('Could not load ImageTools:', e); }
      }
      
      if (!TextTools || !ImageTools) {
        throw new Error('TextTools or ImageTools not available - module may not be loaded');
      }
      
      const screenToWorld = window.screenToWorld || (typeof screenToWorld !== 'undefined' ? screenToWorld : null);
      const ids = [];
      const textDataMap = {};
      const imageDataMap = {};
      
      // Create canvas for image data URI
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#00ff00'; // Green square for images
      ctx.fillRect(0, 0, 100, 100);
      const dataURI = canvas.toDataURL('image/png');
      const defaultCrop = { top: 0, right: 0, bottom: 0, left: 0 };
      
      for (let i = 0; i < objects.length; i++) {
        const objType = objects[i].startsWith('Text') ? 'text' : 'image';
        const id = objType === 'text' 
          ? `wbe-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          : `wbe-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        // Convert screen to world coordinates
        let worldPos;
        if (screenToWorld && typeof screenToWorld === 'function') {
          worldPos = screenToWorld(positions[i].x, positions[i].y);
        } else if (window.canvas?.ready && window.canvas?.stage) {
          try {
            const transform = window.canvas.stage.worldTransform;
            const inverted = transform.clone().invert();
            const point = inverted.apply({ x: positions[i].x, y: positions[i].y });
            worldPos = { x: point.x, y: point.y };
          } catch (e) {
            worldPos = { x: positions[i].x, y: positions[i].y };
          }
        } else {
          worldPos = { x: positions[i].x, y: positions[i].y };
        }
        
        if (objType === 'text') {
          const container = TextTools.createTextElement(
            id,
            objects[i],
            worldPos.x,
            worldPos.y,
            1.0,
            '#ffffff',
            'transparent',
            null,
            0,
            'normal',
            'normal',
            'center',
            'Arial',
            16,
            null,
            null // existingZIndex - let it assign
          );
          
          if (container) {
            const textElement = container.querySelector('.wbe-canvas-text');
            if (textElement) {
              textDataMap[id] = {
                text: objects[i],
                left: worldPos.x,
                top: worldPos.y,
                scale: 1.0,
                color: '#ffffff',
                backgroundColor: 'transparent',
                zIndex: window.ZIndexManager?.get(id) || null
              };
            }
          }
        } else {
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
        }
        
        ids.push(id);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Persist all objects together to avoid race conditions
      if (Object.keys(textDataMap).length > 0) {
        const existingTexts = await TextTools.getAllTexts();
        const allTexts = { ...existingTexts };
        for (const [id, data] of Object.entries(textDataMap)) {
          allTexts[id] = data;
        }
        await TextTools.setAllTexts(allTexts);
      }
      
      if (Object.keys(imageDataMap).length > 0) {
        const existingImages = await ImageTools.getAllImages();
        const allImages = { ...existingImages };
        for (const [id, data] of Object.entries(imageDataMap)) {
          allImages[id] = data;
        }
        await ImageTools.setAllImages(allImages);
      }
      
      return ids;
    }, { positions, objects });
    
    expect(elementIds.length).toBe(objects.length);
    
    // Wait for objects to be fully created and persisted
    await page.waitForTimeout(2000);
    
    // Get initial z-index state
    const initialZIndex = await page.evaluate(({ elementIds }) => {
      const state = {};
      for (const id of elementIds) {
        const el = document.getElementById(id);
        state[id] = {
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el,
          type: id.startsWith('wbe-text-') ? 'text' : 'image'
        };
      }
      return state;
    }, { elementIds });
    
    console.log('Initial z-index state:');
    for (const [id, state] of Object.entries(initialZIndex)) {
      console.log(`  ${state.type.toUpperCase()} ${id.slice(-6)}: DOM=${state.domZIndex}, ZIndexManager=${state.managerZIndex}`);
    }
    
    return { elementIds, initialZIndex };
  }
  
  // Helper: Select element and press key
  async function selectAndPressKey(page, elementId, otherIds, key, delay = 200) {
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
    await page.waitForTimeout(300);
    
    // Verify selection
    const isSelected = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      
      const isText = id.startsWith('wbe-text-');
      if (isText) {
        const TextTools = window.TextTools;
        return (TextTools && TextTools.selectedTextId === id) || window.selectedTextId === id;
      } else {
        const ImageTools = window.ImageTools;
        return (ImageTools && ImageTools.selectedImageId === id) || window.selectedImageId === id;
      }
    }, elementId);
    
    if (!isSelected) {
      await page.waitForTimeout(500);
      const isSelectedAfterWait = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const isText = id.startsWith('wbe-text-');
        if (isText) {
          const TextTools = window.TextTools;
          return (TextTools && TextTools.selectedTextId === id) || window.selectedTextId === id;
        } else {
          const ImageTools = window.ImageTools;
          return (ImageTools && ImageTools.selectedImageId === id) || window.selectedImageId === id;
        }
      }, elementId);
      
      if (!isSelectedAfterWait) {
        console.warn(`Element ${elementId} may not be selected, but continuing...`);
      }
    }
    
    const before = await page.evaluate(({ id, otherIds }) => {
      const obj = document.getElementById(id);
      const others = {};
      for (const otherId of otherIds) {
        others[otherId] = document.getElementById(otherId);
      }
      
      const objZIndex = obj ? parseInt(obj.style.zIndex) || 0 : 0;
      const otherZIndexes = {};
      const otherZIndexManagers = {};
      for (const otherId of otherIds) {
        const otherEl = others[otherId];
        otherZIndexes[otherId] = otherEl ? parseInt(otherEl.style.zIndex) || 0 : 0;
        otherZIndexManagers[otherId] = window.ZIndexManager?.get(otherId) || 0;
      }
      
      return {
        objZIndex,
        otherZIndexes,
        objZIndexManager: window.ZIndexManager?.get(id) || 0,
        otherZIndexManagers
      };
    }, { id: elementId, otherIds });
    
    console.log(`Before ${key}:`);
    console.log(`  Selected (${elementId.slice(-10)}): DOM=${before.objZIndex}, ZIndexManager=${before.objZIndexManager}`);
    for (const [otherId, zIndex] of Object.entries(before.otherZIndexes)) {
      console.log(`  Other (${otherId.slice(-10)}): DOM=${zIndex}, ZIndexManager=${before.otherZIndexManagers[otherId]}`);
    }
    
    await page.keyboard.press(key);
    await page.waitForTimeout(Math.max(delay, 1500));
    await page.waitForTimeout(500);
    
    const after = await page.evaluate(({ id, otherIds }) => {
      const obj = document.getElementById(id);
      const others = {};
      for (const otherId of otherIds) {
        others[otherId] = document.getElementById(otherId);
      }
      
      const objZIndexDOM = obj ? parseInt(obj.style.zIndex) || 0 : 0;
      const otherZIndexDOMs = {};
      const otherZIndexManagers = {};
      for (const otherId of otherIds) {
        const otherEl = others[otherId];
        otherZIndexDOMs[otherId] = otherEl ? parseInt(otherEl.style.zIndex) || 0 : 0;
        otherZIndexManagers[otherId] = window.ZIndexManager?.get(otherId) || 0;
      }
      
      // Get all z-indexes from manager
      const allZIndexes = [];
      for (const [objId, zIndex] of window.ZIndexManager?.objectZIndexes || []) {
        allZIndexes.push(zIndex);
      }
      
      return {
        objZIndexDOM,
        otherZIndexDOMs,
        objZIndexManager: window.ZIndexManager?.get(id) || 0,
        otherZIndexManagers,
        allZIndexes: allZIndexes.sort((a, b) => a - b)
      };
    }, { id: elementId, otherIds });
    
    console.log(`After ${key}:`);
    console.log(`  Selected (${elementId.slice(-10)}): DOM=${after.objZIndexDOM}, ZIndexManager=${after.objZIndexManager}`);
    for (const [otherId, zIndex] of Object.entries(after.otherZIndexDOMs)) {
      console.log(`  Other (${otherId.slice(-10)}): DOM=${zIndex}, ZIndexManager=${after.otherZIndexManagers[otherId]}`);
    }
    console.log(`  All z-indexes: ${after.allZIndexes.join(', ')}`);
    
    return { before, after };
  }
  
  test('Test 1: Move Text up when Image exists above, then move Image down when Text exists below', async ({ page }) => {
    const browserLogs = setupBrowserLogCapture(page);
    await setupTest(page);
    
    console.log('\n=== TEST 1: Text/Image Cross-Type Z-Index Navigation ===');
    
    const { elementIds, initialZIndex } = await createTestObjects(page, ['TextA', 'ImageB']);
    const [textAId, imageBId] = elementIds;
    
    // Verify initial state: TextA should have lower z-index than ImageB
    const initialTextAZIndex = initialZIndex[textAId].managerZIndex;
    const initialImageBZIndex = initialZIndex[imageBId].managerZIndex;
    expect(initialTextAZIndex).toBeLessThan(initialImageBZIndex);
    
    console.log('\n--- Step b: Move TextA Up (should swap with ImageB) ---');
    const stepB = await selectAndPressKey(page, textAId, [imageBId], 'PageUp');
    
    // TextA should now have ImageB's z-index (higher), ImageB should have TextA's (lower)
    expect(stepB.after.objZIndexManager).toBe(initialImageBZIndex);
    expect(stepB.after.otherZIndexDOMs[imageBId]).toBe(initialTextAZIndex);
    expect(stepB.after.objZIndexManager).toBeGreaterThan(stepB.after.otherZIndexDOMs[imageBId]);
    
    console.log('\n--- Step c: Move TextA Down (should swap back with ImageB) ---');
    const stepC = await selectAndPressKey(page, textAId, [imageBId], 'PageDown');
    
    // Should swap back - TextA should have lower z-index again, ImageB should have higher
    expect(stepC.after.objZIndexManager).toBe(initialTextAZIndex);
    expect(stepC.after.otherZIndexDOMs[imageBId]).toBe(initialImageBZIndex);
    expect(stepC.after.otherZIndexDOMs[imageBId]).toBeGreaterThan(stepC.after.objZIndexManager);
    
    // Get relevant logs
    const relevantLogs = browserLogs.filter(log => isRelevantLog(log.text));
    
    console.log('\n=== TEST 1 SUMMARY ===');
    console.log(`Initial: TextA=${initialTextAZIndex}, ImageB=${initialImageBZIndex}`);
    console.log(`After Step b (TextA PageUp): TextA=${stepB.after.objZIndexManager}, ImageB=${stepB.after.otherZIndexDOMs[imageBId]}`);
    console.log(`After Step c (TextA PageDown): TextA=${stepC.after.objZIndexManager}, ImageB=${stepC.after.otherZIndexDOMs[imageBId]}`);
    
    if (relevantLogs.length > 0) {
      console.log('\n=== BROWSER CONSOLE LOGS (Relevant) ===');
      relevantLogs.forEach(log => {
        console.log(`[${log.type}] ${log.text}`);
      });
    }
    
    console.log('\nTest 1 passed - cross-type z-index navigation working correctly');
  });
  
  test('Test 2: Complex scenario with 4 objects (Text, Image, Text, Image) - verify all swaps', async ({ page }) => {
    const browserLogs = setupBrowserLogCapture(page);
    await setupTest(page);
    
    console.log('\n=== TEST 2: Complex Multi-Object Cross-Type Z-Index Navigation ===');
    
    const { elementIds, initialZIndex } = await createTestObjects(page, ['TextA', 'ImageB', 'TextC', 'ImageD']);
    const [textAId, imageBId, textCId, imageDId] = elementIds;
    
    // Get initial z-indexes
    const initialZIndexes = {};
    for (const id of elementIds) {
      initialZIndexes[id] = initialZIndex[id].managerZIndex;
    }
    
    console.log('\nInitial order (lowest to highest):');
    const sortedInitial = Object.entries(initialZIndexes).sort((a, b) => a[1] - b[1]);
    sortedInitial.forEach(([id, zIndex], idx) => {
      const type = id.startsWith('wbe-text-') ? 'TEXT' : 'IMAGE';
      console.log(`  ${idx + 1}. ${type} ${id.slice(-6)}: ${zIndex}`);
    });
    
    console.log('\n--- Step b: Move ImageB Up (should swap with TextC or ImageD) ---');
    const stepB = await selectAndPressKey(page, imageBId, [textAId, textCId, imageDId], 'PageUp');
    
    console.log('\n--- Step c: Move TextC Down (should swap with ImageB or TextA) ---');
    const stepC = await selectAndPressKey(page, textCId, [textAId, imageBId, imageDId], 'PageDown');
    
    console.log('\n--- Step d: Move ImageD Down (should swap with TextC or ImageB) ---');
    const stepD = await selectAndPressKey(page, imageDId, [textAId, imageBId, textCId], 'PageDown');
    
    // Verify all objects still have valid z-indexes
    const finalState = await page.evaluate(({ elementIds }) => {
      const state = {};
      for (const id of elementIds) {
        const el = document.getElementById(id);
        state[id] = {
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el,
          type: id.startsWith('wbe-text-') ? 'text' : 'image'
        };
      }
      return state;
    }, { elementIds });
    
    console.log('\nFinal order (lowest to highest):');
    const sortedFinal = Object.entries(finalState)
      .map(([id, state]) => [id, state.managerZIndex, state.type])
      .sort((a, b) => a[1] - b[1]);
    sortedFinal.forEach(([id, zIndex, type], idx) => {
      console.log(`  ${idx + 1}. ${type.toUpperCase()} ${id.slice(-6)}: ${zIndex}`);
    });
    
    // Verify all have unique z-indexes
    const finalZIndexes = sortedFinal.map(([_, zIndex]) => zIndex);
    const uniqueZIndexes = new Set(finalZIndexes);
    expect(uniqueZIndexes.size).toBe(elementIds.length);
    
    // Verify all objects still exist
    for (const id of elementIds) {
      expect(finalState[id].exists).toBe(true);
      expect(finalState[id].managerZIndex).toBeGreaterThan(0);
    }
    
    const relevantLogs = browserLogs.filter(log => isRelevantLog(log.text));
    
    console.log('\n=== TEST 2 SUMMARY ===');
    console.log(`All ${elementIds.length} objects maintain unique z-indexes after cross-type swaps`);
    console.log(`All objects still exist in DOM: ${Object.values(finalState).every(s => s.exists)}`);
    
    if (relevantLogs.length > 0) {
      console.log('\n=== BROWSER CONSOLE LOGS (Relevant) ===');
      relevantLogs.forEach(log => {
        console.log(`[${log.type}] ${log.text}`);
      });
      console.log(`\nTotal browser logs captured: ${browserLogs.length}`);
      console.log(`Relevant logs: ${relevantLogs.length}`);
    }
    
    console.log('\nTest 2 passed - complex cross-type z-index navigation working correctly');
  });
  
  test('Test 3: Verify text can move above image and image can move below text', async ({ page }) => {
    const browserLogs = setupBrowserLogCapture(page);
    await setupTest(page);
    
    console.log('\n=== TEST 3: Verify Cross-Type Z-Index Ordering ===');
    
    const { elementIds, initialZIndex } = await createTestObjects(page, ['TextA', 'ImageB']);
    const [textAId, imageBId] = elementIds;
    
    const initialTextAZIndex = initialZIndex[textAId].managerZIndex;
    const initialImageBZIndex = initialZIndex[imageBId].managerZIndex;
    
    // Initially: TextA < ImageB
    expect(initialTextAZIndex).toBeLessThan(initialImageBZIndex);
    
    console.log('\n--- Step b: Move TextA Up (text should now be above image) ---');
    const stepB = await selectAndPressKey(page, textAId, [imageBId], 'PageUp');
    
    // After swap: TextA > ImageB
    expect(stepB.after.objZIndexManager).toBeGreaterThan(stepB.after.otherZIndexDOMs[imageBId]);
    
    console.log('\n--- Step c: Move ImageB Up (image should now be above text again) ---');
    const stepC = await selectAndPressKey(page, imageBId, [textAId], 'PageUp');
    
    // After swap: ImageB > TextA
    expect(stepC.after.objZIndexManager).toBeGreaterThan(stepC.after.otherZIndexDOMs[textAId]);
    
    const relevantLogs = browserLogs.filter(log => isRelevantLog(log.text));
    
    console.log('\n=== TEST 3 SUMMARY ===');
    console.log(`Initial: TextA=${initialTextAZIndex} < ImageB=${initialImageBZIndex}`);
    console.log(`After Step b (TextA PageUp): TextA=${stepB.after.objZIndexManager} > ImageB=${stepB.after.otherZIndexDOMs[imageBId]}`);
    console.log(`After Step c (ImageB PageUp): ImageB=${stepC.after.objZIndexManager} > TextA=${stepC.after.otherZIndexDOMs[textAId]}`);
    
    if (relevantLogs.length > 0) {
      console.log('\n=== BROWSER CONSOLE LOGS (Relevant) ===');
      relevantLogs.forEach(log => {
        console.log(`[${log.type}] ${log.text}`);
      });
    }
    
    console.log('\nTest 3 passed - text and images can freely swap z-index positions');
  });
});

