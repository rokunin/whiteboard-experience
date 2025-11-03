/**
 * CompactZIndexManager - Efficient z-index management with object-to-object navigation
 * 
 * This replaces the existing ZIndexManager with a simpler, more efficient approach:
 * - Single source of truth for all z-index data
 * - Dynamic range allocation that grows with object count
 * - Object-to-object navigation (always move to next/previous actual object)
 * - Efficient O(1) operations for common cases
 */

import { ZIndexRanges } from "../main.mjs";

export class CompactZIndexManager {
  constructor(stepSize = 50, options = {}) {
    // Single source of truth: Map<objectId, zIndex>
    this.objectZIndexes = new Map();
    
    // Efficient lookups: Map<zIndex, Set<objectId>>
    this.zIndexObjects = new Map();
    
    // Step-based assignment configuration
    this.stepSize = stepSize;
    
    // Dynamic range management
    this.minZIndex = ZIndexRanges.EDITABLE_MIN;
    this.maxZIndex = ZIndexRanges.EDITABLE_MIN;
    this.nextAvailable = ZIndexRanges.EDITABLE_MIN;
    
    // Group operation flag to disable compaction
    this.isGroupOperation = false;
    
    // Undo history
    this.undoHistory = [];
    this.maxUndoSteps = 50;
    
    // DOM sync tracking and configuration
    this._failedSyncs = new Map();
    this._debugMode = false;
    this._autoCleanup = options.autoCleanup || false;
    this._onSyncFailed = options.onSyncFailed || null;
  }

  /**
   * Assign a new z-index to an object using step-based allocation
   * @param {string} objectId - The object ID
   * @returns {number} The assigned z-index
   */
  assign(objectId) {
    // Remove existing assignment if any
    this.remove(objectId);
    
    // Check if we need to expand range before assignment
    this._checkAndExpandRange();
    
    const zIndex = this.nextAvailable;
    this.objectZIndexes.set(objectId, zIndex);
    
    // Update reverse lookup
    if (!this.zIndexObjects.has(zIndex)) {
      this.zIndexObjects.set(zIndex, new Set());
    }
    this.zIndexObjects.get(zIndex).add(objectId);
    
    // Update range tracking
    if (zIndex > this.maxZIndex) {
      this.maxZIndex = zIndex;
    }
    
    // Increment next available by step size for spacing
    this.nextAvailable += this.stepSize;
    
    // Sync DOM z-index value
    this._syncDOMZIndex(objectId, zIndex);
    
    return zIndex;
  }

  /**
   * Get z-index for an object
   * @param {string} objectId - The object ID
   * @returns {number} The z-index, or EDITABLE_MIN if not found
   */
  get(objectId) {
    return this.objectZIndexes.get(objectId) || ZIndexRanges.EDITABLE_MIN;
  }

  /**
   * Set z-index for an object directly
   * @param {string} objectId - The object ID
   * @param {number} zIndex - The desired z-index
   * @returns {number} The actual z-index set (clamped to valid range)
   */
  set(objectId, zIndex) {
    // Clamp to valid range
    const clamped = Math.max(
      ZIndexRanges.EDITABLE_MIN,
      Math.min(ZIndexRanges.EDITABLE_MAX, zIndex)
    );
    
    // Remove from old position
    this.remove(objectId);
    
    // Set new position
    this.objectZIndexes.set(objectId, clamped);
    
    // Update reverse lookup
    if (!this.zIndexObjects.has(clamped)) {
      this.zIndexObjects.set(clamped, new Set());
    }
    this.zIndexObjects.get(clamped).add(objectId);
    
    // Update range tracking
    if (clamped > this.maxZIndex) {
      this.maxZIndex = clamped;
    }
    if (clamped < this.minZIndex) {
      this.minZIndex = clamped;
    }
    
    // Update nextAvailable if we're setting beyond current range
    if (clamped >= this.nextAvailable) {
      this.nextAvailable = clamped + 1;
    }
    
    // Sync DOM z-index value
    this._syncDOMZIndex(objectId, clamped);
    
    return clamped;
  }

