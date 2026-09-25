/**
 * WBE Snapshot - Debug state capture system
 * 
 * Captures a complete snapshot of the whiteboard state:
 * - All objects from ObjectRegistry (full toJSON)
 * - Raw database flags from Foundry scene
 * - InteractionManager state (selection, drag, edit, pan, resize)
 * - Undo/Redo stacks (full command data)
 * - DOM element state with computed styles
 * - SVG path analysis for connectors (bezier visibility detection)
 * - Registry vs DB vs DOM diff (auto-detected desync)
 * - Invisible path detection (connectors with broken rendering)
 * - WBE module settings
 * - Socket/connection state
 * - Console errors/warnings (intercepted since module load)
 * - Recent WbeLogger entries
 * 
 * Usage: Press the camera button on WBE toolbar to download a JSON snapshot.
 */

import { WbeLogger } from './wbe-logger.mjs';

const MODULE_ID = 'whiteboard-experience';
const LAYER_ID = 'whiteboard-experience-layer';

// =============================================
// Console error/warn interceptor
// Captures all console.error and console.warn calls since module load.
// Original console methods are preserved and still called normally.
// =============================================

const MAX_CONSOLE_ENTRIES = 200;
const _capturedConsole = [];

const _originalError = console.error;
const _originalWarn = console.warn;

console.error = function (...args) {
  _capturedConsole.push({
    level: 'error',
    timestamp: Date.now(),
    isoTime: new Date().toISOString(),
    message: args.map(a => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
      if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
      return String(a);
    }).join(' ')
  });
  if (_capturedConsole.length > MAX_CONSOLE_ENTRIES) _capturedConsole.shift();
  _originalError.apply(console, args);
};

console.warn = function (...args) {
  _capturedConsole.push({
    level: 'warn',
    timestamp: Date.now(),
    isoTime: new Date().toISOString(),
    message: args.map(a => {
      if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
      return String(a);
    }).join(' ')
  });
  if (_capturedConsole.length > MAX_CONSOLE_ENTRIES) _capturedConsole.shift();
  _originalWarn.apply(console, args);
};

/**
 * Safe deep clone via JSON (handles circular refs gracefully)
 * @param {*} obj - Object to clone
 * @param {string} [label] - Label for error context
 * @returns {*} Cloned object or error placeholder
 */
function safeClone(obj, label = 'unknown') {
  if (obj === null || obj === undefined) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return { _cloneError: `Failed to clone "${label}": ${e.message}` };
  }
}

/**
 * Collect meta information about the environment
 * @returns {Object}
 */
function captureMeta() {
  const scene = canvas?.scene;
  return {
    timestamp: new Date().toISOString(),
    unixTime: Date.now(),
    moduleVersion: game?.modules?.get(MODULE_ID)?.version || 'unknown',
    foundryVersion: game?.version || game?.data?.version || 'unknown',
    system: game?.system?.id || 'unknown',
    sceneId: scene?.id || null,
    sceneName: scene?.name || null,
    userId: game?.user?.id || null,
    userName: game?.user?.name || null,
    isGM: game?.user?.isGM || false,
    browser: navigator?.userAgent || 'unknown',
    screenSize: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    },
    canvasTransform: canvas?.stage ? {
      scale: canvas.stage.scale?.x || 1,
      pivotX: canvas.stage.pivot?.x || 0,
      pivotY: canvas.stage.pivot?.y || 0,
      x: canvas.stage.x || 0,
      y: canvas.stage.y || 0
    } : null
  };
}

/**
 * Capture all objects from ObjectRegistry
 * @param {Object} whiteboard - Whiteboard class reference
 * @returns {Object}
 */
