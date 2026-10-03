/**
 * UndoRedoManager - Unified Diff implementation for undo/redo (tldraw-style)
 * 
 * Architecture:
 * - Subscribes to ObjectRegistry notifications
 * - Stores unified diffs (added/updated/removed) instead of typed commands
 * - Single applyDiff + reverseDiff replaces all inverse/forward operation logic
 * - squashDiffs replaces batch command composition
 * 
 * Based on tldraw approach (RecordsDiff):
 * - 30 operations limit
 * - In-memory storage (session only)
 * - Commit on action completion (mouseup, blur), not during drag
 * - One diff format for all operation types
 */

const MODULE_ID = 'whiteboard-experience';

// Properties that should NOT be recorded in undo diffs
// These are temporary/transient state, not persistent data
const UNDO_EXCLUDE_KEYS = [
  'selected',           // Temporary selection state
  'massSelected',       // Temporary mass selection state
  '_lastModified',      // Sync metadata
  '_lastModifiedSource', // Sync metadata
  'isCropping'          // Runtime UI mode: undoing it flips the flag without running enter/exitCropMode
];

export class UndoRedoManager {
  constructor(registry) {
    this.registry = registry;
    this.undoStack = [];
    this.redoStack = [];
    this.maxStackSize = 30;
    
    // Flags to prevent recording undo/redo operations themselves
    this._isUndoing = false;
    this._isRedoing = false;
    
    // Batch operation support (for mass operations)
    this._currentBatch = null;
  }

  /**
   * Initialize the manager - subscribe to Registry changes
   */
  init() {
    this.registry.subscribe(this._handleRegistryChange.bind(this));
    console.log(`${MODULE_ID} | UndoRedoManager initialized`);
  }

  // ==========================================
  // Registry Change Handler
  // ==========================================

  /**
   * Handle Registry notifications and create unified diffs
   */
  _handleRegistryChange({ id, type, data, source, changes, oldValues }) {
    // Only record LOCAL changes (not remote sync, not our own undo/redo)
    if (source !== 'local') return;
    if (this._isUndoing || this._isRedoing) return;
    
    // Skip z-index batch updates (handled via zIndexChanged events)
    if (type === 'zIndexBatchUpdate') return;
    
    // Skip updates while text is being actively edited
    // Final update will be recorded when editingId is cleared (in _endEditText)
    if (type === 'updated' && typeof window !== 'undefined' && window.Whiteboard?.interaction?.editingId === id) {
      return;
    }
    
    const diff = this._createDiffFromEvent(type, id, data, changes, oldValues);
    if (!diff) return;
    
    if (this._currentBatch) {
      // Add to current batch
      this._currentBatch.diffs.push(diff);
      for (const affId of diff.affectedIds) {
        this._currentBatch.affectedIds.add(affId);
      }
    } else {
      // Check merge with preceding create (text creation flow)
      if (type === 'updated' && this._shouldMergeWithCreate(diff)) {
        // Already merged in _shouldMergeWithCreate
      } else {
        this._pushToUndoStack(diff);
      }
    }
  }

  // ==========================================
  // Diff Creation
  // ==========================================

  /**
   * Create a unified diff from a registry event.
   * Single factory for all event types.
   *
   * @param {string} type - Event type: 'created', 'deleted', 'updated', 'zIndexChanged'
   * @param {string|null} id - Object ID (null for zIndexChanged)
   * @param {Object|null} data - Object data from the event
   * @param {Object|null} changes - Changes object (for updated/zIndexChanged)
   * @param {Object|null} oldValues - Previous values (for updated)
   * @returns {Object|null} Diff object or null if nothing to record
   */
  _createDiffFromEvent(type, id, data, changes, oldValues) {
    switch (type) {
      case 'created': {
        const snapshot = snapshotObject(data);
        if (!snapshot) return null;
        return {
          timestamp: Date.now(),
          added: { [id]: snapshot },
          updated: {},
          removed: {},
          affectedIds: [id]
        };
      }

      case 'deleted': {
        const snapshot = snapshotObject(data);
        if (!snapshot) return null;
        return {
          timestamp: Date.now(),
          added: {},
          updated: {},
          removed: { [id]: snapshot },
          affectedIds: [id]
        };
      }

      case 'updated': {
        const filteredOld = this._filterTemporaryProperties(oldValues);
        const filteredNew = this._filterTemporaryProperties(changes);

        // Nothing significant changed
        if (!filteredOld || Object.keys(filteredOld).length === 0) return null;

        // Drop keys whose value did not actually change (a repeated click or an
        // idempotent write); an update that changes nothing is not an undo step.
        for (const key of Object.keys(filteredOld)) {
          if (filteredNew && key in filteredNew && valuesEqual(filteredOld[key], filteredNew[key])) {
            delete filteredOld[key];
            delete filteredNew[key];
          }
        }
        if (Object.keys(filteredOld).length === 0) return null;

        // Skip z-index-only changes (handled separately via zIndexChanged)
        const changeKeys = Object.keys(filteredNew || {});
        if (changeKeys.length > 0 && changeKeys.every(k => ['zIndex', 'rank'].includes(k))) {
          return null;
        }

        return {
          timestamp: Date.now(),
          added: {},
          updated: {
            [id]: { old: filteredOld, new: filteredNew }
          },
          removed: {},
          affectedIds: [id]
        };
      }

      case 'zIndexChanged': {
        const zChanges = changes?.changes;
        if (!zChanges || !Array.isArray(zChanges) || zChanges.length === 0) return null;

        // Filter valid changes
        const valid = zChanges.filter(c =>
          c && c.id && typeof c.oldRank === 'string' && typeof c.newRank === 'string'
        );
        if (valid.length === 0) return null;

        const updated = {};
        for (const c of valid) {
          updated[c.id] = {
            old: { rank: c.oldRank },
            new: { rank: c.newRank }
          };
        }

        return {
          timestamp: Date.now(),
          added: {},
          updated,
          removed: {},
          affectedIds: valid.map(c => c.id)
        };
      }

      default:
        return null;
    }
  }