  /**
   * Synchronize DOM z-index with manager value
   * @param {string} objectId - The object ID
   * @param {number} zIndex - The z-index value to set in DOM
   * @private
   */
  _syncDOMZIndex(objectId, zIndex) {
    const container = document.getElementById(objectId);
    if (container) {
      // Validate current z-index before updating
      const currentZIndex = parseInt(container.style.zIndex) || 0;
      if (currentZIndex !== zIndex) {
        container.style.zIndex = zIndex;
        
        // Track successful sync for debugging
        if (this._debugMode) {
          console.log(`[CompactZIndexManager] Synced DOM z-index for ${objectId}: ${currentZIndex} → ${zIndex}`);
        }
      }
    } else {
      // Element doesn't exist in DOM - log warning and track failure
      //console.warn(`[CompactZIndexManager] Cannot sync z-index for ${objectId} - element not found in DOM`);
      
      // Track failed sync attempts for debugging
      if (!this._failedSyncs) {
        this._failedSyncs = new Map();
      }
      
      const failCount = (this._failedSyncs.get(objectId) || 0) + 1;
      this._failedSyncs.set(objectId, failCount);
      
      // If element consistently fails to sync, it may have been removed
      if (failCount >= 3) {
        //console.error(`[CompactZIndexManager] Element ${objectId} has failed to sync ${failCount} times - consider removing from manager`);
        
        // Optional: Auto-cleanup after repeated failures
        if (this._autoCleanup) {
          //console.warn(`[CompactZIndexManager] Auto-removing ${objectId} from manager due to repeated sync failures`);
          this.remove(objectId);
        }
      }
      
      // Invoke callback if provided
      if (this._onSyncFailed) {
        this._onSyncFailed(objectId, zIndex);
      }
    }
  }

  /**
   * Remove an object from z-index tracking
   * @param {string} objectId - The object ID to remove
   */
  remove(objectId) {
    const currentZIndex = this.objectZIndexes.get(objectId);
    if (currentZIndex !== undefined) {
      // Remove from primary map
      this.objectZIndexes.delete(objectId);
      
      // Remove from reverse lookup
      const objectsAtZIndex = this.zIndexObjects.get(currentZIndex);
      if (objectsAtZIndex) {
        objectsAtZIndex.delete(objectId);
        // Clean up empty sets
        if (objectsAtZIndex.size === 0) {
          this.zIndexObjects.delete(currentZIndex);
        }
      }
      
      // Check if automatic compaction is needed after removal (skip during group operations)
      // TEMPORARILY DISABLED FOR TESTING
      // if (!this.isGroupOperation && this._shouldCompact()) {
      //   //console.log(`[CompactZIndexManager] Automatic compaction triggered after object removal`);
      //   this.compact();
      // }
    }
  }