function captureRegistry(whiteboard) {
  const registry = whiteboard.registry;
  if (!registry) return { error: 'Registry not initialized' };

  const objects = registry.getAll();
  const serialized = objects.map(obj => {
    try {
      return obj.toJSON();
    } catch (e) {
      return { id: obj.id, type: obj.type, _serializationError: e.message };
    }
  });

  // Sort by zIndex for readability
  serialized.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  return {
    totalCount: objects.length,
    objects: serialized,
    zIndexModel: registry.zIndexModel ? {
      size: registry.zIndexModel.size,
      sorted: safeClone(registry.zIndexModel.getAllSorted(), 'zIndexModel.getAllSorted')
    } : null
  };
}

/**
 * Capture raw database flags from Foundry scene
 * @param {Object} whiteboard - Whiteboard class reference
 * @returns {Promise<Object>}
 */
async function captureDatabase(whiteboard) {
  const adapter = whiteboard.persistenceAdapter;
  if (!adapter) return { error: 'PersistenceAdapter not initialized' };
  if (!canvas?.scene) return { error: 'No active scene' };

  const result = {};
  const storageTypes = adapter.getStorageTypes();

  // Load all registered storage types in parallel
  const entries = Array.from(storageTypes.entries());
  const loaded = await Promise.all(
    entries.map(async ([serKey, flagKey]) => {
      try {
        const data = await adapter.loadByType(serKey);
        return [serKey, { flagKey, objectCount: Object.keys(data || {}).length, data }];
      } catch (e) {
        return [serKey, { flagKey, error: e.message }];
      }
    })
  );

  for (const [serKey, value] of loaded) {
    result[serKey] = value;
  }

  return result;
}

/**
 * Capture InteractionManager state
 * @param {Object} whiteboard - Whiteboard class reference
 * @returns {Object}
 */
function captureInteraction(whiteboard) {
  const im = whiteboard.interaction;
  if (!im) return { error: 'InteractionManager not initialized' };

  return {
    mode: im.mode,
    selectedId: im.selectedId,
    editingId: im.editingId,
    dragState: safeClone(im.dragState, 'dragState'),
    panState: safeClone(im.panState, 'panState'),
    scaleResizeState: safeClone(im.scaleResizeState, 'scaleResizeState'),
    stretchResizeState: safeClone(im.stretchResizeState, 'stretchResizeState'),
    widthResizeState: safeClone(im.widthResizeState, 'widthResizeState'),
    unfreezeHoldState: im.unfreezeHoldState ? {
      containerId: im.unfreezeHoldState.containerId,
      imageId: im.unfreezeHoldState.imageId
    } : null,
    copiedObjectData: safeClone(im.copiedObjectData, 'copiedObjectData'),
    copiedStyle: safeClone(im.copiedStyle, 'copiedStyle'),
    lastTextStyle: safeClone(im.lastTextStyle, 'lastTextStyle'),
    lastMousePosition: { x: im.lastMouseX, y: im.lastMouseY },
    massSelection: im.massSelection ? {
      selectedIds: Array.from(im.massSelection.selectedIds || []),
      selectedCount: im.massSelection.selectedIds?.size || 0,
      isSelecting: im.massSelection.isSelecting,
      isDragging: im.massSelection.isDragging,
      isScaling: im.massSelection.isScaling,
      toggleMode: im.massSelection.toggleMode,
      groupRotation: im.massSelection.groupRotation,
      clipboardSize: im.massSelection.clipboard?.length || 0
    } : null
  };
}

/**
 * Capture Undo/Redo stacks with full command data
 * @param {Object} whiteboard - Whiteboard class reference
 * @returns {Object}
 */
function captureUndoRedo(whiteboard) {
  const ur = whiteboard.undoRedo;
  if (!ur) return { error: 'UndoRedoManager not initialized' };

  return {
    undoStackSize: ur.undoStack.length,
    redoStackSize: ur.redoStack.length,
    maxStackSize: ur.maxStackSize,
    isUndoing: ur._isUndoing,
    isRedoing: ur._isRedoing,
    currentBatch: safeClone(ur._currentBatch, 'currentBatch'),
    undoStack: safeClone(ur.undoStack, 'undoStack'),
    redoStack: safeClone(ur.redoStack, 'redoStack')
  };
}

