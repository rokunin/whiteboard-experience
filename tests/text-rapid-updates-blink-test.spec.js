import { test, expect } from '@playwright/test';

/**
 * Text Rapid Updates Blink Test
 * Tests that text elements don't blink/disappear during rapid updates
 * (pastes, deletes, scaling, z-index changes)
 */

test.describe('Text Rapid Updates Blink Test', () => {
  test.setTimeout(180000); // 3 minutes for rapid operations
  
  // Helper: Setup browser log capture
  function setupBrowserLogCapture(page) {
    const browserLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      browserLogs.push({ type, text, timestamp: new Date().toISOString() });
      
      // Filter for relevant logs
      if (text.includes('[WB-E]') || 
          text.includes('[Text') || 
          text.includes('debouncedFlushTextUpdates') ||
          text.includes('textUpdate') ||
          text.includes('blink') ||
          text.includes('disappear')) {
        const logFunc = type === 'error' ? console.error :
                       type === 'warn' ? console.warn :
                       console.log;
        logFunc(`[Browser ${type.toUpperCase()}] ${text}`);
      }
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
  
  // Helper: Create a text element by copying and pasting
  async function createTextByPaste(page, textContent, offset = 0) {
    // First, create one text element to copy from
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) throw new Error('Board not found');
    
    const screenX = boardRect.left + boardRect.width / 2 + offset;
    const screenY = boardRect.top + boardRect.height / 2;
    
    // Press T to enter text mode
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(500);
    
    // Click on canvas
    await page.locator('#board').click({ 
      position: { 
        x: screenX - boardRect.left, 
        y: screenY - boardRect.top 
      }, 
      force: true 
    });
    await page.waitForTimeout(500);
    
    // Type text
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.type(textContent, { delay: 50 });
    await page.waitForTimeout(300);
    
    // Press Enter to finish
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    
    // Get the created text ID
    const textId = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'))
        .map(el => {
          const textEl = el.querySelector('.wbe-canvas-text');
          const time = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
          return {
            id: el.id,
            text: textEl ? textEl.textContent.trim() : '',
            time: time
          };
        })
        .sort((a, b) => b.time - a.time);
      
      return texts.length > 0 ? texts[0].id : null;
    });
    
    return textId;
  }
  
  // Helper: Copy text element
  async function copyText(page, textId) {
    // Click on text to select
    const elementPos = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, textId);
    
    if (!elementPos) throw new Error(`Text ${textId} not found`);
    
    await page.mouse.click(elementPos.x, elementPos.y);
    await page.waitForTimeout(300);
    
    // Verify selection
    const isSelected = await page.evaluate((id) => {
      return window.TextTools && window.TextTools.selectedTextId === id;
    }, textId);
    
    if (!isSelected) {
      await page.waitForTimeout(500);
      const isSelectedAfterWait = await page.evaluate((id) => {
        return window.TextTools && window.TextTools.selectedTextId === id;
      }, textId);
      if (!isSelectedAfterWait) {
        throw new Error(`Text ${textId} not selected`);
      }
    }
    
    // Copy (Ctrl+C)
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(500);
  }
  
  // Helper: Paste text rapidly
  async function pasteTextRapidly(page, count = 5, delay = 50) {
    const pastedIds = [];
    
    for (let i = 0; i < count; i++) {
      // Paste
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(delay);
      
      // Get the most recently created text
      const newTextId = await page.evaluate(() => {
        const texts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'))
          .map(el => {
            const time = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
            return { id: el.id, time: time };
          })
          .sort((a, b) => b.time - a.time);
        
        return texts.length > 0 ? texts[0].id : null;
      });
      
      if (newTextId) {
        pastedIds.push(newTextId);
      }
    }
    
    // Wait for all debounced updates to complete
    await page.waitForTimeout(500);
    
    return pastedIds;
  }
  
  // Helper: Check if text elements exist and are visible
  async function checkTextsExist(page, textIds) {
    const results = await page.evaluate((ids) => {
      const results = {};
      ids.forEach(id => {
        const el = document.getElementById(id);
        const textEl = el?.querySelector('.wbe-canvas-text');
        results[id] = {
          exists: !!el,
          visible: el && el.offsetParent !== null,
          hasText: !!textEl,
          textContent: textEl?.textContent || '',
          zIndex: el ? parseInt(el.style.zIndex) || 0 : 0
        };
      });
      return results;
    }, textIds);
    
    return results;
  }

  test.beforeEach(async ({ page }) => {
    setupBrowserLogCapture(page);
  });

  test('Rapid paste test - texts should not blink or disappear', async ({ page }) => {
    console.log('=== TEST: Rapid Paste - No Blinking ===');
    
    await setupTest(page);
    
    // Step 1: Create initial text
    console.log('Creating initial text...');
    const initialTextId = await createTextByPaste(page, 'SourceText', 0);
    expect(initialTextId).toBeTruthy();
    console.log(`Initial text ID: ${initialTextId}`);
    
    // Step 2: Copy it
    console.log('Copying text...');
    await copyText(page, initialTextId);
    await page.waitForTimeout(500);
    
    // Step 3: Rapidly paste 5 times (50ms delay)
    console.log('Rapidly pasting 5 times...');
    const pastedIds = await pasteTextRapidly(page, 5, 50);
    console.log(`Pasted ${pastedIds.length} texts:`, pastedIds);
    
    expect(pastedIds.length).toBeGreaterThanOrEqual(4); // At least 4 should succeed
    
    // Step 4: Wait for debounce to complete
    console.log('Waiting for debounced updates to complete...');
    await page.waitForTimeout(600); // Wait for 200ms debounce + buffer
    
    // Step 5: Check all texts still exist and are visible
    console.log('Checking all texts exist and are visible...');
    const allTextIds = [initialTextId, ...pastedIds];
    const existenceCheck = await checkTextsExist(page, allTextIds);
    
    console.log('Existence check results:');
    Object.entries(existenceCheck).forEach(([id, result]) => {
      console.log(`  ${id}: exists=${result.exists}, visible=${result.visible}, zIndex=${result.zIndex}`);
    });
    
    // Verify all texts exist
    const missingTexts = Object.entries(existenceCheck)
      .filter(([id, result]) => !result.exists || !result.visible)
      .map(([id]) => id);
    
    if (missingTexts.length > 0) {
      const errorMessage = `Text blinking detected! ${missingTexts.length} text(s) disappeared:\n${missingTexts.join('\n')}\n\nExistence check:\n${JSON.stringify(existenceCheck, null, 2)}`;
      throw new Error(errorMessage);
    }
    
    // Verify all texts have valid z-index
    const invalidZIndex = Object.entries(existenceCheck)
      .filter(([id, result]) => result.zIndex < 1000)
      .map(([id]) => id);
    
    if (invalidZIndex.length > 0) {
      console.warn(`Warning: ${invalidZIndex.length} text(s) have invalid z-index:`, invalidZIndex);
    }
    
    console.log('✓ All texts exist and are visible - no blinking detected');
  });

  test('Rapid z-index changes test - texts should not blink', async ({ page }) => {
    console.log('=== TEST: Rapid Z-Index Changes - No Blinking ===');
    
    await setupTest(page);
    
    // Step 1: Create 3 text elements
    console.log('Creating 3 text elements...');
    const textIds = [];
    for (let i = 0; i < 3; i++) {
      const textId = await createTextByPaste(page, `Text${i + 1}`, i * 100);
      expect(textId).toBeTruthy();
      textIds.push(textId);
      await page.waitForTimeout(300);
    }
    console.log(`Created texts:`, textIds);
    
    // Step 2: Wait for all to be created
    await page.waitForTimeout(1000);
    
    // Step 3: Rapidly change z-index (PageUp/PageDown) on first text
    console.log('Rapidly changing z-index on first text...');
    
    // Select first text
    const elementPos = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, textIds[0]);
    
    await page.mouse.click(elementPos.x, elementPos.y);
    await page.waitForTimeout(300);
    
    // Rapidly press PageUp 5 times (50ms delay)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('PageUp');
      await page.waitForTimeout(50);
    }
    
    // Wait for debounce
    await page.waitForTimeout(600);
    
    // Step 4: Check all texts still exist
    console.log('Checking all texts still exist...');
    const existenceCheck = await checkTextsExist(page, textIds);
    
    const missingTexts = Object.entries(existenceCheck)
      .filter(([id, result]) => !result.exists || !result.visible)
      .map(([id]) => id);
    
    if (missingTexts.length > 0) {
      const errorMessage = `Text blinking detected during z-index changes! ${missingTexts.length} text(s) disappeared:\n${missingTexts.join('\n')}`;
      throw new Error(errorMessage);
    }
    
    console.log('✓ All texts exist after rapid z-index changes - no blinking detected');
  });

  test('Rapid delete test - remaining texts should not blink', async ({ page }) => {
    console.log('=== TEST: Rapid Delete - No Blinking ===');
    
    await setupTest(page);
    
    // Step 1: Create 5 text elements
    console.log('Creating 5 text elements...');
    const textIds = [];
    for (let i = 0; i < 5; i++) {
      const textId = await createTextByPaste(page, `Text${i + 1}`, i * 80);
      expect(textId).toBeTruthy();
      textIds.push(textId);
      await page.waitForTimeout(200);
    }
    console.log(`Created texts:`, textIds);
    
    await page.waitForTimeout(1000);
    
    // Step 2: Rapidly delete 3 texts (select + Delete)
    console.log('Rapidly deleting 3 texts...');
    const textsToDelete = textIds.slice(0, 3);
    const textsToKeep = textIds.slice(3);
    
    for (const textId of textsToDelete) {
      // Select
      const elementPos = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, textId);
      
      if (elementPos) {
        await page.mouse.click(elementPos.x, elementPos.y);
        await page.waitForTimeout(100);
        
        // Delete
        await page.keyboard.press('Delete');
        await page.waitForTimeout(50); // Rapid
      }
    }
    
    // Wait for debounce
    await page.waitForTimeout(600);
    
    // Step 3: Check remaining texts still exist
    console.log('Checking remaining texts still exist...');
    const existenceCheck = await checkTextsExist(page, textsToKeep);
    
    const missingTexts = Object.entries(existenceCheck)
      .filter(([id, result]) => !result.exists || !result.visible)
      .map(([id]) => id);
    
    if (missingTexts.length > 0) {
      const errorMessage = `Text blinking detected during rapid deletes! ${missingTexts.length} remaining text(s) disappeared:\n${missingTexts.join('\n')}`;
      throw new Error(errorMessage);
    }
    
    console.log('✓ Remaining texts exist after rapid deletes - no blinking detected');
  });
});