  /**
   * Move object up to next object in the layer stack
   * @param {string} objectId - The object to move
   * @returns {Object} Navigation result with success, newZIndex, swappedWith, etc.
   */
  moveUp(objectId) {
    const currentZIndex = this.get(objectId);
    
    // Find next object above current position
    const nextObjectZIndex = this._findNextObjectAbove(currentZIndex);
    
    if (nextObjectZIndex === null) {
      // Debug: Log state when at_top error occurs
      const allZIndexes = Array.from(this.zIndexObjects.keys()).sort((a, b) => a - b);
      // console.log(`[CompactZIndexManager] moveUp at_top check:`, {
      //   objectId,
      //   currentZIndex,
      //   allZIndexesInMap: allZIndexes,
      //   objectZIndexesSize: this.objectZIndexes.size,
      //   zIndexObjectsSize: this.zIndexObjects.size,
      //   objectsAboveCurrent: allZIndexes.filter(z => z > currentZIndex),
      //   isLowest: currentZIndex === Math.min(...allZIndexes),
      //   isHighest: currentZIndex === Math.max(...allZIndexes)
      // });
      
      // At top boundary
      return {
        success: false,
        direction: 'up',
        changes: [],
        atBoundary: true,
        reason: 'at_top'
      };
    }
    //console.log("PgUP moveUp", objectId, nextObjectZIndex);
    // Get object(s) at target position
    const objectsAtTarget = this.zIndexObjects.get(nextObjectZIndex);
    const targetObjectId = objectsAtTarget ? objectsAtTarget.values().next().value : null;
    
    if (targetObjectId && targetObjectId !== objectId) {
      // Swap positions
      console.log(`[Swap DEBUG] Before swap: ${objectId}=${currentZIndex}, ${targetObjectId}=${nextObjectZIndex}`);
      this.set(targetObjectId, currentZIndex);
      console.log(`[Swap DEBUG] After first set: ${objectId}=${this.get(objectId)}, ${targetObjectId}=${this.get(targetObjectId)}`);
      this.set(objectId, nextObjectZIndex);
      console.log(`[Swap DEBUG] After second set: ${objectId}=${this.get(objectId)}, ${targetObjectId}=${this.get(targetObjectId)}`);
      
      return {
        success: true,
        direction: 'up',
        changes: [
          {
            objectId: objectId,
            oldZIndex: currentZIndex,
            newZIndex: nextObjectZIndex,
            swappedWith: targetObjectId
          }
        ],
        atBoundary: false,
        swappedWith: {
          id: targetObjectId,
          newZIndex: currentZIndex
        }
      };
    } else {
      // Move to target position (no collision)
      this.set(objectId, nextObjectZIndex);
      
      return {
        success: true,
        direction: 'up',
        changes: [
          {
            objectId: objectId,
            oldZIndex: currentZIndex,
            newZIndex: nextObjectZIndex,
            swappedWith: null
          }
        ],
        atBoundary: false,
        swappedWith: null
      };
    }
  }

  /**
   * Move object down to previous object in the layer stack
   * @param {string} objectId - The object to move
   * @returns {Object} Navigation result with success, newZIndex, swappedWith, etc.
   */
  moveDown(objectId) {
    const currentZIndex = this.get(objectId);
    
    // Find previous object below current position
    const prevObjectZIndex = this._findNextObjectBelow(currentZIndex);
    
    if (prevObjectZIndex === null) {
      // At bottom boundary
      return {
        success: false,
        direction: 'down',
        changes: [],
        atBoundary: true,
        reason: 'at_bottom'
      };
    }
    
    // Get object(s) at target position
    const objectsAtTarget = this.zIndexObjects.get(prevObjectZIndex);
    const targetObjectId = objectsAtTarget ? objectsAtTarget.values().next().value : null;
    
    if (targetObjectId && targetObjectId !== objectId) {
      // Swap positions
      this.set(targetObjectId, currentZIndex);
      this.set(objectId, prevObjectZIndex);
      
      return {
        success: true,
        direction: 'down',
        changes: [
          {
            objectId: objectId,
            oldZIndex: currentZIndex,
            newZIndex: prevObjectZIndex,
            swappedWith: targetObjectId
          }
        ],
        atBoundary: false,
        swappedWith: {
          id: targetObjectId,
          newZIndex: currentZIndex
        }
      };
    } else {
      // Move to target position (no collision)
      this.set(objectId, prevObjectZIndex);
      
      return {
        success: true,
        direction: 'down',
        changes: [
          {
            objectId: objectId,
            oldZIndex: currentZIndex,
            newZIndex: prevObjectZIndex,
            swappedWith: null
          }
        ],
        atBoundary: false,
        swappedWith: null
      };
    }
  }

  /**
   * Find the next object above the given z-index
   * @param {number} currentZIndex - Current z-index position
   * @returns {number|null} Z-index of next object above, or null if none
   * @private
   */
  _findNextObjectAbove(currentZIndex) {
    let nextZIndex = null;
    
    // Find the smallest z-index that is greater than current
    for (const zIndex of this.zIndexObjects.keys()) {
      if (zIndex > currentZIndex) {
        if (nextZIndex === null || zIndex < nextZIndex) {
          nextZIndex = zIndex;
        }
      }
    }
    
    return nextZIndex;
  }