/**
 * Capture DOM state of WBE layer elements with computed styles
 * @returns {Object}
 */
function captureDOM() {
  const board = document.getElementById(LAYER_ID);
  if (!board) return { error: 'WBE layer element not found in DOM' };

  const boardStyles = window.getComputedStyle(board);
  const boardRect = board.getBoundingClientRect();

  const result = {
    layerElement: {
      id: board.id,
      classList: Array.from(board.classList),
      childCount: board.children.length,
      rect: {
        x: Math.round(boardRect.x),
        y: Math.round(boardRect.y),
        width: Math.round(boardRect.width),
        height: Math.round(boardRect.height)
      },
      computedStyles: {
        display: boardStyles.display,
        position: boardStyles.position,
        zIndex: boardStyles.zIndex,
        pointerEvents: boardStyles.pointerEvents,
        transform: boardStyles.transform,
        overflow: boardStyles.overflow
      }
    },
    objects: []
  };

  // Capture all object containers
  const containers = board.querySelectorAll('[data-object-id]');
  for (const container of containers) {
    const objectId = container.dataset.objectId;
    const cs = window.getComputedStyle(container);
    const rect = container.getBoundingClientRect();

    const objInfo = {
      objectId,
      tagName: container.tagName.toLowerCase(),
      classList: Array.from(container.classList),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      inlineStyles: {
        zIndex: container.style.zIndex || null,
        transform: container.style.transform || null,
        left: container.style.left || null,
        top: container.style.top || null,
        width: container.style.width || null,
        height: container.style.height || null,
        position: container.style.position || null,
        pointerEvents: container.style.pointerEvents || null,
        display: container.style.display || null,
        opacity: container.style.opacity || null
      },
      computedStyles: {
        zIndex: cs.zIndex,
        transform: cs.transform,
        left: cs.left,
        top: cs.top,
        width: cs.width,
        height: cs.height,
        position: cs.position,
        pointerEvents: cs.pointerEvents,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        overflow: cs.overflow,
        cursor: cs.cursor,
        boxSizing: cs.boxSizing
      },
      hasResizeHandle: !!container.querySelector('.wbe-resize-handle'),
      hasSelectionBorder: !!container.querySelector('.wbe-selection-border'),
      hasClickTarget: !!container.querySelector('.wbe-click-target'),
      childCount: container.children.length,
      isVisible: cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0',
      // SVG path analysis for connectors
      svgPath: null
    };

    // Capture SVG path details (critical for connector visibility debugging)
    const svgPath = container.querySelector('path');
    if (svgPath) {
      const pathCs = window.getComputedStyle(svgPath);
      const d = svgPath.getAttribute('d') || '';
      const pathLength = svgPath.getTotalLength?.() || 0;
      
      objInfo.svgPath = {
        d: d.length > 500 ? d.substring(0, 500) + '...[truncated]' : d,
        dLength: d.length,
        isEmpty: !d || d.trim() === '',
        // M = moveto, L = lineto, C = cubic bezier, Q = quadratic bezier, S/T = smooth curves, A = arc
        hasMoveTo: /M\s*[\d.-]+/.test(d),
        hasBezier: /[CQSTcqst]/.test(d),
        hasLineTo: /[Ll]/.test(d),
        pathLength: Math.round(pathLength * 100) / 100,
        isTooShort: pathLength < 1, // Effectively invisible if < 1px
        stroke: pathCs.stroke,
        strokeWidth: pathCs.strokeWidth,
        strokeOpacity: pathCs.strokeOpacity,
        fill: pathCs.fill,
        visibility: pathCs.visibility,
        // Final verdict: is this path actually rendering something visible?
        isRendering: (
          d.trim() !== '' &&
          pathLength >= 1 &&
          pathCs.stroke !== 'none' &&
          parseFloat(pathCs.strokeWidth) > 0 &&
          pathCs.visibility !== 'hidden' &&
          pathCs.strokeOpacity !== '0'
        )
      };
    }

    result.objects.push(objInfo);
  }

  // Sort DOM objects by z-index for comparison with registry
  result.objects.sort((a, b) => {
    const zA = parseInt(a.inlineStyles.zIndex) || 0;
    const zB = parseInt(b.inlineStyles.zIndex) || 0;
    return zA - zB;
  });

  return result;
}

