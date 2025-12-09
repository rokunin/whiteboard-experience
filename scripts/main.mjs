/**
 * Whiteboard Experience - Simplified Core
 * Principles: DRY, KISS, YAGNI, SOLID
 */

// Load wbe-logger first so it's available globally
import { WbeLogger } from "./modules/wbe-logger.mjs";
window.WbeLogger = WbeLogger;

// Fractional indexing for z-index management (external utility, pure functions)
import { rankBetween, rankAfter, rankBefore } from './modules/fractional-index.mjs';

// ==========================================
// FOUNDRY HOOKS - Bootstrap
// ==========================================

// Register module settings (must be in 'init' hook, before 'ready')
Hooks.once("init", () => {
  if (window.WBE_registerSettings) {
    window.WBE_registerSettings();
  }
});

// Initialize whiteboard after game is ready
Hooks.once("ready", async () => {
  // Load Google Fonts from settings
  if (window.WBE_loadGoogleFonts) {
    window.WBE_loadGoogleFonts();
  }
  
  // Initialize whiteboard
  if (window.Whiteboard) {
    await window.Whiteboard.init();
  }
  console.log(`whiteboard-experience | Initialized`);
});

// Handler-based event system (declarative architecture)
import { HandlerResolver } from './modules/handler-resolver.mjs';
import { EventContext } from './modules/event-context.mjs';
import { getAllMouseDownHandlers } from './modules/mousedown-handlers.mjs';

// Use wbe-logger if available (should be loaded via scripts/main.mjs)
// Logger will be used in future steps for instrumentation
// For now, just ensure it's available globally
if (!window.WbeLogger) {
  window.WbeLogger = {
    flags: {},
    start: () => null,
    step: () => {},
    finish: () => {},
    error: () => {},
    getLogs: () => [],
    clear: () => {}
  };
}
const MODULE_ID = "whiteboard-experience";
const LAYER_ID = "whiteboard-experience-layer";
const SOCKET_NAME = `module.${MODULE_ID}`;
const ZINDEX_TEXT_COLOR_PICKER = 20100;
const ZINDEX_GM_WARNING_INDICATOR = 30003; // Above SELECTION_INDICATOR (30001)

// Default constants
const DEFAULT_TEXT_COLOR = "#000000";
const DEFAULT_BACKGROUND_COLOR = "transparent";
const DEFAULT_SPAN_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_BORDER_HEX = DEFAULT_TEXT_COLOR;
const DEFAULT_BORDER_OPACITY = 100;
const DEFAULT_BORDER_WIDTH = 0;
const DEFAULT_BORDER_RADIUS = 0;
const DEFAULT_SHADOW_HEX = '#000000';
const DEFAULT_SHADOW_OPACITY = 0;
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FONT_STYLE = "normal";
const DEFAULT_TEXT_ALIGN = "left";
const DEFAULT_FONT_FAMILY = "Arial";
const DEFAULT_FONT_SIZE = 16;

// Resize handle offset constants (half the handle size: 12px / 2)
const RESIZE_HANDLE_OFFSET_X = -6;
const RESIZE_HANDLE_OFFSET_Y = -6;

// Default Google Fonts (popular, support Latin + Cyrillic)
const DEFAULT_GOOGLE_FONTS = [
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Oswald',
  'Raleway',
  'Merriweather',
  'Playfair Display',
  'Nunito',
  'Ubuntu'
];

// System fonts (always available)
const SYSTEM_FONTS = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 
  'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS'
];

console.log(`${MODULE_ID} | Initialized`);

// ==========================================
// Module Settings Registration
// ==========================================

/**
 * Register module settings (call from Hooks.once('init'))
 */
function registerModuleSettings() {
  // Feature toggles
  game.settings.register(MODULE_ID, 'enableTexts', {
    name: 'Enable Text Objects',
    hint: 'Allow creating and editing text objects on the whiteboard.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, 'enableImages', {
    name: 'Enable Image Objects',
    hint: 'Allow creating and editing image objects on the whiteboard.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, 'enableMassSelection', {
    name: 'Enable Mass Selection',
    hint: 'Allow selecting multiple objects at once with Shift+drag or toggle mode.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  // Google Fonts setting
  game.settings.register(MODULE_ID, 'googleFonts', {
    name: 'Google Fonts',
    hint: 'Comma-separated list of Google Font names (e.g., Roboto, Open Sans, Lato). Leave empty to use defaults.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_GOOGLE_FONTS.join(', '),
    onChange: value => _loadGoogleFonts(value)
  });
  
  console.log(`${MODULE_ID} | Settings registered`);
}

/**
 * Get feature toggle state
 * @param {string} feature - Feature name (texts, images, massSelection)
 * @returns {boolean}
 */
function isFeatureEnabled(feature) {
  const settingMap = {
    texts: 'enableTexts',
    images: 'enableImages',
    massSelection: 'enableMassSelection'
  };
  const settingName = settingMap[feature];
  if (!settingName) return true;
  try {
    return game.settings.get(MODULE_ID, settingName);
  } catch {
    return true; // Default to enabled if setting not found
  }
}

/**
 * Load Google Fonts from settings or defaults
 * @param {string} [fontsString] - Optional comma-separated font names
 */
function _loadGoogleFonts(fontsString) {
  // Get fonts from parameter or settings
  let fonts;
  if (fontsString !== undefined) {
    fonts = fontsString.split(',').map(f => f.trim()).filter(Boolean);
  } else if (game.settings) {
    try {
      const setting = game.settings.get(MODULE_ID, 'googleFonts');
      fonts = setting ? setting.split(',').map(f => f.trim()).filter(Boolean) : DEFAULT_GOOGLE_FONTS;
    } catch {
      fonts = DEFAULT_GOOGLE_FONTS;
    }
  } else {
    fonts = DEFAULT_GOOGLE_FONTS;
  }
  
  if (fonts.length === 0) {
    console.log(`${MODULE_ID} | No Google Fonts to load`);
    return;
  }
  
  // Remove old link if exists
  document.getElementById('wbe-google-fonts')?.remove();
  
  // Create new link with all fonts
  // Format: family=Font+Name:wght@400;700&family=Other+Font
  const families = fonts.map(f => `family=${f.replace(/ /g, '+')}:wght@400;700`).join('&');
  const link = document.createElement('link');
  link.id = 'wbe-google-fonts';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  link.rel = 'stylesheet';
  document.head.appendChild(link);
  
  console.log(`${MODULE_ID} | Loaded ${fonts.length} Google Fonts:`, fonts);
}

/**
 * Get list of Google Fonts from settings
 * @returns {string[]} Array of font names
 */
function _getGoogleFonts() {
  try {
    if (game.settings) {
      const setting = game.settings.get(MODULE_ID, 'googleFonts');
      if (setting) {
        return setting.split(',').map(f => f.trim()).filter(Boolean);
      }
    }
  } catch {}
  return DEFAULT_GOOGLE_FONTS;
}

// ==========================================
// 0. Utility Functions
// ==========================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function hexToRgba(hex, opacity = 100) {
  if (!hex || typeof hex !== "string") return null;
  const normalized = hex.replace("#", "");
  if (![3, 6].includes(normalized.length)) return null;
  const full = normalized.length === 3 ? normalized.split("").map(ch => ch + ch).join("") : normalized;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const alpha = clamp(Number(opacity) / 100, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
const normalizeFontWeight = value => {
  if (!value) return DEFAULT_FONT_WEIGHT;
  if (value === "bold") return 700;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_FONT_WEIGHT;
};
const normalizeFontStyle = value => {
  if (!value) return DEFAULT_FONT_STYLE;
  return value === "italic" ? "italic" : DEFAULT_FONT_STYLE;
};
async function getAvailableFonts() {
  // Combine system fonts + Google Fonts from settings
  const googleFonts = _getGoogleFonts();
  const allFonts = [...SYSTEM_FONTS, ...googleFonts];
  
  // Remove duplicates and sort (system fonts first, then Google Fonts)
  const uniqueFonts = [...new Set(allFonts)];
  
  // Wait for fonts to load (for accurate font detection)
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch {}
  
  return uniqueFonts;
}

/**
 * HTML sanitization for safe storage and display
 * Removes dangerous tags and attributes, leaves only safe tags for text formatting
 * @param {string} html - HTML HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Create a temporary element for HTML parsing
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Allowed tags for text formatting
  const allowedTags = ['strong', 'em', 'b', 'i', 'u', 'span', 'div', 'p', 'br'];
  
  // Allowed attributes for styles
  const allowedAttributes = ['style'];

  /**
   * Recursive function for cleaning elements
   * Processes all child elements recursively
   */
  function cleanElement(element) {
    // Process all child elements in reverse order (to avoid breaking indices when removing)
    const children = Array.from(element.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toLowerCase();
        
        // If tag is not allowed - replace with text node
        if (!allowedTags.includes(tagName)) {
          const textNode = document.createTextNode(child.textContent);
          element.replaceChild(textNode, child);
          continue;
        }

        // Clean attributes - keep only allowed ones
        const attributes = Array.from(child.attributes);
        for (const attr of attributes) {
          if (!allowedAttributes.includes(attr.name)) {
            child.removeAttribute(attr.name);
          } else if (attr.name === 'style') {
            // Sanitize style attribute - keep only safe CSS properties
            const style = child.getAttribute('style');
            if (style) {
              const safeStyles = [];
              const stylePairs = style.split(';');
              for (const pair of stylePairs) {
                const [prop, value] = pair.split(':').map(s => s.trim());
                if (prop && value) {
                  // Allowed CSS properties for text formatting
                  const allowedProps = [
                    'color', 'background-color', 'font-size', 'font-weight', 
                    'font-style', 'font-family', 'text-align', 'text-decoration'
                  ];
                  if (allowedProps.includes(prop.toLowerCase())) {
                    safeStyles.push(`${prop}: ${value}`);
                  }
                }
              }
              if (safeStyles.length > 0) {
                child.setAttribute('style', safeStyles.join('; '));
              } else {
                child.removeAttribute('style');
              }
            }
          }
        }

        // Recursively clean child elements
        cleanElement(child);
      } else if (child.nodeType === Node.TEXT_NODE) {
        // // Leave text nodes as is
        continue;
      } else {
        // // Remove all other node types (comments, CDATA, etc.)
        element.removeChild(child);
      }
    }
  }

  cleanElement(temp);
  return temp.innerHTML;
}

// ==========================================
// 0.5 ZIndexModel - Fractional Indexing for Z-Order
// ==========================================
/**
 * ZIndexModel - Model for z-index management using fractional indexing
 * 
 * ARCHITECTURE:
 * - ONLY data and calculation logic
 * - NO DOM operations (WhiteboardLayer responsibility)
 * - NO singleton (created by Whiteboard, passed to Registry)
 * 
 * Benefits of fractional indexing:
 * - No conflicts during concurrent operations
 * - Only changed object needs to be updated
 * - O(1) insert at any position
 */
class ZIndexModel {
  constructor(baseZ = 1000) {
    this.objectRank = new Map(); // Map<id, {rank: string, type: string}>
    this.baseZ = baseZ;
    this._orderCache = null;
    this._dirty = true;
  }

  /**
   * Assign rank to new object (places at top)
   * @param {string} objectId - Object ID
   * @param {string} type - Object type ('text' | 'image')
   * @returns {number} Calculated DOM z-index
   */
  assign(objectId, type = 'image') {
    if (this.objectRank.has(objectId)) {
      const existingZ = this.get(objectId);
      console.log(`[ZIndexModel] assign: ${objectId.slice(-6)} already exists, z=${existingZ}`);
      return existingZ;
    }
    
    // Get last rank BEFORE adding (uses current cache)
    let lastRank = this._getLastRank();
    let rank = rankAfter(lastRank);
    
    // CRITICAL: Check for race condition - if rank already exists, generate unique one
    // This can happen when multiple objects are created in quick succession
    let attempts = 0;
    const maxAttempts = 10;
    while (this._rankExists(rank) && attempts < maxAttempts) {
      console.warn(`[ZIndexModel] assign: rank "${rank}" already exists, generating new one (attempt ${attempts + 1})`);
      rank = rankAfter(rank); // Generate next rank
      attempts++;
    }
    
    console.log(`[ZIndexModel] assign: ${objectId.slice(-6)}, lastRank="${lastRank}", newRank="${rank}"${attempts > 0 ? ` (fixed after ${attempts} attempts)` : ''}`);
    
    // Add to map and invalidate cache
    this.objectRank.set(objectId, { rank, type });
    this._dirty = true; // CRITICAL: invalidate AFTER adding to map
    
    const zIndex = this.get(objectId);
    console.log(`[ZIndexModel] assign: ${objectId.slice(-6)} → z=${zIndex}, total objects=${this.objectRank.size}`);
    
    return zIndex;
  }
  
  /**
   * Check if rank already exists in objectRank
   */
  _rankExists(rank) {
    for (const entry of this.objectRank.values()) {
      if (entry.rank === rank) return true;
    }
    return false;
  }

  /**
   * Assign with specific rank (for loading from DB)
   * @param {string} objectId - Object ID
   * @param {string} rank - Rank string
   * @param {string} type - Object type
   * @returns {number} Calculated DOM z-index
   */
  assignWithRank(objectId, rank, type = 'image') {
    if (!rank || typeof rank !== 'string') {
      return this.assign(objectId, type);
    }
    
    // CRITICAL: Check for duplicate ranks from other objects
    // This can happen with corrupted DB data or migration issues
    const existingWithSameRank = Array.from(this.objectRank.entries())
      .find(([id, entry]) => id !== objectId && entry.rank === rank);
    
    if (existingWithSameRank) {
      console.warn(`[ZIndexModel] DUPLICATE RANK detected: "${rank}" already used by ${existingWithSameRank[0].slice(-6)}, generating new rank for ${objectId.slice(-6)}`);
      // Generate a unique rank after the duplicate
      const newRank = rankAfter(rank);
      this.objectRank.set(objectId, { rank: newRank, type });
      this._dirty = true;
      console.log(`[ZIndexModel] assignWithRank: ${objectId.slice(-6)} -> rank=${newRank} (fixed duplicate)`);
      return this.get(objectId);
    }
    
    // Add to map and invalidate cache
    this.objectRank.set(objectId, { rank, type });
    this._dirty = true; // CRITICAL: invalidate AFTER adding to map
    
    return this.get(objectId);
  }

  /**
   * Get DOM z-index for object (derived from rank order)
   * @param {string} objectId - Object ID
   * @returns {number} DOM z-index
   */
  get(objectId) {
    const list = this._sorted();
    const idx = list.findIndex(o => o.id === objectId);
    return idx < 0 ? this.baseZ : (this.baseZ + idx);
  }

  /**
   * Get rank string for object
   * @param {string} objectId - Object ID
   * @returns {string} Rank string or empty
   */
  getRank(objectId) {
    return this.objectRank.get(objectId)?.rank || '';
  }

  /**
   * Check if object exists
   */
  has(objectId) {
    return this.objectRank.has(objectId);
  }

  /**
   * Move object up/down in z-order
   * @param {string} objectId - Object ID
   * @param {number} delta - Positive for up (higher z), negative for down
   * @returns {{ success: boolean, newZIndex: number, newRank: string, atBoundary?: boolean }}
   */
  move(objectId, delta) {
    const list = this._sorted();
    const fromIndex = list.findIndex(o => o.id === objectId);
    
    console.log(`[ZIndexModel.move] START: id=${objectId.slice(-8)}, delta=${delta}`);
    console.log(`[ZIndexModel.move] List BEFORE:`, list.map((o, i) => `${i}:${o.id.slice(-8)}[rank=${o.rank}]`).join(', '));
    console.log(`[ZIndexModel.move] fromIndex=${fromIndex}, isTopObject=${fromIndex === list.length - 1}`);
    
    if (fromIndex < 0) {
      return { success: false, newZIndex: this.baseZ, newRank: '' };
    }

    const toIndex = Math.max(0, Math.min(list.length - 1, fromIndex + delta));
    console.log(`[ZIndexModel.move] toIndex=${toIndex}`);
    
    if (toIndex === fromIndex) {
      console.log(`[ZIndexModel.move] AT BOUNDARY - no movement possible`);
      return { 
        success: true, 
        newZIndex: this.baseZ + fromIndex, 
        newRank: this.getRank(objectId),
        atBoundary: true 
      };
    }

    const currentRank = this.getRank(objectId);
    let beforeRank, afterRank;
    
    if (delta > 0) {
      // Moving up: insert after toIndex
      const adjustedToIndex = fromIndex < toIndex ? toIndex : toIndex;
      beforeRank = list[adjustedToIndex]?.rank ?? '';
      afterRank = list[adjustedToIndex + 1]?.rank ?? '';
      console.log(`[ZIndexModel.move] Moving UP: beforeRank=${beforeRank}, afterRank=${afterRank}`);
    } else {
      // Moving down: insert before toIndex
      if (toIndex > 0) {
      beforeRank = list[toIndex - 1]?.rank ?? '';
      afterRank = list[toIndex]?.rank ?? '';
        console.log(`[ZIndexModel.move] Moving DOWN: toIndex=${toIndex}, beforeRank=${beforeRank} (from idx ${toIndex-1}), afterRank=${afterRank} (from idx ${toIndex})`);
      } else {
        // Moving to bottom (toIndex = 0), use rankBefore
        const firstRank = list[0]?.rank ?? '';
        const newRank = rankBefore(firstRank);
        console.log(`[ZIndexModel.move] Moving to BOTTOM: firstRank=${firstRank}, newRank=${newRank}`);
        this.objectRank.get(objectId).rank = newRank;
        this._dirty = true;
        const actualZIndex = this.get(objectId);
        console.log(`[ZIndexModel.move] List AFTER:`, this._sorted().map((o, i) => `${i}:${o.id.slice(-8)}[rank=${o.rank}]`).join(', '));
        return {
          success: true,
          newZIndex: actualZIndex,
          newRank: newRank
        };
      }
    }
    
    // CRITICAL: Handle duplicate ranks (beforeRank === afterRank)
    // This can happen if objects were created with same rank from DB or migration issues
    // In this case, rankBetween would return a rank AFTER both, not between them
    let newRank;
    if (beforeRank === afterRank) {
      // Can't insert between identical ranks - use rankBefore to go BEFORE the target
      console.log(`[ZIndexModel.move] DUPLICATE RANKS detected: beforeRank=${beforeRank}, afterRank=${afterRank}`);
      newRank = rankBefore(afterRank);
      console.log(`[ZIndexModel.move] Using rankBefore(${afterRank}) = ${newRank}`);
    } else {
      newRank = rankBetween(beforeRank, afterRank);
    }
    
    console.log(`[ZIndexModel.move] currentRank=${currentRank}, newRank=${newRank}`);
    console.log(`[ZIndexModel.move] Rank comparison: newRank < afterRank? ${newRank < afterRank}, newRank > beforeRank? ${newRank > beforeRank}`);
    
    this.objectRank.get(objectId).rank = newRank;
    this._dirty = true;

    const actualZIndex = this.get(objectId);
    console.log(`[ZIndexModel.move] List AFTER:`, this._sorted().map((o, i) => `${i}:${o.id.slice(-8)}[rank=${o.rank}]`).join(', '));
    console.log(`[ZIndexModel.move] RESULT: actualZIndex=${actualZIndex}, expectedToIndex=${toIndex}`);

    return {
      success: true,
      newZIndex: actualZIndex,
      newRank: newRank
    };
  }

  /**
   * Move object to top
   */
  moveToTop(objectId) {
    if (!this.objectRank.has(objectId)) {
      return { success: false, newZIndex: this.baseZ, newRank: '' };
    }
    
    const lastRank = this._getLastRank();
    const entry = this.objectRank.get(objectId);
    
    // Already at top?
    if (entry.rank === lastRank) {
      return { success: true, newZIndex: this.get(objectId), newRank: entry.rank, atBoundary: true };
    }
    
    const newRank = rankAfter(lastRank);
    entry.rank = newRank;
    this._dirty = true;
    
    return { success: true, newZIndex: this.get(objectId), newRank };
  }

  /**
   * Move object to bottom
   */
  moveToBottom(objectId) {
    if (!this.objectRank.has(objectId)) {
      return { success: false, newZIndex: this.baseZ, newRank: '' };
    }
    
    const firstRank = this._getFirstRank();
    const entry = this.objectRank.get(objectId);
    
    // Already at bottom?
    if (entry.rank === firstRank) {
      return { success: true, newZIndex: this.get(objectId), newRank: entry.rank, atBoundary: true };
    }
    
    const newRank = rankBefore(firstRank);
    entry.rank = newRank;
    this._dirty = true;
    
    return { success: true, newZIndex: this.get(objectId), newRank };
  }

  /**
   * Remove object from z-index management
   */
  remove(objectId) {
    if (this.objectRank.delete(objectId)) {
      this._dirty = true;
      return true;
    }
    return false;
  }

  /**
   * Get all objects sorted by z-index (for debugging/export)
   */
  getAllSorted() {
    return this._sorted().map(o => ({
      id: o.id,
      rank: o.rank,
      type: o.type,
      zIndex: this.baseZ + this._sorted().findIndex(x => x.id === o.id)
    }));
  }

  /**
   * Clear all data
   */
  clear() {
    this.objectRank.clear();
    this._orderCache = null;
    this._dirty = true;
  }

  /**
   * Get count of managed objects
   */
  get size() {
    return this.objectRank.size;
  }

  /**
   * Move a group of objects as a unit (preserving internal order)
   * @param {Array<string>} objectIds - Array of object IDs to move
   * @param {number} delta - Direction: positive = up (higher z), negative = down (lower z)
   * @returns {object} Result with success, changes array, atBoundary flag
   */
  moveGroupAsUnit(objectIds, delta) {
    const list = this._sorted();
    const groupSet = new Set(objectIds);
    
    // Find group members with their current positions
    const groupMembers = list
      .map((obj, index) => ({ ...obj, index }))
      .filter(obj => groupSet.has(obj.id))
      .sort((a, b) => a.index - b.index); // Sort by current position (bottom to top)
    
    if (groupMembers.length === 0) {
      return { success: false, changes: [], reason: 'no_objects_found' };
    }
    
    // Find boundaries of the group
    const bottomIndex = groupMembers[0].index;
    const topIndex = groupMembers[groupMembers.length - 1].index;
    
    // Find target: first non-group object in the direction
    let targetIndex;
    if (delta > 0) {
      // Moving up: find first non-group object above the group
      targetIndex = topIndex + 1;
      while (targetIndex < list.length && groupSet.has(list[targetIndex].id)) {
        targetIndex++;
      }
      if (targetIndex >= list.length) {
        return { success: true, changes: [], atBoundary: true, reason: 'at_top' };
      }
    } else {
      // Moving down: find first non-group object below the group
      targetIndex = bottomIndex - 1;
      while (targetIndex >= 0 && groupSet.has(list[targetIndex].id)) {
        targetIndex--;
      }
      if (targetIndex < 0) {
        return { success: true, changes: [], atBoundary: true, reason: 'at_bottom' };
      }
    }
    
    // Calculate new ranks for all group members
    const changes = [];
    
    if (delta > 0) {
      // Moving up: place entire group AFTER the target object
      const afterRank = list[targetIndex].rank;
      const beforeRank = list[targetIndex + 1]?.rank ?? '';
      
      // Generate ranks for all group members, preserving their internal order
      let prevRank = afterRank;
      for (const member of groupMembers) {
        const newRank = rankBetween(prevRank, beforeRank);
        const oldRank = this.objectRank.get(member.id).rank;
        this.objectRank.get(member.id).rank = newRank;
        changes.push({ objectId: member.id, oldRank, newRank });
        prevRank = newRank;
      }
    } else {
      // Moving down: place entire group BEFORE the target object
      const beforeRank = list[targetIndex].rank;
      const afterRank = list[targetIndex - 1]?.rank ?? '';
      
      // Generate ranks for all group members, preserving their internal order
      let prevRank = afterRank;
      for (const member of groupMembers) {
        const newRank = rankBetween(prevRank, beforeRank);
        const oldRank = this.objectRank.get(member.id).rank;
        this.objectRank.get(member.id).rank = newRank;
        changes.push({ objectId: member.id, oldRank, newRank });
        prevRank = newRank;
      }
    }
    
    this._dirty = true;
    return { success: true, changes, atBoundary: false };
  }

  /**
   * Move a group of objects to the top (preserving internal order)
   * @param {Array<string>} objectIds - Array of object IDs to move
   * @returns {object} Result with success, changes array
   */
  moveGroupToTop(objectIds) {
    const list = this._sorted();
    const groupSet = new Set(objectIds);
    
    // Find group members sorted by current position
    const groupMembers = list
      .map((obj, index) => ({ ...obj, index }))
      .filter(obj => groupSet.has(obj.id))
      .sort((a, b) => a.index - b.index);
    
    if (groupMembers.length === 0) {
      return { success: false, changes: [], reason: 'no_objects_found' };
    }
    
    // Check if group is already at top (consecutive positions at end of list)
    // Group is at top only if ALL members occupy the last N positions
    const isAtTop = groupMembers.every((member, i) => {
      const expectedIndex = list.length - groupMembers.length + i;
      return member.index === expectedIndex;
    });
    if (isAtTop) {
      return { success: true, changes: [], atBoundary: true, reason: 'at_top' };
    }
    
    // Place group at the very top
    const lastRank = this._getLastRank();
    const changes = [];
    let prevRank = lastRank;
    
    for (const member of groupMembers) {
      const newRank = rankAfter(prevRank);
      const oldRank = this.objectRank.get(member.id).rank;
      this.objectRank.get(member.id).rank = newRank;
      changes.push({ objectId: member.id, oldRank, newRank });
      prevRank = newRank;
    }
    
    this._dirty = true;
    return { success: true, changes, atBoundary: false };
  }

  /**
   * Move a group of objects to the bottom (preserving internal order)
   * @param {Array<string>} objectIds - Array of object IDs to move
   * @returns {object} Result with success, changes array
   */
  moveGroupToBottom(objectIds) {
    const list = this._sorted();
    const groupSet = new Set(objectIds);
    
    // Find group members sorted by current position
    const groupMembers = list
      .map((obj, index) => ({ ...obj, index }))
      .filter(obj => groupSet.has(obj.id))
      .sort((a, b) => a.index - b.index);
    
    if (groupMembers.length === 0) {
      return { success: false, changes: [], reason: 'no_objects_found' };
    }
    
    // Check if group is already at bottom (consecutive positions at start of list)
    // Group is at bottom only if ALL members occupy the first N positions
    const isAtBottom = groupMembers.every((member, i) => member.index === i);
    if (isAtBottom) {
      return { success: true, changes: [], atBoundary: true, reason: 'at_bottom' };
    }
    
    // Place group at the very bottom
    const firstRank = this._getFirstRank();
    const changes = [];
    let nextRank = firstRank;
    
    // Generate ranks BEFORE the first rank, in reverse order to preserve internal order
    const newRanks = [];
    for (let i = 0; i < groupMembers.length; i++) {
      nextRank = rankBefore(nextRank);
      newRanks.unshift(nextRank); // Add to beginning to reverse order
    }
    
    // Apply ranks in correct order
    for (let i = 0; i < groupMembers.length; i++) {
      const member = groupMembers[i];
      const newRank = newRanks[i];
      const oldRank = this.objectRank.get(member.id).rank;
      this.objectRank.get(member.id).rank = newRank;
      changes.push({ objectId: member.id, oldRank, newRank });
    }
    
    this._dirty = true;
    return { success: true, changes, atBoundary: false };
  }

  // ========== PRIVATE ==========
  
  _sorted() {
    if (!this._dirty && this._orderCache) {
      return this._orderCache;
    }
    
    const list = Array.from(this.objectRank, ([id, data]) => ({
      id,
      rank: data.rank,
      type: data.type
    }));
    
    // Sort by rank (lexicographic), with id as tiebreaker
    list.sort((a, b) => {
      if (a.rank < b.rank) return -1;
      if (a.rank > b.rank) return 1;
      return a.id < b.id ? -1 : 1;
    });
    
    this._orderCache = list;
    this._dirty = false;
    return list;
  }

  _getLastRank() {
    const list = this._sorted();
    return list.length > 0 ? list[list.length - 1].rank : '';
  }

  _getFirstRank() {
    const list = this._sorted();
    return list.length > 0 ? list[0].rank : '';
  }
}

// ==========================================
// 1. Registry & State (Model)
// ==========================================
class ObjectRegistry {
  constructor() {
    this.objects = new Map();
    this._instanceId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    this.listeners = new Set();
    this._dragStateChecker = null; // Callback to check if object is in drag state
    
    // Z-index management via fractional indexing
    // CRITICAL: baseZ = 0 because layer creates stacking context (isolation: isolate)
    // Objects inside layer use z-index 0, 1, 2... relative to layer, not global
    // This allows unlimited objects without overlapping FoundryVTT UI (z-index 30-60)
    this.zIndexModel = new ZIndexModel(0);
  }

  /**
   * Set callback to check drag state for an object
   * Used to protect object styles from changes during drag operations
   * @param {Function} checker - Function(id) => boolean, returns true if object is being dragged
   */
  setDragStateChecker(checker) {
    this._dragStateChecker = checker;
  }
  register(obj, source = 'local') {
    // Set timestamp on creation (if not already set)
    if (!obj._lastModified) {
      obj._lastModified = Date.now();
      obj._lastModifiedSource = source;
    }
    
    // Assign z-index via ZIndexModel (fractional indexing)
    // If object has rank from DB - use it, otherwise assign new
    if (obj.rank && typeof obj.rank === 'string') {
      obj.zIndex = this.zIndexModel.assignWithRank(obj.id, obj.rank, obj.type);
    } else {
      obj.zIndex = this.zIndexModel.assign(obj.id, obj.type);
      obj.rank = this.zIndexModel.getRank(obj.id);
    }
    
    this.objects.set(obj.id, obj);
    
    // CRITICAL: Sync ALL z-indexes after adding new object
    // Because adding new object may shift other objects' positions in sorted list
    // Returns array of changed object IDs (including the new object)
    const changedIds = this._syncAllZIndexes();
    
    // Notify Layer about batch z-index update if any objects changed
    if (changedIds.length > 0) {
      this._notify(null, 'zIndexBatchUpdate', null, source, { changedIds });
    }
    
    // Set update callback for objects that support it
    if (obj.setUpdateCallback) {
      obj.setUpdateCallback((id, changes) => {
        this.update(id, changes, 'local');
      });
    }
    this._notify(obj.id, 'created', obj, source);
  }
  unregister(id, source = 'local') {
    if (this.objects.has(id)) {
      this.objects.delete(id);
      this.zIndexModel.remove(id); // Remove from z-index management
      this._notify(id, 'deleted', null, source);
    }
  }
  update(id, changes, source = 'local', metadata = {}) {
    if (this.objects.has(id)) {
      const obj = this.objects.get(id);

      // 🔍 SCALE DEBUG: Log scale changes
      if (changes.scale !== undefined && changes.scale !== obj.scale) {
        console.log(`[SCALE DEBUG] Registry.update: id=${id?.slice(-6)}, OLD scale=${obj.scale}, NEW scale=${changes.scale}, source=${source}`, {
          timestamp: Date.now(),
          oldScale: obj.scale,
          newScale: changes.scale,
          source,
          metadata
        });
      }

      // // RACE CONDITION PROTECTION: timestamp check
      const timestamp = metadata.timestamp || Date.now();
      const objTimestamp = obj._lastModified || 0;
      
      // // If this is a remote change and older than current - ignore
      if (source === 'remote' && timestamp < objTimestamp) {
        console.log(`[Registry] Ignoring stale update for ${id}: remote=${timestamp}, local=${objTimestamp}`);
        return;
      }
      
      // // If this is a remote change and simultaneous with local - local has priority
      if (source === 'remote' && timestamp === objTimestamp && obj._lastModifiedSource === 'local') {
        console.log(`[Registry] Ignoring concurrent remote update for ${id}: local has priority`);
        return;
      }

      // Check if object is being dragged
      if (this._dragStateChecker && this._dragStateChecker(id)) {
        // During LOCAL drag: block ALL remote changes (including x/y)
        // Only local client controls drag position - prevents interference from other clients
        if (source === 'remote') {
          // Silently ignore all remote changes during local drag
          return;
        }

        // During local drag: filter changes - only allow x/y (and selected for visual feedback)
        // This prevents style changes (textWidth, color, fontSize, etc.) from affecting the object
        const allowedChanges = {};

        // Always allow x/y from local source (main purpose of drag)
        if ('x' in changes) allowedChanges.x = changes.x;
        if ('y' in changes) allowedChanges.y = changes.y;

        // Allow selected for visual feedback (not a style property)
        if ('selected' in changes) allowedChanges.selected = changes.selected;
        if ('massSelected' in changes) allowedChanges.massSelected = changes.massSelected;

        // Apply only allowed changes
        if (Object.keys(allowedChanges).length > 0) {
          Object.assign(obj, allowedChanges);
          obj._lastModified = timestamp;
          obj._lastModifiedSource = source;
          // During drag: notify Layer for DOM updates, but SocketController will skip socket emit
          // Socket will be updated only once in _endDrag() with final position
          this._notify(id, 'updated', obj, source, allowedChanges);
        }
        // If no allowed changes, silently ignore (don't notify)
        return;
      }

      // Normal update - apply all changes
      // // Protect against prototype method overwrite: filter properties with method names
      const methodNames = ['canEdit', 'getCopyData', 'getElementForHitTest', 'getSerializationKey', 
                           'onCreated', 'updateClickTarget', 'applyScaleTransform', 'getImageElementForCopy'];
      const safeChanges = {};
      for (const [key, value] of Object.entries(changes)) {
        if (!methodNames.includes(key)) {
          safeChanges[key] = value;
        } else {
          // // Log method overwrite attempt (should not happen)
          console.warn(`[Registry] Attempt to overwrite method '${key}' via update() - ignored`);
        }
      }
      Object.assign(obj, safeChanges);
      obj._lastModified = timestamp;
      obj._lastModifiedSource = source;
      this._notify(id, 'updated', obj, source, safeChanges);
    }
  }
  get(id) {
    return this.objects.get(id);
  }
  getAll() {
    return Array.from(this.objects.values());
  }
  getAllIds() {
    return Array.from(this.objects.keys());
  }
  
  // ========== Z-Index Management ==========
  
  /**
   * Move object up in z-order (toward viewer)
   * @param {string} id - Object ID
   * @param {number} steps - Number of positions to move (default 1)
   * @returns {{ success: boolean, newZIndex: number, newRank: string }}
   */
  moveZIndexUp(id, steps = 1) {
    return this._moveZIndex(id, Math.abs(steps));
  }

  /**
   * Move object down in z-order (away from viewer)
   * @param {string} id - Object ID
   * @param {number} steps - Number of positions to move (default 1)
   * @returns {{ success: boolean, newZIndex: number, newRank: string }}
   */
  moveZIndexDown(id, steps = 1) {
    return this._moveZIndex(id, -Math.abs(steps));
  }

  /**
   * Move object to top of z-order
   * @param {string} id - Object ID
   * @returns {{ success: boolean, newZIndex: number, newRank: string }}
   */
  moveZIndexToTop(id) {
    const result = this.zIndexModel.moveToTop(id);
    if (result.success && !result.atBoundary) {
      this._applyZIndexChange(id, result);
    }
    return result;
  }

  /**
   * Move object to bottom of z-order
   * @param {string} id - Object ID
   * @returns {{ success: boolean, newZIndex: number, newRank: string }}
   */
  moveZIndexToBottom(id) {
    const result = this.zIndexModel.moveToBottom(id);
    if (result.success && !result.atBoundary) {
      this._applyZIndexChange(id, result);
    }
    return result;
  }

  /**
   * Move a group of objects up as a unit (preserving internal order)
   * @param {Array<string>} ids - Array of object IDs
   * @returns {object} Result with success flag
   */
  moveZIndexGroupUp(ids) {
    return this._moveZIndexGroup(ids, 1);
  }

  /**
   * Move a group of objects down as a unit (preserving internal order)
   * @param {Array<string>} ids - Array of object IDs
   * @returns {object} Result with success flag
   */
  moveZIndexGroupDown(ids) {
    return this._moveZIndexGroup(ids, -1);
  }

  /**
   * Move a group of objects to the top (preserving internal order)
   * @param {Array<string>} ids - Array of object IDs
   * @returns {object} Result with success flag
   */
  moveZIndexGroupToTop(ids) {
    const result = this.zIndexModel.moveGroupToTop(ids);
    if (result.success && result.changes.length > 0) {
      this._applyGroupZIndexChanges(result.changes);
    }
    return result;
  }

  /**
   * Move a group of objects to the bottom (preserving internal order)
   * @param {Array<string>} ids - Array of object IDs
   * @returns {object} Result with success flag
   */
  moveZIndexGroupToBottom(ids) {
    const result = this.zIndexModel.moveGroupToBottom(ids);
    if (result.success && result.changes.length > 0) {
      this._applyGroupZIndexChanges(result.changes);
    }
    return result;
  }

  /**
   * Internal: apply group z-index changes
   */
  _applyGroupZIndexChanges(changes) {
    // Update ranks in objects
    for (const change of changes) {
      const obj = this.objects.get(change.objectId);
      if (obj) {
        obj.rank = change.newRank;
        obj._lastModified = Date.now();
        obj._lastModifiedSource = 'local';
      }
    }
    
    // Sync all z-indexes and notify
    const changedIds = this._syncAllZIndexes();
    if (changedIds.length > 0) {
      this._notify(null, 'zIndexBatchUpdate', null, 'local', { changedIds });
    }
    
    // Notify about each changed object for persistence
    for (const change of changes) {
      const obj = this.objects.get(change.objectId);
      if (obj) {
        this._notify(change.objectId, 'updated', obj, 'local', { zIndex: obj.zIndex, rank: change.newRank });
      }
    }
  }

  /**
   * Internal: move group by delta
   */
  _moveZIndexGroup(ids, delta) {
    const result = this.zIndexModel.moveGroupAsUnit(ids, delta);
    if (result.success && result.changes.length > 0) {
      this._applyGroupZIndexChanges(result.changes);
    }
    return result;
  }

  /**
   * Internal: move z-index by delta
   */
  _moveZIndex(id, delta) {
    const result = this.zIndexModel.move(id, delta);
    if (result.success && !result.atBoundary) {
      this._applyZIndexChange(id, result);
    }
    return result;
  }

  /**
   * Internal: apply z-index change to object and sync ALL Registry z-indexes
   * CRITICAL: When one object moves, all other objects' z-indexes may shift!
   * DOM updates are handled by Layer via batch notification (zIndexBatchUpdate)
   */
  _applyZIndexChange(id, result) {
    const obj = this.objects.get(id);
    if (obj) {
      // Only update rank here - z-index will be synced by _syncAllZIndexes()
      obj.rank = result.newRank;
      obj._lastModified = Date.now();
      obj._lastModifiedSource = 'local';
    }
    
    // CRITICAL: Sync ALL objects' z-indexes because moving one shifts others
    // This is the core difference from simple z-index swap
    // Returns array of changed object IDs
    const changedIds = this._syncAllZIndexes();
    
    // CRITICAL: Notify Layer about batch z-index update for ALL changed objects
    // This ensures DOM is updated for all objects, not just the moved one
    if (changedIds.length > 0) {
      this._notify(null, 'zIndexBatchUpdate', null, 'local', { changedIds });
    }
    
    // Also notify about the moved object for persistence (rank changed)
    // Use obj.zIndex after sync (it's now accurate) instead of result.newZIndex
    if (obj) {
      this._notify(id, 'updated', obj, 'local', { zIndex: obj.zIndex, rank: result.newRank });
    }
  }

  /**
   * Sync z-index for ALL objects in Registry (not DOM!)
   * Called after any z-order change because fractional indexing
   * means all objects' z-indexes are derived from their sorted position
   * 
   * CRITICAL: This method only updates Registry, NOT DOM!
   * DOM updates are handled by Layer via batch notification.
   * 
   * @returns {Array<string>} Array of object IDs whose z-index changed
   */
  _syncAllZIndexes() {
    const sorted = this.zIndexModel.getAllSorted();
    const changedIds = [];
    
    console.log(`[Registry] _syncAllZIndexes: ${sorted.length} objects`);
    
    // Update each object's z-index in Registry only (not DOM)
    sorted.forEach((item, index) => {
      const newZIndex = this.zIndexModel.baseZ + index;
      const obj = this.objects.get(item.id);
      
      if (obj) {
        const oldZ = obj.zIndex;
        if (oldZ !== newZIndex) {
          obj.zIndex = newZIndex;
          changedIds.push(item.id);
          console.log(`[Registry] Sync ${item.id.slice(-6)}: ${oldZ} → ${newZIndex}`);
        }
      }
    });
    
    return changedIds;
  }

  /**
   * Get z-index debug info
   */
  getZIndexDebugInfo() {
    return {
      modelSize: this.zIndexModel.size,
      objectsSize: this.objects.size,
      sorted: this.zIndexModel.getAllSorted(),
      objects: this.getAll().map(o => ({ id: o.id, zIndex: o.zIndex, rank: o.rank, type: o.type }))
    };
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  _notify(id, type, data, source, changes = null) {
    this.listeners.forEach(cb => cb({
      id,
      type,
      data,
      source,
      changes
    }));
  }
}

// ==========================================
// 2. Layer Management (View/Controller)
// ==========================================
class WhiteboardLayer {
  constructor(registry) {
    this.element = null;
    this.registry = registry;
    this._syncAnimationId = null;
    this._interactionManager = null; // Reference to InteractionManager for accessing drag state

    // Selection overlay (SVG) - renders selection border ABOVE all objects (z-index: 999)
    this._selectionOverlay = null;
    this._selectionOverlayRect = null;
    this._selectionOverlaySelectedId = null;

    // Store hook callbacks for cleanup
    this._hookCallbacks = {
      canvasReady: null,
      canvasTearDown: null
    };

    // Store crop handles for each image (Map<imageId, {top, right, bottom, left, circleResize}>)
    this._cropHandles = new Map();

    // Subscribe to registry changes to update DOM
    this.registry.subscribe(this._handleRegistryChange.bind(this));
  }

  /**
   * Set reference to InteractionManager for accessing drag state
   * This allows Layer to read drag state without violating architecture (InteractionManager owns drag state)
   */
  setInteractionManager(interactionManager) {
    this._interactionManager = interactionManager;
  }

  /**
   * DEPRECATED: Use interactionManager.isDragging(id) instead
   * Kept for backward compatibility during transition
   */
  setDragState(_id, _isDragging) {
    // No-op: drag state is now managed by InteractionManager
    // This method is called but state is checked via interactionManager.isDragging()
  }

  /**
   * PUBLIC API // PUBLIC API for accessing DOM elements
   * // Semantic methods help tools (smart-search, Serena) track dependencies
   */

  /**
   * Get board element (main container canvas)
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/getBoardElement")
   */
  getBoardElement() {
    return document.getElementById("board");
  }

  /**
   * Get the container of an object element by its ID ID
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/getObjectContainer")
   */
  getObjectContainer(objectId) {
    return document.getElementById(objectId);
  }

  /**
   * Get the text element inside the object container
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/getTextElement")
   */
  getTextElement(containerId) {
    const container = this.getObjectContainer(containerId);
    return container?.querySelector('.wbe-canvas-text');
  }

  /**
   * Get the text span (background span) inside the text element text span (background span) inside text element
   */
  getTextSpan(containerId) {
    const textElement = this.getTextElement(containerId);
    return textElement?.querySelector('.wbe-text-background-span');
  }

  /**
  // REMOVED: getTextResizeHandle() - old DOM handle no longer used, SVG overlay handle instead

  /**
   * Get the image element inside the object container
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/getImageElement")
   */
  getImageElement(containerId) {
    const container = this.getObjectContainer(containerId);
    return container?.querySelector('.wbe-canvas-image');
  }

  /**
   * Get resize handle for image object
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/getImageResizeHandle")
   */
  getImageResizeHandle(containerId) {
    const container = this.getObjectContainer(containerId);
    return container?.querySelector('.wbe-image-resize-handle');
  }

  /**
   * Get image click target inside container object
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/getImageClickTarget")
   */
  getImageClickTarget(containerId) {
    const container = this.getObjectContainer(containerId);
    return container?.querySelector('.wbe-image-click-target');
  }

  /**
   * Create crop gizmos for image
   * @param {string} imageId - ID images
   * @param {string} maskType - Mask type ('rect' or 'circle')
   * @returns {Object} Object with gizmos {top, right, bottom, left, circleResize}
   */
  createCropHandles(imageId, maskType) {
    const container = this.getObjectContainer(imageId);
    if (!container) {
      console.warn(`[Layer] Container not found for image ${imageId}`);
      return null;
    }

    // // Remove old gizmos if any
    this.removeCropHandles(imageId);

    const handles = {};
    if (maskType === 'rect') {
      const rectHandles = CropGizmoManager.createRectHandles(container);
      Object.assign(handles, rectHandles);
    } else if (maskType === 'circle') {
      handles.circleResize = CropGizmoManager.createCircleHandle(container);
    }

    this._cropHandles.set(imageId, handles);
    return handles;
  }

  /**
   * Update crop gizmo positions
   * @param {string} imageId - ID images
   */
  updateCropHandlesPosition(imageId) {
    const handles = this._cropHandles.get(imageId);
    if (!handles) return;

    const container = this.getObjectContainer(imageId);
    const imageElement = this.getImageElement(imageId);
    if (!container || !imageElement) return;

    const obj = this.registry.get(imageId);
    if (!obj || obj.type !== 'image') return;

    // CRITICAL: Calculate visible dimensions to get correct crop boundaries
    // dims contains scaled visible area dimensions (already accounts for scale and crop)
    const dims = this._calculateImageVisibleDimensions(imageElement, imageId);

    if (handles.top || handles.right || handles.bottom || handles.left) {
      // Rect handles - position on boundaries of visible area
      CropGizmoManager.updateRectHandlesPosition(handles, dims);
    } else if (handles.circleResize) {
      // SPECIAL CASE: Circle in crop mode - position relative to FULL image, not dims
      if (obj.isCropping) {
        const scale = obj.scale || 1;
        const baseWidth = obj.baseWidth || imageElement.naturalWidth || 200;
        const baseHeight = obj.baseHeight || imageElement.naturalHeight || 200;
        const circleOffset = obj.circleOffset || { x: 0, y: 0 };
        const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
        const centerX = baseWidth / 2 + circleOffset.x;
        const centerY = baseHeight / 2 + circleOffset.y;
        
        const scaledRadius = circleRadius * scale;
        const scaledCenterX = centerX * scale;
        const scaledCenterY = centerY * scale;
        
        // Position gizmo at edge of circle (45 degrees, right-bottom)
        const handleX = scaledCenterX + scaledRadius * 0.707;
        const handleY = scaledCenterY + scaledRadius * 0.707;
        
        const halfHandleSize = CropGizmoManager.HANDLE_SIZE / 2;
        handles.circleResize.style.left = `${handleX - halfHandleSize}px`;
        handles.circleResize.style.top = `${handleY - halfHandleSize}px`;
      } else {
        // Normal mode - use dims
      CropGizmoManager.updateCircleHandlePosition(
        handles.circleResize,
        imageElement,
        obj.circleOffset,
        obj.circleRadius,
        dims
      );
      }
    }
  }

  /**
   * Remove crop gizmos for the image
   * @param {string} imageId - ID images
   */
  removeCropHandles(imageId) {
    const handles = this._cropHandles.get(imageId);
    if (handles) {
      CropGizmoManager.removeAllHandles(handles);
      this._cropHandles.delete(imageId);
    }
  }

  /**
   * Get crop gizmos for the image
   * @param {string} imageId - ID images
   * @returns {Object|null} Object with gizmos or null
   */
  getCropHandles(imageId) {
    return this._cropHandles.get(imageId) || null;
  }

  /**
   * Update CSS clip-path to visualize crop CSS clip-path for crop visualization
   * @param {string} imageId - ID images
   */
  updateImageClipPath(imageId) {
    const container = this.getObjectContainer(imageId);
    const imageElement = this.getImageElement(imageId);
    if (!container || !imageElement) return;

    const obj = this.registry.get(imageId);
    if (!obj || obj.type !== 'image') return;

    const maskType = obj.maskType || 'rect';
    const scale = obj.scale || 1;
    const baseWidth = obj.baseWidth || (imageElement.naturalWidth > 0 ? imageElement.naturalWidth : 200);
    const baseHeight = obj.baseHeight || (imageElement.naturalHeight > 0 ? imageElement.naturalHeight : 200);

    // SPECIAL CASE: Circle mask in crop mode - container stays full size
    // SSOT: This is the ONLY place that handles circle crop mode visuals
    if (maskType === 'circle' && obj.isCropping) {
      // Round all dimensions to prevent subpixel jittering
      const fullWidth = Math.round(baseWidth * scale);
      const fullHeight = Math.round(baseHeight * scale);
      const circleOffset = obj.circleOffset || { x: 0, y: 0 };
      const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
      const centerX = baseWidth / 2 + circleOffset.x;
      const centerY = baseHeight / 2 + circleOffset.y;
      const scaledRadius = Math.round(circleRadius * scale);
      const scaledCenterX = Math.round(centerX * scale);
      const scaledCenterY = Math.round(centerY * scale);
      const clipPath = `circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px)`;
      const diameter = scaledRadius * 2;
      
      // Container = full size, at obj.x/y (NO dims offset!)
      container.style.width = `${fullWidth}px`;
      container.style.height = `${fullHeight}px`;
      container.style.left = `${obj.x}px`;
      container.style.top = `${obj.y}px`;
      
      // imageWrapper = full size, NO border-radius in crop mode (MUST be set before cropPreview)
      const imageWrapper = container.querySelector('.wbe-image-wrapper');
      if (imageWrapper) {
        imageWrapper.style.width = `${fullWidth}px`;
        imageWrapper.style.height = `${fullHeight}px`;
        imageWrapper.style.borderRadius = '0'; // No rounding in crop mode - show full image
      }
      
      // imageElement = full size, semi-transparent, no clip-path
      imageElement.style.left = '0px';
      imageElement.style.top = '0px';
      imageElement.style.width = `${fullWidth}px`;
      imageElement.style.height = `${fullHeight}px`;
      imageElement.style.opacity = '0.15';
      imageElement.style.clipPath = 'none';
      
      // cropPreview = full size, bright, with clip-path (CREATE if not exists)
      let cropPreview = container.querySelector('.wbe-crop-preview');
      if (!cropPreview && imageWrapper) {
        cropPreview = document.createElement('img');
        cropPreview.className = 'wbe-crop-preview';
        cropPreview.src = imageElement.src;
        imageWrapper.appendChild(cropPreview);
      }
      if (cropPreview) {
        cropPreview.style.cssText = `
          position: absolute;
          left: 0px;
          top: 0px;
          width: ${fullWidth}px;
          height: ${fullHeight}px;
          opacity: 1;
          clip-path: ${clipPath};
          pointer-events: none;
          z-index: 1;
        `;
      }
      
      // circleOverlay = purple border around mask (CREATE if not exists)
      let circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
      if (!circleOverlay) {
        circleOverlay = document.createElement('div');
        circleOverlay.className = 'wbe-crop-circle-overlay';
        container.appendChild(circleOverlay);
      }
      circleOverlay.style.cssText = `
        position: absolute;
        left: ${scaledCenterX - scaledRadius}px;
        top: ${scaledCenterY - scaledRadius}px;
        width: ${diameter}px;
        height: ${diameter}px;
        border-radius: 50%;
        border: 2px solid rgba(128, 0, 255, 0.9);
        pointer-events: none;
        z-index: 1002;
      `;
      
      // selectionBorder = full size (blue frame)
      const selectionBorder = container.querySelector('.wbe-image-selection-border');
      if (selectionBorder) {
        selectionBorder.style.width = `${fullWidth}px`;
        selectionBorder.style.height = `${fullHeight}px`;
        selectionBorder.style.left = '0px';
        selectionBorder.style.top = '0px';
      }
      
      // clickTarget = full size
      const clickTarget = container.querySelector('.wbe-image-click-target');
      if (clickTarget) {
        clickTarget.style.width = `${fullWidth}px`;
        clickTarget.style.height = `${fullHeight}px`;
      }
      
      return; // DONE for circle crop mode
    }

    // NORMAL MODE: Container shrinks to visible area (dims)
    if (maskType === 'rect') {
      // Rect mask: NO clip-path needed!
      // overflow: hidden on imageWrapper + imageElement offset does the cropping
      imageElement.style.clipPath = 'none';
      imageElement.dataset.maskType = 'rect';
    } else if (maskType === 'circle') {
      // Circle mask (not in crop mode): apply clip-path
      const circleOffset = obj.circleOffset || { x: 0, y: 0 };
      const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
      const baseCenterX = baseWidth / 2 + circleOffset.x;
      const baseCenterY = baseHeight / 2 + circleOffset.y;
      const scaledRadius = circleRadius * scale;
      const scaledCenterX = baseCenterX * scale;
      const scaledCenterY = baseCenterY * scale;
      const clipPath = `circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px)`;
      imageElement.style.clipPath = clipPath;
      imageElement.dataset.maskType = 'circle';
    }
    
    // Calculate visible dimensions and shrink container
    const dims = this._calculateImageVisibleDimensions(imageElement, imageId);
    
    if (dims.width > 0 && dims.height > 0) {
      container.style.width = `${dims.width}px`;
      container.style.height = `${dims.height}px`;
      container.style.left = `${obj.x + (dims.left || 0)}px`;
      container.style.top = `${obj.y + (dims.top || 0)}px`;
      
      // imageElement shifted for left/top crop
      imageElement.style.left = `${-(dims.left || 0)}px`;
      imageElement.style.top = `${-(dims.top || 0)}px`;
      
      // imageWrapper = visible area
      const imageWrapper = container.querySelector('.wbe-image-wrapper');
      if (imageWrapper) {
        imageWrapper.style.width = `${dims.width}px`;
        imageWrapper.style.height = `${dims.height}px`;
        imageWrapper.style.left = '0px';
        imageWrapper.style.top = '0px';
      }
      
      // selectionBorder = visible area + borderWidth offset (must be OUTSIDE permanentBorder)
      // BUT in crop mode, permanentBorder is hidden, so no offset needed
      const selectionBorder = container.querySelector('.wbe-image-selection-border');
      if (selectionBorder) {
        if (obj.isCropping) {
          // In crop mode: no offset
          selectionBorder.style.width = `${dims.width}px`;
          selectionBorder.style.height = `${dims.height}px`;
          selectionBorder.style.left = '0px';
          selectionBorder.style.top = '0px';
        } else {
          // Normal mode: expand by borderWidth
          const baseBorderWidth = obj.borderWidth !== undefined ? obj.borderWidth : DEFAULT_BORDER_WIDTH;
          const scaledBorderWidth = baseBorderWidth * scale;
          selectionBorder.style.width = `${dims.width + 2 * scaledBorderWidth}px`;
          selectionBorder.style.height = `${dims.height + 2 * scaledBorderWidth}px`;
          selectionBorder.style.left = `-${scaledBorderWidth}px`;
          selectionBorder.style.top = `-${scaledBorderWidth}px`;
        }
      }
      
      // Update SVG permanentBorder to match visible area
      const permanentBorder = container.querySelector('.wbe-image-permanent-border');
      if (permanentBorder) {
        const baseBorderWidth = obj.borderWidth !== undefined ? obj.borderWidth : DEFAULT_BORDER_WIDTH;
        const baseBorderRadius = obj.borderRadius !== undefined ? obj.borderRadius : DEFAULT_BORDER_RADIUS;
        const scaledBorderWidth = Math.round(baseBorderWidth * scale);
        const scaledBorderRadius = Math.round(baseBorderRadius * scale);
        const borderRgba = scaledBorderWidth > 0 
          ? hexToRgba(obj.borderHex || DEFAULT_BORDER_HEX, obj.borderOpacity !== undefined ? obj.borderOpacity : DEFAULT_BORDER_OPACITY) 
          : null;
        const isCircleMask = maskType === 'circle';
        this._updateSvgPermanentBorder(permanentBorder, dims.width, dims.height, scaledBorderWidth, borderRgba, scaledBorderRadius, isCircleMask);
      }
      
      // clickTarget = visible area
      const clickTarget = container.querySelector('.wbe-image-click-target');
      if (clickTarget) {
        clickTarget.style.width = `${dims.width}px`;
        clickTarget.style.height = `${dims.height}px`;
        clickTarget.style.left = '0px';
        clickTarget.style.top = '0px';
      }
    }
  }

  /**
   * Set cursor on board element board element
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/applyBoardCursor") find_referencing_symbols("WhiteboardLayer/applyBoardCursor")
   */
  applyBoardCursor(cursor) {
    const board = this.getBoardElement();
    if (board) {
      this._applyElementStyles(board, {
        cursor
      });
    }
    // Also set cursor on layer element (layer is sibling of board, not child)
    if (this.element) {
      this._applyElementStyles(this.element, {
        cursor
      });
    }
  }

  /**
   * Apply styles to the element (public wrapper for _applyElementStyles)
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/applyElementStyles")
   */
  applyElementStyles(element, styles) {
    this._applyElementStyles(element, styles);
  }

  /**
   * Set pointer-events for all objects (bulk operation)
   * Tools can find all usages via find_referencing_symbols("WhiteboardLayer/setAllObjectsPointerEvents")
   */
  setAllObjectsPointerEvents(enabled) {
    if (!this.element) return;
    const val = enabled ? 'auto' : 'none';
    // Unification: disable pointer-events on containers AND click-target elements
    // This allows pan and zoom to work through all objects (texts, images, and custom types)
    const containers = this.element.querySelectorAll(Whiteboard.getAllContainerSelectors());
    containers.forEach(el => {
      this._applyElementStyles(el, {
        pointerEvents: val
      });
      // Also disable click-target elements (they can block events even if the container has pointer-events: none)
      const clickTarget = el.querySelector('[class*="-click-target"]');
      if (clickTarget) {
        this._applyElementStyles(clickTarget, {
          pointerEvents: val
        });
      }
    });
  }

  // ========== SELECTION OVERLAY ==========
  // Renders selection border AND resize handle ABOVE all objects (z-index: 999)
  // Similar to mass-selection bounding box but for single object
  // DRY: Both selection border and gizmo in one SVG layer

  /**
   * Show selection overlay for object (SVG-based for crisp rendering)
   * Includes: selection border (rect) + resize handle (circle)
   * @param {string} objectId - ID of selected object
   */
  showSelectionOverlay(objectId) {
    if (!this.element) return;
    
    // Create SVG overlay if not exists
    if (!this._selectionOverlay) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'wbe-selection-overlay');
      svg.style.cssText = `
        position: absolute;
        pointer-events: none;
        z-index: 999;
        display: none;
        overflow: visible;
      `;
      
      // Selection border (rect) - always rectangular for all objects
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '0');
      rect.setAttribute('y', '0');
      rect.setAttribute('stroke', '#1c86ff');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('fill', 'none');
      rect.setAttribute('vector-effect', 'non-scaling-stroke');
      
      // Resize handle (circle) - SVG gizmo for scale resize
      // DRY: Unified gizmo in overlay layer instead of per-object DOM elements
      const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      handle.setAttribute('class', 'wbe-selection-overlay-handle');
      handle.setAttribute('r', '6');
      handle.setAttribute('fill', '#4a9eff');
      handle.setAttribute('stroke', 'white');
      handle.setAttribute('stroke-width', '2');
      handle.setAttribute('cursor', 'nwse-resize');
      handle.style.pointerEvents = 'auto'; // Handle needs to receive events
      
      svg.appendChild(rect);
      svg.appendChild(handle);
      this.element.appendChild(svg);
      this._selectionOverlay = svg;
      this._selectionOverlayRect = rect;
      this._selectionOverlayHandle = handle;
    }
    
    this._selectionOverlaySelectedId = objectId;
    this.updateSelectionOverlay();
  }

  /**
   * Update selection overlay position based on selected object
   * @param {number} [overrideScale] - Optional scale override (used during scale resize when Registry not yet updated)
   */
  updateSelectionOverlay(overrideScale) {
    if (!this._selectionOverlay || !this._selectionOverlaySelectedId) return;
    
    const container = this.getObjectContainer(this._selectionOverlaySelectedId);
    if (!container) {
      this.hideSelectionOverlay();
      return;
    }
    
    const obj = this.registry.get(this._selectionOverlaySelectedId);
    if (!obj) {
      this.hideSelectionOverlay();
      return;
    }
    
    // Get container position (already in layer coordinates)
    const x = parseFloat(container.style.left) || 0;
    const y = parseFloat(container.style.top) || 0;
    
    // OPTIMIZATION: During drag, only update position (dimensions don't change)
    // This avoids expensive offsetWidth/offsetHeight reflow on every mousemove
    const isDragging = this._interactionManager?.isDragging(this._selectionOverlaySelectedId);
    if (isDragging && this._selectionOverlay.style.width) {
      // Just update position - dimensions are cached from before drag
      // Round to prevent subpixel jittering
      const borderWidth = obj.borderWidth || 0;
      const scale = obj.scale !== undefined ? obj.scale : 1;
      const scaledBorderWidth = Math.round(obj.type === 'text' ? borderWidth * scale : borderWidth);
      // No minPadding needed - textElement has overflow:hidden, textSpan can't peek outside
      this._selectionOverlay.style.left = `${Math.round(x) - scaledBorderWidth}px`;
      this._selectionOverlay.style.top = `${Math.round(y) - scaledBorderWidth}px`;
      return;
    }
    
    // Get base dimensions and apply scale
    // Container may use transform: scale() so we need to account for it
    const baseWidth = parseFloat(container.style.width) || container.offsetWidth;
    const baseHeight = parseFloat(container.style.height) || container.offsetHeight;
    // Use override scale if provided (during scale resize), otherwise from Registry
    const scale = overrideScale !== undefined ? overrideScale : (obj.scale !== undefined ? obj.scale : 1);
    
    // For objects using transform: scale(), multiply dimensions by scale
    // For images, dimensions are already scaled via width/height style
    let width, height;
    
    // Types that use transform: scale() for scaling
    const usesTransformScale = obj.usesTransformScale?.() ?? (obj.type === 'text');
    
    if (usesTransformScale) {
      width = baseWidth * scale;
      height = baseHeight * scale;
    } else {
      // Images (all mask types): container dimensions are already correct
      // For circle mask: container is sized to circle diameter
      // For rect mask: container is sized to visible area
      width = baseWidth;
      height = baseHeight;
    }
    
    // Account for borderWidth - selection overlay should be OUTSIDE permanent border
    // borderWidth is already scaled for transform:scale() types, but we need to add it to overlay position
    const borderWidth = obj.borderWidth || 0;
    const scaledBorderWidth = usesTransformScale ? borderWidth * scale : borderWidth;
    
    // No minPadding needed - textElement has overflow:hidden, textSpan can't peek outside
    
    // Calculate final dimensions (no rounding needed for SVG - it handles subpixels well)
    const left = x - scaledBorderWidth;
    const top = y - scaledBorderWidth;
    const finalWidth = width + 2 * scaledBorderWidth;
    const finalHeight = height + 2 * scaledBorderWidth;
    
    // Position SVG overlay
    this._selectionOverlay.style.left = `${left}px`;
    this._selectionOverlay.style.top = `${top}px`;
    this._selectionOverlay.style.width = `${finalWidth}px`;
    this._selectionOverlay.style.height = `${finalHeight}px`;
    this._selectionOverlay.setAttribute('viewBox', `0 0 ${finalWidth} ${finalHeight}`);
    
    // Update rect dimensions (selection overlay is always rectangular)
    // Hide selection rect in crop mode - purple crop border is shown instead
    const showSelectionRect = !obj.isCropping;
    this._selectionOverlayRect.style.display = showSelectionRect ? 'block' : 'none';
    
    if (showSelectionRect) {
      this._selectionOverlayRect.setAttribute('x', '0.5');
      this._selectionOverlayRect.setAttribute('y', '0.5');
      this._selectionOverlayRect.setAttribute('width', `${finalWidth - 1}`);
      this._selectionOverlayRect.setAttribute('height', `${finalHeight - 1}`);
    }
    
    // Update resize handle position (bottom-right corner with offset)
    // Handle is positioned at corner + small offset for better UX
    if (this._selectionOverlayHandle) {
      const handleOffset = 4; // Offset from corner (same as old RESIZE_HANDLE_OFFSET)
      const handleX = finalWidth + handleOffset;
      const handleY = finalHeight + handleOffset;
      this._selectionOverlayHandle.setAttribute('cx', `${handleX}`);
      this._selectionOverlayHandle.setAttribute('cy', `${handleY}`);
      
      // Show/hide handle based on object state (frozen objects cannot be scaled)
      const isFrozen = obj.isFrozen?.() ?? false;
      const showHandle = !isFrozen && !obj.isCropping;
      this._selectionOverlayHandle.style.display = showHandle ? 'block' : 'none';
    }
    
    this._selectionOverlay.style.display = 'block';
  }

  /**
   * Hide selection overlay
   */
  hideSelectionOverlay() {
    if (this._selectionOverlay) {
      this._selectionOverlay.style.display = 'none';
    }
    this._selectionOverlaySelectedId = null;
  }

  // ========== MASS SELECTION OVERLAYS ==========
  // SVG overlays for mass-selected objects (no resize handles, just borders)
  
  /**
   * Show mass selection overlays for multiple objects
   * @param {Set<string>} objectIds - Set of object IDs to show overlays for
   */
  showMassSelectionOverlays(objectIds) {
    if (!this.element) return;
    
    // Create container SVG if not exists
    if (!this._massSelectionOverlay) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'wbe-mass-selection-overlay');
      svg.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 998;
        overflow: visible;
      `;
      this.element.appendChild(svg);
      this._massSelectionOverlay = svg;
      this._massSelectionRects = new Map(); // objectId -> rect element
    }
    
    // Remove rects for objects no longer selected
    for (const [id, rect] of this._massSelectionRects) {
      if (!objectIds.has(id)) {
        rect.remove();
        this._massSelectionRects.delete(id);
      }
    }
    
    // Add/update rects for selected objects
    for (const id of objectIds) {
      if (!this._massSelectionRects.has(id)) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('stroke', '#1c86ff');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('fill', 'none');
        rect.setAttribute('vector-effect', 'non-scaling-stroke');
        rect.dataset.objectId = id;
        this._massSelectionOverlay.appendChild(rect);
        this._massSelectionRects.set(id, rect);
      }
    }
    
    this.updateMassSelectionOverlays();
    this._massSelectionOverlay.style.display = 'block';
  }
  
  /**
   * Update positions of all mass selection overlays
   * Uses same logic as updateSelectionOverlay for single selection
   */
  updateMassSelectionOverlays() {
    if (!this._massSelectionOverlay || !this._massSelectionRects) return;
    
    for (const [id, rect] of this._massSelectionRects) {
      const container = this.getObjectContainer(id);
      const obj = this.registry.get(id);
      if (!container || !obj) {
        rect.style.display = 'none';
        continue;
      }
      
      // Same logic as updateSelectionOverlay - container.style.left/top are in layer coordinates
      const x = parseFloat(container.style.left) || 0;
      const y = parseFloat(container.style.top) || 0;
      
      // Get dimensions - same logic as updateSelectionOverlay
      const baseWidth = parseFloat(container.style.width) || container.offsetWidth;
      const baseHeight = parseFloat(container.style.height) || container.offsetHeight;
      const scale = obj.scale !== undefined ? obj.scale : 1;
      
      let width, height;
      if (obj.type === 'text') {
        // Text uses transform: scale()
        width = baseWidth * scale;
        height = baseHeight * scale;
      } else {
        // Images: container dimensions are already correct
        width = baseWidth;
        height = baseHeight;
      }
      
      // Account for border
      const borderWidth = obj.borderWidth || 0;
      const scaledBorderWidth = obj.type === 'text' ? borderWidth * scale : borderWidth;
      
      const left = x - scaledBorderWidth;
      const top = y - scaledBorderWidth;
      const finalWidth = width + 2 * scaledBorderWidth;
      const finalHeight = height + 2 * scaledBorderWidth;
      
      rect.setAttribute('x', `${left}`);
      rect.setAttribute('y', `${top}`);
      rect.setAttribute('width', `${finalWidth}`);
      rect.setAttribute('height', `${finalHeight}`);
      rect.style.display = 'block';
    }
  }
  
  /**
   * Hide all mass selection overlays
   */
  hideMassSelectionOverlays() {
    if (this._massSelectionOverlay) {
      this._massSelectionOverlay.style.display = 'none';
    }
    if (this._massSelectionRects) {
      for (const rect of this._massSelectionRects.values()) {
        rect.remove();
      }
      this._massSelectionRects.clear();
    }
  }

  init() {
    // Store bound callbacks for cleanup
    this._hookCallbacks.canvasReady = () => {
      this._createLayer();
      this._startContinuousSync();
    };
    this._hookCallbacks.canvasTearDown = () => {
      this._stopContinuousSync();
      this._destroyLayer();
    };
    Hooks.on("canvasReady", this._hookCallbacks.canvasReady);
    Hooks.on("canvasTearDown", this._hookCallbacks.canvasTearDown);
    if (canvas.ready) {
      this._createLayer();
      this._startContinuousSync();
    }
  }
  _createLayer() {
    if (document.getElementById(LAYER_ID)) return;
    const board = document.getElementById("board");
    if (!board) return;
    this.element = document.createElement("div");
    this.element.id = LAYER_ID;
    // Initial styles - will be synced by _sync()
    // CRITICAL: isolation: isolate creates stacking context, allowing unlimited objects
    // with z-index 0, 1, 2... inside layer, while layer itself has z-index 45
    // (between FoundryVTT app: 30 and UI: 60)
    this.element.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 29;
            transform-origin: 0 0;
            overflow: visible;
            isolation: isolate;
        `;
    board.parentElement.insertBefore(this.element, board.nextSibling);
    
    // Initialize global styles for whiteboard (text mode cursor, etc.)
    this._initializeGlobalStyles();
    
    this._sync();
    this._renderAll(); // Initial render of anything in registry
  }
  
  /**
   * Initialize global CSS styles for whiteboard features
   */
  _initializeGlobalStyles() {
    if (document.getElementById('wbe-global-styles')) return;
    const style = document.createElement('style');
    style.id = 'wbe-global-styles';
    style.textContent = `
      /* Text mode cursor - must override all child elements including inline styles */
      /* Apply to both board AND whiteboard layer (layer is sibling of board, not child) */
      #board.wbe-text-mode,
      #board.wbe-text-mode *,
      #${LAYER_ID}.wbe-text-mode,
      #${LAYER_ID}.wbe-text-mode *,
      #${LAYER_ID}.wbe-text-mode .wbe-text-container,
      #${LAYER_ID}.wbe-text-mode .wbe-image-container,
      #${LAYER_ID}.wbe-text-mode .wbe-canvas-text,
      #${LAYER_ID}.wbe-text-mode .wbe-canvas-image,
      #${LAYER_ID}.wbe-text-mode [style*="cursor"] {
        cursor: text !important;
      }
      
      /* WBE Mass Selection tool icon with text overlay */
      [data-tool="wbeMassSelection"]::after {
        content: "wbe";
        position: absolute;
        font-size: 8px;
        font-weight: normal;
        color: #fff;
        bottom: -2px;
        right: 2px;
        line-height: 1;
        pointer-events: none;
      }
      [data-tool="wbeMassSelection"] {
        position: relative;
      }
    `;
    document.head.appendChild(style);
  }
  _destroyLayer() {
    // Remove hooks
    if (this._hookCallbacks.canvasReady) {
      Hooks.off("canvasReady", this._hookCallbacks.canvasReady);
      this._hookCallbacks.canvasReady = null;
    }
    if (this._hookCallbacks.canvasTearDown) {
      Hooks.off("canvasTearDown", this._hookCallbacks.canvasTearDown);
      this._hookCallbacks.canvasTearDown = null;
    }

    // Stop continuous sync
    this._stopContinuousSync();

    // Remove DOM element
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
  _sync() {
    if (!this.element || !canvas.ready || !canvas.stage) return;
    const board = document.getElementById("board");
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const transform = canvas.stage.worldTransform;
    const {
      a: scale,
      tx,
      ty
    } = transform;

    // Position layer exactly over board using fixed positioning
    // Fixed positioning ensures layer stays aligned with board even during scroll
    // Use centralized method to maintain Single Source of Truth
    this._applyElementStyles(this.element, {
      left: `${boardRect.left}px`,
      top: `${boardRect.top}px`,
      width: `${boardRect.width}px`,
      height: `${boardRect.height}px`,
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`
    });
  }
  _startContinuousSync() {
    if (this._syncAnimationId) return;
    const tick = () => {
      this._sync();
      this._syncAnimationId = requestAnimationFrame(tick);
    };
    this._syncAnimationId = requestAnimationFrame(tick);
  }
  _stopContinuousSync() {
    if (this._syncAnimationId) {
      cancelAnimationFrame(this._syncAnimationId);
      this._syncAnimationId = null;
    }
  }
  _handleRegistryChange({
    id,
    type,
    data,
    changes
  }) {
    if (!this.element) {
      // Try to recover: if element exists in DOM but not in memory, restore it
      const domElement = document.getElementById(LAYER_ID);
      
      if (domElement) {
        this.element = domElement;
      } else {
        // Element doesn't exist in DOM either - create it
        this._createLayer();
      }
      
      if (!this.element) {
        console.error('[Layer] CRITICAL: Cannot render object - element still missing after all recovery attempts', { id, type });
        // Don't return - try to render anyway, object should stay in Registry
        // The object will be rendered later when element is available
      } else {
        // If element was recovered, render all objects to catch up
    if (type === 'created') {
          this._renderAll();
          return; // Already rendered via _renderAll
        }
      }
    }
    if (type === 'created') {
      if (this.element) {
      this._renderObject(data);
      }
    } else if (type === 'deleted') {
      const el = document.getElementById(id);
      if (el) el.remove();
    } else if (type === 'updated') {
      this._updateObjectElement(id, data, changes);
      // Update selection overlay if this object is selected
      if (this._selectionOverlaySelectedId === id) {
        this.updateSelectionOverlay();
      }
    } else if (type === 'zIndexBatchUpdate') {
      // CRITICAL: Update ALL objects' z-index in DOM (not just changed ones)
      // With fractional indexing, moving one object shifts z-index of others
      // Uses requestAnimationFrame for batching DOM updates (like old code)
      this._syncAllZIndexes();
    }
  }

  /**
   * Batch update z-index for ALL objects using requestAnimationFrame
   * This is the ONLY place where DOM z-index should be updated in batch
   * Uses requestAnimationFrame to batch DOM updates and prevent multiple reflows
   * Based on old code approach (scripts/modules/compact-zindex-manager.mjs)
   * 
   * CRITICAL: Updates ALL objects, not just changed ones, because with fractional
   * indexing, moving one object can shift z-index of others. This ensures DOM
   * always matches the model state.
   * 
   * @returns {Promise} Promise that resolves when DOM updates are complete
   */
  _syncAllZIndexes() {
    // CRITICAL: Update ALL objects' z-index in DOM, not just changed ones
    // With fractional indexing, moving one object shifts z-index of others
    // This matches old code behavior: always update all objects for consistency
    
    // Batch all DOM updates into single reflow using requestAnimationFrame
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        // Get all objects from Registry and sort by z-index (like old code)
        const allObjects = this.registry.getAll();
        const sorted = allObjects.slice().sort((a, b) => {
          const zA = a.zIndex !== undefined ? a.zIndex : 0;
          const zB = b.zIndex !== undefined ? b.zIndex : 0;
          return zA - zB;
        });
        
        // Update all objects' z-index in DOM
        sorted.forEach(obj => {
          const container = document.getElementById(obj.id);
          if (container) {
            // CRITICAL: Update z-index from model (SSOT: model is source of truth)
            container.style.zIndex = String(obj.zIndex !== undefined ? obj.zIndex : 0);
          }
        });
        resolve();
      });
    });
  }

  _renderAll() {
    this.registry.getAll().forEach(obj => this._renderObject(obj));
  }
  _renderObject(obj) {
    if (!this.element || document.getElementById(obj.id)) {
      return;
    }
    const el = obj.render();
    this.element.appendChild(el);

    // Polymorphic call: update click-target after rendering
    // Each object type knows how to update its click-target
    const container = document.getElementById(obj.id);
    if (container) {
      obj.updateClickTarget(container);
    }

    // CRITICAL: Sync z-index and other styles immediately after render
    // This ensures DOM matches Registry state, especially for z-index
    // Use requestAnimationFrame to ensure DOM is fully ready
    requestAnimationFrame(() => {
      // Update z-index and position to match Registry (SSOT)
      this._updateObjectElement(obj.id, obj, {
        zIndex: obj.zIndex,
        x: obj.x,
        y: obj.y
      });

    // Apply outline immediately if object is selected
    if (obj.selected) {
        this._updateObjectElement(obj.id, obj, {
          selected: true
      });
    }
    
    // CRITICAL: Restore frozen state after render (for F5 refresh)
    // This ensures unfreeze icon is shown for frozen objects loaded from DB
    if (obj.isFrozen?.()) {
        this._updateObjectElement(obj.id, obj, {
          frozen: true
        });
      }
      });
  }
  /**
   * OPTIMIZATION: Update DOM directly during drag (no Registry update)
   * Used to prevent multiple Registry updates during drag operation
   */
  _updateDOMDuringDrag(objectId, newX, newY) {
    const container = document.getElementById(objectId);
    if (!container) return;

    // For images with crop, container position must account for crop offset
    const obj = this.registry.get(objectId);
    if (obj && obj.type === 'image' && obj.crop) {
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (imageElement) {
        const dims = this._calculateImageVisibleDimensions(imageElement, objectId);
        // Round to prevent subpixel jittering
        container.style.left = `${Math.round(newX + (dims.left || 0))}px`;
        container.style.top = `${Math.round(newY + (dims.top || 0))}px`;
      return;
    }
    }
    
    // Default: position at newX, newY
    // Round to prevent subpixel jittering during drag
    // Final position will be saved with full precision in _endDrag
    container.style.left = `${Math.round(newX)}px`;
    container.style.top = `${Math.round(newY)}px`;
    
    // NOTE: Text resize handle is now SVG-based (selection overlay)
    // No DOM handle updates needed during drag - overlay is updated via updateSelectionOverlay()
  }

  /**
   * OPTIMIZATION: Update DOM directly during crop drag (no Registry update)
   * Used to prevent 60+ Registry updates per second during crop operation
   * @param {string} imageId - Image ID
   * @param {Object} obj - Image object (with updated crop data applied in-memory)
   * @param {Object} cropData - { crop?, circleRadius?, circleOffset? }
   */
  _updateDOMDuringCropDrag(imageId, obj, cropData) {
    const container = this.getObjectContainer(imageId);
    const imageElement = this.getImageElement(imageId);
    if (!container || !imageElement) return;

    const scale = obj.scale || 1;
    const baseWidth = obj.baseWidth || (imageElement.naturalWidth > 0 ? imageElement.naturalWidth : 200);
    const baseHeight = obj.baseHeight || (imageElement.naturalHeight > 0 ? imageElement.naturalHeight : 200);
    const maskType = obj.maskType || 'rect';

    // Apply cropData to obj temporarily for calculations
    if (cropData.crop) obj.crop = cropData.crop;
    if (cropData.circleRadius !== undefined) obj.circleRadius = cropData.circleRadius;
    if (cropData.circleOffset) obj.circleOffset = cropData.circleOffset;

    if (maskType === 'rect' && cropData.crop) {
      // Rect crop: update container dimensions (visible area) and image position
      // CRITICAL: Calculate dims directly from cropData.crop, NOT from Registry!
      // Registry is not updated during drag (only on drag end), so we must use passed crop values
      const crop = cropData.crop;
      const visibleWidth = (baseWidth - crop.left - crop.right) * scale;
      const visibleHeight = (baseHeight - crop.top - crop.bottom) * scale;
      const cropLeftPx = crop.left * scale;
      const cropTopPx = crop.top * scale;
      
      // Round all dimensions to prevent subpixel jittering
      const roundedWidth = Math.round(visibleWidth);
      const roundedHeight = Math.round(visibleHeight);
      const roundedLeft = Math.round(cropLeftPx);
      const roundedTop = Math.round(cropTopPx);
      
      // CRITICAL: Image must stay FULL size (baseWidth * scale, baseHeight * scale)
      // Container shrinks to visible area, image is offset inside
      const fullWidth = Math.round(baseWidth * scale);
      const fullHeight = Math.round(baseHeight * scale);
      

      
      if (roundedWidth > 0 && roundedHeight > 0) {
        // Container = visible area size, positioned to compensate for left/top crop
        // This keeps the VISIBLE part of the image in the same screen position
        container.style.width = `${roundedWidth}px`;
        container.style.height = `${roundedHeight}px`;
        container.style.left = `${Math.round(obj.x) + roundedLeft}px`;
        container.style.top = `${Math.round(obj.y) + roundedTop}px`;
        
        // Image = FULL size, shifted negatively so the cropped portion is outside wrapper
        imageElement.style.width = `${fullWidth}px`;
        imageElement.style.height = `${fullHeight}px`;
        imageElement.style.maxWidth = `${fullWidth}px`;
        imageElement.style.maxHeight = `${fullHeight}px`;
        imageElement.style.left = `${-roundedLeft}px`;
        imageElement.style.top = `${-roundedTop}px`;
        imageElement.style.opacity = '1'; // Fully opaque for rect crop (no cropPreview needed)
        
        // Wrapper = visible area size (clips the image), always at origin
        const imageWrapper = container.querySelector('.wbe-image-wrapper');
        if (imageWrapper) {
          imageWrapper.style.width = `${roundedWidth}px`;
          imageWrapper.style.height = `${roundedHeight}px`;
          imageWrapper.style.left = '0px';
          imageWrapper.style.top = '0px';
          imageWrapper.style.overflow = 'hidden'; // Ensure clipping
        }
        
        const selectionBorder = container.querySelector('.wbe-image-selection-border');
        if (selectionBorder) {
          selectionBorder.style.width = `${roundedWidth}px`;
          selectionBorder.style.height = `${roundedHeight}px`;
        }
        
        const clickTarget = container.querySelector('.wbe-image-click-target');
        if (clickTarget) {
          clickTarget.style.width = `${roundedWidth}px`;
          clickTarget.style.height = `${roundedHeight}px`;
        }
        
      }
      
      // Update rect handles position (pass rounded dims)
      const handles = this._cropHandles.get(imageId);
      if (handles && (handles.top || handles.right || handles.bottom || handles.left)) {
        CropGizmoManager.updateRectHandlesPosition(handles, { width: roundedWidth, height: roundedHeight, left: roundedLeft, top: roundedTop });
      }
    } else if (maskType === 'circle') {
      // Circle crop: update clip-path and handle position
      const circleOffset = obj.circleOffset || { x: 0, y: 0 };
      const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
      const centerX = baseWidth / 2 + circleOffset.x;
      const centerY = baseHeight / 2 + circleOffset.y;
      // Round all dimensions to prevent subpixel jittering
      const scaledRadius = Math.round(circleRadius * scale);
      const scaledCenterX = Math.round(centerX * scale);
      const scaledCenterY = Math.round(centerY * scale);
      const clipPath = `circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px)`;
      
      // Update cropPreview clip-path (main image stays semi-transparent)
      const cropPreview = container.querySelector('.wbe-crop-preview');
      if (cropPreview) {
        cropPreview.style.clipPath = clipPath;
      }
      
      // Update circle overlay position
      const circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
      if (circleOverlay) {
        const diameter = scaledRadius * 2;
        circleOverlay.style.left = `${scaledCenterX - scaledRadius}px`;
        circleOverlay.style.top = `${scaledCenterY - scaledRadius}px`;
        circleOverlay.style.width = `${diameter}px`;
        circleOverlay.style.height = `${diameter}px`;
      }
      
      // Update circle resize handle position
      const handles = this._cropHandles.get(imageId);
      if (handles && handles.circleResize) {
        const handleX = Math.round(scaledCenterX + scaledRadius * 0.707);
        const handleY = Math.round(scaledCenterY + scaledRadius * 0.707);
        const halfHandleSize = CropGizmoManager.HANDLE_SIZE / 2;
        handles.circleResize.style.left = `${handleX - halfHandleSize}px`;
        handles.circleResize.style.top = `${handleY - halfHandleSize}px`;
      }
    }
  }

  /**
   * OPTIMIZATION: Update DOM directly during scale resize (no Registry update)
   * Used to prevent multiple Registry updates during scale resize operation
   * This is the same logic as _updateObjectElement.isScaleResizing block
   * @param {number} startDimsLeft - Starting crop left offset (to keep container stable)
   * @param {number} startDimsTop - Starting crop top offset (to keep container stable)
   */
  _updateDOMDuringScaleResize(objectId, obj, scale, newX, newY, _startDimsLeft = 0, _startDimsTop = 0) {
    const container = document.getElementById(objectId);
    if (!container) return;
    
    // Update position first (may change during scale resize for centering)
    // Round to prevent subpixel jittering
    container.style.left = `${Math.round(newX)}px`;
    container.style.top = `${Math.round(newY)}px`;
      
    // Polymorphic call: apply scale transform
    // Each object type knows how to apply its own scale transform
    obj.applyScaleTransform(container, scale);
    
    // NOTE: Old DOM resize handle (.wbe-text-resize-handle) is deprecated and hidden
    // SVG selection overlay handle is updated separately via updateSelectionOverlay()
          
    // For images, update all dimensions, borders and gizmo
          if (obj.type === 'image') {
            const imageElement = container.querySelector('.wbe-canvas-image');
            if (imageElement) {
        const maskType = obj.maskType || 'rect';
        const baseWidth = obj.baseWidth || (imageElement.naturalWidth > 0 ? imageElement.naturalWidth : 200);
        const baseHeight = obj.baseHeight || (imageElement.naturalHeight > 0 ? imageElement.naturalHeight : 200);
        
        // SPECIAL CASE: Circle mask in crop mode - container stays full size
        if (maskType === 'circle' && obj.isCropping) {
          // Round all dimensions to prevent subpixel jittering
          const fullWidth = Math.round(baseWidth * scale);
          const fullHeight = Math.round(baseHeight * scale);
          const circleOffset = obj.circleOffset || { x: 0, y: 0 };
          const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
          const centerX = baseWidth / 2 + circleOffset.x;
          const centerY = baseHeight / 2 + circleOffset.y;
          const scaledRadius = Math.round(circleRadius * scale);
          const scaledCenterX = Math.round(centerX * scale);
          const scaledCenterY = Math.round(centerY * scale);
          const clipPath = `circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px)`;
          
          // Container = full size, at newX/newY (NO dims offset!)
          container.style.width = `${fullWidth}px`;
          container.style.height = `${fullHeight}px`;
          container.style.left = `${Math.round(newX)}px`;
          container.style.top = `${Math.round(newY)}px`;
          
          // imageElement = full size, semi-transparent, no clip-path
          imageElement.style.left = '0px';
          imageElement.style.top = '0px';
          imageElement.style.opacity = '0.15';
          imageElement.style.clipPath = 'none';
          
          // cropPreview = full size, bright, with clip-path
          const cropPreview = container.querySelector('.wbe-crop-preview');
          if (cropPreview) {
            cropPreview.style.width = `${fullWidth}px`;
            cropPreview.style.height = `${fullHeight}px`;
            cropPreview.style.clipPath = clipPath;
          }
          
          // imageWrapper = full size
          const imageWrapper = container.querySelector('.wbe-image-wrapper');
          if (imageWrapper) {
            imageWrapper.style.width = `${fullWidth}px`;
            imageWrapper.style.height = `${fullHeight}px`;
          }
          
          // selectionBorder = full size (blue frame)
          const selectionBorder = container.querySelector('.wbe-image-selection-border');
          if (selectionBorder) {
            selectionBorder.style.width = `${fullWidth}px`;
            selectionBorder.style.height = `${fullHeight}px`;
          }
          
          // clickTarget = full size
          const clickTarget = container.querySelector('.wbe-image-click-target');
          if (clickTarget) {
            clickTarget.style.width = `${fullWidth}px`;
            clickTarget.style.height = `${fullHeight}px`;
          }
          
          // circleOverlay = purple border around mask
          const circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
          if (circleOverlay) {
            const diameter = scaledRadius * 2;
            circleOverlay.style.left = `${scaledCenterX - scaledRadius}px`;
            circleOverlay.style.top = `${scaledCenterY - scaledRadius}px`;
            circleOverlay.style.width = `${diameter}px`;
            circleOverlay.style.height = `${diameter}px`;
          }
          
          return; // DONE for circle crop mode
        }
        
        // NORMAL MODE: Container shrinks to visible area (dims)
        const dims = this._calculateImageVisibleDimensions(imageElement, obj.id, scale);
        // Round all dimensions to prevent subpixel jittering
        const roundedWidth = Math.round(dims.width);
        const roundedHeight = Math.round(dims.height);
        const roundedLeft = Math.round(dims.left || 0);
        const roundedTop = Math.round(dims.top || 0);
              
        if (roundedWidth > 0 && roundedHeight > 0) {
          container.style.width = `${roundedWidth}px`;
          container.style.height = `${roundedHeight}px`;
        }
              
        container.style.left = `${Math.round(newX) + roundedLeft}px`;
        container.style.top = `${Math.round(newY) + roundedTop}px`;
        
        imageElement.style.left = `${-roundedLeft}px`;
        imageElement.style.top = `${-roundedTop}px`;
        
        const imageWrapper = container.querySelector('.wbe-image-wrapper');
        if (imageWrapper && roundedWidth > 0 && roundedHeight > 0) {
          const baseBorderRadius = obj.borderRadius !== undefined ? obj.borderRadius : DEFAULT_BORDER_RADIUS;
          const scaledBorderRadius = Math.round(baseBorderRadius * scale);
          imageWrapper.style.width = `${roundedWidth}px`;
          imageWrapper.style.height = `${roundedHeight}px`;
          imageWrapper.style.left = `0px`;
          imageWrapper.style.top = `0px`;
          // Circle mask uses 50% border-radius, BUT NOT in crop mode (show full image)
          imageWrapper.style.borderRadius = (!obj.isCropping && obj.maskType === 'circle') ? '50%' : `${scaledBorderRadius}px`;
        }
              
        // Calculate border dimensions (needed for both permanentBorder and selectionBorder)
        const baseBorderWidth = obj.borderWidth !== undefined ? obj.borderWidth : DEFAULT_BORDER_WIDTH;
        const baseBorderRadius = obj.borderRadius !== undefined ? obj.borderRadius : DEFAULT_BORDER_RADIUS;
        const scaledBorderWidth = Math.round(baseBorderWidth * scale);
        const scaledBorderRadius = Math.round(baseBorderRadius * scale);
              
        // Update SVG permanentBorder
        const permanentBorder = container.querySelector('.wbe-image-permanent-border');
        if (permanentBorder) {
          const borderRgba = scaledBorderWidth > 0 
            ? hexToRgba(obj.borderHex || DEFAULT_BORDER_HEX, obj.borderOpacity !== undefined ? obj.borderOpacity : DEFAULT_BORDER_OPACITY) 
            : null;
          const isCircleMask = obj.maskType === 'circle';
          this._updateSvgPermanentBorder(permanentBorder, roundedWidth, roundedHeight, scaledBorderWidth, borderRgba, scaledBorderRadius, isCircleMask);
        }
              
        // selectionBorder must be OUTSIDE permanentBorder (box-shadow)
        // BUT in crop mode, permanentBorder is hidden, so no offset needed
        const selectionBorder = container.querySelector('.wbe-image-selection-border');
        if (selectionBorder && roundedWidth > 0 && roundedHeight > 0) {
          if (obj.isCropping) {
            // In crop mode: no offset
            selectionBorder.style.width = `${roundedWidth}px`;
            selectionBorder.style.height = `${roundedHeight}px`;
            selectionBorder.style.left = `0px`;
            selectionBorder.style.top = `0px`;
          } else {
            // Normal mode: expand by borderWidth
            selectionBorder.style.width = `${roundedWidth + 2 * scaledBorderWidth}px`;
            selectionBorder.style.height = `${roundedHeight + 2 * scaledBorderWidth}px`;
            selectionBorder.style.left = `-${scaledBorderWidth}px`;
            selectionBorder.style.top = `-${scaledBorderWidth}px`;
          }
        }
              
        const clickTarget = container.querySelector('.wbe-image-click-target');
        if (clickTarget && roundedWidth > 0 && roundedHeight > 0) {
          clickTarget.style.width = `${roundedWidth}px`;
          clickTarget.style.height = `${roundedHeight}px`;
          clickTarget.style.left = `0px`;
          clickTarget.style.top = `0px`;
        }
              
        const resizeHandle = container.querySelector('.wbe-image-resize-handle');
        if (resizeHandle && obj.selected) {
          // In crop mode: no borderWidth offset (permanentBorder is hidden)
          // In normal mode: add borderWidth offset to match selectionBorder corner
          const borderOffset = obj.isCropping ? 0 : scaledBorderWidth;
          resizeHandle.style.left = `${roundedWidth + RESIZE_HANDLE_OFFSET_X + borderOffset}px`;
          resizeHandle.style.top = `${roundedHeight + RESIZE_HANDLE_OFFSET_Y + borderOffset}px`;
          resizeHandle.style.transform = 'none';
          resizeHandle.style.transformOrigin = '';
        }
              
        // Update clip-path for circle mask (not in crop mode)
        if (maskType === 'circle') {
          const circleOffset = obj.circleOffset || { x: 0, y: 0 };
          const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
          const baseCenterX = baseWidth / 2 + circleOffset.x;
          const baseCenterY = baseHeight / 2 + circleOffset.y;
          const scaledRadius = Math.round(circleRadius * scale);
          const scaledCenterX = Math.round(baseCenterX * scale);
          const scaledCenterY = Math.round(baseCenterY * scale);
          const clipPath = `circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px)`;
          imageElement.style.clipPath = clipPath;
        }
      }
    }
  }

  _updateObjectElement(id, obj, changes = null) {
    const container = document.getElementById(id);
    if (!container) return;

    // Check if object can be updated - protect DOM from style changes during drag/edit/resize
    // This check must be BEFORE position update to prevent layout recalculation from changing width
    const canUpdateStyles = this._interactionManager?.canUpdateStyles(id) ?? true;
    const isDragging = this._interactionManager?.isDragging(id) || false;
    const isScaleResizing = this._interactionManager?.scaleResizeState?.id === id;

    // CRITICAL: During drag, skip DOM update - it's already updated directly in _updateDrag
    // Registry may have stale values during drag, but DOM is current
    // Registry will be synced in _endDrag() with final position
    if (isDragging) {
      // OPTIMIZATION: DOM already updated directly in _updateDrag()
      // Skip DOM update here to prevent redundant operations
      // Registry will be synced with DOM in _endDrag()
      return;
    }

    // CRITICAL: During scale resize, skip DOM update - it's already updated directly in _updateScaleResize
    // Registry may have stale values during resize, but DOM is current
    // Registry will be synced in _endScaleResize() with final scale
    if (isScaleResizing) {
      // OPTIMIZATION: DOM already updated directly in _updateScaleResize()
      // Skip DOM update here to prevent redundant operations
      // Registry will be synced with DOM in _endScaleResize()
      return;
    }

    // Update position (when not dragging)
    // Use centralized method to maintain Single Source of Truth
    if (!changes || 'x' in changes || 'y' in changes) {
      this._applyElementStyles(container, {
        left: `${obj.x}px`,
        top: `${obj.y}px`
      });
    }

    // Update z-index from model (SSOT: model is source of truth, DOM is synchronized)
    if (!changes || 'zIndex' in changes) {
      this._applyElementStyles(container, {
        zIndex: obj.zIndex !== undefined ? obj.zIndex : 0
      });
    }

    // Handle text objects
    if (obj.type === 'text') {
      // Cache DOM element once to avoid multiple queries (DRY optimization)
      const textElement = container.querySelector('.wbe-canvas-text');
      if (!textElement) return;

      // Update selection border (separate div with inverse transform to avoid scaling)
      // Container has transform: scale(), so selection border uses inverse transform
      // This keeps outline visually 1px regardless of scale
      const selectionBorder = container.querySelector('.wbe-text-selection-border');
      if (selectionBorder) {
        this._updateTextSelectionBorder(selectionBorder, obj, changes);
      }

      // Update resize handle
      // NOTE: Old DOM resize handle removed - SVG selection overlay handle is used instead

      if (!canUpdateStyles) {
        // During edit/resize: protect DOM from style changes (lock mode for DOM)
        // Only allow position updates (x/y) and textWidth sync to prevent browser auto-resize
        // This complements Registry lock mode which protects the model

        // CRITICAL: Apply textWidth from model to DOM
        // If textWidth is set (fixed width mode), use it
        // If textWidth is null, use max-width: 400px (will be fixed by _handleTextPasteFromClipboard)
        if (obj.textWidth && obj.textWidth > 0) {
          textElement.style.width = `${obj.textWidth}px`;
          textElement.style.maxWidth = '';
        } else {
          // Auto-width mode with max limit - used only briefly before textWidth is fixed
          textElement.style.width = 'auto';
          textElement.style.maxWidth = '400px';
        }

        // CRITICAL: Force sync styles from model to DOM to prevent external DOM manipulation
        // This overwrites any direct DOM changes (like from console attacks)
        // Style updates are needed during edit/resize to prevent browser auto-changes
        const textColorRgba = hexToRgba(obj.color || DEFAULT_TEXT_COLOR, obj.colorOpacity !== undefined ? obj.colorOpacity : 100);
        textElement.style.color = textColorRgba || obj.color || DEFAULT_TEXT_COLOR;
        textElement.style.fontSize = `${obj.fontSize || DEFAULT_FONT_SIZE}px`;
        textElement.style.fontFamily = obj.fontFamily || DEFAULT_FONT_FAMILY;
        textElement.style.fontWeight = obj.fontWeight || DEFAULT_FONT_WEIGHT;
        textElement.style.fontStyle = obj.fontStyle || DEFAULT_FONT_STYLE;
        textElement.style.textAlign = obj.textAlign || DEFAULT_TEXT_ALIGN;

        // CRITICAL: Update scale even during resize for smooth scaling
        // Scale must be updated during resize, otherwise scaling will be jerky
        // Unification: transform on container (like images) for consistent DOM structure
        if (!changes || 'scale' in changes) {
          const scale = obj.scale !== undefined ? obj.scale : 1;
          container.style.transform = `scale(${scale})`;
          container.style.transformOrigin = 'top left';
        }

        // Exit early - don't apply any other styles during edit/resize
        return;
      }

      // Normal update (not dragging/edit/resize) - apply all styles for text objects
      if (canUpdateStyles) {
        // Reuse textElement from above (already queried in text block)
        const textSpan = container.querySelector('.wbe-text-background-span');

      // CRITICAL: Update text in DOM if it has changed
      // This is necessary for text synchronization via socket (objects are created/updated remotely)
      if (!changes || 'text' in changes) {
        if (textSpan) {
          // If text contains HTML tags - use innerHTML, otherwise use textContent for security
          if (obj.text && /<[a-z][\s\S]*>/i.test(obj.text)) {
            // HTML markup detected - using innerHTML with sanitization
            textSpan.innerHTML = sanitizeHtml(obj.text);
          } else {
            // Plain text - using textContent for safety
            textSpan.textContent = obj.text || '';
          }
        }
      }

      // Partial updates: update ONLY the styles that changed
      // If changes = null → full update (all styles)
      // If changes = {color: ...} → update only color
      // Elegant: use field-to-style mapping instead of many ifs
      
      // Determine which fields correspond to text styles
      const textStyleFields = new Set(['color', 'colorOpacity', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign', 'textWidth', 'backgroundColor', 'backgroundColorOpacity', 'borderColor', 'borderOpacity', 'borderWidth']);
      
      // Check if changes contain at least one style field (or changes = null for full update)
      const hasStyleChanges = !changes || Object.keys(changes).some(key => textStyleFields.has(key));
      
      const allTextElementStyles = {};
      const textSpanStyles = {};
      
      if (hasStyleChanges) {
        // Update only styles present in changes (or all if changes = null)
        const shouldUpdate = (field) => !changes || field in changes;
        
        // Text width (depends only on textWidth)
        if (shouldUpdate('textWidth')) {
          if (obj.textWidth && obj.textWidth > 0) {
            allTextElementStyles.width = `${obj.textWidth}px`;
          } else {
            allTextElementStyles.width = '';
          }
        }
        
        // Color (depends on color and colorOpacity)
        if (shouldUpdate('color') || shouldUpdate('colorOpacity')) {
          const textColorRgba = hexToRgba(obj.color || DEFAULT_TEXT_COLOR, obj.colorOpacity !== undefined ? obj.colorOpacity : 100);
          allTextElementStyles.color = textColorRgba || obj.color || DEFAULT_TEXT_COLOR;
        }
        
        // Font properties (each field is independent)
        if (shouldUpdate('fontSize')) {
          allTextElementStyles.fontSize = `${obj.fontSize || DEFAULT_FONT_SIZE}px`;
        }
        if (shouldUpdate('fontFamily')) {
          allTextElementStyles.fontFamily = obj.fontFamily || DEFAULT_FONT_FAMILY;
        }
        if (shouldUpdate('fontWeight')) {
          allTextElementStyles.fontWeight = obj.fontWeight || DEFAULT_FONT_WEIGHT;
        }
        if (shouldUpdate('fontStyle')) {
          allTextElementStyles.fontStyle = obj.fontStyle || DEFAULT_FONT_STYLE;
        }
        if (shouldUpdate('textAlign')) {
          allTextElementStyles.textAlign = obj.textAlign || DEFAULT_TEXT_ALIGN;
        }
        
        // Border (depends on borderWidth, borderColor, and borderOpacity)
        // Update permanentBorder (box-shadow based, like images)
        if (shouldUpdate('borderWidth') || shouldUpdate('borderColor') || shouldUpdate('borderOpacity') || shouldUpdate('scale')) {
          const permanentBorder = container.querySelector('.wbe-text-permanent-border');
          if (permanentBorder) {
            const borderWidth = obj.borderWidth || 0;
            const borderRgba = borderWidth > 0 ? hexToRgba(obj.borderColor || DEFAULT_BORDER_HEX, obj.borderOpacity !== undefined ? obj.borderOpacity : DEFAULT_BORDER_OPACITY) : null;
            permanentBorder.style.boxShadow = borderWidth > 0 && borderRgba ? `0 0 0 ${borderWidth}px ${borderRgba}` : "none";
          }
        }
        
        // Background color (depends on backgroundColor and backgroundColorOpacity)
        if (textSpan && (shouldUpdate('backgroundColor') || shouldUpdate('backgroundColorOpacity'))) {
          if (obj.backgroundColor === "transparent") {
            textSpanStyles.backgroundColor = "transparent";
          } else {
            const bgColorHex = obj.backgroundColor && obj.backgroundColor !== DEFAULT_BACKGROUND_COLOR ? obj.backgroundColor : DEFAULT_SPAN_BACKGROUND_COLOR;
            const bgColorRgba = hexToRgba(bgColorHex, obj.backgroundColorOpacity !== undefined ? obj.backgroundColorOpacity : 100);
            textSpanStyles.backgroundColor = bgColorRgba || bgColorHex;
          }
        }
      }
      
      // Apply span styles if any
      if (Object.keys(textSpanStyles).length > 0) {
        this._applyElementStyles(textSpan, textSpanStyles);
      }

      // Unification: transform on container (like images) for consistent DOM structure
      // Do NOT apply scale to textElement - scale is now on container
      if (!changes || 'scale' in changes) {
        const scale = obj.scale !== undefined ? obj.scale : 1;
        container.style.transform = `scale(${scale})`;
        container.style.transformOrigin = 'top left';
      }

      // Note: outline is applied to container (above) to prevent scaling with transform
      // Outline should always be 1px regardless of object scale

      // Apply ALL textElement styles in ONE batch (dramatic performance improvement)
      this._applyElementStyles(textElement, allTextElementStyles);
      }
    } else if (obj.type === 'image') {
      // DRY: similar logic for images
      const imageElement = container.querySelector('.wbe-canvas-image');
      if (!imageElement) return;

      // Update frozen state: class, pointer-events, and unfreeze icon
      // CRITICAL: Always check frozen state (not just when 'frozen' in changes)
      // This ensures icon is restored after F5 refresh even if changes doesn't include 'frozen'
      if (!changes || 'frozen' in changes) {
        if (obj.frozen) {
          container.classList.add('wbe-image-frozen');
          // Frozen images allow pan/zoom through them (pointer-events: none)
          container.style.pointerEvents = 'none';
          const clickTarget = container.querySelector('.wbe-image-click-target');
          if (clickTarget) {
            clickTarget.style.pointerEvents = 'none';
          }
          // Deselect frozen image (frozen images cannot be selected)
          // Update Registry to set selected=false, then deselect through InteractionManager
          if (obj.selected) {
            this.registry.update(id, {
              selected: false
            }, 'local');
            if (this._interactionManager) {
              this._interactionManager._deselect();
            }
          }
          // Show unfreeze icon
          this._showUnfreezeIcon(container, obj);
        } else {
          container.classList.remove('wbe-image-frozen');
          // Hide unfreeze icon
          this._hideUnfreezeIcon(container);
          // Restore pointer-events (will be set by selection state)
          if (!obj.selected) {
            container.style.pointerEvents = 'none';
            const clickTarget = container.querySelector('.wbe-image-click-target');
            if (clickTarget) {
              clickTarget.style.pointerEvents = 'none';
            }
          } else {
            container.style.pointerEvents = 'auto';
            const clickTarget = container.querySelector('.wbe-image-click-target');
            if (clickTarget) {
              clickTarget.style.pointerEvents = 'auto';
            }
          }
        }
      } else {
        // No changes or frozen not in changes, but we still need to sync frozen state
        // This handles F5 refresh case where changes might be null or empty
        if (obj.frozen) {
          // Ensure frozen class and icon are present
          if (!container.classList.contains('wbe-image-frozen')) {
            container.classList.add('wbe-image-frozen');
          }
          // CRITICAL: Ensure pointer-events: none for frozen images
          // This is needed when other changes (like selected: false) trigger update
          container.style.pointerEvents = 'none';
          const clickTarget = container.querySelector('.wbe-image-click-target');
          if (clickTarget) {
            clickTarget.style.pointerEvents = 'none';
          }
          // Ensure icon exists
          const existingIcon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
          if (!existingIcon) {
            this._showUnfreezeIcon(container, obj);
          }
        } else {
          // Ensure frozen class and icon are removed
          if (container.classList.contains('wbe-image-frozen')) {
            container.classList.remove('wbe-image-frozen');
          }
          this._hideUnfreezeIcon(container);
        }
      }

      // Update unfreeze icon position if frozen (when scale or dimensions change)
      // CRITICAL: Also update position after F5 refresh (when changes is null/empty)
      // This ensures icon position is correct even if no changes were detected
      if (obj.frozen) {
        if (!changes || 'scale' in changes || 'baseWidth' in changes || 'baseHeight' in changes) {
          this._updateUnfreezeIconPosition(container, obj);
        } else {
          // After F5 refresh, ensure icon position is updated even if no changes
          const existingIcon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
          if (existingIcon) {
        this._updateUnfreezeIconPosition(container, obj);
          }
        }
      }

      // ALTERNATIVE 1: Use width/height instead of transform: scale()
      const scale = obj.scale !== undefined ? obj.scale : 1;
      
      // CRITICAL: Calculate visible dimensions FIRST to account for crop
      // This must be done BEFORE setting imageElement dimensions
      const dims = this._calculateImageVisibleDimensions(imageElement, id);
      
      if (!changes || 'scale' in changes || 'baseWidth' in changes || 'baseHeight' in changes) {
        if (imageElement) {
          // Update width/height directly instead of using transform: scale()
          const baseWidth = obj.baseWidth || imageElement.naturalWidth || obj.width || 200;
          const baseHeight = obj.baseHeight || imageElement.naturalHeight || obj.height || 200;
          
          // CRITICAL: imageElement always needs full size (baseWidth * scale) for clip-path to work correctly
          // The visible area is controlled by imageWrapper dimensions and clip-path
          // clip-path operates on base pixels, so imageElement must have full scaled size
          // Round to prevent subpixel jittering
          const displayWidth = Math.round(baseWidth * scale);
          const displayHeight = Math.round(baseHeight * scale);
          imageElement.style.width = `${displayWidth}px`;
          imageElement.style.height = `${displayHeight}px`;
          imageElement.style.maxWidth = `${displayWidth}px`;
          imageElement.style.maxHeight = `${displayHeight}px`;
        }
      }
      
      // Update sizes and position of borders and clickTarget
      // dims now correctly accounts for crop in visible dimensions
      
      // CRITICAL: Set explicit container sizes for correct getBoundingClientRect()
      // Container must have size for clicks to work correctly
      if (dims.width > 0 && dims.height > 0) {
        container.style.width = `${dims.width}px`;
        container.style.height = `${dims.height}px`;
      }
      
      // CRITICAL: For images, container position must account for crop offset
      // Container shows VISIBLE area, which starts at obj.x + dims.left, obj.y + dims.top
      // This ensures: top gizmo drag moves TOP border (not bottom), left gizmo drag moves LEFT border (not right)
      // CRITICAL: Also update on 'scale' changes because dims.left/top depend on scale!
      // Round to prevent subpixel jittering
      if (!changes || 'x' in changes || 'y' in changes || 'crop' in changes || 'scale' in changes) {
        container.style.left = `${Math.round(obj.x) + (dims.left || 0)}px`;
        container.style.top = `${Math.round(obj.y) + (dims.top || 0)}px`;
      }
      
      // Update imageWrapper size and border-radius to clip the image
      // CRITICAL: imageWrapper must match container size (visible area) to prevent clicking outside crop
      // clip-path on imageElement already clips the image, so imageWrapper should match visible area
      const imageWrapper = container.querySelector('.wbe-image-wrapper');
      if (imageWrapper && dims.width > 0 && dims.height > 0) {
        const baseBorderRadius = obj.borderRadius !== undefined ? obj.borderRadius : DEFAULT_BORDER_RADIUS;
        // Scale borderRadius proportionally - round to prevent subpixel jittering
        const scaledBorderRadius = Math.round(baseBorderRadius * scale);
        imageWrapper.style.width = `${dims.width}px`;
        imageWrapper.style.height = `${dims.height}px`;
        imageWrapper.style.left = `0px`;  // Always at container origin
        imageWrapper.style.top = `0px`;    // Always at container origin
        // Circle mask uses 50% border-radius, BUT NOT in crop mode (show full image)
        imageWrapper.style.borderRadius = (!obj.isCropping && obj.maskType === 'circle') ? '50%' : `${scaledBorderRadius}px`;
      }
      
      // permanentBorder uses inset: 0 - automatically matches container size
      // No explicit width/height needed (prevents subpixel gaps)
      
      // Update selectionBorder size and position
      const selectionBorder = container.querySelector('.wbe-image-selection-border');
      if (selectionBorder) {
        // Apply outline styles to selectionBorder div
        // CRITICAL: Also update if isCropping changed (to restore border color after crop mode)
        if (!changes || 'selected' in changes || (changes && 'isCropping' in changes && !obj.isCropping)) {
          const borderStyles = {};
          if (obj.selected) {
            // In crop mode: keep purple outline for rect, blue for circle
            // Outside crop mode: selection overlay handles visual border
            if (obj.isCropping) {
              const isCircleMask = obj.maskType === 'circle';
              borderStyles.outline = isCircleMask ? "1px solid #1c86ff" : "1px solid rgba(128, 0, 255, 0.9)";
              borderStyles.border = "none";
              borderStyles.display = "block";
              borderStyles.zIndex = "1000";
              borderStyles.borderRadius = "0";
            } else {
              // Selection overlay now handles visual border (z-index: 999, always on top)
              // Keep selectionBorder element for gizmo positioning but hide its outline
              borderStyles.outline = "none";
              borderStyles.border = "none";
              borderStyles.display = "block"; // Keep visible for gizmo positioning
              borderStyles.zIndex = "1000"; // Above permanent border (999)
              borderStyles.borderRadius = "0";
            }
          } else {
            borderStyles.outline = "none";
            borderStyles.border = "none";
            borderStyles.display = "none";
          }
          this._applyElementStyles(selectionBorder, borderStyles);
        }
        
        // Update size and position (as in old code via updateImageBorder)
        // CRITICAL: selectionBorder must be OUTSIDE permanentBorder (box-shadow)
        // BUT in crop mode, permanentBorder is hidden, so no offset needed
        if (dims.width > 0 && dims.height > 0) {
          if (obj.isCropping) {
            // In crop mode: no offset (permanentBorder is hidden)
            selectionBorder.style.width = `${dims.width}px`;
            selectionBorder.style.height = `${dims.height}px`;
            selectionBorder.style.left = `0px`;
            selectionBorder.style.top = `0px`;
          } else {
            // Normal mode: expand by borderWidth to be outside permanentBorder
            // Round to prevent subpixel jittering
            const baseBorderWidth = obj.borderWidth !== undefined ? obj.borderWidth : DEFAULT_BORDER_WIDTH;
            const scaledBorderWidth = Math.round(baseBorderWidth * scale);
            selectionBorder.style.width = `${dims.width + 2 * scaledBorderWidth}px`;
            selectionBorder.style.height = `${dims.height + 2 * scaledBorderWidth}px`;
            selectionBorder.style.left = `-${scaledBorderWidth}px`;
            selectionBorder.style.top = `-${scaledBorderWidth}px`;
          }
        }
      }
      
      // Update clickTarget size and position (as in old code via updateClickTarget)
      // CRITICAL: clickTarget must match container size (visible area) and be at container origin
      // Position dims.left/top is only for imageElement inside imageWrapper, not for clickTarget
      const clickTarget = container.querySelector('.wbe-image-click-target');
      if (clickTarget && dims.width > 0 && dims.height > 0) {
        clickTarget.style.width = `${dims.width}px`;
        clickTarget.style.height = `${dims.height}px`;
        clickTarget.style.left = `0px`;  // Always at container origin
        clickTarget.style.top = `0px`;    // Always at container origin
      }
      
      // CRITICAL: If crop is applied, ensure clip-path is updated after dimensions are set
      // This ensures clip-path is applied correctly after imageElement dimensions are updated
      if (obj.crop && obj.type === 'image') {
        const maskType = obj.maskType || 'rect';
        if (maskType === 'rect' || maskType === 'circle') {
          this.updateImageClipPath(id);
        }
      }

      // Update resize handle (same logic as text)
      // DRY: use unified _updateResizeHandle method
      // For images: position relative to scaled image
      // ALTERNATIVE 1: scale via width/height, so gizmo does not scale automatically
      this._updateResizeHandle(container, '.wbe-image-resize-handle', obj, id, (handle) => {
        // Position gizmo relative to visible image area
        // dims now simply returns current imageElement size (already scaled via width/height)
        // CRITICAL: Pass imageId to account for crop in visible dimensions
        const dims = this._calculateImageVisibleDimensions(imageElement, id);
        // In crop mode: no borderWidth offset (permanentBorder is hidden)
        // In normal mode: add borderWidth offset to match selectionBorder corner
        // selectionBorder: left=-bw, width=dims.width+2*bw => right corner at dims.width+bw
        const baseBorderWidth = obj.borderWidth !== undefined ? obj.borderWidth : DEFAULT_BORDER_WIDTH;
        const borderOffset = obj.isCropping ? 0 : baseBorderWidth * scale;
        // dims.left/top is container offset from obj.x/y - inside container everything starts at 0,0
        handle.style.left = `${dims.width + RESIZE_HANDLE_OFFSET_X + borderOffset}px`;
        handle.style.top = `${dims.height + RESIZE_HANDLE_OFFSET_Y + borderOffset}px`;
        // Explicitly remove transform so gizmo does not scale
        handle.style.transform = 'none';
        handle.style.transformOrigin = '';
      });
      
      if (!canUpdateStyles) {
        return;
      }

      // Border and shadow styles (architecturally aligned with text)
      // Structure as in the old code: container (shadow, overflow) > permanentBorder (border) > clickTarget > img
      const imageStyleFields = new Set(['borderHex', 'borderOpacity', 'borderWidth', 'borderRadius', 'shadowHex', 'shadowOpacity']);
      const hasStyleChanges = !changes || Object.keys(changes).some(key => imageStyleFields.has(key) || key === 'scale');
      
      if (hasStyleChanges) {
        const shouldUpdate = (field) => !changes || field in changes;
        
        // Permanent border as SVG (prevents subpixel gaps)
        let permanentBorder = container.querySelector('.wbe-image-permanent-border');
        if (!permanentBorder) {
          // Create SVG permanent border if not exists
          permanentBorder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          permanentBorder.setAttribute("class", "wbe-image-permanent-border");
          permanentBorder.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: block;
            z-index: 999;
            overflow: visible;
          `;
          // Insert after imageWrapper
          const imageWrapper = container.querySelector('.wbe-image-wrapper');
          if (imageWrapper && imageWrapper.nextSibling) {
            container.insertBefore(permanentBorder, imageWrapper.nextSibling);
          } else {
            container.appendChild(permanentBorder);
          }
        }
        
        // Update SVG permanentBorder (depends on borderWidth, borderHex, borderOpacity, borderRadius, scale, maskType)
        if (shouldUpdate('borderWidth') || shouldUpdate('borderHex') || shouldUpdate('borderOpacity') || shouldUpdate('borderRadius') || shouldUpdate('scale') || shouldUpdate('maskType') || shouldUpdate('isCropping')) {
          const baseBorderWidth = obj.borderWidth !== undefined ? obj.borderWidth : DEFAULT_BORDER_WIDTH;
          const baseBorderRadius = obj.borderRadius !== undefined ? obj.borderRadius : DEFAULT_BORDER_RADIUS;
          // Scale proportionally - round to prevent subpixel jittering
          const scaledBorderWidth = Math.round(baseBorderWidth * scale);
          const scaledBorderRadius = Math.round(baseBorderRadius * scale);
          const borderRgba = scaledBorderWidth > 0 
            ? hexToRgba(obj.borderHex || DEFAULT_BORDER_HEX, obj.borderOpacity !== undefined ? obj.borderOpacity : DEFAULT_BORDER_OPACITY) 
            : null;
          const isCircleMask = obj.maskType === 'circle';
          
          // Update SVG border
          this._updateSvgPermanentBorder(permanentBorder, dims.width, dims.height, scaledBorderWidth, borderRgba, scaledBorderRadius, isCircleMask);
          
          // Save the original borderRadius in dataset for persistence
          permanentBorder.dataset.borderRadius = `${baseBorderRadius}`;
          
          // Update imageWrapper border-radius to clip the image (also scaled)
          // For circle mask: use 50% to make wrapper circular, BUT NOT in crop mode
          const imageWrapper = container.querySelector('.wbe-image-wrapper');
          if (imageWrapper) {
            imageWrapper.style.borderRadius = (!obj.isCropping && isCircleMask) ? '50%' : `${scaledBorderRadius}px`;
          }
          
          // CRITICAL: Update selectionBorder size/position when borderWidth changes
          // selectionBorder must be OUTSIDE permanentBorder (box-shadow)
          const selectionBorderForStyle = container.querySelector('.wbe-image-selection-border');
          if (selectionBorderForStyle && dims.width > 0 && dims.height > 0) {
            selectionBorderForStyle.style.width = `${dims.width + 2 * scaledBorderWidth}px`;
            selectionBorderForStyle.style.height = `${dims.height + 2 * scaledBorderWidth}px`;
            selectionBorderForStyle.style.left = `-${scaledBorderWidth}px`;
            selectionBorderForStyle.style.top = `-${scaledBorderWidth}px`;
          }
        }
        
        // Apply shadow to container (as in old code - using filter: drop-shadow)
        // Old code has NO border-radius on container for shadow
        if (shouldUpdate('shadowHex') || shouldUpdate('shadowOpacity')) {
          const shadowRgba = hexToRgba(obj.shadowHex || DEFAULT_SHADOW_HEX, obj.shadowOpacity !== undefined ? obj.shadowOpacity : DEFAULT_SHADOW_OPACITY);
          container.style.filter = shadowRgba 
            ? `drop-shadow(0 4px 8px ${shadowRgba})` 
            : "none";
        }
      }
    } else {
      // Custom types (registered via Whiteboard.registerObjectType)
      // Position and z-index are already updated above
      // Call polymorphic updateElement method if available
      if (obj.updateElement && typeof obj.updateElement === 'function') {
        obj.updateElement(container, changes);
      }
      
      // Update selection border if object has one
      const selectionBorder = container.querySelector('[class*="-selection-border"]');
      if (selectionBorder) {
        selectionBorder.style.display = obj.selected ? 'block' : 'none';
      }
    }
  }

  /**
   * Update SVG permanent border for image
   * @param {Element} permanentBorder - SVG element
   * @param {number} width - container width
   * @param {number} height - container height
   * @param {number} borderWidth - border width in pixels
   * @param {string} borderColor - border color (rgba string)
   * @param {number} borderRadius - border radius for rect
   * @param {boolean} isCircle - true for circle mask
   */
  _updateSvgPermanentBorder(permanentBorder, width, height, borderWidth, borderColor, borderRadius, isCircle) {
    if (!permanentBorder) return;
    
    // Update viewBox
    permanentBorder.setAttribute("viewBox", `0 0 ${width} ${height}`);
    
    // Get or create shape
    let borderShape = permanentBorder.querySelector('.wbe-permanent-border-shape');
    const needsRecreate = borderShape && ((isCircle && borderShape.tagName !== 'circle') || (!isCircle && borderShape.tagName !== 'rect'));
    
    if (!borderShape || needsRecreate) {
      if (borderShape) borderShape.remove();
      if (isCircle) {
        borderShape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      } else {
        borderShape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      }
      borderShape.setAttribute("class", "wbe-permanent-border-shape");
      borderShape.setAttribute("fill", "none");
      permanentBorder.appendChild(borderShape);
    }
    
    // Update shape attributes
    if (isCircle) {
      const radius = Math.min(width, height) / 2;
      borderShape.setAttribute("cx", `${width / 2}`);
      borderShape.setAttribute("cy", `${height / 2}`);
      borderShape.setAttribute("r", `${Math.max(0, radius - borderWidth / 2)}`);
    } else {
      borderShape.setAttribute("x", `${borderWidth / 2}`);
      borderShape.setAttribute("y", `${borderWidth / 2}`);
      borderShape.setAttribute("width", `${Math.max(0, width - borderWidth)}`);
      borderShape.setAttribute("height", `${Math.max(0, height - borderWidth)}`);
      borderShape.setAttribute("rx", `${borderRadius}`);
      borderShape.setAttribute("ry", `${borderRadius}`);
    }
    borderShape.setAttribute("stroke", borderColor || "transparent");
    borderShape.setAttribute("stroke-width", `${borderWidth}`);
  }

  /**
   * Update resize handle for object (unified logic for text and image) (Below selection border (outline) and resizeHandle image)
   * DRY: DRY: extracted common handle update logic from _updateObjectElement _updateObjectElement
   */
  _updateResizeHandle(container, handleSelector, obj, id, getPositionFn) {
    const resizeHandle = container.querySelector(handleSelector);
    if (!resizeHandle) return;
    
    // DEPRECATED: Old DOM handles are now replaced by SVG overlay handle
    // Always hide old DOM handles - SVG overlay handle is used instead
    // This keeps backward compatibility while transitioning to new system
    resizeHandle.style.display = 'none';
  }

  /**
   * Update outline for element with scale compensation scale
   * DRY: DRY: extracted common outline update logic from _updateObjectElement _updateObjectElement
   * Outline Outline should always be visually 1px regardless of object scale, regardless of the object's scale
   * Use a separate div .wbe-image-selection-border (rectangular) for images div .wbe-image-selection-border (rectangular)
   */
  _updateOutline(element, obj, changes) {
    if (!element || !changes && changes !== null) return;
    if (!changes || 'selected' in changes || 'scale' in changes) {
      const elementStyles = {};
      // Selection overlay now handles visual border (z-index: 999, always on top)
      // Remove outline from text element - it was causing duplicate borders
      elementStyles.outline = "none";
      this._applyElementStyles(element, elementStyles);
    }
  }
  /**
   * Update text selection border with inverse transform to avoid scaling
   * Container has transform: scale(), so selection border uses inverse transform
   * This keeps outline visually 1px regardless of scale
   * CRITICAL: Account for textSpan padding (4px top, 2px left) to encompass all content
   */
  _updateTextSelectionBorder(selectionBorder, obj, changes) {
    if (!selectionBorder || (!changes && changes !== null)) return;
    if (!changes || 'selected' in changes || 'scale' in changes || 'borderWidth' in changes) {
      const scale = obj.scale !== undefined ? obj.scale : 1;
      const borderWidth = obj.borderWidth || 0;
      
      if (obj.selected) {
        // Selection overlay now handles visual border (z-index: 999, always on top)
        // Keep selectionBorder element for gizmo positioning but hide its visual border
        
        // Clear any previous transform/width/height/outline
        selectionBorder.style.transform = '';
        selectionBorder.style.width = '';
        selectionBorder.style.height = '';
        selectionBorder.style.outline = 'none';
        selectionBorder.style.boxShadow = 'none'; // No visual border - overlay handles it
        
        // Position outside permanent border (for gizmo positioning)
        selectionBorder.style.left = `-${borderWidth}px`;
        selectionBorder.style.top = `-${borderWidth}px`;
        selectionBorder.style.right = `-${borderWidth}px`;
        selectionBorder.style.bottom = `-${borderWidth}px`;
        selectionBorder.style.display = "block"; // Keep visible for gizmo positioning
      } else {
        selectionBorder.style.outline = "none";
        selectionBorder.style.boxShadow = "none";
        selectionBorder.style.display = "none";
      }
    }
  }

  /**
   * Compensate width for scale (to keep visual width constant) scale (to keep the visual width constant)
   * DRY: reuse compensation logic for border, outline, borderRadius and other properties
   * Used for properties, that should not scale with the object
   * 
   * @param {number} width - Original width in pixels
   * @param {number} scale - Object scale
   * @returns {number} Compensated width (width / scale)
   */
  _compensateWidthForScale(width, scale) {
    if (!width || width <= 0) return width;
    if (!scale || scale <= 0) return width;
    return width / scale;
  }

  /**
   * Calculate visible image dimensions
   * ALTERNATIVE 1: Use width/height instead of transform: scale()
   * Now simply return the current imageElement dimensions (already scaled via width/height) imageElement (already scaled via width/height)
   * CRITICAL: Must account for crop to calculate actual visible area after clip-path is applied
   * @param {HTMLElement} imageElement - Image element
   * @param {string} imageId - Image ID for getting crop data from Registry
   * @returns {Object} { width, height, left, top } - Visible area size and position
   */
  _calculateImageVisibleDimensions(imageElement, imageId = null, overrideScale = null) {
    // CRITICAL: Account for crop to calculate actual visible area
    // If crop is applied via clip-path, the visible area is smaller than imageElement dimensions
    // overrideScale: optional scale value to use instead of reading from Registry (for real-time updates during scale resize)
    if (imageId && this.registry) {
      const obj = this.registry.get(imageId);
      if (obj && obj.type === 'image' && obj.crop) {
        const crop = obj.crop || { top: 0, right: 0, bottom: 0, left: 0 };
        const maskType = obj.maskType || 'rect';
        // Use overrideScale if provided (for real-time updates during scale resize), otherwise read from Registry
        const scale = overrideScale !== null ? overrideScale : (obj.scale !== undefined ? obj.scale : 1);
        
        // CRITICAL: Use BASE dimensions, not scaled!
        // Fallback chain: obj.baseWidth → imageElement.naturalWidth → calculate from offsetWidth/scale → 200
        const baseWidth = obj.baseWidth || 
                         (imageElement.naturalWidth > 0 ? imageElement.naturalWidth : 
                          (imageElement.offsetWidth > 0 && scale > 0 ? imageElement.offsetWidth / scale : 200));
        const baseHeight = obj.baseHeight || 
                           (imageElement.naturalHeight > 0 ? imageElement.naturalHeight : 
                            (imageElement.offsetHeight > 0 && scale > 0 ? imageElement.offsetHeight / scale : 200));
        
        if (baseWidth === 0 || baseHeight === 0) {
          return { width: 0, height: 0, left: 0, top: 0 };
        }
        
        if (maskType === 'rect') {
          // Rect mask: first subtract crop from BASE dimensions, then scale
          const croppedBaseWidth = baseWidth - crop.left - crop.right;
          const croppedBaseHeight = baseHeight - crop.top - crop.bottom;
          const visibleWidth = croppedBaseWidth * scale;
          const visibleHeight = croppedBaseHeight * scale;
          
          // Round all dimensions to prevent subpixel jittering
          return {
            width: Math.round(Math.max(0, visibleWidth)),
            height: Math.round(Math.max(0, visibleHeight)),
            left: Math.round(crop.left * scale),
            top: Math.round(crop.top * scale)
          };
        } else if (maskType === 'circle') {
          // Circle mask: use base dimensions for radius calculation, then scale
          const circleRadius = obj.circleRadius !== null ? obj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
          const circleOffset = obj.circleOffset || { x: 0, y: 0 };
          const diameter = circleRadius * 2;
          const scaledDiameter = diameter * scale;
          
          // Calculate center position in base coordinates, then scale
          const centerX = baseWidth / 2 + circleOffset.x;
          const centerY = baseHeight / 2 + circleOffset.y;
          const offsetLeft = (centerX - circleRadius) * scale;
          const offsetTop = (centerY - circleRadius) * scale;
          
          // Round all dimensions to prevent subpixel jittering
          return {
            width: Math.round(scaledDiameter),
            height: Math.round(scaledDiameter),
            left: Math.round(offsetLeft),
            top: Math.round(offsetTop)
          };
        }
      }
    }
    
    // No crop: use current imageElement dimensions (already scaled via width/height)
    // Round to prevent subpixel jittering
    const width = Math.round(imageElement.offsetWidth || 0);
    const height = Math.round(imageElement.offsetHeight || 0);
    
    if (width === 0 || height === 0) {
      return { width: 0, height: 0, left: 0, top: 0 };
    }
    
    return {
      width: width,
      height: height,
      left: 0,
      top: 0
    };
  }


  /**
   * Show unlock icon for frozen image
   * @param {HTMLElement} container - @param {HTMLElement} container - Image container
   * @param {Object} obj - @param {Object} obj - Image object from Registry Registry
   */
  _showUnfreezeIcon(container, obj) {
    if (!container || !obj || obj.type !== 'image' || !obj.frozen) return;

    // Remove existing icon if present
    this._hideUnfreezeIcon(container);

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) return;

    // Create unfreeze icon element
    const icon = document.createElement('div');
    icon.className = 'wbe-unfreeze-icon';
    icon.style.cssText = `
      position: absolute;
      background: rgba(255, 255, 255, 0.9);
      border: none;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 1002;
      pointer-events: auto !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: all 0.2s ease;
      opacity: .5;
    `;

    // Create unlock icon
    const unlockIcon = document.createElement('i');
    unlockIcon.className = 'fas fa-unlock';
    unlockIcon.style.cssText = 'color: #666666;';
    icon.appendChild(unlockIcon);

    // Create progress ring (hidden initially)
    const progressRing = document.createElement('div');
    progressRing.className = 'wbe-unfreeze-progress';
    progressRing.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-90deg);
      border: 3px solid transparent;
      border-top-color: #4a9eff;
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;
    icon.appendChild(progressRing);

    // CSS animation for progress ring (only create styles, no event listeners)
    if (!document.getElementById('wbe-unfreeze-styles')) {
      const style = document.createElement('style');
      style.id = 'wbe-unfreeze-styles';
      style.textContent = `
        @keyframes wbe-unfreeze-rotate {
          0% { transform: translate(-50%, -50%) rotate(-90deg); }
          100% { transform: translate(-50%, -50%) rotate(270deg); }
        }
        .wbe-unfreeze-icon.active .wbe-unfreeze-progress {
          animation: wbe-unfreeze-rotate 1s linear forwards;
        }
      `;
      document.head.appendChild(style);
    }

    // Store cleanup function (no event listeners to clean up - handled by InteractionManager)
    icon.cleanup = () => {
      icon.remove();
    };

    container.appendChild(icon);
    container._unfreezeIcon = icon;

    // Update position (includes scale compensation)
    this._updateUnfreezeIconPosition(container, obj);
  }

  /**
   * Hide unlock icon
   * @param {HTMLElement} container - @param {HTMLElement} container - Image container
   */
  _hideUnfreezeIcon(container) {
    if (!container) return;

    const icon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
    if (icon) {
      if (typeof icon.cleanup === 'function') {
        icon.cleanup();
      } else {
        icon.remove();
      }
      container._unfreezeIcon = null;
    }
  }

  /**
   * Update unlock icon position
   * @param {HTMLElement} container - @param {HTMLElement} container - Image container
   * @param {Object} obj - Image object from Registry
   */
  _updateUnfreezeIconPosition(container, obj) {
    if (!container || !obj) return;

    const icon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
    if (!icon) return;

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) return;

    // CRITICAL: Pass imageId to account for crop in visible dimensions
    const dims = this._calculateImageVisibleDimensions(imageElement, obj.id);
    if (dims.width === 0 || dims.height === 0) return;

    const iconSize = 12;
    const iconOffset = 8;

    // Position at top-left of visible area (inside container, starts at 0,0)
    icon.style.left = `${-iconOffset}px`;
    icon.style.top = `${-iconOffset}px`;
    icon.style.width = `${iconSize}px`;
    icon.style.height = `${iconSize}px`;
    
    // CRITICAL: Images use width/height instead of transform: scale()
    // So NO scale compensation needed - icon stays fixed size naturally
    icon.style.transform = '';
    icon.style.transformOrigin = '';

    const unlockIcon = icon.querySelector('.fas.fa-unlock');
    if (unlockIcon) {
      unlockIcon.style.fontSize = `${iconSize * 0.67}px`;
    }

    const progressRing = icon.querySelector('.wbe-unfreeze-progress');
    if (progressRing) {
      progressRing.style.width = `${iconSize * 1.25}px`;
      progressRing.style.height = `${iconSize * 1.25}px`;
    }
  }

  /**
   * Set active state of unlock icon (for hold-to-activate)
   * Architecturally correct: Layer controls only the visual state, handles events InteractionManager
   * @param {HTMLElement} iconElement - Icon element
   * @param {boolean} active - Whether the state is active hold
   */
  _setUnfreezeIconActive(iconElement, active) {
    if (!iconElement) return;

    const progressRing = iconElement.querySelector('.wbe-unfreeze-progress');
    if (!progressRing) return;

    if (active) {
      iconElement.classList.add('active');
      progressRing.style.opacity = '1';
    } else {
      iconElement.classList.remove('active');
      progressRing.style.opacity = '0';
      progressRing.style.animation = 'none';
      void progressRing.offsetWidth; // Force reflow
      progressRing.style.animation = '';
    }
  }

  /**
   * Set hover state of unlock icon
   * Architecturally correct: Layer controls only the visual state, handles events InteractionManager
   * @param {HTMLElement} iconElement - Icon element
   * @param {boolean} hovered - Whether the mouse is over the icon
   * @param {boolean} isHolding - Whether hold is active hold
   */
  _setUnfreezeIconHover(iconElement, hovered, isHolding) {
    if (!iconElement) return;

    const unlockIcon = iconElement.querySelector('.fas.fa-unlock');
    if (!unlockIcon) return;

    if (hovered && !isHolding) {
      iconElement.style.background = 'rgba(255, 255, 255, 1)';
      unlockIcon.style.color = '#4a9eff';
    } else if (!isHolding) {
      iconElement.style.background = 'rgba(255, 255, 255, 0.9)';
      unlockIcon.style.color = '#666666';
    }
  }

  /**
   * Handle unlock action
   * @param {HTMLElement} container - Image container
   * @param {string} id - ID images
   */
  _handleUnfreezeAction(container, id) {
    if (!container || !id) return;

    // Hide unfreeze icon
    this._hideUnfreezeIcon(container);

    // Unfreeze image through Registry
    if (this.registry) {
      this.registry.update(id, {
        frozen: false
      }, 'local');

      // Select image after unfreezing
      setTimeout(() => {
        if (this._interactionManager) {
          this._interactionManager._select(id);
        }
      }, 50);
    }
  }

  /**
   * Unified method for positioning resize handle
   * DRY: DRY: code reuse for all object types (texts and images) (texts and images)
   * @param {HTMLElement} container - Object container
   * @param {HTMLElement} element - Element for measuring size (textElement or imageElement)
   * @param {HTMLElement} handle - Resize handle element
   * @param {number} scale - Object scale
   * @param {boolean} shouldCompensate - Whether to compensate scale (true for texts, false for images)
   */
  _updateResizeHandlePosition(container, element, handle, scale, shouldCompensate = true) {
    // CRITICAL: Position gizmo at the right-bottom corner of the actual content
    // Use getBoundingClientRect() for stable dimensions that don't change with reflow
    // Convert to container's coordinate system for consistent positioning
    let contentWidth, contentHeight;
    
    // CRITICAL: getBoundingClientRect() returns screen pixels which include canvas zoom
    // Must divide by canvas zoom to get world coordinates
    const canvasScale = canvas?.stage?.worldTransform?.a || 1;
    
    if (shouldCompensate) {
      // For texts: element is textElement, container has transform: scale()
      // getBoundingClientRect() returns: baseWidth * objectScale * canvasScale
      // Divide by BOTH to get base dimensions in container's coordinate system
      const rect = element.getBoundingClientRect();
      const totalScale = (scale > 0 ? scale : 1) * canvasScale;
      contentWidth = (rect.width / totalScale) || 0;
      contentHeight = (rect.height / totalScale) || 0;
    } else {
      // For images: scale is on imageElement, container doesn't have transform: scale()
      // getBoundingClientRect() returns: visibleWidth * canvasScale
      // Divide by canvasScale to get world coordinates
      const rect = container.getBoundingClientRect();
      contentWidth = (rect.width / canvasScale) || 0;
      contentHeight = (rect.height / canvasScale) || 0;
    }
    
    // Position gizmo CENTER at right-bottom corner of content
    // No offset needed - translate(-50%, -50%) centers the gizmo on the point
    handle.style.left = `${contentWidth}px`;
    handle.style.top = `${contentHeight}px`;
    
    // Compensate scale only if needed (for texts scale is on container, for images - on imageElement)
    if (shouldCompensate) {
      // For texts: container has transform: scale(), so gizmo would scale with it
      // Apply translate first (to center), then scale (to compensate container scale)
      // Order matters! translate(-50%, -50%) must be applied to the SCALED element
      const handleScale = scale > 0 ? 1 / scale : 1;
      handle.style.transform = `translate(-50%, -50%) scale(${handleScale})`;
      handle.style.transformOrigin = 'center';
    } else {
      // For images: scale on imageElement, not on container, so the gizmo does not scale
      // Just center the gizmo on the corner point
      handle.style.transform = 'translate(-50%, -50%)';
      handle.style.transformOrigin = 'center';
    }
  }

  /**
   * Update resize handle position for text objects
  // REMOVED: _updateTextResizeHandlePosition() - was updating deprecated DOM handle
  // SVG selection overlay handle is now used instead (updated via updateSelectionOverlay)

  /**
   * Centralized method for applying styles to DOM elements
   * This helps maintain Single Source of Truth by centralizing style updates
   */
  _applyElementStyles(element, styles) {
    if (!element || !styles || Object.keys(styles).length === 0) return;
    Object.assign(element.style, styles);
  }
}

// ==========================================
// 3. Interactive Objects (Entities)
// ==========================================
class WhiteboardObject {
  constructor(data) {
    this.id = data.id || `wbe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.x = data.x || 0;
    this.y = data.y || 0;
    this.selected = data.selected !== undefined ? data.selected : false;
    this.massSelected = data.massSelected !== undefined ? data.massSelected : false; // Mass selection (no gizmos)
    this.type = data.type || 'base';
    this.zIndex = data.zIndex !== undefined ? data.zIndex : 0; // SSOT: zIndex stored in model, not DOM
    this.rank = data.rank || ''; // Fractional index for z-order (set by Registry)
    // Timestamp to prevent race conditions during concurrent updates
    this._lastModified = data._lastModified || Date.now();
    this._lastModifiedSource = data._lastModifiedSource || 'local'; // For debugging
  }
  /**
   * Polymorphic methods for generic object handling
   * Each subclass overrides methods for its specific logic
   */

  /**
   * Update click-target after rendering
   * Overridden in WhiteboardImage to update click-target size click-target
   * @param {HTMLElement} container - Object container
   */
  updateClickTarget(_container) {
    // Base implementation does nothing
    // Overridden in WhiteboardImage
  }

  /**
   * Apply scale transform to the container
   * Overridden in WhiteboardImage for specific logic
   * @param {HTMLElement} container - Object container
   * @param {number} scale - Object scale
   */
  applyScaleTransform(container, scale) {
    // Base implementation - applies transform: scale()
    container.style.transform = `scale(${scale})`;
  }

  /**
   * Whether the object is editable
   * Overridden in WhiteboardText (returns true) WhiteboardText (returns true)
   * @returns {boolean}
   */
  canEdit() {
    return false; // return false; // Not editable by default
  }

  /**
   * Get element for hit-testing hit-testing
   * Overridden in WhiteboardText and WhiteboardImage
   * @param {WhiteboardLayer} layer - Layer to get elements
   * @returns {HTMLElement|null}
   */
  getElementForHitTest(_layer) {
    // Base implementation - returns container
    // Overridden in WhiteboardText and WhiteboardImage
    return null; // Will be overridden in subclasses
  }

  /**
   * Get data for copying
   * Overridden in WhiteboardText to get HTML/text HTML/text
   * @param {WhiteboardLayer} layer - Layer to get elements
   * @returns {Object|null} - Data for copying or null null
   */
  getCopyData(_layer) {
    // Base implementation - returns null
    // Overridden in WhiteboardText and WhiteboardImage
    return null;
  }

  /**
   * Get image element for copying (images only) (images only)
   * Overridden in WhiteboardImage
   * @param {WhiteboardLayer} _layer - Layer to get elements from
   * @returns {HTMLImageElement|null}
   */
  getImageElementForCopy(_layer) {
    // Base implementation returns null
    // Overridden in WhiteboardImage
    return null;
  }

  /**
   * Get key for serialization (for grouping in PersistenceController) (for grouping in PersistenceController PersistenceController)
   * @returns {string}
   */
  getSerializationKey() {
    // Base implementation returns type
    return this.type;
  }

  /**
   * Get object capabilities for generic handling
   * Override in subclasses to specify what the object supports
   * @returns {Object} { scalable, draggable, freezable }
   */
  getCapabilities() {
    return {
      scalable: false,
      draggable: true,
      freezable: false
    };
  }

  /**
   * Check if this object type is enabled (feature flag)
   * Override in subclasses that have feature flags
   * @returns {boolean}
   */
  isEnabled() {
    return true; // Enabled by default
  }

  /**
   * Get CSS selector for this object's container
   * Used for hit-testing and DOM queries
   * @returns {string}
   */
  getContainerSelector() {
    return `.wbe-${this.type}-container`;
  }

  /**
   * Whether this object uses transform: scale() for scaling
   * (vs width/height like images)
   * @returns {boolean}
   */
  usesTransformScale() {
    return true; // Default: use transform
  }

  /**
   * Check if object is frozen (cannot be selected/dragged)
   * @returns {boolean}
   */
  isFrozen() {
    return false; // Not frozen by default
  }

  /**
   * Post-creation object handling
   * Overridden in WhiteboardText to show panel and start editing
   * @param {InteractionManager} interactionManager - Interaction manager
   * @param {Object} options - Creation options (autoEdit and so on.d.)
   */
  onCreated(_interactionManager, _options) {
    // Base implementation - does nothing
    // Overridden in WhiteboardText and WhiteboardImage
  }

  /**
   * Unified method for creating resize handle resize handle
   * DRY: DRY: code reuse instead of duplication in WhiteboardText and WhiteboardImage WhiteboardImage
   */
  static createResizeHandle(className) {
    const resizeHandle = document.createElement("div");
    resizeHandle.className = className;
    resizeHandle.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 12px;
      height: 12px;
      display: none;
      background: #4a9eff;
      border: 2px solid white;
      border-radius: 50%;
      cursor: nwse-resize;
      pointer-events: auto;
      user-select: none;
      z-index: 1001;
    `;
    return resizeHandle;
  }

  /**
   * Create permanent border element (box-shadow based, draws outside content)
   * Used by both WhiteboardText and WhiteboardImage for consistent border rendering
   */
  static createPermanentBorder(borderWidth, borderColor, borderOpacity) {
    const border = document.createElement("div");
    border.className = "wbe-permanent-border";
    const borderRgba = borderWidth > 0 ? hexToRgba(borderColor, borderOpacity) : null;
    border.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999;
      box-shadow: ${borderWidth > 0 && borderRgba ? `0 0 0 ${borderWidth}px ${borderRgba}` : 'none'};
    `;
    return border;
  }

  /**
   * Create selection border element (outline based)
   * Used by both WhiteboardText and WhiteboardImage
   */
  static createSelectionBorder() {
    const border = document.createElement("div");
    border.className = "wbe-selection-border";
    border.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      outline: none;
      pointer-events: none;
      display: none;
      z-index: 1000;
    `;
    return border;
  }

  /**
   * Create click target element (transparent overlay for event handling)
   * Used by both WhiteboardText and WhiteboardImage
   */
  static createClickTarget() {
    const target = document.createElement("div");
    target.className = "wbe-click-target";
    target.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      pointer-events: none;
    `;
    return target;
  }

  /**
   * Create content wrapper element (clips content, applies overflow:hidden)
   * Used by both WhiteboardText and WhiteboardImage
   */
  static createContentWrapper() {
    const wrapper = document.createElement("div");
    wrapper.className = "wbe-content-wrapper";
    wrapper.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
    `;
    return wrapper;
  }

  /**
   * Overriding polymorphic methods for WhiteboardText WhiteboardText
   */

  canEdit() {
    return true; // return true; // Texts are editable
  }

  getElementForHitTest(layer) {
    // Use click-target for texts (same as images) - it has pointer-events: auto
    const container = layer.getObjectContainer(this.id);
    return container?.querySelector('.wbe-text-click-target') || layer.getTextElement(this.id) || container;
  }

  getCopyData(layer) {
    const textSpan = layer.getTextSpan(this.id);
    if (!textSpan) return null;
    return {
      type: 'text',
      html: textSpan.innerHTML || textSpan.textContent || '',
      text: textSpan.textContent || ''
    };
  }

  getSerializationKey() {
    return 'text';
  }

  onCreated(interactionManager, options) {
    // // Show styling panel for text (after DOM element creation)
    requestAnimationFrame(() => {
      if (interactionManager.selectedId === this.id) {
        interactionManager._showPanelForObject(this);
      }
    });

    // Start editing immediately if autoEdit = true
    if (options && options.autoEdit) {
      requestAnimationFrame(() => {
        const container = interactionManager.layer?.getObjectContainer(this.id);
        if (container) {
          interactionManager._startEditText(this.id);
        }
      });
    }
  }

  render() {
    throw new Error("Must implement render");
  }
  toJSON() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      type: this.type,
      zIndex: this.zIndex,
      rank: this.rank, // Fractional index for z-order (saved to DB)
      _lastModified: this._lastModified,
      _lastModifiedSource: this._lastModifiedSource
    };
  }
}
class WhiteboardText extends WhiteboardObject {
  constructor(data) {
    super({
      ...data,
      type: 'text'
    });
    // Override zIndex for text objects - default 2000
    if (data.zIndex === undefined) {
      this.zIndex = 2000;
    }
    this.text = data.text || "";
    this.color = data.color || DEFAULT_TEXT_COLOR;
    this.colorOpacity = data.colorOpacity !== undefined ? data.colorOpacity : 100;
    this.fontSize = data.fontSize || DEFAULT_FONT_SIZE;
    // Default to white background with 100% opacity for new text objects
    // Only use "transparent" if explicitly set
    this.backgroundColor = data.backgroundColor !== undefined ? data.backgroundColor : DEFAULT_SPAN_BACKGROUND_COLOR;
    this.backgroundColorOpacity = data.backgroundColorOpacity !== undefined ? data.backgroundColorOpacity : data.backgroundColor === "transparent" ? 0 : 100;
    this.fontFamily = data.fontFamily || DEFAULT_FONT_FAMILY;
    this.fontWeight = data.fontWeight || DEFAULT_FONT_WEIGHT;
    this.fontStyle = data.fontStyle || DEFAULT_FONT_STYLE;
    this.textAlign = data.textAlign || DEFAULT_TEXT_ALIGN;
    this.borderColor = data.borderColor || DEFAULT_BORDER_HEX;
    this.borderOpacity = data.borderOpacity !== undefined ? data.borderOpacity : DEFAULT_BORDER_OPACITY;
    this.borderWidth = data.borderWidth !== undefined ? data.borderWidth : DEFAULT_BORDER_WIDTH;
    this.textWidth = data.textWidth || null; // null = auto width, number = fixed width in px
    this.scale = data.scale !== undefined ? data.scale : 1;

    // Callback for updating registry (set by Registry when object is registered)
    this._updateCallback = null;
  }
  setUpdateCallback(callback) {
    this._updateCallback = callback;
  }
  setEditEndCallback(callback) {
    this._editEndCallback = callback;
  }
  _notifyUpdate(changes) {
    if (this._updateCallback) {
      this._updateCallback(this.id, changes);
    }
  }
  render() {
    const container = document.createElement("div");
    container.id = this.id;
    container.className = "wbe-text-container";
    container.dataset.id = this.id;
    // Unify: apply transform to container (like images) for consistent DOM structure
    const scale = this.scale !== undefined ? this.scale : 1;
    container.style.cssText = `
            position: absolute;
            left: ${this.x}px;
            top: ${this.y}px;
            transform: scale(${scale});
            transform-origin: top left;
            cursor: inherit;
            user-select: none;
        `;

    // Text element for content (no border - border is handled by permanentBorder)
    const textElement = document.createElement("div");
    textElement.className = "wbe-canvas-text";
    textElement.contentEditable = "false";
    const textColorRgba = hexToRgba(this.color, this.colorOpacity);
    // For fixed width, use explicit px value
    // For auto-width, use max-content but limit to reasonable max-width (400px default)
    const widthStyle = this.textWidth && this.textWidth > 0 
      ? `width: ${this.textWidth}px;` 
      : 'width: auto; max-width: 400px;';
    textElement.style.cssText = `
            background: transparent;
            color: ${textColorRgba || this.color};
            padding: 0;
            font-size: ${this.fontSize}px;
            font-family: ${this.fontFamily};
            font-weight: ${this.fontWeight};
            font-style: ${this.fontStyle};
            text-align: ${this.textAlign};
            user-select: none;
            min-width: 100px;
            min-height: ${this.fontSize}px;
            ${widthStyle}
            overflow-wrap: break-word;
            word-wrap: break-word;
            word-break: break-word;
            overflow: hidden;
            line-height: 1;
        `;

    // Editable span (like in old code - contentEditable for editing)
    const textSpan = document.createElement("span");
    textSpan.className = "wbe-text-background-span";
    // Support HTML markup (like in Miro): use innerHTML to preserve formatting
    // If text contains HTML tags - use innerHTML, otherwise textContent for safety
    if (this.text && /<[a-z][\s\S]*>/i.test(this.text)) {
      // HTML markup detected - use innerHTML with sanitization
      textSpan.innerHTML = sanitizeHtml(this.text);
    } else {
      // Plain text - use textContent for safety
      textSpan.textContent = this.text || '';
    }
    textSpan.contentEditable = "false";
    let spanBgColor;
    if (this.backgroundColor === "transparent") {
      spanBgColor = "transparent";
    } else {
      const bgColorHex = this.backgroundColor && this.backgroundColor !== DEFAULT_BACKGROUND_COLOR ? this.backgroundColor : DEFAULT_SPAN_BACKGROUND_COLOR;
      const bgColorRgba = hexToRgba(bgColorHex, this.backgroundColorOpacity);
      spanBgColor = bgColorRgba || bgColorHex;
    }
    textSpan.style.cssText = `
            display: inline;
            outline: none;
            background-color: ${spanBgColor};
            padding: 0;
            margin:0 !important;
            box-decoration-break: clone;
            -webkit-box-decoration-break: clone;
            line-height: inherit;
            vertical-align: top;
            resize: none;
            user-select: none;
        `;
    textElement.appendChild(textSpan);

    // Input handler to update outline and handle on text size change
    // Use Registry update to trigger Layer update (architecture intact)
    textSpan.addEventListener('input', () => {
      if (textSpan.contentEditable === "true" && this.selected) {
        // Trigger Registry update to update outline and handle via Layer
        // This maintains architecture: Entity -> Registry -> Layer -> DOM
        // Layer will update outline and handle position automatically
        if (this._updateCallback) {
          // Trigger update with empty changes to force Layer refresh
          // Layer will read current state and update outline/handle
          this._updateCallback(this.id, {});
        }
      }
    });

    // Blur handler to finish editing
    // CRITICAL: Don't finish editing if blur was caused by clicking on panel
    textSpan.addEventListener('blur', (e) => {
      if (textSpan.contentEditable === "true") {
        // Check if blur was caused by clicking on styling panel
        const relatedTarget = e.relatedTarget || document.activeElement;
        const isPanelClick = relatedTarget && (
          relatedTarget.closest('.wbe-text-styling-panel') ||
          relatedTarget.closest('.wbe-image-control-panel') ||
          relatedTarget.closest('.wbe-text-styling-subpanel') ||
          relatedTarget.closest('.wbe-image-control-subpanel')
        );
        
        // If blur was caused by panel click, restore focus and don't finish editing
        if (isPanelClick) {
          // Restore focus after a short delay to allow panel interaction
          setTimeout(() => {
            if (textSpan.contentEditable === "true") {
              textSpan.focus();
            }
          }, 0);
          return; // Don't finish editing
        }
        
        // Save HTML markup with sanitization (like in Miro)
        // If HTML exists - save innerHTML, otherwise textContent for plain text
        const content = textSpan.innerHTML.trim();
        if (content && /<[a-z][\s\S]*>/i.test(content)) {
          // HTML markup detected - save with sanitization
          this.text = sanitizeHtml(content);
        } else {
          // Plain text - save as is
          this.text = textSpan.textContent.trim();
        }
        textSpan.contentEditable = "false";

        // Restore pointer-events
        const container = document.getElementById(this.id);
        const textElement = container?.querySelector('.wbe-canvas-text');
        if (textElement) {
          textElement.style.pointerEvents = "none";
        }
        textSpan.style.pointerEvents = "";

        // Explicitly disable resize and reset all states after editing
        textSpan.style.resize = "none";
        textSpan.style.userSelect = "none";
        textSpan.style.webkitUserSelect = "none";
        textSpan.style.mozUserSelect = "none";
        textSpan.style.msUserSelect = "none";

        // Clear selection state
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
        }

        // Ensure the element lost focus
        if (document.activeElement === textSpan) {
          textSpan.blur();
        }

        // Notify InteractionManager about the end of editing
        if (this._editEndCallback) {
          this._editEndCallback(this.id);
        }

        // Notify registry of change via callback
        this._notifyUpdate({
          text: this.text
        });
      }
    });

    // DRY: Use unified static methods for common elements
    // Content wrapper clips content with overflow:hidden
    // Permanent border (box-shadow based, draws OUTSIDE content - like images)
    // For text: permanentBorder overlays textElement, box-shadow draws border OUTSIDE (no inset)
    const permanentBorder = document.createElement("div");
    permanentBorder.className = "wbe-text-permanent-border";
    const borderWidth = this.borderWidth || 0;
    const borderRgba = borderWidth > 0 ? hexToRgba(this.borderColor || DEFAULT_BORDER_HEX, this.borderOpacity !== undefined ? this.borderOpacity : DEFAULT_BORDER_OPACITY) : null;
    permanentBorder.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 999;
      box-shadow: ${borderWidth > 0 && borderRgba ? `0 0 0 ${borderWidth}px ${borderRgba}` : 'none'};
    `;

    // Selection border (outline based)
    // CRITICAL: selectionBorder must be OUTSIDE permanentBorder, so expand by borderWidth
    const selectionBorder = document.createElement("div");
    selectionBorder.className = "wbe-text-selection-border";
    selectionBorder.style.cssText = `
      position: absolute;
      left: -${borderWidth}px;
      top: -${borderWidth}px;
      right: -${borderWidth}px;
      bottom: -${borderWidth}px;
      outline: none;
      pointer-events: none;
      display: none;
      z-index: 1000;
      transform-origin: top left;
    `;

    // Click target for event interception
    const clickTarget = document.createElement("div");
    clickTarget.className = "wbe-text-click-target";
    clickTarget.style.cssText = `
      position: absolute;
      inset: 0;
      background: transparent;
      pointer-events: auto;
      cursor: inherit;
    `;

    // NOTE: Old DOM resize handle removed - SVG selection overlay handle is used instead

    // Assemble DOM structure: textElement first (defines size), then overlays
    container.appendChild(textElement);
    container.appendChild(permanentBorder);
    container.appendChild(selectionBorder);
    container.appendChild(clickTarget);

    // textElement must have pointer-events: none to avoid blocking events
    textElement.style.pointerEvents = "none";
    return container;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      text: this.text,
      color: this.color,
      fontSize: this.fontSize,
      backgroundColor: this.backgroundColor,
      fontFamily: this.fontFamily,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      textAlign: this.textAlign,
      borderColor: this.borderColor,
      borderOpacity: this.borderOpacity,
      borderWidth: this.borderWidth,
      textWidth: this.textWidth,
      scale: this.scale
    };
  }

  // ==========================================
  // Capabilities Interface
  // ==========================================

  getCapabilities() {
    return {
      scalable: true,
      draggable: true,
      freezable: false
    };
  }

  isEnabled() {
    return !window.WBE_isFeatureEnabled || window.WBE_isFeatureEnabled('texts');
  }

  getContainerSelector() {
    return '.wbe-text-container';
  }

  usesTransformScale() {
    return true;
  }

  isFrozen() {
    return false;
  }
}
class WhiteboardImage extends WhiteboardObject {
  constructor(data) {
    super({
      ...data,
      type: 'image'
    });
    this.src = data.src || "icons/svg/mystery-man.svg"; // Default Foundry icon
    // Base dimensions (natural image size without scale)
    // Used to calculate displayed sizes when scale changes
    this.baseWidth = data.baseWidth || data.width || 200;
    this.baseHeight = data.baseHeight || data.height || 200;
    // Preserve width/height for backward compatibility (used as initial values)
    this.width = data.width || 200;
    this.height = data.height || 200;
    this.rotation = data.rotation || 0;
    this.scale = data.scale !== undefined ? data.scale : 1; // DRY: common scale for all objects
    // 🔍 SCALE DEBUG: Log initial scale on creation
    if (this.scale !== undefined) {
      console.log(`[SCALE DEBUG] WhiteboardImage constructor: id=${this.id?.slice(-6)}, scale=${this.scale}, baseWidth=${this.baseWidth}, baseHeight=${this.baseHeight}`, {
        timestamp: Date.now(),
        scale: this.scale,
        baseWidth: this.baseWidth,
        baseHeight: this.baseHeight,
        source: 'constructor'
      });
    }
    // Crop properties
    this.crop = data.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    this.maskType = data.maskType || 'rect'; // 'rect' or 'circle'
    this.circleOffset = data.circleOffset || { x: 0, y: 0 };
    this.circleRadius = data.circleRadius !== undefined ? data.circleRadius : null; // null = auto (min(width, height) / 2)
    this.isCropping = false; // Cropping mode state (not saved to DB, runtime only)
    // Border properties (architecturally aligned with WhiteboardText)
    this.borderHex = data.borderHex || DEFAULT_BORDER_HEX;
    this.borderOpacity = data.borderOpacity !== undefined ? data.borderOpacity : DEFAULT_BORDER_OPACITY;
    this.borderWidth = data.borderWidth !== undefined ? data.borderWidth : DEFAULT_BORDER_WIDTH;
    this.borderRadius = data.borderRadius !== undefined ? data.borderRadius : DEFAULT_BORDER_RADIUS;
    // Shadow properties
    this.shadowHex = data.shadowHex || DEFAULT_SHADOW_HEX;
    this.shadowOpacity = data.shadowOpacity !== undefined ? data.shadowOpacity : DEFAULT_SHADOW_OPACITY;
    // Lock state
    this.frozen = data.frozen !== undefined ? data.frozen : false;
  }

  /**
   * Override polymorphic methods for WhiteboardImage WhiteboardImage
   */

  /**
   * Calculate dimensions considering crop
   * @param {HTMLElement} imageElement - Image element
   * @returns {Object} {width, height, left, top}
   */
  _calculateCroppedDimensions(imageElement) {
    const baseWidth = this.baseWidth || (imageElement?.naturalWidth || 0);
    const baseHeight = this.baseHeight || (imageElement?.naturalHeight || 0);
    const currentScale = this.scale !== undefined ? this.scale : 1;
    const maskType = this.maskType || 'rect';
    const crop = this.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const circleOffset = this.circleOffset || { x: 0, y: 0 };
    const circleRadius = this.circleRadius;

    if (baseWidth === 0 || baseHeight === 0) {
      return { width: 0, height: 0, left: 0, top: 0 };
    }

    if (maskType === 'rect') {
      // Rect mask: account for crop offsets
      const croppedWidth = baseWidth - crop.left - crop.right;
      const croppedHeight = baseHeight - crop.top - crop.bottom;
      const scaledWidth = croppedWidth * currentScale;
      const scaledHeight = croppedHeight * currentScale;
      const offsetLeft = crop.left * currentScale;
      const offsetTop = crop.top * currentScale;

      return {
        width: scaledWidth,
        height: scaledHeight,
        left: offsetLeft,
        top: offsetTop
      };
    } else if (maskType === 'circle') {
      // // Circle mask: consider circle radius and offset
      const fallback = Math.min(baseWidth, baseHeight) / 2;
      const currentRadius = (circleRadius == null) ? fallback : circleRadius;
      const diameter = currentRadius * 2;
      const scaledDiameter = diameter * currentScale;
      const centerX = baseWidth / 2 + circleOffset.x;
      const centerY = baseHeight / 2 + circleOffset.y;
      const offsetLeft = (centerX - currentRadius) * currentScale;
      const offsetTop = (centerY - currentRadius) * currentScale;

      return {
        width: scaledDiameter,
        height: scaledDiameter,
        left: offsetLeft,
        top: offsetTop
      };
    }

    // // Fallback: no crop
    return {
      width: baseWidth * currentScale,
      height: baseHeight * currentScale,
      left: 0,
      top: 0
    };
  }

  updateClickTarget(container) {
    // // Image-specific logic - update click-target size considering crop
    const imageElement = container.querySelector('.wbe-canvas-image');
    const clickTarget = container.querySelector('.wbe-image-click-target');
    
    if (!clickTarget || !imageElement) return;
    
    // // Get base dimensions
    const baseWidth = this.baseWidth || (imageElement.naturalWidth || 0);
    const baseHeight = this.baseHeight || (imageElement.naturalHeight || 0);
    
    // // Skip update if dimensions are invalid (0 or placeholder)
    if (baseWidth === 0 || baseHeight === 0) {
      return; // Skip update until image loads
    }
    
    // // Also skip if dimensions are placeholder (200px max-width/height from loading state)
    if (baseWidth === 200 && baseHeight === 200 && !imageElement.complete) {
      return; // Skip update until image loads (will be called again after load event)
    }
    
    // // Calculate dimensions considering crop
    const dims = this._calculateCroppedDimensions(imageElement);
    
    // // Set click-target size and position
    // CRITICAL: clickTarget must match container size (visible area) and be at container origin
    // Position dims.left/top is only for imageElement inside imageWrapper, not for clickTarget
    clickTarget.style.width = `${dims.width}px`;
    clickTarget.style.height = `${dims.height}px`;
    clickTarget.style.left = `0px`;  // Always at container origin
    clickTarget.style.top = `0px`;    // Always at container origin
    clickTarget.style.borderRadius = (this.maskType === 'circle') ? "50%" : "0";
    
      // // If dimensions are unknown, wait for image load
    if (dims.width === 0 && dims.height === 0 && imageElement) {
      requestAnimationFrame(() => {
        if (imageElement.complete && imageElement.naturalWidth > 0) {
          const finalDims = this._calculateCroppedDimensions(imageElement);
          if (clickTarget && finalDims.width > 0 && finalDims.height > 0) {
            clickTarget.style.width = `${finalDims.width}px`;
            clickTarget.style.height = `${finalDims.height}px`;
            clickTarget.style.left = `0px`;  // Always at container origin
            clickTarget.style.top = `0px`;    // Always at container origin
            clickTarget.style.borderRadius = (this.maskType === 'circle') ? "50%" : "0";
          }
        }
      });
    }
  }

  applyScaleTransform(container, scale) {
    // // Image-specific logic
    container.style.transform = `rotate(${this.rotation || 0}deg)`;
    container.style.transformOrigin = 'top left';
    const imageElement = container.querySelector('.wbe-canvas-image');
    if (imageElement) {
      // Round to prevent subpixel jittering
      const displayWidth = Math.round(this.baseWidth * scale);
      const displayHeight = Math.round(this.baseHeight * scale);
      imageElement.style.width = `${displayWidth}px`;
      imageElement.style.height = `${displayHeight}px`;
      imageElement.style.maxWidth = `${displayWidth}px`;
      imageElement.style.maxHeight = `${displayHeight}px`;
    }
  }

  getElementForHitTest(layer) {
    // For images, use click-target
    return layer.getImageClickTarget(this.id) || layer.getObjectContainer(this.id);
  }

  getSerializationKey() {
    return 'image';
  }

  getImageElementForCopy(layer) {
    // For images, return imageElement for copying
    return layer.getImageElement(this.id);
  }

  onCreated(interactionManager, _options) {
    // Show image control panel after creation
    requestAnimationFrame(() => {
      if (interactionManager.selectedId === this.id) {
        interactionManager._showPanelForObject(this);
      }
    });
  }

  render() {
    const container = document.createElement("div");
    container.id = this.id;
    container.className = "wbe-image-container";
    container.dataset.id = this.id;
    
    // As in old code: container only for positioning, shadow via filter
    const scale = this.scale !== undefined ? this.scale : 1;
    const shadowRgba = this.shadowHex && this.shadowOpacity !== undefined && this.shadowOpacity > 0
      ? hexToRgba(this.shadowHex, this.shadowOpacity)
      : null;
    
    // Calculate display dimensions - round to prevent subpixel jittering
    const displayWidth = Math.round(this.baseWidth * scale);
    const displayHeight = Math.round(this.baseHeight * scale);
    
    // Container styles - MUST have explicit width/height for correct stacking context
    // CRITICAL: Use this.zIndex from model, not hardcoded 1000
    // If zIndex not set yet (shouldn't happen, but fallback for safety), use 1000
    const zIndex = this.zIndex !== undefined ? this.zIndex : 1000;
    // Frozen images must have pointer-events: none to allow clicks through them
    const pointerEvents = this.frozen ? 'none' : 'auto';
    // Round position to prevent subpixel jittering
    container.style.cssText = `
            position: absolute;
            left: ${Math.round(this.x)}px;
            top: ${Math.round(this.y)}px;
            width: ${displayWidth}px;
            height: ${displayHeight}px;
            z-index: ${zIndex};
            filter: ${shadowRgba ? `drop-shadow(0 8px 8px ${shadowRgba})` : 'none'};
            pointer-events: ${pointerEvents};
            will-change: transform;
        `;

    // Image wrapper for clipping by border-radius (overflow: hidden + border-radius)
    // Needed to clip the image by border-radius so the image does not overflow the rounding
    const imageWrapper = document.createElement("div");
    imageWrapper.className = "wbe-image-wrapper";
    const borderRadius = this.borderRadius !== undefined ? this.borderRadius : DEFAULT_BORDER_RADIUS;
    // Initial wrapper size (will be updated via _updateObjectElement after image load)
    // displayWidth/displayHeight already calculated above for container
    imageWrapper.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: ${displayWidth}px;
            height: ${displayHeight}px;
            overflow: hidden;
            border-radius: ${borderRadius}px;
            pointer-events: none;
        `;
    
    // Image element (added inside wrapper for border-radius clipping)
    // ALTERNATIVE 1: Use width/height instead of transform: scale()
    // This avoids compensation for borderWidth and borderRadius
    const img = document.createElement("img");
    img.className = "wbe-canvas-image"; // DRY: needed for Layer.getImageElement()
    img.src = this.src;
    
    // Use width/height directly instead of transform: scale()
    // Dimensions will be updated after image load and on scale change
    // NOTE: NO object-fit! We control size explicitly via width/height
    img.style.cssText = `
            position: absolute;
            left: 0px;
            top: 0px;
            width: ${displayWidth}px;
            height: ${displayHeight}px;
            max-width: none;
            max-height: none;
            display: block;
            border: none !important;
            pointer-events: none;
        `;
    
    // Update base dimensions after image load
    // Borders and wrapper sizes will be updated automatically via _updateObjectElement on next Registry update
    img.addEventListener('load', () => {
      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;
      if (naturalWidth > 0 && naturalHeight > 0) {
        // Store natural dimensions in the object for further calculations
        this.baseWidth = naturalWidth;
        this.baseHeight = naturalHeight;
        // Update displayed dimensions according to current scale
        const currentScale = this.scale !== undefined ? this.scale : 1;
        // 🔍 SCALE DEBUG: Log scale on image load
        console.log(`[SCALE DEBUG] img.onload: id=${this.id?.slice(-6)}, scale=${currentScale}, naturalWidth=${naturalWidth}, naturalHeight=${naturalHeight}`, {
          timestamp: Date.now(),
          scale: currentScale,
          naturalWidth,
          naturalHeight
        });
        // Round to prevent subpixel jittering
        const scaledWidth = Math.round(naturalWidth * currentScale);
        const scaledHeight = Math.round(naturalHeight * currentScale);
        img.style.width = `${scaledWidth}px`;
        img.style.height = `${scaledHeight}px`;
        img.style.maxWidth = `${scaledWidth}px`;
        img.style.maxHeight = `${scaledHeight}px`;
        // Notify Registry about baseWidth/baseHeight update for synchronization
        if (this._updateCallback) {
          this._notifyUpdate({ baseWidth: naturalWidth, baseHeight: naturalHeight });
        }
      }
      // Wrapper dimensions will be updated automatically via _updateObjectElement on the next Registry update
    }, { once: true });
    
    imageWrapper.appendChild(img);
    container.appendChild(imageWrapper);  // ← FIRST element (wrapper with image)

    // Permanent border as SVG (prevents subpixel gaps between border and image)
    // SVG renders as single composited layer, avoiding browser rounding issues
    const borderWidth = this.borderWidth !== undefined ? this.borderWidth : DEFAULT_BORDER_WIDTH;
    const borderRgba = borderWidth > 0 
      ? hexToRgba(this.borderHex || DEFAULT_BORDER_HEX, this.borderOpacity !== undefined ? this.borderOpacity : DEFAULT_BORDER_OPACITY) 
      : null;
    
    const permanentBorder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    permanentBorder.setAttribute("class", "wbe-image-permanent-border");
    permanentBorder.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: block;
            z-index: 999;
            overflow: visible;
        `;
    permanentBorder.setAttribute("viewBox", `0 0 ${displayWidth} ${displayHeight}`);
    
    // Create rect or circle based on mask type
    const isCircle = this.maskType === 'circle';
    let borderShape;
    if (isCircle) {
      borderShape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const radius = Math.min(displayWidth, displayHeight) / 2;
      borderShape.setAttribute("cx", `${displayWidth / 2}`);
      borderShape.setAttribute("cy", `${displayHeight / 2}`);
      borderShape.setAttribute("r", `${radius - borderWidth / 2}`);
    } else {
      borderShape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      borderShape.setAttribute("x", `${borderWidth / 2}`);
      borderShape.setAttribute("y", `${borderWidth / 2}`);
      borderShape.setAttribute("width", `${displayWidth - borderWidth}`);
      borderShape.setAttribute("height", `${displayHeight - borderWidth}`);
      borderShape.setAttribute("rx", `${borderRadius}`);
      borderShape.setAttribute("ry", `${borderRadius}`);
    }
    borderShape.setAttribute("fill", "none");
    borderShape.setAttribute("stroke", borderRgba || "transparent");
    borderShape.setAttribute("stroke-width", `${borderWidth}`);
    borderShape.setAttribute("class", "wbe-permanent-border-shape");
    
    permanentBorder.appendChild(borderShape);
    // Save borderRadius in dataset for persistence
    permanentBorder.dataset.borderRadius = `${borderRadius}`;
    container.appendChild(permanentBorder);  // ← SECOND element

    // Selection border (added as THIRD element)
    // Used for crop mode purple outline and gizmo positioning
    const selectionBorder = document.createElement("div");
    selectionBorder.className = "wbe-image-selection-border";
    selectionBorder.style.cssText = `
            position: absolute;
            left: -${borderWidth}px;
            top: -${borderWidth}px;
            width: ${displayWidth + 2 * borderWidth}px;
            height: ${displayHeight + 2 * borderWidth}px;
            outline: none;
            pointer-events: none;
            display: none;
            z-index: 1000;
        `;
    container.appendChild(selectionBorder);  // ← THIRD element

    // Click target (added as the FOURTH element, as in the old code)
    const clickTarget = document.createElement("div");
    clickTarget.className = "wbe-image-click-target";
    // Frozen images must have pointer-events: none to allow clicks through them
    clickTarget.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            background: transparent;
            pointer-events: none;
        `;
    // Sizes and position will be set via updateClickTarget after the image loads
    container.appendChild(clickTarget);  // ← FOURTH element

    // Resize handle for scale (hidden by default, shown when selected)
    // DRY: reuse of gizmo creation method
    const resizeHandle = WhiteboardObject.createResizeHandle("wbe-image-resize-handle");
    container.appendChild(resizeHandle);
    return container;
  }
  toJSON() {
    return {
      ...super.toJSON(),
      src: this.src,
      width: this.width,
      height: this.height,
      rotation: this.rotation,
      scale: this.scale, // scale: this.scale, // DRY: common scale for all objects
      // Crop properties (saved in DB)
      crop: this.crop,
      maskType: this.maskType,
      circleOffset: this.circleOffset,
      circleRadius: this.circleRadius,
      // Border properties
      borderHex: this.borderHex,
      borderOpacity: this.borderOpacity,
      borderWidth: this.borderWidth,
          borderRadius: this.borderRadius,
      // Shadow properties
          shadowHex: this.shadowHex,
          shadowOpacity: this.shadowOpacity,
      // Lock state
          frozen: this.frozen,
      // Base dimensions
          baseWidth: this.baseWidth,
          baseHeight: this.baseHeight
      // NOTE: isCropping is NOT saved - this is a runtime state
    };
  }

  /**
   * Enter crop mode
   * @param {WhiteboardLayer} layer - * @param {WhiteboardLayer} layer - Layer for DOM manipulation DOM
   * @param {Registry} registry - Registry of objects
   * @param {SocketController} socketController - Socket controller (optional, for locking)
   * @returns {Promise<void>}
   */
  async enterCropMode(layer, registry, socketController = null) {
    if (!layer || !registry) {
      console.error('[WhiteboardImage] enterCropMode: layer and registry required');
      return;
    }

    const container = layer.getObjectContainer(this.id);
    if (!container) {
      console.warn(`[WhiteboardImage] enterCropMode: container not found for ${this.id}`);
      return;
    }

    // Check if the image is locked by another user
    if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
      console.warn(`[WhiteboardImage] enterCropMode: image locked by ${container.dataset.lockedBy}`);
      return;
    }

    // Set crop state via Registry
    registry.update(this.id, {
      isCropping: true
    }, 'local');

    // Send socket lock message (if socketController is available)
    if (socketController) {
      socketController.emit('imageLock', {
        imageId: this.id,
        userId: game.user.id,
        userName: game.user.name
      });
    } else {
      // Fallback: send directly via game.socket
      if (game.socket) {
        game.socket.emit(SOCKET_NAME, {
          action: 'imageLock',
          imageId: this.id,
          userId: game.user.id,
          userName: game.user.name
        });
      }
    }

    // Mark container as cropping
    container.setAttribute('data-cropping', 'true');
    container.dataset.lockedBy = game.user.id;

    // Allow UI clicks inside container during cropping
    container.style.setProperty("pointer-events", "auto", "important");

    // Hide resize handle and permanent border
    const resizeHandle = container.querySelector('.wbe-image-resize-handle');
    if (resizeHandle) {
      resizeHandle.style.display = "none";
    }
    const permanentBorder = container.querySelector('.wbe-image-permanent-border');
    if (permanentBorder) {
      permanentBorder.style.display = "none";
    }

    // Disable click target during crop mode to allow deselection
    const clickTarget = layer.getImageClickTarget(this.id);
    if (clickTarget) {
      clickTarget.style.pointerEvents = "none";
    }

    // // Change cursor to default (not move) during crop mode
    container.style.setProperty("cursor", "default", "important");

    // // Show purple border for crop mode
    const selectionBorder = container.querySelector('.wbe-image-selection-border');
    if (selectionBorder) {
      selectionBorder.style.display = "block";
      // CRITICAL: Reset offset in crop mode (permanentBorder is hidden)
      selectionBorder.style.left = "0px";
      selectionBorder.style.top = "0px";
      // For rect mask: purple outline around cropped area
      // For circle mask: purple will be shown via separate circle element, selection border stays blue
      if (this.maskType === 'circle') {
        selectionBorder.style.outline = "1px solid #1c86ff"; // Blue outline - full image bounds
        selectionBorder.style.borderRadius = "0";
      } else {
        selectionBorder.style.outline = "1px solid rgba(128, 0, 255, 0.9)"; // Purple outline for rect crop
        selectionBorder.style.borderRadius = "0";
      }
    }

    // // Create gizmos depending on mask type
    const handles = layer.createCropHandles(this.id, this.maskType || 'rect');
    if (handles) {
      // // Update gizmo positions
      layer.updateCropHandlesPosition(this.id);
    }

    // // Update clip-path
    layer.updateImageClipPath(this.id);
    
    // CRITICAL: For circle mask in crop mode - show full image with preview overlay
    // User sees: semi-transparent full image + bright circle mask area
    if (this.maskType === 'circle') {
      const imageElement = layer.getImageElement(this.id);
      if (imageElement) {
        const scale = this.scale || 1;
        const baseWidth = this.baseWidth || imageElement.naturalWidth || 200;
        const baseHeight = this.baseHeight || imageElement.naturalHeight || 200;
        // Round all dimensions to prevent subpixel jittering
        const fullWidth = Math.round(baseWidth * scale);
        const fullHeight = Math.round(baseHeight * scale);
        
        // 1. Container = full image size, positioned at obj.x/y
        container.style.width = `${fullWidth}px`;
        container.style.height = `${fullHeight}px`;
        container.style.left = `${Math.round(this.x)}px`;
        container.style.top = `${Math.round(this.y)}px`;
        
        // 2. imageElement = full size, semi-transparent, NO clip-path
        imageElement.style.left = '0px';
        imageElement.style.top = '0px';
        imageElement.style.opacity = '0.15';
        imageElement.style.clipPath = 'none';
        
        // 3. imageWrapper = full size
        const imageWrapper = container.querySelector('.wbe-image-wrapper');
        if (imageWrapper) {
          imageWrapper.style.width = `${fullWidth}px`;
          imageWrapper.style.height = `${fullHeight}px`;
        }
        
        // 4. Create cropPreview - bright circle mask area
        let cropPreview = container.querySelector('.wbe-crop-preview');
        if (!cropPreview) {
          cropPreview = document.createElement('img');
          cropPreview.className = 'wbe-crop-preview';
          cropPreview.src = imageElement.src;
          imageWrapper.appendChild(cropPreview);
        }
        
        // Calculate circle clip-path - round to prevent subpixel jittering
        const circleOffset = this.circleOffset || { x: 0, y: 0 };
        const circleRadius = this.circleRadius !== null ? this.circleRadius : Math.min(baseWidth, baseHeight) / 2;
        const centerX = baseWidth / 2 + circleOffset.x;
        const centerY = baseHeight / 2 + circleOffset.y;
        const scaledRadius = Math.round(circleRadius * scale);
        const scaledCenterX = Math.round(centerX * scale);
        const scaledCenterY = Math.round(centerY * scale);
        
        cropPreview.style.cssText = `
          position: absolute;
          left: 0px;
          top: 0px;
          width: ${fullWidth}px;
          height: ${fullHeight}px;
          opacity: 1;
          clip-path: circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px);
          pointer-events: none;
          z-index: 1;
        `;
        
        // 5. Selection border = full size (blue frame around full image)
        if (selectionBorder) {
          selectionBorder.style.width = `${fullWidth}px`;
          selectionBorder.style.height = `${fullHeight}px`;
          selectionBorder.style.left = '0px';
          selectionBorder.style.top = '0px';
        }
        
        // 6. Click target = full size
        const clickTarget = container.querySelector('.wbe-image-click-target');
        if (clickTarget) {
          clickTarget.style.width = `${fullWidth}px`;
          clickTarget.style.height = `${fullHeight}px`;
        }
        
        // 7. Purple circle overlay (border around mask)
        let circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
        if (!circleOverlay) {
          circleOverlay = document.createElement('div');
          circleOverlay.className = 'wbe-crop-circle-overlay';
          container.appendChild(circleOverlay);
        }
        
        const diameter = scaledRadius * 2;
        circleOverlay.style.cssText = `
          position: absolute;
          left: ${scaledCenterX - scaledRadius}px;
          top: ${scaledCenterY - scaledRadius}px;
          width: ${diameter}px;
          height: ${diameter}px;
          border-radius: 50%;
          border: 2px solid rgba(128, 0, 255, 0.9);
          pointer-events: none;
          z-index: 1002;
        `;
      }
    } else {
      // RECT mask in crop mode - show full image with current crop area highlighted
      const imageElement = layer.getImageElement(this.id);
      if (imageElement) {
        const scale = this.scale || 1;
        const baseWidth = this.baseWidth || imageElement.naturalWidth || 200;
        const baseHeight = this.baseHeight || imageElement.naturalHeight || 200;
        const fullWidth = Math.round(baseWidth * scale);
        const fullHeight = Math.round(baseHeight * scale);
        const crop = this.crop || { top: 0, right: 0, bottom: 0, left: 0 };
        
        // 1. Container = full image size
        container.style.width = `${fullWidth}px`;
        container.style.height = `${fullHeight}px`;
        container.style.left = `${Math.round(this.x)}px`;
        container.style.top = `${Math.round(this.y)}px`;
        
        // 2. imageElement = full size, fully opaque (no cropPreview needed for rect crop)
        imageElement.style.left = '0px';
        imageElement.style.top = '0px';
        imageElement.style.width = `${fullWidth}px`;
        imageElement.style.height = `${fullHeight}px`;
        imageElement.style.opacity = '1';
        imageElement.style.clipPath = 'none';
        
        // 3. imageWrapper = full size
        const imageWrapper = container.querySelector('.wbe-image-wrapper');
        if (imageWrapper) {
          imageWrapper.style.width = `${fullWidth}px`;
          imageWrapper.style.height = `${fullHeight}px`;
          imageWrapper.style.borderRadius = '0';
        }
        
        // 4. Remove cropPreview if exists (not needed for rect crop)
        const cropPreview = container.querySelector('.wbe-crop-preview');
        if (cropPreview) {
          cropPreview.remove();
        }
        
        // 5. Selection border = full size with purple outline
        if (selectionBorder) {
          selectionBorder.style.width = `${fullWidth}px`;
          selectionBorder.style.height = `${fullHeight}px`;
          selectionBorder.style.left = '0px';
          selectionBorder.style.top = '0px';
        }
        
        // 6. Click target = full size
        const clickTarget = container.querySelector('.wbe-image-click-target');
        if (clickTarget) {
          clickTarget.style.width = `${fullWidth}px`;
          clickTarget.style.height = `${fullHeight}px`;
        }
      }
    }

    // // Update panel position after updating border in crop mode
    if (window.wbeImageControlPanelUpdate) {
      window.wbeImageControlPanelUpdate();
    }
  }

  /**
   * * Exit crop mode
   * @param {WhiteboardLayer} layer - * @param {WhiteboardLayer} layer - Layer for DOM operations DOM
   * @param {Registry} registry - * @param {Registry} registry - Object registry
   * @param {PersistenceController} persistenceController - Persistence controller (optional)
   * @param {SocketController} socketController - Socket controller (optional, for unlocking)
   * @returns {Promise<void>}
   */
  async exitCropMode(layer, registry, socketController = null) {
    if (!layer || !registry) {
      console.error('[WhiteboardImage] exitCropMode: layer and registry required');
      return;
    }

    const container = layer.getObjectContainer(this.id);
    if (!container) {
      console.warn(`[WhiteboardImage] exitCropMode: container not found for ${this.id}`);
      return;
    }

    // Set crop state via Registry
    registry.update(this.id, {
      isCropping: false
    }, 'local');

    // Close subpanel if open
    if (window.wbeImageControlPanel?.closeSubpanel) {
      window.wbeImageControlPanel.closeSubpanel();
    }

    // Saving occurs automatically via Registry:
    // registry.update() → _handleRegistryChange() → _scheduleSave() → _saveAll()
    // All crop data is already included in toJSON() and will be saved automatically

    // Send socket message about unlocking
    if (socketController) {
      socketController.emit('imageUnlock', {
        imageId: this.id
      });
    } else {
      // Fallback: send directly via game.socket
      if (game.socket) {
        game.socket.emit(SOCKET_NAME, {
          action: 'imageUnlock',
          imageId: this.id
        });
      }
    }

    // Remove cropping flags
    container.removeAttribute('data-cropping');
    delete container.dataset.lockedBy;

    // Revert to clickTarget-only interactions outside crop mode
    container.style.setProperty("pointer-events", "none", "important");

    // Removing crop gizmos
    layer.removeCropHandles(this.id);
    
    // Remove circle overlay (for circle mask crop mode)
    const circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
    if (circleOverlay) {
      circleOverlay.remove();
    }
    
    // Remove cropPreview and restore imageElement opacity (for circle mask crop mode)
    const cropPreview = container.querySelector('.wbe-crop-preview');
    if (cropPreview) {
      cropPreview.remove();
    }
    const imageElement = layer.getImageElement(this.id);
    if (imageElement) {
      imageElement.style.opacity = '1';
      // clip-path will be restored by updateImageClipPath below
    }

    // Showing resize handle and restoring cursor (if image is selected)
    const resizeHandle = container.querySelector('.wbe-image-resize-handle');
    
    // CRITICAL: Restore permanentBorder visibility (was hidden in enterCropMode)
    const permanentBorder = container.querySelector('.wbe-image-permanent-border');
    if (permanentBorder) {
      permanentBorder.style.display = "block";
    }
    
    // Checking if image is selected (via InteractionManager)
    const isSelected = container.classList.contains('wbe-selected');
    
    // CRITICAL: Always restore border color if image is selected (regardless of frozen state)
    // The border color should reflect selection state, not frozen state
    // NOTE: _updateObjectElement will be called automatically via registry.update() callback
    // and will restore border color because we added 'isCropping' check in _updateObjectElement
    if (isSelected) {
      if (resizeHandle && !this.frozen) {
        resizeHandle.style.display = "flex";
      }
      
      // Border color will be restored by _updateObjectElement when registry.update() triggers callback
      // The check 'isCropping' in changes ensures border color is restored
    }

    // Restoring click target after crop mode
    const clickTarget = layer.getImageClickTarget(this.id);
    if (clickTarget) {
      clickTarget.style.pointerEvents = "auto";
    }

    // Updating clip-path (removing crop)
    layer.updateImageClipPath(this.id);
  }

  // ==========================================
  // Capabilities Interface
  // ==========================================

  getCapabilities() {
    return {
      scalable: true,
      draggable: true,
      freezable: true
    };
  }

  isEnabled() {
    return !window.WBE_isFeatureEnabled || window.WBE_isFeatureEnabled('images');
  }

  getContainerSelector() {
    return '.wbe-image-container';
  }

  usesTransformScale() {
    return false; // Images use width/height for scaling
  }

  isFrozen() {
    return this.frozen === true;
  }

  /**
   * Check if image is locked (e.g., in crop mode by another user)
   * @returns {boolean}
   */
  isLocked() {
    return this.type === 'image'; // Images can be locked
  }
}

/**
 * CropGizmoManager - * CropGizmoManager - Crop gizmo management
 * 
 * * Responsibility::
 * - * - Creating DOM elements for gizmos (rect and circle) (rect and circle)
 * - * - Positioning gizmos
 * - Removing gizmos
 * 
 * Does NOT handle events - InteractionManager does that - InteractionManager does that InteractionManager
 */
class CropGizmoManager {
  static CROP_HANDLE_Z_INDEX = 10102; // z-index for crop gizmos
  static HANDLE_SIZE = 12; // Handle size in pixels

  /**
   * Create 4 rect gizmos (top, right, bottom, left) (top, right, bottom, left)
   * @param {HTMLElement} container - @param {HTMLElement} container - Image container
   * @returns {Object} @returns {Object} Object with gizmos {top, right, bottom, left} {top, right, bottom, left}
   */
  static createRectHandles(container) {
    const handles = {};
    const baseStyle = `
      position: absolute;
      width: ${this.HANDLE_SIZE}px;
      height: ${this.HANDLE_SIZE}px;
      background: rgba(128, 0, 255, 0.9);
      border: 2px solid white;
      border-radius: 50%;
      cursor: pointer;
      z-index: ${this.CROP_HANDLE_Z_INDEX};
      pointer-events: auto;
    `;

    const gizmoId = `gizmo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Top handle
    handles.top = document.createElement("div");
    handles.top.className = "wbe-crop-handle-top";
    handles.top.style.cssText = baseStyle + `cursor: ns-resize;`;
    handles.top.dataset.gizmoId = `${gizmoId}-top`;
    handles.top.dataset.handleType = 'crop-rect-top';
    container.appendChild(handles.top);

    // Right handle
    handles.right = document.createElement("div");
    handles.right.className = "wbe-crop-handle-right";
    handles.right.style.cssText = baseStyle + `cursor: ew-resize;`;
    handles.right.dataset.gizmoId = `${gizmoId}-right`;
    handles.right.dataset.handleType = 'crop-rect-right';
    container.appendChild(handles.right);

    // Bottom handle
    handles.bottom = document.createElement("div");
    handles.bottom.className = "wbe-crop-handle-bottom";
    handles.bottom.style.cssText = baseStyle + `cursor: ns-resize;`;
    handles.bottom.dataset.gizmoId = `${gizmoId}-bottom`;
    handles.bottom.dataset.handleType = 'crop-rect-bottom';
    container.appendChild(handles.bottom);

    // Left handle
    handles.left = document.createElement("div");
    handles.left.className = "wbe-crop-handle-left";
    handles.left.style.cssText = baseStyle + `cursor: ew-resize;`;
    handles.left.dataset.gizmoId = `${gizmoId}-left`;
    handles.left.dataset.handleType = 'crop-rect-left';
    container.appendChild(handles.left);

    return handles;
  }

  /**
   * Create circle gizmo for radius adjustment
   * @param {HTMLElement} container - @param {HTMLElement} container - Image container
   * @returns {HTMLElement} @returns {HTMLElement} Circle radius adjustment gizmo
   */
  static createCircleHandle(container) {
    const baseStyle = `
      position: absolute;
      width: ${this.HANDLE_SIZE}px;
      height: ${this.HANDLE_SIZE}px;
      background: rgba(128, 0, 255, 0.9);
      border: 2px solid white;
      border-radius: 50%;
      cursor: pointer;
      z-index: ${this.CROP_HANDLE_Z_INDEX};
      pointer-events: auto;
    `;

    const gizmoId = `gizmo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const handle = document.createElement("div");
    handle.className = "wbe-crop-handle-circle-resize";
    handle.style.cssText = baseStyle + `cursor: nw-resize;`;
    handle.dataset.gizmoId = `${gizmoId}-circle`;
    handle.dataset.handleType = 'crop-circle-resize';
    container.appendChild(handle);

    return handle;
  }

  /**
   * Update rect positions of handles
   * @param {Object} handles - Object with handles {top, right, bottom, left}
   * @param {Object} dims - Visible dimensions {width, height, left, top} from _calculateImageVisibleDimensions
   */
  static updateRectHandlesPosition(handles, dims) {
    if (!handles || !dims) return;
    if (dims.width === 0 || dims.height === 0) return;

    // CRITICAL: Handles are added to container, which has dimensions dims.width × dims.height
    // Position handles on the boundaries of the visible area (already scaled)
    const halfHandleSize = this.HANDLE_SIZE / 2;

    // Top handle: center of top edge
    if (handles.top) {
      handles.top.style.left = `${dims.width / 2 - halfHandleSize}px`;
      handles.top.style.top = `${-halfHandleSize}px`; // Half outside for better visibility
    }

    // Right handle: center of right edge
    if (handles.right) {
      handles.right.style.left = `${dims.width - halfHandleSize}px`; // Half outside for better visibility
      handles.right.style.top = `${dims.height / 2 - halfHandleSize}px`;
    }

    // Bottom handle: center of bottom edge
    if (handles.bottom) {
      handles.bottom.style.left = `${dims.width / 2 - halfHandleSize}px`;
      handles.bottom.style.top = `${dims.height - halfHandleSize}px`; // Half outside for better visibility
    }

    // Left handle: center of left edge
    if (handles.left) {
      handles.left.style.left = `${-halfHandleSize}px`; // Half outside for better visibility
      handles.left.style.top = `${dims.height / 2 - halfHandleSize}px`;
    }
  }

  /**
   * Update circle handle position
   * @param {HTMLElement} handle - Handle for radius adjustment
   * @param {HTMLElement} imageElement - Image element (unused, kept for API compatibility)
   * @param {Object} circleOffset - Object {x, y} in base coordinates (unused, kept for API compatibility)
   * @param {number} circleRadius - Circle radius in base coordinates (unused, kept for API compatibility)
   * @param {Object} dims - Visible dimensions {width, height, left, top} from _calculateImageVisibleDimensions
   */
  static updateCircleHandlePosition(handle, imageElement, circleOffset, circleRadius, dims) {
    if (!handle || !dims) return;
    if (dims.width === 0 || dims.height === 0) return;

    // CRITICAL: For circle mask, dims already represents the visible circle bounds
    // dims.width = dims.height = circle diameter (already scaled)
    // Circle center is at the center of visible area
    const visibleCenterX = dims.width / 2;
    const visibleCenterY = dims.height / 2;
    const visibleRadius = dims.width / 2; // Circle: width = height = diameter
    
    // Position gizmo at edge of circle (45 degrees, right-bottom) relative to visible area center
    // Handles are positioned relative to container, which has dimensions dims.width × dims.height
    const handleX = visibleCenterX + visibleRadius * 0.707; // cos(45°) ≈ 0.707
    const handleY = visibleCenterY + visibleRadius * 0.707; // sin(45°) ≈ 0.707

    const halfHandleSize = this.HANDLE_SIZE / 2;
    handle.style.left = `${handleX - halfHandleSize}px`;
    handle.style.top = `${handleY - halfHandleSize}px`;
  }

  /**
   * Remove all rect handles
   * @param {Object} handles - Object with handles {top, right, bottom, left}
   */
  static removeRectHandles(handles) {
    if (!handles) return;
    ["top", "right", "bottom", "left"].forEach(key => {
      if (handles[key] && handles[key].parentNode) {
        handles[key].parentNode.removeChild(handles[key]);
      }
      handles[key] = null;
    });
  }

  /**
   * Remove circle handle
   * @param {HTMLElement} handle - Handle to remove
   */
  static removeCircleHandle(handle) {
    if (handle && handle.parentNode) {
      handle.parentNode.removeChild(handle);
    }
  }

  /**
   * Remove all handles (rect and circle) (rect and circle)
   * @param {Object} handles - Object with handles {top, right, bottom, left, circleResize}
   */
  static removeAllHandles(handles) {
    if (!handles) return;
    this.removeRectHandles(handles);
    if (handles.circleResize) {
      this.removeCircleHandle(handles.circleResize);
      handles.circleResize = null;
    }
      }
}

// ==========================================
// 4. Text Styling Panel
// ==========================================
// TextStylingPanelView - Handles DOM creation and manipulation
// ==========================================
class TextStylingPanelView {
  constructor() {
    this.panel = null;
    this.toolbar = null;
    this.activeSubpanel = null;
    this.activeButton = null;
    this.onOutside = null;
    this.onKey = null;
  }

  // UI Helper Methods
  makeSwatch(hex, size = 30) {
    const swatch = document.createElement("div");
    swatch.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                border-radius: 8px;
                border: 1px solid #d0d0d0;
                box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
                cursor: pointer;
                background: ${hex};
                position: relative;
                overflow: hidden;
            `;
    return swatch;
  }
  createSlider(value, {
    min,
    max,
    step = 1,
    format = v => `${Math.round(v)}%`
  }) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
            `;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = `
                flex: 1;
                height: 6px;
            `;
    const label = document.createElement("span");
    label.textContent = format(Number(value));
    label.style.cssText = `
                font-size: 12px;
                color: #555;
                width: 48px;
                text-align: right;
            `;
    wrapper.appendChild(slider);
    wrapper.appendChild(label);
    return {
      wrapper,
      slider,
      label,
      update: v => {
        label.textContent = format(Number(v));
      }
    };
  }
  createDropdownInput(value, {
    min,
    max,
    step = 1,
    format = v => `${Math.round(v)}%`,
    presetValues = null, // Array of preset values, e.g. [0, 25, 50, 75, 100]
    onChange = null // Optional callback when value changes
  }) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
            `;
    
    // Generate preset values if not provided
    let presets = presetValues;
    if (!presets) {
      // Default: 4 steps for opacity (0%, 25%, 50%, 75%, 100%)
      if (min === 0 && max === 100 && step === 1) {
        presets = [0, 25, 50, 75, 100];
      } else {
        // Generate presets based on min/max/step
        presets = [];
        const stepCount = Math.min(5, Math.floor((max - min) / step) + 1);
        for (let i = 0; i < stepCount; i++) {
          const val = min + (max - min) * (i / (stepCount - 1));
          presets.push(Math.round(val / step) * step);
        }
      }
    }
    
    // Dropdown
    const dropdown = document.createElement("select");
    dropdown.style.cssText = `
                padding: 4px 8px;
                border: 1px solid #d0d0d0;
                border-radius: 6px;
                background: white;
                font-size: 12px;
                color: #333;
                cursor: pointer;
                min-width: 60px;
            `;
    presets.forEach(preset => {
      const option = document.createElement("option");
      option.value = String(preset);
      option.textContent = format(preset);
      if (Math.abs(Number(value) - preset) < step / 2) {
        option.selected = true;
      }
      dropdown.appendChild(option);
    });
    
    // Input for exact value
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = `
                width: 50px;
                padding: 4px 6px;
                border: 1px solid #d0d0d0;
                border-radius: 6px;
                background: white;
                font-size: 12px;
                color: #333;
                text-align: center;
            `;
    
    wrapper.appendChild(dropdown);
    wrapper.appendChild(input);
    
    // Sync functions
    const updateValue = (v) => {
      const numVal = Number(v);
      input.value = String(numVal);
      // Update dropdown to closest preset
      let closestPreset = presets[0];
      let minDiff = Math.abs(numVal - closestPreset);
      presets.forEach(preset => {
        const diff = Math.abs(numVal - preset);
        if (diff < minDiff) {
          minDiff = diff;
          closestPreset = preset;
        }
      });
      dropdown.value = String(closestPreset);
    };
    
    // Initialize value
    updateValue(value);
    
    // Event handlers
    const triggerChange = (val) => {
      // Call onChange callback if provided
      if (onChange && typeof onChange === 'function') {
        onChange(val);
      }
    };
    
    dropdown.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      updateValue(val);
      triggerChange(val);
    });
    
    input.addEventListener("change", (e) => {
      let val = Number(e.target.value);
      val = Math.max(min, Math.min(max, val)); // Clamp
      val = Math.round(val / step) * step; // Snap to step
      updateValue(val);
      triggerChange(val);
    });
    
    input.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      if (!isNaN(val) && val >= min && val <= max) {
        updateValue(val);
      }
    });
    
    return {
      wrapper,
      dropdown,
      input,
      update: updateValue,
      getValue: () => Number(input.value)
    };
  }
  makeMiniButton(text, iconClass = null) {
    const button = document.createElement("button");
    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.cssText = "font-size: 12px;";
      button.appendChild(icon);
    } else {
      button.textContent = text;
    }
    button.style.cssText = `
                width: 24px;
                height: 24px;
                border: 1px solid #666;
                background: #f0f0f0;
                color: #333;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                border-radius: 3px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            `;
    return button;
  }
  setMiniActive(button, isActive) {
    if (isActive) {
      button.style.background = "#4a9eff";
      button.style.color = "white";
      button.style.borderColor = "#4a9eff";
    } else {
      button.style.background = "#f0f0f0";
      button.style.color = "#333";
      button.style.borderColor = "#666";
    }
  }
  setButtonActive(button, isActive) {
    if (!button) return;
    if (isActive) {
      button.dataset.active = "1";
      button.style.background = "#e0ebff";
      button.style.borderColor = "#4d8dff";
      button.style.color = "#1a3f8b";
    } else {
      button.dataset.active = "0";
      button.style.background = "#f5f5f7";
      button.style.borderColor = "#d2d2d8";
      button.style.color = "#333";
    }
  }
  makeToolbarButton(label, iconClass, onButtonClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wbe-color-toolbar-btn";
    btn.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 40px;
            padding: 0;
            border-radius: 10px;
            border: 1px solid #d2d2d8;
            background: #f5f5f7;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
        `;
    btn.dataset.active = "0";
    btn.title = label;
    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      // Universal solution: explicitly set icon color to inherit from button
      icon.style.cssText = "font-size: 18px; color: inherit;";
      btn.appendChild(icon);
    }
    // Universal solution: automatically set initial inactive state
    // This ensures the correct icon color from the start
    this.setButtonActive(btn, false);
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active === "1") return;
      btn.style.background = "#ededf8";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active === "1") return;
      this.setButtonActive(btn, false);
    });
    if (onButtonClick) {
      btn.addEventListener("click", onButtonClick);
    }
    return btn;
  }
  render(data, onSubpanelOpen) {
    // Create panel DOM structure
    const panel = document.createElement("div");
    panel.className = "wbe-color-picker-panel";
    panel.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #d7d7d7;
            border-radius: 14px;
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
            padding: 6px;
            z-index: ${ZINDEX_TEXT_COLOR_PICKER};
            pointer-events: auto;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            aspect-ratio: 4 / 1;
            transform: translateX(-50%) scale(0.9) translateY(12px);
            opacity: 0;
            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;

    // IMPORTANT: Add stopPropagation to prevent Foundry from handling panel clicks
    // CRITICAL: Also prevent blur on textSpan when clicking panel buttons (but NOT sliders!)
    panel.addEventListener("mousedown", ev => {
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      
      // Only preventDefault for buttons, not for sliders/inputs
      // Sliders need mousedown to work properly
      const target = ev.target;
      const isSlider = target.tagName === 'INPUT' && target.type === 'range';
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      
      if (!isSlider && !isInput) {
        // Prevent blur on textSpan - keep editing mode active
        // This allows formatting selected text without losing focus
        ev.preventDefault();
      }
    }, true); // Use capture phase to intercept before blur
    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
            display: flex;
            gap: 12px;
            position: relative;
        `;

    // Create toolbar buttons
    if (onSubpanelOpen) {
      const textBtn = this.makeToolbarButton("Text", "fas fa-font", () => onSubpanelOpen("text", textBtn));
      const bgBtn = this.makeToolbarButton("Background", "fas fa-fill", () => onSubpanelOpen("background", bgBtn));
      const borderBtn = this.makeToolbarButton("Border", "fas fa-border-all", () => onSubpanelOpen("border", borderBtn));
      // Universal solution: setButtonActive is now called automatically in makeToolbarButton
      // These calls can be kept for clarity or removed - the result is the same
      toolbar.appendChild(textBtn);
      toolbar.appendChild(bgBtn);
      toolbar.appendChild(borderBtn);
    }
    panel.appendChild(toolbar);
    this.panel = panel;
    this.toolbar = toolbar;
    return panel;
  }
  getUIHelpers() {
    return {
      makeSwatch: (hex, size) => this.makeSwatch(hex, size),
      createSlider: (value, options) => this.createSlider(value, options),
      createDropdownInput: (value, options) => this.createDropdownInput(value, options),
      makeMiniButton: (text, iconClass) => this.makeMiniButton(text, iconClass),
      setMiniActive: (button, isActive) => this.setMiniActive(button, isActive)
    };
  }
  bindEvents(controller, onOutsideCallback, onKeyCallback) {
    // Store callbacks for cleanup
    this.onOutside = onOutsideCallback;
    this.onKey = onKeyCallback;

    // Register global event listeners
    setTimeout(() => {
      document.addEventListener("mousedown", this.onOutside, true);
    }, 0);
    document.addEventListener("keydown", this.onKey);
  }
  positionSubpanel(_isPanelAbove = true) {
    // Subpanel ALWAYS goes BELOW the main panel, centered
    if (!this.activeSubpanel || !this.panel) return;
    
    // Center subpanel horizontally relative to panel center
    const panelWidth = this.panel.offsetWidth || 200;
    const subpanelWidth = this.activeSubpanel.offsetWidth || 200;
    const left = (panelWidth - subpanelWidth) / 2;
    this.activeSubpanel.style.left = `${left}px`;
    
    // Always position below panel
    const panelHeight = this.panel.offsetHeight || 50;
    this.activeSubpanel.style.top = `${panelHeight + 8}px`;
  }
  closeSubpanel(setButtonActiveFn) {
    // Close active subpanel and reset button state
    if (this.activeSubpanel) {
      this.activeSubpanel.remove();
      this.activeSubpanel = null;
    }
    if (this.activeButton && setButtonActiveFn) {
      setButtonActiveFn(this.activeButton, false);
      this.activeButton = null;
    }
  }
  isClickInside(ev) {
    if (!this.panel) return false;
    const path = ev.composedPath();
    return path.includes(this.panel) || this.activeSubpanel && path.includes(this.activeSubpanel);
  }
  destroy() {
    // Remove global event listeners
    if (this.onOutside) {
      try {
        document.removeEventListener("mousedown", this.onOutside, true);
      } catch {}
    }
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey);
    }

    // Remove DOM elements
    if (this.activeSubpanel) {
      this.activeSubpanel.remove();
      this.activeSubpanel = null;
    }
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.toolbar = null;
    this.activeButton = null;
    this.onOutside = null;
    this.onKey = null;
  }
}

// ==========================================
// TextStylingController - Handles registry updates
// ==========================================
class TextStylingController {
  constructor(registry, textId, layer) {
    this.registry = registry;
    this.textId = textId;
    this.layer = layer;
  }
  handleColorChange(hex, opacity) {
    // Store hex + opacity separately (not rgba string)
    this.registry.update(this.textId, {
      color: hex,
      colorOpacity: opacity
    }, 'local');
  }
  handleBackgroundColorChange(hex, opacity) {
    this.registry.update(this.textId, {
      backgroundColor: hex,
      backgroundColorOpacity: opacity
    }, 'local');
  }
  handleFontChange(fontFamily, fontSize, fontWeight, fontStyle) {
    this.registry.update(this.textId, {
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle
    }, 'local');
  }
  handleAlignmentChange(textAlign) {
    this.registry.update(this.textId, {
      textAlign
    }, 'local');
  }
  handleBorderChange(borderColor, borderOpacity, borderWidth) {
    this.registry.update(this.textId, {
      borderColor,
      borderOpacity,
      borderWidth
    }, 'local');
  }
}

// ==========================================
// PanelPositionManager - Handles panel positioning
// ==========================================
class PanelPositionManager {
  constructor(panelElement, containerElement, viewInstance) {
    this.panel = panelElement;
    this.container = containerElement;
    this.view = viewInstance;
    this.canvasObserver = null;
    this.lastContainerRect = null;
  }
  init() {
    // Initial position - wait for panel to be rendered
    requestAnimationFrame(() => {
      this.update();
      requestAnimationFrame(() => {
        // Apply transform after initial render
        this.panel.style.transform = "translateX(-50%) scale(.9) translateY(32px)";
        this.panel.style.opacity = "1";
        // Update position again after transform is applied
        this.update();
      });
    });

    // Listen to canvas pan/zoom events
    this.canvasObserver = () => {
      if (this.panel && this.container) {
        this.checkAndUpdatePosition();
      }
    };
    Hooks.on("canvasPan", this.canvasObserver);
    Hooks.on("canvasZoom", this.canvasObserver);
  }
  update() {
    if (!this.container || !this.panel) return;

    // Unification: use the content element for positioning (text or image)
    // For TEXT: use textElement (accounts for scale transform)
    // For IMAGE: use container (imageElement may be larger than visible area after crop)
    const textElement = this.container.querySelector('.wbe-canvas-text');
    const imageElement = this.container.querySelector('.wbe-canvas-image');
    // For images, always use container (visible area after crop)
    // For text, use textElement if available
    const targetElement = imageElement ? this.container : (textElement || this.container);
    const rect = targetElement.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const panelWidth = panelRect.width || 300;
    const minMargin = 10;
    const topThreshold = 150;

    // Center panel horizontally relative to object (unified for all types)
    let panelCenterX = rect.left + rect.width / 2;
    const halfPanelWidth = panelWidth / 2;

    // Check boundaries
    if (panelCenterX - halfPanelWidth < minMargin) {
      panelCenterX = minMargin + halfPanelWidth;
    }
    if (panelCenterX + halfPanelWidth > window.innerWidth - minMargin) {
      panelCenterX = window.innerWidth - minMargin - halfPanelWidth;
    }
    this.panel.style.left = `${panelCenterX}px`;

    // Vertical positioning (unified for all types)
    // When panel is above object, leave extra space for subpanel below it
    const isPanelAbove = rect.top >= topThreshold;
    const subpanelSpace = 45; // Space for subpanel below main panel
    if (isPanelAbove) {
      this.panel.style.top = `${rect.top - 110 - subpanelSpace}px`;
    } else {
      this.panel.style.top = `${rect.bottom + minMargin}px`;
    }
    
    // Store panel position info for subpanel positioning
    this.isPanelAbove = isPanelAbove;

    // Update subpanel position if view exists
    if (this.view && typeof this.view.positionSubpanel === 'function') {
      this.view.positionSubpanel(this.isPanelAbove);
    }
  }
  checkAndUpdatePosition() {
    if (!this.panel || !this.container) return;
    // Unification: use the content element for positioning (text or image)
    // For images, always use container (visible area after crop)
    const textElement = this.container.querySelector('.wbe-canvas-text');
    const imageElement = this.container.querySelector('.wbe-canvas-image');
    const targetElement = imageElement ? this.container : (textElement || this.container);
    const rect = targetElement.getBoundingClientRect();
    const rectKey = `${rect.left},${rect.top},${rect.width},${rect.height}`;

    // Only update if position actually changed
    if (rectKey !== this.lastContainerRect) {
      this.lastContainerRect = rectKey;
      this.update();
    }
  }
  destroy() {
    if (this.canvasObserver) {
      Hooks.off("canvasPan", this.canvasObserver);
      Hooks.off("canvasZoom", this.canvasObserver);
      this.canvasObserver = null;
    }
    this.view = null;
  }
}

// ==========================================
// Subpanel Classes
// ==========================================
class TextSubpanel {
  constructor(controller, stylingData, uiHelpers) {
    this.controller = controller;
    this.stylingData = stylingData; // { textColor: {hex, opacity}, fontFamily, fontSize, fontWeight, fontStyle, textAlign }
    this.uiHelpers = uiHelpers; // { makeSwatch, createSlider, makeMiniButton, setMiniActive }
    this.element = null;
  }
  async render() {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
                position: absolute;
                background: white;
                border: 1px solid #dcdcdc;
                border-radius: 12px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
                padding: 10px 14px;
                display: flex;
                align-items: center;
                gap: 12px;
                pointer-events: auto;
            `;
    
    // Color controls (swatch + opacity slider)
    const colorGroup = document.createElement("div");
    colorGroup.style.cssText = "display: flex; align-items: center; gap: 6px;";
    sub.appendChild(colorGroup);
    const swatch = this.uiHelpers.makeSwatch(this.stylingData.textColor.hex);
    colorGroup.appendChild(swatch);
    const textColorInput = document.createElement("input");
    textColorInput.type = "color";
    textColorInput.value = this.stylingData.textColor.hex;
    textColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(textColorInput);
    const {
      wrapper: opacityRow,
      input: opacityInput,
      update: updateOpacityLabel
    } = this.uiHelpers.createDropdownInput(this.stylingData.textColor.opacity, {
      min: 0,
      max: 100,
      step: 1,
      format: v => `${Math.round(v)}%`,
      presetValues: [0, 25, 50, 75, 100],
      onChange: (opacity) => {
        this.controller.handleColorChange(textColorInput.value, opacity);
      }
    });
    colorGroup.appendChild(opacityRow);
    
    // Font controls (buttons)
    const fontControls = document.createElement("div");
    fontControls.style.cssText = "display: flex; gap: 4px;";
    sub.appendChild(fontControls);
    const boldBtn = this.uiHelpers.makeMiniButton("B");
    const italicBtn = this.uiHelpers.makeMiniButton("I");
    const regularBtn = this.uiHelpers.makeMiniButton("Aa");
    const textAlignLeftBtn = this.uiHelpers.makeMiniButton("", "fas fa-align-left");
    const textAlignCenterBtn = this.uiHelpers.makeMiniButton("", "fas fa-align-center");
    const textAlignRightBtn = this.uiHelpers.makeMiniButton("", "fas fa-align-right");
    let isBold = normalizeFontWeight(this.stylingData.fontWeight) >= 600;
    let isItalic = normalizeFontStyle(this.stylingData.fontStyle) === "italic";
    let currentTextAlign = this.stylingData.textAlign || DEFAULT_TEXT_ALIGN;
    let currentFontFamily = this.stylingData.fontFamily || DEFAULT_FONT_FAMILY;
    let currentFontSize = this.stylingData.fontSize || DEFAULT_FONT_SIZE;
    const syncFontButtons = () => {
      this.uiHelpers.setMiniActive(boldBtn, isBold);
      this.uiHelpers.setMiniActive(italicBtn, isItalic);
      this.uiHelpers.setMiniActive(regularBtn, !isBold && !isItalic);
    };
    const syncAlignmentButtons = () => {
      this.uiHelpers.setMiniActive(textAlignLeftBtn, currentTextAlign === "left");
      this.uiHelpers.setMiniActive(textAlignCenterBtn, currentTextAlign === "center");
      this.uiHelpers.setMiniActive(textAlignRightBtn, currentTextAlign === "right");
    };
    const applyFontSelection = () => {
      const weight = isBold ? 700 : DEFAULT_FONT_WEIGHT;
      const style = isItalic ? "italic" : DEFAULT_FONT_STYLE;
      this.controller.handleFontChange(currentFontFamily, currentFontSize, weight, style);
      syncFontButtons();
    };
    const applyAlignmentSelection = alignment => {
      currentTextAlign = alignment;
      this.controller.handleAlignmentChange(alignment);
      syncAlignmentButtons();
    };
    const applyFontFamilySelection = fontFamily => {
      currentFontFamily = fontFamily;
      this.controller.handleFontChange(fontFamily, currentFontSize, isBold ? 700 : DEFAULT_FONT_WEIGHT, isItalic ? "italic" : DEFAULT_FONT_STYLE);
    };
    const applyFontSizeSelection = fontSize => {
      currentFontSize = fontSize;
      this.controller.handleFontChange(currentFontFamily, fontSize, isBold ? 700 : DEFAULT_FONT_WEIGHT, isItalic ? "italic" : DEFAULT_FONT_STYLE);
    };
    // Helper: check if there's an active selection inside the text span
    const hasInlineSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
      
      // Check if selection is inside our text span
      const textSpan = this.controller.layer?.getTextSpan(this.controller.textId);
      if (!textSpan) return false;
      
      const range = selection.getRangeAt(0);
      return textSpan.contains(range.commonAncestorContainer);
    };
    
    // Helper: apply inline formatting via execCommand
    const applyInlineFormat = (command) => {
      document.execCommand(command, false, null);
      // Trigger save of HTML content
      const textSpan = this.controller.layer?.getTextSpan(this.controller.textId);
      if (textSpan) {
        const content = textSpan.innerHTML.trim();
        this.controller.registry.update(this.controller.textId, { text: sanitizeHtml(content) }, 'local');
      }
    };
    
    boldBtn.addEventListener("click", () => {
      if (hasInlineSelection()) {
        // Inline formatting for selection
        applyInlineFormat('bold');
      } else {
        // Whole block formatting
      isBold = !isBold;
      applyFontSelection();
      }
    });
    italicBtn.addEventListener("click", () => {
      if (hasInlineSelection()) {
        // Inline formatting for selection
        applyInlineFormat('italic');
      } else {
        // Whole block formatting
      isItalic = !isItalic;
      applyFontSelection();
      }
    });
    regularBtn.addEventListener("click", () => {
      if (hasInlineSelection()) {
        // Remove inline formatting from selection
        applyInlineFormat('removeFormat');
      } else {
        // Whole block formatting
      isBold = false;
      isItalic = false;
      applyFontSelection();
      }
    });
    textAlignLeftBtn.addEventListener("click", () => applyAlignmentSelection("left"));
    textAlignCenterBtn.addEventListener("click", () => applyAlignmentSelection("center"));
    textAlignRightBtn.addEventListener("click", () => applyAlignmentSelection("right"));
    fontControls.appendChild(regularBtn);
    fontControls.appendChild(boldBtn);
    fontControls.appendChild(italicBtn);
    fontControls.appendChild(textAlignLeftBtn);
    fontControls.appendChild(textAlignCenterBtn);
    fontControls.appendChild(textAlignRightBtn);
    syncFontButtons();
    syncAlignmentButtons();
    
    // Font family selector
    const fontFamilyGroup = document.createElement("div");
    fontFamilyGroup.style.cssText = "display: flex; align-items: center; gap: 4px;";
    sub.appendChild(fontFamilyGroup);
    const fontLabel = document.createElement("span");
    fontLabel.textContent = "Font:";
    fontLabel.style.cssText = "font-size: 12px; color: #555; white-space: nowrap;";
    fontFamilyGroup.appendChild(fontLabel);
    const fontSelect = document.createElement("select");
    fontSelect.style.cssText = `
                min-width: 120px;
                padding: 6px 8px;
                border: 1px solid #d0d0d0;
                border-radius: 6px;
                background: white;
                font-size: 12px;
                color: #333;
                cursor: pointer;
            `;
    fontFamilyGroup.appendChild(fontSelect);
    const populateFontDropdown = async () => {
      const availableFonts = await getAvailableFonts();
      fontSelect.innerHTML = '';
      for (const font of availableFonts) {
        const option = document.createElement("option");
        option.value = font;
        option.textContent = font;
        option.style.fontFamily = font;
        if (font === currentFontFamily) {
          option.selected = true;
        }
        fontSelect.appendChild(option);
      }
    };
    fontSelect.value = currentFontFamily;
    await populateFontDropdown();
    fontSelect.addEventListener("change", e => {
      applyFontFamilySelection(e.target.value);
    });
    
    // Font size slider
    const fontSizeGroup = document.createElement("div");
    fontSizeGroup.style.cssText = "display: flex; align-items: center; gap: 4px;";
    sub.appendChild(fontSizeGroup);
    const fontSizeLabel = document.createElement("span");
    fontSizeLabel.textContent = "Size:";
    fontSizeLabel.style.cssText = "font-size: 12px; color: #555; white-space: nowrap;";
    fontSizeGroup.appendChild(fontSizeLabel);
    const {
      wrapper: fontSizeRow,
      input: fontSizeInput,
      update: updateFontSizeLabel
    } = this.uiHelpers.createDropdownInput(currentFontSize, {
      min: 8,
      max: 72,
      step: 1,
      format: v => `${Math.round(v)}px`,
      presetValues: [8, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72],
      onChange: (fontSize) => {
        applyFontSizeSelection(fontSize);
      }
    });
    fontSizeGroup.appendChild(fontSizeRow);
    fontSizeInput.addEventListener("change", () => {
      updateFontSizeLabel(Number(fontSizeInput.value));
    });
    fontSizeInput.addEventListener("input", () => {
      updateFontSizeLabel(Number(fontSizeInput.value));
    });
    swatch.addEventListener("click", () => textColorInput.click());
    textColorInput.addEventListener("change", e => {
      swatch.style.background = e.target.value;
      this.controller.handleColorChange(e.target.value, Number(opacityInput.value));
    });
    opacityInput.addEventListener("change", () => {
      updateOpacityLabel(Number(opacityInput.value));
    });
    opacityInput.addEventListener("input", () => {
      updateOpacityLabel(Number(opacityInput.value));
    });
    this.element = sub;
    return sub;
  }
}
class BackgroundSubpanel {
  constructor(controller, stylingData, uiHelpers) {
    this.controller = controller;
    this.stylingData = stylingData; // { backgroundColor: {hex, opacity} }
    this.uiHelpers = uiHelpers;
    this.element = null;
  }
  render() {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
                position: absolute;
                background: white;
                border: 1px solid #dcdcdc;
                border-radius: 12px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
                padding: 10px 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                pointer-events: auto;
            `;
    
    const swatch = this.uiHelpers.makeSwatch(this.stylingData.backgroundColor.hex, 26);
    sub.appendChild(swatch);
    const bgColorInput = document.createElement("input");
    bgColorInput.type = "color";
    bgColorInput.value = this.stylingData.backgroundColor.hex;
    bgColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(bgColorInput);
    const {
      wrapper: opacityRow,
      input: opacityInput,
      update: updateOpacityLabel
    } = this.uiHelpers.createDropdownInput(this.stylingData.backgroundColor.opacity, {
      min: 0,
      max: 100,
      step: 1,
      format: v => `${Math.round(v)}%`,
      presetValues: [0, 25, 50, 75, 100],
      onChange: (opacity) => {
        this.controller.handleBackgroundColorChange(bgColorInput.value, opacity);
      }
    });
    sub.appendChild(opacityRow);
    swatch.addEventListener("click", () => bgColorInput.click());
    bgColorInput.addEventListener("change", e => {
      swatch.style.background = e.target.value;
      this.controller.handleBackgroundColorChange(e.target.value, Number(opacityInput.value));
    });
    opacityInput.addEventListener("change", () => {
      updateOpacityLabel(Number(opacityInput.value));
    });
    opacityInput.addEventListener("input", () => {
      updateOpacityLabel(Number(opacityInput.value));
    });
    this.element = sub;
    return sub;
  }
}
class BorderSubpanel {
  constructor(controller, stylingData, uiHelpers) {
    this.controller = controller;
    this.stylingData = stylingData; // { borderColor: {hex, opacity}, borderWidth }
    this.uiHelpers = uiHelpers;
    this.element = null;
  }
  render() {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
                position: absolute;
                background: white;
                border: 1px solid #dcdcdc;
                border-radius: 12px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
                padding: 10px 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                pointer-events: auto;
            `;
    
    const currentBorderWidth = this.stylingData.borderWidth || DEFAULT_BORDER_WIDTH;
    const swatch = this.uiHelpers.makeSwatch(this.stylingData.borderColor.hex, 26);
    swatch.style.opacity = currentBorderWidth > 0 ? "1" : "0.45";
    sub.appendChild(swatch);
    const borderColorInput = document.createElement("input");
    borderColorInput.type = "color";
    borderColorInput.value = this.stylingData.borderColor.hex;
    borderColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(borderColorInput);
    const sync = () => {
      const width = Number(borderWidthInput.value);
      const opacity = Number(borderOpacityInput.value);
      updateBorderOpacityLabel(opacity);
      updateBorderWidthLabel(width);
      swatch.style.opacity = width > 0 ? "1" : "0.45";
      this.controller.handleBorderChange(borderColorInput.value, opacity, width);
    };
    const {
      wrapper: borderOpacityRow,
      input: borderOpacityInput,
      update: updateBorderOpacityLabel
    } = this.uiHelpers.createDropdownInput(this.stylingData.borderColor.opacity, {
      min: 0,
      max: 100,
      step: 1,
      format: v => `${Math.round(v)}%`,
      presetValues: [0, 25, 50, 75, 100],
      onChange: sync
    });
    sub.appendChild(borderOpacityRow);
    
    // Width label
    const widthLabel = document.createElement("span");
    widthLabel.textContent = "Width:";
    widthLabel.style.cssText = "font-size: 11px; color: #666; white-space: nowrap;";
    sub.appendChild(widthLabel);
    
    const {
      wrapper: borderWidthRow,
      input: borderWidthInput,
      update: updateBorderWidthLabel
    } = this.uiHelpers.createDropdownInput(currentBorderWidth, {
      min: 0,
      max: 12,
      step: 1,
      format: v => {
        const numeric = Number(v) || 0;
        return `${Math.round(numeric)}px`;
      },
      presetValues: [0, 1, 2, 4, 6, 8, 12],
      onChange: sync
    });
    sub.appendChild(borderWidthRow);
    swatch.addEventListener("click", () => borderColorInput.click());
    borderColorInput.addEventListener("change", e => {
      swatch.style.background = e.target.value;
      sync();
    });
    borderOpacityInput.addEventListener("input", () => {
      updateBorderOpacityLabel(Number(borderOpacityInput.value));
      updateBorderWidthLabel(Number(borderWidthInput.value));
      swatch.style.opacity = Number(borderWidthInput.value) > 0 ? "1" : "0.45";
    });
    borderWidthInput.addEventListener("input", () => {
      updateBorderOpacityLabel(Number(borderOpacityInput.value));
      updateBorderWidthLabel(Number(borderWidthInput.value));
      swatch.style.opacity = Number(borderWidthInput.value) > 0 ? "1" : "0.45";
    });
    this.element = sub;
    return sub;
  }
}

// ==========================================
class TextStylingPanel {
  constructor(registry, layer) {
    this.registry = registry;
    this.layer = layer;
    this.currentTextId = null;
    this.view = null;
    this.controller = null;
    this.positionManager = null;
  }
  show(textId) {
    const obj = this.registry.get(textId);
    if (!obj || obj.type !== 'text') return;
    this.hide();
    this.currentTextId = textId;
    const container = this.layer?.getObjectContainer(textId);
    if (!container) return;

    // 1. Create controller (handles registry updates)
    this.controller = new TextStylingController(this.registry, textId, this.layer);

    // 2. Read from Registry (hex + opacity format) - single source of truth
    const textColorInfo = {
      hex: obj.color || DEFAULT_TEXT_COLOR,
      opacity: obj.colorOpacity !== undefined ? obj.colorOpacity : 100
    };
    const backgroundColorInfo = {
      hex: obj.backgroundColor && obj.backgroundColor !== "transparent" ? obj.backgroundColor : DEFAULT_SPAN_BACKGROUND_COLOR,
      opacity: obj.backgroundColorOpacity !== undefined ? obj.backgroundColorOpacity : 100
    };
    const borderColorInfo = {
      hex: obj.borderColor || DEFAULT_BORDER_HEX,
      opacity: obj.borderOpacity !== undefined ? obj.borderOpacity : DEFAULT_BORDER_OPACITY
    };

    // 3. Create view (handles DOM) with toolbar buttons
    this.view = new TextStylingPanelView();

    // Define openSubpanel callback before render (needed for toolbar buttons)
    const openSubpanel = async (type, button) => {
      if (this.view.activeButton === button) {
        this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
        return;
      }
      this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
      let subpanelElement = null;
      const uiHelpers = this.view.getUIHelpers();
      if (type === "text") {
        const textSubpanel = new TextSubpanel(this.controller, {
          textColor: textColorInfo,
          fontFamily: obj.fontFamily || DEFAULT_FONT_FAMILY,
          fontSize: obj.fontSize || DEFAULT_FONT_SIZE,
          fontWeight: obj.fontWeight || DEFAULT_FONT_WEIGHT,
          fontStyle: obj.fontStyle || DEFAULT_FONT_STYLE,
          textAlign: obj.textAlign || DEFAULT_TEXT_ALIGN
        }, uiHelpers);
        subpanelElement = await textSubpanel.render();
      } else if (type === "background") {
        const backgroundSubpanel = new BackgroundSubpanel(this.controller, {
          backgroundColor: backgroundColorInfo
        }, uiHelpers);
        subpanelElement = backgroundSubpanel.render();
      } else if (type === "border") {
        const borderSubpanel = new BorderSubpanel(this.controller, {
          borderColor: borderColorInfo,
          borderWidth: obj.borderWidth || DEFAULT_BORDER_WIDTH
        }, uiHelpers);
        subpanelElement = borderSubpanel.render();
      }
      if (!subpanelElement) return;
      subpanelElement.style.opacity = "0";
      subpanelElement.style.transform = "translateX(-8px)";
      this.view.panel.appendChild(subpanelElement);
      this.view.activeSubpanel = subpanelElement;
      this.view.activeButton = button;
      this.view.setButtonActive(button, true);
      // Position subpanel based on main panel position
      const isPanelAbove = this.positionManager?.isPanelAbove ?? true;
      this.view.positionSubpanel(isPanelAbove);
      requestAnimationFrame(() => {
        if (!this.view.activeSubpanel) return;
        this.view.activeSubpanel.style.transition = "opacity 0.16s ease, transform 0.16s ease";
        this.view.activeSubpanel.style.opacity = "1";
        this.view.activeSubpanel.style.transform = "translateX(0)";
      });
    };
    const panel = this.view.render(null, openSubpanel);
    document.body.appendChild(panel);

    // 4. Setup position manager (with direct view reference)
    this.positionManager = new PanelPositionManager(panel, container, this.view);
    this.positionManager.init();

    // 5. Bind events (controller handles updates)
    const onOutside = ev => {
      const path = ev.composedPath();
      const isInsidePanel = this.view.isClickInside(ev);
      if (isInsidePanel) return;
      const activeContainer = textId ? this.layer?.getObjectContainer(textId) : null;
      const clickedInsideText = activeContainer && path.includes(activeContainer);
      if (this.view.activeSubpanel) {
        this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
      }
      if (clickedInsideText) return;
      this.hide();
    };
    const onKey = ev => {
      if (ev.key === "Escape") this.hide();
    };
    this.view.bindEvents(this.controller, onOutside, onKey);
  }
  hide() {
    if (this.positionManager) {
      this.positionManager.destroy();
      this.positionManager = null;
    }
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    this.controller = null;
    this.currentTextId = null;
  }

  // Check if click is inside panel or subpanel (for use by InteractionManager)
  isClickInside(ev) {
    return this.view?.isClickInside(ev) || false;
  }

  // Get the text container ID for this panel (for use by InteractionManager)
  getTextId() {
    return this.currentTextId;
  }

  // Close subpanel (for use by InteractionManager)
  closeSubpanel() {
    if (this.view && this.view.setButtonActive) {
      this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
    } else if (this.view) {
      this.view.closeSubpanel();
    }
  }
}

// ==========================================
// Image Control Panel (similar to TextStylingPanel)
// ==========================================
// ImageControlPanelView - Handles DOM creation and manipulation
// ==========================================
class ImageControlPanelView {
  constructor() {
    this.panel = null;
    this.toolbar = null;
    this.activeSubpanel = null;
    this.activeButton = null;
    this.onOutside = null;
    this.onKey = null;
  }

  // UI Helper Methods (reused from TextStylingPanelView)
  makeSwatch(hex, size = 30) {
    const swatch = document.createElement("div");
    swatch.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                border-radius: 8px;
                border: 1px solid #d0d0d0;
                box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
                cursor: pointer;
                background: ${hex};
                position: relative;
                overflow: hidden;
            `;
    return swatch;
  }
  createSlider(value, {
    min,
    max,
    step = 1,
    format = v => `${Math.round(v)}%`
  }) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
            `;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = `
                flex: 1;
                height: 6px;
            `;
    const label = document.createElement("span");
    label.textContent = format(Number(value));
    label.style.cssText = `
                font-size: 12px;
                color: #555;
                width: 48px;
                text-align: right;
            `;
    wrapper.appendChild(slider);
    wrapper.appendChild(label);
    return {
      wrapper,
      slider,
      label,
      update: v => {
        label.textContent = format(Number(v));
      }
    };
  }
  createDropdownInput(value, {
    min,
    max,
    step = 1,
    format = v => `${Math.round(v)}%`,
    presetValues = null, // Array of preset values, e.g. [0, 25, 50, 75, 100]
    onChange = null // Optional callback when value changes
  }) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
            `;
    
    // Generate preset values if not provided
    let presets = presetValues;
    if (!presets) {
      // Default: 4 steps for opacity (0%, 25%, 50%, 75%, 100%)
      if (min === 0 && max === 100 && step === 1) {
        presets = [0, 25, 50, 75, 100];
      } else {
        // Generate presets based on min/max/step
        presets = [];
        const stepCount = Math.min(5, Math.floor((max - min) / step) + 1);
        for (let i = 0; i < stepCount; i++) {
          const val = min + (max - min) * (i / (stepCount - 1));
          presets.push(Math.round(val / step) * step);
        }
      }
    }
    
    // Dropdown
    const dropdown = document.createElement("select");
    dropdown.style.cssText = `
                padding: 4px 8px;
                border: 1px solid #d0d0d0;
                border-radius: 6px;
                background: white;
                font-size: 12px;
                color: #333;
                cursor: pointer;
                min-width: 60px;
            `;
    presets.forEach(preset => {
      const option = document.createElement("option");
      option.value = String(preset);
      option.textContent = format(preset);
      if (Math.abs(Number(value) - preset) < step / 2) {
        option.selected = true;
      }
      dropdown.appendChild(option);
    });
    
    // Input for exact value
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = `
                width: 50px;
                padding: 4px 6px;
                border: 1px solid #d0d0d0;
                border-radius: 6px;
                background: white;
                font-size: 12px;
                color: #333;
                text-align: center;
            `;
    
    wrapper.appendChild(dropdown);
    wrapper.appendChild(input);
    
    // Sync functions
    const updateValue = (v) => {
      const numVal = Number(v);
      input.value = String(numVal);
      // Update dropdown to closest preset
      let closestPreset = presets[0];
      let minDiff = Math.abs(numVal - closestPreset);
      presets.forEach(preset => {
        const diff = Math.abs(numVal - preset);
        if (diff < minDiff) {
          minDiff = diff;
          closestPreset = preset;
        }
      });
      dropdown.value = String(closestPreset);
    };
    
    // Initialize value
    updateValue(value);
    
    // Event handlers
    const triggerChange = (val) => {
      // Call onChange callback if provided
      if (onChange && typeof onChange === 'function') {
        onChange(val);
      }
    };
    
    dropdown.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      updateValue(val);
      triggerChange(val);
    });
    
    input.addEventListener("change", (e) => {
      let val = Number(e.target.value);
      val = Math.max(min, Math.min(max, val)); // Clamp
      val = Math.round(val / step) * step; // Snap to step
      updateValue(val);
      triggerChange(val);
    });
    
    input.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      if (!isNaN(val) && val >= min && val <= max) {
        updateValue(val);
      }
    });
    
    return {
      wrapper,
      dropdown,
      input,
      update: updateValue,
      getValue: () => Number(input.value)
    };
  }
  setButtonActive(button, isActive) {
    if (!button) return;
    if (isActive) {
      button.dataset.active = "1";
      button.style.background = "#e0ebff";
      button.style.borderColor = "#4d8dff";
      button.style.color = "#1a3f8b";
    } else {
      button.dataset.active = "0";
      button.style.background = "#f5f5f7";
      button.style.borderColor = "#d2d2d8";
      button.style.color = "#333";
    }
  }
  makeToolbarButton(label, iconClass, onButtonClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wbe-color-toolbar-btn";
    btn.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 40px;
            padding: 0;
            border-radius: 10px;
            border: 1px solid #d2d2d8;
            background: #f5f5f7;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
        `;
    btn.dataset.active = "0";
    btn.title = label;
    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      // Universal solution: explicitly set icon color to inherit from button
      icon.style.cssText = "font-size: 18px; color: inherit;";
      btn.appendChild(icon);
    }
    // Universal solution: automatically set initial inactive state
    // This ensures the correct icon color from the start
    this.setButtonActive(btn, false);
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active === "1") return;
      btn.style.background = "#ededf8";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active === "1") return;
      this.setButtonActive(btn, false);
    });
    if (onButtonClick) {
      btn.addEventListener("click", onButtonClick);
    }
    return btn;
  }

  // Build Border subpanel (similar to BorderSubpanel for text)
  // Compact horizontal layout - all controls in one row
  buildBorderSubpanel(controller, stylingData, uiHelpers) {
    const sub = document.createElement("div");
    sub.className = "wbe-color-subpanel";
    sub.style.cssText = `
                position: absolute;
                background: white;
                border: 1px solid #dcdcdc;
                border-radius: 12px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
                padding: 10px 14px;
                display: flex;
                align-items: center;
                gap: 16px;
                pointer-events: auto;
            `;
    
    // Border Color swatch
    const currentBorderWidth = stylingData.borderWidth || DEFAULT_BORDER_WIDTH;
    const swatch = uiHelpers.makeSwatch(stylingData.borderColor.hex, 26);
    swatch.style.opacity = currentBorderWidth > 0 ? "1" : "0.45";
    sub.appendChild(swatch);
    const borderColorInput = document.createElement("input");
    borderColorInput.type = "color";
    borderColorInput.value = stylingData.borderColor.hex;
    borderColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(borderColorInput);
    
    // Border Opacity
    const {
      wrapper: borderOpacityRow,
      input: borderOpacityInput,
      update: updateBorderOpacityLabel
    } = uiHelpers.createDropdownInput(stylingData.borderColor.opacity, {
      min: 0,
      max: 100,
      step: 1,
      format: v => `${Math.round(v)}%`,
      presetValues: [0, 25, 50, 75, 100]
    });
    sub.appendChild(borderOpacityRow);

    // Separator
    const sep1 = document.createElement("div");
    sep1.style.cssText = "width: 1px; height: 20px; background: #e0e0e0;";
    sub.appendChild(sep1);

    // Border Width
    const borderWidthGroup = document.createElement("div");
    borderWidthGroup.style.cssText = "display: flex; align-items: center; gap: 4px;";
    sub.appendChild(borderWidthGroup);
    const borderWidthLabel = document.createElement("span");
    borderWidthLabel.textContent = "Width:";
    borderWidthLabel.style.cssText = "font-size: 11px; color: #666; white-space: nowrap;";
    borderWidthGroup.appendChild(borderWidthLabel);
    const {
      wrapper: borderWidthRow,
      input: borderWidthInput,
      update: updateBorderWidthLabel
    } = uiHelpers.createDropdownInput(currentBorderWidth, {
      min: 0,
      max: 12,
      step: 1,
      format: v => `${Math.round(v)}px`,
      presetValues: [0, 1, 2, 4, 6, 8, 12]
    });
    borderWidthGroup.appendChild(borderWidthRow);

    // Border Radius
    const borderRadiusGroup = document.createElement("div");
    borderRadiusGroup.style.cssText = "display: flex; align-items: center; gap: 4px;";
    sub.appendChild(borderRadiusGroup);
    const borderRadiusLabel = document.createElement("span");
    borderRadiusLabel.textContent = "Radius:";
    borderRadiusLabel.style.cssText = "font-size: 11px; color: #666; white-space: nowrap;";
    borderRadiusGroup.appendChild(borderRadiusLabel);
    const {
      wrapper: borderRadiusRow,
      input: borderRadiusInput,
      update: updateBorderRadiusLabel
    } = uiHelpers.createDropdownInput(stylingData.borderRadius || DEFAULT_BORDER_RADIUS, {
      min: 0,
      max: 50,
      step: 1,
      format: v => `${Math.round(v)}px`,
      presetValues: [0, 5, 10, 15, 20, 25, 50]
    });
    borderRadiusGroup.appendChild(borderRadiusRow);

    // Separator before Shadow
    const sep2 = document.createElement("div");
    sep2.style.cssText = "width: 1px; height: 20px; background: #e0e0e0;";
    sub.appendChild(sep2);

    // Shadow label
    const shadowLabel = document.createElement("span");
    shadowLabel.textContent = "Shadow";
    shadowLabel.style.cssText = "font-size: 11px; font-weight: 600; color: #444; white-space: nowrap;";
    sub.appendChild(shadowLabel);
    
    // Shadow Color swatch
    const shadowSwatch = uiHelpers.makeSwatch(stylingData.shadowColor.hex, 26);
    shadowSwatch.style.opacity = stylingData.shadowColor.opacity > 0 ? "1" : "0.45";
    sub.appendChild(shadowSwatch);
    const shadowColorInput = document.createElement("input");
    shadowColorInput.type = "color";
    shadowColorInput.value = stylingData.shadowColor.hex;
    shadowColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(shadowColorInput);
    
    // Shadow Opacity
    const {
      wrapper: shadowOpacityRow,
      input: shadowOpacityInput,
      update: updateShadowOpacityLabel
    } = uiHelpers.createDropdownInput(stylingData.shadowColor.opacity, {
      min: 0,
      max: 100,
      step: 1,
      format: v => `${Math.round(v)}%`,
      presetValues: [0, 25, 50, 75, 100]
    });
    sub.appendChild(shadowOpacityRow);

    // Sync function
    const sync = () => {
      const borderWidth = Number(borderWidthInput.value);
      const borderOpacity = Number(borderOpacityInput.value);
      const borderRadius = Number(borderRadiusInput.value);
      const shadowOpacity = Number(shadowOpacityInput.value);
      updateBorderOpacityLabel(borderOpacity);
      updateBorderWidthLabel(borderWidth);
      updateBorderRadiusLabel(borderRadius);
      updateShadowOpacityLabel(shadowOpacity);
      swatch.style.opacity = borderWidth > 0 ? "1" : "0.45";
      shadowSwatch.style.opacity = shadowOpacity > 0 ? "1" : "0.45";
      controller.handleBorderChange(
        borderColorInput.value,
        borderOpacity,
        borderWidth,
        borderRadius,
        shadowColorInput.value,
        shadowOpacity
      );
    };

    swatch.addEventListener("click", () => borderColorInput.click());
    borderColorInput.addEventListener("change", e => {
      swatch.style.background = e.target.value;
      sync();
    });
    borderOpacityInput.addEventListener("input", () => {
      updateBorderOpacityLabel(Number(borderOpacityInput.value));
      updateBorderWidthLabel(Number(borderWidthInput.value));
      swatch.style.opacity = Number(borderWidthInput.value) > 0 ? "1" : "0.45";
    });
    borderWidthInput.addEventListener("input", () => {
      updateBorderWidthLabel(Number(borderWidthInput.value));
      swatch.style.opacity = Number(borderWidthInput.value) > 0 ? "1" : "0.45";
    });
    borderRadiusInput.addEventListener("input", () => {
      updateBorderRadiusLabel(Number(borderRadiusInput.value));
    });
    shadowSwatch.addEventListener("click", () => shadowColorInput.click());
    shadowColorInput.addEventListener("change", e => {
      shadowSwatch.style.background = e.target.value;
      sync();
    });
    shadowOpacityInput.addEventListener("input", () => {
      updateShadowOpacityLabel(Number(shadowOpacityInput.value));
      shadowSwatch.style.opacity = Number(shadowOpacityInput.value) > 0 ? "1" : "0.45";
    });
    borderOpacityInput.addEventListener("change", sync);
    borderWidthInput.addEventListener("change", sync);
    borderRadiusInput.addEventListener("change", sync);
    shadowOpacityInput.addEventListener("change", sync);
    
    // Also sync on dropdown change (dropdown is sibling of input in wrapper)
    const borderOpacityDropdown = borderOpacityRow.querySelector("select");
    const borderWidthDropdown = borderWidthRow.querySelector("select");
    const borderRadiusDropdown = borderRadiusRow.querySelector("select");
    const shadowOpacityDropdown = shadowOpacityRow.querySelector("select");
    if (borderOpacityDropdown) borderOpacityDropdown.addEventListener("change", sync);
    if (borderWidthDropdown) borderWidthDropdown.addEventListener("change", sync);
    if (borderRadiusDropdown) borderRadiusDropdown.addEventListener("change", sync);
    if (shadowOpacityDropdown) shadowOpacityDropdown.addEventListener("change", sync);

    return sub;
  }

  /**
   * Build Crop subpanel with mask type selection (rect/circle)
   * @param {ImageControlController} controller - Controller for handling changes
   * @param {string} currentMaskType - Current mask type ('rect' or 'circle')
   * @param {WhiteboardLayer} layer - Layer for gizmo updates
   * @returns {HTMLElement} Subpanel element
   */
  buildCropSubpanel(controller, currentMaskType, layer) {
    const sub = document.createElement("div");
    sub.className = "wbe-crop-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: auto;
    `;

    // Label
    const maskLabel = document.createElement("span");
    maskLabel.textContent = "Mask:";
    maskLabel.style.cssText = "font-size: 11px; color: #666; font-weight: 500; white-space: nowrap;";
    sub.appendChild(maskLabel);

    // Track current mask type in panel state
    let panelCurrentMaskType = currentMaskType || 'rect';

    // Create compact mask type button (icon only, horizontal)
    const makeMaskButton = (label, iconClass, maskType) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 2px solid #d0d0d0;
        background: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      `;
      btn.title = label;

      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.cssText = "font-size: 16px; color: #333;";
      btn.appendChild(icon);

      // Set active state
      const updateActiveState = (isActive) => {
        if (isActive) {
          btn.style.background = "#e0ebff";
          btn.style.borderColor = "#4d8dff";
          icon.style.color = "#1a3f8b";
        } else {
          btn.style.background = "white";
          btn.style.borderColor = "#d0d0d0";
          icon.style.color = "#333";
        }
      };

      // Initial state
      updateActiveState(maskType === panelCurrentMaskType);

      // Click handler
      btn.addEventListener("click", () => {
        if (panelCurrentMaskType === maskType) return; // Already active

        panelCurrentMaskType = maskType;

        // Update both buttons in subpanel
        sub.querySelectorAll("button").forEach((b) => {
          const btnMaskType = b.dataset.maskType;
          const btnIcon = b.querySelector("i");
          const isActive = btnMaskType === maskType;
          
          if (isActive) {
            b.style.background = "#e0ebff";
            b.style.borderColor = "#4d8dff";
            if (btnIcon) btnIcon.style.color = "#1a3f8b";
          } else {
            b.style.background = "white";
            b.style.borderColor = "#d0d0d0";
            if (btnIcon) btnIcon.style.color = "#333";
          }
        });

        // Call controller to update mask type
        if (controller && controller.handleMaskTypeChange) {
          controller.handleMaskTypeChange(maskType, layer);
        }
      });

      btn.addEventListener("mouseenter", () => {
        if (maskType !== panelCurrentMaskType) {
          btn.style.background = "#f5f5f7";
        }
      });
      btn.addEventListener("mouseleave", () => {
        if (maskType !== panelCurrentMaskType) {
          btn.style.background = "white";
        }
      });

      // Store mask type for external reference
      btn.dataset.maskType = maskType;

      return btn;
    };

    const rectBtn = makeMaskButton("Rectangle", "fas fa-square", "rect");
    const circleBtn = makeMaskButton("Circle", "fas fa-circle", "circle");

    sub.appendChild(rectBtn);
    sub.appendChild(circleBtn);

    // Store button references on subpanel for external updates
    sub.rectBtn = rectBtn;
    sub.circleBtn = circleBtn;

    return sub;
  }

  positionSubpanel(_isPanelAbove = true) {
    // Subpanel ALWAYS goes BELOW the main panel, centered
    if (!this.activeSubpanel || !this.panel) return;
    
    // Center subpanel horizontally relative to panel center
    const panelWidth = this.panel.offsetWidth || 200;
    const subpanelWidth = this.activeSubpanel.offsetWidth || 200;
    const left = (panelWidth - subpanelWidth) / 2;
    this.activeSubpanel.style.left = `${left}px`;
    
    // Always position below panel
    const panelHeight = this.panel.offsetHeight || 50;
    this.activeSubpanel.style.top = `${panelHeight + 8}px`;
  }

  updatePanelPosition() {
    // Position will be managed by PanelPositionManager
  }

  render(openSubpanelFn) {
    // Unification: use the same styles as the text panel
    const panel = document.createElement("div");
    panel.className = "wbe-color-picker-panel"; // Same class for style unification
    panel.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #d7d7d7;
            border-radius: 14px;
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
            padding: 6px;
            z-index: ${ZINDEX_TEXT_COLOR_PICKER};
            pointer-events: auto;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            aspect-ratio: 4 / 1;
            transform: translateX(-50%) scale(0.9) translateY(12px);
            opacity: 0;
            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;

    // IMPORTANT: Add stopPropagation to prevent Foundry from handling panel clicks
    panel.addEventListener("mousedown", ev => {
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    });

    this.panel = panel;
    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
            display: flex;
            gap: 12px;
            position: relative;
        `;
    this.toolbar = toolbar;

    // Crop button - universal pattern via openSubpanelFn
    const cropBtn = this.makeToolbarButton("Crop", "fas fa-crop", () => {
      if (openSubpanelFn) openSubpanelFn("crop", cropBtn);
    });
    toolbar.appendChild(cropBtn);

    // Border button - icon from legacy code
    const borderBtn = this.makeToolbarButton("Border", "fas fa-border-all", () => {
      if (openSubpanelFn) openSubpanelFn("border", borderBtn);
    });
    toolbar.appendChild(borderBtn);

    // Lock button - icon from legacy code
    // Get frozen state from registry if available (passed via openSubpanelFn context)
    const lockBtn = this.makeToolbarButton("Lock", "fas fa-lock", () => {
      if (openSubpanelFn) openSubpanelFn("lock", lockBtn);
    });
    toolbar.appendChild(lockBtn);

    panel.appendChild(toolbar);
    return panel;
  }

  closeSubpanel(setButtonActiveFn) {
    if (this.activeSubpanel) {
      this.activeSubpanel.remove();
      this.activeSubpanel = null;
    }
    if (this.activeButton && setButtonActiveFn) {
      setButtonActiveFn(this.activeButton, false);
      this.activeButton = null;
    }
  }

  isClickInside(ev) {
    if (!this.panel) return false;
    const path = ev.composedPath();
    return path.includes(this.panel) || (this.activeSubpanel && path.includes(this.activeSubpanel));
  }

  bindEvents(controller, onOutside, onKey) {
    this.onOutside = onOutside;
    this.onKey = onKey;
    if (onKey) {
      document.addEventListener("keydown", onKey);
    }
  }

  destroy() {
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey);
    }
    this.closeSubpanel();
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.toolbar = null;
    this.activeSubpanel = null;
    this.activeButton = null;
    this.onOutside = null;
    this.onKey = null;
  }

  getUIHelpers() {
    return {
      makeSwatch: this.makeSwatch.bind(this),
      createSlider: this.createSlider.bind(this),
      createDropdownInput: this.createDropdownInput.bind(this),
      setButtonActive: this.setButtonActive.bind(this)
    };
  }
}

// ==========================================
class ImageControlController {
  constructor(registry, imageId) {
    this.registry = registry;
    this.imageId = imageId;
  }
  handleBorderChange(borderHex, borderOpacity, borderWidth, borderRadius, shadowHex, shadowOpacity) {
    this.registry.update(this.imageId, {
      borderHex,
      borderOpacity,
      borderWidth,
      borderRadius,
      shadowHex,
      shadowOpacity
    }, 'local');
  }
  handleLockChange(frozen) {
    this.registry.update(this.imageId, {
      frozen
    }, 'local');
  }
  
  /**
   * Handle mask type change (rect/circle)
   * @param {string} newMaskType - 'rect' or 'circle'
   * @param {WhiteboardLayer} layer - Layer for gizmo updates
   */
  handleMaskTypeChange(newMaskType, layer) {
    const obj = this.registry.get(this.imageId);
    if (!obj || obj.maskType === newMaskType) return;
    
    const container = layer?.getObjectContainer(this.imageId);
    const imageElement = layer?.getImageElement(this.imageId);
    if (!container || !imageElement) return;
    
    // 1. Update Registry (SSOT)
    this.registry.update(this.imageId, { maskType: newMaskType }, 'local');
    
    // 2. Handle cropPreview for circle mask
    if (newMaskType === 'circle' && obj.isCropping) {
      // Get dimensions for calculations
      const updatedObj = this.registry.get(this.imageId);
      const scale = updatedObj?.scale || 1;
      const baseWidth = updatedObj?.baseWidth || 200;
      const baseHeight = updatedObj?.baseHeight || 200;
      // Round all dimensions to prevent subpixel jittering
      const fullWidth = Math.round(baseWidth * scale);
      const fullHeight = Math.round(baseHeight * scale);
      const circleRadius = updatedObj?.circleRadius !== null ? updatedObj.circleRadius : Math.min(baseWidth, baseHeight) / 2;
      const circleOffset = updatedObj?.circleOffset || { x: 0, y: 0 };
      const scaledRadius = Math.round(circleRadius * scale);
      const scaledCenterX = Math.round((baseWidth / 2 + circleOffset.x) * scale);
      const scaledCenterY = Math.round((baseHeight / 2 + circleOffset.y) * scale);
      
      // CRITICAL: Expand container and imageWrapper to full image size (same as enterCropMode)
      container.style.width = `${fullWidth}px`;
      container.style.height = `${fullHeight}px`;
      
      const imageWrapper = container.querySelector('.wbe-image-wrapper');
      if (imageWrapper) {
        imageWrapper.style.width = `${fullWidth}px`;
        imageWrapper.style.height = `${fullHeight}px`;
      }
      
      // imageElement = full size, positioned at origin
      imageElement.style.left = '0px';
      imageElement.style.top = '0px';
      imageElement.style.width = `${fullWidth}px`;
      imageElement.style.height = `${fullHeight}px`;
      
      // Create cropPreview if switching TO circle in crop mode
      let cropPreview = container.querySelector('.wbe-crop-preview');
      if (!cropPreview && imageWrapper) {
        cropPreview = document.createElement('img');
        cropPreview.className = 'wbe-crop-preview';
        cropPreview.src = imageElement.src;
        imageWrapper.appendChild(cropPreview);
      }
      
      // Apply cropPreview styles (bright circle area with clip-path)
      if (cropPreview) {
        cropPreview.style.cssText = `
          position: absolute;
          left: 0px;
          top: 0px;
          width: ${fullWidth}px;
          height: ${fullHeight}px;
          opacity: 1;
          clip-path: circle(${scaledRadius}px at ${scaledCenterX}px ${scaledCenterY}px);
          pointer-events: none;
          z-index: 1;
        `;
      }
      
      // Make imageElement semi-transparent
      imageElement.style.opacity = '0.15';
      imageElement.style.clipPath = 'none';
      
      // Create circleOverlay if not exists and apply styles (purple border)
      let circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
      if (!circleOverlay) {
        circleOverlay = document.createElement('div');
        circleOverlay.className = 'wbe-crop-circle-overlay';
        container.appendChild(circleOverlay);
      }
      
      const diameter = scaledRadius * 2;
      circleOverlay.style.cssText = `
        position: absolute;
        left: ${scaledCenterX - scaledRadius}px;
        top: ${scaledCenterY - scaledRadius}px;
        width: ${diameter}px;
        height: ${diameter}px;
        border-radius: 50%;
        border: 2px solid rgba(128, 0, 255, 0.9);
        pointer-events: none;
        z-index: 1002;
      `;
    } else if (newMaskType === 'rect' && obj.isCropping) {
      // Remove cropPreview and circleOverlay when switching TO rect
      const cropPreview = container.querySelector('.wbe-crop-preview');
      if (cropPreview) cropPreview.remove();
      const circleOverlay = container.querySelector('.wbe-crop-circle-overlay');
      if (circleOverlay) circleOverlay.remove();
      // Restore imageElement opacity
      imageElement.style.opacity = '1';
    }
    
    // 3. Recreate gizmos for new mask type
    layer.removeCropHandles(this.imageId);
    layer.createCropHandles(this.imageId, newMaskType);
    
    // 4. Update clip-path and dimensions
    layer.updateImageClipPath(this.imageId);
    
    // 5. Update gizmo positions
    layer.updateCropHandlesPosition(this.imageId);
    
    // 6. Update SVG permanent border for new mask type
    const permanentBorder = container.querySelector('.wbe-image-permanent-border');
    if (permanentBorder && layer) {
      const updatedObj = this.registry.get(this.imageId);
      const isCircleMask = newMaskType === 'circle';
      const scale = updatedObj?.scale || 1;
      const baseBorderWidth = updatedObj?.borderWidth !== undefined ? updatedObj.borderWidth : DEFAULT_BORDER_WIDTH;
      const baseBorderRadius = updatedObj?.borderRadius !== undefined ? updatedObj.borderRadius : DEFAULT_BORDER_RADIUS;
      const scaledBorderWidth = Math.round(baseBorderWidth * scale);
      const scaledBorderRadius = Math.round(baseBorderRadius * scale);
      const borderRgba = scaledBorderWidth > 0 
        ? hexToRgba(updatedObj?.borderHex || DEFAULT_BORDER_HEX, updatedObj?.borderOpacity !== undefined ? updatedObj.borderOpacity : DEFAULT_BORDER_OPACITY) 
        : null;
      const containerWidth = parseFloat(container.style.width) || 0;
      const containerHeight = parseFloat(container.style.height) || 0;
      layer._updateSvgPermanentBorder(permanentBorder, containerWidth, containerHeight, scaledBorderWidth, borderRgba, scaledBorderRadius, isCircleMask);
      
      // Also update imageWrapper border-radius
      // BUT NOT in crop mode - imageWrapper shows full image (rectangular)
      const imageWrapper = container.querySelector('.wbe-image-wrapper');
      if (imageWrapper) {
        const isCropping = updatedObj?.isCropping;
        imageWrapper.style.borderRadius = (!isCropping && isCircleMask) ? '50%' : `${baseBorderRadius * scale}px`;
      }
    }
    
    // 7. Update selection border (blue for circle in crop mode, purple for rect)
    const selectionBorder = container.querySelector('.wbe-image-selection-border');
    if (selectionBorder) {
      if (newMaskType === 'circle') {
        selectionBorder.style.borderRadius = '0'; // Blue frame is rectangular
        selectionBorder.style.outline = '1px solid #1c86ff';
      } else {
        selectionBorder.style.borderRadius = '0';
        selectionBorder.style.outline = '1px solid rgba(128, 0, 255, 0.9)';
      }
    }
  }
}

// ==========================================
class ImageControlPanel {
  constructor(registry, layer, interactionManager, socketController = null) {
    this.registry = registry;
    this.layer = layer;
    this.interactionManager = interactionManager;
    this.socketController = socketController; // For sending socket messages during cropping
    this.currentImageId = null;
    this.view = null;
    this.controller = null;
    this.positionManager = null;
  }
  show(imageId) {
    const obj = this.registry.get(imageId);
    if (!obj || obj.type !== 'image') return;
    
    // Don't show panel for frozen images
    if (obj.frozen) {
      this.hide();
      return;
    }
    
    this.hide();
    this.currentImageId = imageId;
    const container = this.layer?.getObjectContainer(imageId);
    if (!container) return;

    // 1. Create controller (handles registry updates)
    this.controller = new ImageControlController(this.registry, imageId);

    // 2. Read from Registry (hex + opacity format) - single source of truth
    const borderColorInfo = {
      hex: obj.borderHex || DEFAULT_BORDER_HEX,
      opacity: obj.borderOpacity !== undefined ? obj.borderOpacity : DEFAULT_BORDER_OPACITY
    };
    const shadowColorInfo = {
      hex: obj.shadowHex || DEFAULT_SHADOW_HEX,
      opacity: obj.shadowOpacity !== undefined ? obj.shadowOpacity : DEFAULT_SHADOW_OPACITY
    };

    // 3. Create view (handles DOM) with toolbar buttons
    this.view = new ImageControlPanelView();

    // Define openSubpanel callback before render
    const openSubpanel = async (type, button) => {
      // Exit crop mode if opening other subpanels (border, lock) - MUST be done BEFORE closing subpanel
      // SSOT: Use Registry only, not DOM attributes
      // CRITICAL: This check must happen even if we're toggling (closing) the subpanel
      if (type !== "crop") {
        const currentObj = this.registry.get(imageId);
        if (currentObj && currentObj.type === 'image' && currentObj.isCropping) {
          await currentObj.exitCropMode(this.layer, this.registry, this.socketController);
          // Update crop button state
          const cropBtn = this.view.panel?.querySelector('.wbe-image-toolbar-btn[title="Crop"]');
          if (cropBtn) {
            this.view.setButtonActive(cropBtn, false);
          }
          // Update panel position after crop (container size changed)
          this.updatePosition();
        }
      }
      
      // Toggle subpanel: if already active, close it and return
      if (this.view.activeButton === button) {
        this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
        return;
      }
      this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
      
      let subpanelElement = null;
      const uiHelpers = this.view.getUIHelpers();
      if (type === "border") {
        const borderSubpanel = this.view.buildBorderSubpanel(this.controller, {
          borderColor: borderColorInfo,
          borderWidth: obj.borderWidth || DEFAULT_BORDER_WIDTH,
          borderRadius: obj.borderRadius || DEFAULT_BORDER_RADIUS,
          shadowColor: shadowColorInfo
        }, uiHelpers);
        subpanelElement = borderSubpanel;
      } else if (type === "lock") {
        // Toggle frozen state
        const newFrozen = !obj.frozen;
        this.controller.handleLockChange(newFrozen);
        
        // Update button state only if view is initialized
        if (this.view) {
          this.view.setButtonActive(button, newFrozen);
        }
        
        // Update lock icon based on frozen state
        const icon = button.querySelector('i');
        if (icon) {
          if (newFrozen) {
            icon.className = 'fas fa-unlock';
            button.title = "Unfreeze image";
          } else {
            icon.className = 'fas fa-lock';
            button.title = "Lock image";
          }
        }
        return;
      } else if (type === "crop") {
        // Crop mode with mask type subpanel
        const currentObj = this.registry.get(imageId);
        if (!currentObj || currentObj.type !== 'image') return;
        
        // If subpanel already open for crop button - close it and exit crop mode
        if (this.view.activeButton === button) {
          // Exit crop mode when closing subpanel
          if (currentObj.isCropping) {
            await currentObj.exitCropMode(this.layer, this.registry, this.socketController);
            // Update panel position after crop (container size changed)
            this.updatePosition();
          }
          this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
          return;
        }
        
        // Enter crop mode if not already
        if (!currentObj.isCropping) {
          await currentObj.enterCropMode(this.layer, this.registry, this.socketController);
        }
        this.view.setButtonActive(button, true);
        
        // Build crop subpanel with mask type selection
        const cropSubpanel = this.view.buildCropSubpanel(
          this.controller,
          currentObj.maskType || 'rect',
          this.layer
        );
        subpanelElement = cropSubpanel;
      }
      if (!subpanelElement) return;
      subpanelElement.style.opacity = "0";
      subpanelElement.style.transform = "translateX(-8px)";
      this.view.panel.appendChild(subpanelElement);
      this.view.activeSubpanel = subpanelElement;
      this.view.activeButton = button;
      this.view.setButtonActive(button, true);
      // Position subpanel based on main panel position
      const isPanelAbove = this.positionManager?.isPanelAbove ?? true;
      this.view.positionSubpanel(isPanelAbove);
      requestAnimationFrame(() => {
        if (!this.view.activeSubpanel) return;
        this.view.activeSubpanel.style.transition = "opacity 0.16s ease, transform 0.16s ease";
        this.view.activeSubpanel.style.opacity = "1";
        this.view.activeSubpanel.style.transform = "translateX(0)";
      });
    };
    const panel = this.view.render(openSubpanel);
    document.body.appendChild(panel);

    // 4. Setup initial state for Lock button (icon and active state based on frozen)
    const lockBtn = panel.querySelector('.wbe-image-toolbar-btn[title="Lock"]');
    if (lockBtn) {
      const isFrozen = obj.frozen || false;
      this.view.setButtonActive(lockBtn, isFrozen);
      const icon = lockBtn.querySelector('i');
      if (icon) {
        if (isFrozen) {
          icon.className = 'fas fa-unlock';
          lockBtn.title = "Unfreeze image";
        } else {
          icon.className = 'fas fa-lock';
          lockBtn.title = "Lock image";
        }
      }
    }

    // 5. Setup initial state for Crop button (active state based on isCropping)
    const cropBtn = panel.querySelector('.wbe-image-toolbar-btn[title="Crop"]');
    if (cropBtn) {
      const isCropping = obj.isCropping || false;
      this.view.setButtonActive(cropBtn, isCropping);
    }

    // 7. Setup position manager (with direct view reference)
    this.positionManager = new PanelPositionManager(panel, container, this.view);
    this.positionManager.init();

    // 5. Bind events (controller handles updates)
    const onOutside = ev => {
      const path = ev.composedPath();
      const isInsidePanel = this.view.isClickInside(ev);
      if (isInsidePanel) return;
      const activeContainer = imageId ? this.layer?.getObjectContainer(imageId) : null;
      const clickedInsideImage = activeContainer && path.includes(activeContainer);
      if (this.view.activeSubpanel) {
        this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
      }
      if (clickedInsideImage) return;
      this.hide();
    };
    const onKey = ev => {
      if (ev.key === "Escape") {
        if (this.view.activeSubpanel) {
          this.view.closeSubpanel(this.view.setButtonActive.bind(this.view));
        } else {
          this.hide();
        }
      }
    };
    this.view.bindEvents(this.controller, onOutside, onKey);
  }
  hide() {
    if (this.positionManager) {
      this.positionManager.destroy();
      this.positionManager = null;
    }
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    this.controller = null;
    this.currentImageId = null;
  }
  updatePosition() {
    if (this.positionManager) {
      this.positionManager.update();
    }
  }
  cleanup() {
    this.hide();
  }
}

// ==========================================
// 4. Foundry API Adapter (Isolated Foundry API access)
// ==========================================
/**
 * Adapter for Foundry API calls.
 * Isolates all Foundry API access to make updates easier when API changes.
 */
class FoundryAPIAdapter {
  /**
   * Disable Foundry mass-select controls during drag operations
   * @returns {boolean} true if successfully disabled, false otherwise
   */
  static disableMassSelect() {
    try {
      // Foundry API: canvas.controls.select.visible
      // This disables the orange mass-select frame that appears during drag
      if (canvas?.controls?.select) {
        canvas.controls.select.visible = false;
        return true;
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to disable Foundry mass-select:`, error);
    }
    return false;
  }

  /**
   * Enable Foundry mass-select controls after drag operations
   * @returns {boolean} true if successfully enabled, false otherwise
   */
  static enableMassSelect() {
    try {
      // Foundry API: canvas.controls.select.visible
      // Re-enable the mass-select controls after drag ends
      if (canvas?.controls?.select) {
        canvas.controls.select.visible = true;
        return true;
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to enable Foundry mass-select:`, error);
    }
    return false;
  }
}

// ==========================================
// 4.5. Mass Selection (View + Controller)
// ==========================================

/**
 * CSS styles for mass selection UI elements
 */
const MASS_SELECTION_CSS = `
  /* Selection box - drawn while dragging to select */
  .wbe-mass-selection-box {
    position: fixed;
    border: 2px dashed #4a90d9;
    background: rgba(74, 144, 217, 0.1);
    pointer-events: none;
    z-index: 9999;
    display: none;
  }

  /* Bounding box - around all selected objects (dark blue like old code) */
  .wbe-mass-bounding-box {
    position: absolute;
    border: 3px solid #1a237e;
    background: rgba(26, 35, 126, 0.05);
    pointer-events: auto;
    z-index: 1000;
    display: none;
  }

  /* Selection count indicator */
  .wbe-mass-indicator {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    z-index: 9999;
    display: none;
  }
`;

/**
 * MassSelectionView - DOM elements for mass selection
 * Handles all visual aspects: selection box, bounding box, indicators
 */
class MassSelectionView {
  constructor(layer) {
    this.layer = layer;
    this.selectionBox = null;
    this.boundingBox = null;
    this.indicator = null;
    this._stylesInjected = false;
  }

  /**
   * Create all DOM elements for mass selection
   */
  createElements() {
    this._injectStyles();

    // Selection box (fixed position - follows mouse during selection)
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'wbe-mass-selection-box';
    document.body.appendChild(this.selectionBox);

    // Bounding box (absolute position in layer - around selected objects)
    this.boundingBox = document.createElement('div');
    this.boundingBox.className = 'wbe-mass-bounding-box';
    // Will be added to layer when first needed (layer might not exist yet)

    // Indicator (fixed position - shows "N selected")
    this.indicator = document.createElement('div');
    this.indicator.className = 'wbe-mass-indicator';
    document.body.appendChild(this.indicator);
  }

  /**
   * Set layer reference (called when layer is ready)
   * @param {WhiteboardLayer} layer
   */
  setLayer(layer) {
    this.layer = layer;
  }

  /**
   * Inject CSS styles (once)
   */
  _injectStyles() {
    if (this._stylesInjected) return;
    const style = document.createElement('style');
    style.textContent = MASS_SELECTION_CSS;
    document.head.appendChild(style);
    this._stylesInjected = true;
  }

  /**
   * Update selection box position and size during drag
   * @param {Object} rect - {left, top, width, height} in screen coords
   */
  updateSelectionBox(rect) {
    if (!this.selectionBox) return;
    this.selectionBox.style.left = `${rect.left}px`;
    this.selectionBox.style.top = `${rect.top}px`;
    this.selectionBox.style.width = `${rect.width}px`;
    this.selectionBox.style.height = `${rect.height}px`;
  }

  showSelectionBox() {
    if (this.selectionBox) this.selectionBox.style.display = 'block';
  }

  hideSelectionBox() {
    if (this.selectionBox) this.selectionBox.style.display = 'none';
  }

  /**
   * Update bounding box to encompass all selected objects
   * @param {Array<HTMLElement>} containers - Array of selected object containers
   */
  updateBoundingBox(containers) {
    if (!this.boundingBox) {
      console.warn('[MassSelectionView] updateBoundingBox: no boundingBox element');
      return;
    }
    if (containers.length === 0) {
      this.hideBoundingBox();
      return;
    }

    // Ensure bounding box is in the layer DOM
    // WhiteboardLayer uses .element property (not .layerElement)
    if (!this.boundingBox.parentNode && this.layer?.element) {
      this.layer.element.appendChild(this.boundingBox);
      console.log('[MassSelectionView] Bounding box added to layer');
    }
    
    if (!this.boundingBox.parentNode) {
      console.warn('[MassSelectionView] Cannot show bounding box - no layer element');
      return;
    }

    // Calculate bounding rect of all selected containers
    // Use same logic as updateSelectionOverlay - container.style values are in layer coordinates
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const container of containers) {
      const left = parseFloat(container.style.left) || 0;
      const top = parseFloat(container.style.top) || 0;
      
      // Get object from registry to check type and scale
      const obj = this.layer?.registry?.get(container.id);
      const scale = obj?.scale !== undefined ? obj.scale : 1;
      
      // Get dimensions - same logic as updateSelectionOverlay
      const baseWidth = parseFloat(container.style.width) || container.offsetWidth;
      const baseHeight = parseFloat(container.style.height) || container.offsetHeight;
      
      let width, height;
      if (obj?.type === 'text') {
        // Text uses transform: scale()
        width = baseWidth * scale;
        height = baseHeight * scale;
      } else {
        // Images: container dimensions are already correct
        width = baseWidth;
        height = baseHeight;
      }
      
      // Account for border
      const borderWidth = obj?.borderWidth || 0;
      const scaledBorderWidth = obj?.type === 'text' ? borderWidth * scale : borderWidth;

      minX = Math.min(minX, left - scaledBorderWidth);
      minY = Math.min(minY, top - scaledBorderWidth);
      maxX = Math.max(maxX, left + width + scaledBorderWidth);
      maxY = Math.max(maxY, top + height + scaledBorderWidth);
    }

    // Add padding
    const padding = 10;
    this.boundingBox.style.left = `${minX - padding}px`;
    this.boundingBox.style.top = `${minY - padding}px`;
    this.boundingBox.style.width = `${maxX - minX + padding * 2}px`;
    this.boundingBox.style.height = `${maxY - minY + padding * 2}px`;
    this.boundingBox.style.display = 'block';
    
    console.log('[MassSelectionView] updateBoundingBox:', {
      containers: containers.length,
      rect: { left: minX - padding, top: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
    });
  }

  hideBoundingBox() {
    if (this.boundingBox) this.boundingBox.style.display = 'none';
  }

  /**
   * Update indicator text
   * @param {number} count - Number of selected objects
   */
  updateIndicator(count) {
    if (!this.indicator) return;
    if (count > 1) {
      this.indicator.textContent = `${count} selected`;
      this.indicator.style.display = 'block';
    } else {
      this.indicator.style.display = 'none';
    }
  }


  /**
   * Cleanup DOM elements
   */
  destroy() {
    this.selectionBox?.remove();
    this.boundingBox?.remove();
    this.indicator?.remove();
  }
}

/**
 * MassSelectionController - Logic for mass selection operations
 * Handles selection box, mass drag, keyboard shortcuts
 */
class MassSelectionController {
  constructor(registry, layer, view, interactionManager) {
    this.registry = registry;
    this.layer = layer;
    this.view = view;
    this.interactionManager = interactionManager;

    // State
    this.selectedIds = new Set();
    this.isSelecting = false;
    this.isDragging = false;
    this.toggleMode = this._loadToggleMode(); // from localStorage
    this.selectionStart = { x: 0, y: 0 };
    this.dragStart = { x: 0, y: 0 };
    this.startPositions = new Map();
    this.clipboard = [];
  }

  // ========== Toggle Mode ==========

  _loadToggleMode() {
    return localStorage.getItem('wbe-mass-selection-toggle') === 'true';
  }

  setToggleMode(enabled) {
    this.toggleMode = enabled;
    localStorage.setItem('wbe-mass-selection-toggle', enabled.toString());
  }

  // ========== Selection Box ==========

  /**
   * Check if selection should start based on event and mode
   * @param {MouseEvent} e
   * @returns {boolean} true if should start selection
   */
  _shouldStartSelection(e) {
    // toggleMode ON: always start selection on empty space
    // toggleMode OFF: only with Shift held
    if (this.toggleMode) {
      return true;
    }
    return e.shiftKey;
  }

  /**
   * Start selection box drawing
   * @param {MouseEvent} e
   * @returns {boolean} true if selection started
   */
  startSelection(e) {
    if (!this._shouldStartSelection(e)) return false;

    // Deselect single selection BEFORE hitTest (like Miro)
    // This ensures selection border doesn't interfere with hitTest
    if (this.interactionManager.selectedId) {
      this.interactionManager._deselect();
    }

    // Only start if clicked on empty space (not on object)
    const hitResult = this.interactionManager._hitTest(e.clientX, e.clientY);
    if (hitResult.type === 'object') return false;

    this.isSelecting = true;
    this.selectionStart = { x: e.clientX, y: e.clientY };
    this.view.showSelectionBox();
    this.view.updateSelectionBox({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
    return true;
  }

  /**
   * Update selection box during drag
   * @param {MouseEvent} e
   */
  updateSelection(e) {
    if (!this.isSelecting) return;

    const rect = this._calculateRect(this.selectionStart, { x: e.clientX, y: e.clientY });
    this.view.updateSelectionBox(rect);
    this._updateSelectedFromRect(rect);
  }

  /**
   * End selection and finalize selected objects
   * @param {MouseEvent} _e - Mouse event (unused but kept for consistency)
   */
  endSelection(_e) {
    if (!this.isSelecting) return;

    this.isSelecting = false;
    this.view.hideSelectionBox();

    console.log('[MassSelection] endSelection: selectedIds.size =', this.selectedIds.size);

    // If only 1 object selected → convert to single select
    if (this.selectedIds.size === 1) {
      const id = [...this.selectedIds][0];
      this.clear();
      this.interactionManager._select(id);
    } else if (this.selectedIds.size > 1) {
      // Deselect single selection if any
      if (this.interactionManager.selectedId) {
        this.interactionManager._deselect();
      }
      console.log('[MassSelection] Showing bounding box for', this.selectedIds.size, 'objects');
      this._updateBoundingBox();
    } else {
      console.log('[MassSelection] No objects selected, hiding bounding box');
      this.view.hideBoundingBox();
    }
  }

  /**
   * Calculate rect from two points (handles negative width/height)
   */
  _calculateRect(start, end) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    return { left, top, width, height };
  }

  /**
   * Update selected objects based on selection rect
   */
  _updateSelectedFromRect(screenRect) {
    const newSelectedIds = new Set();

    // Get all objects and check intersection
    for (const obj of this.registry.getAll()) {
      // Skip locked or frozen objects
      if (obj.frozen) {
        console.log('[MassSelection] Skipping frozen object:', obj.id.slice(-8));
        continue;
      }

      const container = this.layer?.getObjectContainer(obj.id);
      if (!container) {
        console.log('[MassSelection] No container for object:', obj.id.slice(-8));
        continue;
      }

      const containerRect = container.getBoundingClientRect();
      
      // Debug: log container rect
      if (containerRect.width === 0 || containerRect.height === 0) {
        console.log('[MassSelection] Zero-size container:', obj.id.slice(-8), containerRect);
      }

      // Check if container intersects with selection rect
      if (this._rectsIntersect(screenRect, {
        left: containerRect.left,
        top: containerRect.top,
        width: containerRect.width,
        height: containerRect.height
      })) {
        newSelectedIds.add(obj.id);
      }
    }

    // Update visual selection through Registry (shows standard selection border)
    // Use massSelected: true to show selection border but hide gizmos
    for (const id of this.selectedIds) {
      if (!newSelectedIds.has(id)) {
        // Deselect objects no longer in selection
        this.registry.update(id, { selected: false, massSelected: false }, 'local');
      }
    }
    for (const id of newSelectedIds) {
      if (!this.selectedIds.has(id)) {
        // Select new objects (massSelected = no gizmos)
        this.registry.update(id, { selected: true, massSelected: true }, 'local');
      }
    }

    this.selectedIds = newSelectedIds;
    this.view.updateIndicator(this.selectedIds.size);

    // Show individual overlays immediately during selection (not just at end)
    if (this.selectedIds.size > 0) {
      this.layer?.showMassSelectionOverlays(this.selectedIds);
    } else {
      this.layer?.hideMassSelectionOverlays();
    }
  }

  /**
   * Check if two rects intersect
   */
  _rectsIntersect(r1, r2) {
    return !(r1.left > r2.left + r2.width ||
             r1.left + r1.width < r2.left ||
             r1.top > r2.top + r2.height ||
             r1.top + r1.height < r2.top);
  }

  // ========== Bounding Box & Drag ==========

  /**
   * Check if point is inside bounding box
   * @param {number} screenX
   * @param {number} screenY
   * @returns {boolean}
   */
  isPointInsideBoundingBox(screenX, screenY) {
    if (this.selectedIds.size === 0) {
      console.log('[MassSelection] isPointInsideBoundingBox: no selected objects');
      return false;
    }
    if (!this.view.boundingBox || this.view.boundingBox.style.display === 'none') {
      console.log('[MassSelection] isPointInsideBoundingBox: no boundingBox or hidden', 
        this.view.boundingBox?.style.display);
      return false;
    }

    const rect = this.view.boundingBox.getBoundingClientRect();
    const isInside = screenX >= rect.left && screenX <= rect.right &&
           screenY >= rect.top && screenY <= rect.bottom;
    console.log('[MassSelection] isPointInsideBoundingBox:', isInside, 
      { screenX, screenY, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } });
    return isInside;
  }

  /**
   * Start mass drag operation
   * @param {MouseEvent} e
   */
  startMassDrag(e) {
    this.isDragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };

    // Save start positions from Registry (obj.x/obj.y)
    // These are the "base" positions that get saved to DB
    // Container position may differ (e.g. cropped images have offset)
    this.startPositions.clear();
    for (const id of this.selectedIds) {
      const obj = this.registry.get(id);
      if (obj) {
        this.startPositions.set(id, { x: obj.x, y: obj.y });
      }
    }

    // Disable Foundry select
    FoundryAPIAdapter.disableMassSelect();
  }

  /**
   * Update positions during mass drag
   * @param {MouseEvent} e
   */
  updateMassDrag(e) {
    if (!this.isDragging) return;

    // Calculate delta in world coordinates (accounting for zoom/pan)
    const delta = this._screenToWorldDelta(
      e.clientX - this.dragStart.x,
      e.clientY - this.dragStart.y
    );

    // Update DOM directly using Layer method (handles crop offset for images)
    for (const id of this.selectedIds) {
      const start = this.startPositions.get(id);
      if (!start) continue;

      const newX = start.x + delta.x;
      const newY = start.y + delta.y;
      
      // Use Layer's _updateDOMDuringDrag which handles crop offset correctly
      this.layer?._updateDOMDuringDrag(id, newX, newY);
    }

    this._updateBoundingBox();
  }

  /**
   * End mass drag and commit to Registry
   */
  endMassDrag() {
    if (!this.isDragging) return;

    this.isDragging = false;

    // Commit final positions to Registry
    // We saved start positions from Registry (obj.x/obj.y), so just add total delta
    for (const id of this.selectedIds) {
      const start = this.startPositions.get(id);
      if (!start) continue;
      
      const container = this.layer?.getObjectContainer(id);
      if (!container) continue;

      // Calculate total delta from container's current position vs start
      // For cropped images, container.style.left = obj.x + dims.left
      // So: currentContainerX - startContainerX = delta
      // And: newObjX = startObjX + delta
      const obj = this.registry.get(id);
      if (!obj) continue;
      
      // Get current container position
      const currentContainerX = parseFloat(container.style.left) || 0;
      const currentContainerY = parseFloat(container.style.top) || 0;
      
      // Calculate what the start container position was
      // For cropped images: startContainerX = startObjX + dims.left
      let startContainerX = start.x;
      let startContainerY = start.y;
      if (obj.type === 'image' && obj.crop) {
        const imageElement = container.querySelector('.wbe-canvas-image');
        if (imageElement) {
          const dims = this.layer?._calculateImageVisibleDimensions(imageElement, id);
          if (dims) {
            startContainerX = start.x + (dims.left || 0);
            startContainerY = start.y + (dims.top || 0);
          }
        }
      }
      
      // Delta = current - start (in container coordinates)
      const deltaX = currentContainerX - startContainerX;
      const deltaY = currentContainerY - startContainerY;
      
      // New obj position = start obj position + delta
      const x = Math.round(start.x + deltaX);
      const y = Math.round(start.y + deltaY);

      this.registry.update(id, { x, y }, 'local');
    }

    this.startPositions.clear();
    FoundryAPIAdapter.enableMassSelect();
  }

  /**
   * Convert screen delta to world delta (accounting for zoom/pan)
   */
  _screenToWorldDelta(screenDx, screenDy) {
    // Get current transform from layer
    const transform = this.layer?.currentTransform || { scale: 1 };
    const sensitivity = InteractionManager.MASS_DRAG_SENSITIVITY;
    return {
      x: (screenDx / transform.scale) * sensitivity,
      y: (screenDy / transform.scale) * sensitivity
    };
  }

  /**
   * Update bounding box based on current selected containers
   */
  _updateBoundingBox() {
    const containers = [];
    for (const id of this.selectedIds) {
      const container = this.layer?.getObjectContainer(id);
      if (container) containers.push(container);
    }
    this.view.updateBoundingBox(containers);
    
    // Show individual selection overlays for each mass-selected object
    if (this.selectedIds.size > 0) {
      this.layer?.showMassSelectionOverlays(this.selectedIds);
    } else {
      this.layer?.hideMassSelectionOverlays();
    }
  }

  // ========== Selection Management ==========

  /**
   * Toggle object selection
   * @param {string} id
   * @param {boolean} [forceState] - Force add (true) or remove (false)
   */
  toggleObject(id, forceState) {
    const shouldAdd = forceState !== undefined ? forceState : !this.selectedIds.has(id);

    if (shouldAdd) {
      this.selectedIds.add(id);
      this.registry.update(id, { selected: true, massSelected: true }, 'local');
    } else {
      this.selectedIds.delete(id);
      this.registry.update(id, { selected: false, massSelected: false }, 'local');
    }

    this.view.updateIndicator(this.selectedIds.size);
    this._updateBoundingBox();
  }

  /**
   * Select all objects
   */
  selectAll() {
    // Clear single selection first
    if (this.interactionManager.selectedId) {
      this.interactionManager._deselect();
    }

    for (const obj of this.registry.getAll()) {
      if (obj.frozen) continue;
      this.selectedIds.add(obj.id);
      this.registry.update(obj.id, { selected: true, massSelected: true }, 'local');
    }

    this.view.updateIndicator(this.selectedIds.size);
    this._updateBoundingBox();
  }

  /**
   * Clear all selection
   */
  clear() {
    for (const id of this.selectedIds) {
      this.registry.update(id, { selected: false, massSelected: false }, 'local');
    }
    this.selectedIds.clear();
    this.view.hideBoundingBox();
    this.view.updateIndicator(0);
    // Hide individual selection overlays
    this.layer?.hideMassSelectionOverlays();
  }

  /**
   * Delete all selected objects
   */
  deleteSelected() {
    if (this.selectedIds.size === 0) return;

    const idsToDelete = [...this.selectedIds];
    this.clear();

    for (const id of idsToDelete) {
      this.registry.unregister(id, 'local');
    }
  }

  // ========== Copy/Paste ==========

  /**
   * Copy selected objects to internal clipboard
   * NOTE: Uses internal clipboard only (like old code), not system clipboard
   */
  copySelected() {
    this.clipboard = [];
    for (const id of this.selectedIds) {
      const obj = this.registry.get(id);
      if (obj) {
        this.clipboard.push(obj.toJSON());
      }
    }
    console.log('[MassSelection] copySelected:', this.clipboard.length, 'objects copied to internal clipboard');
    if (this.clipboard.length > 0) {
      ui?.notifications?.info?.(`Copied ${this.clipboard.length} object(s)`);
    }
  }

  /**
   * Paste objects from clipboard
   */
  async paste() {
    console.log('[MassSelection] paste() called, clipboard.length:', this.clipboard.length);
    if (this.clipboard.length === 0) {
      console.log('[MassSelection] paste() - clipboard is empty, returning');
      return;
    }

    const offset = 20;
    const newIds = [];

    for (const data of this.clipboard) {
      const newId = `wbe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Remove old z-index related fields - registry.register() will assign new ones
      // eslint-disable-next-line no-unused-vars
      const { zIndex, rank, selected, massSelected, ...cleanData } = data;
      
      const newData = {
        ...cleanData,
        id: newId,
        x: data.x + offset,
        y: data.y + offset
      };

      // Create object based on type
      let obj;
      if (data.type === 'text') {
        obj = new WhiteboardText(newData);
      } else if (data.type === 'image') {
        obj = new WhiteboardImage(newData);
      }

      if (obj) {
        this.registry.register(obj, 'local');
        newIds.push(newId);
      }
    }

    // Select new objects
    this.clear();
    for (const id of newIds) {
      this.toggleObject(id, true);
    }

    ui?.notifications?.info?.(`Pasted ${newIds.length} object(s)`);
  }

  // ========== Keyboard Handling ==========

  /**
   * Handle keyboard events for mass selection
   * @param {KeyboardEvent} e
   * @returns {boolean} true if event was consumed
   */
  handleKeyDown(e) {
    // Use e.code for keyboard layout independence (works with any language)
    const code = e.code; // KeyC, KeyV, KeyA, Delete, Backspace
    console.log('[MassSelection] handleKeyDown called, code:', code, 'key:', e.key, 'ctrl:', e.ctrlKey, 'selectedIds:', this.selectedIds.size, 'clipboard:', this.clipboard.length);
    
    // Ctrl+V works even without selection (just needs clipboard)
    // Use code === 'KeyV' for keyboard layout independence
    if (code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
      if (this.clipboard.length > 0) {
        console.log('[MassSelection] handleKeyDown - Ctrl+V, pasting', this.clipboard.length, 'objects');
        e.preventDefault();
        e.stopPropagation();
        this.paste();
        return true;
      }
      console.log('[MassSelection] handleKeyDown - Ctrl+V but clipboard is empty');
      return false;
    }

    // All other shortcuts require selection
    if (this.selectedIds.size === 0) {
      console.log('[MassSelection] handleKeyDown - no selection, returning false');
      return false;
    }

    // Use e.code for keyboard layout independence
    if (code === 'Delete' || code === 'Backspace') {
      console.log('[MassSelection] handleKeyDown - Delete/Backspace');
      this.deleteSelected();
      return true;
    }
    
    if (code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
      console.log('[MassSelection] handleKeyDown - Ctrl+A');
      e.preventDefault();
      this.selectAll();
      return true;
    }
    
    if (code === 'KeyC' && (e.ctrlKey || e.metaKey)) {
      console.log('[MassSelection] handleKeyDown - Ctrl+C, copying', this.selectedIds.size, 'objects');
      e.preventDefault();
      e.stopPropagation();
      this.copySelected();
      console.log('[MassSelection] handleKeyDown - clipboard now has', this.clipboard.length, 'objects');
      return true;
    }

    // Z-index hotkeys: PageUp/PageDown or [ / ] - move group as unit
    // Shift = move to top/bottom
    const isPageUp = e.key === 'PageUp';
    const isPageDown = e.key === 'PageDown';
    const isBracketLeft = code === 'BracketLeft';  // [ key
    const isBracketRight = code === 'BracketRight'; // ] key
    
    if (isPageUp || isPageDown || isBracketLeft || isBracketRight) {
      e.preventDefault();
      e.stopPropagation();
      
      const isUp = isPageUp || isBracketRight; // ] or PageUp = move up
      const isToExtreme = e.shiftKey; // Shift = to top/bottom
      const ids = Array.from(this.selectedIds);
      
      if (isToExtreme) {
        // Shift + hotkey = move to top/bottom
        if (isUp) {
          const result = this.registry.moveZIndexGroupToTop(ids);
          console.log(`[MassSelection] Z-Index group moved to top`);
        } else {
          const result = this.registry.moveZIndexGroupToBottom(ids);
          console.log(`[MassSelection] Z-Index group moved to bottom`);
        }
      } else {
        // Without Shift = move one step
        if (isUp) {
          const result = this.registry.moveZIndexGroupUp(ids);
          console.log(`[MassSelection] Z-Index group moved up:`, result.atBoundary ? 'at top' : 'success');
        } else {
          const result = this.registry.moveZIndexGroupDown(ids);
          console.log(`[MassSelection] Z-Index group moved down:`, result.atBoundary ? 'at bottom' : 'success');
        }
      }
      return true;
    }

    return false;
  }
}

/**
 * MassSelectionToolInjector - Injects mass selection toggle into Foundry UI
 * Supports Foundry v10-12 (getSceneControlButtons) and v13+ (direct injection)
 */
class MassSelectionToolInjector {
  static TOOL_NAME = 'wbeMassSelection';
  static STORAGE_KEY = 'wbe-mass-selection-toggle';
  static _controller = null;
  static _hookRegistered = false;

  /**
   * Get Foundry major version
   * @returns {number}
   */
  static _getMajorVersion() {
    return parseInt(game.version?.split('.')[0] || '0');
  }

  /**
   * Register hook to inject button (called once)
   * @param {MassSelectionController} massSelectionController
   */
  static register(massSelectionController) {
    if (this._hookRegistered) return;
    
    this._controller = massSelectionController;
    this._controller.toggleMode = this.getToggleState();
    
    const majorVersion = this._getMajorVersion();
    console.log(`[MassSelectionToolInjector] Foundry v${majorVersion} detected`);
    
    if (majorVersion >= 13) {
      // Foundry v13+: direct injection into ui.controls.controls.tokens
      this._injectV13();
    } else {
      // Foundry v10-12: use getSceneControlButtons hook
      Hooks.on('getSceneControlButtons', (controls) => {
        this._injectButtonLegacy(controls);
      });
    }
    
    this._hookRegistered = true;
    console.log('[MassSelectionToolInjector] Hook registered');
    
    // Force re-render if controls already exist
    ui?.controls?.render?.();
  }

  /**
   * Inject button for Foundry v13+ (direct object injection)
   */
  static _injectV13() {
    const tokensCtrl = ui.controls?.controls?.tokens;
    if (!tokensCtrl) {
      console.warn('[MassSelectionToolInjector] tokens control not found');
      return;
    }
    
    // Check if already injected
    if (tokensCtrl.tools?.[this.TOOL_NAME]) return;
    
    const isOn = this.getToggleState();
    
    tokensCtrl.tools[this.TOOL_NAME] = {
      name: this.TOOL_NAME,
      title: this._getTitle(isOn),
      icon: 'fa-solid fa-vector-square',
      toggle: true,
      active: isOn,
      onChange: (event, active) => this._handleToggleV13(active)
    };
    
    console.log('[MassSelectionToolInjector] Button injected (v13)');
  }

  /**
   * Inject button for Foundry v10-12 (legacy array-based)
   * @param {Array} controls - Array of control groups
   */
  static _injectButtonLegacy(controls) {
    if (!this._controller) return;
    if (!Array.isArray(controls)) return;

    // Find token controls group (v10-12 uses 'token', not 'tokens')
    const tokenGroup = controls.find(g => g.name === 'token');
    if (!tokenGroup) {
      console.warn('[MassSelectionToolInjector] Token group not found');
      return;
    }

    // Check if already injected
    if (tokenGroup.tools?.some(t => t.name === this.TOOL_NAME)) return;

    const isOn = this.getToggleState();

    const tool = {
      name: this.TOOL_NAME,
      title: this._getTitle(isOn),
      icon: 'fas fa-vector-square',
      button: true,
      active: isOn,
      onClick: () => this._handleToggleLegacy()
    };

    // Add at the beginning of tools
    tokenGroup.tools = tokenGroup.tools || [];
    tokenGroup.tools.unshift(tool);
    console.log('[MassSelectionToolInjector] Button injected (legacy)');
  }

  /**
   * Handle toggle for v13+ (receives active state directly)
   * @param {boolean} active
   */
  static _handleToggleV13(active) {
    this.saveToggleState(active);
    
    if (this._controller) {
      this._controller.setToggleMode(active);
      this._controller.clear();
    }
    
    // Update title
    const tokensCtrl = ui.controls?.controls?.tokens;
    if (tokensCtrl?.tools?.[this.TOOL_NAME]) {
      tokensCtrl.tools[this.TOOL_NAME].title = this._getTitle(active);
    }

    ui?.notifications?.info?.(active 
      ? 'WBE Mass Selection: ON (drag to select)' 
      : 'WBE Mass Selection: OFF (Shift+drag)');
  }

  /**
   * Handle toggle for v10-12 (legacy onClick)
   */
  static _handleToggleLegacy() {
    const newState = !this.getToggleState();
    this.saveToggleState(newState);
    
    if (this._controller) {
      this._controller.setToggleMode(newState);
      this._controller.clear();
    }

    // Re-render to update button state
    ui?.controls?.render?.(true);

    ui?.notifications?.info?.(newState 
      ? 'WBE Mass Selection: ON (drag to select)' 
      : 'WBE Mass Selection: OFF (Shift+drag)');
  }

  /**
   * Get button title based on state
   * @param {boolean} isOn
   * @returns {string}
   */
  static _getTitle(isOn) {
    return isOn 
      ? 'WBE Mass Selection: ON (drag to select)' 
      : 'WBE Mass Selection: OFF (Shift+drag)';
  }

  /**
   * Get toggle state from localStorage
   * @returns {boolean}
   */
  static getToggleState() {
    return localStorage.getItem(this.STORAGE_KEY) === 'true';
  }

  /**
   * Save toggle state to localStorage
   * @param {boolean} state
   */
  static saveToggleState(state) {
    localStorage.setItem(this.STORAGE_KEY, state.toString());
  }
}

// ==========================================
// 5. Interaction Manager (Controller)
// ==========================================
class InteractionManager {
  // Constants for scale (different speeds for text and images due to different scaling mechanisms)
  static SCALE_SENSITIVITY_TEXT = 0.015; // Scale change speed for texts (transform: scale())
  static SCALE_SENSITIVITY_IMAGE = 0.015; // Scale change speed for images (width/height)
  static MIN_SCALE = 0.1; // Minimum scale
  static MAX_SCALE = 20.0; // Maximum scale

  // Constants for mass selection operations
  static MASS_DRAG_SENSITIVITY = 1.0; // Sensitivity for mass drag (1.0 = 1:1 movement)
  static KEYBOARD_MOVE_STEP = 1; // Normal step for arrow keys (1px)
  static KEYBOARD_MOVE_STEP_LARGE = 10; // Large step with Shift held (10px)
  static DUPLICATE_OFFSET = 20; // Offset for duplicated objects (px)

  constructor(registry, layer = null) {
    this.registry = registry;
    this.layer = layer; // Reference to Layer for drag state management
    this.mode = 'select';
    this.selectedId = null;
    this.editingId = null; // ID of the text being edited (single source of truth)
    this.dragState = null; // { id, startX, startY, objStartX, objStartY }
    this.panState = null; // { startX, startY, pivotX, pivotY }
    this.widthResizeState = null; // { id, startX, startWidth }
    this.scaleResizeState = null; // { id, startX, startScale, currentScale }
    this.unfreezeHoldState = null; // { iconElement, containerId, imageId, holdTimer, startTime }

    // Store socketController for text lock/unlock (will be set later via setSocketController)
    this.socketController = null;

    // Universal panels interface (DRY: extensible architecture for panels)
    // When adding a new object type - just add the panel here
    this.panels = {
      text: new TextStylingPanel(registry, layer),
      image: new ImageControlPanel(registry, layer, this, this.socketController)
    };

    // Backward compatibility: keep stylingPanel for gradual migration
    this.stylingPanel = this.panels.text;
    this._wheelRestoreTimeout = null; // Timeout for restoring pointer events after zoom

    // Copy/Paste state (architecturally correct - here where object management is)
    // Tools can access copied objects via InteractionManager
    this.copiedObjectData = null; // { type, data } - unified storage for any objects

    // Last mouse position (for paste - center under cursor)
    this.lastMouseX = null;
    this.lastMouseY = null;

    // Set drag state checker in Registry to protect object styles during drag
    // Similar to editingId protection - creates "lock state" for drag
    this.registry.setDragStateChecker(id => {
      return this.dragState?.id === id;
    });

    // Store bound handlers for cleanup
    this._boundHandlers = {
      mousedown: null,
      mousemove: null,
      mouseup: null,
      wheel: null,
      click: null,
      dblclick: null,
      keydown: null
    };

    // Mass selection controller (will be initialized in init())
    this.massSelection = null;

    // Handler-based event system (declarative architecture)
    // HandlerResolver manages event handlers by priority
    this.mouseDownResolver = new HandlerResolver();
  }
  
  /**
   * Set socket controller reference (called after socket is created)
   * @param {SocketController} socketController - Socket controller instance
   */
  setSocketController(socketController) {
    this.socketController = socketController;
    // Also update ImageControlPanel's socket reference
    if (this.panels.image) {
      this.panels.image.socketController = socketController;
    }
  }
  
  init() {
    // Initialize mass selection
    const massSelectionView = new MassSelectionView(this.layer);
    massSelectionView.createElements();
    this.massSelection = new MassSelectionController(this.registry, this.layer, massSelectionView, this);

    // Register all mousedown handlers with HandlerResolver
    this._registerMouseDownHandlers();

    // Use capture phase to intercept events before Foundry
    // Store bound handlers for cleanup
    this._boundHandlers.mousedown = this._handleMouseDown.bind(this);
    this._boundHandlers.mousemove = this._handleMouseMove.bind(this);
    this._boundHandlers.mouseup = this._handleMouseUp.bind(this);
    this._boundHandlers.wheel = this._handleWheel.bind(this);
    this._boundHandlers.click = this._handleClick.bind(this);
    this._boundHandlers.dblclick = this._handleDblClick.bind(this);
    this._boundHandlers.keydown = this._handleKeyDown.bind(this);
    this._boundHandlers.copy = this._handleCopy.bind(this);
    this._boundHandlers.paste = this._handlePaste.bind(this);
    window.addEventListener('mousedown', this._boundHandlers.mousedown, true);
    window.addEventListener('mousemove', this._boundHandlers.mousemove, true);
    window.addEventListener('mouseup', this._boundHandlers.mouseup, true);
    window.addEventListener('wheel', this._boundHandlers.wheel, {
      capture: true,
      passive: true
    });
    window.addEventListener('click', this._boundHandlers.click, true);
    window.addEventListener('dblclick', this._boundHandlers.dblclick, true);
    window.addEventListener('keydown', this._boundHandlers.keydown, true);
    // CRITICAL: Listen to copy/paste on window with capture to intercept all events
    window.addEventListener('copy', this._boundHandlers.copy, true);
    window.addEventListener('paste', this._boundHandlers.paste, true);
  }
  /**
   * Register all mousedown handlers with HandlerResolver
   * Handlers are registered in descending priority order for readability
   * 
   * Priority Map (MouseDown):
   * HIGH PRIORITY (1000-800):
   * - 1000: PanelImmunityHandler - Clicks on styling panels
   * - 900: EditImmunityHandler - Clicks on contenteditable elements
   * - 800: RightClickHandler - Right mouse button - pan or exit text mode
   * 
   * MEDIUM PRIORITY (700-550):
   * - 700: MassSelectionDragHandler - Drag inside mass selection bounding box
   * - 695: MassSelectionClearHandler - Click outside mass selection bounding box
   * - 650: MassSelectionStartHandler - Start mass selection (Shift+drag or toggle mode)
   * - 600: TextModeCreateHandler - Create text in text mode
   * - 550: UnfreezeIconHandler - Click on unfreeze icon
   * 
   * LOW PRIORITY (500-100):
   * - 500: WidthResizeHandler - Text width resize handle
   * - 450: CropHandleHandler - Image crop handles (rect and circle)
   * - 400: ScaleHandleHandler - Scale resize handle
   * - 350: CircleCropDragHandler - Drag image inside circle crop
   * - 300: ObjectDragHandler - Regular object drag
   * - 100: CanvasDeselectHandler - Click on empty canvas
   * 
   * Requirements: 5.1, 5.3
   * @private
   */
  _registerMouseDownHandlers() {
    const handlers = getAllMouseDownHandlers();
    
    // Register all handlers with the resolver
    // Handlers are already sorted by priority in the module
    for (const handler of handlers) {
      this.mouseDownResolver.register('mousedown', handler);
    }
    
    console.log(`[InteractionManager] Registered ${handlers.length} mousedown handlers`);
  }

  cleanup() {
    // Remove all event listeners
    if (this._boundHandlers.mousedown) {
      window.removeEventListener('mousedown', this._boundHandlers.mousedown, true);
    }
    if (this._boundHandlers.mousemove) {
      window.removeEventListener('mousemove', this._boundHandlers.mousemove, true);
    }
    if (this._boundHandlers.mouseup) {
      window.removeEventListener('mouseup', this._boundHandlers.mouseup, true);
    }
    if (this._boundHandlers.wheel) {
      window.removeEventListener('wheel', this._boundHandlers.wheel, {
        capture: true
      });
    }
    if (this._boundHandlers.click) {
      window.removeEventListener('click', this._boundHandlers.click, true);
    }
    if (this._boundHandlers.dblclick) {
      window.removeEventListener('dblclick', this._boundHandlers.dblclick, true);
    }
    if (this._boundHandlers.keydown) {
      window.removeEventListener('keydown', this._boundHandlers.keydown, true);
    }
    if (this._boundHandlers.copy) {
      window.removeEventListener('copy', this._boundHandlers.copy, true);
    }
    if (this._boundHandlers.paste) {
      window.removeEventListener('paste', this._boundHandlers.paste, true);
    }

    // Exit text mode if active
    if (this.mode === 'text') {
      this._exitTextMode();
    }

    // Clear handlers
    this._boundHandlers = {
      mousedown: null,
      mousemove: null,
      mouseup: null,
      wheel: null,
      click: null,
      dblclick: null,
      keydown: null,
      copy: null,
      paste: null
    };

    // Cleanup styling panel
    if (this.stylingPanel) {
      this._hideAllPanels();
    }

    // Clear wheel restore timeout
    if (this._wheelRestoreTimeout) {
      clearTimeout(this._wheelRestoreTimeout);
      this._wheelRestoreTimeout = null;
    }

    // Restore pointer events before cleanup
    this._setPointerEvents(true);

    // Clear state
    this.selectedId = null;
    this.dragState = null;
    this.panState = null;
    this.widthResizeState = null;
    this.scaleResizeState = null;
    this.scaleResizeState = null;
  }

  /**
   * Get all object states in one place
   * DRY: DRY: single source of truth for all states
   */
  getObjectState(id) {
    return {
      isDragging: this.dragState?.id === id,
      isEditing: this.editingId === id,
      isSelected: this.selectedId === id,
      isResizing: this.widthResizeState?.id === id || this.scaleResizeState?.id === id,
      isPanning: this.panState !== null
    };
  }

  /**
   * Convenient methods for frequent checks (KISS: simple methods) (KISS: simple methods)
   */
  isDragging(id) {
    return this.dragState?.id === id;
  }
  isScaling(id) {
    return this.scaleResizeState?.id === id;
  }
  isCroppingDrag(id) {
    return this.cropDragState?.id === id;
  }
  isEditing(id) {
    return this.editingId === id;
  }
  isSelected(id) {
    return this.selectedId === id;
  }

  /**
   * Composite check: whether object styles can be updated: whether object styles can be updated
   * DRY: DRY: all checks in one place
   */
  canUpdateStyles(id) {
    const state = this.getObjectState(id);
    return !state.isDragging && !state.isEditing && !state.isResizing;
  }

  /**
   * Whether the object position can be updated
   * Position Position can always be updated (even during drag) (even during drag drag)
   */
  canUpdatePosition(_id) {
    return true;
  }
  setMode(mode) {
    // Finish editing when switching modes
    if (this.editingId) {
      this._endEditText(this.editingId);
    }
    this.mode = mode;
  }
  _enterTextMode() {
    if (this.mode === 'text') return;
    
    // Check if texts are enabled
    if (!isFeatureEnabled('texts')) {
      ui?.notifications?.warn?.('Text objects are disabled in module settings');
      return;
    }
    
    this.setMode('text');

    // Apply text cursor to canvas AND whiteboard layer using CSS class
    // This ensures cursor is not overridden by child elements
    const board = document.getElementById('board');
    if (board) {
      board.classList.add('wbe-text-mode');
    }
    // Also add to layer (layer is sibling of board, not child)
    if (this.layer?.element) {
      this.layer.element.classList.add('wbe-text-mode');
    }
  }
  _exitTextMode() {
    if (this.mode !== 'text') return;
    this.setMode('select');

    // Remove text mode class from both board and layer
    const board = document.getElementById('board');
    if (board) {
      board.classList.remove('wbe-text-mode');
    }
    if (this.layer?.element) {
      this.layer.element.classList.remove('wbe-text-mode');
    }
  }

  // --- Event Handlers ---

  _handleKeyDown(e) {
    // PRIORITY 1: Mass Selection keyboard shortcuts
    // Must be BEFORE single-object handling!
    if (this.massSelection) {
      const code = e.code;
      const isCtrl = e.ctrlKey || e.metaKey;
      
      // Ctrl+C/Delete/Backspace/Ctrl+A: only if mass selection is ACTIVE (has selected objects)
      // Ctrl+V: only if mass selection clipboard has data
      const hasMassSelection = this.massSelection.selectedIds.size > 0;
      const hasMassClipboard = this.massSelection.clipboard.length > 0;
      
      // Z-index hotkeys for mass selection
      const isZIndexKey = e.key === 'PageUp' || e.key === 'PageDown' || 
                          code === 'BracketLeft' || code === 'BracketRight';
      
      const shouldHandleMassSelection = 
        (hasMassSelection && (code === 'KeyC' || code === 'KeyA' || code === 'Delete' || code === 'Backspace') && isCtrl) ||
        (hasMassSelection && (code === 'Delete' || code === 'Backspace')) ||
        (hasMassSelection && isZIndexKey) ||
        (hasMassClipboard && code === 'KeyV' && isCtrl);
      
      if (shouldHandleMassSelection) {
        console.log('[InteractionManager] _handleKeyDown - delegating to massSelection.handleKeyDown', { code, hasMassSelection, hasMassClipboard });
        if (this.massSelection.handleKeyDown(e)) {
          return;
        }
      }
    }

    // PRIORITY 2: Ctrl+C / Cmd+C to copy single selected object
    // Use e.code for keyboard layout independence!
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
      const target = e.target;
      
      // CRITICAL: Only intercept if focus is on whiteboard or body
      // If user is copying from external elements (browser, other UI), let browser handle it
      const isWhiteboardTarget = target === document.body || 
                                  target.closest('#board') || 
                                  target.closest('.wbe-text-container') ||
                                  target.closest('.wbe-image-container') ||
                                  target.closest('.wbe-whiteboard-layer');
      
      if (!isWhiteboardTarget) {
        console.log('[InteractionManager] Ctrl+C ignored - target is external element:', target.tagName, target.className);
        return; // Let browser handle external copy
      }
      
      // Ignore if text is being edited
      const isEditable = target.isContentEditable || target.getAttribute('contenteditable') === 'true' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isEditable) {
        return; // Let the browser handle text copying
      }

      // Copy only if there is a selected object
      if (!this.selectedId) {
        return;
      }

      // CRITICAL: Clear mass selection clipboard when copying single object
      // This prevents mass clipboard from blocking future paste operations
      if (this.massSelection) {
        this.massSelection.clipboard = [];
      }

      // CRITICAL: Browser does not automatically fire copy event for our objects
      // Use direct call to copy logic
      e.preventDefault();
      e.stopPropagation();
      
      console.log('[InteractionManager] Ctrl+C intercepted for single object:', this.selectedId);
      
      // Direct copy (execCommand for text, Clipboard API for images)
      this._copyToClipboardDirect();
      return;
    }

    // T key to toggle text mode (keyCode 84 for international support)
    if (e.keyCode === 84 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Ignore T-key when user is editing text
      const target = e.target;
      const isEditable = target.isContentEditable || target.getAttribute('contenteditable') === 'true' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isEditable) {
        return;
      }

      // Also check selected text element
      if (this.selectedId) {
        const textSpan = this.layer?.getTextSpan(this.selectedId);
        if (textSpan?.contentEditable === 'true') {
          return;
        }
      }
      e.preventDefault();
      if (this.mode === 'text') {
        this._exitTextMode();
      } else {
        this._enterTextMode();
      }
      return;
    }

    // Delete/Backspace key to delete selected object
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Ignore Delete/Backspace when user is editing text
      const target = e.target;
      const isEditable = target.isContentEditable || target.getAttribute('contenteditable') === 'true' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isEditable) {
        return;
      }

      // Also check selected text element - don't delete if editing
      if (this.selectedId) {
        const textSpan = this.layer?.getTextSpan(this.selectedId);
        if (textSpan?.contentEditable === 'true') {
          return;
        }

        // Check if object is being edited (editingId check)
        if (this.editingId === this.selectedId) {
          return;
        }

        // Delete the selected object
        e.preventDefault();
        e.stopPropagation();
        const idToDelete = this.selectedId;
        this._deselect(); // Clear selection first
        this.registry.unregister(idToDelete, 'local'); // Delete object (socket will broadcast automatically)
      }
    }

    // Z-Index control: PgUp/PgDown or [ / ] = move layer up/down
    // Shift + PgUp/PgDown = move to top/bottom
    // Use e.code for physical key codes (works with any keyboard layout)
    // e.key for PageUp/PageDown (special keys, same across layouts)
    const isPageUp = e.key === 'PageUp';
    const isPageDown = e.key === 'PageDown';
    const isBracketLeft = e.code === 'BracketLeft';  // [ key (physical position)
    const isBracketRight = e.code === 'BracketRight'; // ] key (physical position)
    
    if (isPageUp || isPageDown || isBracketLeft || isBracketRight) {
      // Ignore if editing text
      const target = e.target;
      const isEditable = target && typeof target.getAttribute === 'function' && (
        target.isContentEditable || 
        target.getAttribute('contenteditable') === 'true' || 
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA'
      );
      if (isEditable) {
        return;
      }

      // Only if object is selected
      if (!this.selectedId) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const isUp = isPageUp || isBracketRight; // ] or PageUp = move up
      const isToExtreme = e.shiftKey; // Shift = to top/bottom

      if (isToExtreme) {
        // Shift + PgUp/PgDown = move to top/bottom
        if (isUp) {
          const result = this.registry.moveZIndexToTop(this.selectedId);
          console.log(`[Z-Index] Moved to top: ${this.selectedId.slice(-8)}, z-index: ${result.newZIndex}`);
        } else {
          const result = this.registry.moveZIndexToBottom(this.selectedId);
          console.log(`[Z-Index] Moved to bottom: ${this.selectedId.slice(-8)}, z-index: ${result.newZIndex}`);
        }
      } else {
        // PgUp/PgDown or [ / ] = move one step
        if (isUp) {
          const result = this.registry.moveZIndexUp(this.selectedId);
          if (result.success && !result.atBoundary) {
            console.log(`[Z-Index] Moved up: ${this.selectedId.slice(-8)}, new z-index: ${result.newZIndex}`);
          } else if (result.atBoundary) {
            console.log(`[Z-Index] Already at top: ${this.selectedId.slice(-8)}`);
          }
        } else {
          const result = this.registry.moveZIndexDown(this.selectedId);
          if (result.success && !result.atBoundary) {
            console.log(`[Z-Index] Moved down: ${this.selectedId.slice(-8)}, new z-index: ${result.newZIndex}`);
          } else if (result.atBoundary) {
            console.log(`[Z-Index] Already at bottom: ${this.selectedId.slice(-8)}`);
          }
        }
      }
      return;
    }
  }
  /**
   * Handle mousedown events using HandlerResolver
   * 
   * This method delegates event handling to registered handlers via HandlerResolver.
   * Handlers are processed in priority order (descending) until one handles the event.
   * 
   * Requirements: 5.1
   * @param {MouseEvent} e - Mouse event
   * @private
   */
  _handleMouseDown(e) {
    try {
      // Create EventContext for unified access to event data
      const ctx = new EventContext(e, this);
      
      // Execute handlers through resolver
      // Resolver will find first matching handler and execute it
      const handled = this.mouseDownResolver.execute('mousedown', ctx);
      
      // Log for debugging (can be removed in production)
      if (!handled) {
        console.log('[InteractionManager] No handler matched for mousedown event');
      }
    } catch (error) {
      console.error(`[InteractionManager._handleMouseDown] Error:`, error);
      throw error;
    }
  }
  _handleMouseMove(e) {
    // Save mouse position for paste (center under cursor)
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    // Handle unfreeze icon hover effects
    this._handleUnfreezeIconHover(e);

    // Handle Pan
    if (this.panState && e.buttons & 2) {
      // Right button held
      this._updatePan(e);
      return;
    }

    // Handle Mass Selection (selection box or mass drag)
    if (this.massSelection) {
      if (this.massSelection.isSelecting) {
        e.preventDefault();
        e.stopPropagation();
        this.massSelection.updateSelection(e);
        return;
      }
      if (this.massSelection.isDragging) {
        e.preventDefault();
        e.stopPropagation();
        this.massSelection.updateMassDrag(e);
        return;
      }
    }

    // Handle Crop Drag (priority over scale resize)
    if (this.cropDragState) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._updateCropDrag(e);
      return;
    }

    // Handle Scale Resize (priority over width resize)
    if (this.scaleResizeState) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._updateScaleResize(e);
      return;
    }

    // Handle Width Resize (priority over drag)
    if (this.widthResizeState) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._updateWidthResize(e);
      return;
    }

    // Handle Drag
    if (this.dragState) {
      this._updateDrag(e);
      return;
    }

    // Update cursor for text border resize (only if no active operations)
    this._updateTextBorderCursor(e);
  }
  _updateTextBorderCursor(e) {
    if (!this.layer) return;

    // Don't change cursor if resize operations are active
    if (this.widthResizeState || this.scaleResizeState) {
      return;
    }

    // Don't change cursor if text mode is active
    if (this.mode === 'text') {
      this.layer.applyBoardCursor('text');
      return;
    }

    // Only show resize cursor if text is selected
    if (!this.selectedId) {
      this.layer.applyBoardCursor('');
      return;
    }
    const obj = this.registry.get(this.selectedId);
    if (!obj || obj.type !== 'text') {
      this.layer.applyBoardCursor('');
      return;
    }
    
    // Check if text is being edited
    const textSpan = this.layer.getTextSpan(this.selectedId);
    if (textSpan?.contentEditable === 'true') {
      this.layer.applyBoardCursor('');
      return;
    }
    
    // Use SVG selection overlay for resize detection
    // Note: We use the SVG element itself (not the rect inside) because SVG rect's getBoundingClientRect
    // may not work correctly. The SVG has CSS width/height that match the selection rect dimensions.
    const selectionOverlay = this.layer._selectionOverlay;
    if (!selectionOverlay || selectionOverlay.style.display === 'none') {
      this.layer.applyBoardCursor('');
      return;
    }
    
    // Get bounding rect of the SVG element (CSS dimensions match the selection rect)
    const rect = selectionOverlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    // Fixed threshold in screen pixels (getBoundingClientRect already accounts for transform: scale)
    // Size of resize area should NOT change with object scale - always 8 pixels
    const BORDER_THRESHOLD = 8; // Fixed threshold in screen pixels

    // Check if mouse is over the selection border horizontally
    if (x < 0 || x > width) {
      this.layer.applyBoardCursor('');
      return;
    }

    // Check if mouse is near right border only (fixed threshold, independent of object scale)
    if (x >= width - BORDER_THRESHOLD) {
      this.layer.applyBoardCursor('ew-resize');
    } else {
      this.layer.applyBoardCursor('');
    }
  }
  _handleMouseUp(e) {
    // Handle unfreeze icon mouse up (must be checked before other operations)
    if (this.unfreezeHoldState && e.button === 0) {
      this._handleUnfreezeIconMouseUp(e);
      return;
    }

    // Exit text mode on right click (if not dragging/panning)
    if (this.mode === 'text' && e.button === 2 && !this.panState && !this.dragState) {
      this._exitTextMode();
      return;
    }

    // Handle Mass Selection end
    if (this.massSelection) {
      if (this.massSelection.isSelecting) {
        this.massSelection.endSelection(e);
        return;
      }
      if (this.massSelection.isDragging) {
        this.massSelection.endMassDrag();
        return;
      }
    }

    if (this.panState) {
      this._endPan();
    }
    if (this.cropDragState) {
      this._endCropDrag();
    }
    if (this.scaleResizeState) {
      this._endScaleResize();
    }
    if (this.widthResizeState) {
      this._endWidthResize();
    }
    if (this.dragState) {
      this._endDrag();
    }
  }

  /**
   * Handle mousedown on unlock icon (hold-to-activate) (hold-to-activate)
   * Architecturally correct: all events handled via InteractionManager: all events handled via InteractionManager InteractionManager
   */
  _handleUnfreezeIconMouseDown(iconElement, e) {
    if (!iconElement || e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Find container and image ID from icon element
    const container = iconElement.closest('.wbe-image-container');
    if (!container) return;

    const imageId = container.id;
    const obj = this.registry.get(imageId);
    if (!obj || !obj.frozen) return;

    // Start hold-to-activate
    const HOLD_DURATION = 1000; // 1 second
    const holdTimer = setTimeout(() => {
      // Check current frozen state from Registry
      const currentObj = this.registry.get(imageId);
      if (this.unfreezeHoldState && currentObj && currentObj.frozen) {
        // Hold completed - unfreeze
        this._completeUnfreezeHold(imageId);
      }
    }, HOLD_DURATION);

    this.unfreezeHoldState = {
      iconElement,
      containerId: imageId,
      imageId,
      holdTimer,
      startTime: Date.now()
    };

    // Update visual state through Layer
    if (this.layer) {
      this.layer._setUnfreezeIconActive(iconElement, true);
    }
  }

  /**
   * Handle mouseup on unlock icon (cancel hold)
   */
  _handleUnfreezeIconMouseUp(e) {
    if (!this.unfreezeHoldState || e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    this._cancelUnfreezeHold();
  }

  /**
   * Handle mouseleave on unlock icon (cancel hold)
   */
  _handleUnfreezeIconMouseLeave(iconElement) {
    if (!this.unfreezeHoldState) return;
    if (iconElement && this.unfreezeHoldState.iconElement !== iconElement) return;

    this._cancelUnfreezeHold();
  }

  /**
   * Handle hover effects for unlock icon and mouseleave mouseleave
   */
  _handleUnfreezeIconHover(e) {
    const hoveredElement = e.target;
    const unfreezeIcon = hoveredElement.closest('.wbe-unfreeze-icon');
    
    if (unfreezeIcon && this.layer) {
      // Mouse is over the icon
      const isHolding = this.unfreezeHoldState && this.unfreezeHoldState.iconElement === unfreezeIcon;
      this.layer._setUnfreezeIconHover(unfreezeIcon, true, isHolding);
    } else if (this.layer && this.unfreezeHoldState) {
      // Mouse left the icon - cancel hold if active
      const wasHovering = e.target.closest('.wbe-unfreeze-icon') === null;
      if (wasHovering) {
        this.layer._setUnfreezeIconHover(this.unfreezeHoldState.iconElement, false, false);
        // Cancel hold if mouse left the icon
        this._handleUnfreezeIconMouseLeave(this.unfreezeHoldState.iconElement);
      }
    }
  }

  /**
   * Cancel hold-to-activate
   */
  _cancelUnfreezeHold() {
    if (!this.unfreezeHoldState) return;

    const { iconElement, holdTimer } = this.unfreezeHoldState;

    if (holdTimer) {
      clearTimeout(holdTimer);
    }

    // Update visual state through Layer
    if (this.layer && iconElement) {
      this.layer._setUnfreezeIconActive(iconElement, false);
    }

    this.unfreezeHoldState = null;
  }

  /**
   * Complete hold-to-activate and unlock image hold-to-activate and unlock image
   */
  _completeUnfreezeHold(imageId) {
    if (!this.unfreezeHoldState) return;

    const { containerId } = this.unfreezeHoldState;

    // Clear state
    this._cancelUnfreezeHold();

    // Unfreeze through Layer (which will update Registry)
    if (this.layer) {
      this.layer._handleUnfreezeAction(
        this.layer.getObjectContainer(containerId),
        imageId
      );
    }
  }
  _handleWheel(_e) {
    // Hide styling panel during zoom (standardized for all object types)
    if (this.selectedId) {
      this._hideAllPanels();
    }

    // Temporarily disable pointer events to allow zoom through objects
    this._setPointerEvents(false);

    // Restore pointer events after a short delay (debounce)
    clearTimeout(this._wheelRestoreTimeout);
    this._wheelRestoreTimeout = setTimeout(() => {
      this._setPointerEvents(true);

      // Show styling panel after zoom if object is still selected (standardized for all object types)
      if (this.selectedId) {
        const obj = this.registry.get(this.selectedId);
        if (obj) {
          requestAnimationFrame(() => {
            if (this.selectedId) {
              const selectedObj = this.registry.get(this.selectedId);
              if (selectedObj) {
                this._showPanelForObject(selectedObj);
              }
            }
          });
        }
      }
    }, 150);

    // Don't preventDefault - let Foundry handle zoom
  }
  _handleClick(e) {
    // Handle panel closing (architectural fix: centralized event handling)
    // Check if styling panel is open and should be closed
    if (this.stylingPanel.panel) {
      const isClickInsidePanel = this.stylingPanel.isClickInside(e);
      if (!isClickInsidePanel) {
        // Click is outside panel - check if it's inside the text object
        const textId = this.stylingPanel.getTextId();
        const hitResult = this._hitTest(e.clientX, e.clientY);
        const clickedInsideText = hitResult.type === 'object' && hitResult.object?.id === textId;

        // Close subpanel if open
        if (this.stylingPanel.view?.activeSubpanel) {
          this.stylingPanel.closeSubpanel();
        }

        // Close main panel only if clicking outside both panel and text
        if (!clickedInsideText) {
          this._hideAllPanels();
        }
      }
    }
  }
  _handleDblClick(e) {
    // Handle Text Editing (double click on text object)
    const target = this._hitTest(e.clientX, e.clientY);
    if (target.type === 'object' && target.object) {
      const obj = target.object;
      // Polymorphic call: check if object is editable
      if (obj.canEdit && obj.canEdit()) {
        this._startEditText(obj.id);
      }
    }
  }

  /**
   * Start drag rect crop handle (top, right, bottom, left) drag rect crop handle (top, right, bottom, left)
   * @param {string} id - ID images
   * @param {string} direction - Direction ('top', 'right', 'bottom', 'left')
   * @param {Event} e - Mouse event
   */
  _startCropRectDrag(id, direction, e) {
    const obj = this.registry.get(id);
    if (!obj || obj.type !== 'image' || !obj.isCropping) return;

    // Hide styling panel during crop drag
    this._hideAllPanels();

    // Disable Foundry mass-select controls during crop drag
    FoundryAPIAdapter.disableMassSelect();

    const startCrop = obj.crop[direction] || 0;
    const startPos = direction === 'top' || direction === 'bottom' ? e.clientY : e.clientX;

    // DEBUG: Log crop drag start
    const container = this.layer?.getObjectContainer(id);
    const imageElement = this.layer?.getImageElement(id);
    const imageWrapper = container?.querySelector('.wbe-image-wrapper');
    console.log('[CROP DEBUG] START:', {
      direction,
      startCrop,
      objCrop: { ...obj.crop },
      objXY: { x: obj.x, y: obj.y },
      scale: obj.scale,
      baseSize: { w: obj.baseWidth, h: obj.baseHeight },
      containerStyle: container ? { left: container.style.left, top: container.style.top, width: container.style.width, height: container.style.height } : null,
      wrapperStyle: imageWrapper ? { left: imageWrapper.style.left, top: imageWrapper.style.top, width: imageWrapper.style.width, height: imageWrapper.style.height, overflow: imageWrapper.style.overflow } : null,
      imageStyle: imageElement ? { left: imageElement.style.left, top: imageElement.style.top, width: imageElement.style.width, height: imageElement.style.height } : null
    });

    this.cropDragState = {
      id,
      type: 'rect',
      direction,
      startPos,
      startCrop,
      startScale: obj.scale !== undefined ? obj.scale : 1
    };
  }

  /**
   * Start changing the radius circle crop handle
   * @param {string} id - ID images
   * @param {Event} e - Mouse event
   */
  _startCropCircleResize(id, e) {
    const obj = this.registry.get(id);
    if (!obj || obj.type !== 'image' || !obj.isCropping || obj.maskType !== 'circle') return;

    // Hide styling panel during crop drag
    this._hideAllPanels();

    // Disable Foundry mass-select controls during crop drag
    FoundryAPIAdapter.disableMassSelect();

    const imageElement = this.layer?.getImageElement(id);
    if (!imageElement) return;

    const width = imageElement.offsetWidth || obj.baseWidth || 200;
    const height = imageElement.offsetHeight || obj.baseHeight || 200;
    const fallback = Math.min(width, height) / 2;
    const startRadius = obj.circleRadius !== null ? obj.circleRadius : fallback;

    this.cropDragState = {
      id,
      type: 'circle-resize',
      startX: e.clientX,
      startY: e.clientY,
      startRadius,
      startScale: obj.scale !== undefined ? obj.scale : 1
    };
  }

  /**
   * Start moving the image inside circle crop
   * @param {string} id - ID images
   * @param {Event} e - Mouse event
   */
  _startCropCircleDrag(id, e) {
    const obj = this.registry.get(id);
    if (!obj || obj.type !== 'image' || !obj.isCropping || obj.maskType !== 'circle') return;

    // Hide styling panel during crop drag
    this._hideAllPanels();

    // Disable Foundry mass-select controls during crop drag
    FoundryAPIAdapter.disableMassSelect();

    this.cropDragState = {
      id,
      type: 'circle-drag',
      startX: e.clientX,
      startY: e.clientY,
      startOffset: { ...obj.circleOffset },
      startScale: obj.scale !== undefined ? obj.scale : 1
    };
  }

  /**
   * Update crop during drag drag
   * @param {Event} e - Mouse event
   */
  _updateCropDrag(e) {
    if (!this.cropDragState) return;
    const state = this.cropDragState;
    const obj = this.registry.get(state.id);
    if (!obj || obj.type !== 'image') return;

    const currentScale = state.startScale;

    if (state.type === 'rect') {
      // Rect crop drag
      const delta = (state.direction === 'top' || state.direction === 'bottom' 
        ? e.clientY - state.startPos 
        : e.clientX - state.startPos) / currentScale;

      let newCrop = { ...obj.crop };
      
      if (state.direction === 'top') {
        newCrop.top = Math.max(0, state.startCrop + delta);
      } else if (state.direction === 'right') {
        newCrop.right = Math.max(0, state.startCrop - delta);
      } else if (state.direction === 'bottom') {
        newCrop.bottom = Math.max(0, state.startCrop - delta);
      } else if (state.direction === 'left') {
        newCrop.left = Math.max(0, state.startCrop + delta);
      }

      // OPTIMIZATION: Update DOM directly during crop drag (no Registry update)
      // Registry will be updated once in _endCropDrag() with final crop values
      // This prevents 60+ registry.update() calls per second during crop drag
      this.cropDragState.currentCrop = newCrop;

      // Update DOM directly with new crop data (no Registry update)
      if (this.layer) {
        this.layer._updateDOMDuringCropDrag(state.id, obj, { crop: newCrop });
      }
    } else if (state.type === 'circle-resize') {
      // Circle resize drag
      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;
      const deltaRadius = (deltaX + deltaY) / (2 * currentScale);

      const imageElement = this.layer?.getImageElement(state.id);
      if (!imageElement) return;

      const width = imageElement.offsetWidth || obj.baseWidth || 200;
      const height = imageElement.offsetHeight || obj.baseHeight || 200;
      const maxRadius = Math.min(width, height) / 2;
      const newRadius = Math.max(10, Math.min(maxRadius, state.startRadius + deltaRadius));

      // OPTIMIZATION: Update DOM directly during crop drag (no Registry update)
      // Registry will be updated once in _endCropDrag() with final radius
      this.cropDragState.currentRadius = newRadius;

      // Update DOM directly with new radius (no Registry update)
      if (this.layer) {
        this.layer._updateDOMDuringCropDrag(state.id, obj, { circleRadius: newRadius });
      }
    } else if (state.type === 'circle-drag') {
      // Circle drag (moving image inside circle mask)
      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;

      const imageElement = this.layer?.getImageElement(state.id);
      if (!imageElement) return;

      const baseWidth = obj.baseWidth || imageElement.offsetWidth || 200;
      const baseHeight = obj.baseHeight || imageElement.offsetHeight || 200;

      // Calculate new offsets with sensitivity (50% for smoother movement)
      const sensitivity = 0.5;
      let newOffsetX = state.startOffset.x + (deltaX / currentScale) * sensitivity;
      let newOffsetY = state.startOffset.y + (deltaY / currentScale) * sensitivity;

      // Limit movement by image boundaries
      const fallback = Math.min(baseWidth, baseHeight) / 2;
      const radius = obj.circleRadius !== null ? obj.circleRadius : fallback;
      
      // Circle clamp by center in local coordinates
      const centerX = baseWidth / 2 + newOffsetX;
      const centerY = baseHeight / 2 + newOffsetY;
      const clampedCenterX = Math.max(radius, Math.min(baseWidth - radius, centerX));
      const clampedCenterY = Math.max(radius, Math.min(baseHeight - radius, centerY));
      
      const finalOffsetX = clampedCenterX - baseWidth / 2;
      const finalOffsetY = clampedCenterY - baseHeight / 2;

      // OPTIMIZATION: Update DOM directly during crop drag (no Registry update)
      // Registry will be updated once in _endCropDrag() with final offset
      this.cropDragState.currentOffset = { x: finalOffsetX, y: finalOffsetY };

      // Update DOM directly with new offset (no Registry update)
      if (this.layer) {
        this.layer._updateDOMDuringCropDrag(state.id, obj, { circleOffset: { x: finalOffsetX, y: finalOffsetY } });
      }
    }
  }

  /**
   * Finish crop drag
   */
  _endCropDrag() {
    if (!this.cropDragState) return;
    const state = this.cropDragState;

    // DEBUG: Log crop drag end
    const container = this.layer?.getObjectContainer(state.id);
    const imageElement = this.layer?.getImageElement(state.id);
    const obj = this.registry.get(state.id);
    console.log('[CROP DEBUG] END:', {
      direction: state.direction,
      finalCrop: state.currentCrop,
      objCropBefore: obj ? { ...obj.crop } : null,
      containerStyle: container ? { left: container.style.left, top: container.style.top, width: container.style.width, height: container.style.height } : null,
      imageStyle: imageElement ? { left: imageElement.style.left, top: imageElement.style.top, width: imageElement.style.width, height: imageElement.style.height } : null
    });

    // CRITICAL: Clear cropDragState BEFORE updating Registry
    // This ensures canUpdateStyles() returns true when _updateObjectElement is called
    const finalCrop = state.currentCrop;
    const finalRadius = state.currentRadius;
    this.cropDragState = null;

    // Enable Foundry mass-select controls
    FoundryAPIAdapter.enableMassSelect();

    // Update Registry once with final crop/radius/offset (if changed)
    if (finalCrop) {
      this.registry.update(state.id, {
        crop: finalCrop
      }, 'local');
    } else if (finalRadius !== undefined) {
      this.registry.update(state.id, {
        circleRadius: finalRadius
      }, 'local');
    } else if (state.currentOffset) {
      this.registry.update(state.id, {
        circleOffset: state.currentOffset
      }, 'local');
    }

    // Update crop handles position and clip-path one final time
    this.layer?.updateCropHandlesPosition(state.id);
    this.layer?.updateImageClipPath(state.id);
    
    // Show panel again after crop drag ends (was hidden during drag)
    // Use double requestAnimationFrame to ensure DOM is fully updated
    if (this.selectedId === state.id) {
      const obj = this.registry.get(state.id);
      if (obj) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (this.selectedId === state.id) {
              // Show panel (it was hidden during drag) - this also updates position
              this._showPanelForObject(obj);
            }
          });
        });
      }
    }
  }

  // --- Logic ---

  /**
   * Hit-test to determine what element is at given screen coordinates
   * Uses _classifyHit for elementFromPoint and _geometricHitTest as fallback
   * @param {number} x - screen X coordinate
   * @param {number} y - screen Y coordinate
   * @returns {Object} - HitResult { type: 'ui'|'object'|'canvas', object?, element?, handleType? }
   */
  _hitTest(x, y) {
    // DEBUG: Logging input parameters
    const debugInfo = {
      input: { x, y },
      uiCheck: null,
      registryCheck: null,
      result: null
    };

    // 1. Try elementFromPoint classification first (preferred method)
    const uiElement = document.elementFromPoint(x, y);
    debugInfo.uiCheck = {
      element: uiElement?.tagName || 'null',
      className: uiElement?.className || 'null',
      id: uiElement?.id || 'null',
      pointerEvents: uiElement ? window.getComputedStyle(uiElement).pointerEvents : 'null',
      isCanvas: uiElement?.classList?.contains('wbe-whiteboard-layer') || false,
      isObject: uiElement?.closest(Whiteboard.getAllContainerSelectors()) ? true : false
    };
    console.log('[HitTest] elementFromPoint result:', {
      tag: uiElement?.tagName,
      id: uiElement?.id,
      className: uiElement?.className,
      pointerEvents: uiElement ? window.getComputedStyle(uiElement).pointerEvents : 'null',
      isCanvas: debugInfo.uiCheck.isCanvas,
      isObject: debugInfo.uiCheck.isObject
    });

    // Use _classifyHit for element classification
    const classified = this._classifyHit(x, y);
    
    // Handle classification result
    if (classified.type === 'handle') {
      debugInfo.result = {
        type: 'object',
        objectId: classified.object.id,
        objectType: classified.object.type,
        handleType: classified.handleType,
        method: 'elementFromPoint-handle'
      };
      console.log('[HitTest Debug]', debugInfo);
      return {
        type: 'object',
        object: classified.object,
        element: classified.element,
        handleType: classified.handleType,
        handleElement: classified.handleElement
      };
    }
    
    if (classified.type === 'ui') {
      debugInfo.result = {
        type: 'ui',
        reason: classified.reason || 'UI element detected'
      };
      console.log('[HitTest Debug]', debugInfo);
      return { type: 'ui' };
    }
    
    if (classified.type === 'object') {
      debugInfo.result = {
        type: 'object',
        objectId: classified.object.id,
        objectType: classified.object.type,
        method: 'elementFromPoint-closest'
      };
      console.log('[HitTest Debug]', debugInfo);
      return {
        type: 'object',
        object: classified.object,
        element: classified.element
      };
    }
    
    // Log skipped frozen image
    if (classified.skippedFrozen) {
      console.log('[HitTest Debug] Skipping frozen image in elementFromPoint:', classified.skippedFrozen);
    }

    // 2. Fallback to geometric hit-test via Registry
    const geometricResult = this._geometricHitTest(x, y, debugInfo);
    
    if (geometricResult) {
      const selected = geometricResult;
      debugInfo.result = {
        type: 'object',
        objectId: selected.obj.id,
        objectType: selected.obj.type,
        totalCandidates: 1,
        selectedZIndex: selected.obj.zIndex,
        method: 'geometric'
      };
      const selectedDomZ = selected.container ? parseInt(window.getComputedStyle(selected.container).zIndex) || 0 : 0;
      const selectedRegZ = selected.obj.zIndex !== undefined ? selected.obj.zIndex : 0;
      console.log('[HitTest] Selected object after sort:', {
        id: selected.obj.id.slice(-6),
        type: selected.obj.type,
        zIndexRegistry: selectedRegZ,
        zIndexDOM: selectedDomZ,
        sync: selectedRegZ === selectedDomZ ? '✓' : '✗'
      });
      if (selectedRegZ !== selectedDomZ) {
        console.warn(`[HitTest] SELECTED OBJECT SYNC MISMATCH: ${selected.obj.id.slice(-6)} Registry z-index=${selectedRegZ} but DOM z-index=${selectedDomZ}`);
      }
      console.log('[HitTest Debug]', debugInfo);
      return {
        type: 'object',
        object: selected.obj,
        element: selected.container
      };
    }

    // 3. Canvas - if nothing is found
    debugInfo.result = {
      type: 'canvas',
      reason: 'no_candidates'
    };
    console.log('[HitTest Debug]', debugInfo);
    return { type: 'canvas' };
  }
  /**
   * Check if element is a UI element (panels, controls, etc.)
   * @param {HTMLElement} element - DOM element to check
   * @returns {boolean} - true if element is UI
   * Requirements: 4.3
   */
  _isUIElement(element) {
    if (!element) return false;
    
    // Check for UI panels and controls
    if (element.closest('#ui-left') || 
        element.closest('#ui-right') || 
        element.closest('#ui-top') || 
        element.closest('.wbe-color-picker-panel') || 
        element.closest('.wbe-text-styling-panel') || 
        element.closest('.wbe-image-control-panel') || 
        element.closest('.wbe-image-resize-handle') || 
        element.closest('.wbe-mass-selection-box')) {
      return true;
    }
    
    // Check for editable elements (contentEditable, inputs)
    // CRITICAL: Only return true if element is ACTIVELY being edited
    const isActivelyEditing = element.isContentEditable || 
      element.getAttribute('contenteditable') === 'true' ||
      element.closest('[contenteditable="true"]');
    if (isActivelyEditing || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return true;
    }
    
    return false;
  }

  /**
   * Get handle info from element (crop or scale handle)
   * @param {HTMLElement} element - DOM element to check
   * @returns {Object|null} - { type: 'crop'|'scale', handleType: string, handleElement: HTMLElement } or null
   * Requirements: 4.2
   */
  _getHandleInfo(element) {
    if (!element) return null;
    
    // Check for crop handles (rect and circle) - higher priority
    const cropHandle = element.closest('.wbe-crop-handle-top, .wbe-crop-handle-right, .wbe-crop-handle-bottom, .wbe-crop-handle-left, .wbe-crop-handle-circle-resize');
    if (cropHandle) {
      const handleType = cropHandle.dataset.handleType || 
        (cropHandle.classList.contains('wbe-crop-handle-circle-resize') ? 'crop-circle-resize' : 
         cropHandle.classList.contains('wbe-crop-handle-top') ? 'crop-rect-top' :
         cropHandle.classList.contains('wbe-crop-handle-right') ? 'crop-rect-right' :
         cropHandle.classList.contains('wbe-crop-handle-bottom') ? 'crop-rect-bottom' :
         cropHandle.classList.contains('wbe-crop-handle-left') ? 'crop-rect-left' : 'crop');
      return {
        type: 'crop',
        handleType: handleType,
        handleElement: cropHandle
      };
    }
    
    // Check for scale handles (SVG overlay or DOM handles)
    const scaleHandle = element.closest('.wbe-image-resize-handle') ||
                        element.closest('.wbe-selection-overlay-handle');
    if (scaleHandle) {
      return {
        type: 'scale',
        handleType: 'scale',
        handleElement: scaleHandle,
        isSvgOverlay: scaleHandle.classList.contains('wbe-selection-overlay-handle')
      };
    }
    
    return null;
  }

  /**
   * Classify hit result from elementFromPoint - pure function without side effects
   * @param {number} x - screen X coordinate
   * @param {number} y - screen Y coordinate
   * @returns {Object} - HitResult { type: 'ui'|'handle'|'object'|'none', ... }
   * Requirements: 4.1
   */
  _classifyHit(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) {
      return { type: 'none' };
    }
    
    // 1. Check for handles first (handles are part of objects, not separate UI)
    const handleInfo = this._getHandleInfo(element);
    if (handleInfo) {
      // For crop handles - find container
      if (handleInfo.type === 'crop') {
        const container = handleInfo.handleElement.closest('.wbe-image-container');
        if (container) {
          const obj = this.registry.get(container.id);
          if (obj && obj.type === 'image') {
            return {
              type: 'handle',
              handleType: handleInfo.handleType,
              handleElement: handleInfo.handleElement,
              object: obj,
              element: container
            };
          }
        }
      }
      
      // For scale handles
      if (handleInfo.type === 'scale') {
        // SVG overlay handle - get object from layer's selection state
        if (handleInfo.isSvgOverlay) {
          const selectedId = this.layer?._selectionOverlaySelectedId;
          if (selectedId) {
            const obj = this.registry.get(selectedId);
            if (obj) {
              const container = this.layer?.getObjectContainer(selectedId);
              return {
                type: 'handle',
                handleType: 'scale',
                object: obj,
                element: container
              };
            }
          }
        }
        
        // DOM handles - find container
        const container = handleInfo.handleElement.closest('.wbe-text-container') || 
                          handleInfo.handleElement.closest('.wbe-image-container');
        if (container) {
          const obj = this.registry.get(container.id);
          if (obj) {
            return {
              type: 'handle',
              handleType: 'scale',
              object: obj,
              element: container
            };
          }
        }
      }
    }
    
    // 2. Check for UI elements
    if (this._isUIElement(element)) {
      return { type: 'ui' };
    }
    
    // 3. Check for whiteboard objects via closest container
    // Includes built-in types (text, image) and custom types (card, etc.)
    const container = element.closest(Whiteboard.getAllContainerSelectors());
    if (container) {
      const obj = this.registry.get(container.id);
      if (obj) {
        // Skip frozen images
        if (obj.type === 'image' && obj.frozen) {
          return { type: 'none', skippedFrozen: obj.id };
        }
        
        // Check if text is being edited
        if (obj.canEdit && obj.canEdit() && this.editingId === obj.id) {
          return { type: 'ui', reason: 'editing' };
        }
        
        return {
          type: 'object',
          object: obj,
          element: container
        };
      }
    }
    
    return { type: 'none', element: element };
  }

  /**
   * Geometric hit-test via Registry - finds objects by coordinate intersection
   * Objects are sorted by z-index in descending order (highest z-index first)
   * @param {number} x - screen X coordinate
   * @param {number} y - screen Y coordinate
   * @param {Object} debugInfo - debug info object to populate
   * @returns {Object|null} - { object, container } or null
   * Requirements: 4.4
   */
  _geometricHitTest(x, y, debugInfo) {
    const allObjects = this.registry.getAll();
    debugInfo.registryCheck = {
      totalObjects: allObjects.length,
      objectIds: allObjects.map(o => o.id),
      candidates: []
    };
    
    const candidates = [];
    
    allObjects.forEach(obj => {
      // Skip frozen images
      if (obj.type === 'image' && obj.frozen) {
        debugInfo.registryCheck.candidates.push({ id: obj.id, status: 'frozen' });
        return;
      }
      
      if (!this.layer) {
        debugInfo.registryCheck.candidates.push({ id: obj.id, status: 'no_layer' });
        return;
      }
      
      const container = this.layer.getObjectContainer(obj.id);
      if (!container) {
        debugInfo.registryCheck.candidates.push({ id: obj.id, status: 'no_container' });
        return;
      }
      
      if (container.offsetParent === null) {
        debugInfo.registryCheck.candidates.push({ id: obj.id, status: 'invisible' });
        return;
      }
      
      // Polymorphic call: get element for hit-testing
      let rect;
      let rectSource = 'unknown';
      const hitTestElement = obj.getElementForHitTest(this.layer);
      if (hitTestElement) {
        rect = hitTestElement.getBoundingClientRect();
        rectSource = hitTestElement.classList.contains('wbe-image-click-target') ? 'image-click-target' :
                     hitTestElement.classList.contains('wbe-canvas-text') ? 'text-element' : 'container';
      } else {
        rect = container.getBoundingClientRect();
        rectSource = 'container';
      }
      
      const isInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      debugInfo.registryCheck.candidates.push({
        id: obj.id,
        type: obj.type,
        rectSource,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        point: { x, y },
        isInside
      });
      
      if (isInside) {
        candidates.push({ obj, container });
      }
    });
    
    if (candidates.length === 0) {
      return null;
    }
    
    // Sort by z-index descending (higher z-index = on top)
    // SSOT: Read zIndex from model, not DOM
    const candidatesInfo = candidates.map(c => {
      const domZ = c.container ? parseInt(window.getComputedStyle(c.container).zIndex) || 0 : 0;
      const regZ = c.obj.zIndex !== undefined ? c.obj.zIndex : 0;
      return {
        id: c.obj.id.slice(-6),
        type: c.obj.type,
        zIndexRegistry: regZ,
        zIndexDOM: domZ,
        sync: regZ === domZ ? '✓' : '✗',
        mismatch: regZ !== domZ ? `MISMATCH: Registry=${regZ} vs DOM=${domZ}` : null
      };
    });
    console.log('[HitTest] Found candidates before sort:', JSON.stringify(candidatesInfo, null, 2));
    
    const mismatches = candidatesInfo.filter(c => c.mismatch);
    if (mismatches.length > 0) {
      console.warn('[HitTest] Z-INDEX SYNC MISMATCH DETECTED:', mismatches.map(m => `${m.id}: ${m.mismatch}`).join(', '));
    }
    
    candidates.sort((a, b) => {
      const zA = a.obj.zIndex !== undefined ? a.obj.zIndex : 0;
      const zB = b.obj.zIndex !== undefined ? b.obj.zIndex : 0;
      const result = zB - zA;
      
      const domZA = a.container ? parseInt(window.getComputedStyle(a.container).zIndex) || 0 : 0;
      const domZB = b.container ? parseInt(window.getComputedStyle(b.container).zIndex) || 0 : 0;
      console.log(`[HitTest] Sorting: ${a.obj.id.slice(-6)} (Registry: z=${zA}, DOM: z=${domZA}) vs ${b.obj.id.slice(-6)} (Registry: z=${zB}, DOM: z=${domZB}) => ${result > 0 ? 'B first' : result < 0 ? 'A first' : 'equal'}`);
      if (zA !== domZA || zB !== domZB) {
        console.warn(`[HitTest] Sorting uses Registry z-index, but DOM differs: ${a.obj.id.slice(-6)} (Reg=${zA} vs DOM=${domZA}), ${b.obj.id.slice(-6)} (Reg=${zB} vs DOM=${domZB})`);
      }
      return result;
    });
    
    return candidates[0];
  }

  _startDrag(id, e) {
    const obj = this.registry.get(id);
    if (obj) {
      // Hide styling panel during drag (standardized for all object types)
      this._hideAllPanels();

      // NOTE: Selection overlay stays visible during drag (rounded coordinates prevent jittering)

      // Layer now checks drag state via interactionManager.isDragging(id)
      // No need to call setDragState() anymore

      // Disable Foundry mass-select controls during drag
      FoundryAPIAdapter.disableMassSelect();

      const scale = canvas.stage.scale.x;

      // Save current text width from DOM to prevent browser from auto-changing it during drag
      // Polymorphic approach: only texts have textWidth, so check via canEdit
      // CRITICAL: Only save width if object has EXPLICIT textWidth set
      // If textWidth is null (auto-width), we should NOT force a fixed width after drag
      let savedTextWidth = null;
      let hadExplicitTextWidth = false;
      if (obj.canEdit && obj.canEdit()) {
        // Check if object has explicit textWidth in model
        hadExplicitTextWidth = obj.textWidth && obj.textWidth > 0;
        if (hadExplicitTextWidth) {
        const textElement = this.layer?.getTextElement(id);
        if (textElement) {
          // Save actual DOM width to preserve it during drag
          savedTextWidth = textElement.offsetWidth;
          }
        }
      }
      this.dragState = {
        id: id,
        startX: e.clientX,
        startY: e.clientY,
        objStartX: obj.x,
        objStartY: obj.y,
        scale: scale,
        savedTextWidth: savedTextWidth, // Only set if had explicit width
        hadExplicitTextWidth: hadExplicitTextWidth // Flag to track if width was explicit
      };
    }
  }
  _updateDrag(e) {
    const {
      id,
      startX,
      startY,
      objStartX,
      objStartY,
      scale
    } = this.dragState;
    // Convert screen delta to world delta
    const dx = (e.clientX - startX) / scale;
    const dy = (e.clientY - startY) / scale;
    const newX = objStartX + dx;
    const newY = objStartY + dy;

    // OPTIMIZATION: Update DOM directly during drag (no Registry update)
    // Registry will be updated once in _endDrag() with final position
    // This prevents 20+ Registry updates per drag operation
    if (this.layer) {
      this.layer._updateDOMDuringDrag(id, newX, newY);
      // Update selection overlay position during drag
      this.layer.updateSelectionOverlay();
    } else {
      // Fallback: if layer is not available, use Registry update
      console.warn('[InteractionManager] Layer not available, falling back to Registry update during drag');
    this.registry.update(id, {
      x: newX,
      y: newY
    }, 'local');
    }

    // Save position in dragState for final update
    this.dragState.currentX = newX;
    this.dragState.currentY = newY;
  }
  _endDrag() {
    const wasDraggingId = this.dragState?.id;
    const {
      currentX,
      currentY,
      savedTextWidth
    } = this.dragState;

    // CRITICAL: Clear dragState BEFORE updating Registry
    // This ensures isDragging() returns false when _updateObjectElement is called
    // Handle visibility depends on isDragging() check in _updateObjectElement
    this.dragState = null;

    // Reset cursor after drag (unified for all object types)
    this.layer?.applyBoardCursor('');

    // Enable Foundry mass-select controls after drag ends
    FoundryAPIAdapter.enableMassSelect();

    // Update Registry with final position and preserved textWidth
    // CRITICAL: Save textWidth if it was preserved during drag to prevent width jumping
    // Round position to prevent subpixel values in DB
    const updateData = {};
    if (currentX !== undefined && currentY !== undefined) {
      updateData.x = Math.round(currentX);
      updateData.y = Math.round(currentY);
    }
    // Preserve textWidth if it was saved during drag (prevents width jumping after drag)
    // CRITICAL: Only update textWidth if object ALREADY HAD explicit textWidth set
    // If textWidth was null (auto-width), keep it null - don't force a fixed width
    if (wasDraggingId && savedTextWidth !== null && savedTextWidth !== undefined) {
      const obj = this.registry.get(wasDraggingId);
      // Polymorphic approach: only texts have textWidth, so check via canEdit
      if (obj && obj.canEdit && obj.canEdit()) {
        // ONLY update if object had explicit textWidth AND saved width differs
        // Do NOT set textWidth if it was null (auto-width mode)
        if (obj.textWidth && obj.textWidth > 0 && Math.abs(obj.textWidth - savedTextWidth) > 1) {
          updateData.textWidth = savedTextWidth;
        }
      }
    }
    if (wasDraggingId && Object.keys(updateData).length > 0) {
      this.registry.update(wasDraggingId, updateData, 'local');
    }

    // Layer now checks drag state via interactionManager.isDragging(id)
    // Trigger update to restore handle visibility and position
    // CRITICAL: dragState is already null, so isDragging() will return false
    // This ensures handle is shown when object is selected
    if (wasDraggingId) {
      const obj = this.registry.get(wasDraggingId);
      if (obj && obj.selected) {
        this.registry.update(wasDraggingId, {
          selected: true
        }, 'local');
      }
    }

    // Show styling panel after drag if object is still selected (standardized for all object types)
    if (wasDraggingId && this.selectedId === wasDraggingId) {
      const obj = this.registry.get(wasDraggingId);
      if (obj) {
        requestAnimationFrame(() => {
          if (this.selectedId === wasDraggingId) {
            const selectedObj = this.registry.get(wasDraggingId);
            if (selectedObj) {
              this._showPanelForObject(selectedObj);
            }
          }
        });
      }
    }
  }

  // --- Pan/Zoom Support (Foundry Integration) ---

  _startPan(e) {
    if (!canvas?.stage) return;

    // Hide styling panel during pan (standardized for all object types)
    if (this.selectedId) {
      this._hideAllPanels();
    }

    // Temporarily disable pointer events on our objects to allow Foundry to see 'through' them
    this._setPointerEvents(false);

    // Track Pan Start
    this.panState = {
      startX: e.clientX,
      startY: e.clientY,
      pivotX: canvas.stage.pivot.x,
      pivotY: canvas.stage.pivot.y,
      scaleX: canvas.stage.scale.x,
      scaleY: canvas.stage.scale.y
    };
  }
  _updatePan(e) {
    if (!this.panState) return;
    const {
      startX,
      startY,
      pivotX,
      pivotY,
      scaleX,
      scaleY
    } = this.panState;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // Threshold to avoid jitter
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    canvas.pan({
      x: pivotX - dx / scaleX,
      y: pivotY - dy / scaleY
    });
  }
  _endPan() {
    this.panState = null;
    // Restore pointer events
    this._setPointerEvents(true);

    // Show styling panel after pan if object is still selected (standardized for all object types)
      if (this.selectedId) {
        const obj = this.registry.get(this.selectedId);
        if (obj) {
          requestAnimationFrame(() => {
            if (this.selectedId) {
              const selectedObj = this.registry.get(this.selectedId);
              if (selectedObj) {
                this._showPanelForObject(selectedObj);
              }
            }
          });
        }
      }
  }
  _startWidthResize(id, e) {
    const textElement = this.layer?.getTextElement(id);
    if (!textElement) return;

    // Hide styling panel during resize
    this._hideAllPanels();

    // Disable Foundry mass-select controls during resize
    FoundryAPIAdapter.disableMassSelect();
    this.widthResizeState = {
      id,
      startX: e.clientX,
      startWidth: textElement.offsetWidth
    };

    // Change cursor (on board to override any other cursor logic)
    this.layer?.applyBoardCursor('ew-resize');
  }
  _updateWidthResize(e) {
    if (!this.widthResizeState) return;
    const {
      id,
      startX,
      startWidth
    } = this.widthResizeState;
    if (!this.layer) return;
    const textElement = this.layer.getTextElement(id);
    if (!textElement) return;

    // Keep cursor as ew-resize during resize (on board to override any other cursor logic)
    this.layer.applyBoardCursor('ew-resize');
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + deltaX);

    // Update Registry (Single Source of Truth) - Layer will update DOM automatically
    this.registry.update(id, {
      textWidth: newWidth
    }, 'local');

    // Update selection overlay position during resize
    this.layer?.updateSelectionOverlay();

    // Store in widthResizeState for final update
    this.widthResizeState.currentWidth = newWidth;
  }
  _endWidthResize() {
    if (!this.widthResizeState) return;
    const {
      id,
      currentWidth
    } = this.widthResizeState;

    // CRITICAL: Clear resizeState BEFORE updating Registry
    // This ensures canUpdateStyles() returns true when _updateObjectElement is called
    this.widthResizeState = null;

    // Enable Foundry mass-select controls after resize ends
    FoundryAPIAdapter.enableMassSelect();

    // Update Registry once with final width
    if (currentWidth !== undefined) {
      this.registry.update(id, {
        textWidth: currentWidth
      }, 'local');
    }

    // Reset cursor (was set on board in _startWidthResize)
    this.layer?.applyBoardCursor('');

    // Show panel if text is still selected
    if (this.selectedId === id) {
      const obj = this.registry.get(id);
      // Show panel after width resize (standardized for all object types)
      if (obj) {
        requestAnimationFrame(() => {
          if (this.selectedId === id) {
            const selectedObj = this.registry.get(id);
            if (selectedObj) {
              this._showPanelForObject(selectedObj);
            }
          }
        });
      }
    }
  }
  _startScaleResize(id, e) {
    const obj = this.registry.get(id);
    // DRY: unified scale handling for all objects (built-in + custom types)
    if (!obj) return;
    const capabilities = obj.getCapabilities?.() || {};
    if (!capabilities.scalable) return;

    // Frozen images cannot be scaled
    if (obj.type === 'image' && obj.frozen) {
      return;
    }

    // Hide styling panel during resize (for all objects)
    this._hideAllPanels();

    // Disable Foundry mass-select controls during resize
    FoundryAPIAdapter.disableMassSelect();
    
    // For cropped images, save starting dims offset to keep container position stable
    const startScale = obj.scale !== undefined ? obj.scale : 1;
    const crop = obj.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    
    this.scaleResizeState = {
      id,
      startX: e.clientX,
      startScale,
      // Save starting crop offsets to keep container position stable during resize
      startDimsLeft: crop.left * startScale,
      startDimsTop: crop.top * startScale
    };

    // Change cursor
    this.layer?.applyBoardCursor('nwse-resize');
  }
  _updateScaleResize(e) {
    if (!this.scaleResizeState) return;
    const {
      id,
      startX,
      startScale
    } = this.scaleResizeState;
    // Use different constants for texts and images due to different scaling mechanisms
    const obj = this.registry.get(id);
    if (!obj) return;
    
    // Use text sensitivity for text, image sensitivity for everything else (images, cards, etc.)
    const sensitivity = obj.type === 'text' 
      ? InteractionManager.SCALE_SENSITIVITY_TEXT 
      : InteractionManager.SCALE_SENSITIVITY_IMAGE;
    const deltaX = e.clientX - startX;
    const newScale = startScale + deltaX * sensitivity;
    const clampedScale = Math.max(InteractionManager.MIN_SCALE, Math.min(InteractionManager.MAX_SCALE, newScale));

    // OPTIMIZATION: Update DOM directly during scale resize (no Registry update)
    // Registry will be updated once in _endScaleResize() with final scale
    // This prevents 20+ Registry updates per scale resize operation
    if (this.layer) {
      // Get current position from Registry
      const currentX = obj.x;
      const currentY = obj.y;
      // Pass startDims to keep container position stable for cropped images
      const { startDimsLeft, startDimsTop } = this.scaleResizeState;
      this.layer._updateDOMDuringScaleResize(id, obj, clampedScale, currentX, currentY, startDimsLeft, startDimsTop);
      // Update selection overlay position during scale resize (pass current scale since Registry not updated yet)
      this.layer.updateSelectionOverlay(clampedScale);
    } else {
      // Fallback: if layer is not available, use Registry update
      console.warn('[InteractionManager] Layer not available, falling back to Registry update during scale resize');
    this.registry.update(id, {
      scale: clampedScale
    }, 'local');
    }

    // Store in scaleResizeState for final update
    this.scaleResizeState.currentScale = clampedScale;
  }
  _endScaleResize() {
    if (!this.scaleResizeState) return;
    const {
      id,
      currentScale
    } = this.scaleResizeState;

    // 🔍 SCALE DEBUG: Log UI resize completion
    const obj = this.registry.get(id);
    const oldScale = obj?.scale;
    console.log(`[SCALE DEBUG] _endScaleResize: id=${id?.slice(-6)}, OLD scale=${oldScale}, NEW scale=${currentScale}`, {
      timestamp: Date.now(),
      oldScale,
      newScale: currentScale,
      source: 'UI-resize'
    });

    // CRITICAL: Clear resizeState BEFORE updating Registry
    // This ensures canUpdateStyles() returns true when _updateObjectElement is called
    this.scaleResizeState = null;

    // Enable Foundry mass-select controls
    FoundryAPIAdapter.enableMassSelect();

    // Preserve textWidth after scale resize to prevent width jumping
    // Get current textWidth from DOM if model doesn't have it set
    const updateData = {};
    let needsUpdate = false;

    // Only update scale if it actually changed
    // _updateScaleResize already updated Registry during drag, so scale should already be correct
    // But check anyway to handle edge cases (e.g., drag was cancelled)
    if (currentScale !== undefined && Math.abs((obj?.scale ?? 1) - currentScale) > 0.0001) {
      updateData.scale = currentScale;
      needsUpdate = true;
    }

    if (currentScale !== undefined && this.layer) {
      // Polymorphic approach: only texts have textWidth, so check via canEdit
      if (obj && obj.canEdit && obj.canEdit()) {
        const textElement = this.layer.getTextElement(id);
        if (textElement && (!obj.textWidth || obj.textWidth <= 0)) {
          // Preserve current DOM width if model doesn't have explicit textWidth
          // This prevents width jumping after scale resize
          const currentWidth = textElement.offsetWidth;
          if (currentWidth > 0 && obj.textWidth !== currentWidth) {
            updateData.textWidth = currentWidth;
            needsUpdate = true;
          }
        }
      }
    }

    // Update Registry only if there are actual changes
    // This prevents redundant updates when scale didn't change during drag
    if (needsUpdate) {
      this.registry.update(id, updateData, 'local');
    }

    // Reset cursor
    this.layer?.applyBoardCursor('');

    // Show panel if text is still selected
    if (this.selectedId === id) {
      const obj = this.registry.get(id);
      // Show panel after scale resize (unified for all object types)
      if (obj) {
        requestAnimationFrame(() => {
          if (this.selectedId === id) {
            const selectedObj = this.registry.get(id);
            if (selectedObj) {
              this._showPanelForObject(selectedObj);
            }
          }
        });
      }
    }
  }
  _setPointerEvents(enabled) {
    // Use Layer method for mass operation - tools can track via find_referencing_symbols
    this.layer?.setAllObjectsPointerEvents(enabled);
  }

  /**
   * Show panel for object (universal method for all types) (universal method for all types)
   * DRY: DRY: extensible architecture - when adding a new type, just add the panel to this.panels - when adding a new type, just add the panel to this.panels this.panels
   */
  _showPanelForObject(obj) {
    if (!obj) return;
    const panel = this.panels[obj.type];
    if (panel) {
      panel.show(obj.id);
    } else {
      // Hide all panels if type is not supported
      this._hideAllPanels();
    }
  }

  /**
   * Hide all panels (universal method) (universal method)
   * DRY: one method for all panel types
   */
  _hideAllPanels() {
    Object.values(this.panels).forEach(panel => {
      if (panel && typeof panel.hide === 'function') {
        panel.hide();
      }
    });
  }
  _select(id) {
    const obj = this.registry.get(id);
    // Frozen objects cannot be selected
    if (obj && obj.isFrozen?.()) {
      return;
    }

    // Clear mass selection when selecting single object
    if (this.massSelection && this.massSelection.selectedIds.size > 0) {
      this.massSelection.clear();
    }

    // // Finish editing if selecting another object
    if (this.editingId && this.editingId !== id) {
      this._endEditText(this.editingId);
    }
    if (this.selectedId && this.selectedId !== id) {
      // CRITICAL: Exit crop mode if previous object was cropping
      const prevObj = this.registry.get(this.selectedId);
      if (prevObj && prevObj.type === 'image' && prevObj.isCropping) {
        prevObj.exitCropMode(this.layer, this.registry, this.socketController).catch(err => {
          console.error('[InteractionManager] Error exiting crop mode on select:', err);
        });
      }
      
      this.registry.update(this.selectedId, {
        selected: false
      }, 'local');
    }
    this.selectedId = id;
    this.registry.update(id, {
      selected: true
    }, 'local');

    // Show selection overlay ABOVE all objects
    this.layer?.showSelectionOverlay(id);

    // // Show/hide styling panel based on object type (DRY: universal method)
    this._showPanelForObject(obj);
  }
  _deselect() {
    console.log(`[InteractionManager._deselect] Called, editingId: ${this.editingId}, selectedId: ${this.selectedId}, registry size: ${this.registry.getAll().length}`);
    
    // Clear mass selection
    if (this.massSelection) {
      this.massSelection.clear();
    }
    
    // // Finish editing if any
    if (this.editingId) {
      console.log(`[InteractionManager._deselect] Calling _endEditText for ${this.editingId}`);
      this._endEditText(this.editingId);
      console.log(`[InteractionManager._deselect] After _endEditText, registry size: ${this.registry.getAll().length}`);
    }
    if (this.selectedId) {
      // Exit crop mode if image is in crop mode
      const selectedObj = this.registry.get(this.selectedId);
      if (selectedObj && selectedObj.type === 'image' && selectedObj.isCropping) {
        selectedObj.exitCropMode(this.layer, this.registry, this.socketController).catch(err => {
          console.error('[InteractionManager] Error exiting crop mode on deselect:', err);
        });
      }
      
      // Reset global cursor
      this.layer?.applyBoardCursor('');
      this.registry.update(this.selectedId, {
        selected: false
      }, 'local');
      this.selectedId = null;
      
      // Hide selection overlay
      this.layer?.hideSelectionOverlay();
    }
    this._hideAllPanels();
  }

  /**
   * * Creating a text object at the cursor position
   * DRY: * DRY: uses the universal method _createObjectAt _createObjectAt
   * KISS: * KISS: simple wrapper over the universal method
   * 
   * @param {number} screenX - X * @param {number} screenX - X coordinate in screen coordinates screen coordinates
   * @param {number} screenY - Y * @param {number} screenY - Y coordinate in screen coordinates screen coordinates
   * @param {boolean} autoEdit - * @param {boolean} autoEdit - Start editing immediately after creation
   * @returns {WhiteboardText} Created text object
   */
  _createTextAt(screenX, screenY, autoEdit = false) {
    return this._createObjectAt('text', screenX, screenY, {
      text: "",
      autoEdit
    });
  }
  _startEditText(id) {
    const obj = this.registry.get(id);
    if (!obj || obj.type !== 'text') return;

    const container = this.layer?.getObjectContainer(id);
    if (!container) return;
    
    // Check if text is locked by another user
    if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user?.id) {
      console.warn(`[InteractionManager] Text ${id} is locked by ${container.dataset.lockedBy}, cannot edit`);
      return;
    }

    // Finish previous editing if any
    if (this.editingId && this.editingId !== id) {
      this._endEditText(this.editingId);
    }
    const textElement = this.layer?.getTextElement(id);
    if (!textElement) return;
    const textSpan = this.layer?.getTextSpan(id);
    if (!textSpan) return;

    // Set editingId (single source of truth)
    this.editingId = id;
    
    // Send lock notification to other clients
    if (this.socketController) {
      this.socketController.emit('textLock', {
        textId: id,
        userId: game.user?.id,
        userName: game.user?.name
      });
    }
    
    // Mark container as editing (for lock checking)
    container.setAttribute('data-editing', 'true');
    container.dataset.lockedBy = game.user?.id;

    // Set callback to notify on editing completion
    if (obj.setEditEndCallback) {
      obj.setEditEndCallback(id => {
        // Clear editingId on blur editing completion
        if (this.editingId === id) {
          this.editingId = null;
        }
      });
    }

    // Enable editing
    textSpan.contentEditable = "true";

    // Disable click-target during editing (so clicks go to textSpan)
    const clickTarget = container.querySelector('.wbe-text-click-target');
    if (clickTarget) {
      clickTarget.style.pointerEvents = 'none';
    }

    // Set pointer-events to receive events on span
    textElement.style.pointerEvents = "auto";
    textSpan.style.pointerEvents = "auto";
    textSpan.style.userSelect = "text";
    textSpan.focus();

    // Select all text for easy replacement
    const range = document.createRange();
    range.selectNodeContents(textSpan);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    console.log(`${MODULE_ID} | Started editing text: ${id}`);
  }
  _endEditText(id) {
    const textSpan = this.layer?.getTextSpan(id);
    if (!textSpan) return;
    const textElement = this.layer?.getTextElement(id);
    if (!textElement) return;
    if (textSpan.contentEditable === "true") {
      // Save HTML markup with sanitization (like in Miro)
      // If HTML exists - save innerHTML, otherwise textContent for plain text
      const content = textSpan.innerHTML.trim();
      let newText;
      if (content && /<[a-z][\s\S]*>/i.test(content)) {
        // HTML markup detected - save with sanitization
        newText = sanitizeHtml(content);
      } else {
        // Plain text - save as is
        newText = textSpan.textContent.trim();
      }
      textSpan.contentEditable = "false";

      // Restore pointer-events
      if (textElement) {
        textElement.style.pointerEvents = "none";
      }
      textSpan.style.pointerEvents = "";
      
      // Restore click-target pointer-events (was disabled during editing)
      const container = this.layer?.getObjectContainer(id);
      const clickTarget = container?.querySelector('.wbe-text-click-target');
      if (clickTarget) {
        clickTarget.style.pointerEvents = 'auto';
      }

      // Explicitly disable resize and reset all states after editing
      textSpan.style.resize = "none";
      textSpan.style.userSelect = "none";
      textSpan.style.webkitUserSelect = "none";
      textSpan.style.mozUserSelect = "none";
      textSpan.style.msUserSelect = "none";

      // Clear selection state
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }

      // Ensure the element has lost focus
      if (document.activeElement === textSpan) {
        textSpan.blur();
      }
      const obj = this.registry.get(id);
      if (obj) {
        // Delete empty text objects (user didn't type anything)
        if (!newText || newText.trim() === '') {
          console.log(`${MODULE_ID} | Deleting empty text: ${id}`);
          this.registry.delete(id);
          if (this.selectedId === id) {
            this.selectedId = null;
          }
          this.layer?.hideSelectionOverlay();
          return; // Exit early - no need to update deleted object
        }
        
        // CRITICAL: Save textWidth when finishing edit to prevent width "jumping"
        // Without this, textWidth remains null and width is reset to auto on socket updates
        // Auto-calculated width may differ slightly from the current DOM width
        const currentWidth = textElement.offsetWidth;
        const updateData = { text: newText };
        
        // Only save textWidth if it wasn't set before (preserve user-resized width)
        if (!obj.textWidth || obj.textWidth <= 0) {
          updateData.textWidth = currentWidth;
        }
        
        this.registry.update(id, updateData, 'local');
      }
      console.log(`${MODULE_ID} | Finished editing text: ${id}`);
    }

    // Clear editingId (single source of truth)
    if (this.editingId === id) {
      this.editingId = null;
    }
    
    // Send unlock notification to other clients
    if (this.socketController) {
      this.socketController.emit('textUnlock', {
        textId: id
      });
    }
    
    // Remove editing flags from container
    const container = this.layer?.getObjectContainer(id);
    if (container) {
      container.removeAttribute('data-editing');
      delete container.dataset.lockedBy;
    }

    // Clear callback
    const endObj = this.registry.get(id);
    if (endObj && endObj.setEditEndCallback) {
      endObj.setEditEndCallback(null);
    }
  }

  /**
   * Factory method for creating objects by type
   * DRY: single point of object creation, simplifies adding new types
   * KISS: simple switch for built-in types, extensible via Whiteboard._customTypes
   */
  static _createObjectFromType(type, data) {
    // Built-in types
    switch (type) {
      case 'text':
        return new WhiteboardText(data);
      case 'image':
        return new WhiteboardImage(data);
    }
    
    // Custom types (registered via Whiteboard.registerObjectType)
    const customConfig = Whiteboard.getObjectTypeConfig(type);
    if (customConfig) {
      if (customConfig.factory) {
        return customConfig.factory(data);
      }
      return new customConfig.ViewClass(data);
    }
    
    throw new Error(`Unknown object type: ${type}`);
  }

  /**
   * Universal method for creating an object at the cursor position
   * DRY: common creation logic, allocation and registration for all object types
   * KISS: one method instead of duplicating logic in each type
   * 
   * @param {string} type - Object type ('text', 'image', etc.)
   * @param {number} screenX - X coordinate in screen coordinates
   * @param {number} screenY - Y coordinate in screen coordinates
   * @param {Object} options - Additional object parameters (text, src, width, height, autoEdit etc..d.)
   * @returns {WhiteboardObject} Created object
   */
  _createObjectAt(type, screenX, screenY, options = {}) {
    // 1. Coordinate conversion (ONCE for all types!)
    const t = canvas.stage.worldTransform;
    const det = t.a * t.d - t.b * t.c;
    const x = (t.d * (screenX - t.tx) - t.c * (screenY - t.ty)) / det;
    const y = (t.a * (screenY - t.ty) - t.b * (screenX - t.tx)) / det;

    // 2. Object data preparation
    // CRITICAL: selected is set BEFORE registration so Layer sees the selected object during rendering
    const objData = {
      x,
      y,
      selected: true,
      // All new objects are created selected
      ...options // Allows passing specific data (text, src, width, height, etc.)
    };

    // 3. Object creation via factory
    const obj = InteractionManager._createObjectFromType(type, objData);

    // 4. Selecting the previous object (ONCE for all types!)
    // CRITICAL: selectedId is set BEFORE registration so _renderObject() sees the selected object
    if (this.selectedId && this.selectedId !== obj.id) {
      this.registry.update(this.selectedId, {
        selected: false
      }, 'local');
    }
    this.selectedId = obj.id;

    // 5. Registration (ONCE for all types!)
    // Layer will automatically create DOM via _renderObject()
    this.registry.register(obj, 'local');

    // 6. Show selection overlay ABOVE all objects (same as in _select)
    // CRITICAL: Must be after registration so DOM element exists
    this.layer?.showSelectionOverlay(obj.id);

    // 7. Specific logic via polymorphism
    this._afterObjectCreated(obj, options);
    
    return obj;
  }

  /**
   * Polymorphism: each object type can have its own logic after creation: each object type can have its own logic after creation
   * DRY: DRY: specific logic for each type in one place
   * KISS: simple if/else instead of type checks in different places
   * 
   * @param {WhiteboardObject} obj - Created object
   * @param {Object} options - Options, Options passed to _createObjectAt _createObjectAt
   */
  _afterObjectCreated(obj, options) {
    // Polymorphic call: each object type knows what to do after creation
    obj.onCreated(this, options);
  }

  /**
   * Unified object copying (DRY: one method for all types) (DRY: one method for all types)
   * Architecturally correct: tools see copying through InteractionManager: tools see copying through InteractionManager InteractionManager
   * 
   * @param {string} id - ID ID of the object to copy
   * @returns {Object|null} Copied data or null if the object is not found
   */
  _copyObject(id) {
    const obj = this.registry.get(id);
    if (!obj) return null;

    // Base data from toJSON() (works for all object types)
    const baseData = obj.toJSON();

    // Polymorphic call: get data for copying
    // Each object type knows which additional data is needed
    const copyData = obj.getCopyData(this.layer);
    let additionalData = {};
    
    // For text, get additional data from the DOM (scale and opacity)
    if (copyData && obj.canEdit && obj.canEdit()) {
      const textElement = this.layer?.getTextElement(id);
      if (textElement) {
        // Get scale from transform
        const transform = textElement.style.transform || '';
        const scaleMatch = transform.match(/scale\(([^)]+)\)/);
        const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        additionalData = {
          scale,
          colorOpacity: obj.colorOpacity,
          backgroundColorOpacity: obj.backgroundColorOpacity,
          borderOpacity: obj.borderOpacity
        };
      }
    } else if (obj.type === 'image') {
      // For images, get additional data from the DOM
      const imageElement = this.layer?.getImageElement(id);
      if (imageElement) {
        // Get scale from transform
        const transform = imageElement.style.transform || '';
        const scaleMatch = transform.match(/scale\(([^)]+)\)/);
        const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        // Crop data is already included in baseData via toJSON(), but we add it explicitly for reliability
        additionalData = {
          scale,
          crop: obj.crop,
          maskType: obj.maskType,
          circleOffset: obj.circleOffset,
          circleRadius: obj.circleRadius
        };
      }
    }
    return {
      type: obj.type,
      data: {
        ...baseData,
        ...additionalData
      }
    };
  }

  /**
   * Copy event handler (Ctrl+C / Cmd+C) copy (Ctrl+C / Cmd+C)
   * Unified: works for any objects: works for any objects
   * Put data into the system clipboard for compatibility with other applications
   */
  async _handleCopy(e) {
    // NOTE: Mass selection copy is handled via keydown (Ctrl+C) in MassSelectionController.handleKeyDown
    // This _handleCopy only handles single object copy

    // Universal copy handling for all objects (text, image, etc.)
    console.log('[InteractionManager] Copy event triggered', { 
      target: e.target, 
      targetTag: e.target?.tagName,
      isContentEditable: e.target?.isContentEditable,
      contentEditableAttr: e.target?.getAttribute('contenteditable'),
      selectedId: this.selectedId 
    });
    
    // Ignore only if the text is being EDITED (check editingId - the single source of truth!)
    // Do NOT ignore if the text is just selected (contentEditable === "false")
    const target = e.target;
    
    // CRITICAL: Check editingId instead of target.isContentEditable - more reliable!
    // editingId is the single source of truth for whether the text is being edited
    if (this.editingId) {
      console.log('[InteractionManager] Copy ignored - text is being edited (editingId:', this.editingId, ')');
      return; // Let the browser handle text copying during editing
    }
    
    // Also check if this is an input/textarea (but not our object)
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (isInput) {
      // Check that this is not our object (not inside our canvas)
      const isOurObject = target.closest(Whiteboard.getAllContainerSelectors());
      if (!isOurObject) {
        console.log('[InteractionManager] Copy ignored - external input/textarea');
        return; // Let the browser handle copying from external input/textarea
      }
    }

    // CRITICAL: For our objects, copying is handled via _copyToClipboardDirect from _handleKeyDown
    // The copy event here may be triggered by the browser or execCommand, but we have already handled copying
    // // So we simply ignore this event for our objects
    if (this.selectedId) {
      const obj = this.registry.get(this.selectedId);
      if (obj && (obj.type === 'text' || obj.type === 'image')) {
        console.log('[InteractionManager] Copy ignored - already handled by _copyToClipboardDirect');
        return; // return; // Copying is already handled in _copyToClipboardDirect
      }
    }

    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      console.log('[InteractionManager] Copy ignored - no clipboardData');
      return;
    }
    
    // // Copy only if there is a selected object (for other object types if they appear)
    if (!this.selectedId) {
      console.log('[InteractionManager] Copy ignored - no selected object');
      return;
    }
    const obj = this.registry.get(this.selectedId);
    if (!obj) {
      console.log('[InteractionManager] Copy ignored - object not found');
      return;
    }
    
    console.log('[InteractionManager] Copy processing for object:', obj.type);

    // // Polymorphic call: get data for copying
    const copyData = obj.getCopyData(this.layer);
    if (copyData && copyData.type === 'text') {
      // // For text: copyData contains html and text
      const { html, text } = copyData;
      if (!html && !text) {
        console.warn('[InteractionManager] Empty text content for copy');
        return;
      }
      
      // // CRITICAL: setData must be called BEFORE preventDefault for correct operation!
      // // The browser copies data to the clipboard only if we call setData in the copy handler
      clipboardData.setData('text/html', html);
      clipboardData.setData('text/plain', text);
      
      // // Prevent default browser behavior AFTER setting data
      e.preventDefault();
      e.stopPropagation();
      
      console.log('[InteractionManager] Text copied to clipboard:', { html: html.substring(0, 50), text: text.substring(0, 50) });
    } else if (obj.type === 'image') {
      // // For images, put the blob into the system clipboard via canvas
      const imageElement = this.layer?.getImageElement(this.selectedId);
      if (imageElement && imageElement.src) {
        // // Prevent default browser behavior (for images this must be done in advance)
        e.preventDefault();
        e.stopPropagation();
        
        try {
          // Create a canvas to convert the image to a blob
          const tempCanvas = document.createElement('canvas');
          const ctx = tempCanvas.getContext('2d');
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise((resolve, reject) => {
            img.onload = () => {
              tempCanvas.width = img.naturalWidth;
              tempCanvas.height = img.naturalHeight;
              ctx.drawImage(img, 0, 0);
              
              // Convert the canvas to a blob
              tempCanvas.toBlob((blob) => {
                if (blob) {
                  // Use ClipboardItem API for images
                  if (typeof ClipboardItem !== 'undefined') {
                    const clipboardItem = new ClipboardItem({ [blob.type]: blob });
                    e.clipboardData.items.add(clipboardItem);
                  } else {
                    // Fallback: put URL as text if ClipboardItem is not supported
                    clipboardData.setData('text/plain', imageElement.src);
                  }
                }
                resolve();
              }, 'image/png');
            };
            img.onerror = reject;
            img.src = imageElement.src;
          });
        } catch (error) {
          console.warn('[InteractionManager] Failed to copy image to clipboard:', error);
          // Fallback: put image URL as text
          clipboardData.setData('text/plain', imageElement.src);
        }
      }
    }

    // Save copied data for internal use (if needed)
    const copiedData = this._copyObject(this.selectedId);
    if (copiedData) {
      this.copiedObjectData = copiedData;
    }
  }

  /**
   * Paste copied object (Ctrl+V / Cmd+V for copied object) (Ctrl+V / Cmd+V for the copied object)
   * Unified: works for any objects via _createObjectAt: works for any objects via _createObjectAt
   */
  async _handleCopiedObjectPaste() {
    if (!this.copiedObjectData) {
      return null;
    }
    const {
      type,
      data
    } = this.copiedObjectData;

    // Get cursor position (use canvas center as fallback)
    // Use last mouse position (updated in _handleMouseMove)
    const screenX = this.lastMouseX ?? canvas.stage.x + canvas.stage.width / 2;
    const screenY = this.lastMouseY ?? canvas.stage.y + canvas.stage.height / 2;

    // CRITICAL: Remove x, y from data - they come from the original object and will override the cursor position!
    // Also remove id to create a new object
    // eslint-disable-next-line no-unused-vars
    const { x, y, id, ...dataWithoutCoords } = data;

    // Create the object via a unified method (DRY!)
    const obj = this._createObjectAt(type, screenX, screenY, {
      ...dataWithoutCoords
    });
    return obj;
  }

  /**
   * * Direct copy to clipboard via execCommand (works everywhere) execCommand (works everywhere)
   * * Used when the copy event cannot be created programmatically (Ctrl+C on our objects) (Ctrl+C on our objects)
   */
  async _copyToClipboardDirect() {
    console.log('[InteractionManager] _copyToClipboardDirect called', { selectedId: this.selectedId });
    
    if (!this.selectedId) {
      console.warn('[InteractionManager] No selected object to copy');
      return;
    }
    const obj = this.registry.get(this.selectedId);
    if (!obj) {
      console.warn('[InteractionManager] Object not found:', this.selectedId);
      return;
    }

    console.log('[InteractionManager] Copying object:', obj.type);

    try {
      // // Polymorphic call: get data for copying
      const copyData = obj.getCopyData(this.layer);
      if (copyData && copyData.type === 'text') {
        const { html, text } = copyData;
        if (!html && !text) {
          console.warn('[InteractionManager] Empty text content for direct copy');
          return;
        }
        
        console.log('[InteractionManager] Copying text:', { html: html.substring(0, 50), text: text.substring(0, 50) });
        
        // CRITICAL: Copy HTML WITHOUT styles to avoid distortion on paste
        // // Use sanitizeHtml to clean styles but keep formatting (tags)
        let cleanHtml = html;
        if (html && html !== text) {
          // // If HTML exists - sanitize it (remove styles, keep only formatting tags)
          cleanHtml = sanitizeHtml(html);
        }
        
        // // Use the good old execCommand - works everywhere!
        // Create a temporary element with CLEANED HTML (no styles) AND MARKER
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'fixed';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '-9999px';
        tempDiv.style.backgroundColor = 'transparent';
        tempDiv.style.color = 'inherit';
        tempDiv.contentEditable = 'true';
        // CRITICAL: Place a marker at the start to identify "our object" on paste
        // The marker will be copied as text/plain, HTML as text/html
        // Use an invisible marker (font-size: 0) so it doesn't interfere visually
        const marker = `[wbe-TEXT-COPY:${this.selectedId}]`;
        tempDiv.innerHTML = `<span style="font-size: 0; line-height: 0; opacity: 0;">${marker}</span>${cleanHtml || text}`;
        document.body.appendChild(tempDiv);
        
        // Select the content
        const range = document.createRange();
        range.selectNodeContents(tempDiv);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Copy via execCommand (copies both HTML and marker)
        const success = document.execCommand('copy');
        document.body.removeChild(tempDiv);
        selection.removeAllRanges();
        
        if (success) {
          console.log('[InteractionManager] Text copied successfully via execCommand (cleaned HTML + marker)');
        } else {
          console.warn('[InteractionManager] execCommand copy failed, trying Clipboard API');
          // Fallback: Clipboard API with cleaned HTML
          if (navigator.clipboard && navigator.clipboard.write) {
            try {
              const htmlBlob = new Blob([cleanHtml || text], { type: 'text/html' });
              const textBlob = new Blob([text], { type: 'text/plain' });
              const clipboardItem = new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob
              });
              await navigator.clipboard.write([clipboardItem]);
              console.log('[InteractionManager] Text copied via Clipboard API (cleaned HTML)');
            } catch {
              // If ClipboardItem is not supported - text only
              if (navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                console.log('[InteractionManager] Text copied via Clipboard API (text only)');
              }
            }
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            console.log('[InteractionManager] Text copied via Clipboard API (text only fallback)');
          }
        }
      } else if (obj.type === 'image') {
        // Polymorphic call: get image element for copying
        const imageElement = obj.getImageElementForCopy(this.layer);
        if (!imageElement || !imageElement.src) {
          console.warn('[InteractionManager] Image element not found for direct copy');
          return;
        }
        
        console.log('[InteractionManager] Copying image:', imageElement.src);
        
        // For images, use canvas + data URL via execCommand (works everywhere!)
        // This is more reliable than the Clipboard API which requires HTTPS
        try {
          // Create a canvas and draw the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise((resolve, reject) => {
            img.onload = () => {
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              ctx.drawImage(img, 0, 0);
              
              // Convert the canvas to a data URL
              const dataURL = canvas.toDataURL('image/png');
              
              // Create a temporary element with the image AND MARKER
              const tempDiv = document.createElement('div');
              tempDiv.style.position = 'fixed';
              tempDiv.style.left = '-9999px';
              tempDiv.style.top = '-9999px';
              tempDiv.contentEditable = 'true';
              // CRITICAL: Place the marker at the start to identify "our object" on paste
              // The marker will be copied as text/plain, the image as image/png
              // Use an invisible marker (font-size: 0) so it doesn't interfere visually
              const marker = `[wbe-IMAGE-COPY:${this.selectedId}]`;
              tempDiv.innerHTML = `<span style="font-size: 0; line-height: 0; opacity: 0;">${marker}</span><img src="${dataURL}" />`;
              document.body.appendChild(tempDiv);
              
              // Select the content
              const range = document.createRange();
              range.selectNodeContents(tempDiv);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              
              // Copy using execCommand (copies both image and marker)
              const success = document.execCommand('copy');
              document.body.removeChild(tempDiv);
              selection.removeAllRanges();
              
              if (success) {
                console.log('[InteractionManager] Image copied successfully via execCommand (canvas + marker)');
              } else {
                console.warn('[InteractionManager] execCommand failed for image, trying Clipboard API');
                // Fallback: Clipboard API if available
                if (navigator.clipboard && navigator.clipboard.write) {
                  canvas.toBlob(async (blob) => {
                    if (blob) {
                      try {
                        const clipboardItem = new ClipboardItem({ [blob.type]: blob });
                        await navigator.clipboard.write([clipboardItem]);
                        console.log('[InteractionManager] Image copied via Clipboard API fallback');
                      } catch (clipboardError) {
                        console.warn('[InteractionManager] Clipboard API fallback failed:', clipboardError);
                      }
                    }
                    resolve();
                  }, 'image/png');
                  return;
                } else {
                  console.warn('[InteractionManager] No clipboard method available for image');
                }
              }
              resolve();
            };
            img.onerror = reject;
            img.src = imageElement.src;
          });
        } catch (error) {
          console.warn('[InteractionManager] Image copy failed:', error);
          // Fallback: copy URL as text
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(imageElement.src);
            console.log('[InteractionManager] Image URL copied as text fallback');
          }
        }
      }
      
      // Save copied data for internal use
      const copiedData = this._copyObject(this.selectedId);
      if (copiedData) {
        this.copiedObjectData = copiedData;
        console.log('[InteractionManager] Copied data saved internally:', copiedData.type);
      }
    } catch (error) {
      console.error('[InteractionManager] Direct clipboard copy failed:', error);
    }
  }

  /**
   * Paste text from system clipboard (Ctrl+V / Cmd+V for text) clipboard (Ctrl+V / Cmd+V for text)
   * Universal: uses Windows system clipboard, same as for images: uses the system clipboard Windows, as for images
   * Architecturally correct: uses _createObjectAt to create object: uses _createObjectAt to create the object
   * Supports HTML markup (like in Miro) with sanitization HTML-markup (like in Miro) with sanitization
   * 
   * @param {string} text - @param {string} text - Text or HTML to paste
   * @param {boolean} isHtml - true @param {boolean} isHtml - true if HTML, false if plain text HTML, false if plain text
   */
  async _handleTextPasteFromClipboard(text, _isHtml = false) {
    if (!text || !text.trim()) {
      return null;
    }

    // Get cursor position (use canvas center as fallback)
    const screenX = this.lastMouseX ?? canvas.stage.x + canvas.stage.width / 2;
    const screenY = this.lastMouseY ?? canvas.stage.y + canvas.stage.height / 2;

    // NOTE: sanitizeHtml is called in WhiteboardText.render() if text contains HTML
    // No need to sanitize here - DRY principle
    const processedText = text.trim();

    // Create text object via unified method (DRY!)
    const obj = this._createObjectAt('text', screenX, screenY, {
      text: processedText
    });
    
    // CRITICAL: Fix textWidth after DOM render
    // External text doesn't go through _endEditText where width is normally fixed
    // Without this, textWidth stays null and browser recalculates width during drag
    if (obj) {
      requestAnimationFrame(() => {
        const textElement = this.layer?.getTextElement(obj.id);
        if (textElement && (!obj.textWidth || obj.textWidth <= 0)) {
          const width = textElement.offsetWidth;
          if (width > 0) {
            // Use registry.update() for proper lifecycle (DB save, socket, etc.)
            this.registry.update(obj.id, { textWidth: width }, 'local');
          }
        }
      });
    }
    
    return obj;
  }

  /**
   * Handle paste of image URL (from browser "Copy image" when CORS prevents blob copy)
   * Fetches the image and passes to _handleImagePasteFromClipboard
   */
  async _handleImageUrlPaste(imageUrl) {
    try {
      console.log('[InteractionManager] Fetching image from URL:', imageUrl.substring(0, 80));
      
      // Method 1: Try fetch (works if server allows CORS)
      try {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type.startsWith('image/')) {
            const file = new File([blob], 'pasted-image.png', { type: blob.type });
            await this._handleImagePasteFromClipboard(file);
            return;
          }
        }
      } catch (fetchError) {
        console.log('[InteractionManager] Fetch failed, trying canvas method:', fetchError.message);
      }
      
      // Method 2: Try loading via img + canvas (works if server sends CORS headers for images)
      const blob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Request CORS
        
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Canvas toBlob returned null'));
              }
            }, 'image/png');
          } catch (canvasError) {
            reject(canvasError);
          }
        };
        
        img.onerror = () => reject(new Error('Image failed to load with CORS'));
        img.src = imageUrl;
      });
      
      const file = new File([blob], 'pasted-image.png', { type: 'image/png' });
      await this._handleImagePasteFromClipboard(file);
      
    } catch (error) {
      console.error('[InteractionManager] Failed to paste image from URL:', error);
      // CORS blocks fetching cross-origin images - this is a browser security limitation
      ui.notifications?.warn?.('Cannot paste this image (blocked by CORS). Right-click → "Save image as..." → drag to whiteboard.');
    }
  }

  /**
   * Insert image from system clipboard (Ctrl+V / Cmd+V for file) clipboard (Ctrl+V / Cmd+V for file)
   * Universal: uses Windows system clipboard: uses the system clipboard Windows
   * Architecturally correct: uses _createObjectAt to create object: uses _createObjectAt to create the object
   */
  async _handleImagePasteFromClipboard(file) {
    // Check if images are enabled
    if (!isFeatureEnabled('images')) {
      ui?.notifications?.warn?.('Image objects are disabled in module settings');
      return;
    }
    
    try {
      // Clear copied data (paste from system clipboard)
      this.copiedObjectData = null;

      // Preload image to get dimensions BEFORE loading
      const objectURL = URL.createObjectURL(file);
      const preloadImg = new Image();
      const dimensions = await new Promise((resolve, reject) => {
        preloadImg.onload = () => {
          URL.revokeObjectURL(objectURL);
          resolve({
            width: preloadImg.naturalWidth,
            height: preloadImg.naturalHeight
          });
        };
        preloadImg.onerror = () => {
          URL.revokeObjectURL(objectURL);
          reject(new Error('Failed to preload image'));
        };
        preloadImg.src = objectURL;
      });

      // Use real size (no auto-scaling)
      const finalScale = 1;

      // Upload file via Foundry API
      const timestamp = Date.now();
      const extension = file.type.split('/')[1] || 'png';
      const filename = `wbe-image-${timestamp}.${extension}`;
      const newFile = new File([file], filename, {
        type: file.type
      });
      let uploadResult;

      // Determine loading method (V12+ or V11)
      let uploadMethod;
      if (foundry.applications?.apps?.FilePicker?.implementation) {
        uploadMethod = foundry.applications.apps.FilePicker.implementation;
      } else {
        uploadMethod = FilePicker;
      }
      try {
        // Upload file - format: upload(source, path, file, options, uploadOptions)
        // For V12+: uploadOptions is separate object with notify, etc.
        uploadResult = await uploadMethod.upload("data", `worlds/${game.world.id}/`, newFile, {
          name: filename
        }, {
          notify: false  // Don't show Foundry's default notification
        });
      } catch (uploadError) {
        console.error('[InteractionManager] Upload error:', uploadError);
        // Try without uploadOptions (for older Foundry versions)
        try {
          uploadResult = await uploadMethod.upload("data", `worlds/${game.world.id}/`, newFile, {
            name: filename
          });
        } catch (retryError) {
          console.error('[InteractionManager] Retry upload error:', retryError);
          const errorMsg = retryError.message || retryError.toString() || 'Unknown error';
          console.error('[InteractionManager] Full error details:', {
            error: retryError,
            user: game.user?.name,
            isGM: game.user?.isGM,
            canUpload: game.user?.can('FILES_UPLOAD')
          });
          ui.notifications.error(`Image upload failed: ${errorMsg}`);
          return null;
        }
      }
      
      if (!uploadResult || !uploadResult.path) {
        ui.notifications.error("Image upload failed: No path returned");
        return null;
      }

      // Calculate position (center under cursor)
      const screenX = this.lastMouseX ?? canvas.stage.x + canvas.stage.width / 2;
      const screenY = this.lastMouseY ?? canvas.stage.y + canvas.stage.height / 2;
      const scaledWidth = dimensions.width * finalScale;
      const scaledHeight = dimensions.height * finalScale;

      // Convert screen → world coordinates
      const t = canvas.stage.worldTransform;
      const det = t.a * t.d - t.b * t.c;
      const worldX = (t.d * (screenX - t.tx) - t.c * (screenY - t.ty)) / det;
      const worldY = (t.a * (screenY - t.ty) - t.b * (screenX - t.tx)) / det;

      // Center image under cursor (in world coordinates)
      const centeredX = worldX - scaledWidth / 2;
      const centeredY = worldY - scaledHeight / 2;

      // Create object via unified method (DRY!)
      // Pass screenX/Y for conversion, but override x/y for centering
      // _createObjectAt converts screenX/Y to world, but we override via options
      // ALTERNATIVE 1: Pass baseWidth/baseHeight for correct size calculation
      const obj = this._createObjectAt('image', screenX, screenY, {
        src: uploadResult.path,
        width: dimensions.width,
        height: dimensions.height,
        baseWidth: dimensions.width, // Natural image dimensions
        baseHeight: dimensions.height, // Natural image dimensions
        x: centeredX,
        // Override x/y for centering (already in world coordinates)
        y: centeredY,
        scale: finalScale
      });
      return obj;
    } catch (error) {
      console.error('[InteractionManager] Image paste error:', error);
      ui.notifications.error("Image paste error");
      return null;
    }
  }

  /**
   * Event handler paste (Ctrl+V / Cmd+V)
   * Unified: handles both copied objects and system clipboard: handles both copied objects and the system clipboard, and system clipboard
   */
  async _handlePaste(e) {
    // Ignore if editing text or input/textarea is active
    const target = e.target;
    const isEditable = target.isContentEditable || target.getAttribute('contenteditable') === 'true' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (isEditable) {
      return; // return; // Let the browser handle text paste
    }

    // NOTE: Mass selection paste is handled via keydown (Ctrl+V) in MassSelectionController.handleKeyDown
    // This _handlePaste only handles single object paste and external clipboard

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) {
      return;
    }

    const text = clipboardData.getData("text/plain");

    // PRIORITY 0.5: Check marker - is it our single object?
    // If marker found AND saved data exists - use it (like old code!)
    console.log('[InteractionManager] Paste - clipboard text:', text?.substring(0, 50), 'copiedObjectData:', this.copiedObjectData?.type);
    if (text && text.trim()) {
      // Check marker for text
      if (text.startsWith("[wbe-TEXT-COPY:")) {
        if (this.copiedObjectData && this.copiedObjectData.type === 'text') {
          e.preventDefault();
          e.stopPropagation();
          console.log('[InteractionManager] Pasting our text object from copiedObjectData');
          await this._handleCopiedObjectPaste();
          return;
        } else {
          // Marker found but data is missing or corrupted - show error, don't paste garbage
          e.preventDefault();
          e.stopPropagation();
          console.warn('[InteractionManager] Text marker found but copiedObjectData is missing or wrong type');
          ui.notifications?.warn?.('Failed to paste text object - copy data expired or corrupted');
          return;
        }
      }
      // Check marker for image
      if (text.startsWith("[wbe-IMAGE-COPY:")) {
        if (this.copiedObjectData && this.copiedObjectData.type === 'image') {
          e.preventDefault();
          e.stopPropagation();
          console.log('[InteractionManager] Pasting our image object from copiedObjectData');
          await this._handleCopiedObjectPaste();
          return;
        } else {
          // Marker found but data is missing or corrupted - show error, don't paste garbage
          e.preventDefault();
          e.stopPropagation();
          console.warn('[InteractionManager] Image marker found but copiedObjectData is missing or wrong type');
          ui.notifications?.warn?.('Failed to paste image object - copy data expired or corrupted');
          return;
        }
      }
    }

    // PRIORITY 1: Plain text from system clipboard
    // Simpler and more reliable than HTML - no formatting issues from external sources
    if (text && text.trim()) {
      e.preventDefault();
      e.stopPropagation();
      await this._handleTextPasteFromClipboard(text.trim(), false); // plain text
      return;
    }

    // PRIORITY 2: HTML - only for image URL detection (browser "Copy Image")
    const html = clipboardData.getData("text/html");
    if (html && html.trim()) {
      const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
      if (imgMatch) {
        const textContent = html.replace(/<[^>]*>/g, '').trim();
        if (!textContent || textContent.length < 10) {
          const imageUrl = imgMatch[1];
          console.log('[InteractionManager] Paste - detected image URL in HTML:', imageUrl.substring(0, 50));
          e.preventDefault();
          e.stopPropagation();
          await this._handleImageUrlPaste(imageUrl);
          return;
        }
      }
      // No image found, but no plain text either - use HTML as fallback
      e.preventDefault();
      e.stopPropagation();
      await this._handleTextPasteFromClipboard(html.trim(), true);
      return;
    }

    // PRIORITY 2: Image from system clipboard (only if no text)
    const items = clipboardData.items;
    console.log('[InteractionManager] Paste - clipboard items:', items?.length, 
      items ? Array.from(items).map(i => i.type).join(', ') : 'none');
    if (items) {
      for (let i = 0; i < items.length; i++) {
        console.log(`[InteractionManager] Paste - item[${i}]: type=${items[i].type}, kind=${items[i].kind}`);
        if (items[i].type.startsWith("image/")) {
          const imageFile = items[i].getAsFile();
          console.log('[InteractionManager] Paste - got image file:', imageFile?.size, imageFile?.type);
          if (imageFile) {
            e.preventDefault();
            e.stopPropagation();
            await this._handleImagePasteFromClipboard(imageFile);
            return;
          }
        }
      }
    }
    console.log('[InteractionManager] Paste - no image found in clipboard');
  }
}

// ==========================================
// 6. Foundry Persistence Adapter (Save/Load)
// ==========================================
class FoundryPersistenceAdapter {
  constructor() {
    this.FLAG_SCOPE = MODULE_ID;
    // Dynamic type registry: serializationKey -> flagKey
    this._storageTypes = new Map();
    // Register built-in types
    this.registerStorageType('text', 'texts');
    this.registerStorageType('image', 'images');
  }

  /**
   * Register a storage type for persistence
   * @param {string} serializationKey - Key returned by object.getSerializationKey()
   * @param {string} flagKey - Foundry flag key for storage
   */
  registerStorageType(serializationKey, flagKey) {
    this._storageTypes.set(serializationKey, flagKey);
    console.log(`[Persistence] Registered storage type: ${serializationKey} -> ${flagKey}`);
  }

  /**
   * Get all registered storage types
   * @returns {Map<string, string>}
   */
  getStorageTypes() {
    return this._storageTypes;
  }

  /**
   * Get flag key for a serialization key
   * @param {string} serializationKey
   * @returns {string|null}
   */
  getFlagKey(serializationKey) {
    return this._storageTypes.get(serializationKey) || null;
  }

  /**
   * Generic save by type
   * @param {string} serializationKey - Key returned by object.getSerializationKey()
   * @param {Object} data - Data to save
   */
  async saveByType(serializationKey, data) {
    if (!game.user?.isGM) return;
    const flagKey = this._storageTypes.get(serializationKey);
    if (!flagKey) {
      console.warn(`[Persistence] Unknown storage type: ${serializationKey}`);
      return;
    }
    if (!canvas?.scene) {
      console.warn(`[Persistence] No scene available, skipping save for ${serializationKey}`);
      return;
    }
    try {
      await canvas.scene.setFlag(this.FLAG_SCOPE, flagKey, data);
    } catch (error) {
      console.error(`[Persistence] Failed to save ${serializationKey}:`, error);
      throw error;
    }
  }

  /**
   * Generic load by type
   * @param {string} serializationKey - Key returned by object.getSerializationKey()
   * @returns {Object}
   */
  async loadByType(serializationKey) {
    const flagKey = this._storageTypes.get(serializationKey);
    if (!flagKey) {
      console.warn(`[Persistence] Unknown storage type: ${serializationKey}`);
      return {};
    }
    if (!canvas?.scene) {
      console.warn(`[Persistence] No scene available, returning empty ${serializationKey}`);
      return {};
    }
    try {
      return await canvas.scene.getFlag(this.FLAG_SCOPE, flagKey) || {};
    } catch (error) {
      console.error(`[Persistence] Failed to load ${serializationKey}:`, error);
      return {};
    }
  }

  // Legacy methods for backward compatibility (delegate to generic)
  async saveTexts(texts) { return this.saveByType('text', texts); }
  async saveImages(images) { return this.saveByType('image', images); }
  async loadTexts() { return this.loadByType('text'); }
  async loadImages() { return this.loadByType('image'); }

  /**
   * Delete a specific key from nested flag object
   * CRITICAL: setFlag does not remove missing keys from nested object: setFlag setFlag does not remove missing keys from nested objects
   * Use unsetFlag to remove a specific key
   * 
   * In Foundry VTT unsetFlag(scope, key) In Foundry VTT, unsetFlag(scope, key) removes the entire flag
   * To remove a nested key, use unsetFlag(scope, "key.subkey") unsetFlag(scope, "key.subkey")
   * For example: unsetFlag(scope, "images.objectId") will remove objectId from images: unsetFlag(scope, "images.objectId") unsetFlag(scope, "images.objectId") will remove objectId from images images
   */
  async deleteObjectFromFlag(objectId, flagKey) {
    if (!game.user?.isGM) return; // Only GM can remove
    if (!canvas?.scene) {
      console.warn(`[Persistence] No scene available, skipping deleteObjectFromFlag`);
      return;
    }
    try {
      // Use unsetFlag to remove a specific key from a nested object
      // Format: unsetFlag(scope, "flagKey.objectId") will remove objectId from flagKey
      const path = `${flagKey}.${objectId}`;
      await canvas.scene.unsetFlag(this.FLAG_SCOPE, path);
      console.log(`[Persistence] Deleted ${objectId} from flag ${flagKey} using unsetFlag with path: ${path}`);
    } catch (error) {
      console.error(`[Persistence] Failed to deleteObjectFromFlag ${objectId} from ${flagKey}:`, error);
      throw error;
    }
  }

  /**
   * Refresh flag cache from the database (force update) (force update)
   * Used after removal to synchronize the cache
   */
  async refreshFlagCache(flagKey) {
    if (!canvas?.scene) {
      console.warn(`[Persistence] No scene available, skipping refreshFlagCache`);
      return;
    }
    try {
      // Refresh cache via updateSource - this will load the latest data from the database
      await canvas.scene.updateSource({});
      console.log(`[Persistence] Refreshed flag cache for ${flagKey}`);
    } catch (error) {
      console.error(`[Persistence] Failed to refreshFlagCache for ${flagKey}:`, error);
      // // Do not throw an error - this is not critical
    }
  }
}

// ==========================================
// 7. Persistence Controller (Save/Load)
// ==========================================
class PersistenceController {
  constructor(registry, foundryAdapter) {
    this.registry = registry;
    this.foundryAdapter = foundryAdapter;
    this._debouncedSave = null;
    this._saveTimeout = null;
    this._saveDelay = 300; // Debounce delay in ms
    this._isLoading = false; // this._isLoading = false; // Flag to prevent saving during loading
    this._isSaving = false; // this._isSaving = false; // Flag to prevent parallel saves
    this._isDeleting = false; // this._isDeleting = false; // Flag to prevent saving during deletion (race condition protection)
  }

  /**
   * * Initialization: subscribe to Registry changes: subscribe to Registry changes Registry
   */
  init() {
    // // Subscribe to Registry changes for automatic saving
    this.registry.subscribe(this._handleRegistryChange.bind(this));
    console.log(`[Persistence] Initialized`);
  }

  /**
   * * Handle Registry changes for automatic saving
   * 
   * * ARCHITECTURE::
   * - * - Players: only send socket messages, DO NOT trigger saving: Players only send socket messages, DO NOT trigger saving, DO NOT trigger saving
   * - GM: * - GM: saves all changes (both local and remote from players via socket) (GM saves all changes (both local and remote from players via socket) local, and remote from players via socket)
   */
  _handleRegistryChange({ id, type, source }) {
    // For deletion - do not check _isLoading (deletion is not blocked by loading)
    if (type === 'deleted') {
      // Only GM deletes from the database
      if (game.user?.isGM) {
        console.log(`[Persistence] Delete request: id=${id}, source=${source}, isGM=${game.user?.isGM}`);
        this._deleteFromDB(id);
      }
      return;
    }

    // For created/updated - check _isLoading
    if (this._isLoading) return;

    // CRITICAL: Save only on GM
    // Players MUST NOT trigger saving (only send socket messages)
    if (!game.user?.isGM) return;

    // GM saves all changes:
    // - source='local': own actions (creation, editing)
    // - source='remote': player actions (received via socket and applied to Registry)
    // Debounced saving of all objects
    this._scheduleSave();
  }

  /**
   * Schedule saving (debounced) (debounced)
   */
  _scheduleSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      this._saveAll();
    }, this._saveDelay);
  }

  /**
   * Delete the object from the DB immediately
   * CRITICAL: setFlag does not delete keys, therefore the object must be explicitly deleted
   */
  async _deleteFromDB(id) {
    // The isGM check is already done in _handleRegistryChange

    // CRITICAL: Lock _saveAll during deletion to avoid race condition
    if (this._isSaving) {
      console.log(`[Persistence] Save in progress, waiting before delete`);
      while (this._isSaving) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Cancel any scheduled save
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }

    this._isDeleting = true;

    try {
      console.log(`[Persistence] Starting deletion of ${id} from DB`);
      
      // Generic: iterate over all registered storage types
      const storageTypes = this.foundryAdapter.getStorageTypes();
      const typeData = new Map(); // serializationKey -> {data, wasIn}
      
      // Load current data for all types
      for (const [serKey, flagKey] of storageTypes) {
        const data = await this.foundryAdapter.loadByType(serKey);
        typeData.set(serKey, { data, flagKey, wasIn: id in data });
      }
      
      // Log status
      const statusParts = [];
      for (const [serKey, info] of typeData) {
        statusParts.push(`${serKey}=${info.wasIn}`);
      }
      console.log(`[Persistence] Object ${id} in DB: ${statusParts.join(', ')}`);
      
      // Delete from all types where object exists
      let wasDeleted = false;
      for (const [serKey, info] of typeData) {
        if (!info.wasIn) continue;
        
        try {
          await this.foundryAdapter.deleteObjectFromFlag(id, info.flagKey);
          wasDeleted = true;
          console.log(`[Persistence] Deleted ${id} from ${serKey} using unsetFlag`);
        } catch (error) {
          // Fallback: Use setFlag
          console.warn(`[Persistence] unsetFlag failed for ${serKey}, using setFlag fallback:`, error);
          delete info.data[id];
          await this.foundryAdapter.saveByType(serKey, info.data);
          wasDeleted = true;
          console.log(`[Persistence] Deleted ${id} from ${serKey} using setFlag fallback`);
        }
      }
      
      // Refresh cache for all types
      if (wasDeleted) {
        const refreshPromises = [];
        for (const [, info] of typeData) {
          refreshPromises.push(this.foundryAdapter.refreshFlagCache(info.flagKey));
        }
        await Promise.all(refreshPromises);
      }
      
      if (!wasDeleted) {
        console.warn(`[Persistence] Object ${id} not found in DB for deletion`);
      } else {
        // Verify deletion with retries
        let attempts = 0;
        const maxAttempts = 3;
        let stillExists = true;
        
        while (attempts < maxAttempts && stillExists) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Check all types
          stillExists = false;
          for (const [serKey, info] of typeData) {
            if (!info.wasIn) continue;
            const dataAfter = await this.foundryAdapter.loadByType(serKey);
            if (id in dataAfter) {
              stillExists = true;
              console.warn(`[Persistence] Attempt ${attempts}/${maxAttempts}: Object ${id} still in ${serKey}!`);
              // Retry deletion
              delete dataAfter[id];
              await this.foundryAdapter.saveByType(serKey, dataAfter);
            }
          }
          
          if (!stillExists) {
            console.log(`[Persistence] Verified: Object ${id} deleted after ${attempts} attempt(s)`);
          }
        }
        
        if (stillExists) {
          console.error(`[Persistence] CRITICAL: Object ${id} STILL in DB after ${maxAttempts} attempts!`);
        }
      }
    } catch (error) {
      console.error(`[Persistence] Failed to delete ${id} from DB:`, error);
    } finally {
      this._isDeleting = false;
      console.log(`[Persistence] Completed deletion of ${id} from database`);
    }
  }

  /**
   * Save all objects to the DB
   * Uses toJSON() from objects (SSOT: Registry) toJSON() from objects (SSOT: Registry)
   */
  async _saveAll() {
    if (!game.user?.isGM) return; // Only GM saves

    // Protection against parallel saves
    if (this._isSaving) {
      console.log(`[Persistence] Save already in progress, skipping`);
      return;
    }

    // CRITICAL: Do not save during deletion to avoid overwriting the deletion
    if (this._isDeleting) {
      console.log(`[Persistence] Deletion in progress, skipping save to avoid race condition`);
      return;
    }

    this._isSaving = true;
    try {
      const allObjects = this.registry.getAll();

      // Generic: group objects by serialization key
      const dataByType = new Map(); // serializationKey -> { id: json }
      
      // Initialize buckets for all registered storage types
      for (const serKey of this.foundryAdapter.getStorageTypes().keys()) {
        dataByType.set(serKey, {});
      }

      allObjects.forEach(obj => {
        const json = obj.toJSON(); // SSOT: the object knows how to serialize itself
        const key = obj.getSerializationKey();
        
        // Ensure bucket exists (for custom types registered after init)
        if (!dataByType.has(key)) {
          dataByType.set(key, {});
        }
        
        dataByType.get(key)[obj.id] = json;
      });

      // Save all types via generic API
      const savePromises = [];
      for (const [serKey, data] of dataByType) {
        savePromises.push(this.foundryAdapter.saveByType(serKey, data));
      }
      await Promise.all(savePromises);

      // Refresh cache for all types
      const refreshPromises = [];
      for (const flagKey of this.foundryAdapter.getStorageTypes().values()) {
        refreshPromises.push(this.foundryAdapter.refreshFlagCache(flagKey));
      }
      await Promise.all(refreshPromises);

      // Log summary
      const summary = Array.from(dataByType.entries())
        .map(([key, data]) => `${Object.keys(data).length} ${key}s`)
        .join(', ');
      console.log(`[Persistence] Saved ${summary}`);
    } catch (error) {
      console.error(`[Persistence] Failed to saveAll:`, error);
    } finally {
      this._isSaving = false;
    }
  }

  /**
   * Load all objects from the database
   */
  async loadAll() {
    this._isLoading = true;
    try {
      const storageTypes = this.foundryAdapter.getStorageTypes();
      const loadedCounts = {};
      const allRanks = [];

      // Load all registered storage types
      for (const [serKey] of storageTypes) {
        const data = await this.foundryAdapter.loadByType(serKey);
        const objectType = this._serKeyToObjectType(serKey);
        
        // Collect ranks for duplicate detection
        Object.entries(data).forEach(([id, objData]) => {
          allRanks.push({ id: id.slice(-6), rank: objData.rank || '(none)', type: objectType });
        });
        
        // Check if type is registered (built-in or custom)
        if (Whiteboard.hasObjectType(objectType)) {
          // Type registered - load immediately
          let loaded = 0;
          Object.values(data).forEach(objData => {
            try {
              const obj = InteractionManager._createObjectFromType(objectType, objData);
              this.registry.register(obj, 'local');
              loaded++;
            } catch (e) {
              console.warn(`[Persistence] Failed to load ${objectType} ${objData.id}: ${e.message}`);
            }
          });
          loadedCounts[objectType] = loaded;
        } else if (Object.keys(data).length > 0) {
          // Custom type not registered yet - store for deferred loading
          const pendingKey = `_pending${objectType.charAt(0).toUpperCase() + objectType.slice(1)}s`;
          this[pendingKey] = data;
          loadedCounts[objectType] = `${Object.keys(data).length} pending`;
          console.log(`[Persistence] ${objectType} type not registered yet, ${Object.keys(data).length} objects will be loaded when module initializes`);
        }
      }
      
      // Check for duplicate ranks
      const rankCounts = {};
      allRanks.forEach(r => {
        rankCounts[r.rank] = (rankCounts[r.rank] || 0) + 1;
      });
      const duplicates = Object.entries(rankCounts).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        console.warn(`[Persistence] ⚠️ DUPLICATE RANKS in DB:`, duplicates.map(([rank, count]) => `"${rank}": ${count} objects`).join(', '));
      }

      // Log summary
      const summary = Object.entries(loadedCounts)
        .map(([type, count]) => `${count} ${type}s`)
        .join(', ');
      console.log(`[Persistence] Loaded ${summary}`);
    } catch (error) {
      console.error(`[Persistence] Failed to loadAll:`, error);
    } finally {
      this._isLoading = false;
    }
  }
  
  /**
   * Convert serialization key to object type
   * @param {string} serKey - Serialization key (e.g., 'text', 'image', 'cards')
   * @returns {string} Object type (e.g., 'text', 'image', 'card')
   */
  _serKeyToObjectType(serKey) {
    // Handle plural forms: 'cards' -> 'card', 'texts' -> 'text'
    if (serKey.endsWith('s') && serKey !== 'text' && serKey !== 'image') {
      return serKey.slice(0, -1);
    }
    return serKey;
  }

  /**
   * Load pending objects of a specific type (called when type is registered after initial load)
   * @param {string} type - Object type to load
   */
  loadPendingByType(type) {
    const pendingKey = `_pending${type.charAt(0).toUpperCase() + type.slice(1)}s`;
    const pending = this[pendingKey];
    
    if (!pending || Object.keys(pending).length === 0) {
      return;
    }
    
    console.log(`[Persistence] Loading ${Object.keys(pending).length} pending ${type}s`);
    this._isLoading = true;
    
    try {
      let loaded = 0;
      Object.values(pending).forEach(data => {
        try {
          const obj = InteractionManager._createObjectFromType(type, data);
          this.registry.register(obj, 'local');
          loaded++;
        } catch (e) {
          console.warn(`[Persistence] Failed to load pending ${type} ${data.id}: ${e.message}`);
        }
      });
      console.log(`[Persistence] Loaded ${loaded} pending ${type}s`);
    } finally {
      this[pendingKey] = null;
      this._isLoading = false;
    }
  }

  /**
   * Resource cleanup
   */
  cleanup() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
  }
}

// ==========================================
// 8. Socket & Sync (Network)
// ==========================================
class SocketController {
  constructor(registry, interactionManager = null, layer = null) {
    this.registry = registry;
    this.interactionManager = interactionManager; // Explicit dependency for state checks
    this.layer = layer; // For access to DOM containers
    // Track last GM status check to avoid excessive checks
    this._lastGMStatusCheck = 0;
    this._lastGMStatus = null;
    this._gmCheckDebounceMs = 1000; // Check GM status at most once per second
  }
  init() {
    // Subscribe to Registry
    this.registry.subscribe(this._handleLocalChange.bind(this));

    // Listen to Socket
    console.log(`[Socket] Registering listener for ${SOCKET_NAME}`);
    game.socket.on(SOCKET_NAME, this._handleSocketMessage.bind(this));
    
    // Initialize GM status for non-GM users
    if (!game.user?.isGM) {
      this._lastGMStatus = hasConnectedGM();
      this._lastGMStatusCheck = Date.now();
    }
  }

  /**
   * Send a special socket message (for imageLock/imageUnlock and other actions) (for imageLock/imageUnlock and other actions)
   * @param {string} action - @param {string} action - Action (imageLock, imageUnlock, etc.) (imageLock, imageUnlock, etc.)
   * @param {object} data - @param {object} data - Data to send
   */
  emit(action, data) {
    if (!game.socket) {
      console.warn(`[Socket] game.socket not available, skipping ${action}`);
      return;
    }
    const payload = {
      action: action,
      ...data,
      timestamp: Date.now(),
      userId: game.user?.id
    };
    try {
      game.socket.emit(SOCKET_NAME, payload);
      console.log(`[Socket] Emitted ${action}`, data);
    } catch (error) {
      console.error(`[Socket] Failed to emit ${action}:`, error);
    }
  }
  _handleLocalChange({
    id,
    type,
    data,
    source,
    changes
  }) {
    if (source === 'remote') return; // Don't echo back

    // UI-only properties that should NOT be sent to other clients
    // These are local UI state, not shared data
    const UI_ONLY_PROPS = ['selected', 'massSelected'];

    // For 'updated' type: filter out UI-only changes
    if (type === 'updated' && changes) {
      const changeKeys = Object.keys(changes);
      // Filter out UI-only properties
      const dataChanges = changeKeys.filter(key => !UI_ONLY_PROPS.includes(key));
      // If ALL changes are UI-only - skip socket entirely
      if (dataChanges.length === 0) {
        // No data changes, only UI state - don't send to socket
        return;
      }
    }

    // During drag: skip socket emit to prevent socket spam on every pixel
    // Socket will be updated only once in _endDrag() with final position
    // Check if object is being dragged via explicit dependency
    if (type === 'updated' && this.interactionManager?.isDragging(id)) {
      // Object is being dragged - skip socket emit, will be sent in _endDrag()
      return;
    }

    // During scale resize: skip socket emit to prevent socket spam on every pixel
    // Socket will be updated only once in _endScaleResize() with final scale
    // Borders and gizmo are updated locally via Layer during scale resize (not affected by socket skip)
    if (type === 'updated' && this.interactionManager?.isScaling(id)) {
      // Object is being scaled - skip socket emit, will be sent in _endScaleResize()
      return;
    }

    // During crop drag: skip socket emit to prevent socket spam on every pixel
    // Socket will be updated only once in _endCropDrag() with final crop values
    if (type === 'updated' && this.interactionManager?.isCroppingDrag(id)) {
      // Object is being crop-dragged - skip socket emit, will be sent in _endCropDrag()
      return;
    }

    // Check if socket is available (may not be ready during tests or early init)
    if (!game.socket) {
      console.warn(`[Socket] game.socket not available, skipping ${type} for ${id}`);
      return;
    }
    
    // Check GM status before emitting (only for non-GM users, with debounce)
    // This ensures indicator updates when player interacts, even if Hooks don't fire
    if (!game.user?.isGM) {
      const now = Date.now();
      if (now - this._lastGMStatusCheck >= this._gmCheckDebounceMs) {
        const currentGMStatus = hasConnectedGM();
        if (this._lastGMStatus !== null && this._lastGMStatus !== currentGMStatus) {
          console.log('[GM Warning] Socket: GM status changed during interaction, hasGM =', currentGMStatus);
          updateGMWarningIndicator();
        }
        this._lastGMStatus = currentGMStatus;
        this._lastGMStatusCheck = now;
      }
    }
    
    console.log(`[Socket] Emitting ${type} for ${id}`);
    const jsonData = data ? data.toJSON ? data.toJSON() : data : null;
    // CRITICAL: Log content for debugging text transmission
    if (type === 'created' && jsonData && jsonData.type === 'text') {
      console.log(`[Socket] Created text object: id=${id}, text="${jsonData.text}", textLength=${jsonData.text?.length || 0}`);
    }
    if (type === 'updated' && jsonData && jsonData.type === 'text') {
      console.log(`[Socket] Updated text object: id=${id}, text="${jsonData.text}", textLength=${jsonData.text?.length || 0}`);
    }
    const payload = {
      action: type,
      // 'created', 'updated', 'deleted'
      id: id,
      data: jsonData,
      timestamp: Date.now(), // timestamp: Date.now(), // Timestamp to prevent race conditions
      userId: game.user?.id // For debugging
    };
    try {
      game.socket.emit(SOCKET_NAME, payload);
    } catch (error) {
      console.error(`[Socket] Failed to emit ${type} for ${id}:`, error);
    }
  }
  _handleSocketMessage(payload) {
    console.log(`[Socket] Received message`, payload);
    const {
      action,
      id,
      data,
      timestamp,
      userId
    } = payload;

    // CRITICAL: Log content for debugging text retrieval
    if (action === 'created' && data && data.type === 'text') {
      console.log(`[Socket] Received created text: id=${id}, text="${data.text}", textLength=${data.text?.length || 0}`);
    }
    if (action === 'updated' && data && data.type === 'text') {
      console.log(`[Socket] Received updated text: id=${id}, text="${data.text}", textLength=${data.text?.length || 0}`);
    }

    // We receive plain JSON, need to hydrate if creating
    if (action === 'created') {
      // Duplicate protection: if the object already exists in Registry (created locally),
      // do not register it again with source='remote'
      // This prevents overwriting locally created objects with remote data
      const existingObj = this.registry.get(id);
      if (existingObj) {
        console.log(`[Socket] Object ${id} already exists in Registry, skipping remote registration`, {
          existingId: existingObj.id,
          existingType: existingObj.type,
          registrySize: this.registry.objects?.size || 0
        });
        return;
      }
      console.log(`[Socket] Registering remote object ${id}`, {
        registrySizeBefore: this.registry.objects?.size || 0
      });
      // DRY: Use a factory instead of multiple if/else
      const obj = InteractionManager._createObjectFromType(data.type, data);
      this.registry.register(obj, 'remote');
      console.log(`[Socket] Registered remote object ${id}`, {
        registrySizeAfter: this.registry.objects?.size || 0
      });
    } else if (action === 'updated') {
      // CRITICAL: Skip updates for locked objects (being cropped/edited by another user)
      // BUT: Accept updates from the lock owner (final values after they finish)
      const container = document.getElementById(id);
      if (container) {
        const lockedBy = container.dataset.lockedBy;
        const isCropping = container.getAttribute('data-cropping') === 'true';
        const isEditing = container.getAttribute('data-editing') === 'true';
        // Skip if: object is locked AND lock is not by us AND update is not from lock owner
        if ((isCropping || isEditing) && lockedBy && lockedBy !== game.user?.id && userId !== lockedBy) {
          console.log(`[Socket] Skipping update for locked object ${id} (locked by ${lockedBy}, update from ${userId})`);
          return;
        }
      }
      
      // 🔍 SCALE DEBUG: Log socket update with scale
      if (data && data.scale !== undefined) {
        const obj = this.registry.get(id);
        const oldScale = obj?.scale;
        console.log(`[SCALE DEBUG] Socket update: id=${id?.slice(-6)}, OLD scale=${oldScale}, NEW scale=${data.scale}, timestamp=${timestamp}, userId=${userId}`, {
          timestamp: Date.now(),
          socketTimestamp: timestamp,
          oldScale,
          newScale: data.scale,
          userId
        });
      }
      // Pass metadata with timestamp to prevent race conditions
      this.registry.update(id, data, 'remote', {
        timestamp: timestamp || Date.now(),
        userId: userId
      });
    } else if (action === 'deleted') {
      this.registry.unregister(id, 'remote');
    } else if (action === 'imageLock') {
      // Handle image lock for crop mode
      const { imageId, userId: lockUserId, userName } = payload;
      this._handleImageLock(imageId, lockUserId, userName);
    } else if (action === 'imageUnlock') {
      // Handle image unlock after crop mode
      const { imageId } = payload;
      this._handleImageUnlock(imageId);
    } else if (action === 'textLock') {
      // Handle text lock for edit mode
      const { textId, userId: lockUserId, userName } = payload;
      this._handleTextLock(textId, lockUserId, userName);
    } else if (action === 'textUnlock') {
      // Handle text unlock after edit mode
      const { textId } = payload;
      this._handleTextUnlock(textId);
    } else if (action === 'gmStatusChange') {
      // Handle GM status change (online/offline)
      // Update indicator on all clients when GM connects/disconnects
      const { hasGM } = payload;
      console.log('[GM Warning] Socket: GM status changed, hasGM =', hasGM);
      updateGMWarningIndicator();
    }
  }

  /**
   * Handle image lock (crop mode on another client) (crop mode on another client)
   * @param {string} imageId - ID images
   * @param {string} lockUserId - ID user, who locked
   * @param {string} userName - User name, who locked
   */
  _handleImageLock(imageId, lockUserId, userName) {
    // Do not block your own locks
    if (lockUserId === game.user?.id) {
      return;
    }

    const obj = this.registry.get(imageId);
    if (!obj || obj.type !== 'image') {
      console.warn(`[Socket] imageLock: image ${imageId} not found`);
      return;
    }

    const container = this.layer?.getObjectContainer(imageId);
    if (!container) {
      console.warn(`[Socket] imageLock: container for ${imageId} not found`);
      return;
    }

    // Set the lock
    container.dataset.lockedBy = lockUserId;
    container.setAttribute('data-locked-by-name', userName || lockUserId);

    // Visually indicate the lock: add class and overlay
    container.classList.add('wbe-image-locked');
    
    // Create overlay for visual lock indication
    let lockOverlay = container.querySelector('.wbe-image-lock-overlay');
    if (!lockOverlay) {
      lockOverlay = document.createElement('div');
      lockOverlay.className = 'wbe-image-lock-overlay';
      lockOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.3);
        pointer-events: none;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      // Lock icon instead of text
      const lockIcon = document.createElement('i');
      lockIcon.className = 'fas fa-lock';
      lockIcon.style.cssText = `
        color: white;
        font-size: 24px;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
      `;
      lockOverlay.appendChild(lockIcon);
      container.appendChild(lockOverlay);
    }

    console.log(`[Socket] Image ${imageId} locked by ${userName || lockUserId}`);

    // If the image was selected on this client, deselect it
    if (this.interactionManager?.selectedId === imageId) {
      this.interactionManager._deselect();
    }
  }

  /**
   * Handle image unlock (exit crop mode on another client) (exit from crop mode on another client)
   * @param {string} imageId - ID images
   */
  _handleImageUnlock(imageId) {
    const container = this.layer?.getObjectContainer(imageId);
    if (!container) {
      return;
    }

    // Remove the lock
    delete container.dataset.lockedBy;
    container.removeAttribute('data-locked-by-name');
    container.classList.remove('wbe-image-locked');

    // Remove the visual overlay
    const lockOverlay = container.querySelector('.wbe-image-lock-overlay');
    if (lockOverlay) {
      lockOverlay.remove();
    }

    console.log(`[Socket] Image ${imageId} unlocked`);
  }

  /**
   * Handle text lock (edit mode on another client)
   * @param {string} textId - ID of text object
   * @param {string} lockUserId - ID of user who locked
   * @param {string} userName - Name of user who locked
   */
  _handleTextLock(textId, lockUserId, userName) {
    // Do not block your own locks
    if (lockUserId === game.user?.id) {
      return;
    }

    const obj = this.registry.get(textId);
    if (!obj || obj.type !== 'text') {
      console.warn(`[Socket] textLock: text ${textId} not found`);
      return;
    }

    const container = this.layer?.getObjectContainer(textId);
    if (!container) {
      console.warn(`[Socket] textLock: container for ${textId} not found`);
      return;
    }

    // Set the lock
    container.dataset.lockedBy = lockUserId;
    container.setAttribute('data-locked-by-name', userName || lockUserId);
    container.setAttribute('data-editing', 'true');

    // Visually indicate the lock: add class and overlay
    container.classList.add('wbe-text-locked');
    
    // Create overlay for visual lock indication
    let lockOverlay = container.querySelector('.wbe-text-lock-overlay');
    if (!lockOverlay) {
      lockOverlay = document.createElement('div');
      lockOverlay.className = 'wbe-text-lock-overlay';
      lockOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.3);
        pointer-events: none;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      // Lock icon instead of text
      const lockIcon = document.createElement('i');
      lockIcon.className = 'fas fa-lock';
      lockIcon.style.cssText = `
        color: white;
        font-size: 24px;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
      `;
      lockOverlay.appendChild(lockIcon);
      container.appendChild(lockOverlay);
    }

    console.log(`[Socket] Text ${textId} locked by ${userName || lockUserId}`);

    // If the text was selected on this client, deselect it
    if (this.interactionManager?.selectedId === textId) {
      this.interactionManager._deselect();
    }
  }

  /**
   * Handle text unlock (exit edit mode on another client)
   * @param {string} textId - ID of text object
   */
  _handleTextUnlock(textId) {
    const container = this.layer?.getObjectContainer(textId);
    if (!container) {
      return;
    }

    // Remove the lock
    delete container.dataset.lockedBy;
    container.removeAttribute('data-locked-by-name');
    container.removeAttribute('data-editing');
    container.classList.remove('wbe-text-locked');

    // Remove the visual overlay
    const lockOverlay = container.querySelector('.wbe-text-lock-overlay');
    if (lockOverlay) {
      lockOverlay.remove();
    }

    console.log(`[Socket] Text ${textId} unlocked`);
  }
}

// ==========================================
// GM Warning Indicator
// ==========================================

/**
 * Check if any GM is currently connected and active
 * @returns {boolean} True if at least one GM is active
 */
function hasConnectedGM() {
  if (!game.users) {
    console.log('[GM Warning] hasConnectedGM: game.users is not available');
    return false;
  }
  
  // Log all users for debugging
  const allUsers = Array.from(game.users.values());
  const gmUsers = allUsers.filter(u => u.isGM);
  console.log('[GM Warning] All users:', allUsers.map(u => ({ id: u.id, name: u.name, isGM: u.isGM, active: u.active })));
  console.log('[GM Warning] GM users:', gmUsers.map(u => ({ id: u.id, name: u.name, active: u.active })));
  
  // Optimized for Collection: iterate directly without creating array
  for (const user of game.users.values()) {
    if (user.active && user.isGM) {
      console.log('[GM Warning] hasConnectedGM: TRUE - Found active GM:', user.name);
      return true;
    }
  }
  
  console.log('[GM Warning] hasConnectedGM: FALSE - No active GM found');
  return false;
}

/**
 * Inject GM warning indicator CSS styles
 */
function injectGMWarningIndicatorCSS() {
  if (document.getElementById("wbe-gm-warning-indicator-style")) return;
  
  const style = document.createElement("style");
  style.id = "wbe-gm-warning-indicator-style";
  style.textContent = `
    .wbe-gm-warning-indicator {
      position: fixed;
      top: -2px; 
      max-height: 32px;
      left: 40%;
      background: rgba(200, 50, 50, 0.9);  /* Red background for warning */
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: bold;
      z-index: ${ZINDEX_GM_WARNING_INDICATOR};
      display: none;
      border: 1px solid rgba(255, 100, 100, 0.8);  /* Red border */
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Create GM warning indicator element
 */
function createGMWarningIndicator() {
  // Check if already exists
  if (document.getElementById("wbe-gm-warning-indicator")) return;
  
  const indicator = document.createElement("div");
  indicator.className = "wbe-gm-warning-indicator";
  indicator.id = "wbe-gm-warning-indicator";
  document.body.appendChild(indicator);
}

/**
 * Update GM warning indicator visibility and text
 */
function updateGMWarningIndicator() {
  const indicator = document.getElementById("wbe-gm-warning-indicator");
  if (!indicator) {
    console.log('[GM Warning] updateGMWarningIndicator: Indicator element not found');
    return;
  }
  
  // Hide for GM (GM doesn't need this warning)
  if (game.user?.isGM) {
    console.log('[GM Warning] updateGMWarningIndicator: Current user is GM, hiding indicator');
    indicator.style.display = "none";
    return;
  }
  
  // Check if GM is connected
  const hasGM = hasConnectedGM();
  console.log('[GM Warning] updateGMWarningIndicator: hasGM =', hasGM);
  
  if (!hasGM) {
    console.log('[GM Warning] updateGMWarningIndicator: Showing warning - GM is not online');
    indicator.textContent = "GM is not online, you can't save WBE content!";
    indicator.style.display = "flex";
  } else {
    console.log('[GM Warning] updateGMWarningIndicator: Hiding warning - GM is online');
    indicator.style.display = "none";
  }
}

/**
 * Initialize GM warning indicator system
 */
function _initGMWarningIndicator() {
  // Inject CSS styles
  injectGMWarningIndicatorCSS();
  
  // Create indicator element
  createGMWarningIndicator();
  
  // Initial update
  updateGMWarningIndicator();
  
  // Subscribe to user events - FILTERED BY GM
  // Only update indicator when GM status changes, not for all users
  Hooks.on("updateUser", (user, data, _options, _userId) => {
    console.log('[GM Warning] updateUser Hook fired:', {
      userId: user.id,
      userName: user.name,
      isGM: user.isGM,
      active: user.active,
      dataActive: data.active,
      hasActiveInData: data.hasOwnProperty("active"),
      allData: data
    });
    
    // Only process GM users
    if (!user.isGM) {
      console.log('[GM Warning] updateUser: Not a GM user, skipping');
      return;
    }
    
    // Only update if active status changed
    if (data.hasOwnProperty("active")) {
      console.log('[GM Warning] updateUser: GM active status changed, scheduling update. data.active =', data.active);
      
      // Send socket event to notify all clients about GM status change
      // Check hasConnectedGM() after update (user is already updated in game.users)
      // This ensures instant synchronization even if game.users is not synced on other clients yet
      if (game.socket) {
        // Use requestAnimationFrame to ensure game.users is updated before checking
        requestAnimationFrame(() => {
          const hasGM = hasConnectedGM();
          try {
            game.socket.emit(SOCKET_NAME, {
              action: 'gmStatusChange',
              hasGM: hasGM,
              timestamp: Date.now(),
              userId: game.user?.id
            });
            console.log('[GM Warning] Socket: Sent gmStatusChange event, hasGM =', hasGM);
          } catch (error) {
            console.error('[GM Warning] Socket: Failed to emit gmStatusChange:', error);
          }
        });
      }
      
      // Double requestAnimationFrame to ensure game.users is synchronized
      // First frame: wait for Foundry's internal updates
      // Second frame: ensure DOM and game.users are fully updated
      requestAnimationFrame(() => {
        console.log('[GM Warning] updateUser: First RAF frame');
        requestAnimationFrame(() => {
          console.log('[GM Warning] updateUser: Second RAF frame, calling updateGMWarningIndicator');
      updateGMWarningIndicator();
        });
      });
    } else {
      console.log('[GM Warning] updateUser: No active status change in data');
    }
  });
  
  Hooks.on("createUser", (user, _options, _userId) => {
    console.log('[GM Warning] createUser Hook fired:', {
      userId: user.id,
      userName: user.name,
      isGM: user.isGM,
      active: user.active
    });
    
    // Only process GM users
    if (user.isGM) {
      console.log('[GM Warning] createUser: GM user created, scheduling update');
      
      // Send socket event to notify all clients about GM status change
      if (game.socket && user.active) {
        try {
          game.socket.emit(SOCKET_NAME, {
            action: 'gmStatusChange',
            hasGM: true,
            timestamp: Date.now(),
            userId: game.user?.id
          });
          console.log('[GM Warning] Socket: Sent gmStatusChange event (createUser), hasGM = true');
        } catch (error) {
          console.error('[GM Warning] Socket: Failed to emit gmStatusChange:', error);
        }
      }
      
      // Double requestAnimationFrame to ensure game.users is synchronized
      requestAnimationFrame(() => {
        console.log('[GM Warning] createUser: First RAF frame');
        requestAnimationFrame(() => {
          console.log('[GM Warning] createUser: Second RAF frame, calling updateGMWarningIndicator');
      updateGMWarningIndicator();
        });
      });
    } else {
      console.log('[GM Warning] createUser: Not a GM user, skipping');
    }
  });
  
  Hooks.on("deleteUser", (user, _options, _userId) => {
    console.log('[GM Warning] deleteUser Hook fired:', {
      userId: user.id,
      userName: user.name,
      isGM: user.isGM,
      active: user.active
    });
    
    // Only process GM users
    if (user.isGM) {
      console.log('[GM Warning] deleteUser: GM user deleted, scheduling update');
      
      // Send socket event to notify all clients about GM status change
      // Check if any other GM is still active
      const hasOtherGM = hasConnectedGM();
      if (game.socket) {
        try {
          game.socket.emit(SOCKET_NAME, {
            action: 'gmStatusChange',
            hasGM: hasOtherGM,
            timestamp: Date.now(),
            userId: game.user?.id
          });
          console.log('[GM Warning] Socket: Sent gmStatusChange event (deleteUser), hasGM =', hasOtherGM);
        } catch (error) {
          console.error('[GM Warning] Socket: Failed to emit gmStatusChange:', error);
        }
      }
      
      // Double requestAnimationFrame to ensure game.users is synchronized
      requestAnimationFrame(() => {
        console.log('[GM Warning] deleteUser: First RAF frame');
        requestAnimationFrame(() => {
          console.log('[GM Warning] deleteUser: Second RAF frame, calling updateGMWarningIndicator');
      updateGMWarningIndicator();
        });
      });
    } else {
      console.log('[GM Warning] deleteUser: Not a GM user, skipping');
    }
  });
}

// ==========================================
// Main Entry
// ==========================================
class Whiteboard {
  // Registry for custom object types (extensibility API)
  static _customTypes = new Map();

  /**
   * Register a custom object type (extensibility API for other modules)
   * 
   * @param {string} type - Unique type identifier (e.g., 'card', 'note')
   * @param {Object} config - Type configuration
   * @param {Function} config.ViewClass - Class extending WhiteboardObject with render() method
   * @param {Function} [config.PanelClass] - Optional panel class with show(id)/hide() methods
   * @param {Function} [config.factory] - Optional factory function (data) => instance
   * 
   * @example
   * // In your module:
   * Hooks.once('ready', () => {
   *   window.Whiteboard.registerObjectType('card', {
   *     ViewClass: FateCardView,
   *     PanelClass: FateCardPanel,
   *     factory: (data) => new FateCardView(data)
   *   });
   * });
   */
  static registerObjectType(type, config) {
    if (!type || typeof type !== 'string') {
      throw new Error('registerObjectType: type must be a non-empty string');
    }
    if (!config || !config.ViewClass) {
      throw new Error('registerObjectType: config.ViewClass is required');
    }
    
    this._customTypes.set(type, config);
    console.log(`${MODULE_ID} | Registered custom type: ${type}`);
    
    // If already initialized, register panel immediately
    if (this.interaction?.panels && config.PanelClass) {
      this.interaction.panels[type] = new config.PanelClass(this.registry, this.layer);
    }
    
    // Load pending objects of this type (if any were saved before type was registered)
    if (this.persistence && this.persistence.loadPendingByType) {
      this.persistence.loadPendingByType(type);
    }
    
    return true;
  }

  /**
   * Check if a custom type is registered
   * @param {string} type - Type identifier
   * @returns {boolean}
   */
  static hasObjectType(type) {
    return type === 'text' || type === 'image' || this._customTypes.has(type);
  }

  /**
   * Get custom type config
   * @param {string} type - Type identifier
   * @returns {Object|null}
   */
  static getObjectTypeConfig(type) {
    return this._customTypes.get(type) || null;
  }

  /**
   * Register a storage type for persistence
   * Call this when registering a custom object type that needs DB persistence
   * @param {string} serializationKey - Key returned by object.getSerializationKey()
   * @param {string} flagKey - Foundry flag key for storage (e.g., 'cards')
   * @example
   * // In your module:
   * Whiteboard.registerStorageType('cards', 'cards');
   * Whiteboard.registerObjectType('card', { ViewClass: FateCardView, ... });
   */
  static registerStorageType(serializationKey, flagKey) {
    if (this.persistenceAdapter) {
      this.persistenceAdapter.registerStorageType(serializationKey, flagKey);
    } else {
      // Store for later registration when persistence is initialized
      if (!this._pendingStorageTypes) {
        this._pendingStorageTypes = [];
      }
      this._pendingStorageTypes.push({ serializationKey, flagKey });
      console.log(`${MODULE_ID} | Queued storage type registration: ${serializationKey} -> ${flagKey}`);
    }
  }

  /**
   * Get all container selectors (built-in + custom types)
   * Used for hit-testing and DOM queries
   * @returns {string} CSS selector string
   */
  static getAllContainerSelectors() {
    const selectors = ['.wbe-text-container', '.wbe-image-container'];
    
    // Add selectors from custom types
    for (const [type, config] of this._customTypes) {
      if (config.ViewClass?.prototype?.getContainerSelector) {
        // Create temp instance to get selector
        const tempObj = new config.ViewClass({ id: 'temp', type });
        const selector = tempObj.getContainerSelector();
        if (selector && !selectors.includes(selector)) {
          selectors.push(selector);
        }
      } else {
        // Default selector pattern
        selectors.push(`.wbe-${type}-container`);
      }
    }
    
    return selectors.join(', ');
  }

  static _ensureInitialized() {
    if (!this.registry) {
      console.warn(`${MODULE_ID} | Auto-initializing (init() was not called)`);
      try {
        this.init();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to initialize:`, error);
        throw error;
      }
    }
    if (!this.registry) {
      throw new Error(`${MODULE_ID} | Registry is still undefined after init()`);
    }
  }
  static async init() {
    try {
      // Cleanup existing instances if reinitializing
      if (this.interaction) {
        this.interaction.cleanup();
      }
      if (this.layer) {
        this.layer._destroyLayer();
      }
      if (this.registry) {
        console.warn(`[Whiteboard] Registry already exists, clearing it (objects: ${this.registry.objects?.size || 0})`);
      }
      this.registry = new ObjectRegistry();
      console.log(`[Whiteboard] Created new Registry`);
      this.layer = new WhiteboardLayer(this.registry);
      this.interaction = new InteractionManager(this.registry, this.layer);
      this.socket = new SocketController(this.registry, this.interaction, this.layer); // Pass interactionManager and layer explicitly
      
      // Set socket controller in InteractionManager (must be after socket is created)
      this.interaction.setSocketController(this.socket);
      
      // Initialize persistence (Foundry persistence adapter + persistence controller)
      this.persistenceAdapter = new FoundryPersistenceAdapter();
      
      // Register any pending storage types (registered before init)
      if (this._pendingStorageTypes) {
        for (const { serializationKey, flagKey } of this._pendingStorageTypes) {
          this.persistenceAdapter.registerStorageType(serializationKey, flagKey);
        }
        this._pendingStorageTypes = null;
      }
      
      this.persistence = new PersistenceController(this.registry, this.persistenceAdapter);

      // Set InteractionManager reference in Layer to access drag state (InteractionManager owns drag state)
      this.layer.setInteractionManager(this.interaction);
      this.layer.init();
      this.interaction.init();
      this.socket.init();
      this.persistence.init();
      
      // Initialize GM warning indicator
      _initGMWarningIndicator();

      // Register mass selection tool in Foundry UI (uses getSceneControlButtons hook)
      MassSelectionToolInjector.register(this.interaction.massSelection);
      
      // Register panels for custom types (if any were registered before init)
      for (const [type, config] of this._customTypes) {
        if (config.PanelClass && !this.interaction.panels[type]) {
          this.interaction.panels[type] = new config.PanelClass(this.registry, this.layer);
          console.log(`${MODULE_ID} | Registered panel for custom type: ${type}`);
        }
      }
      
      // Load objects from database after initialization
      await this.persistence.loadAll();
      
      console.log(`${MODULE_ID} | Initialized successfully`);
    } catch (error) {
      console.error(`${MODULE_ID} | Init error:`, error);
      // Reset state on error
      if (this.interaction) {
        try {
          this.interaction.cleanup();
        } catch {}
      }
      if (this.layer) {
        try {
          this.layer._destroyLayer();
        } catch {}
      }
      this.registry = null;
      this.layer = null;
      this.interaction = null;
      this.socket = null;
      this.persistenceAdapter = null;
      this.persistence = null;
      throw error;
    }
  }
  static destroy() {
    if (this.interaction) {
      this.interaction.cleanup();
      this.interaction = null;
    }
    if (this.layer) {
      this.layer._destroyLayer();
      this.layer = null;
    }
    if (this.socket) {
      // Socket cleanup if needed
      this.socket = null;
    }
    if (this.persistence) {
      this.persistence.cleanup();
      this.persistence = null;
    }
    this.persistenceAdapter = null;
    this.registry = null;
    console.log(`${MODULE_ID} | Destroyed`);
  }
  static createText(text, x, y) {
    this._ensureInitialized();
    if (!this.registry) {
      throw new Error(`${MODULE_ID} | Registry is undefined in createText`);
    }
    // DRY: Use factory instead of direct constructor
    const obj = InteractionManager._createObjectFromType('text', {
      text,
      x,
      y
    });
    this.registry.register(obj, 'local');
    return obj;
  }
  static createImage(src, x, y, width, height) {
    this._ensureInitialized();
    // DRY: Use factory instead of direct constructor
    const obj = InteractionManager._createObjectFromType('image', {
      src,
      x,
      y,
      width,
      height
    });
    this.registry.register(obj, 'local');
    return obj;
  }

  // Helper methods for manual testing
  static getAllObjects() {
    this._ensureInitialized();
    return this.registry.getAll();
  }
  static getObject(id) {
    this._ensureInitialized();
    return this.registry.get(id);
  }
  static deleteObject(id) {
    this._ensureInitialized();
    this.registry.unregister(id, 'local');
  }
  
  /**
   * Diagnostic function to debug z-index issues
   * Usage in console: Whiteboard.debugZIndex()
   */
  static debugZIndex() {
    this._ensureInitialized();
    const objects = this.registry.getAll();
    
    console.log('=== Z-INDEX DEBUG ===');
    console.log('Total objects:', objects.length);
    
    // Sort by z-index
    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    
    console.table(sorted.map(o => ({
      id: o.id.slice(-6),
      type: o.type,
      rank: o.rank,
      zIndex: o.zIndex,
      selected: o.selected,
      textWidth: o.textWidth || '-',
      x: Math.round(o.x),
      y: Math.round(o.y)
    })));
    
    // Check for duplicate ranks
    const ranks = objects.map(o => o.rank);
    const duplicates = ranks.filter((r, i) => ranks.indexOf(r) !== i);
    if (duplicates.length > 0) {
      console.warn('⚠️ DUPLICATE RANKS:', duplicates);
    }
    
    // Check if DOM z-index matches Registry
    console.log('\n=== DOM vs Registry ===');
    for (const obj of sorted) {
      const container = document.querySelector(`[data-object-id="${obj.id}"]`);
      if (container) {
        const domZ = parseInt(container.style.zIndex) || 0;
        const match = domZ === obj.zIndex ? '✅' : '❌';
        console.log(`${match} ${obj.id.slice(-6)}: Registry z=${obj.zIndex}, DOM z=${domZ}`);
      }
    }
    
    return sorted;
  }
  static updateObject(id, changes) {
    this._ensureInitialized();
    this.registry.update(id, changes, 'local');
  }
  static setMode(mode) {
    this._ensureInitialized();
    if (this.interaction) {
      this.interaction.setMode(mode);
    }
  }
  static getMode() {
    this._ensureInitialized();
    return this.interaction ? this.interaction.mode : null;
  }
  static clearAll() {
    this._ensureInitialized();
    // Get all registered IDs
    const allIds = this.registry.getAllIds();
    if (allIds.length === 0) {
      console.log(`${MODULE_ID} | clearAll(): No objects to clear`);
      return;
    }

    // Unregister all objects (this will trigger socket events if socket controller is ready)
    // Note: Socket events will be sent automatically via SocketController._handleLocalChange()
    allIds.forEach(id => {
      const obj = this.registry.get(id);
      if (obj) {
        // Use 'local' source - socket controller will handle broadcasting
        this.registry.unregister(id, 'local');
      }
    });

    // Clear selection
    if (this.interaction) {
      this.interaction._deselect();
    }
    console.log(`${MODULE_ID} | Cleared all objects (${allIds.length} removed)`);

    // NOTE: Socket sync is partially implemented (STEP 9 not complete)
    // If socket is not ready or events don't propagate, objects are cleared locally only
    // Other clients may need to refresh (F5) to see the changes until full socket sync is ready
  }
}

// Initialization must be called explicitly from scripts/main.mjs
// Do NOT use automatic hook here to avoid conflicts

window.Whiteboard = Whiteboard;

// Export base classes for extensibility (other modules can extend these)
window.WhiteboardObject = WhiteboardObject;
window.WhiteboardText = WhiteboardText;
window.WhiteboardImage = WhiteboardImage;

// Export settings functions for initialization from scripts/main.mjs
window.WBE_registerSettings = registerModuleSettings;
window.WBE_loadGoogleFonts = _loadGoogleFonts;
window.WBE_isFeatureEnabled = isFeatureEnabled;

// Export ZIndexModel for testing (can be removed in production)
window.ZIndexModel = ZIndexModel;
// Debug helper for state inspection
window.WhiteboardDebug = {
  checkState() {
    return {
      whiteboardExists: !!window.Whiteboard,
      registryExists: !!window.Whiteboard?.registry,
      layerExists: !!window.Whiteboard?.layer,
      interactionExists: !!window.Whiteboard?.interaction,
      socketExists: !!window.Whiteboard?.socket,
      layerElementExists: !!document.getElementById('whiteboard-experience-layer')
    };
  },
  forceInit() {
    if (window.Whiteboard) {
      window.Whiteboard.init();
      return 'Initialized';
    }
    return 'Whiteboard not found';
  },
  checkLayerSync() {
    const layer = document.getElementById('whiteboard-experience-layer');
    const board = document.getElementById('board');
    if (!layer || !board) return {
      error: 'Layer or board not found'
    };
    const layerRect = layer.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    return {
      layer: {
        left: layerRect.left,
        top: layerRect.top,
        width: layerRect.width,
        height: layerRect.height,
        transform: layer.style.transform
      },
      board: {
        left: boardRect.left,
        top: boardRect.top,
        width: boardRect.width,
        height: boardRect.height
      },
      matches: {
        left: Math.abs(layerRect.left - boardRect.left) < 1,
        top: Math.abs(layerRect.top - boardRect.top) < 1,
        width: Math.abs(layerRect.width - boardRect.width) < 1,
        height: Math.abs(layerRect.height - boardRect.height) < 1
      }
    };
  },
  forceSync() {
    if (window.Whiteboard?.layer) {
      window.Whiteboard.layer._sync();
      return 'Synced';
    }
    return 'Layer not found';
  },
  // Debug hit-test after click
  testHitTest(x, y) {
    if (!window.Whiteboard?.interaction) {
      console.error('InteractionManager not found');
      return null;
    }
    return window.Whiteboard.interaction._hitTest(x, y);
  },
  // Check all objects in Registry
  checkRegistry() {
    if (!window.Whiteboard?.registry) {
      console.error('Registry not found');
      return null;
    }
    // Debug helper can access registry directly (it's a debug utility)
    const all = window.Whiteboard.registry.getAll();
    console.log(`Registry has ${all.length} objects:`, all.map(o => ({
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
      hasDOM: !!document.getElementById(o.id)
    })));
    return all;
  },
  // // Check DOM elements
  checkDOM() {
    const layer = document.getElementById('whiteboard-experience-layer');
    if (!layer) {
      console.error('Layer not found');
      return null;
    }
    const containers = layer.querySelectorAll(Whiteboard.getAllContainerSelectors());
    console.log(`DOM has ${containers.length} containers:`, Array.from(containers).map(c => ({
      id: c.id,
      className: c.className,
      hasClickTarget: !!c.querySelector('.wbe-text-click-target, .wbe-image-click-target'),
      rect: c.getBoundingClientRect()
    })));
    return containers;
  }
};