  /**
   * Find the next object below the given z-index
   * @param {number} currentZIndex - Current z-index position
   * @returns {number|null} Z-index of next object below, or null if none
   * @private
   */
  _findNextObjectBelow(currentZIndex) {
    let prevZIndex = null;
    
    // Find the largest z-index that is smaller than current
    for (const zIndex of this.zIndexObjects.keys()) {
      if (zIndex < currentZIndex) {
        if (prevZIndex === null || zIndex > prevZIndex) {
          prevZIndex = zIndex;
        }
      }
    }
    
    return prevZIndex;
  }

  /**
   * Move multiple objects up as a group using step-based spacing
   * @param {string[]} objectIds - Array of object IDs to move
   * @returns {Object[]} Array of navigation results
   */
  moveUpGroup(objectIds) {
    if (objectIds.length === 0) return [];
    
    // Disable compaction during group operations
    this.isGroupOperation = true;
    
    try {
      // Get current z-indexes for the group
    const groupZIndexes = objectIds.map(id => this.get(id));
    const maxGroupZ = Math.max(...groupZIndexes);
    
    // Find insertion point for the group
    const insertionPoint = this._findGroupInsertionPoint(groupZIndexes, 'up');
    
    if (insertionPoint === null) {
      // At boundary - return failure for all objects
      return objectIds.map(() => ({
        success: false,
        direction: 'up',
        changes: [],
        atBoundary: true,
        reason: 'at_top'
      }));
    }
    
    // Sort objects by current z-index to preserve relative ordering
    const sortedObjects = objectIds.map(id => ({
      id,
      currentZ: this.get(id)
    })).sort((a, b) => a.currentZ - b.currentZ);
    
    // Move group as a block
    const results = [];
    const swappedObjects = new Map(); // targetObjectId -> oldZ (where to move swapped object)
    
    // FIRST PASS: Identify all swapped objects and collect their old positions
    sortedObjects.forEach((obj, index) => {
      const oldZ = obj.currentZ;
      const newZ = insertionPoint + (index * 5); // Tight spacing within group
      
      // Check if there's an object at the target position
      const objectsAtTarget = this.zIndexObjects.get(newZ);
      const targetObjectId = objectsAtTarget ? objectsAtTarget.values().next().value : null;
      
      if (targetObjectId && targetObjectId !== obj.id) {
        // Store swapped object info: move targetObjectId to oldZ (the selected object's old position)
        swappedObjects.set(targetObjectId, oldZ);
      }
    });
    
    // SECOND PASS: Move swapped objects FIRST (before selected objects) to avoid collisions
    for (const [swappedId, newZ] of swappedObjects) {
      this.set(swappedId, newZ);
    }
    
    // THIRD PASS: Now move the selected objects to their new positions
    sortedObjects.forEach((obj, index) => {
      const oldZ = obj.currentZ;
      const newZ = insertionPoint + (index * 5);
      
      // Check if there's an object at the target position (should be none now, since we moved swapped objects first)
      const objectsAtTarget = this.zIndexObjects.get(newZ);
      const targetObjectId = objectsAtTarget ? objectsAtTarget.values().next().value : null;
      
      // Move the object
      this.set(obj.id, newZ);
      
      results.push({
        success: true,
        direction: 'up',
        changes: [{
          objectId: obj.id,
          oldZIndex: oldZ,
          newZIndex: newZ,
          swappedWith: targetObjectId
        }],
        atBoundary: false,
        swappedWith: targetObjectId ? {
          id: targetObjectId,
          newZIndex: oldZ
        } : null
      });
    });
    
      // Return results in original input order
      return objectIds.map(id => {
        const result = results.find(r => r.changes[0].objectId === id);
        return result || {
          success: false,
          direction: 'up',
          changes: [],
          atBoundary: false,
          reason: 'not_found'
        };
      });
    } finally {
      // Re-enable compaction
      this.isGroupOperation = false;
    }
  }

