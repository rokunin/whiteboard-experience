/**
 * CompactZIndexManager - Rank-based z-index management with fractional indexing
 * 
 * This manager uses fractional indexing (string ranks) internally to avoid conflicts
 * during parallel operations. DOM z-index values are derived from rank order.
 * 
 * Key features:
 * - No z-index conflicts during concurrent operations
 * - Optimistic local updates
 * - Minimal network traffic (only changed objects)
 * - Compatible with existing API
 */

import { ZIndexRanges } from "../main.mjs";
import { rankBetween, rankAfter, rankBefore } from "./fractional-index.mjs";

export class CompactZIndexManager {
  constructor() {
    // Core data: Map<objectId, {rank: string, type: string}>
    this.objectRank = new Map();
    
    // Cached sorted order
    this.orderCache = null;
    this.dirty = true;
    
    // Base z-index for DOM elements
    this.baseZ = 1000;
    
    // Migration flag
    this._migrationCompleted = false;
    
    // Undo history (kept for compatibility)
    this.undoHistory = [];
    this.maxUndoSteps = 50;
  }

  /**
   * Assign a rank to a new object (places at top)
   * @param {string} objectId - The object ID
   * @param {string} initialRank - Optional initial rank (for migration)
   * @returns {number} The calculated DOM z-index
   */
  assign(objectId, initialRank = null) {
    return this.#assignInternal(objectId, "image", initialRank);
  }

  /**
   * Assign rank to image (for API compatibility)
   */
  assignImage(objectId, initialRank = null) {
    return this.#assignInternal(objectId, "image", initialRank);
  }

  /**
   * Assign rank to text (for API compatibility)
   */
  assignText(objectId, initialRank = null) {
    return this.#assignInternal(objectId, "text", initialRank);
  }

  /**
   * Internal assignment method
   */
  #assignInternal(objectId, type, initialRank) {
    if (this.objectRank.has(objectId)) {
      return this.get(objectId);
    }
    
    let rank = initialRank;
    if (!rank) {
      // Place at top by default
      const last = this.#getLastRank();
      rank = rankAfter(last);
    }
    
    this.objectRank.set(objectId, { rank, type });
    this.dirty = true;
    
