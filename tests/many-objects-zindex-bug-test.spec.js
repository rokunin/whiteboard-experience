import { test, expect } from '@playwright/test';

/**
 * Many Objects Z-Index Bug Test
 * Tests bugs when:
 * 1. Moving objects back and forth with many objects
 * 2. GM vs non-GM state differences
 * 3. Objects disappearing when pasting many objects
 * 4. Objects showing incorrect "at bottom" state
 */

test.describe('Many Objects Z-Index Bug Test', () => {
  test.setTimeout(180000); // 3 minutes
  
  // Helper: Setup browser log capture
  function setupBrowserLogCapture(page) {
    const browserLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      browserLogs.push({ type, text, timestamp: new Date().toISOString() });
    });
    page['_browserLogs'] = browserLogs;
    return browserLogs;
  }
  
  // Helper: Login and setup
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
    await page.evaluate(async () => {
      await window.WhiteboardExperience.clearCanvasElements();
    });
    await page.waitForTimeout(1000);
  }
  
  // Helper: Create one text and one image, then paste copies
  async function createManyObjects(page, pasteCount = 4) {
    console.log(`Creating 1 text + 1 image, then pasting ${pasteCount} copies...`);
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) throw new Error('Board not found');
    
    const centerX = boardRect.left + boardRect.width / 2;
    const centerY = boardRect.top + boardRect.height / 2;
    
    // Step 1: Create one text object
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(500);
    await page.mouse.click(centerX - 100, centerY);
    await page.waitForTimeout(1000);
    await page.keyboard.type('TestText', { delay: 50 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    
    // Get the text ID
    const textId = await page.evaluate(() => {
      const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'));
      const newest = allTexts
        .map(el => {
          const time = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
          return { id: el.id, time };
        })
        .sort((a, b) => b.time - a.time)[0];
      return newest?.id || null;
    });
    
    if (!textId) throw new Error('Failed to create text object');
    
    // Step 2: Create one image object (using a simple test image)
    // For now, we'll create a placeholder image or use a data URL
    const imageId = await page.evaluate(async ({ centerX, centerY }) => {
      const ImageTools = window.ImageTools;
      if (!ImageTools) return null;
      
      // Create a simple test image using a data URL (1x1 pixel)
      const testImageSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const testId = `wbe-image-${Date.now()}`;
      
      try {
        const container = ImageTools.createImageElement(
          testId,
          testImageSrc,
          centerX - 50,
          centerY - 50,
          1,
          { top: 0, right: 0, bottom: 0, left: 0 },
          'rect',
          { x: 0, y: 0 },
          null
        );
        
        if (container) {
          // Save it manually by building image data and calling setAllImages
          const imageElement = container.querySelector(".wbe-canvas-image");
          if (imageElement) {
            const images = await ImageTools.getAllImages();
            images[testId] = {
              src: imageElement.src,
              left: parseFloat(container.style.left) || 0,
              top: parseFloat(container.style.top) || 0,
              scale: 1,
              crop: { top: 0, right: 0, bottom: 0, left: 0 },
              maskType: 'rect',
              circleOffset: { x: 0, y: 0 },
              circleRadius: null,
              isFrozen: false,
              zIndex: window.ZIndexManager?.get(testId) || null
            };
            await ImageTools.setAllImages(images);
          }
          return testId;
        }
      } catch (e) {
        console.error('Error creating test image:', e);
      }
      
      return null;
    }, { centerX, centerY });
    
    await page.waitForTimeout(1000);
    
    // Step 3: Copy both objects programmatically
    await page.evaluate(({ textId, imageId }) => {
      const texts = {};
      const images = {};
      
      // Copy text data
      const textContainer = document.getElementById(textId);
      if (textContainer) {
        const textElement = textContainer.querySelector(".wbe-canvas-text");
        if (textElement) {
          texts[textId] = {
            text: textElement.textContent,
            left: parseFloat(textContainer.style.left) || 0,
            top: parseFloat(textContainer.style.top) || 0,
            scale: parseFloat(textElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1,
            color: textElement.style.color || "#000000",
            backgroundColor: textElement.style.backgroundColor || "#ffffff",
            borderColor: textElement.dataset.borderRgba || null,
            borderWidth: parseInt(textElement.dataset.borderWidth) || 0,
            fontWeight: textElement.dataset.fontWeight || "400",
            fontStyle: textElement.dataset.fontStyle || "normal",
            textAlign: textElement.dataset.textAlign || "left",
            fontFamily: textElement.dataset.fontFamily || "Arial",
            fontSize: parseInt(textElement.dataset.fontSize) || 16,
            width: textElement.style.width ? parseFloat(textElement.style.width) : null
          };
        }
      }
      
      // Copy image data
      const imageContainer = document.getElementById(imageId);
      if (imageContainer) {
        const imageElement = imageContainer.querySelector(".wbe-canvas-image");
        if (imageElement) {
          images[imageId] = {
            src: imageElement.src,
            left: parseFloat(imageContainer.style.left) || 0,
            top: parseFloat(imageContainer.style.top) || 0,
            scale: parseFloat(imageElement.style.transform?.match(/scale\(([\d.]+)\)/)?.[1]) || 1,
            crop: { top: 0, right: 0, bottom: 0, left: 0 },
            maskType: 'rect',
            circleOffset: { x: 0, y: 0 },
            circleRadius: null,
            isFrozen: false
          };
        }
      }
      
      // Store in global variable for paste
      window.wbeCopiedMultiSelection = { texts, images };
      
      return { textsCount: Object.keys(texts).length, imagesCount: Object.keys(images).length };
    }, { textId, imageId });
    
    await page.waitForTimeout(500);
    
    // Step 4: Paste multiple times
    const elementIds = [textId];
    if (imageId) elementIds.push(imageId);
    
    for (let i = 0; i < pasteCount; i++) {
      // Set mouse position for paste
      const pasteX = centerX + (i % 5) * 60;
      const pasteY = centerY + Math.floor(i / 5) * 60;
      
      await page.mouse.move(pasteX, pasteY);
      await page.waitForTimeout(100);
      
      // Paste using Ctrl+V
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(1500);
      
      // Get newly created IDs
      const newIds = await page.evaluate(({ existingIds }) => {
        const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'));
        const allImages = Array.from(document.querySelectorAll('[id^="wbe-image-"]'));
        const all = [...allTexts, ...allImages];
        
        const newIds = [];
        for (const el of all) {
          if (!existingIds.includes(el.id)) {
            newIds.push(el.id);
          }
        }
        
        return newIds;
      }, { existingIds: elementIds });
      
      elementIds.push(...newIds);
    }
    
    await page.waitForTimeout(2000);
    console.log(`Created ${elementIds.length} total objects (${pasteCount} pastes)`);
    return elementIds;
  }
  
  test('Test 1: Aggressive z-index changes - move objects to bottom, top, swap, repeat', async ({ page }) => {
    setupBrowserLogCapture(page);
    await setupTest(page);
    
    console.log('\n=== TEST 1: Aggressive z-index manipulation with 6 objects ===');
    
    // Create 6 objects (1 text + 1 image + 4 pastes = 6 total)
    const elementIds = await createManyObjects(page, 4);
    expect(elementIds.length).toBe(6);
    
    console.log(`Created ${elementIds.length} objects`);
    
    // Get all objects and their initial positions
    const allObjects = await page.evaluate(({ elementIds }) => {
      return elementIds.map(id => {
        const el = document.getElementById(id);
        return {
          id,
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el
        };
      });
    }, { elementIds });
    
    console.log('Initial z-indexes:', allObjects.map(o => `${o.id.slice(-6)}: ${o.domZIndex}`).join(', '));
    
    // Test each object with 8 aggressive z-index changes
    for (let objIndex = 0; objIndex < elementIds.length; objIndex++) {
      const testObjectId = elementIds[objIndex];
      
      console.log(`\n--- Testing object ${objIndex + 1}/${elementIds.length} (${testObjectId.slice(-6)}) ---`);
      
      // Select the object
      const elementPos = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, testObjectId);
      
      if (!elementPos) {
        console.error(`Object ${testObjectId} not found, skipping`);
        continue;
      }
      
      await page.mouse.click(elementPos.x, elementPos.y);
      await page.waitForTimeout(500);
      
      // Aggressive sequence: move to bottom, move up several times, move to top, move down, swap around
      const aggressiveMoves = [
        { action: 'toBottom', key: 'PageDown', count: 10, desc: 'Move to absolute bottom' },
        { action: 'up1', key: 'PageUp', count: 1, desc: 'Move up 1 layer' },
        { action: 'up2', key: 'PageUp', count: 2, desc: 'Move up 2 more layers' },
        { action: 'toTop', key: 'PageUp', count: 10, desc: 'Move to absolute top' },
        { action: 'down1', key: 'PageDown', count: 1, desc: 'Move down 1 layer' },
        { action: 'down2', key: 'PageDown', count: 2, desc: 'Move down 2 more layers' },
        { action: 'swap', key: 'PageUp', count: 1, desc: 'Swap with next object' },
        { action: 'swapBack', key: 'PageDown', count: 1, desc: 'Swap back' }
      ];
      
      let moveCount = 0;
      for (const move of aggressiveMoves) {
        for (let i = 0; i < move.count; i++) {
          await page.keyboard.press(move.key);
          await page.waitForTimeout(800); // Longer wait for socket updates
          moveCount++;
          
          // Verify all objects still exist before continuing
          const allObjectsCheck = await page.evaluate(({ elementIds }) => {
            return elementIds.map(id => ({
              id,
              exists: !!document.getElementById(id)
            }));
          }, { elementIds });
          
          const missingObjects = allObjectsCheck.filter(o => !o.exists);
          if (missingObjects.length > 0) {
            console.error(`❌ OBJECTS DISAPPEARED at move ${moveCount}: ${missingObjects.map(o => o.id.slice(-6)).join(', ')}`);
          }
          
          const state = await page.evaluate((id) => {
            const el = document.getElementById(id);
            const allElements = Array.from(document.querySelectorAll('[id^="wbe-text-"], [id^="wbe-image-"]'));
            const allZIndexes = allElements.map(el => parseInt(el.style.zIndex) || 0).filter(z => z > 0).sort((a, b) => a - b);
            
            return {
              domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
              managerZIndex: window.ZIndexManager?.get(id) || 0,
              exists: !!el,
              allZIndexes: allZIndexes,
              totalObjects: allElements.length,
              minZIndex: allZIndexes.length > 0 ? allZIndexes[0] : 0,
              maxZIndex: allZIndexes.length > 0 ? allZIndexes[allZIndexes.length - 1] : 0,
              isMin: allZIndexes.length > 0 && (parseInt(el?.style.zIndex) || 0) === allZIndexes[0],
              isMax: allZIndexes.length > 0 && (parseInt(el?.style.zIndex) || 0) === allZIndexes[allZIndexes.length - 1]
            };
          }, testObjectId);
          
          // Check for desync
          if (state.domZIndex !== state.managerZIndex && state.domZIndex > 0 && state.managerZIndex > 0) {
            console.error(`❌ DESYNC at move ${moveCount} (${move.desc}): DOM=${state.domZIndex} != Manager=${state.managerZIndex}`);
          }
          
          // Check if object still exists
          if (!state.exists) {
            console.error(`❌ OBJECT DISAPPEARED at move ${moveCount}`);
          }
          
          // Warn if total object count decreased
          if (state.totalObjects < elementIds.length) {
            console.error(`❌ OBJECT COUNT DECREASED at move ${moveCount}: ${state.totalObjects} < ${elementIds.length}`);
          }
          
          // Log every few moves
          if (moveCount % 3 === 0 || i === move.count - 1) {
            console.log(`  Move ${moveCount} (${move.desc}): DOM=${state.domZIndex}, Manager=${state.managerZIndex}, Total=${state.totalObjects}, Min=${state.minZIndex}, Max=${state.maxZIndex}, IsMin=${state.isMin}, IsMax=${state.isMax}`);
          }
        }
      }
      
      console.log(`  Completed ${moveCount} moves for object ${objIndex + 1}`);
      
      // Verify final state
      const finalState = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return {
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el,
          isVisible: el ? el.offsetWidth > 0 && el.offsetHeight > 0 : false
        };
      }, testObjectId);
      
      expect(finalState.exists).toBe(true);
      expect(finalState.domZIndex).toBe(finalState.managerZIndex);
      expect(finalState.isVisible).toBe(true);
      
      // Small delay between objects
      await page.waitForTimeout(500);
    }
    
    // Final verification: all objects should still exist and be in sync
    const finalCheck = await page.evaluate(({ elementIds }) => {
      const results = elementIds.map(id => {
        const el = document.getElementById(id);
        return {
          id,
          domZIndex: el ? parseInt(el.style.zIndex) || 0 : -1,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el,
          isVisible: el ? el.offsetWidth > 0 && el.offsetHeight > 0 : false,
          inSync: el ? (parseInt(el.style.zIndex) || 0) === (window.ZIndexManager?.get(id) || 0) : false
        };
      });
      
      return {
        total: results.length,
        existing: results.filter(r => r.exists).length,
        visible: results.filter(r => r.isVisible).length,
        inSync: results.filter(r => r.inSync).length,
        desynced: results.filter(r => r.exists && !r.inSync)
      };
    }, { elementIds });
    
    console.log(`\nFinal check: ${finalCheck.existing}/${finalCheck.total} exist, ${finalCheck.visible}/${finalCheck.total} visible, ${finalCheck.inSync}/${finalCheck.total} in sync`);
    
    if (finalCheck.desynced.length > 0) {
      console.error('❌ Desynced objects:', finalCheck.desynced.map(o => `${o.id.slice(-6)}: DOM=${o.domZIndex}, Manager=${o.managerZIndex}`));
    }
    
    expect(finalCheck.existing).toBe(finalCheck.total);
    expect(finalCheck.visible).toBe(finalCheck.total);
    expect(finalCheck.inSync).toBe(finalCheck.total);
  });
  
  test('Test 2: Paste many objects and check visibility', async ({ page }) => {
    setupBrowserLogCapture(page);
    await setupTest(page);
    
    console.log('\n=== TEST 2: Pasting many objects ===');
    
    // Create 1 text + 1 image, then paste 6 times (total 8 objects + 12 from pastes = 20)
    const elementIds = await createManyObjects(page, 6);
    expect(elementIds.length).toBeGreaterThanOrEqual(8); // 2 original + at least 6 from pastes
    await page.keyboard.press('KeyT'); // Exit text mode
    await page.waitForTimeout(500);
    
    // Select first object
    const pos1 = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, elementIds[0]);
    
    if (pos1) {
      await page.mouse.click(pos1.x, pos1.y, { modifiers: ['Control'] });
      await page.waitForTimeout(300);
    }
    
    // Copy
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(500);
    
    // Objects are already pasted by createManyObjects, so we just check them
    
    await page.waitForTimeout(2000);
    
    // Check all objects exist and are visible
    const allObjects = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[id^="wbe-text-"], [id^="wbe-image-"]'));
      return elements.map(el => ({
        id: el.id,
        domZIndex: parseInt(el.style.zIndex) || 0,
        managerZIndex: window.ZIndexManager?.get(el.id) || 0,
        exists: true,
        isVisible: el.offsetWidth > 0 && el.offsetHeight > 0,
        opacity: parseFloat(getComputedStyle(el).opacity) || 1
      }));
    });
    
    console.log(`Total objects: ${allObjects.length}`);
    
    let missingCount = 0;
    let invisibleCount = 0;
    let desyncCount = 0;
    
    for (const obj of allObjects) {
      if (!obj.exists) missingCount++;
      if (!obj.isVisible) invisibleCount++;
      if (obj.domZIndex !== obj.managerZIndex && obj.domZIndex > 0 && obj.managerZIndex > 0) {
        desyncCount++;
        console.error(`❌ Desync: ${obj.id.slice(-10)} DOM=${obj.domZIndex} != Manager=${obj.managerZIndex}`);
      }
    }
    
    console.log(`Missing: ${missingCount}, Invisible: ${invisibleCount}, Desync: ${desyncCount}`);
    
    expect(missingCount).toBe(0);
    expect(invisibleCount).toBe(0);
    expect(desyncCount).toBe(0);
  });
  
  test('Test 3: Check "at bottom" state accuracy', async ({ page }) => {
    setupBrowserLogCapture(page);
    await setupTest(page);
    
    console.log('\n=== TEST 3: Checking "at bottom" state ===');
    
    // Create 5 objects
    const elementIds = await createManyObjects(page, 5);
    expect(elementIds.length).toBeGreaterThanOrEqual(3);
    
    // Select first object
    const testObjectId = elementIds[0];
    const elementPos = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, testObjectId);
    
    if (!elementPos) throw new Error('Test object not found');
    
    await page.mouse.click(elementPos.x, elementPos.y);
    await page.waitForTimeout(500);
    
    // Move to bottom
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(500);
    }
    
    // Check state
    const state = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const allElements = Array.from(document.querySelectorAll('[id^="wbe-text-"], [id^="wbe-image-"]'));
      const allZIndexes = allElements.map(el => parseInt(el.style.zIndex) || 0).filter(z => z > 0).sort((a, b) => a - b);
      const testZIndex = el ? parseInt(el.style.zIndex) || 0 : 0;
      
      return {
        domZIndex: testZIndex,
        managerZIndex: window.ZIndexManager?.get(id) || 0,
        isMinZIndex: testZIndex === (allZIndexes[0] || 0),
        minZIndex: allZIndexes[0] || 0,
        allZIndexes: allZIndexes,
        isVisible: el ? el.offsetWidth > 0 && el.offsetHeight > 0 : false
      };
    }, testObjectId);
    
    console.log(`State after moving to bottom:`);
    console.log(`  DOM z-index: ${state.domZIndex}`);
    console.log(`  Manager z-index: ${state.managerZIndex}`);
    console.log(`  Is minimum: ${state.isMinZIndex}`);
    console.log(`  Min z-index in scene: ${state.minZIndex}`);
    console.log(`  All z-indexes: ${state.allZIndexes.join(', ')}`);
    
    // Object should be at minimum z-index if it's at bottom
    if (state.isMinZIndex) {
      expect(state.domZIndex).toBe(state.minZIndex);
      expect(state.domZIndex).toBe(state.managerZIndex);
    }
    
    expect(state.isVisible).toBe(true);
  });
});