  /**
   * Check if an update diff should be merged with preceding CREATE diff.
   * This handles the "create text then type" flow as a single undo action.
   * Returns true if merged, false otherwise.
   */
  _shouldMergeWithCreate(updateDiff) {
    if (this.undoStack.length === 0) return false;
    
    const lastDiff = this.undoStack[this.undoStack.length - 1];
    
    // Get the updated object ID from this diff
    const updatedIds = Object.keys(updateDiff.updated || {});
    if (updatedIds.length !== 1) return false;
    const updateId = updatedIds[0];
    
    // Only merge with a diff that created this same object
    const addedIds = Object.keys(lastDiff.added || {});
    if (addedIds.length === 0 || !lastDiff.added[updateId]) return false;
    
    // Only merge TEXT CONTENT changes (not resize/textWidth)
    const newValues = updateDiff.updated[updateId]?.new;
    const updateKeys = newValues ? Object.keys(newValues) : [];
    if (!updateKeys.includes('text')) return false;
    
    // Time limit: 30 seconds
    const timeDiff = updateDiff.timestamp - lastDiff.timestamp;
    if (timeDiff > 30000) return false;
    
    // Merge: update the added snapshot with new values
    if (newValues) {
      Object.assign(lastDiff.added[updateId], newValues);
    }
    lastDiff.timestamp = updateDiff.timestamp;
    
    return true;
  }

  /**
   * Filter out temporary properties that shouldn't be in undo diffs
   */
  _filterTemporaryProperties(values) {
    if (!values) return null;
    
    const filtered = {};
    for (const key in values) {
      if (!UNDO_EXCLUDE_KEYS.includes(key)) {
        filtered[key] = values[key];
      }
    }
    
    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  // ==========================================
  // Stack Management
  // ==========================================

  /**
   * Push diff to undo stack
   */
  _pushToUndoStack(diff) {
    this.undoStack.push(diff);
    
    // Enforce stack size limit
    while (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();  // Remove oldest
    }
    
    // Clear redo stack on new action (standard behavior)
    this.redoStack = [];
  }

  // ==========================================
  // Undo / Redo Operations
  // ==========================================

  /**
   * Undo the last operation
   * @returns {boolean} true if undo was performed
   */
  undo() {
    if (!this.canUndo()) return false;
    
    const diff = this.undoStack.pop();
    
    this._isUndoing = true;
    try {
      // Apply reversed diff: added becomes removed, old/new swap
      const inverseDiff = reverseDiff(diff);
      const interaction = (typeof window !== 'undefined') ? window.Whiteboard?.interaction : null;
      const factory = interaction?.constructor?._createObjectFromType || null;
      applyDiff(inverseDiff, this.registry, interaction, false, factory);
      
      // Push to redo stack
      this.redoStack.push(diff);
      
      console.log(`${MODULE_ID} | [UndoRedo] Undo`, diff.affectedIds);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | [UndoRedo] Undo failed:`, error);
      return false;
    } finally {
      this._isUndoing = false;
    }
  }

  /**
   * Redo the last undone operation
   * @returns {boolean} true if redo was performed
   */
  redo() {
    if (!this.canRedo()) return false;
    
    const diff = this.redoStack.pop();
    
    this._isRedoing = true;
    try {
      // Apply the original diff as-is
      const interaction = (typeof window !== 'undefined') ? window.Whiteboard?.interaction : null;
      const factory = interaction?.constructor?._createObjectFromType || null;
      applyDiff(diff, this.registry, interaction, false, factory);
      
      // Push back to undo stack
      this.undoStack.push(diff);
      
      console.log(`${MODULE_ID} | [UndoRedo] Redo`, diff.affectedIds);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | [UndoRedo] Redo failed:`, error);
      return false;
    } finally {
      this._isRedoing = false;
    }
  }