/**
 * Capture WBE module settings
 * @returns {Object}
 */
function captureSettings() {
  const WBE_SETTINGS_KEY = 'wbe-settings';

  // Foundry registered settings
  const foundrySettings = {};
  const settingKeys = ['enableTexts', 'enableImages', 'enableMassSelection', 'enableFateCards', 'enableShapes', 'googleFonts'];
  for (const key of settingKeys) {
    try {
      foundrySettings[key] = game?.settings?.get(MODULE_ID, key);
    } catch (e) {
      foundrySettings[key] = { _error: e.message };
    }
  }

  // LocalStorage WBE settings
  let localSettings = {};
  try {
    const stored = localStorage.getItem(WBE_SETTINGS_KEY);
    if (stored) localSettings = JSON.parse(stored);
  } catch (e) {
    localSettings = { _error: e.message };
  }

  // Toolbar state
  let toolbarState = {};
  try {
    const saved = localStorage.getItem('wbe-toolbar-position');
    if (saved) toolbarState = JSON.parse(saved);
  } catch (e) {
    toolbarState = { _error: e.message };
  }

  return {
    foundry: foundrySettings,
    local: localSettings,
    toolbarPosition: toolbarState,
    massSelectionToggle: localStorage.getItem('wbe-mass-selection-toggle') === 'true'
  };
}

/**
 * Capture socket/connection state
 * @returns {Object}
 */
function captureSocket() {
  const allUsers = game?.users?.contents || [];
  const activeUsers = allUsers.filter(u => u.active);
  const gmUsers = activeUsers.filter(u => u.isGM);

  return {
    totalUsers: allUsers.length,
    activeUsers: activeUsers.map(u => ({
      id: u.id,
      name: u.name,
      isGM: u.isGM,
      active: u.active
    })),
    activeGMId: game?.users?.activeGM?.id || null,
    activeGMName: game?.users?.activeGM?.name || null,
    hasConnectedGM: gmUsers.length > 0,
    currentUserIsActiveGM: game?.user === game?.users?.activeGM
  };
}

/**
 * Compute diff between Registry, Database, and DOM states
 * This is the most useful section for debugging desync bugs.
 * 
 * @param {Object} registryData - Output from captureRegistry()
 * @param {Object} dbData - Output from captureDatabase()
 * @param {Object} domData - Output from captureDOM()
 * @returns {Object} Diff report
 */
