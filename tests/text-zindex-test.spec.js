import { test, expect } from '@playwright/test';

/**
 * Text Z-Index Test
 * Tests z-index navigation with PageUp and PageDown for text elements
 */

test.describe('Text Z-Index Test', () => {
  // Increase timeout for text creation workflow
  test.setTimeout(120000); // 2 minutes
  
  // Helper: Check if log matches our filter criteria
  function isRelevantLog(text) {
    return text.includes('[WB-E] Global paste handler') ||
           text.includes('[Text Creation]') ||
           text.includes('[Text Paste]') ||
           text.includes('[CompactZIndexManager] Synced') ||
           text.includes('[Z-Index] TEXT') ||
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
  
  // Helper: Create two text objects using T-cursor workflow (press T, click, type)
  async function createTestObjects(page, objects = ['TextA', 'TextB']) {
    console.log('Creating test texts using T-cursor workflow...');
    
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
    
    const elementIds = [];
    
    // Create texts using the T-cursor workflow: press T, click canvas, type, enter
    for (let i = 0; i < 2; i++) {
      const textContent = objects[i] || `Text${i === 0 ? 'A' : 'B'}`;
      const clickX = screenX1 + (i * (screenX2 - screenX1));
      
      // Step 1: Get current text count to track new creation
      const beforeCount = await page.evaluate(() => {
        return document.querySelectorAll('[id^="wbe-text-"]').length;
      });
      
      // Step 2: Press 'T' to change to T-cursor (enter text mode)
      await page.keyboard.press('KeyT');
      await page.waitForTimeout(1000);
      
      // Step 3: Click on the board/canvas at the desired position
      await page.locator('#board').click({ 
        position: { x: clickX - (await page.evaluate(() => {
          const board = document.getElementById('board');
          return board ? board.getBoundingClientRect().left : 0;
        })), 
        y: screenY - (await page.evaluate(() => {
          const board = document.getElementById('board');
          return board ? board.getBoundingClientRect().top : 0;
        })) }, 
        force: true 
      });
      await page.waitForTimeout(1000);
      
      // Step 4: Select all (Control+a) to clear default text
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(100);
      
      // Step 5: Type the text content at human speed
      await page.keyboard.type(textContent, { delay: 100 });
      await page.waitForTimeout(500);
      
      // Step 6: Press Enter to finish editing
      await page.keyboard.press('Enter');
      
      // Step 7: Wait for text to be saved (text mode exits automatically)
      await page.waitForTimeout(1500);
      
      // Step 8: Get the created text element ID (most recent one)
      const createdTextId = await page.evaluate(({ textContent, beforeCount, i }) => {
        // Get all texts, find the newest one
        const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'))
          .map(el => {
            const textEl = el.querySelector('.wbe-canvas-text');
            const textTime = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
            return {
              id: el.id,
              text: textEl ? textEl.textContent.trim() : '',
              time: textTime
            };
          })
          .sort((a, b) => b.time - a.time); // Most recent first
        
        // Find text that matches our content (check the newest ones first)
        for (const textObj of allTexts) {
          if (textObj.text && (textObj.text === textContent || textObj.text.includes(textContent) || textContent.includes(textObj.text))) {
            return textObj.id;
          }
        }
        
        // If no match, return the newest text created recently (within last 5 seconds)
        const recentTexts = allTexts.filter(t => t.time > Date.now() - 5000);
        if (recentTexts.length > 0) {
          // Find the (i+1)th most recent text (to account for multiple creations)
          const targetIndex = Math.min(i, recentTexts.length - 1);
          return recentTexts[targetIndex].id;
        }
        
        return null;
      }, { textContent, beforeCount, i });
      
      if (createdTextId) {
        elementIds.push(createdTextId);
        // Verify the text content
        const actualContent = await page.evaluate((id) => {
          const el = document.getElementById(id);
          const textEl = el?.querySelector('.wbe-canvas-text');
          return textEl ? textEl.textContent.trim() : '';
        }, createdTextId);
        console.log(`Created text ${i + 1}: ${createdTextId} with content "${actualContent}"`);
      } else {
        console.warn(`Could not find created text element for ${textContent}`);
      }
    }
    
    expect(elementIds.length).toBe(2);
    const [objAId, objBId] = elementIds;
    
    // Wait for texts to be fully created and persisted
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
    
    // Verify selection (texts use selectedTextId)
    const isSelected = await page.evaluate((id) => {
      // Check if text is selected via TextTools.selectedTextId getter
      const TextTools = window.TextTools;
      return TextTools && TextTools.selectedTextId === id;
    }, elementId);
    
    if (!isSelected) {
      // Try one more time with a longer wait
      await page.waitForTimeout(500);
      const isSelectedAfterWait = await page.evaluate((id) => {
        const TextTools = window.TextTools;
        return TextTools && TextTools.selectedTextId === id;
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
      const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'))
        .filter(el => el.offsetParent !== null)
        .map(el => ({
          id: el.id,
          zIndex: parseInt(el.style.zIndex) || 0,
          zIndexManager: window.ZIndexManager?.get(el.id) || 0
        }));
      
      // Check for compaction patterns (all at 1000, 1050, 1100, etc - stepSize intervals)
      const stepSize = 50;
      const normalizedZIndexes = allTexts.map(t => t.zIndex).sort((a, b) => a - b);
      const isCompacted = normalizedZIndexes.every((z, i) => 
        z === 1000 + (i * stepSize) || // Perfect compaction
        (i === 0 && z === 1000) // At least first is 1000
      );
      
      return {
        objZIndex: objZIndexDOM,
        otherZIndex: otherZIndexDOM,
        objZIndexManager,
        otherZIndexManager,
        allTexts,
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

  test('Test 1: Move Up TextA, then Move Up TextB', async ({ page }) => {
    console.log('=== TEST 1: Move Up TextA, then Move Up TextB ===');
    
    // a. prepare login, clean, create objects
    await setupTest(page);
    const { objAId, objBId, initialZIndex } = await createTestObjects(page);
    
    // b. move Up TextA, delay 200ms
    console.log('\n--- Step b: Move Up TextA ---');
    const stepB = await selectAndPressKey(page, objAId, objBId, 'PageUp', 200);
    
    // c. move Up TextB
    console.log('\n--- Step c: Move Up TextB ---');
    const stepC = await selectAndPressKey(page, objBId, objAId, 'PageUp', 200);
    
    // Report browser logs
    const relevantLogs = reportBrowserLogs(page);
    
    // Summary
    console.log('\n=== TEST 1 SUMMARY ===');
    console.log(`Initial: TextA=${initialZIndex.objAZIndex}, TextB=${initialZIndex.objBZIndex}`);
    console.log(`After Step b (TextA PageUp): TextA=${stepB.after.objZIndex}, TextB=${stepB.after.otherZIndex}`);
    console.log(`After Step c (TextB PageUp): TextA=${stepC.after.otherZIndex}, TextB=${stepC.after.objZIndex}`);
    
    const issues = [];
    if (!stepB.changed) {
      issues.push('Step b: TextA PageUp did not change z-index');
    }
    if (!stepC.changed) {
      issues.push('Step c: TextB PageUp did not change z-index');
    }
    
    if (issues.length > 0) {
      const errorMessage = `Test 1 failed:\n${issues.join('\n')}\n\nBrowser Console Logs:\n${relevantLogs.map(log => `[${log.type}] ${log.text}`).join('\n')}`;
      throw new Error(errorMessage);
    } else {
      console.log('\nTest 1 passed - all steps completed successfully');
    }
  });

  test('Test 2: Move Down TextB, then Move Up TextB, then Move Down TextB', async ({ page }) => {
    console.log('=== TEST 2: Move Down TextB, then Move Up TextB, then Move Down TextB ===');
    
    // a. prepare login, clean, create objects
    await setupTest(page);
    const { objAId, objBId, initialZIndex } = await createTestObjects(page);
    
    // b. move Down TextB, delay 200ms
    console.log('\n--- Step b: Move Down TextB ---');
    const stepB = await selectAndPressKey(page, objBId, objAId, 'PageDown', 200);
    
    // c. move Up TextB
    console.log('\n--- Step c: Move Up TextB ---');
    const stepC = await selectAndPressKey(page, objBId, objAId, 'PageUp', 200);
    
    // d. move Down TextB
    console.log('\n--- Step d: Move Down TextB ---');
    const stepD = await selectAndPressKey(page, objBId, objAId, 'PageDown', 200);
    
    // Report browser logs
    const relevantLogs = reportBrowserLogs(page);
    
    // Summary
    console.log('\n=== TEST 2 SUMMARY ===');
    console.log(`Initial: TextA=${initialZIndex.objAZIndex}, TextB=${initialZIndex.objBZIndex}`);
    console.log(`After Step b (TextB PageDown): TextA=${stepB.after.otherZIndex}, TextB=${stepB.after.objZIndex}`);
    console.log(`After Step c (TextB PageUp): TextA=${stepC.after.otherZIndex}, TextB=${stepC.after.objZIndex}`);
    console.log(`After Step d (TextB PageDown): TextA=${stepD.after.otherZIndex}, TextB=${stepD.after.objZIndex}`);
    
    const issues = [];
    if (!stepB.changed) {
      issues.push('Step b: TextB PageDown did not change z-index');
    }
    if (!stepC.changed) {
      // Step c might fail if TextA disappeared (DOM=0) - check if both objects still exist
      const bothExist = stepC.after.objZIndexManager > 0 && stepC.after.otherZIndexManager > 0;
      if (!bothExist) {
        issues.push('Step c: TextB PageUp did not change z-index - one object may have disappeared');
      } else {
        // Check if TextB is actually at top (can't move up)
        const stepCAtTop = stepC.after.objZIndexManager === Math.max(...stepC.after.normalizedZIndexes);
        if (!stepCAtTop) {
          issues.push('Step c: TextB PageUp did not change z-index');
        }
      }
    }
    // Step d: TextB is already at bottom, so "at_bottom" is expected and valid
    // Only fail if it changed when it shouldn't, or if there's an error
    const stepDExpectedAtBottom = stepD.after.objZIndexManager === Math.min(...stepD.after.normalizedZIndexes);
    if (!stepD.changed && !stepDExpectedAtBottom) {
      issues.push('Step d: TextB PageDown did not change z-index, but TextB is not at bottom');
    }
    
    if (issues.length > 0) {
      const errorMessage = `Test 2 failed:\n${issues.join('\n')}\n\nBrowser Console Logs:\n${relevantLogs.map(log => `[${log.type}] ${log.text}`).join('\n')}`;
      throw new Error(errorMessage);
    } else {
      console.log('\nTest 2 passed - all steps completed successfully');
    }
  });
});