  // ==========================================
  // Batch Operations
  // ==========================================

  /**
   * Start a batch operation - multiple changes = 1 undo step
   */
  startBatch() {
    if (this._currentBatch) {
      console.warn(`${MODULE_ID} | [UndoRedo] Batch already in progress`);
      return;
    }
    
    this._currentBatch = {
      timestamp: Date.now(),
      diffs: [],
      affectedIds: new Set()
    };
  }

  /**
   * End batch operation and push as single squashed diff
   */
  endBatch() {
    if (!this._currentBatch) return;
    
    const batch = this._currentBatch;
    this._currentBatch = null;
    
    // Skip empty batches
    if (batch.diffs.length === 0) return;
    
    // Squash all diffs into one
    const squashed = squashDiffs(batch.diffs);

    // A batch can net out to nothing (x -> y -> x): prune keys that end where they began
    for (const id of Object.keys(squashed.updated)) {
      const entry = squashed.updated[id];
      for (const key of Object.keys(entry.old || {})) {
        if (entry.new && key in entry.new && valuesEqual(entry.old[key], entry.new[key])) {
          delete entry.old[key];
          delete entry.new[key];
        }
      }
      if (Object.keys(entry.old || {}).length === 0) delete squashed.updated[id];
    }
    
    // Skip if squashing cancelled everything out (e.g. create + delete same object)
    const hasChanges = Object.keys(squashed.added).length > 0
      || Object.keys(squashed.updated).length > 0
      || Object.keys(squashed.removed).length > 0;
    if (!hasChanges) return;
    
    squashed.timestamp = batch.timestamp;
    squashed.affectedIds = Array.from(batch.affectedIds);
    
    this._pushToUndoStack(squashed);
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /** True while a batch is open (all writes so far are one pending undo step) */
  isBatching() {
    return !!this._currentBatch;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all undo/redo history
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Get current stack sizes (for debugging)
   */
  getStackInfo() {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      maxSize: this.maxStackSize
    };
  }
}

// ============================================================
// Diff Utilities (tldraw-style unified diff format)
// ============================================================

/**
 * Create a clean snapshot of an object, filtering temporary properties and functions.
 * Returns null for non-object inputs.
 */
function snapshotObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const snapshot = {};
  for (const key in obj) {
    if (UNDO_EXCLUDE_KEYS.includes(key)) continue;
    if (typeof obj[key] === 'function') continue;

    const val = obj[key];
    if (Array.isArray(val)) {
      snapshot[key] = [...val];
    } else if (val && typeof val === 'object' && val.constructor === Object) {
      snapshot[key] = { ...val };
    } else {
      snapshot[key] = val;
    }
  }
  return snapshot;
}

/**
 * Create an empty diff structure.
 */
function createEmptyDiff() {
  return { added: {}, updated: {}, removed: {} };
}

/**
 * Reverse a diff: added<->removed, old<->new in updated.
 * Reversing a forward diff gives the inverse (undo) diff.
 */
function reverseDiff(diff) {
  if (!diff) return createEmptyDiff();

  const reversed = { added: {}, updated: {}, removed: {} };

  // Swap added <-> removed
  if (diff.removed) {
    for (const id in diff.removed) {
      reversed.added[id] = diff.removed[id];
    }
  }
  if (diff.added) {
    for (const id in diff.added) {
      reversed.removed[id] = diff.added[id];
    }
  }

  // Swap old <-> new in updated
  if (diff.updated) {
    for (const id in diff.updated) {
      const entry = diff.updated[id];
      reversed.updated[id] = { old: entry.new, new: entry.old };
    }
  }

  return reversed;
}

/**
 * Structural equality for diff values (primitives, plain objects, arrays).
 */
function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => k in b && valuesEqual(a[k], b[k]));
}

/**
 * Squash multiple diffs into one (for batch operations).
 * Diffs are applied left-to-right. Later diffs override earlier ones.
 *
 * Key rules:
 *  - add then remove of same id = cancel out
 *  - remove then add = updated (old=removed snapshot, new=added snapshot)
 *  - multiple updates = keep original old, latest new
 *  - add then update = merge update into added snapshot
 *  - update then remove = removed with original old values
 */