function computeDiff(registryData, dbData, domData) {
  const diff = {
    registryVsDb: { onlyInRegistry: [], onlyInDb: [], fieldMismatches: [] },
    registryVsDom: { onlyInRegistry: [], onlyInDom: [], zIndexMismatches: [] }
  };

  // --- Registry vs DB ---
  const registryIds = new Set((registryData.objects || []).map(o => o.id));
  const registryMap = new Map((registryData.objects || []).map(o => [o.id, o]));

  // Collect all DB object IDs across all storage types
  const dbIds = new Set();
  const dbMap = new Map();
  for (const [, typeData] of Object.entries(dbData)) {
    if (typeData?.data && typeof typeData.data === 'object') {
      for (const [id, objData] of Object.entries(typeData.data)) {
        dbIds.add(id);
        dbMap.set(id, objData);
      }
    }
  }

  // Objects in Registry but not in DB
  for (const id of registryIds) {
    if (!dbIds.has(id)) {
      const obj = registryMap.get(id);
      diff.registryVsDb.onlyInRegistry.push({ id, type: obj?.type });
    }
  }

  // Objects in DB but not in Registry
  for (const id of dbIds) {
    if (!registryIds.has(id)) {
      const obj = dbMap.get(id);
      diff.registryVsDb.onlyInDb.push({ id, type: obj?.type });
    }
  }

  // Field mismatches for objects in both
  const COMPARE_FIELDS = ['x', 'y', 'zIndex', 'rank', 'hidden', 'frozen', 'text', 'src', 'width', 'height', 'scale', 'rotation'];
  for (const id of registryIds) {
    if (!dbIds.has(id)) continue;
    const regObj = registryMap.get(id);
    const dbObj = dbMap.get(id);
    if (!regObj || !dbObj) continue;

    for (const field of COMPARE_FIELDS) {
      const regVal = regObj[field];
      const dbVal = dbObj[field];
      // Skip undefined fields (not all objects have all fields)
      if (regVal === undefined && dbVal === undefined) continue;
      // Compare with tolerance for floating point
      if (typeof regVal === 'number' && typeof dbVal === 'number') {
        if (Math.abs(regVal - dbVal) > 0.01) {
          diff.registryVsDb.fieldMismatches.push({ id, field, registry: regVal, db: dbVal });
        }
      } else if (JSON.stringify(regVal) !== JSON.stringify(dbVal)) {
        diff.registryVsDb.fieldMismatches.push({ id, field, registry: regVal, db: dbVal });
      }
    }
  }

  // --- Registry vs DOM ---
  const domIds = new Set((domData.objects || []).map(o => o.objectId));
  const domMap = new Map((domData.objects || []).map(o => [o.objectId, o]));

  // Objects in Registry but not in DOM
  for (const id of registryIds) {
    if (!domIds.has(id)) {
      const obj = registryMap.get(id);
      diff.registryVsDom.onlyInRegistry.push({ id, type: obj?.type });
    }
  }

  // Objects in DOM but not in Registry
  for (const id of domIds) {
    if (!registryIds.has(id)) {
      diff.registryVsDom.onlyInDom.push({ id });
    }
  }

  // Z-index mismatches
  for (const id of registryIds) {
    if (!domIds.has(id)) continue;
    const regObj = registryMap.get(id);
    const domObj = domMap.get(id);
    const regZ = regObj?.zIndex;
    const domZ = parseInt(domObj?.inlineStyles?.zIndex) || 0;
    if (regZ !== undefined && regZ !== domZ) {
      diff.registryVsDom.zIndexMismatches.push({ id, registry: regZ, dom: domZ });
    }
  }

  // --- Invisible SVG paths (connectors with broken bezier rendering) ---
  diff.invisiblePaths = [];
  for (const domObj of (domData.objects || [])) {
    if (domObj.svgPath && !domObj.svgPath.isRendering) {
      const regObj = registryMap.get(domObj.objectId);
      diff.invisiblePaths.push({
        id: domObj.objectId,
        type: regObj?.type || 'unknown',
        reason: getInvisiblePathReason(domObj.svgPath)
      });
    }
  }

  // Summary flags for quick scanning
  diff.hasDesync = (
    diff.registryVsDb.onlyInRegistry.length > 0 ||
    diff.registryVsDb.onlyInDb.length > 0 ||
    diff.registryVsDb.fieldMismatches.length > 0 ||
    diff.registryVsDom.onlyInRegistry.length > 0 ||
    diff.registryVsDom.onlyInDom.length > 0 ||
    diff.registryVsDom.zIndexMismatches.length > 0 ||
    diff.invisiblePaths.length > 0
  );

  return diff;
}

/**
 * Determine why an SVG path is not rendering
 * @param {Object} svgPath - svgPath object from DOM capture
 * @returns {string} Human-readable reason
 */
function getInvisiblePathReason(svgPath) {
  if (svgPath.isEmpty) return 'empty path data (d="")';
  if (svgPath.isTooShort) return `path too short (${svgPath.pathLength}px)`;
  if (svgPath.stroke === 'none') return 'stroke: none';
  if (parseFloat(svgPath.strokeWidth) === 0) return 'stroke-width: 0';
  if (svgPath.strokeOpacity === '0') return 'stroke-opacity: 0';
  if (svgPath.visibility === 'hidden') return 'visibility: hidden';
  if (!svgPath.hasMoveTo) return 'missing MoveTo command in path';
  return 'unknown rendering issue';
}