  /**
   * Move multiple objects down as a group using step-based spacing
   * @param {string[]} objectIds - Array of object IDs to move
   * @returns {Object[]} Array of navigation results
   */
  moveDownGroup(objectIds) {
    if (objectIds.length === 0) return [];
    
    // Disable compaction during group operations
    this.isGroupOperation = true;
    
    try {
      // Get current z-indexes for the group
    const groupZIndexes = objectIds.map(id => this.get(id));
    const minGroupZ = Math.min(...groupZIndexes);
    
    // Find insertion point for the group
    const insertionPoint = this._findGroupInsertionPoint(groupZIndexes, 'down');
    
    if (insertionPoint === null) {
      // At boundary - return failure for all objects
      return objectIds.map(() => ({
        success: false,
        direction: 'down',
        changes: [],
        atBoundary: true,
        reason: 'at_bottom'
      }));
    }
    
    // Sort objects by current z-index to preserve relative ordering
    const sortedObjects = objectIds.map(id => ({
      id,
      currentZ: this.get(id)
    })).sort((a, b) => a.currentZ - b.currentZ);
    
    // Move group as a block
    const results = [];
    const swappedObjects = new Map(); // targetObjectId -> oldZ (where to move swapped object)
    
    // FIRST PASS: Identify all swapped objects and collect their old positions
    sortedObjects.forEach((obj, index) => {
      const oldZ = obj.currentZ;
      const newZ = insertionPoint + (index * 5); // Tight spacing within group
      
      // Check if there's an object at the target position
      const objectsAtTarget = this.zIndexObjects.get(newZ);
      const targetObjectId = objectsAtTarget ? objectsAtTarget.values().next().value : null;
      
      if (targetObjectId && targetObjectId !== obj.id) {
        // Store swapped object info: move targetObjectId to oldZ (the selected object's old position)
        swappedObjects.set(targetObjectId, oldZ);
      }
    });
    
    // SECOND PASS: Move swapped objects FIRST (before selected objects) to avoid collisions
    for (const [swappedId, newZ] of swappedObjects) {
      this.set(swappedId, newZ);
    }
    
    // THIRD PASS: Now move the selected objects to their new positions
    sortedObjects.forEach((obj, index) => {
      const oldZ = obj.currentZ;
      const newZ = insertionPoint + (index * 5);
      
      // Check if there's an object at the target position (should be none now, since we moved swapped objects first)
      const objectsAtTarget = this.zIndexObjects.get(newZ);
      const targetObjectId = objectsAtTarget ? objectsAtTarget.values().next().value : null;
      
      // Move the object
      this.set(obj.id, newZ);
      
      results.push({
        success: true,
        direction: 'down',
        changes: [{
          objectId: obj.id,
          oldZIndex: oldZ,
          newZIndex: newZ,
          swappedWith: targetObjectId
        }],
        atBoundary: false,
        swappedWith: targetObjectId ? {
          id: targetObjectId,
          newZIndex: oldZ
        } : null
      });
    });
    
      // Return results in original input order
      return objectIds.map(id => {
        const result = results.find(r => r.changes[0].objectId === id);
        return result || {
          success: false,
          direction: 'down',
          changes: [],
          atBoundary: false,
          reason: 'not_found'
        };
      });
    } finally {
      // Re-enable compaction
      this.isGroupOperation = false;
    }
  }

  /**
   * Find insertion point for group movement
   * @param {number[]} groupZIndexes - Array of z-indexes in the group
   * @param {string} direction - 'up' or 'down'
   * @returns {number|null} Insertion point z-index or null if no space
   * @private
   */
  _findGroupInsertionPoint(groupZIndexes, direction) {
    const sortedGroup = [...groupZIndexes].sort((a, b) => a - b);
    const groupMin = sortedGroup[0];
    const groupMax = sortedGroup[sortedGroup.length - 1];
    const groupSize = sortedGroup.length;
    
    if (direction === 'up') {
      // Find next object above the group
      const nextObjectZ = this._findNextObjectAbove(groupMax);
      if (nextObjectZ === null) return null;
      
      // Calculate insertion point - halfway between group max and next object
      const availableSpace = nextObjectZ - groupMax;
      const neededSpace = (groupSize - 1) * 5 + 10; // Tight spacing within group + buffer
      
      if (availableSpace >= neededSpace) {
        // Insert group starting at midpoint
        return groupMax + Math.floor(availableSpace / 2) - Math.floor((groupSize - 1) * 5 / 2);
      }
      
      // Not enough space - use simple swap with next object
      return nextObjectZ;
    } else {
      // Find previous object below the group
      const prevObjectZ = this._findNextObjectBelow(groupMin);
      if (prevObjectZ === null) return null;
      
      // Calculate insertion point - halfway between previous object and group min
      const availableSpace = groupMin - prevObjectZ;
      const neededSpace = (groupSize - 1) * 5 + 10; // Tight spacing within group + buffer
      
      if (availableSpace >= neededSpace) {
        // Insert group starting at midpoint
        return prevObjectZ + Math.floor(availableSpace / 2) - Math.floor((groupSize - 1) * 5 / 2);
      }
      
      // Not enough space - use simple swap with previous object
      return prevObjectZ;
    }
  }

