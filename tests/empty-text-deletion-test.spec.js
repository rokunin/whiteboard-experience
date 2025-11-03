import { test, expect } from '@playwright/test';

/**
 * Empty Text Deletion Test
 * Tests that empty text blocks are automatically deleted when:
 * 1. User presses Enter on empty text
 * 2. User clicks outside empty text block
 */

test.describe('Empty Text Deletion Test', () => {
  test.setTimeout(120000); // 2 minutes
  
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
  
  test('Empty text should be deleted when Enter is pressed', async ({ page }) => {
    setupBrowserLogCapture(page);
    await setupTest(page);
    
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
    
    // Calculate visible screen position (center of board)
    const screenX = boardRect.left + boardRect.width / 2;
    const screenY = boardRect.top + boardRect.height / 2;
    
    // Get initial text count
    const initialTextCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    // Step 1: Press 'T' to enter text mode
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(1000);
    
    // Step 2: Click on the board to create a text element
    await page.locator('#board').click({ 
      position: { 
        x: screenX - boardRect.left, 
        y: screenY - boardRect.top 
      }, 
      force: true 
    });
    await page.waitForTimeout(1500);
    
    // Step 3: Verify text element was created
    const afterCreationCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    expect(afterCreationCount).toBe(initialTextCount + 1);
    
    // Step 4: Find the newly created text element
    const textId = await page.evaluate(() => {
      const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'));
      const newest = allTexts
        .map(el => {
          const textTime = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
          return { id: el.id, time: textTime };
        })
        .sort((a, b) => b.time - a.time)[0];
      return newest?.id || null;
    });
    
    expect(textId).not.toBeNull();
    console.log(`Created text element: ${textId}`);
    
    // Step 5: Wait for edit mode (may already be active or need to activate)
    await page.waitForTimeout(1000);
    
    // Check if already in edit mode, if not, try to activate it
    const isEditable = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const textEl = el?.querySelector('.wbe-canvas-text');
      return textEl ? textEl.contentEditable === 'true' : false;
    }, textId);
    
    if (!isEditable) {
      // Try clicking on the text element to enter edit mode
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        const textEl = el?.querySelector('.wbe-canvas-text');
        if (textEl) {
          textEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        }
      }, textId);
      await page.waitForTimeout(500);
    }
    
    // Step 6: Clear the text (select all and delete)
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    
    // Verify text is empty
    const isEmpty = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const textEl = el?.querySelector('.wbe-canvas-text');
      return textEl ? textEl.textContent.trim() === '' : false;
    }, textId);
    
    expect(isEmpty).toBe(true);
    
    // Step 7: Press Enter - should delete the text
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000); // Wait for deletion to complete
    
    // Step 8: Verify text element was deleted
    const finalTextCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    const textStillExists = await page.evaluate((id) => {
      return !!document.getElementById(id);
    }, textId);
    
    expect(finalTextCount).toBe(initialTextCount);
    expect(textStillExists).toBe(false);
    
    console.log('✓ Empty text deleted successfully when Enter was pressed');
  });
  
  test('Empty text should be deleted when clicking outside', async ({ page }) => {
    setupBrowserLogCapture(page);
    await setupTest(page);
    
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
    
    // Calculate visible screen position (center of board)
    const screenX = boardRect.left + boardRect.width / 2;
    const screenY = boardRect.top + boardRect.height / 2;
    
    // Get initial text count
    const initialTextCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    // Step 1: Press 'T' to enter text mode
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(1000);
    
    // Step 2: Click on the board to create a text element
    await page.locator('#board').click({ 
      position: { 
        x: screenX - boardRect.left, 
        y: screenY - boardRect.top 
      }, 
      force: true 
    });
    await page.waitForTimeout(1500);
    
    // Step 3: Verify text element was created
    const afterCreationCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    expect(afterCreationCount).toBe(initialTextCount + 1);
    
    // Step 4: Find the newly created text element
    const textId = await page.evaluate(() => {
      const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'));
      const newest = allTexts
        .map(el => {
          const textTime = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
          return { id: el.id, time: textTime };
        })
        .sort((a, b) => b.time - a.time)[0];
      return newest?.id || null;
    });
    
    expect(textId).not.toBeNull();
    console.log(`Created text element: ${textId}`);
    
    // Step 5: Wait for edit mode (may already be active or need to activate)
    await page.waitForTimeout(1000);
    
    // Check if already in edit mode, if not, try to activate it
    const isEditable = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const textEl = el?.querySelector('.wbe-canvas-text');
      return textEl ? textEl.contentEditable === 'true' : false;
    }, textId);
    
    if (!isEditable) {
      // Try clicking on the text element to enter edit mode
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        const textEl = el?.querySelector('.wbe-canvas-text');
        if (textEl) {
          textEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        }
      }, textId);
      await page.waitForTimeout(500);
    }
    
    // Step 6: Clear the text (select all and delete)
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    
    // Verify text is empty
    const isEmpty = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const textEl = el?.querySelector('.wbe-canvas-text');
      return textEl ? textEl.textContent.trim() === '' : false;
    }, textId);
    
    expect(isEmpty).toBe(true);
    
    // Step 7: Click outside the text element (on a different part of the board)
    const clickOutsideX = boardRect.left + boardRect.width / 2 + 200;
    const clickOutsideY = boardRect.top + boardRect.height / 2 + 200;
    await page.mouse.click(clickOutsideX, clickOutsideY);
    await page.waitForTimeout(2000); // Wait for deletion to complete
    
    // Step 8: Verify text element was deleted
    const finalTextCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    const textStillExists = await page.evaluate((id) => {
      return !!document.getElementById(id);
    }, textId);
    
    expect(finalTextCount).toBe(initialTextCount);
    expect(textStillExists).toBe(false);
    
    console.log('✓ Empty text deleted successfully when clicking outside');
  });
  
  test('Text with content should NOT be deleted', async ({ page }) => {
    setupBrowserLogCapture(page);
    await setupTest(page);
    
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
    
    // Calculate visible screen position (center of board)
    const screenX = boardRect.left + boardRect.width / 2;
    const screenY = boardRect.top + boardRect.height / 2;
    
    // Get initial text count
    const initialTextCount = await page.evaluate(() => {
      return document.querySelectorAll('[id^="wbe-text-"]').length;
    });
    
    // Step 1: Press 'T' to enter text mode
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(1000);
    
    // Step 2: Click on the board to create a text element
    await page.locator('#board').click({ 
      position: { 
        x: screenX - boardRect.left, 
        y: screenY - boardRect.top 
      }, 
      force: true 
    });
    await page.waitForTimeout(1500);
    
    // Step 3: Find the newly created text element
    const textId = await page.evaluate(() => {
      const allTexts = Array.from(document.querySelectorAll('[id^="wbe-text-"]'));
      const newest = allTexts
        .map(el => {
          const textTime = parseInt(el.id.match(/wbe-text-(\d+)/)?.[1] || 0);
          return { id: el.id, time: textTime };
        })
        .sort((a, b) => b.time - a.time)[0];
      return newest?.id || null;
    });
    
    expect(textId).not.toBeNull();
    
    // Step 4: Wait for edit mode (may already be active or need to activate)
    await page.waitForTimeout(1000);
    
    // Check if already in edit mode, if not, try to activate it
    const isEditable = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const textEl = el?.querySelector('.wbe-canvas-text');
      return textEl ? textEl.contentEditable === 'true' : false;
    }, textId);
    
    if (!isEditable) {
      // Try clicking on the text element to enter edit mode
      await page.evaluate((id) => {
        const el = document.getElementById(id);
        const textEl = el?.querySelector('.wbe-canvas-text');
        if (textEl) {
          textEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        }
      }, textId);
      await page.waitForTimeout(500);
    }
    
    // Step 5: Type some text
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.type('Test Text', { delay: 50 });
    await page.waitForTimeout(200);
    
    // Step 6: Press Enter - should NOT delete the text
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    
    // Step 7: Verify text element still exists
    const textStillExists = await page.evaluate((id) => {
      return !!document.getElementById(id);
    }, textId);
    
    const textContent = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const textEl = el?.querySelector('.wbe-canvas-text');
      return textEl ? textEl.textContent.trim() : '';
    }, textId);
    
    expect(textStillExists).toBe(true);
    expect(textContent).toBe('Test Text');
    
    console.log('✓ Text with content was NOT deleted (as expected)');
  });
});

