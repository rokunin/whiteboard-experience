/**
 * EventContext - Unified event context object for handlers
 * 
 * ARCHITECTURE:
 * - Wraps DOM event and InteractionManager reference
 * - Provides lazy-computed properties with caching (hitResult, selectedObject)
 * - Provides consume() method to stop event propagation
 * - Provides helper getters for common state checks
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

/**
 * @typedef {Object} HitResult
 * @property {'ui'|'handle'|'object'|'canvas'} type - Hit type
 * @property {HTMLElement} [element] - Hit element (for ui/handle)
 * @property {Object} [object] - Hit whiteboard object (for object type)
 * @property {string} [handleType] - Handle type (scale, crop-rect-*, crop-circle-resize)
 */

/**
 * EventContext class providing unified access to event data and computed properties
 */
export class EventContext {
  /**
   * Create an EventContext
   * 
   * @param {MouseEvent|KeyboardEvent} event - DOM event
   * @param {Object} im - InteractionManager instance
   * @throws {TypeError} If event or im is null/undefined
   */
  constructor(event, im) {
    if (!event) {
      throw new TypeError('EventContext requires a non-null event');
    }
    if (!im) {
      throw new TypeError('EventContext requires a non-null InteractionManager');
    }

    /** @type {MouseEvent|KeyboardEvent} */
    this.event = event;
    
    /** @type {Object} */
    this.im = im;

    // Lazy-computed cached values
    /** @private */
    this._hitResult = null;
    /** @private */
    this._hitResultComputed = false;
  }

  // ==========================================
  // Event Properties (direct access)
  // ==========================================

  /** @returns {EventTarget} */
  get target() {
    return this.event.target;
  }

  /** @returns {number} Mouse button (0=left, 1=middle, 2=right) */
  get button() {
    return this.event.button;
  }

  /** @returns {number} Client X coordinate */
  get clientX() {
    return this.event.clientX;
  }

  /** @returns {number} Client Y coordinate */
  get clientY() {
    return this.event.clientY;
  }

  /** @returns {boolean} Shift key pressed */
  get shiftKey() {
    return this.event.shiftKey;
  }

  /** @returns {boolean} Ctrl key pressed */
  get ctrlKey() {
    return this.event.ctrlKey;
  }

  /** @returns {boolean} Alt key pressed */
  get altKey() {
    return this.event.altKey;
  }

  /** @returns {boolean} Meta key pressed (Cmd on Mac) */
  get metaKey() {
    return this.event.metaKey;
  }

  /** @returns {string} Key code (for keyboard events) */
  get key() {
    return this.event.key;
  }

  /** @returns {string} Key code (for keyboard events) */
  get code() {
    return this.event.code;
  }

  // ==========================================
  // Lazy Computed Properties
  // ==========================================

  /**
   * Get hit-test result (lazy computed, cached)
   * @returns {HitResult}
   */
  get hitResult() {
    if (!this._hitResultComputed) {
      // Compute hit-test only once
      this._hitResult = this.im._hitTest(this.clientX, this.clientY);
      this._hitResultComputed = true;
    }
    return this._hitResult;
  }

  /**
   * Get currently selected object from registry
   * @returns {Object|null}
   */
  get selectedObject() {
    if (!this.im.selectedId) return null;
    return this.im.registry?.get(this.im.selectedId) || null;
  }

  /**
   * Get currently editing object from registry
   * @returns {Object|null}
   */
  get editingObject() {
    if (!this.im.editingId) return null;
    return this.im.registry?.get(this.im.editingId) || null;
  }

  // ==========================================
  // State Checks
  // ==========================================

  /** @returns {boolean} True if in text creation mode */
  get isTextMode() {
    return this.im.mode === 'text';
  }

  /** @returns {boolean} True if currently editing text */
  get isEditing() {
    return !!this.im.editingId;
  }

  /** @returns {boolean} True if mass selection is active */
  get hasMassSelection() {
    return this.im.massSelection?.selectedIds?.size > 0;
  }

  /** @returns {boolean} True if currently dragging */
  get isDragging() {
    return !!this.im.dragState;
  }

  /** @returns {boolean} True if currently panning */
  get isPanning() {
    return !!this.im.panState;
  }

  /** @returns {boolean} True if currently scaling */
  get isScaling() {
    return !!this.im.scaleState;
  }

  /** @returns {string|null} Currently selected object ID */
  get selectedId() {
    return this.im.selectedId || null;
  }

  /** @returns {string|null} Currently editing object ID */
  get editingId() {
    return this.im.editingId || null;
  }

  // ==========================================
  // Actions
  // ==========================================

  /**
   * Consume the event (prevent default and stop all propagation)
   * Calls preventDefault(), stopPropagation(), and stopImmediatePropagation()
   */
  consume() {
    this.event.preventDefault();
    this.event.stopPropagation();
    if (typeof this.event.stopImmediatePropagation === 'function') {
      this.event.stopImmediatePropagation();
    }
  }

  /**
   * Check if target is a panel element
   * @returns {boolean}
   */
  isPanelClick() {
    const target = this.target;
    if (!target || typeof target.closest !== 'function') return false;
    
    return !!(
      target.closest('.wbe-text-styling-panel') ||
      target.closest('.wbe-image-control-panel') ||
      target.closest('.wbe-color-subpanel') ||
      target.closest('.wbe-rotation-subpanel')
    );
  }

  /**
   * Check if target is an editable element (contenteditable, input, textarea)
   * @returns {boolean}
   */
  isEditableElement() {
    const target = this.target;
    if (!target || typeof target.getAttribute !== 'function') return false;
    
    return (
      target.isContentEditable ||
      target.getAttribute('contenteditable') === 'true' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA'
    );
  }

  /**
   * Get the layer reference from InteractionManager
   * @returns {Object|null}
   */
  get layer() {
    return this.im.layer || null;
  }

  /**
   * Get the registry reference from InteractionManager
   * @returns {Object|null}
   */
  get registry() {
    return this.im.registry || null;
  }

  /**
   * Get the mass selection controller
   * @returns {Object|null}
   */
  get massSelection() {
    return this.im.massSelection || null;
  }
}