  /**
   * Check if range expansion is needed and expand if necessary
   * Called automatically before new assignments
   * @private
   */
  _checkAndExpandRange() {
    const remainingSpace = ZIndexRanges.EDITABLE_MAX - this.nextAvailable;
    const expansionThreshold = 100; // Expand when less than 100 slots remain
    
    // If we're approaching the absolute limit, trigger compaction first
    if (remainingSpace < expansionThreshold) {
      console.log(`[CompactZIndexManager] Approaching z-index limit (${remainingSpace} slots remaining), triggering compaction`);
      this.compact();
      return;
    }
    
    // Calculate current utilization
    const currentRange = this.maxZIndex - this.minZIndex + 1;
    const objectCount = this.objectZIndexes.size;
    const utilization = objectCount > 0 ? objectCount / currentRange : 1;
    
    // If utilization is high (>80%), we're efficiently using space - no action needed
    // If utilization is low (<20%), we have plenty of gaps - no expansion needed
    // This method primarily ensures we don't run out of space at the top end
    if (utilization > 0.8 && remainingSpace < (objectCount * 0.5)) {
      // High utilization and limited remaining space - prepare for more objects
      console.log(`[CompactZIndexManager] High utilization (${Math.round(utilization * 100)}%) with limited space, range ready for expansion`);
    }
  }

  /**
   * Check if automatic compaction is needed based on range utilization
   * @returns {boolean} True if compaction is recommended
   * @private
   */
  _shouldCompact() {
    if (this.objectZIndexes.size === 0) return false;
    
    const currentRange = this.maxZIndex - this.minZIndex + 1;
    const objectCount = this.objectZIndexes.size;
    const utilization = objectCount / currentRange;
    
    // Compact when utilization drops below 20% (excessive gaps)
    // This means we're using less than 1/5 of our allocated range
    const compactionThreshold = 0.2;
    
    return utilization < compactionThreshold && currentRange > objectCount * 5;
  }

  /**
   * Compact the z-index range by removing gaps
   * This is called automatically when the range becomes too sparse
   * @returns {boolean} True if compaction was performed
   */
  compact() {
    if (this.objectZIndexes.size === 0) return false;
    
    const beforeStats = this.getStats();
    
    // Get all used z-indexes in sorted order
    const usedZIndexes = Array.from(this.zIndexObjects.keys()).sort((a, b) => a - b);
    
    // Reassign z-indexes starting from EDITABLE_MIN with step-based spacing
    let newZIndex = ZIndexRanges.EDITABLE_MIN;
    const remapping = new Map();
    
    for (const oldZIndex of usedZIndexes) {
      const objectsAtZIndex = this.zIndexObjects.get(oldZIndex);
      if (objectsAtZIndex && objectsAtZIndex.size > 0) {
        remapping.set(oldZIndex, newZIndex);
        newZIndex += this.stepSize; // Use step-based spacing during compaction
      }
    }
    
    // Apply remapping
    const newObjectZIndexes = new Map();
    const newZIndexObjects = new Map();
    
    for (const [objectId, oldZIndex] of this.objectZIndexes) {
      const newZ = remapping.get(oldZIndex);
      if (newZ !== undefined) {
        newObjectZIndexes.set(objectId, newZ);
        
        if (!newZIndexObjects.has(newZ)) {
          newZIndexObjects.set(newZ, new Set());
        }
        newZIndexObjects.get(newZ).add(objectId);
      }
    }
    
    // Update internal state
    this.objectZIndexes = newObjectZIndexes;
    this.zIndexObjects = newZIndexObjects;
    this.minZIndex = ZIndexRanges.EDITABLE_MIN;
    this.maxZIndex = newZIndex - this.stepSize; // Adjust for step-based spacing
    this.nextAvailable = newZIndex;
    
    const afterStats = this.getStats();
    
    
    // Sync all DOM elements after compaction
    this.syncAllDOMZIndexes();
    
    return true;
  }

