import { test, expect } from '@playwright/test';

/**
 * Investigation Test: Handler Registration
 * Проверяет, что обработчики драга, ресайза и z-index регистрируются и вызываются
 */

test.describe('Investigate: Handler Registration', () => {
  test.setTimeout(60000);
  
  test('Verify handlers are registered and called', async ({ page }) => {
    console.log('\n=== INVESTIGATION: Handler Registration Test ===');
    
    // Setup log capture
    const logs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[INVESTIGATE]')) {
        logs.push({ time: Date.now(), text });
      }
    });
    
    // Login as GM
    await page.goto('http://localhost:30000/join');
    await page.waitForTimeout(1000);
    
    // Wait for combobox to be ready and select option
    await page.waitForSelector('select[name="userid"]', { state: 'visible' });
    await page.waitForTimeout(500);
    
    // Get available user IDs
    const userIds = await page.evaluate(() => {
      const select = document.querySelector('select[name="userid"]');
      return Array.from(select.options).map(opt => opt.value).filter(v => v);
    });
    console.log(`  Available user IDs: ${userIds.join(', ')}`);
    
    // Use first available user (should be GM)
    const userId = userIds[0] || 'LoZGkWmu3xRB0sXZ';
    await page.selectOption('select[name="userid"]', userId);
    await page.waitForTimeout(500);
    
    await page.getByRole('button', { name: ' Join Game Session' }).click();
    await page.waitForTimeout(1000);
    
    // Close window if it appears
    try {
      await page.getByRole('button', { name: 'Close Window' }).click({ timeout: 2000 });
      await page.waitForTimeout(500);
    } catch (e) {
      // Window may not appear
    }
    
    await page.waitForSelector('#board', { timeout: 10000 });
    await page.waitForTimeout(2000);
    
    console.log('\n--- Step 1: Create text element ---');
    const textId = await page.evaluate(async () => {
      // Use global TextTools if available, otherwise try to access via window
      const TextTools = window.TextTools || (await import('/modules/whiteboard-experience/scripts/modules/whiteboard-text.mjs')).TextTools;
      const textId = `wbe-text-${Date.now()}`;
      const container = TextTools.createTextElement(
        textId,
        'Test Text',
        400,
        300,
        1,
        '#000000',
        'transparent',
        null,
        0,
        'normal',
        'normal',
        'left',
        'Arial',
        16,
        null
      );
      if (container) {
        const textEl = container.querySelector(".wbe-canvas-text");
        if (textEl) {
          await TextTools.persistTextState(textId, textEl, container);
        }
      }
      return textId;
    });
    
    console.log(`  Created text element: ${textId.slice(-6)}`);
    await page.waitForTimeout(1000);
    
    // Check if handlers were registered
    console.log('\n--- Step 2: Check handler registration logs ---');
    const registrationLogs = logs.filter(l => 
      l.text.includes('attachEventListeners') || 
      l.text.includes('attachHandlers')
    );
    console.log(`  Found ${registrationLogs.length} handler registration log(s):`);
    registrationLogs.forEach(log => console.log(`    ${log.text}`));
    
    // Try to drag
    console.log('\n--- Step 3: Attempt to drag text element ---');
    const textContainer = await page.locator(`#${textId}`);
    const beforeDragLogs = logs.length;
    
    // Get element position
    const elementRect = await textContainer.boundingBox();
    if (!elementRect) {
      throw new Error('Text element not found');
    }
    
    // Click and drag
    await textContainer.click({ position: { x: elementRect.width / 2, y: elementRect.height / 2 } });
    await page.waitForTimeout(100);
    await page.mouse.move(elementRect.x + elementRect.width / 2 + 50, elementRect.y + elementRect.height / 2 + 50);
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    // Check if drag handler was called
    const dragLogs = logs.slice(beforeDragLogs).filter(l => 
      l.text.includes('mousedown') || 
      l.text.includes('drag')
    );
    console.log(`  Found ${dragLogs.length} drag-related log(s) after drag attempt:`);
    dragLogs.forEach(log => console.log(`    ${log.text}`));
    
    // Try to resize
    console.log('\n--- Step 4: Attempt to resize text element ---');
    const resizeHandle = await page.locator(`#${textId} .wbe-text-resize-handle`);
    const resizeHandleVisible = await resizeHandle.isVisible().catch(() => false);
    console.log(`  Resize handle visible: ${resizeHandleVisible}`);
    
    if (resizeHandleVisible) {
      const beforeResizeLogs = logs.length;
      const handleRect = await resizeHandle.boundingBox();
      if (handleRect) {
        await resizeHandle.click({ position: { x: 5, y: 5 } });
        await page.waitForTimeout(100);
        await page.mouse.move(handleRect.x + 30, handleRect.y);
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(500);
        
        const resizeLogs = logs.slice(beforeResizeLogs).filter(l => 
          l.text.includes('resize')
        );
        console.log(`  Found ${resizeLogs.length} resize-related log(s) after resize attempt:`);
        resizeLogs.forEach(log => console.log(`    ${log.text}`));
      }
    }
    
    // Try to change z-index
    console.log('\n--- Step 5: Attempt to change z-index ---');
    const beforeZIndexLogs = logs.length;
    
    // Select element first
    await textContainer.click();
    await page.waitForTimeout(200);
    
    // Press [ key to move down
    await page.keyboard.press('[');
    await page.waitForTimeout(500);
    
    const zIndexLogs = logs.slice(beforeZIndexLogs).filter(l => 
      l.text.includes('handleKeyDown') || 
      l.text.includes('z-index') ||
      l.text.includes('moveDown')
    );
    console.log(`  Found ${zIndexLogs.length} z-index-related log(s) after keypress:`);
    zIndexLogs.forEach(log => console.log(`    ${log.text}`));
    
    // Summary
    console.log('\n=== INVESTIGATION RESULTS ===');
    console.log(`Total [INVESTIGATE] logs captured: ${logs.length}`);
    console.log(`Handler registrations: ${registrationLogs.length}`);
    console.log(`Drag attempts logged: ${dragLogs.length}`);
    console.log(`Resize attempts logged: ${resizeLogs ? resizeLogs.length : 0}`);
    console.log(`Z-index attempts logged: ${zIndexLogs.length}`);
    
    // Print all logs for analysis
    console.log('\n=== ALL INVESTIGATION LOGS ===');
    logs.forEach(log => {
      console.log(`[${new Date(log.time).toISOString()}] ${log.text}`);
    });
    
    // Cleanup
    await page.evaluate(async (id) => {
      const element = document.getElementById(id);
      if (element) element.remove();
      
      if (game?.user?.isGM && canvas?.scene) {
        const { TextTools } = await import('../scripts/modules/whiteboard-text.mjs');
        const texts = await TextTools.getAllTexts();
        delete texts[id];
        await TextTools.setAllTexts(texts);
      }
    }, textId);
  });
});