/**
 * Build a "suspect" dossier for the object(s) currently under interaction.
 * Consolidates registry, database, DOM, and diff data into one section.
 * 
 * @param {Object} whiteboard - Whiteboard class reference
 * @param {Object} registryData - Already captured registry data
 * @param {Object} dbData - Already captured database data
 * @param {Object} domData - Already captured DOM data
 * @returns {Object|null} Suspect dossier or null if nothing is selected
 */
function captureSuspect(whiteboard, registryData, dbData, domData) {
  const im = whiteboard.interaction;
  if (!im) return null;

  // Determine suspect ID(s) by priority: editing > selected > mass-selected
  let suspectIds = [];
  let reason = null;

  if (im.editingId) {
    suspectIds = [im.editingId];
    reason = 'editing';
  } else if (im.selectedId) {
    suspectIds = [im.selectedId];
    reason = 'selected';
  } else if (im.massSelection?.selectedIds?.size > 0) {
    suspectIds = Array.from(im.massSelection.selectedIds);
    reason = 'mass-selected';
  }

  if (suspectIds.length === 0) return null;

  // Build lookup maps from already-captured data
  const regMap = new Map((registryData?.objects || []).map(o => [o.id, o]));
  const domMap = new Map((domData?.objects || []).map(o => [o.objectId, o]));

  // Collect DB objects across all storage types
  const dbObjMap = new Map();
  if (dbData && typeof dbData === 'object') {
    for (const [, typeData] of Object.entries(dbData)) {
      if (typeData?.data && typeof typeData.data === 'object') {
        for (const [id, objData] of Object.entries(typeData.data)) {
          dbObjMap.set(id, objData);
        }
      }
    }
  }

  // COMPARE_FIELDS used for per-suspect diff (same as in computeDiff)
  const COMPARE_FIELDS = ['x', 'y', 'zIndex', 'rank', 'hidden', 'frozen', 'text', 'src', 'width', 'height', 'scale', 'rotation'];

  // Build dossier for each suspect
  const dossiers = suspectIds.map(id => {
    const regObj = regMap.get(id) || null;
    const dbObj = dbObjMap.get(id) || null;
    const domObj = domMap.get(id) || null;

    // Per-suspect field diff (registry vs db)
    const fieldDiff = [];
    if (regObj && dbObj) {
      for (const field of COMPARE_FIELDS) {
        const regVal = regObj[field];
        const dbVal = dbObj[field];
        if (regVal === undefined && dbVal === undefined) continue;
        if (typeof regVal === 'number' && typeof dbVal === 'number') {
          if (Math.abs(regVal - dbVal) > 0.01) {
            fieldDiff.push({ field, registry: regVal, db: dbVal });
          }
        } else if (JSON.stringify(regVal) !== JSON.stringify(dbVal)) {
          fieldDiff.push({ field, registry: regVal, db: dbVal });
        }
      }
    }

    // Z-index diff (registry vs dom)
    let zIndexDiff = null;
    if (regObj && domObj) {
      const regZ = regObj.zIndex;
      const domZ = parseInt(domObj.inlineStyles?.zIndex) || 0;
      if (regZ !== undefined && regZ !== domZ) {
        zIndexDiff = { registry: regZ, dom: domZ };
      }
    }

    // Interaction state for this object
    const interactionState = {
      isSelected: im.selectedId === id,
      isEditing: im.editingId === id,
      isDragging: im.dragState?.id === id,
      isResizing: (
        im.scaleResizeState?.id === id ||
        im.stretchResizeState?.id === id ||
        im.widthResizeState?.id === id
      ),
      isMassSelected: im.massSelection?.selectedIds?.has(id) || false
    };

    return {
      id,
      type: regObj?.type || dbObj?.type || 'unknown',
      interactionState,
      registry: regObj,
      database: dbObj,
      dom: domObj,
      diff: {
        registryVsDb: fieldDiff,
        zIndexMismatch: zIndexDiff,
        inRegistryOnly: !!regObj && !dbObj,
        inDbOnly: !regObj && !!dbObj,
        inDomOnly: !regObj && !!domObj,
        missingFromDom: !!regObj && !domObj
      }
    };
  });

  return {
    reason,
    count: dossiers.length,
    objects: dossiers.length === 1 ? undefined : dossiers,
    // For single suspect, flatten for convenience (no need to dig into array)
    ...(dossiers.length === 1 ? dossiers[0] : {})
  };
}