  /**
   * Create an undo point for the current state
   */
  createUndoPoint() {
    const snapshot = {
      timestamp: Date.now(),
      objectZIndexes: new Map(this.objectZIndexes),
      zIndexObjects: new Map(),
      minZIndex: this.minZIndex,
      maxZIndex: this.maxZIndex,
      nextAvailable: this.nextAvailable
    };
    
    // Deep copy zIndexObjects
    for (const [zIndex, objectSet] of this.zIndexObjects) {
      snapshot.zIndexObjects.set(zIndex, new Set(objectSet));
    }
    
    this.undoHistory.push(snapshot);
    
    // Limit history size
    if (this.undoHistory.length > this.maxUndoSteps) {
      this.undoHistory.shift();
    }
  }

  /**
   * Undo the last z-index changes
   * @returns {boolean} True if undo was successful, false if no history
   */
  undo() {
    if (this.undoHistory.length === 0) {
      return false;
    }
    
    const snapshot = this.undoHistory.pop();
    
    // Restore state
    this.objectZIndexes = snapshot.objectZIndexes;
    this.zIndexObjects = snapshot.zIndexObjects;
    this.minZIndex = snapshot.minZIndex;
    this.maxZIndex = snapshot.maxZIndex;
    this.nextAvailable = snapshot.nextAvailable;
    
    return true;
  }

