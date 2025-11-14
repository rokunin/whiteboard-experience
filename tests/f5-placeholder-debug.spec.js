import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * F5 Placeholder Debug Test
 * Tests F5 reload with placeholder sizing:
 * 1. Paste image from clipboard (test-image.png)
 * 2. Wait for save
 * 3. Reload page (F5)
 * 4. Collect all placeholder/F5 logs
 */

test.describe('F5 Placeholder Debug Test', () => {
  test.setTimeout(180000); // 3 minutes timeout
  
  // Helper: Setup browser log capture
  function setupBrowserLogCapture(page) {
    const browserLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      browserLogs.push({ 
        type, 
        text,
        timestamp: Date.now()
      });
    });
    page['_browserLogs'] = browserLogs;
    return browserLogs;
  }
  
  // Helper: Filter logs for placeholder/F5 debugging
  function filterPlaceholderLogs(browserLogs) {
    const keywords = [
      'F5 LOAD',
      'PLACEHOLDER INIT',
      'PRELOAD',
      'SAVE STATE',
      'PERSIST SAVE'
    ];
    
    return browserLogs.filter(log => {
      return keywords.some(keyword => log.text.includes(keyword));
    });
  }
  
  test('F5 placeholder debug - paste image and reload', async ({ page }) => {
    const browserLogs = setupBrowserLogCapture(page);
    
    // Setup: Login as GM
    await page.goto('http://localhost:30000/join');
    await page.waitForTimeout(1000);
    
    await page.waitForSelector('select[name="userid"]', { state: 'visible' });
    await page.waitForTimeout(500);
    await page.selectOption('select[name="userid"]', 'LoZGkWmu3xRB0sXZ'); // GM user
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
    
    // Cleanup before test
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
    
    console.log('\n=== STEP 1: Loading test-image.png ===');
    
    // Load test-image.png
    const testImagePath = path.join(__dirname, 'test-image.png');
    const imageBuffer = fs.readFileSync(testImagePath);
    const imageBase64 = imageBuffer.toString('base64');
    
    console.log(`Loaded test-image.png: ${imageBuffer.length} bytes`);
    
    // Step 1: Paste image from clipboard
    console.log('\n=== STEP 2: Pasting image from clipboard ===');
    
    const imageId = await page.evaluate(async ({ imageBase64 }) => {
      const ImageTools = window.ImageTools;
      if (!ImageTools) {
        throw new Error('ImageTools not available');
      }
      
      // Convert base64 to File object
      const byteCharacters = atob(imageBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      const file = new File([blob], 'test-image.png', { type: 'image/png' });
      
      // Set mouse position to center of board
      const board = document.getElementById('board');
      if (!board) throw new Error('Board not found');
      const rect = board.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const screenToWorld = window.screenToWorld;
      const { setSharedVars } = window;
      
      if (setSharedVars && typeof setSharedVars === 'function') {
        setSharedVars({ lastMouseX: centerX, lastMouseY: centerY });
      } else if (window.lastMouseX !== undefined) {
        window.lastMouseX = centerX;
        window.lastMouseY = centerY;
      }
      
      // Paste image
      await ImageTools.handleImagePasteFromClipboard(file);
      
      // Wait for image to be created and saved
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get the newly created image ID
      const allImages = await ImageTools.getAllImages();
      const imageEntries = Object.entries(allImages);
      if (imageEntries.length === 0) {
        throw new Error('No images found after paste');
      }
      
      // Get the most recently created image
      const sorted = imageEntries.sort((a, b) => {
        const timeA = parseInt(a[0].match(/wbe-image-(\d+)/)?.[1] || 0);
        const timeB = parseInt(b[0].match(/wbe-image-(\d+)/)?.[1] || 0);
        return timeB - timeA;
      });
      
      const newestId = sorted[0][0];
      
      // Get image data to verify displayWidth/displayHeight
      const imageData = allImages[newestId];
      console.log('[TEST] Image created:', {
        id: newestId,
        displayWidth: imageData.displayWidth,
        displayHeight: imageData.displayHeight,
        scale: imageData.scale
      });
      
      return newestId;
    }, { imageBase64 });
    
    console.log(`Image created with ID: ${imageId}`);
    
    // Wait for save to complete
    await page.waitForTimeout(2000);
    
    // Get placeholder logs from paste
    const pasteLogs = filterPlaceholderLogs(browserLogs);
    console.log('\n=== PASTE LOGS ===');
    pasteLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text}`);
    });
    
    // Step 2: Reload page (F5)
    console.log('\n=== STEP 3: Reloading page (F5) ===');
    
    // Verify image is saved to DB before reload
    const imageDataBeforeReload = await page.evaluate(async ({ imageId }) => {
      const ImageTools = window.ImageTools;
      if (!ImageTools) return null;
      
      const allImages = await ImageTools.getAllImages();
      return allImages[imageId] || null;
    }, { imageId });
    
    console.log('\n=== IMAGE DATA FROM DB BEFORE RELOAD ===');
    console.log(JSON.stringify(imageDataBeforeReload, null, 2));
    
    // Clear logs before reload
    browserLogs.length = 0;
    
    // Reload page
    await page.reload({ waitUntil: 'networkidle' });
    
    // Re-setup console listener after reload (use same array)
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      browserLogs.push({ 
        type, 
        text,
        timestamp: Date.now()
      });
    });
    
    await page.waitForTimeout(5000); // Wait longer for module to load
    
    // Wait for whiteboard to be ready
    await page.waitForSelector('#board', { timeout: 10000 });
    await page.waitForTimeout(3000); // Wait longer for loadCanvasElements to complete
    
    // Check if loadCanvasElements was called
    const loadCanvasElementsCalled = await page.evaluate(() => {
      // Check if images were loaded
      const containers = document.querySelectorAll('.wbe-canvas-image-container');
      return containers.length > 0;
    });
    
    console.log(`Images found after reload: ${loadCanvasElementsCalled}`);
    
    // Wait a bit more for any async operations
    await page.waitForTimeout(2000);
    
    // Get F5 logs
    const f5Logs = filterPlaceholderLogs(browserLogs);
    console.log('\n=== F5 RELOAD LOGS ===');
    f5Logs.forEach(log => {
      console.log(`[${log.type}] ${log.text}`);
    });
    
    // Verify image still exists after reload
    const imageExistsAfterReload = await page.evaluate(({ imageId }) => {
      const container = document.getElementById(imageId);
      if (!container) return false;
      
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (!imageElement) return false;
      
      // Get computed dimensions
      const rect = imageElement.getBoundingClientRect();
      const transform = window.getComputedStyle(imageElement).transform;
      
      return {
        exists: true,
        width: rect.width,
        height: rect.height,
        transform,
        styleWidth: imageElement.style.width,
        styleHeight: imageElement.style.height,
        styleTransform: imageElement.style.transform
      };
    }, { imageId });
    
    console.log('\n=== IMAGE AFTER RELOAD ===');
    console.log(JSON.stringify(imageExistsAfterReload, null, 2));
    
    // Get image data from DB after reload
    const imageDataAfterReload = await page.evaluate(async ({ imageId }) => {
      const ImageTools = window.ImageTools;
      if (!ImageTools) return null;
      
      const allImages = await ImageTools.getAllImages();
      return allImages[imageId] || null;
    }, { imageId });
    
    console.log('\n=== IMAGE DATA FROM DB AFTER RELOAD ===');
    console.log(JSON.stringify(imageDataAfterReload, null, 2));
    
    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Paste logs: ${pasteLogs.length} entries`);
    console.log(`F5 logs: ${f5Logs.length} entries`);
    console.log(`Image exists after reload: ${imageExistsAfterReload?.exists || false}`);
    
    // Save logs to file for analysis
    const logsOutput = {
      pasteLogs: pasteLogs.map(l => ({ type: l.type, text: l.text })),
      f5Logs: f5Logs.map(l => ({ type: l.type, text: l.text })),
      imageAfterReload: imageExistsAfterReload,
      imageDataAfterReload
    };
    
    const logsPath = path.join(__dirname, 'f5-placeholder-debug-logs.json');
    fs.writeFileSync(logsPath, JSON.stringify(logsOutput, null, 2));
    console.log(`\nLogs saved to: ${logsPath}`);
    
    expect(imageExistsAfterReload?.exists).toBe(true);
  });
});

