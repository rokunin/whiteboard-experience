import { test, expect } from '@playwright/test';

/**
 * Quick Z-Index Texts Test
 * Creates 3 texts, then quickly changes their z-indexes
 * Logs all z-index changes, detects blinking, and captures browser logs
 */

test.describe('Quick Z-Index Texts Test', () => {
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
      
      // Track getAllTexts calls
      if (text.includes('getAllTexts() returned')) {
        const match = text.match(/returned (\d+) texts/);
        const count = match ? parseInt(match[1]) : 0;
        const idsMatch = text.match(/texts: (\[.*?\])/);
        let ids = [];
        if (idsMatch) {
          try {
            ids = JSON.parse(idsMatch[1]);
          } catch (e) {
            // Try to extract IDs manually if JSON parse fails
            const idPattern = /wbe-text-[^\s,\]]+/g;
            const matches = text.match(idPattern);
            if (matches) ids = matches;
          }
        }
        events.push({
          type: 'getAllTexts',
          timestamp: eventTimestamp,
          count,
          ids,
          log: text
        });
      }
      
      // Track setAllTexts calls
      if (text.includes('setAllTexts:')) {
        const match = text.match(/Sending (\d+) texts/);
        const count = match ? parseInt(match[1]) : 0;
        const idsMatch = text.match(/texts: (\[.*?\])/);
        let ids = [];
        if (idsMatch) {
          try {
            ids = JSON.parse(idsMatch[1]);
          } catch (e) {
            // Try to extract IDs manually if JSON parse fails
            const idPattern = /wbe-text-[^\s,\]]+/g;
            const matches = text.match(idPattern);
            if (matches) ids = matches;
          }
        }
        events.push({
          type: 'setAllTexts',
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
            const idPattern = /wbe-text-[^\s,\]]+/g;
            const matches = text.match(idPattern);
            if (matches) removedIds = matches;
          }
        } else {
          // Single element removal
          const singleMatch = text.match(/element: (wbe-text-[^\s]+)/);
          if (singleMatch) removedIds = [singleMatch[1]];
        }
        events.push({
          type: 'REMOVAL',
          timestamp: eventTimestamp,
          removedIds,
          log: text
        });
      }
      
      // Track missing texts warnings
      if (text.includes('NOT in getAllTexts()') || text.includes('NOT in current state')) {
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
    let lastGetAllTexts = null;
    let lastSetAllTexts = null;
    
    for (const event of events) {
      if (event.type === 'getAllTexts') {
        lastGetAllTexts = event;
        console.log(`[${event.timestamp}] getAllTexts() returned ${event.count} texts`);
        if (event.count < 3) {
          console.error(`  ⚠️ PROBLEM: Only ${event.count} texts returned (expected 3)!`);
        }
      } else if (event.type === 'setAllTexts') {
        lastSetAllTexts = event;
        console.log(`[${event.timestamp}] setAllTexts() called with ${event.count} texts`);
        if (lastGetAllTexts && event.count < lastGetAllTexts.count) {
          console.error(`  ⚠️ PROBLEM: setAllTexts received ${event.count} texts but getAllTexts returned ${lastGetAllTexts.count}!`);
        }
      } else if (event.type === 'REMOVAL') {
        console.error(`[${event.timestamp}] 🚨 REMOVAL DETECTED:`, event.removedIds);
        if (lastSetAllTexts) {
          console.error(`  ⚠️ CULPRIT: setAllTexts() was called ${event.timestamp - lastSetAllTexts.timestamp}ms before removal`);
          console.error(`  ⚠️ setAllTexts had ${lastSetAllTexts.count} texts, but ${event.removedIds.length} were removed`);
          console.error(`  ⚠️ Missing IDs:`, event.removedIds.filter(id => !lastSetAllTexts.ids.includes(id)));
        }
        if (lastGetAllTexts) {
          console.error(`  ⚠️ getAllTexts() returned ${lastGetAllTexts.count} texts ${event.timestamp - lastGetAllTexts.timestamp}ms before removal`);
        }
      } else if (event.type === 'MISSING_WARNING') {
        console.warn(`[${event.timestamp}] ⚠️ WARNING:`, event.log);
      }
    }
    
    // Summary
    const removals = events.filter(e => e.type === 'REMOVAL');
    const getAllTextsEvents = events.filter(e => e.type === 'getAllTexts');
    const setAllTextsEvents = events.filter(e => e.type === 'setAllTexts');
    
    console.log('\n--- Summary ---');
    console.log(`Total getAllTexts() calls: ${getAllTextsEvents.length}`);
    console.log(`Total setAllTexts() calls: ${setAllTextsEvents.length}`);
    console.log(`Total REMOVAL events: ${removals.length}`);
    
    if (removals.length > 0) {
      console.error('\n🚨 CULPRIT IDENTIFIED:');
      removals.forEach((removal, idx) => {
        console.error(`\nRemoval #${idx + 1}:`);
        console.error(`  Removed IDs:`, removal.removedIds);
        console.error(`  Full log:`, removal.log);
        
        // Find the setAllTexts call that likely caused this
        const precedingSetAllTexts = setAllTextsEvents
          .filter(e => e.timestamp < removal.timestamp)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        
        if (precedingSetAllTexts) {
          console.error(`  Likely caused by setAllTexts() at ${precedingSetAllTexts.timestamp}`);
          console.error(`  That call had ${precedingSetAllTexts.count} texts:`, precedingSetAllTexts.ids);
        }
      });
    }
    
    return { events, removals, getAllTextsEvents, setAllTextsEvents };
  }
  
  // Helper: Login and setup for a specific user
  async function setupTestForUser(page, userId, userName) {
    await page.goto('http://localhost:30000/join');
    await page.waitForTimeout(1000);
    
    // Wait for combobox to be ready and select option
    await page.waitForSelector('select[name="userid"]', { state: 'visible' });
    await page.waitForTimeout(500);
    await page.selectOption('select[name="userid"]', userId);
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
    
    console.log(`[${userName}] Setup complete`);
  }
  
  // Helper: Cleanup (only GM should do cleanup)
  async function cleanupTest(page, userName) {
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
    console.log(`[${userName}] Cleanup complete`);
  }
  
  // Helper: Create 3 test texts
  async function createThreeTexts(page) {
    console.log('Creating 3 test texts...');
    
    const boardRect = await page.evaluate(() => {
      const board = document.getElementById('board');
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    
    if (!boardRect) {
      throw new Error('Board not found');
    }
    
    // Calculate positions for 3 texts in a row
    const centerX = boardRect.left + boardRect.width / 2;
    const centerY = boardRect.top + boardRect.height / 2;
    const spacing = 120;
    
    const screenPositions = [
      { x: centerX - spacing, y: centerY },
      { x: centerX, y: centerY },
      { x: centerX + spacing, y: centerY }
    ];
    
    // Ensure layer exists before creating texts
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
    
    // Create texts directly via browser
    const elementIds = await page.evaluate(async ({ screenPositions }) => {
      const TextTools = window.TextTools;
      if (!TextTools) {
        throw new Error('TextTools not available - module may not be loaded');
      }
      
      const screenToWorld = window.screenToWorld;
      const texts = ['Text 1', 'Text 2', 'Text 3'];
      const ids = [];
      const textDataMap = {};
      
      for (let i = 0; i < 3; i++) {
        const id = `wbe-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
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
        
        // Create text element at world coordinates
        const container = TextTools.createTextElement(
          id,
          texts[i],
          worldPos.x,
          worldPos.y,
          1, // scale
          '#000000', // color
          '#ffffff', // backgroundColor
          null, // borderColor
          0, // borderWidth
          'normal', // fontWeight
          'normal', // fontStyle
          'left', // textAlign
          'Arial', // fontFamily
          16, // fontSize
          null, // width
          null // existingZIndex - let it assign
        );
        
        if (container) {
          const textElement = container.querySelector('.wbe-canvas-text');
          if (textElement) {
            textDataMap[id] = {
              text: texts[i],
              left: worldPos.x,
              top: worldPos.y,
              scale: 1,
              color: '#000000',
              backgroundColor: '#ffffff',
              borderWidth: 0,
              fontWeight: 'normal',
              fontStyle: 'normal',
              textAlign: 'left',
              fontFamily: 'Arial',
              fontSize: 16,
              zIndex: window.ZIndexManager?.get(id) || null
            };
          }
        }
        
        ids.push(id);
        await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between creates
      }
      
      // Save all texts together
      if (Object.keys(textDataMap).length > 0) {
        const existingTexts = await TextTools.getAllTexts();
        const allTexts = { ...existingTexts, ...textDataMap };
        await TextTools.setAllTexts(allTexts);
      }
      
      return ids;
    }, { screenPositions });
    
    expect(elementIds.length).toBe(3);
    
    // Wait for texts to be fully created and persisted
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
    
    console.log('Created texts:');
    containersReady.forEach((result, idx) => {
      console.log(`  Text ${idx + 1} (${result.id.slice(-6)}): DOM(computed)=${result.domZIndex}, DOM(inline)=${result.inlineZIndex}, Manager=${result.managerZIndex}`);
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
      
      // Track TEXT z-index changes
      if (text.includes('[Z-Index] TEXT')) {
        const idMatch = text.match(/ID: (wbe-text-[^\s|]+)/);
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
      console.log(`  Text ${idx + 1} (${id.slice(-6)}): DOM=${s.domZIndex}, Manager=${s.managerZIndex}, Visible=${s.visible || false}`);
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
      const TextTools = window.TextTools;
      return (TextTools && TextTools.selectedTextId === id);
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
  
  // Helper: Make random z-index changes on a text
  async function makeRandomZIndexChanges(page, elementId, textIndex, changeCount) {
    const changes = [];
    const keys = ['PageUp', 'PageDown'];
    
    for (let i = 0; i < changeCount; i++) {
      // Randomly choose PageUp or PageDown
      const key = keys[Math.floor(Math.random() * keys.length)];
      changes.push({ key, desc: key === 'PageUp' ? 'Up' : 'Down' });
    }
    
    console.log(`\n  Text ${textIndex + 1} (${elementId.slice(-6)}): Making ${changeCount} random changes`);
    
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

  test('Quick z-index changes on 3 texts', async ({ browser }) => {
    console.log('\n=== QUICK Z-INDEX TEST (Texts Only) - GM + Player ===');
    
    // Create two browser contexts: one for GM, one for Player
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    
    // Setup browser log capture for both pages
    const gmBrowserLogs = setupBrowserLogCapture(gmPage);
    const playerBrowserLogs = setupBrowserLogCapture(playerPage);
    
    // Setup GM first (needs to be ready to receive updates)
    console.log('\n--- Setting up GM ---');
    await setupTestForUser(gmPage, 'Usmr9pveCkiz8dgE', 'GM');
    await cleanupTest(gmPage, 'GM');
    
    // Setup Player
    console.log('\n--- Setting up Player ---');
    await setupTestForUser(playerPage, 'LoZGkWmu3xRB0sXZ', 'Player');
    
    // Wait a bit for both to be ready
    await Promise.all([
      gmPage.waitForTimeout(1000),
      playerPage.waitForTimeout(1000)
    ]);
    
    // Create texts from Player side
    console.log('\n--- Creating texts from Player ---');
    const textIds = await createThreeTexts(playerPage);
    
    // Wait for texts to sync to GM
    console.log('\n--- Waiting for texts to sync to GM ---');
    await gmPage.waitForTimeout(2000);
    
    // Verify texts exist on both sides
    const playerTextsExist = await playerPage.evaluate(({ textIds }) => {
      return textIds.map(id => !!document.getElementById(id));
    }, { textIds });
    const gmTextsExist = await gmPage.evaluate(({ textIds }) => {
      return textIds.map(id => !!document.getElementById(id));
    }, { textIds });
    
    console.log(`Player texts exist: ${playerTextsExist.filter(Boolean).length}/${textIds.length}`);
    console.log(`GM texts exist: ${gmTextsExist.filter(Boolean).length}/${textIds.length}`);
    
    // Get initial state from both sides
    const playerInitialState = await getZIndexState(playerPage, textIds);
    const gmInitialState = await getZIndexState(gmPage, textIds);
    
    logZIndexState(playerInitialState, textIds, 'Initial Texts (Player)');
    logZIndexState(gmInitialState, textIds, 'Initial Texts (GM)');
    
    // Check for sync issues
    const syncIssues = [];
    for (const id of textIds) {
      const playerZ = playerInitialState[id]?.managerZIndex || 0;
      const gmZ = gmInitialState[id]?.managerZIndex || 0;
      if (playerZ !== gmZ && playerZ > 0 && gmZ > 0) {
        syncIssues.push({ id, playerZ, gmZ });
        console.error(`⚠️  Sync issue: ${id.slice(-6)} Player=${playerZ} GM=${gmZ}`);
      }
    }
    
    let playerPreviousStates = playerInitialState;
    let gmPreviousStates = gmInitialState;
    const allBlinkingEvents = [];
    
    // Perform 2 runs
    for (let run = 1; run <= 2; run++) {
      console.log(`\n=== RUN ${run} ===`);
      
      // Process texts from Player side
      for (let txtIndex = 0; txtIndex < textIds.length; txtIndex++) {
        const elementId = textIds[txtIndex];
        
        // Verify element still exists before processing
        const playerExists = await playerPage.evaluate((id) => {
          return !!document.getElementById(id);
        }, elementId);
        
        if (!playerExists) {
          console.warn(`\n⚠️  Warning: Text ${txtIndex + 1} (${elementId.slice(-6)}) no longer exists on Player, skipping`);
          continue;
        }
        
        // Generate random number of changes (5-8)
        const changeCount = randomInt(5, 8);
        console.log(`\n--- Processing Text ${txtIndex + 1} (from Player) ---`);
        
        await makeRandomZIndexChanges(playerPage, elementId, txtIndex, changeCount);
        
        // Wait for sync to GM
        await gmPage.waitForTimeout(500);
        
        // Check for blinking after changes (both sides)
        const { blinking: playerBlinking, currentStates: playerCurrentStates } = await checkForBlinking(playerPage, textIds, playerPreviousStates);
        const { blinking: gmBlinking, currentStates: gmCurrentStates } = await checkForBlinking(gmPage, textIds, gmPreviousStates);
        
        if (playerBlinking.length > 0 || gmBlinking.length > 0) {
          allBlinkingEvents.push(...playerBlinking, ...gmBlinking);
          console.warn(`  ⚠️  BLINKING DETECTED: Player=${playerBlinking.length}, GM=${gmBlinking.length}`);
          playerBlinking.forEach(b => {
            if (b.type === 'zindex_mismatch') {
              console.error(`    ❌ Player Z-Index Mismatch: ${b.id.slice(-6)} DOM=${b.domZIndex} Manager=${b.managerZIndex}`);
            }
          });
          gmBlinking.forEach(b => {
            if (b.type === 'zindex_mismatch') {
              console.error(`    ❌ GM Z-Index Mismatch: ${b.id.slice(-6)} DOM=${b.domZIndex} Manager=${b.managerZIndex}`);
            }
          });
        }
        
        // Check sync between Player and GM
        const playerState = await getZIndexState(playerPage, [elementId]);
        const gmState = await getZIndexState(gmPage, [elementId]);
        const playerZ = playerState[elementId]?.managerZIndex || 0;
        const gmZ = gmState[elementId]?.managerZIndex || 0;
        if (playerZ !== gmZ && playerZ > 0 && gmZ > 0) {
          console.error(`    ⚠️  Sync issue after change: ${elementId.slice(-6)} Player=${playerZ} GM=${gmZ}`);
        }
        
        playerPreviousStates = playerCurrentStates;
        gmPreviousStates = gmCurrentStates;
        
        // Small delay between texts
        await Promise.all([
          playerPage.waitForTimeout(200),
          gmPage.waitForTimeout(200)
        ]);
      }
      
      // Log state after each run
      const playerRunState = await getZIndexState(playerPage, textIds);
      const gmRunState = await getZIndexState(gmPage, textIds);
      logZIndexState(playerRunState, textIds, `After Run ${run} (Player)`);
      logZIndexState(gmRunState, textIds, `After Run ${run} (GM)`);
    }
    
    // Final state
    const playerFinalState = await getZIndexState(playerPage, textIds);
    const gmFinalState = await getZIndexState(gmPage, textIds);
    logZIndexState(playerFinalState, textIds, 'Final Texts (Player)');
    logZIndexState(gmFinalState, textIds, 'Final Texts (GM)');
    
    // Check final sync
    console.log('\n=== Final Sync Check ===');
    const finalSyncIssues = [];
    for (const id of textIds) {
      const playerZ = playerFinalState[id]?.managerZIndex || 0;
      const gmZ = gmFinalState[id]?.managerZIndex || 0;
      if (playerZ !== gmZ && playerZ > 0 && gmZ > 0) {
        finalSyncIssues.push({ id, playerZ, gmZ });
        console.error(`❌ Final sync issue: ${id.slice(-6)} Player=${playerZ} GM=${gmZ}`);
      }
    }
    if (finalSyncIssues.length === 0) {
      console.log('✅ All texts are in sync between Player and GM');
    }
    
    // Analyze logs to find culprit (combine both)
    const allBrowserLogs = [...playerBrowserLogs, ...gmBrowserLogs];
    const analysis = analyzeLogsForCulprit(allBrowserLogs, textIds);
    
    // Analyze duplicate z-index patterns
    const duplicateAnalysis = analyzeDuplicateZIndexPatterns(allBrowserLogs, textIds, playerFinalState);
    
    // Report blinking summary
    if (allBlinkingEvents.length > 0) {
      console.error(`\n🚨 BLINKING SUMMARY: ${allBlinkingEvents.length} total blinking events detected`);
      const visibilityChanges = allBlinkingEvents.filter(b => !b.type);
      const zIndexMismatches = allBlinkingEvents.filter(b => b.type === 'zindex_mismatch');
      console.error(`  Visibility changes: ${visibilityChanges.length}`);
      console.error(`  Z-Index mismatches: ${zIndexMismatches.length}`);
      zIndexMismatches.forEach(b => {
        console.error(`❌ Text ${b.id.slice(-6)} Z-Index Mismatch: DOM=${b.domZIndex} Manager=${b.managerZIndex}`);
      });
    } else {
      console.log('\n✅ No blinking detected');
    }
    
    // Report browser logs
    console.log('\n=== BROWSER CONSOLE LOGS (Relevant) ===');
    const playerRelevantLogs = playerBrowserLogs.filter(log => 
      log.text.includes('[Z-Index]') ||
      log.text.includes('[WB-E] setAllTexts') ||
      log.text.includes('[WB-E] getAllTexts') ||
      log.text.includes('[WB-E] GM received textUpdateRequest') ||
      log.text.includes('[WB-E] GM processing textUpdateRequest') ||
      log.text.includes('[CompactZIndexManager]') ||
      log.text.includes('🚨') ||
      log.text.includes('⚠️') ||
      log.text.includes('z-index') ||
      log.text.includes('zIndex') ||
      log.type === 'error'
    );
    const gmRelevantLogs = gmBrowserLogs.filter(log => 
      log.text.includes('[Z-Index]') ||
      log.text.includes('[WB-E] setAllTexts') ||
      log.text.includes('[WB-E] getAllTexts') ||
      log.text.includes('[WB-E] GM received textUpdateRequest') ||
      log.text.includes('[WB-E] GM processing textUpdateRequest') ||
      log.text.includes('[CompactZIndexManager]') ||
      log.text.includes('🚨') ||
      log.text.includes('⚠️') ||
      log.text.includes('z-index') ||
      log.text.includes('zIndex') ||
      log.type === 'error'
    );
    
    console.log(`\n--- Player Logs (${playerRelevantLogs.length} relevant) ---`);
    if (playerRelevantLogs.length > 0) {
      playerRelevantLogs.slice(0, 20).forEach(log => {
        const time = new Date(log.timestamp).toISOString().split('T')[1].slice(0, -1);
        console.log(`[${time}] [PLAYER] [${log.type.toUpperCase()}] ${log.text}`);
      });
    }
    
    console.log(`\n--- GM Logs (${gmRelevantLogs.length} relevant) ---`);
    if (gmRelevantLogs.length > 0) {
      gmRelevantLogs.slice(0, 20).forEach(log => {
        const time = new Date(log.timestamp).toISOString().split('T')[1].slice(0, -1);
        console.log(`[${time}] [GM] [${log.type.toUpperCase()}] ${log.text}`);
      });
    }
    
    console.log(`\nTotal browser logs captured: Player=${playerBrowserLogs.length}, GM=${gmBrowserLogs.length}`);
    console.log(`Relevant logs: Player=${playerRelevantLogs.length}, GM=${gmRelevantLogs.length}`);
    
    // Verify all objects still exist (check both DOM and manager on both sides)
    console.log('\n=== Final Verification ===');
    for (const id of textIds) {
      const playerExists = await playerPage.evaluate((id) => {
        return !!document.getElementById(id);
      }, id);
      const gmExists = await gmPage.evaluate((id) => {
        return !!document.getElementById(id);
      }, id);
      
      if (!playerExists) {
        console.error(`❌ Text ${id.slice(-6)} no longer exists in Player DOM`);
      }
      if (!gmExists) {
        console.error(`❌ Text ${id.slice(-6)} no longer exists in GM DOM`);
      }
      
      if (playerExists) {
        expect(playerFinalState[id].managerZIndex).toBeGreaterThan(0);
        // Check for z-index mismatch
        if (playerFinalState[id].domZIndex !== playerFinalState[id].managerZIndex && playerFinalState[id].domZIndex > 0) {
          console.error(`❌ Player Text ${id.slice(-6)} Z-Index Mismatch: DOM=${playerFinalState[id].domZIndex} Manager=${playerFinalState[id].managerZIndex}`);
        }
      }
      
      if (gmExists) {
        expect(gmFinalState[id].managerZIndex).toBeGreaterThan(0);
        // Check for z-index mismatch
        if (gmFinalState[id].domZIndex !== gmFinalState[id].managerZIndex && gmFinalState[id].domZIndex > 0) {
          console.error(`❌ GM Text ${id.slice(-6)} Z-Index Mismatch: DOM=${gmFinalState[id].domZIndex} Manager=${gmFinalState[id].managerZIndex}`);
        }
      }
    }
    
    // Close contexts
    await Promise.all([
      gmContext.close(),
      playerContext.close()
    ]);
    
    console.log('\n=== TEST COMPLETE ===');
  });
});

