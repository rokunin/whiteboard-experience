import { test, expect } from '@playwright/test';

/**
 * Quick Z-Index Images Test
 * Creates 3 images, then quickly changes their z-indexes
 * Logs all z-index changes, detects blinking, and captures browser logs
 */

test.describe('Quick Z-Index Images Test', () => {
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
  
  // Helper: Create 3 test images
  async function createThreeImages(page) {
    console.log('Creating 3 test images...');
    
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) {
      throw new Error('Board not found');
    }
    
    // Calculate positions for 3 images in a row
    const centerX = boardRect.left + boardRect.width / 2;
    const centerY = boardRect.top + boardRect.height / 2;
    const spacing = 120;
    
    const screenPositions = [
      { x: centerX - spacing, y: centerY },
      { x: centerX, y: centerY },
      { x: centerX + spacing, y: centerY }
    ];
    
    // Ensure layer exists before creating images
    try {
      await page.waitForSelector('#whiteboard-experience-layer', { timeout: 5000 });
    } catch (e) {
      // Layer doesn't exist, try to create it
      await page.evaluate(() => {
        if (window.getOrCreateLayer) {
          window.getOrCreateLayer();
        } else {
          console.warn('[TEST] getOrCreateLayer not available, layer may not exist');
        }
      });
      await page.waitForTimeout(200); // Small delay to ensure layer is ready
    }
    
    // Create images directly via browser
    const elementIds = await page.evaluate(async ({ screenPositions }) => {
      const ImageTools = window.ImageTools;
      if (!ImageTools) {
        throw new Error('ImageTools not available - module may not be loaded');
      }
      
      const screenToWorld = window.screenToWorld;
      
      // Create a simple test image data URI (100x100 colored squares)
      const colors = ['#ff0000', '#00ff00', '#0000ff']; // Red, Green, Blue
      const ids = [];
      const imageDataMap = {};
      const defaultCrop = { top: 0, right: 0, bottom: 0, left: 0 };
      
      for (let i = 0; i < 3; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = colors[i];
        ctx.fillRect(0, 0, 100, 100);
        const dataURI = canvas.toDataURL('image/png');
        
        const id = `wbe-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        // Convert screen coordinates to world coordinates
        let worldPos;
        if (screenToWorld && typeof screenToWorld === 'function') {
          worldPos = screenToWorld(screenPositions[i].x, screenPositions[i].y);
        } else if (window.canvas?.ready && window.canvas?.stage) {
          try {
            const transform = window.canvas.stage.worldTransform;
            const inverted = transform.clone().invert();
            const point = inverted.apply({ x: screenPositions[i].x, y: screenPositions[i].y });
            worldPos = { x: point.x, y: point.y };
          } catch (e) {
            worldPos = { x: screenPositions[i].x, y: screenPositions[i].y };
          }
        } else {
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
      
      // Save all images together
      if (Object.keys(imageDataMap).length > 0) {
        const existingImages = await ImageTools.getAllImages();
        const allImages = { ...existingImages, ...imageDataMap };
        await ImageTools.setAllImages(allImages);
      }
      
      return ids;
    }, { screenPositions });
    
    expect(elementIds.length).toBe(3);
    
    // Wait for images to be fully created and persisted
    await page.waitForTimeout(1500);
    
    // Verify containers exist
    const containersReady = await page.evaluate(({ elementIds }) => {
      const results = elementIds.map(id => {
        const el = document.getElementById(id);
        const inlineZ = el ? parseInt(el.style.zIndex) || 0 : -1;
        const computedZ = el ? parseInt(window.getComputedStyle(el).zIndex) || 0 : -1;
        return {
          id,
          exists: !!el,
          inlineZIndex: inlineZ,
          domZIndex: computedZ,
          managerZIndex: window.ZIndexManager?.get(id) || 0
        };
      });
      return results;
    }, { elementIds });
    
    console.log('Created images:');
    containersReady.forEach((result, idx) => {
      console.log(`  Image ${idx + 1} (${result.id.slice(-6)}): DOM(computed)=${result.domZIndex}, DOM(inline)=${result.inlineZIndex}, Manager=${result.managerZIndex}`);
    });
    
    return elementIds;
  }
  
  // Helper: Get current z-index state
  async function getZIndexState(page, elementIds) {
    return await page.evaluate(({ elementIds }) => {
      const state = {};
      for (const id of elementIds) {
        const el = document.getElementById(id);
        const inlineZ = el ? parseInt(el.style.zIndex) || 0 : -1;
        const computedZ = el ? parseInt(window.getComputedStyle(el).zIndex) || 0 : -1;
        state[id] = {
          domZIndex: computedZ,
          inlineZIndex: inlineZ,
          managerZIndex: window.ZIndexManager?.get(id) || 0,
          exists: !!el,
          visible: el ? el.offsetParent !== null : false,
          display: el ? window.getComputedStyle(el).display : 'none'
        };
      }
      return state;
    }, { elementIds });
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
  
  // Helper: Log z-index state
  function logZIndexState(state, elementIds, step = '') {
    console.log(`\n${step ? step + ' - ' : ''}Z-Index State:`);
    elementIds.forEach((id, idx) => {
      const s = state[id];
      console.log(`  Image ${idx + 1} (${id.slice(-6)}): DOM=${s.domZIndex}, Manager=${s.managerZIndex}, Visible=${s.visible || false}`);
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
  
  // Helper: Select and change z-index
  async function selectAndChangeZIndex(page, elementId, key, delay = 50) {
    // Verify element exists first
    await verifyElementExists(page, elementId);
    
    // Get element position and click
    const elementPos = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, elementId);
    
    if (!elementPos) {
      throw new Error(`Element ${elementId} not found`);
    }
    
    // Click to select
    await page.mouse.click(elementPos.x, elementPos.y);
    await page.waitForTimeout(100); // Reduced from 300
    
    // Verify selection
    const isSelected = await page.evaluate((id) => {
      const ImageTools = window.ImageTools;
      return (ImageTools && ImageTools.selectedImageId === id);
    }, elementId);
    
    if (!isSelected) {
      // Try clicking again
      await page.mouse.click(elementPos.x, elementPos.y);
      await page.waitForTimeout(50); // Reduced from 500
    }
    
    // Press key to change z-index
    await page.keyboard.press(key);
    // Reduced wait time - debounce handles batching
    await page.waitForTimeout(Math.max(delay, 50)); // Reduced from 300 minimum
    
    // Reduced additional wait for compaction
    await page.waitForTimeout(50); // Reduced from 200
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
      
      try {
        await selectAndChangeZIndex(page, elementId, change.key, 200); // Reduced from 400
        successCount++;
      } catch (error) {
        console.error(`    ❌ Error during change ${changeNum} (${change.desc}): ${error.message}`);
        // Wait a bit and check if element still exists
        await page.waitForTimeout(200); // Reduced from 500
        const stillExists = await page.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!stillExists) {
          console.error(`    ❌ Element ${elementId.slice(-6)} disappeared after error`);
          break;
        }
        continue;
      }
      
      const afterState = await getZIndexState(page, [elementId]);
      const afterZ = afterState[elementId]?.managerZIndex || 0;
      const changed = beforeZ !== afterZ;
      
      console.log(`    ${changeNum}. ${change.desc}: ${beforeZ} → ${afterZ} ${changed ? '✓' : '✗'}`);
    }
    
    console.log(`    Completed: ${successCount}/${changeCount} changes successful`);
  }

  test('Quick z-index changes on 3 images', async ({ page }) => {
    const browserLogs = setupBrowserLogCapture(page);
    
    console.log('\n=== QUICK Z-INDEX TEST (Images Only) ===');
    
    // Setup: login, clean, create objects
    await setupTest(page);
    const imageIds = await createThreeImages(page);
    
    // Get initial state
    const initialState = await getZIndexState(page, imageIds);
    logZIndexState(initialState, imageIds, 'Initial Images');
    
    let previousStates = initialState;
    const allBlinkingEvents = [];
    
    // Perform 2 runs
    for (let run = 1; run <= 2; run++) {
      console.log(`\n=== RUN ${run} ===`);
      
      // Process images
      for (let imgIndex = 0; imgIndex < imageIds.length; imgIndex++) {
        const elementId = imageIds[imgIndex];
        
        // Verify element still exists before processing
        const exists = await page.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!exists) {
          console.warn(`\n⚠️  Warning: Image ${imgIndex + 1} (${elementId.slice(-6)}) no longer exists, skipping`);
          continue;
        }
        
        // Generate random number of changes (5-8)
        const changeCount = randomInt(5, 8);
        console.log(`\n--- Processing Image ${imgIndex + 1} ---`);
        
        await makeRandomZIndexChanges(page, elementId, imgIndex, changeCount);
        
        // Check for blinking after changes
        const { blinking, currentStates } = await checkForBlinking(page, imageIds, previousStates);
        if (blinking.length > 0) {
          allBlinkingEvents.push(...blinking);
          console.warn(`  ⚠️  BLINKING DETECTED: ${blinking.length} visibility/z-index issues`);
          blinking.forEach(b => {
            if (b.type === 'zindex_mismatch') {
              console.error(`    ❌ Z-Index Mismatch: ${b.id.slice(-6)} DOM=${b.domZIndex} Manager=${b.managerZIndex}`);
            } else {
              console.error(`    ❌ Visibility Change: ${b.id.slice(-6)} ${b.wasVisible ? 'visible' : 'hidden'} → ${b.isVisible ? 'visible' : 'hidden'}`);
            }
          });
        }
        previousStates = currentStates;
        
        // Small delay between images
        await page.waitForTimeout(200); // Reduced from 500
      }
      
      // Log state after each run
      const runState = await getZIndexState(page, imageIds);
      logZIndexState(runState, imageIds, `After Run ${run}`);
    }
    
    // Final state
    const finalState = await getZIndexState(page, imageIds);
    logZIndexState(finalState, imageIds, 'Final Images');
    
    // Analyze logs to find culprit
    const analysis = analyzeLogsForCulprit(browserLogs, imageIds);
    
    // Analyze duplicate z-index patterns
    const duplicateAnalysis = analyzeDuplicateZIndexPatterns(browserLogs, imageIds, finalState);
    
    // Report blinking summary
    if (allBlinkingEvents.length > 0) {
      console.error(`\n🚨 BLINKING SUMMARY: ${allBlinkingEvents.length} total blinking events detected`);
      const visibilityChanges = allBlinkingEvents.filter(b => !b.type);
      const zIndexMismatches = allBlinkingEvents.filter(b => b.type === 'zindex_mismatch');
      console.error(`  Visibility changes: ${visibilityChanges.length}`);
      console.error(`  Z-Index mismatches: ${zIndexMismatches.length}`);
      zIndexMismatches.forEach(b => {
        console.error(`❌ Image ${b.id.slice(-6)} Z-Index Mismatch: DOM=${b.domZIndex} Manager=${b.managerZIndex}`);
      });
    } else {
      console.log('\n✅ No blinking detected');
    }
    
    // Report browser logs
    console.log('\n=== BROWSER CONSOLE LOGS (Relevant) ===');
    const relevantLogs = browserLogs.filter(log => 
      log.text.includes('[Z-Index]') ||
      log.text.includes('[WB-E] setAllImages') ||
      log.text.includes('[WB-E] getAllImages') ||
      log.text.includes('[CompactZIndexManager]') ||
      log.text.includes('🚨') ||
      log.text.includes('⚠️') ||
      log.text.includes('z-index') ||
      log.text.includes('zIndex') ||
      log.type === 'error'
    );
    
    if (relevantLogs.length > 0) {
      relevantLogs.forEach(log => {
        const time = new Date(log.timestamp).toISOString().split('T')[1].slice(0, -1);
        console.log(`[${time}] [${log.type.toUpperCase()}] ${log.text}`);
      });
    } else {
      console.log('No relevant z-index logs found');
    }
    
    console.log(`\nTotal browser logs captured: ${browserLogs.length}`);
    console.log(`Relevant logs: ${relevantLogs.length}`);
    
    // Verify all objects still exist (check both DOM and manager)
    for (const id of imageIds) {
      const exists = await page.evaluate((id) => {
        return !!document.getElementById(id);
      }, id);
      
      if (!exists) {
        console.error(`❌ Image ${id.slice(-6)} no longer exists in DOM`);
      } else {
        expect(finalState[id].managerZIndex).toBeGreaterThan(0);
        // Check for z-index mismatch
        if (finalState[id].domZIndex !== finalState[id].managerZIndex && finalState[id].domZIndex > 0) {
          console.error(`❌ Image ${id.slice(-6)} Z-Index Mismatch: DOM=${finalState[id].domZIndex} Manager=${finalState[id].managerZIndex}`);
        }
      }
    }
    
    console.log('\n=== TEST COMPLETE ===');
  });
});