  /**
   * Get all objects sorted by z-index (lowest to highest)
   * @returns {Array} Array of {objectId, zIndex} objects
   */
  getAllObjectsSorted() {
    return Array.from(this.objectZIndexes.entries())
      .map(([objectId, zIndex]) => ({ objectId, zIndex }))
      .sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Get statistics about the current z-index usage
   * @returns {Object} Statistics object
   */
  getStats() {
    const totalObjects = this.objectZIndexes.size;
    const rangeSize = this.maxZIndex - this.minZIndex + 1;
    const utilization = totalObjects > 0 ? (totalObjects / rangeSize) * 100 : 0;
    const shouldCompact = this._shouldCompact();
    const remainingSpace = ZIndexRanges.EDITABLE_MAX - this.nextAvailable;
    const remainingSlots = Math.floor(remainingSpace / this.stepSize);
    
    // Calculate sync health
    const totalFailedSyncs = Array.from(this._failedSyncs.values()).reduce((sum, count) => sum + count, 0);
    const elementsWithFailedSyncs = this._failedSyncs.size;
    
    return {
      totalObjects,
      minZIndex: this.minZIndex,
      maxZIndex: this.maxZIndex,
      rangeSize,
      utilization: Math.round(utilization * 100) / 100,
      nextAvailable: this.nextAvailable,
      undoHistorySize: this.undoHistory.length,
      shouldCompact,
      remainingSpace,
      remainingSlots, // How many more objects can be assigned
      stepSize: this.stepSize,
      compactionThreshold: 20, // 20% utilization threshold
      nearingLimit: remainingSlots < 20, // Less than 20 slots remaining
      
      // DOM sync health metrics
      syncHealth: {
        totalFailedSyncs,
        elementsWithFailedSyncs,
        failedSyncDetails: Array.from(this._failedSyncs.entries()).map(([id, count]) => ({ id, failCount: count }))
      }
    };
  }

  /**
   * Force compaction of the z-index range
   * This can be called manually or is triggered automatically
   * @returns {boolean} True if compaction was performed
   */
  forceCompact() {
    if (this.objectZIndexes.size === 0) {
      console.log(`[CompactZIndexManager] No objects to compact`);
      return false;
    }
    
    console.log(`[CompactZIndexManager] Manual compaction requested`);
    return this.compact();
  }

  /**
   * Synchronize all DOM z-index values with manager values
   * Call this after major operations to ensure DOM is in sync
   * @returns {Object} Sync results with counts and failures
   */
  syncAllDOMZIndexes() {
    let syncCount = 0;
    let missingCount = 0;
    const missingElements = [];
    
    for (const [objectId, zIndex] of this.objectZIndexes) {
      const container = document.getElementById(objectId);
      if (container) {
        const currentDOMZIndex = parseInt(container.style.zIndex) || 0;
        if (currentDOMZIndex !== zIndex) {
          container.style.zIndex = zIndex;
          syncCount++;
        }
      } else {
        // Track missing elements
        missingCount++;
        missingElements.push(objectId);
        
        // Update failed sync tracking
        const failCount = (this._failedSyncs.get(objectId) || 0) + 1;
        this._failedSyncs.set(objectId, failCount);
      }
    }
    
    if (syncCount > 0) {
      console.log(`[CompactZIndexManager] Synced ${syncCount} DOM z-index values`);
    }
    
    if (missingCount > 0) {
      console.warn(`[CompactZIndexManager] ${missingCount} elements not found in DOM:`, missingElements);
      
      // Auto-cleanup if enabled
      if (this._autoCleanup) {
        console.warn(`[CompactZIndexManager] Auto-removing ${missingCount} missing elements from manager`);
        missingElements.forEach(id => this.remove(id));
      }
    }
    
    return {
      synced: syncCount,
      missing: missingCount,
      missingElements,
      total: this.objectZIndexes.size
    };
  }

  /**
   * Clear all z-index data and reset to initial state
   * Used for cleanup and testing
   */
  clear() {
    this.objectZIndexes.clear();
    this.zIndexObjects.clear();
    this.minZIndex = ZIndexRanges.EDITABLE_MIN;
    this.maxZIndex = ZIndexRanges.EDITABLE_MIN;
    this.nextAvailable = ZIndexRanges.EDITABLE_MIN;
    this.undoHistory = [];
    this._failedSyncs.clear();
    
    console.log('[CompactZIndexManager] All data cleared and reset to initial state');
  }

  /**
   * Migrate data from the legacy ZIndexManager
   * @param {Array} existingData - Array of {id, zIndex, type} objects
   */
  migrateFromLegacy(existingData) {
    console.log(`[CompactZIndexManager] Migrating ${existingData.length} objects from legacy system`);
    console.log('[CompactZIndexManager] Current state before migration:', {
      objectCount: this.objectZIndexes.size,
      reverseCount: Array.from(this.zIndexObjects.values()).reduce((sum, set) => sum + set.size, 0)
    });
    
    // Clear current state
    this.objectZIndexes.clear();
    this.zIndexObjects.clear();
    
    // Import existing data
    for (const { id, zIndex } of existingData) {
      if (typeof zIndex === 'number' && zIndex >= ZIndexRanges.EDITABLE_MIN && zIndex <= ZIndexRanges.EDITABLE_MAX) {
        console.log(`[CompactZIndexManager] Migrating ${id} -> ${zIndex}`);
        this.set(id, zIndex);
      }
    }
    
    // Update next available to be higher than any existing
    if (this.objectZIndexes.size > 0) {
      this.nextAvailable = this.maxZIndex + 1;
    }
    
    console.log(`[CompactZIndexManager] Migration complete: ${this.objectZIndexes.size} objects migrated`);
    console.log('[CompactZIndexManager] Final state after migration:', {
      objectCount: this.objectZIndexes.size,
      reverseCount: Array.from(this.zIndexObjects.values()).reduce((sum, set) => sum + set.size, 0),
      availableZIndexes: Array.from(this.zIndexObjects.keys()).sort((a,b) => a-b)
    });
  }
}