/**
 * Capture complete snapshot of the whiteboard state
 * @param {Object} whiteboard - Whiteboard class reference (window.Whiteboard)
 * @returns {Promise<Object>} Full snapshot object
 */
async function capture(whiteboard) {
  // Each section is wrapped in try/catch so one failure doesn't kill the entire snapshot
  function safe(fn, label) {
    try { return fn(); } catch (e) { return { _captureError: `${label}: ${e.message}` }; }
  }
  async function safeAsync(fn, label) {
    try { return await fn(); } catch (e) { return { _captureError: `${label}: ${e.message}` }; }
  }

  const meta = safe(() => captureMeta(), 'meta');
  const registry = safe(() => captureRegistry(whiteboard), 'registry');
  const interaction = safe(() => captureInteraction(whiteboard), 'interaction');
  const undoRedo = safe(() => captureUndoRedo(whiteboard), 'undoRedo');
  const dom = safe(() => captureDOM(), 'dom');
  const settings = safe(() => captureSettings(), 'settings');
  const socket = safe(() => captureSocket(), 'socket');
  const recentLogs = safe(() => safeClone(WbeLogger.getLogs(), 'wbeLoggerLogs'), 'recentLogs');
  const consoleErrors = safe(() => [..._capturedConsole], 'consoleErrors');

  // DB is async - capture separately
  const database = await safeAsync(() => captureDatabase(whiteboard), 'database');

  // Compute diff (the most valuable section for debugging)
  const diff = safe(() => computeDiff(registry, database, dom), 'diff');

  // Build suspect dossier from currently selected/edited object
  const suspect = safe(() => captureSuspect(whiteboard, registry, database, dom), 'suspect');

  return {
    _snapshotVersion: 3,
    suspect,
    meta,
    registry,
    database,
    interaction,
    undoRedo,
    dom,
    diff,
    settings,
    socket,
    recentLogs,
    consoleErrors
  };
}

/**
 * Download snapshot as a JSON file to the user's browser
 * File name format: wbe-snapshot-{sceneName}-{timestamp}.json
 * 
 * @param {Object} snapshot - Snapshot object from capture()
 */
function download(snapshot) {
  const sceneName = (snapshot.meta?.sceneName || 'unknown-scene')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 40);

  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19);

  const filename = `wbe-snapshot-${sceneName}-${timestamp}.json`;
  const json = JSON.stringify(snapshot, null, 2);

  // Use Foundry's built-in saveDataToFile if available (handles Electron + browser correctly)
  if (typeof saveDataToFile === 'function') {
    saveDataToFile(json, 'text/json', filename);
  } else {
    // Fallback for non-Foundry environments
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1000);
  }

  console.log(`${MODULE_ID} | Snapshot saved: ${filename} (${(json.length / 1024).toFixed(1)} KB)`);
}

/**
 * One-click: capture + download
 * @param {Object} whiteboard - Whiteboard class reference
 */
async function captureAndDownload(whiteboard) {
  try {
    const snapshot = await capture(whiteboard);
    download(snapshot);
    return snapshot;
  } catch (error) {
    console.error(`${MODULE_ID} | Snapshot capture failed:`, error);
    throw error;
  }
}

export const WbeSnapshot = {
  capture,
  download,
  captureAndDownload
};

// Exported for unit testing (pure functions, no Foundry dependency)
export const _testUtils = {
  safeClone,
  computeDiff,
  captureSuspect
};