function squashDiffs(diffs) {
  if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
    return createEmptyDiff();
  }

  const result = createEmptyDiff();

  for (const diff of diffs) {
    if (!diff) continue;

    // Process added
    if (diff.added) {
      for (const id in diff.added) {
        if (result.removed[id]) {
          // Was removed earlier -> remove+add = updated
          const oldSnapshot = result.removed[id];
          delete result.removed[id];
          result.updated[id] = { old: oldSnapshot, new: diff.added[id] };
        } else if (result.updated[id]) {
          result.updated[id].new = diff.added[id];
        } else {
          result.added[id] = diff.added[id];
        }
      }
    }

    // Process removed
    if (diff.removed) {
      for (const id in diff.removed) {
        if (result.added[id]) {
          // Was added earlier -> add+remove = cancel
          delete result.added[id];
        } else if (result.updated[id]) {
          // Was updated earlier -> keep original old as removed snapshot
          const oldSnapshot = result.updated[id].old;
          delete result.updated[id];
          result.removed[id] = oldSnapshot;
        } else {
          result.removed[id] = diff.removed[id];
        }
      }
    }

    // Process updated
    if (diff.updated) {
      for (const id in diff.updated) {
        if (result.added[id]) {
          // Object was added earlier -> merge new values into added snapshot
          result.added[id] = { ...result.added[id], ...diff.updated[id].new };
        } else if (result.updated[id]) {
          // Already updated -> only add NEW keys to old (preserve originals), take latest new
          for (const key in diff.updated[id].old) {
            if (!(key in result.updated[id].old)) {
              result.updated[id].old[key] = diff.updated[id].old[key];
            }
          }
          result.updated[id].new = { ...result.updated[id].new, ...diff.updated[id].new };
        } else if (result.removed[id]) {
          // Updated after removed -> ignore (can't update removed object)
        } else {
          result.updated[id] = {
            old: { ...diff.updated[id].old },
            new: { ...diff.updated[id].new }
          };
        }
      }
    }
  }

  return result;
}

/**
 * Apply a diff to the registry. Single point of applying undo/redo changes.
 *
 * @param {Object} diff - { added: {id: snapshot}, updated: {id: {old, new}}, removed: {id: snapshot} }
 * @param {Object} registry - ObjectRegistry instance
 * @param {Object} [interaction] - InteractionManager (optional, for selection cleanup)
 * @param {boolean} [isUndo=false] - If true, uses "old" values from updated; otherwise "new"
 * @param {Function} [objectFactory=null] - Factory function(type, data) to create proper class instances
 *   When null, added objects are registered as plain objects (sufficient for unit tests).
 *   In production, pass InteractionManager._createObjectFromType to create TextItem/ImageItem etc.
 */
function applyDiff(diff, registry, interaction, isUndo = false, objectFactory = null) {
  if (!diff || !registry) return;

  // 1. Process removals first (before adds, to avoid ID conflicts on reuse)
  if (diff.removed) {
    for (const id in diff.removed) {
      if (interaction) {
        if (interaction.selectedId === id) {
          interaction._deselect();
        }
        if (interaction.massSelection?.selectedIds?.has(id)) {
          interaction.massSelection.selectedIds.delete(id);
        }
      }
      registry.unregister(id, 'local');
    }
  }

  // 2. Process additions
  if (diff.added) {
    for (const id in diff.added) {
      const snapshot = diff.added[id];
      let obj;
      if (objectFactory && snapshot.type) {
        // Use factory to create proper class instance (TextItem, ImageItem, etc.)
        obj = objectFactory(snapshot.type, { ...snapshot, id });
      }
      if (!obj) {
        // Fallback: plain object (works for unit tests, simple registries)
        obj = { ...snapshot, id };
      }
      registry.register(obj, 'local');
    }
  }

  // 3. Process updates
  if (diff.updated) {
    for (const id in diff.updated) {
      const entry = diff.updated[id];
      if (!entry) continue;
      const values = isUndo ? entry.old : entry.new;
      if (values && Object.keys(values).length > 0) {
        registry.update(id, values, 'local');
      }
    }
  }

  // 4. Clean up mass selection (remove IDs no longer in registry)
  if (interaction?.massSelection) {
    const ms = interaction.massSelection;
    const validIds = new Set();
    for (const id of ms.selectedIds) {
      if (registry.get(id)) {
        validIds.add(id);
      }
    }
    ms.selectedIds = validIds;
    // Rotation state must follow what undo/redo just did to the objects
    ms.syncRotationStateAfterHistory?.();
    if (validIds.size > 0) {
      ms._updateBoundingBox();
    }
  }
}

export {
  snapshotObject,
  createEmptyDiff,
  reverseDiff,
  squashDiffs,
  applyDiff,
  UNDO_EXCLUDE_KEYS
};