    return this.get(objectId);
  }

  /**
   * Get DOM z-index for an object (derived from rank order)
   * @param {string} objectId - The object ID
   * @returns {number} The DOM z-index
   */
  get(objectId) {
    const list = this.#sorted();
    const idx = list.findIndex(o => o.id === objectId);
    return idx < 0 ? ZIndexRanges.EDITABLE_MIN : (this.baseZ + idx);
  }

  /**
   * Get image z-index (for API compatibility)
   */
  getImage(objectId) {
    return this.get(objectId);
  }

  /**
   * Get text z-index (for API compatibility)
   */
  getText(objectId) {
    return this.get(objectId);
  }

  /**
   * Get rank string for an object
   * @param {string} objectId - The object ID
   * @returns {string} The rank string
   */
  getRank(objectId) {
    return this.objectRank.get(objectId)?.rank || "";
  }

  /**
   * Check if an object exists in the manager
   * @param {string} objectId - The object ID
   * @returns {boolean} True if object exists
   */
  has(objectId) {
    return this.objectRank.has(objectId);
  }

  /**
   * Set rank for an object directly
   * @param {string} objectId - The object ID
   * @param {string} rank - The rank string
   */
  setRank(objectId, rank) {
    const entry = this.objectRank.get(objectId);
    if (entry) {
      entry.rank = rank;
      this.dirty = true;
    }
  }

  /**
   * Remove an object
   * @param {string} objectId - The object ID
   */
  remove(objectId) {
    this.#removeInternal(objectId);
  }

  /**
   * Remove image (for API compatibility)
   */
  removeImage(objectId) {
    this.#removeInternal(objectId);
  }

  /**
   * Remove text (for API compatibility)
   */
  removeText(objectId) {
    this.#removeInternal(objectId);
  }

  /**
   * Internal removal method
   */
  #removeInternal(objectId) {
    if (this.objectRank.delete(objectId)) {
      this.dirty = true;
    }
  }

  /**
   * Move object up (toward higher z-index / top of stack)
   * @param {string} objectId - The object ID
   * @param {number} count - Number of positions to move (default 1)
   * @returns {object} Result with success flag and changes
   */
  moveUp(objectId, count = 1) {
    return this.#move(objectId, +Math.abs(count));
  }

  /**
   * Move object down (toward lower z-index / bottom of stack)
   * @param {string} objectId - The object ID
   * @param {number} count - Number of positions to move (default 1)
   * @returns {object} Result with success flag and changes
   */
  moveDown(objectId, count = 1) {
    return this.#move(objectId, -Math.abs(count));
  }

  /**
   * Internal move method using fractional indexing
   * @param {string} objectId - The object ID
   * @param {number} delta - Positive for up, negative for down
   * @returns {object} Result object
   */
  #move(objectId, delta) {
    const list = this.#sorted();
    const fromIndex = list.findIndex(o => o.id === objectId);
    
    if (fromIndex < 0) {
      return { 
        success: false, 
        changes: [],
        atBoundary: false,
        reason: 'object_not_found'
      };
    }

    // Calculate target index
    let toIndex = fromIndex + delta;
    toIndex = Math.max(0, Math.min(list.length - 1, toIndex));
    
    if (toIndex === fromIndex) {
      return { 
        success: true, 
        changes: [],
        atBoundary: true,
        reason: delta > 0 ? 'at_top' : 'at_bottom'
      };
    }

    // Find ranks of neighbors at target position
    // When moving up (delta > 0), we want to go AFTER the target position
    // When moving down (delta < 0), we want to go BEFORE the target position
    let beforeRank, afterRank;
    
    if (delta > 0) {
      // Moving up: insert after toIndex
      beforeRank = list[toIndex]?.rank ?? "";
      afterRank = list[toIndex + 1]?.rank ?? "";
    } else {
      // Moving down: insert before toIndex
      beforeRank = list[toIndex - 1]?.rank ?? "";
      afterRank = list[toIndex]?.rank ?? "";
    }
    
    const newRank = rankBetween(beforeRank, afterRank);
    const oldRank = this.objectRank.get(objectId).rank;
    
    this.objectRank.get(objectId).rank = newRank;
    this.dirty = true;

    return { 
      success: true, 
      changes: [{
        objectId: objectId,
        oldZIndex: this.baseZ + fromIndex,
        newZIndex: this.baseZ + toIndex,
        rank: newRank,
        swappedWith: null
      }],
      atBoundary: false
    };
  }

  /**
   * Move object group up
   * @param {Array<string>} objectIds - Array of object IDs
   * @returns {Array<object>} Array of results
   */
  moveUpGroup(objectIds) {
    return this.#moveGroup(objectIds, 1);
  }

  /**
   * Move object group down
   * @param {Array<string>} objectIds - Array of object IDs
   * @returns {Array<object>} Array of results
   */
  moveDownGroup(objectIds) {
    return this.#moveGroup(objectIds, -1);
  }

  /**
   * Internal group move method
   */
  #moveGroup(objectIds, delta) {
    const results = [];
    
    // Sort objects by current position
    const list = this.#sorted();
    const positions = objectIds
      .map(id => ({ id, index: list.findIndex(o => o.id === id) }))
      .filter(o => o.index >= 0)
      .sort((a, b) => delta > 0 ? b.index - a.index : a.index - b.index);
    
    // Move each object
    for (const {id} of positions) {
      const result = this.#move(id, delta);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Apply rank order to DOM z-index values
   * This is the ONLY place where style.zIndex should be set
   * Uses requestAnimationFrame to batch DOM updates and prevent multiple reflows
   * Returns a Promise that resolves when DOM updates are complete
   */
  syncAllDOMZIndexes() {
    const list = this.#sorted();
    
    // Batch all DOM updates into single reflow using requestAnimationFrame
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        list.forEach((obj, index) => {
          const el = document.getElementById(obj.id);
          if (el) {
            el.style.zIndex = String(this.baseZ + index);
          }
        });
        resolve();
      });
    });
  }

  /**
   * Sync with existing data (high-level migration method)
   * @param {Array} existingData - Array of {id, zIndex, rank, type} objects
   */
  syncWithExisting(existingData) {
    if (!Array.isArray(existingData)) return;
    
    // Only migrate once per instance
    if (this._migrationCompleted) {
      //console.log('[CompactZIndexManager] Migration already completed, skipping');
      return;
    }
    
    console.log(`[CompactZIndexManager] Starting one-time migration of ${existingData.length} objects`);
    
    // Pass full data to migration (including rank if present)
    this.migrateFromLegacy({ 
      images: existingData.filter(d => d.type === 'image'), 
      texts: existingData.filter(d => d.type === 'text') 
    });
    
    // After migration, sync DOM z-indexes (fire and forget - migration happens during init)
    this.syncAllDOMZIndexes().catch(err => {
      console.warn('[CompactZIndexManager] Error syncing DOM z-indexes after migration:', err);
    });
    
    this._migrationCompleted = true;
    console.log('[CompactZIndexManager] Migration completed and locked');
  }

  /**
   * Migrate from legacy z-index data
   * @param {object} existing - Object with images and/or texts arrays
   */
  migrateFromLegacy(existing) {
    console.log('[CompactZIndexManager] Starting migration from legacy data');
    
    const all = [];
    
    // Gather all objects (images and texts)
    for (const arr of [existing.images || [], existing.texts || []]) {
      for (const item of arr) {
        if (item && item.id) {
          all.push(item);
        }
      }
    }
    
    console.log(`[CompactZIndexManager] Found ${all.length} objects to migrate`);
    
    // First, preserve existing ranks
    const withRank = all
      .filter(x => x.rank && typeof x.rank === 'string')
      .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
    
    console.log(`[CompactZIndexManager] ${withRank.length} objects already have ranks`);
    
    for (const item of withRank) {
      this.objectRank.set(item.id, { 
        rank: item.rank, 
        type: item.type || "image" 
      });
    }
    
    // Then assign ranks to remaining objects based on their z-index
    const withoutRank = all
      .filter(x => !x.rank || typeof x.rank !== 'string')
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    
    console.log(`[CompactZIndexManager] ${withoutRank.length} objects need rank assignment`);
    
    let lastRank = withRank.length > 0 ? withRank[withRank.length - 1].rank : "";
    
    for (const item of withoutRank) {
      lastRank = rankAfter(lastRank);
      this.objectRank.set(item.id, { 
        rank: lastRank, 
        type: item.type || "image" 
      });
    }
    
    this.dirty = true;
    
    console.log(`[CompactZIndexManager] Migration complete: ${this.objectRank.size} objects in rank system`);
  }

  /**
   * Clear all data
   */
  clear() {
    this.objectRank.clear();
    this.orderCache = null;
    this.dirty = true;
    this.undoHistory = [];
  }

  /**
   * Get all objects sorted by rank
   * @returns {Array} Sorted array of {id, rank, type}
   */
  getAllObjectsSorted() {
    return this.#sorted().map(o => ({
      id: o.id,
      rank: o.rank,
      type: o.type
    }));
  }

  /**
   * Create undo point (kept for compatibility)
   */
  createUndoPoint(label = '') {
    const snapshot = {
      label,
      timestamp: Date.now(),
      data: new Map(this.objectRank)
    };
    
    this.undoHistory.push(snapshot);
    
    if (this.undoHistory.length > this.maxUndoSteps) {
      this.undoHistory.shift();
    }
  }

  /**
   * Undo last operation (kept for compatibility)
   */
  undo() {
    if (this.undoHistory.length === 0) {
      return false;
    }
    
    const snapshot = this.undoHistory.pop();
    this.objectRank = new Map(snapshot.data);
    this.dirty = true;
    
    return true;
  }

  /**
   * Get stats about the manager state
   */
  getStats() {
    const list = this.#sorted();
    const rankLengths = list.map(o => o.rank.length);
    
    return {
      objectCount: this.objectRank.size,
      minRankLength: rankLengths.length > 0 ? Math.min(...rankLengths) : 0,
      maxRankLength: rankLengths.length > 0 ? Math.max(...rankLengths) : 0,
      avgRankLength: rankLengths.length > 0 
        ? (rankLengths.reduce((a, b) => a + b, 0) / rankLengths.length).toFixed(2)
        : 0
    };
  }

  /**
   * Force compact ranks (for maintenance/debugging)
   * Reassigns all ranks with even spacing
   */
  forceCompact() {
    const list = this.#sorted();
    let currentRank = "U"; // Start at middle of alphabet
    
    for (const obj of list) {
      this.objectRank.get(obj.id).rank = currentRank;
      currentRank = rankAfter(currentRank);
    }
    
    this.dirty = true;
    console.log('[CompactZIndexManager] Forced compaction complete');
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Get sorted list of objects (cached)
   * @returns {Array} Sorted array of {id, rank, type}
   */
  #sorted() {
    if (!this.dirty && this.orderCache) {
      return this.orderCache;
    }
    
    const list = Array.from(this.objectRank, ([id, data]) => ({
      id,
      rank: data.rank,
      type: data.type
    }));
    
    // Sort by rank, with id as tiebreaker
    list.sort((a, b) => {
      if (a.rank < b.rank) return -1;
      if (a.rank > b.rank) return 1;
      return a.id < b.id ? -1 : 1;
    });
    
    this.orderCache = list;
    this.dirty = false;
    
    return list;
  }

  /**
   * Get rank of last (topmost) object
   * @returns {string} Last rank or empty string
   */
  #getLastRank() {
    const list = this.#sorted();
    return list.length > 0 ? list[list.length - 1].rank : "";
  }
}

// Export singleton instance (for backward compatibility)
export const ZIndexManager = new CompactZIndexManager();
