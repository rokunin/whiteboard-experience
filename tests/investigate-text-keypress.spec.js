import { test, expect } from '@playwright/test';

/**
 * Investigate: Text keypress handlers for z-index changes
 * This test checks if keydown handlers are being called for text objects
 */

test.describe('Investigate: Text Keypress Handlers', () => {
  test.setTimeout(60000);
  
  test('Check if text keydown handlers are called', async ({ page }) => {
    // Setup: Login as GM
    await page.goto('http://localhost:30000/join');
    await page.selectOption('select[name="userid"]', 'GM_USER_ID');
    await page.getByRole('button', { name: ' Join Game Session' }).click();
    
    try {
      await page.getByRole('button', { name: 'Close Window' }).click({ timeout: 2000 });
    } catch (e) {
      // Window may not appear
    }
    
    await page.waitForSelector('#board', { state: 'visible' });
    
    // Capture console logs
    const logs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[INVESTIGATE]')) {
        logs.push({ time: Date.now(), text, type: msg.type() });
      }
    });
    
    // Create a text object
    console.log('Step 1: Creating text object...');
    const textId = await page.evaluate(async () => {
      const { TextTools } = window;
      if (!TextTools) throw new Error('TextTools not found');
      
      // Create text at center of board
      const textId = `wbe-text-${Date.now()}`;
      const container = TextTools.createTextElement(
        textId,
        'Test Text',
        0, 0, // Center of board
        1, // scale
        '#000000', // color
        '#ffffff', // bgColor
        null, // borderColor
        0, // borderWidth
        'normal', // fontWeight
        'normal', // fontStyle
        'left', // textAlign
        'Arial', // fontFamily
        16, // fontSize
        null // width
      );
      
      if (!container) throw new Error('Failed to create text');
      
      // Persist to database
      const textEl = container.querySelector('.wbe-canvas-text');
      if (textEl) {
        await TextTools.persistTextState(textId, textEl, container);
      }
      
      return textId;
    });
    
    console.log(`Created text: ${textId}`);
    await page.waitForTimeout(500);
    
    // Select the text
    console.log('Step 2: Selecting text...');
    const elementPos = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, textId);
    
    if (!elementPos) {
      throw new Error('Text element not found');
    }
    
    await page.mouse.click(elementPos.x, elementPos.y);
    await page.waitForTimeout(200);
    
    // Verify selection
    const isSelected = await page.evaluate((id) => {
      const TextTools = window.TextTools;
      return TextTools && TextTools.selectedTextId === id;
    }, textId);
    
    console.log(`Text selected: ${isSelected}`);
    
    if (!isSelected) {
      console.log('WARNING: Text not selected, trying again...');
      await page.mouse.click(elementPos.x, elementPos.y);
      await page.waitForTimeout(200);
    }
    
    // Press PageDown key
    console.log('Step 3: Pressing PageDown key...');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
    
    // Press PageUp key
    console.log('Step 4: Pressing PageUp key...');
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(300);
    
    // Analyze results
    console.log(`\n=== INVESTIGATION RESULTS ===`);
    console.log(`Captured ${logs.length} [INVESTIGATE] log entries`);
    
    if (logs.length === 0) {
      console.log('❌ NO LOGS FOUND - Handler may not be called!');
    } else {
      logs.forEach(log => {
        console.log(`  [${new Date(log.time).toISOString()}] ${log.text}`);
      });
    }
    
    // Check specific conditions
    const handlerCalled = logs.some(l => l.text.includes('Text keydown handler called'));
    const selectedTextIdSet = logs.some(l => l.text.includes('Text selected: Setting selectedTextId'));
    const processingKey = logs.some(l => l.text.includes('Processing [ or PageDown') || l.text.includes('Processing ] or PageUp'));
    
    console.log('\n=== HYPOTHESIS VERIFICATION ===');
    console.log(`${handlerCalled ? '✅' : '❌'} Handler was called`);
    console.log(`${selectedTextIdSet ? '✅' : '❌'} selectedTextId was set`);
    console.log(`${processingKey ? '✅' : '❌'} Key processing occurred`);
    
    // Cleanup
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
      if (window.ZIndexManager) window.ZIndexManager.remove(id);
    }, textId);
    
    // If handler was not called, this is a problem
    if (!handlerCalled) {
      throw new Error('Text keydown handler was not called - keypresses are not working!');
    }
  });
});

