import {
  MODID,
  FLAG_SCOPE,
  FLAG_KEY_IMAGES,
  screenToWorld,
  worldToScreen,
  getSharedVars,          // lastMouseX/lastMouseY etc. — only call inside functions
  setSelectedImageId,
  setCopiedImageData,
  deselectAllElements,
  createCardsLayer,
  ZIndexManager
} from "../main.mjs";

// Scale sensitivity constant
const SCALE_SENSITIVITY = 0.005; // Sensitivity for image scaling

// Freeze animation constants
const FREEZE_FADE_DURATION = 0.5; // Duration in seconds for freeze fade animation

// Inject CSS for frozen selection styling
if (!document.querySelector('#wbe-frozen-selection-styles')) {
  const style = document.createElement('style');
  style.id = 'wbe-frozen-selection-styles';
  style.textContent = `
    .wbe-image-selection-border.wbe-frozen-selected {
      border-color: #666666 !important;
      border-width: 2px !important;
      border-style: solid !important;
      opacity: 1 !important;
      z-index: 1003 !important;
    }
    
    .wbe-image-frozen .wbe-image-selection-border.wbe-frozen-selected {
      border-color: #666666 !important;
      border-width: 2px !important;
      z-index: 1003 !important;
    }
  `;
  document.head.appendChild(style);
}

let copiedImageData = null; // Буфер для копирования картинок
let selectedImageId = null; // ID выделенного изображения
let isScalingImage = false; // Flag to prevent deselection during scaling
// Глобальное хранилище данных картинок для синхронизации
let globalImageData = {}; // { [id]: { maskType, circleOffset, circleRadius, crop, scale } }
// Глобальное хранилище локальных переменных картинок
let imageLocalVars = {}; // { [id]: { maskType, circleOffset, circleRadius, crop, scale } }
/* ----------------------- Image Selection Registry ------------------ */
// Registry to track all image containers for centralized selection management
const imageRegistry = new Map(); // { id: { container, selectFn, deselectFn, isFrozen } }
// Single global handler for ALL image selection/deselection
let globalImageSelectionHandlerInstalled = false;
let removalObserver = null;




// ======================== Image Freeze Management ========================

function setImageFrozen(id, frozen) {
  const imageData = imageRegistry.get(id);
  if (imageData) {
    imageData.isFrozen = frozen;
    imageData.container.dataset.frozen = frozen ? "true" : "false";

    // NEW: Allow clicks but block drag/resize through controller validation
    // Remove blanket pointer-events blocking to enable click interactions
    if (frozen) {
      // Don't set pointer-events: none - let controllers handle interaction blocking
      imageData.container.style.pointerEvents = "";
    } else {
      imageData.container.style.pointerEvents = "";
    }

    // Update visual indicator
    if (frozen) {
      imageData.container.classList.add("wbe-image-frozen");
    } else {
      imageData.container.classList.remove("wbe-image-frozen");
    }
  }
}

function isImageFrozen(id) {
  const imageData = imageRegistry.get(id);
  return imageData ? imageData.isFrozen : false;
}

/**
 * @typedef {Object} DragState
 * @property {boolean} active - Currently in drag operation (mouse down occurred)
 * @property {boolean} initialized - Drag movement has started (mouse moved > threshold)
 * @property {number} startScreenX - Initial mouse screen X coordinate
 * @property {number} startScreenY - Initial mouse screen Y coordinate
 * @property {number} startWorldX - Initial container world X position
 * @property {number} startWorldY - Initial container world Y position
 */

/**
 * @typedef {Object} DragOptions
 * @property {Function} [onDragStart] - Callback when drag starts
 * @property {Function} [onDragMove] - Callback during drag movement
 * @property {Function} [onDragEnd] - Callback when drag ends
 * @property {Function} [onSave] - Callback to save state
 * @property {Function} [getLayer] - Function to get layer element for coordinate transformation
 * @property {boolean} [disabled] - Initial disabled state
 */

/**
 * @typedef {Object} EventHandlerMap
 * @property {Function|null} mouseDown - Mouse down event handler
 * @property {Function|null} mouseMove - Mouse move event handler
 * @property {Function|null} mouseUp - Mouse up event handler
 */

/**
 * ImageDragController - Manages drag functionality for image elements
 * Encapsulates all drag-related state and behavior in a reusable class
 */
class ImageDragController {
  /**
   * @param {HTMLElement} container - The .wbe-canvas-image-container element
   * @param {HTMLElement} imageElement - The .wbe-canvas-image element
   * @param {DragOptions} options - Configuration and callbacks
   */
  constructor(container, imageElement, options = {}) {
    // Validate required parameters
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[ImageDragController] Invalid container element provided');
    }
    if (!imageElement || !(imageElement instanceof HTMLElement)) {
      throw new Error('[ImageDragController] Invalid image element provided');
    }

    this.container = container;
    this.imageElement = imageElement;
    this.options = { ...options };

    /** @type {DragState} */
    this.dragState = {
      active: false,
      initialized: false,
      startScreenX: 0,
      startScreenY: 0,
      startWorldX: 0,
      startWorldY: 0
    };

    /** @type {EventHandlerMap} */
    this.eventHandlers = {
      mouseDown: null,
      mouseMove: null,
      mouseUp: null
    };

    // Bind methods to preserve 'this' context
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    // Auto-enable unless explicitly disabled
    if (!this.options.disabled) {
      this.enable();
    }
  }

  /**
   * Enable drag functionality by attaching event listeners
   */
  enable() {
    if (this.eventHandlers.mouseDown) {
      return; // Already enabled
    }
    this.attachEventListeners();
  }

  /**
   * Temporarily disable dragging without cleanup
   */
  disable() {
    this.removeEventListeners();
  }

  /**
   * Permanently remove all event listeners and clean up resources
   */
  destroy() {
    // Guard against multiple destroy calls
    if (!this.eventHandlers) return;

    this.removeEventListeners();
    this.container = null;
    this.imageElement = null;
    this.options = null;
    this.dragState = null;
    this.eventHandlers = null;
  }

  /**
   * Check if currently dragging
   * @returns {boolean}
   */
  isDragging() {
    return this.dragState ? this.dragState.active : false;
  }

  /**
   * Get copy of current drag state for debugging
   * @returns {DragState}
   */
  getDragState() {
    return this.dragState ? { ...this.dragState } : null;
  }

  /**
   * Attach event listeners to container
   * @private
   */
  attachEventListeners() {
    if (!this.container) return;

    this.eventHandlers.mouseDown = this._onMouseDown;
    this.container.addEventListener('mousedown', this.eventHandlers.mouseDown);
  }

  /**
   * Remove event listeners from container and document
   * @private
   */
  removeEventListeners() {
    // Guard against multiple destroy calls
    if (!this.eventHandlers) return;

    // Remove container listener
    if (this.eventHandlers.mouseDown && this.container) {
      this.container.removeEventListener('mousedown', this.eventHandlers.mouseDown);
      this.eventHandlers.mouseDown = null;
    }

    // Remove document listeners
    this.removeDocumentListeners();
  }

  /**
   * Remove only document listeners (mousemove and mouseup)
   * Used during drag completion to clean up without removing container mousedown
   * @private
   */
  removeDocumentListeners() {
    // Guard against multiple destroy calls
    if (!this.eventHandlers) return;

    if (this.eventHandlers.mouseMove) {
      document.removeEventListener('mousemove', this.eventHandlers.mouseMove);
      this.eventHandlers.mouseMove = null;
    }

    if (this.eventHandlers.mouseUp) {
      document.removeEventListener('mouseup', this.eventHandlers.mouseUp);
      this.eventHandlers.mouseUp = null;
    }
  }

  /**
   * Validate if drag operation is allowed
   * @returns {boolean}
   * @private
   */
  validateDragConditions() {
    if (!this.container) return false;

    // Check if locked by another user
    if (this.container.dataset.lockedBy && this.container.dataset.lockedBy !== game.user.id) {
      return false;
    }

    // Check if image is frozen
    if (isImageFrozen && isImageFrozen(this.container.id)) {
      return false;
    }

    // Check if in crop mode (assuming global isCropping variable exists)
    if (typeof isCropping !== 'undefined' && isCropping) {
      return false;
    }

    return true;
  }

  /**
   * Transform screen coordinates to world coordinates
   * @param {number} screenX - Screen X coordinate
   * @param {number} screenY - Screen Y coordinate
   * @returns {Object} World coordinates {worldX, worldY}
   * @private
   */
  transformCoordinates(screenX, screenY) {
    try {
      const layer = this.options.getLayer ? this.options.getLayer() : (typeof getOrCreateLayer !== 'undefined' ? getOrCreateLayer() : null);

      if (!layer) {
        console.warn('[ImageDragController] Layer not found, using fallback scale');
        return { worldX: screenX, worldY: screenY };
      }

      const transform = layer.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

      return {
        worldX: screenX / scale,
        worldY: screenY / scale
      };
    } catch (error) {
      console.error('[ImageDragController] Coordinate transformation failed:', error);
      return { worldX: screenX, worldY: screenY }; // Fallback
    }
  }

  /**
   * Handle mouse down event - initiate drag
   * @param {MouseEvent} event
   * @private
   */
  _onMouseDown(event) {
    if (event.button !== 0) return; // Only left click

    try {
      // Validate drag conditions
      if (!this.validateDragConditions()) {
        return;
      }

      // Check for control panel clicks
      if (window.wbeImageControlPanel && window.wbeImageControlPanel.contains(event.target)) {
        return;
      }
      
      if (window.wbeFrozenControlPanel && window.wbeFrozenControlPanel.contains(event.target)) {
        return;
      }

      // Handle selection logic if image not selected
      const isSelected = this.container.dataset.selected === "true";
      if (!isSelected) {
        // Clear mass selection when selecting individual image
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }

        // Trigger selection callback if provided
        if (this.options.onDragStart) {
          this.options.onDragStart(this);
        }
      }

      event.preventDefault();
      event.stopPropagation();

      // Initialize drag state
      this.dragState.active = true;
      this.dragState.initialized = false;
      this.dragState.startScreenX = event.clientX;
      this.dragState.startScreenY = event.clientY;
      this.dragState.startWorldX = parseFloat(this.container.style.left) || 0;
      this.dragState.startWorldY = parseFloat(this.container.style.top) || 0;

      // Attach move and up listeners
      this.eventHandlers.mouseMove = this._onMouseMove;
      this.eventHandlers.mouseUp = this._onMouseUp;
      document.addEventListener('mousemove', this.eventHandlers.mouseMove);
      document.addEventListener('mouseup', this.eventHandlers.mouseUp);

    } catch (error) {
      console.error('[ImageDragController] Mouse down handler failed:', error);
    }
  }

  /**
   * Handle mouse move event - update position
   * @param {MouseEvent} event
   * @private
   */
  _onMouseMove(event) {
    if (!this.dragState.active) return;

    try {
      const deltaScreenX = event.clientX - this.dragState.startScreenX;
      const deltaScreenY = event.clientY - this.dragState.startScreenY;

      // Initialize drag on first movement
      if (!this.dragState.initialized && (Math.abs(deltaScreenX) > 1 || Math.abs(deltaScreenY) > 1)) {
        this.dragState.initialized = true;

        // Hide control panel on first movement
        if (typeof killImageControlPanel !== 'undefined') {
          killImageControlPanel();
        }
      }

      // Transform coordinates
      const { worldX: deltaWorldX, worldY: deltaWorldY } = this.transformCoordinates(deltaScreenX, deltaScreenY);

      // Calculate new position
      const newLeft = this.dragState.startWorldX + deltaWorldX;
      const newTop = this.dragState.startWorldY + deltaWorldY;

      // Update container position
      this.container.style.left = `${newLeft}px`;
      this.container.style.top = `${newTop}px`;

      // Trigger move callback
      if (this.options.onDragMove) {
        this.options.onDragMove(this, newLeft, newTop);
      }

    } catch (error) {
      console.error('[ImageDragController] Mouse move handler failed:', error);
    }
  }

  /**
   * Handle mouse up event - complete drag
   * @param {MouseEvent} event
   * @private
   */
  async _onMouseUp(event) {
    if (!this.dragState.active) return;

    try {
      // Clean up document event listeners (keep container mousedown listener)
      this.removeDocumentListeners();

      // Reset drag state
      this.dragState.active = false;
      this.dragState.initialized = false;

      // Trigger end callback
      if (this.options.onDragEnd) {
        await this.options.onDragEnd(this);
      }

      // Trigger save callback
      if (this.options.onSave) {
        await this.options.onSave();
      }

      // Restore control panel if needed
      if (window.wbeImageControlPanel) {
        // Panel exists, update position
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      } else if (typeof showImageControlPanel !== 'undefined') {
        // Panel was killed, recreate it - this would need to be handled by the integration code
        // as it requires specific parameters that the controller doesn't have access to
      }

    } catch (error) {
      console.error('[ImageDragController] Mouse up handler failed:', error);
    } finally {
      // Ensure cleanup always occurs (only document listeners, keep container mousedown)
      this.removeDocumentListeners();
      this.dragState.active = false;
      this.dragState.initialized = false;
    }
  }
}

/**
 * @typedef {Object} SelectionState
 * @property {boolean} selected - Currently selected
 * @property {boolean} borderVisible - Selection border is visible
 * @property {boolean} clickTargetActive - Click target is active
 * @property {number} lastSelectedTime - Timestamp of last selection (for debugging)
 */

/**
 * @typedef {Object} SelectionOptions
 * @property {Function} [onSelect] - Callback when selection occurs
 * @property {Function} [onDeselect] - Callback when deselection occurs
 * @property {Function} [onToggle] - Callback when selection state toggles
 * @property {Function} [showControlPanel] - Callback to show control panel
 * @property {Function} [hideControlPanel] - Callback to hide control panel
 * @property {Function} [clearMassSelection] - Callback to clear mass selection
 * @property {boolean} [disabled] - Initial disabled state
 */

/**
 * @typedef {Object} SelectionVisuals
 * @property {HTMLElement|null} border - Selection border element
 * @property {HTMLElement|null} clickTarget - Click target overlay
 * @property {HTMLElement|null} resizeHandle - Reference to resize handle (managed by ResizeController)
 */

/**
 * SelectionController - Manages image selection state and visual indicators
 * 
 * This class encapsulates all selection-related functionality for image elements
 * in the whiteboard module, replacing the closure-based selection implementation
 * with a maintainable, testable class structure.
 */
class SelectionController {
  /**
   * @param {HTMLElement} container - The .wbe-canvas-image-container element
   * @param {HTMLElement} imageElement - The .wbe-canvas-image element
   * @param {SelectionOptions} options - Configuration and callbacks
   */
  constructor(container, imageElement, options = {}) {
    // Validate required parameters
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[SelectionController] Invalid container element provided');
    }
    if (!imageElement || !(imageElement instanceof HTMLElement)) {
      throw new Error('[SelectionController] Invalid image element provided');
    }

    this.container = container;
    this.imageElement = imageElement;
    this.options = { ...options };

    /** @type {SelectionState} */
    this.selectionState = {
      selected: false,
      borderVisible: false,
      clickTargetActive: false,
      lastSelectedTime: 0
    };

    /** @type {SelectionVisuals} */
    this.visualElements = {
      border: null,
      clickTarget: null,
      resizeHandle: null
    };

    // Validate options structure
    this._validateOptions();

    // Auto-enable unless explicitly disabled
    if (!this.options.disabled) {
      this.enable();
    }
  }

  /**
   * Validate constructor options
   * @private
   */
  _validateOptions() {
    const validCallbacks = ['onSelect', 'onDeselect', 'onToggle', 'showControlPanel', 'hideControlPanel', 'clearMassSelection'];

    for (const [key, value] of Object.entries(this.options)) {
      if (validCallbacks.includes(key) && value !== undefined && typeof value !== 'function') {
        throw new Error(`[SelectionController] Option '${key}' must be a function, got ${typeof value}`);
      }
    }

    if (this.options.disabled !== undefined && typeof this.options.disabled !== 'boolean') {
      throw new Error('[SelectionController] Option \'disabled\' must be a boolean');
    }
  }

  /**
   * Select the image and show visual indicators
   */
  select() {
    try {
      // ✅ FIX: Check DOM state to ensure consistency before early return
      const domSelected = this.container.dataset.selected === "true";

      // Prevent selection if already selected (check both internal and DOM state)
      if (this.selectionState.selected && domSelected) {
        return;
      }

      // ✅ FIX: If there's a state mismatch, reset internal state to match DOM
      if (this.selectionState.selected !== domSelected) {
        // Silently fix state mismatch - this can happen due to external DOM manipulation
        this.selectionState.selected = domSelected;
        if (domSelected) {
          // DOM says selected but we're in select() - this shouldn't happen, but handle it
          return;
        }
      }

      // Check if container is locked by another user
      if (this.container.dataset.lockedBy && this.container.dataset.lockedBy !== game?.user?.id) {
        console.warn('[SelectionController] Cannot select image locked by another user');
        return;
      }

      // Check if image is mass-selected (prevent individual selection)
      if (this.container.classList.contains('wbe-mass-selected')) {
        console.warn('[SelectionController] Cannot individually select mass-selected image');
        return;
      }

      // Clear mass selection if callback provided
      if (this.options.clearMassSelection) {
        this.options.clearMassSelection();
      }

      // Other elements should handle their own deselection via global state changes

      // Update selection state
      this.selectionState.selected = true;
      this.selectionState.borderVisible = true;
      this.selectionState.clickTargetActive = true;
      this.selectionState.lastSelectedTime = Date.now();

      // Update container dataset
      this.container.dataset.selected = "true";
      // Selection state updated

      // Create and show visual elements
      this._createSelectionBorder();
      this._createClickTarget();
      this._updateVisuals();

      // ✅ FIX: Ensure proper coordination with legacy border system
      if (this.visualElements.border) {
        this.visualElements.border.style.display = 'block';
      }

      // ✅ FIX: Keep permanent border visible like text elements do
      // Don't hide permanent border - let both borders show simultaneously
      const permanentBorder = this.container.querySelector('.wbe-image-permanent-border');
      if (permanentBorder) {
        // Ensure permanent border is visible and updated
        permanentBorder.style.display = 'block';
        const cropData = getImageCropData(this.imageElement);
        updateImageBorder(
          permanentBorder,
          this.imageElement,
          cropData.maskType,
          cropData.crop,
          cropData.circleOffset,
          cropData.circleRadius,
          cropData.scale
        );
      }

      // Trigger callbacks
      if (this.options.onSelect) {
        this.options.onSelect(this);
      }

      if (this.options.showControlPanel) {
        this.options.showControlPanel(this.imageElement, this.container);
      }

      if (this.options.onToggle) {
        this.options.onToggle(this, true);
      }

    } catch (error) {
      console.error('[SelectionController] Selection failed:', error);
      // Reset state on error
      this.selectionState.selected = false;
      this.selectionState.borderVisible = false;
      this.selectionState.clickTargetActive = false;
    }
  }

  /**
   * Deselect the image and hide visual indicators
   */
  deselect() {
    try {
      // Prevent deselection if not selected
      if (!this.selectionState.selected) {
        console.log('[DEBUG] SelectionController deselect called but not selected:', this.container.id);
        return;
      }





      // Update selection state
      this.selectionState.selected = false;
      this.selectionState.borderVisible = false;
      this.selectionState.clickTargetActive = false;

      // Update container dataset
      delete this.container.dataset.selected;
      // Deselection state updated

      // Hide and cleanup visual elements
      this._cleanupVisuals();

      // ✅ FIX: Restore permanent border when deselected (legacy system coordination)
      const permanentBorder = this.container.querySelector('.wbe-image-permanent-border');
      if (permanentBorder) {

        permanentBorder.style.display = 'block';
        // Update permanent border with current crop data
        const cropData = getImageCropData(this.imageElement);
        updateImageBorder(
          permanentBorder,
          this.imageElement,
          cropData.maskType,
          cropData.crop,
          cropData.circleOffset,
          cropData.circleRadius,
          cropData.scale
        );
      }

      // Trigger callbacks
      if (this.options.onDeselect) {
        this.options.onDeselect(this);
      }

      if (this.options.hideControlPanel) {
        this.options.hideControlPanel();
      }

      if (this.options.onToggle) {
        this.options.onToggle(this, false);
      }

    } catch (error) {
      console.error('[SelectionController] Deselection failed:', error);
    }
  }

  /**
   * Toggle selection state
   */
  toggle() {
    if (this.selectionState.selected) {
      this.deselect();
    } else {
      this.select();
    }
  }

  /**
   * Check if image is currently selected
   * @returns {boolean}
   */
  isSelected() {
    // ✅ SAFEGUARD: Ensure internal state matches DOM state
    const domSelected = this.container.dataset.selected === "true";
    if (this.selectionState.selected !== domSelected) {
      console.warn('[SelectionController] State mismatch detected, fixing...', {
        internalState: this.selectionState.selected,
        domState: domSelected,
        containerId: this.container.id
      });
      // Fix the mismatch by updating internal state to match DOM
      this.selectionState.selected = domSelected;
      if (!domSelected) {
        // If DOM says not selected, ensure visuals are cleaned up
        this._cleanupVisuals();
      }
    }
    return this.selectionState.selected;
  }

  /**
   * Get copy of current selection state for debugging
   * @returns {SelectionState}
   */
  getSelectionState() {
    return { ...this.selectionState };
  }

  /**
   * Update visual elements based on current state
   */
  updateVisuals() {
    try {
      if (this.selectionState.selected && this.selectionState.borderVisible) {
        this._updateBorderSize();
      }
    } catch (error) {
      console.error('[SelectionController] Visual update failed:', error);
    }
  }

  /**
   * Enable selection functionality
   */
  enable() {
    // Implementation will be added in future tasks
    // For now, just mark as enabled
    this.options.disabled = false;
  }

  /**
   * Temporarily disable selection functionality
   */
  disable() {
    // Implementation will be added in future tasks
    this.options.disabled = true;
  }

  /**
   * Permanently destroy the controller and clean up resources
   */
  destroy() {
    try {
      // Clean up all visual elements
      this._cleanupVisuals();

      // Clear references to prevent memory leaks
      this.container = null;
      this.imageElement = null;
      this.options = null;
      this.selectionState = null;
      this.visualElements = null;

    } catch (error) {
      console.error('[SelectionController] Cleanup failed:', error);
    }
  }

  /**
   * Create selection border element
   * @private
   */
  _createSelectionBorder() {
    try {
      // ✅ FIX: Use existing selection border instead of creating a new one
      // This prevents multiple border elements from existing simultaneously
      const existingBorder = this.container.querySelector('.wbe-image-selection-border');
      if (existingBorder) {
        this.visualElements.border = existingBorder;
        return;
      }

      // Only create if no existing border found (fallback)
      const border = document.createElement('div');
      border.className = 'wbe-image-selection-border';
      border.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        border: 1px solid #4a9eff;
        pointer-events: none;
        display: block;
        z-index: 1002;
      `;

      this.container.appendChild(border);
      this.visualElements.border = border;

    } catch (error) {
      console.error('[SelectionController] Failed to create selection border:', error);
    }
  }

  /**
   * Create click target overlay element
   * @private
   */
  _createClickTarget() {
    try {
      // ✅ FIX: Use existing click target instead of creating a new one
      const existingClickTarget = this.container.querySelector('.wbe-image-click-target');
      if (existingClickTarget) {
        this.visualElements.clickTarget = existingClickTarget;
        return;
      }

      // Only create if no existing click target found (fallback)
      const clickTarget = document.createElement('div');
      clickTarget.className = 'wbe-image-click-target';
      clickTarget.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        background: transparent;
        pointer-events: auto;
        z-index: 998;
      `;

      this.container.appendChild(clickTarget);
      this.visualElements.clickTarget = clickTarget;

    } catch (error) {
      console.error('[SelectionController] Failed to create click target:', error);
    }
  }

  /**
   * Update border size based on image dimensions and crop settings
   * @private
   */
  _updateBorderSize() {
    try {
      if (!this.visualElements.border || !this.imageElement) {
        return;
      }

      // ✅ FIX: Use the existing border update system instead of basic dimensions
      // This ensures proper scaling and crop handling
      const cropData = getImageCropData(this.imageElement);
      updateImageBorder(
        this.visualElements.border,
        this.imageElement,
        cropData.maskType,
        cropData.crop,
        cropData.circleOffset,
        cropData.circleRadius,
        cropData.scale
      );

    } catch (error) {
      console.error('[SelectionController] Failed to update border size:', error);
    }
  }

  /**
   * Update all visual elements
   * @private
   */
  _updateVisuals() {
    try {
      this._updateBorderSize();
      // Additional visual updates will be added in future tasks
    } catch (error) {
      console.error('[SelectionController] Failed to update visuals:', error);
    }
  }

  // Removed _clearOtherElementSelections - violates separation of concerns
  // Other elements should manage their own deselection through proper event coordination

  /**
   * Clean up all visual elements
   * @private
   */
  _cleanupVisuals() {
    try {
      // ✅ FIX: Don't remove existing elements, just hide them and clear references
      // The legacy system will manage the actual DOM elements
      if (this.visualElements.border) {
        this.visualElements.border.style.display = 'none';
      }
      this.visualElements.border = null;

      if (this.visualElements.clickTarget) {
        this.visualElements.clickTarget.style.pointerEvents = 'none';
      }
      this.visualElements.clickTarget = null;

      // Note: resizeHandle is managed by ResizeController, so we don't remove it here

    } catch (error) {
      console.error('[SelectionController] Failed to cleanup visuals:', error);
    }
  }
}

/* ======================== Frozen Selection Functions ======================== */

/**
 * Show frozen selection visual state for a frozen image
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function showFrozenSelection(container) {
  try {
    if (!container) {
      console.error('[showFrozenSelection] Invalid container provided');
      return;
    }

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) {
      console.error('[showFrozenSelection] Image element not found');
      return;
    }

    // Check if image is actually frozen
    if (!isImageFrozen(container.id)) {
      console.warn('[showFrozenSelection] Image is not frozen:', container.id);
      return;
    }

    // Find or create selection border
    let selectionBorder = container.querySelector('.wbe-image-selection-border');
    if (!selectionBorder) {
      selectionBorder = document.createElement('div');
      selectionBorder.className = 'wbe-image-selection-border';
      selectionBorder.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        border: 2px solid #666666;
        pointer-events: none;
        display: block;
        z-index: 1003;
      `;
      container.appendChild(selectionBorder);
    }

    // Apply frozen selection styling (dark gray border)
    selectionBorder.classList.add('wbe-frozen-selected');
    selectionBorder.style.borderColor = '#666666'; // Dark gray for frozen state
    selectionBorder.style.borderWidth = '2px';
    selectionBorder.style.borderStyle = 'solid';
    selectionBorder.style.zIndex = '1003'; // Ensure it's above permanent border
    selectionBorder.style.display = 'block';
    
    // Mark container as selected so global selection handler can deselect it
    container.dataset.selected = "true";
    
    console.log('[showFrozenSelection] Applied frozen styling to:', container.id, {
      borderColor: selectionBorder.style.borderColor,
      borderWidth: selectionBorder.style.borderWidth,
      classes: selectionBorder.className,
      display: selectionBorder.style.display
    });

    // Get current crop data
    const cropData = getImageCropData(imageElement);

    // Ensure permanent border is visible and updated (like normal selection does)
    const permanentBorder = container.querySelector('.wbe-image-permanent-border');
    if (permanentBorder) {
      permanentBorder.style.display = 'block';
      updateImageBorder(
        permanentBorder,
        imageElement,
        cropData.maskType,
        cropData.crop,
        cropData.circleOffset,
        cropData.circleRadius,
        cropData.scale
      );
    }

    // Update frozen selection border size to match permanent border
    updateImageBorder(
      selectionBorder,
      imageElement,
      cropData.maskType,
      cropData.crop,
      cropData.circleOffset,
      cropData.circleRadius,
      cropData.scale
    );

    // Hide resize handle (blue gizmo) when frozen
    const resizeHandle = container.querySelector('.wbe-image-resize-handle');
    if (resizeHandle) {
      resizeHandle.style.display = 'none';
    }

    // Mark container as having frozen selection
    container.dataset.frozenSelected = "true";

  } catch (error) {
    console.error('[showFrozenSelection] Failed to show frozen selection:', error);
  }
}

/**
 * Hide frozen selection visual state
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function hideFrozenSelection(container) {
  try {
    if (!container) {
      console.error('[hideFrozenSelection] Invalid container provided');
      return;
    }

    const selectionBorder = container.querySelector('.wbe-image-selection-border');
    if (selectionBorder) {
      console.log('[hideFrozenSelection] Hiding frozen selection for:', container.id);
      
      // Remove frozen selection styling
      selectionBorder.classList.remove('wbe-frozen-selected');
      selectionBorder.style.display = 'none';
      
      // Reset border color to normal blue (in case it gets reused)
      selectionBorder.style.borderColor = '#4a9eff';
      selectionBorder.style.borderWidth = '1px';
    }

    // Restore resize handle if image becomes selected again
    const resizeHandle = container.querySelector('.wbe-image-resize-handle');
    if (resizeHandle && container.dataset.selected === "true") {
      resizeHandle.style.display = 'flex';
    }

    // Remove frozen selection marker
    delete container.dataset.frozenSelected;
    
    // Remove selected dataset so global selection handler doesn't see it as selected
    delete container.dataset.selected;

  } catch (error) {
    console.error('[hideFrozenSelection] Failed to hide frozen selection:', error);
  }
}

/* ======================== End Frozen Selection Functions ======================== */

/* ======================== Frozen Control Panel Functions ======================== */

/**
 * Create frozen control panel component with specialized styling
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 * @returns {HTMLElement} The created frozen panel element
 */
function createFrozenControlPanel(container) {
  try {
    if (!container) {
      console.error('[createFrozenControlPanel] Invalid container provided');
      return null;
    }

    const panel = document.createElement("div");
    panel.className = "wbe-image-control-panel wbe-frozen-panel";
    panel.style.cssText = `
      position: fixed;
      background: #f8f8f8;
      border: 2px solid #666666;
      border-radius: 14px;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
      padding: 8px;
      z-index: 10000;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      
      aspect-ratio: 3 / 1;
      transform: translateX(-50%) scale(.9) translateY(12px);
      opacity: 0;
      transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;

    const toolbar = document.createElement("div");
    toolbar.style.cssText = `
      display: flex;
      gap: 12px;
      position: relative;
    `;

    // Create unfreeze button with unlock icon
    const unfreezeBtn = document.createElement("button");
    unfreezeBtn.type = "button";
    unfreezeBtn.className = "wbe-frozen-unfreeze-btn";
    unfreezeBtn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 40px;
      padding: 0;
      border-radius: 10px;
      border: 2px solid #666666;
      background: #ffffff;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
    `;
    unfreezeBtn.title = "Unfreeze image";

    const unfreezeIcon = document.createElement("i");
    unfreezeIcon.className = "fas fa-unlock";
    unfreezeIcon.style.cssText = "font-size: 18px; color: #666666;";
    unfreezeBtn.appendChild(unfreezeIcon);

    // Add hover effects
    unfreezeBtn.addEventListener("mouseenter", () => {
      unfreezeBtn.style.background = "#e6e6e6";
      unfreezeIcon.style.color = "#333333";
    });
    unfreezeBtn.addEventListener("mouseleave", () => {
      unfreezeBtn.style.background = "#ffffff";
      unfreezeIcon.style.color = "#666666";
    });

    toolbar.appendChild(unfreezeBtn);
    panel.appendChild(toolbar);

    // Store reference to unfreeze button for external access
    panel.unfreezeBtn = unfreezeBtn;

    console.log('[createFrozenControlPanel] Created frozen panel for:', container.id);
    return panel;

  } catch (error) {
    console.error('[createFrozenControlPanel] Failed to create frozen panel:', error);
    return null;
  }
}

/**
 * Show frozen control panel for a frozen image
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 * @param {Function} onUnfreeze - Callback function for unfreeze action
 */
function showFrozenControlPanel(container, onUnfreeze) {
  try {
    if (!container) {
      console.error('[showFrozenControlPanel] Invalid container provided');
      return;
    }

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) {
      console.error('[showFrozenControlPanel] Image element not found');
      return;
    }

    // Check if image is actually frozen
    if (!isImageFrozen(container.id)) {
      console.warn('[showFrozenControlPanel] Image is not frozen:', container.id);
      return;
    }

    // Kill any existing panel first
    killFrozenControlPanel();

    // Create the frozen panel
    const panel = createFrozenControlPanel(container);
    if (!panel) {
      console.error('[showFrozenControlPanel] Failed to create panel');
      return;
    }

    // Set up unfreeze button click handler
    if (panel.unfreezeBtn) {
      panel.unfreezeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[showFrozenControlPanel] Unfreeze button clicked for:', container.id);
        
        // Add visual feedback during unfreeze process
        panel.unfreezeBtn.style.opacity = '0.6';
        panel.unfreezeBtn.style.transform = 'scale(0.95)';
        
        // Use the provided callback or default to handleUnfreezeAction
        const unfreezeHandler = onUnfreeze || handleUnfreezeAction;
        
        // Execute unfreeze with slight delay for visual feedback
        setTimeout(() => {
          unfreezeHandler(container);
        }, 100);
      });
    }

    // Position panel relative to image
    const updatePanelPosition = () => {
      const rect = imageElement.getBoundingClientRect();
      panel.style.left = `${rect.left + rect.width / 2}px`;
      panel.style.top = `${rect.top - 110}px`;
    };

    // Add panel to DOM
    document.body.appendChild(panel);
    updatePanelPosition();

    // Animate panel in
    requestAnimationFrame(() => {
      panel.style.transform = "translateX(-50%) scale(1) translateY(32px)";
      panel.style.opacity = "1";
    });

    // Set up click outside handler
    const onOutsideClick = (ev) => {
      if (panel.contains(ev.target)) return;
      if (container?.contains(ev.target)) return;
      
      // Clicking outside - hide panel
      killFrozenControlPanel();
    };

    // Set up escape key handler
    const onEscapeKey = (ev) => {
      if (ev.key === "Escape") {
        killFrozenControlPanel();
      }
    };

    // Prevent panel clicks from bubbling
    panel.addEventListener("mousedown", (ev) => ev.stopPropagation());

    // Install event listeners with delay to avoid immediate triggering
    setTimeout(() => {
      document.addEventListener("mousedown", onOutsideClick, true);
      document.addEventListener("keydown", onEscapeKey);
    }, 0);

    // Store cleanup function and position updater
    panel.cleanup = () => {
      try {
        document.removeEventListener("mousedown", onOutsideClick, true);
        document.removeEventListener("keydown", onEscapeKey);
        panel.remove();
        window.wbeFrozenControlPanel = null;
        window.wbeFrozenControlPanelUpdate = null;
      } catch (error) {
        console.error('[showFrozenControlPanel] Cleanup failed:', error);
      }
    };

    // Store global references
    window.wbeFrozenControlPanel = panel;
    window.wbeFrozenControlPanelUpdate = updatePanelPosition;

    console.log('[showFrozenControlPanel] Shown frozen panel for:', container.id);

  } catch (error) {
    console.error('[showFrozenControlPanel] Failed to show frozen panel:', error);
  }
}

/**
 * Hide and cleanup frozen control panel
 */
function killFrozenControlPanel() {
  const panel = window.wbeFrozenControlPanel;
  if (panel && typeof panel.cleanup === "function") {
    try {
      panel.cleanup();
    } catch (error) {
      console.error('[killFrozenControlPanel] Cleanup failed:', error);
    }
  }
  // Ensure global reference is cleared even if cleanup fails
  window.wbeFrozenControlPanel = null;
  window.wbeFrozenControlPanelUpdate = null;
}

/**
 * Handle unfreeze action from frozen control panel
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function handleUnfreezeAction(container) {
  try {
    if (!container) {
      console.error('[handleUnfreezeAction] Invalid container provided');
      return;
    }

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) {
      console.error('[handleUnfreezeAction] Image element not found');
      return;
    }

    console.log('[handleUnfreezeAction] Unfreezing image:', container.id);

    // Hide frozen panel first
    killFrozenControlPanel();

    // Hide frozen selection state
    hideFrozenSelection(container);

    // Remove frozen state from registry
    setImageFrozen(container.id, false);

    // Transition to normal selection state
    const imageData = imageRegistry.get(container.id);
    if (imageData && imageData.selectFn) {
      // Select the image with normal selection
      // The selectFn() will handle showing the normal control panel via SelectionController
      imageData.selectFn();
    }

    console.log('[handleUnfreezeAction] Successfully unfroze image:', container.id);

  } catch (error) {
    console.error('[handleUnfreezeAction] Failed to unfreeze image:', error);
  }
}

/**
 * Update frozen panel position when image moves or canvas changes
 * Integrates with existing panel management system
 */
function updateFrozenPanelPosition() {
  if (window.wbeFrozenControlPanelUpdate) {
    try {
      window.wbeFrozenControlPanelUpdate();
    } catch (error) {
      console.error('[updateFrozenPanelPosition] Failed to update position:', error);
    }
  }
}

/* ======================== End Frozen Control Panel Functions ======================== */

class ResizeController {
  constructor(container, imageElement, options = {}) {
    this.container = container;
    this.imageElement = imageElement;
    this.onSave = options.onSave || (() => { }); // callback для сохранения
    this.onScaleChange = options.onScaleChange || (() => { }); // callback для обновления UI

    // State
    this.isResizing = false;
    this.resizeStartX = 0;
    this.resizeStartScale = 1;

    // Handlers (сохраняем ссылки для cleanup)
    this._mouseDownHandler = null;
    this._mouseMoveHandler = null;
    this._mouseUpHandler = null;

    // DOM
    this.handle = null;

    this.init();
  }

  init() {
    this.createHandle();
    this.attachHandlers();
  }

  createHandle() {
    this.handle = document.createElement("div");
    this.handle.className = "wbe-image-resize-handle";
    this.handle.style.cssText = `
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
      z-index: 1002;
      pointer-events: auto;
      user-select: none;
      transform-origin: center center;
    `;
    this.container.appendChild(this.handle);
  }

  attachHandlers() {
    this._mouseDownHandler = (e) => this._onMouseDown(e);
    this.handle.addEventListener('mousedown', this._mouseDownHandler);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;

    // Проверки из оригинального кода
    if (window.wbeImageControlPanel && window.wbeImageControlPanel.contains(e.target)) {
      return;
    }
    
    if (window.wbeFrozenControlPanel && window.wbeFrozenControlPanel.contains(e.target)) {
      return;
    }

    if (this.container.dataset.lockedBy && this.container.dataset.lockedBy !== game.user.id) {
      return;
    }

    if (isImageFrozen(this.container.id)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Захватываем state
    this.isResizing = true;
    isScalingImage = true; // Глобальный флаг для предотвращения deselect
    this.resizeStartX = e.clientX;

    const transform = this.imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    this.resizeStartScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    // Подписываемся на движение
    this._mouseMoveHandler = (e) => this._onMouseMove(e);
    this._mouseUpHandler = () => this._onMouseUp();

    document.addEventListener('mousemove', this._mouseMoveHandler);
    document.addEventListener('mouseup', this._mouseUpHandler);
  }

  _onMouseMove(e) {
    if (!this.isResizing) return;

    const deltaX = e.clientX - this.resizeStartX;
    const newScale = this.resizeStartScale + (deltaX * SCALE_SENSITIVITY);
    const finalScale = Math.max(0.01, newScale); // Только предотвращаем negative/zero

    // Обновляем scale
    this.imageElement.style.transform = `scale(${finalScale})`;

    // Store scale в CSS/Dataset system
    setImageCropData(this.imageElement, { scale: finalScale });

    // Колбэки для обновления UI
    this.onScaleChange(finalScale);
  }

  async _onMouseUp() {
    if (!this.isResizing) return;

    this.isResizing = false;
    isScalingImage = false; // Разрешаем deselect снова

    // Отписываемся от событий
    document.removeEventListener('mousemove', this._mouseMoveHandler);
    document.removeEventListener('mouseup', this._mouseUpHandler);
    this._mouseMoveHandler = null;
    this._mouseUpHandler = null;

    // Сохраняем состояние
    await this.onSave();
  }

  // Обновление позиции handle (вызывается извне)
  updatePosition() {
    const cropData = getImageCropData(this.imageElement);
    updateImageResizeHandle(
      this.handle,
      this.imageElement,
      cropData.maskType,
      cropData.crop,
      cropData.circleOffset,
      cropData.circleRadius,
      cropData.scale
    );
  }

  // Показать/скрыть handle
  show() {
    // Only show if not frozen
    if (this.handle && !isImageFrozen(this.container.id)) {
      this.handle.style.display = 'flex';
    }
  }

  hide() {
    if (this.handle) this.handle.style.display = 'none';
  }

  // Cleanup (гарантированное удаление всех handlers)
  destroy() {
    // Удаляем обработчики mousedown
    if (this._mouseDownHandler && this.handle) {
      this.handle.removeEventListener('mousedown', this._mouseDownHandler);
      this._mouseDownHandler = null;
    }

    // Удаляем обработчики mousemove/mouseup (если ресайз был активен)
    if (this._mouseMoveHandler) {
      document.removeEventListener('mousemove', this._mouseMoveHandler);
      this._mouseMoveHandler = null;
    }

    if (this._mouseUpHandler) {
      document.removeEventListener('mouseup', this._mouseUpHandler);
      this._mouseUpHandler = null;
    }

    // Удаляем DOM
    if (this.handle && this.handle.parentNode) {
      this.handle.parentNode.removeChild(this.handle);
    }

    // Destroy dragController if it exists
    if (this.dragController) {
      this.dragController.destroy();
      this.dragController = null;
    }

    this.handle = null;
    this.container = null;
    this.imageElement = null;
  }
}


/* ======================== Mask Control Panel System ======================== */

function killImageControlPanel() {
  const p = window.wbeImageControlPanel;
  if (p && typeof p.cleanup === "function") {
    try { p.cleanup(); } catch { }
  }
  // ✅ FIX: Ensure global reference is cleared even if cleanup fails
  window.wbeImageControlPanel = null;
}

async function showImageControlPanel(imageElement, container, currentMaskType, callbacks) {
  if (!imageElement || !container) return;

  killImageControlPanel();

  const panel = document.createElement("div");
  panel.className = "wbe-image-control-panel";
  panel.style.cssText = `
    position: fixed;
  background: white;
  border: 1px solid #d7d7d7;
  border-radius: 14px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
  padding: 6px;
  z-index: 10000;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  
  aspect-ratio: 4 / 1;
  transform: translateX(-50%) scale(.9) translateY(12px);
  opacity: 0;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);

  `;

  const toolbar = document.createElement("div");
  toolbar.style.cssText = `
    display: flex;
    gap: 12px;
    position: relative;
  `;

  // ========================================
  // HELPER FUNCTIONS (from colorpanel)
  // ========================================

  const setButtonActive = (button, isActive) => {
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
  };

  const makeToolbarButton = (label, iconClass) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wbe-image-toolbar-btn";
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
      icon.style.cssText = "font-size: 18px;";
      btn.appendChild(icon);
    }

    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active === "1") return;
      btn.style.background = "#ededf8";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active === "1") return;
      setButtonActive(btn, false);
    });

    return btn;
  };

  // ========================================
  // SUBPANEL MANAGEMENT (from colorpanel)
  // ========================================

  let activeSubpanel = null;
  let activeButton = null;
  let panelCurrentMaskType = currentMaskType;
  let isCropModeActive = false; // Track crop mode state within panel

  const closeSubpanel = () => {
    if (activeSubpanel) activeSubpanel.remove();
    if (activeButton) setButtonActive(activeButton, false);
    activeSubpanel = null;
    activeButton = null;
  };

  const positionSubpanel = () => {
    if (!activeSubpanel || !activeButton) return;
    const left = activeButton.offsetLeft + activeButton.offsetWidth / 2;
    activeSubpanel.style.left = `${left}px`;
    activeSubpanel.style.top = `-${activeSubpanel.offsetHeight + 10}px`;
  };

  // ========================================
  // BUILD CROP SUBPANEL (contains rect/circle buttons)
  // ========================================

  const buildCropSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "wbe-crop-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Mask Type";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const buttonsRow = document.createElement("div");
    buttonsRow.style.cssText = "display: flex; gap: 8px; justify-content: center;";
    sub.appendChild(buttonsRow);

    // Mini buttons for mask types
    const makeMaskButton = (label, iconClass, maskType) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        flex: 1;
        padding: 10px;
        border-radius: 8px;
        border: 2px solid #d0d0d0;
        background: white;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
        min-height: 60px;
      `;
      btn.title = label;

      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.cssText = "font-size: 18px; color: #333;";
      btn.appendChild(icon);

      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      labelEl.style.cssText = "font-size: 11px; color: #666; font-weight: 500;";
      btn.appendChild(labelEl);

      // Set active state
      const updateActiveState = (isActive) => {
        if (isActive) {
          btn.style.background = "#e0ebff";
          btn.style.borderColor = "#4d8dff";
          icon.style.color = "#1a3f8b";
          labelEl.style.color = "#1a3f8b";
          labelEl.style.fontWeight = "600";
        } else {
          btn.style.background = "white";
          btn.style.borderColor = "#d0d0d0";
          icon.style.color = "#333";
          labelEl.style.color = "#666";
          labelEl.style.fontWeight = "500";
        }
      };

      // Initial state
      updateActiveState(maskType === panelCurrentMaskType);

      // Click handler
      btn.addEventListener("click", () => {
        if (panelCurrentMaskType === maskType) return; // Already active

        panelCurrentMaskType = maskType;

        // Update both buttons in this row
        buttonsRow.querySelectorAll("button").forEach((b, idx) => {
          updateActiveState.call({
            btn: b,
            icon: b.querySelector("i"),
            labelEl: b.querySelector("span")
          }, idx === (maskType === 'rect' ? 0 : 1));
        });

        // Fire callback
        if (callbacks?.onMaskTypeChange) {
          try {
            callbacks.onMaskTypeChange(maskType);
          } catch (error) {
            console.error("[WB-E] onMaskTypeChange callback error:", error);
          }
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

      // Store references for external updates
      btn._updateActiveState = updateActiveState;
      btn._maskType = maskType;

      return btn;
    };

    const rectBtn = makeMaskButton("Rectangle", "fas fa-square", "rect");
    const circleBtn = makeMaskButton("Circle", "fas fa-circle", "circle");

    buttonsRow.appendChild(rectBtn);
    buttonsRow.appendChild(circleBtn);

    // Store button references on subpanel for external updates
    sub.rectBtn = rectBtn;
    sub.circleBtn = circleBtn;

    return sub;
  };

  // ========================================
  // OPEN SUBPANEL (from colorpanel pattern)
  // ========================================

  const openSubpanel = (type, button) => {
    if (activeButton === button) {
      // Clicking same button - toggle off
      closeSubpanel();
      return;
    }

    closeSubpanel();

    let subpanel = null;
    if (type === "crop") {
      // Enter crop mode when opening crop subpanel
      if (!isCropModeActive) {
        isCropModeActive = true;
        if (callbacks?.onCropModeToggle) {
          callbacks.onCropModeToggle(true);
        }
      }
      subpanel = buildCropSubpanel();
    }

    if (!subpanel) return;

    subpanel.style.opacity = "0";
    subpanel.style.transform = "translateY(-8px)";
    panel.appendChild(subpanel);

    activeSubpanel = subpanel;
    activeButton = button;
    setButtonActive(button, true);
    positionSubpanel();

    requestAnimationFrame(() => {
      if (!activeSubpanel) return;
      activeSubpanel.style.transition = "opacity 0.16s ease, transform 0.16s ease";
      activeSubpanel.style.opacity = "1";
      activeSubpanel.style.transform = "translateY(0)";
    });
  };

  // ========================================
  // CREATE TOOLBAR BUTTONS
  // ========================================

  const cropBtn = makeToolbarButton("Crop", "fas fa-crop");
  setButtonActive(cropBtn, false);

  cropBtn.addEventListener("click", () => openSubpanel("crop", cropBtn));

  const lockBtn = makeToolbarButton("Lock", "fas fa-lock");
  setButtonActive(lockBtn, false);

  // Track frozen state for this image
  let isFrozen = false;

  lockBtn.addEventListener("click", () => {
    isFrozen = !isFrozen;

    if (isFrozen) {
      // Freeze the image - prevent all interactions
      setButtonActive(lockBtn, true);
      lockBtn.innerHTML = '<i class="fas fa-unlock"></i>';
      lockBtn.title = "Unfreeze image";

      // Hide all other buttons except lock button
      const allButtons = toolbar.querySelectorAll('.wbe-image-toolbar-btn');
      allButtons.forEach(btn => {
        if (btn !== lockBtn) {
          btn.style.display = 'none';
        }
      });

      // Set image as frozen in registry
      setImageFrozen(container.id, true);

      // Start fade animation for panel only
      const fadeDuration = FREEZE_FADE_DURATION * 1000; // Convert to milliseconds

      // Fade out the panel
      panel.style.transition = `opacity ${FREEZE_FADE_DURATION}s ease-out`;
      panel.style.opacity = "0";

      // After fade animation completes, just deselect peacefully
      setTimeout(() => {
        // Kill the normal panel
        killImageControlPanel();

        // Deselect the image - it should stay deselected after freeze
        const imageData = imageRegistry.get(container.id);
        if (imageData && imageData.deselectFn) {
          imageData.deselectFn();
        }
      }, fadeDuration);

    } else {
      // This branch should not be reached in the new system
      // Unfreezing is now handled by the frozen panel's unfreeze button
      console.warn('[lockBtn] Unfreeze action should be handled by frozen panel');
      
      // Fallback: use the new unfreeze handler
      handleUnfreezeAction(container);
    }
  });

  toolbar.appendChild(cropBtn);
  toolbar.appendChild(lockBtn);
  panel.appendChild(toolbar);
  document.body.appendChild(panel);

  // ========================================
  // PANEL POSITIONING & LIFECYCLE
  // ========================================

  const updatePanelPosition = () => {
    const rect = imageElement.getBoundingClientRect();
    panel.style.left = `${rect.left + rect.width / 2}px`;
    panel.style.top = `${rect.top - 110}px`;
    positionSubpanel();
  };

  updatePanelPosition();
  requestAnimationFrame(() => {
    panel.style.transform = "translateX(-50%) scale(1) translateY(32px)";
    panel.style.opacity = "1";
  });

  // ========================================
  // CLICK OUTSIDE HANDLER (from colorpanel)
  // ========================================

  const onOutside = (ev) => {
    if (panel.contains(ev.target)) return;

    const clickedInsideImage = container?.contains(ev.target);

    const isCropUI = ev.target.closest(
      '.wbe-crop-handle-top, .wbe-crop-handle-right, ' +
      '.wbe-crop-handle-bottom, .wbe-crop-handle-left, ' +
      '.wbe-crop-handle-circle-resize, ' +
      '.wbe-image-selection-border'
    );

    // Если клик по crop UI - полностью игнорируем!
    if (isCropUI) {
      return;
    }

    if (activeSubpanel) {
      // Clicking outside subpanel but inside image - just close subpanel, keep panel
      if (clickedInsideImage) {
        closeSubpanel();

        window.wbeImageControlPanelUpdate?.();
        return;
      }
    }

    if (clickedInsideImage) {
      window.wbeImageControlPanelUpdate?.();
      return;
    }

    // Clicking completely outside - cleanup everything
    cleanup();
  };

  const onKey = (ev) => {
    if (ev.key === "Escape") {
      if (activeSubpanel) {
        // 1st ESC: Закрыть субпанель
        closeSubpanel();

      } else if (isCropModeActive) {
        // 2nd ESC: Выйти из crop mode
        isCropModeActive = false;
        if (callbacks?.onCropModeToggle) {
          callbacks.onCropModeToggle(false);
        }

      } else {
        // 3rd ESC: Закрыть панель
        cleanup();
      }
    }
  };

  panel.addEventListener("mousedown", (ev) => ev.stopPropagation());
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);

  function cleanup() {
    try { document.removeEventListener("mousedown", onOutside, true); } catch { }
    document.removeEventListener("keydown", onKey);

    closeSubpanel();
    // Exit crop mode if still active
    if (isCropModeActive) {
      isCropModeActive = false;
      if (callbacks?.onCropModeToggle) {
        callbacks.onCropModeToggle(false);
      }
    }

    panel.remove();
    window.wbeImageControlPanel = null;
    window.wbeImageControlPanelUpdate = null;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  panel.cleanup = cleanup;
  panel.closeSubpanel = closeSubpanel;
  panel.updatePanelState = (newMaskType) => {
    panelCurrentMaskType = newMaskType;
    // Update subpanel buttons if subpanel is open
    if (activeSubpanel && activeSubpanel.rectBtn && activeSubpanel.circleBtn) {
      activeSubpanel.rectBtn._updateActiveState(newMaskType === 'rect');
      activeSubpanel.circleBtn._updateActiveState(newMaskType === 'circle');
    }
  };

  window.wbeImageControlPanel = panel;
  window.wbeImageControlPanelUpdate = updatePanelPosition;
}




// Install global pan hooks for ImagePanel (similar to ColorPanel)
let __wbeMaskPanHooksInstalled = false;

function installGlobalMaskPanHooks() {
  if (__wbeMaskPanHooksInstalled) return;
  __wbeMaskPanHooksInstalled = true;

  let isCanvasPanningGlobal = false;
  let savedImageIdBeforePan = null;

  // Start pan on ANY right-button down; close panel immediately
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;

    // Hide panel without destroying it
    const panel = window.wbeImageControlPanel;
    if (panel) {
      panel.style.display = "none";
    }
    isCanvasPanningGlobal = true;
  }, true);

  // On pan end, reopen for the currently selected image (if any)
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    if (!isCanvasPanningGlobal) return;
    isCanvasPanningGlobal = false;

    // Show panel again
    const panel = window.wbeImageControlPanel;
    if (panel) {
      panel.style.display = "flex";
    }
  }, true);

  // Zoom wheel should also temporarily hide + then restore
  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    if (!selectedImageId) return;

    // Hide panel without destroying it
    const panel = window.wbeImageControlPanel;
    if (panel) {
      panel.style.display = "none";
      setTimeout(() => {
        if (panel) panel.style.display = "flex";
      }, 200);
    }
  }, { passive: true });
}

function safeReshowImagePanel(targetId, delayMs = 0) {
  const open = async () => {
    const container = document.getElementById(targetId);
    if (!container) return;

    const imageElement = container.querySelector(".wbe-canvas-image");
    if (!imageElement) return;

    // Get current mask type from the image
    const cropData = getImageCropData(imageElement);
    const currentMaskType = cropData.maskType || 'rect';

    // Reassert selection target in case other handlers nulled it
    selectedImageId = targetId;

    showImageControlPanel(imageElement, container, currentMaskType);
  };

  if (delayMs <= 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        open();
      });
    });
  } else {
    setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          open();
        });
      });
    }, delayMs);
  }
}

// Install global pan hooks
installGlobalMaskPanHooks();

/* ======================== End Mask Control Panel System ======================== */


function ensureRemovalObserver() {
  const layer = createCardsLayer();
  if (!layer) return;
  if (removalObserver) return;

  removalObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = /** @type {HTMLElement} */ (node);
        const elementId = element.id;

        if (!elementId) continue;

        if (imageRegistry.has(elementId)) {
          clearImageCaches(elementId);
        }
      }
    }
  });

  removalObserver.observe(layer, { childList: true });
}

Hooks.on("canvasReady", ensureRemovalObserver);
Hooks.on("canvasTearDown", () => {
  if (removalObserver) {
    removalObserver.disconnect();
    removalObserver = null;
  }
});

if (globalThis.canvas?.ready) ensureRemovalObserver();

/* ----------------------- Global Event Listeners ------------------ */
// Single global keydown listener for all images
document.addEventListener("keydown", (e) => {
  if (!selectedImageId) return;
  const container = document.getElementById(selectedImageId);
  if (!container) return;

  // Delete / Backspace
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    e.stopPropagation();

    // ✅ FIX: Kill image control panel before deletion
    killImageControlPanel();

    // Clear runtime caches FIRST to prevent resurrection
    clearImageCaches(selectedImageId);
    // call the image's delete via registry
    const imageData = imageRegistry.get(selectedImageId);
    if (imageData && imageData.deselectFn) {
      imageData.deselectFn(); // ensure exit crop first
    }

    // Clean up z-index
    ZIndexManager.removeImage(selectedImageId);

    container.remove();
    (async () => {
      const images = await getAllImages();
      delete images[selectedImageId];
      await setAllImages(images);
    })();
  }

  // Ctrl+C - программно вызываем copy
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "c")) {
    e.preventDefault();
    document.execCommand("copy");
  }
});

// Single global copy listener for all images
document.addEventListener("copy", (e) => {
  if (!selectedImageId) return;
  const container = document.getElementById(selectedImageId);
  const imageElement = container?.querySelector(".wbe-canvas-image");
  if (!imageElement) return;

  e.preventDefault();
  e.stopPropagation();

  // ✨ CRITICAL: Read fresh data from DOM instead of stale closure variables
  const { crop, maskType, circleOffset, circleRadius, scale } = getImageCropData(imageElement);

  copiedImageData = {
    src: imageElement.src,
    scale,
    crop: { ...crop },
    maskType,
    circleOffset: { ...circleOffset },
    circleRadius
  };

  e.clipboardData?.setData("text/plain", `[wbe-IMAGE-COPY:${selectedImageId}]`);
  ui.notifications.info("Картинка скопирована (Ctrl+V для вставки)");
});

// cleanup methods for socket updates
function clearImageCaches(id) {
  // Cleanup controllers if they exist in registry
  const imageData = imageRegistry.get(id);
  if (imageData) {
    if (imageData.dragController) {
      imageData.dragController.destroy();
    }
    if (imageData.resizeController) {
      imageData.resizeController.destroy();
    }
    if (imageData.selectionController) {
      imageData.selectionController.destroy();
    }
  }

  // Clear from registry
  imageRegistry.delete(id);
  // Clear from global data
  delete globalImageData[id];
  delete imageLocalVars[id];
}

/**
 * Get ALL crop/mask data from an image element (CSS/Dataset = source of truth)
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element
 * @returns {Object} Complete crop data
 */
function getImageCropData(imageElement) {
  if (!imageElement) {
    return {
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      maskType: 'rect',
      circleOffset: { x: 0, y: 0 },
      circleRadius: null,
      scale: 1
    };
  }

  return {
    crop: {
      top: parseFloat(imageElement.style.getPropertyValue('--crop-top')) || 0,
      right: parseFloat(imageElement.style.getPropertyValue('--crop-right')) || 0,
      bottom: parseFloat(imageElement.style.getPropertyValue('--crop-bottom')) || 0,
      left: parseFloat(imageElement.style.getPropertyValue('--crop-left')) || 0
    },
    maskType: imageElement.dataset.maskType || 'rect',
    circleOffset: {
      x: parseFloat(imageElement.dataset.circleOffsetX) || 0,
      y: parseFloat(imageElement.dataset.circleOffsetY) || 0
    },
    circleRadius: (imageElement.dataset.circleRadius !== undefined && imageElement.dataset.circleRadius !== 'null')
      ? parseFloat(imageElement.dataset.circleRadius)
      : null,
    scale: parseFloat(imageElement.style.transform.match(/scale\(([\d.]+)\)/)?.[1] || 1)
  };
}

function getUnscaledSize(imageElement) {
  const rect = imageElement.getBoundingClientRect();
  const scaleMatch = (imageElement.style.transform || "").match(/scale\(([\d.]+)\)/);
  const s = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
  // rect.width/height включают transform; делим на scale и получаем "локальные" размеры
  return { width: rect.width / s, height: rect.height / s, scale: s };
}

/**
 * Set crop/mask data on an image element (updates CSS/Dataset)
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element
 * @param {Object} data - Crop data to set
 */
function setImageCropData(imageElement, data) {
  if (!imageElement) return;

  if (data.crop) {
    imageElement.style.setProperty('--crop-top', `${data.crop.top}px`);
    imageElement.style.setProperty('--crop-right', `${data.crop.right}px`);
    imageElement.style.setProperty('--crop-bottom', `${data.crop.bottom}px`);
    imageElement.style.setProperty('--crop-left', `${data.crop.left}px`);
  }

  if (data.maskType !== undefined) {
    imageElement.dataset.maskType = data.maskType;
  }

  if (data.circleOffset) {
    imageElement.dataset.circleOffsetX = data.circleOffset.x;
    imageElement.dataset.circleOffsetY = data.circleOffset.y;
  }

  if (data.circleRadius !== undefined) {
    imageElement.dataset.circleRadius = data.circleRadius;
  }

  if (data.scale !== undefined) {
    imageElement.style.transform = `scale(${data.scale})`;
  }
}

/**
 * Update click target overlay to match visible (cropped) area
 * This prevents clicking/dragging invisible cropped parts
 * @param {HTMLElement} clickTarget - The click target overlay element
 * @param {HTMLElement} imageElement - The .wbe-canvas-image element  
 * @param {string} maskType - 'rect' or 'circle'
 * @param {Object} crop - Crop values {top, right, bottom, left}
 * @param {Object} circleOffset - Circle offset {x, y}
 * @param {number} circleRadius - Circle radius
 * @param {number} scale - Image scale
 */
function updateClickTarget(clickTarget, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  if (!clickTarget || !imageElement) return;

  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (maskType === 'rect') {
    const croppedWidth = width - crop.left - crop.right;
    const croppedHeight = height - crop.top - crop.bottom;
    clickTarget.style.width = `${croppedWidth * scale}px`;
    clickTarget.style.height = `${croppedHeight * scale}px`;
    clickTarget.style.left = `${crop.left * scale}px`;
    clickTarget.style.top = `${crop.top * scale}px`;
    clickTarget.style.borderRadius = "0";
  } else if (maskType === 'circle') {
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const diameter = currentRadius * 2;
    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;

    clickTarget.style.width = `${diameter * scale}px`;
    clickTarget.style.height = `${diameter * scale}px`;
    clickTarget.style.left = `${(centerX - currentRadius) * scale}px`;
    clickTarget.style.top = `${(centerY - currentRadius) * scale}px`;
    clickTarget.style.borderRadius = "50%";
  }
}

/* ----------------------- Image Crop Data Helpers (Single Source of Truth) ------------------ */
// ✨ NEW ARCHITECTURE: All crop/mask data lives in CSS/Dataset ONLY
// These helpers provide a unified interface to read/write that data






/* ----------------------- Image Lock Visual Functions ------------------ */
function applyImageLockVisual(container, lockerId, lockerName) {
  // ✨ CRITICAL: Deselect image if this user had it selected
  // This prevents stale selection UI when lock is removed
  const wasSelected = container.dataset.selected === "true";
  if (wasSelected) {
    const imageData = imageRegistry.get(container.id);
    if (imageData && imageData.deselectFn) {
      imageData.deselectFn();
    }
  }

  // Блокируем все взаимодействия
  container.dataset.lockedBy = lockerId;
  container.style.pointerEvents = "none";

  const imageElement = container.querySelector(".wbe-canvas-image");
  if (!imageElement) return;

  // ✨ NEW ARCHITECTURE: Get current crop/scale data to size overlay correctly
  const cropData = getImageCropData(imageElement);
  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  // Calculate overlay dimensions based on mask type (same logic as borders)
  let overlayWidth, overlayHeight, overlayLeft, overlayTop, borderRadius;

  if (cropData.maskType === 'rect') {
    const croppedWidth = width - cropData.crop.left - cropData.crop.right;
    const croppedHeight = height - cropData.crop.top - cropData.crop.bottom;
    overlayWidth = croppedWidth * cropData.scale;
    overlayHeight = croppedHeight * cropData.scale;
    overlayLeft = cropData.crop.left * cropData.scale;
    overlayTop = cropData.crop.top * cropData.scale;
    borderRadius = "0";
  } else if (cropData.maskType === 'circle') {
    const currentRadius = cropData.circleRadius !== null ? cropData.circleRadius : Math.min(width, height) / 2;
    const diameter = currentRadius * 2;
    overlayWidth = diameter * cropData.scale;
    overlayHeight = diameter * cropData.scale;
    const centerX = width / 2 + cropData.circleOffset.x;
    const centerY = height / 2 + cropData.circleOffset.y;
    overlayLeft = (centerX - currentRadius) * cropData.scale;
    overlayTop = (centerY - currentRadius) * cropData.scale;
    borderRadius = "50%";
  }


  // Создаём overlay с фиолетовой рамкой и opacity
  let lockOverlay = container.querySelector(".wbe-image-lock-overlay");
  if (!lockOverlay) {
    lockOverlay = document.createElement("div");
    lockOverlay.className = "wbe-image-lock-overlay";
    container.appendChild(lockOverlay);
  }

  // Update overlay styles with calculated dimensions
  lockOverlay.style.cssText = `
      position: absolute;
      left: ${overlayLeft}px;
      top: ${overlayTop}px;
      width: ${overlayWidth}px;
      height: ${overlayHeight}px;
      background: rgba(128, 0, 128, 0.1);
      border: 1px solid rgba(128, 0, 255, 0.8);
      border-radius: ${borderRadius};
      pointer-events: none;
      z-index: 1010;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

  // Add lock icon if not exists
  let lockIcon = lockOverlay.querySelector(".wbe-lock-icon");
  if (!lockIcon) {
    lockIcon = document.createElement("div");
    lockIcon.className = "wbe-lock-icon";
    lockIcon.innerHTML = `
        <i class="fas fa-crop-alt" style="font-size: 32px; color: rgba(128, 0, 255, 0.9); text-shadow: 0 0 8px rgba(0,0,0,0.8);"></i>
        <div style="
          margin-top: 8px;
          font-size: 14px;
          font-weight: bold;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 0 6px rgba(0,0,0,0.9);
          text-align: center;
        ">${lockerName} is cropping</div>
      `;
    lockIcon.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
      `;
    lockOverlay.appendChild(lockIcon);
  } else {
    // Update locker name if already exists
    const nameDiv = lockIcon.querySelector("div");
    if (nameDiv) nameDiv.textContent = `${lockerName} is cropping`;
  }

  // Применяем opacity к самому изображению
  imageElement.style.opacity = "0.7";
}

function removeImageLockVisual(container) {

  // Убираем блокировку
  delete container.dataset.lockedBy;

  // Удаляем overlay
  const lockOverlay = container.querySelector(".wbe-image-lock-overlay");
  if (lockOverlay) {
    lockOverlay.remove();
  }

  // Возвращаем opacity
  const imageElement = container.querySelector(".wbe-canvas-image");
  if (imageElement) {
    imageElement.style.opacity = "1";
  }

  // Восстанавливаем UI в зависимости от состояния выделения
  const wasSelected = container.dataset.selected === "true";
  const permanentBorder = container.querySelector(".wbe-image-permanent-border");
  const selectionBorder = container.querySelector(".wbe-image-selection-border");
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");

  if (wasSelected) {
    // Было выделено - восстанавливаем полный UI выделения
    // Don't set pointer-events on container - let click target handle interactions
    // container.style.setProperty("pointer-events", "auto", "important");
    // container.style.setProperty("cursor", "move", "important");

    // ✅ FIX: Let SelectionController manage permanent border
    if (selectionBorder) {
      selectionBorder.style.display = "block";
      selectionBorder.style.borderColor = "#4a9eff"; // Стандартный цвет выделения
    }
    if (resizeHandle && !isImageFrozen(container.id)) {
      resizeHandle.style.display = "flex";
    }
  } else {
    // Не было выделено - возвращаем в базовое состояние
    container.style.removeProperty("pointer-events");
    container.style.removeProperty("cursor");

    // ✅ FIX: Let SelectionController manage permanent border
    if (selectionBorder) selectionBorder.style.display = "none";
    if (resizeHandle) resizeHandle.style.display = "none";

    // ✨ NEW ARCHITECTURE: Update permanent border with current crop data
    if (permanentBorder && imageElement) {
      const cropData = getImageCropData(imageElement);
      updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

      // Update click target to match visible area
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

      // Set move cursor on click target when restoring selected state
      if (clickTarget) {
        // clickTarget.style.cursor = "move"; // Removed move cursor
      }
    }
  }
}

function installGlobalImageSelectionHandler() {
  if (globalImageSelectionHandlerInstalled) return;


  document.addEventListener("mousedown", async (e) => {


    if (e.button !== 0) return; // Only left click

    // ✅ FIX: Prevent image deselection when clicking ImageControlPanel or FrozenControlPanel
    if (window.wbeImageControlPanel && window.wbeImageControlPanel.contains(e.target)) {
      return; // Don't process image selection when clicking ImageControlPanel
    }
    
    if (window.wbeFrozenControlPanel && window.wbeFrozenControlPanel.contains(e.target)) {
      return; // Don't process image selection when clicking FrozenControlPanel
    }

    // ✅ FIX: Prevent dual selection - check if clicking on other element types first
    const textContainer = e.target.closest(".wbe-canvas-text-container");
    const cardContainer = e.target.closest(".wbe-canvas-card-container");
    const colorPanel = e.target.closest(".wbe-color-picker-panel");

    // ✅ FIX: Text elements have pointer-events: none, so we need to check coordinates
    let clickedOnText = !!textContainer;
    if (!clickedOnText && e.target.tagName === 'CANVAS') {
      // Check if there's a text element at these coordinates
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      clickedOnText = elementsAtPoint.some(el =>
        el.classList.contains('wbe-canvas-text-container') ||
        el.classList.contains('wbe-canvas-text')
      );

    }

    // If clicking on text, cards, or color panels, don't process image selection
    if (clickedOnText || cardContainer || colorPanel) {
      // ✅ FIX: Always deselect images when clicking on text, regardless of text selection state
      for (const [id, imageData] of imageRegistry) {
        if (imageData.container.dataset.selected === "true") {

          await imageData.deselectFn();
        }
      }
      return; // Let other handlers deal with text/card selection
    }

    let clickedImageId = null;
    let clickedImageData = null;

    // Debug: Check if we have any selected images before processing
    // Track currently selected images for deselection logic
    const currentlySelectedImages = Array.from(imageRegistry.entries())
      .filter(([id, data]) => data.container.dataset.selected === "true")
      .map(([id]) => id);

    // ✅ FIX: Check images in z-index order (highest first) for proper overlapping handling
    const sortedImages = Array.from(imageRegistry.entries()).sort(([idA, dataA], [idB, dataB]) => {
      const zIndexA = parseInt(dataA.container.style.zIndex) || 0;
      const zIndexB = parseInt(dataB.container.style.zIndex) || 0;
      return zIndexB - zIndexA; // Highest z-index first
    });

    // Check which image (if any) was clicked
    for (const [id, imageData] of sortedImages) {
      const container = imageData.container;

      // NEW: Allow frozen images to be clicked for status display
      // Frozen images can be clicked but drag/resize is blocked in controllers
      // (No early exit for frozen images)

      // Skip locked images
      if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
        continue;
      }

      // ✅ PREVENT SINGLE CLICK SELECTION OF MASS-SELECTED IMAGES
      if (container.classList.contains("wbe-mass-selected")) {
        continue; // Skip mass-selected images for individual selection
      }

      // Temporarily enable pointer-events to check hit detection
      const originalPointerEvents = container.style.pointerEvents;
      container.style.setProperty("pointer-events", "auto", "important");

      // Also ensure click target is enabled for hit detection
      const clickTarget = container.querySelector(".wbe-image-click-target");
      const originalClickTargetEvents = clickTarget?.style.pointerEvents;
      if (clickTarget) {
        clickTarget.style.setProperty("pointer-events", "auto", "important");
      }

      // Click target already enabled above

      const cropHandles = container.querySelectorAll(
        '.wbe-crop-handle-top, .wbe-crop-handle-right, ' +
        '.wbe-crop-handle-bottom, .wbe-crop-handle-left, ' +
        '.wbe-crop-handle-circle-resize'
      );

      const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
      const isCropUI = Array.from(cropHandles).some(h =>
        h === elementUnderCursor || h.contains(elementUnderCursor)
      );

      const resizeHandle = container.querySelector(".wbe-image-resize-handle");
      const clickedOnThis = elementUnderCursor === clickTarget ||
        (clickTarget && clickTarget.contains(elementUnderCursor)) ||
        elementUnderCursor === resizeHandle || isCropUI;

      // Debug logging removed for performance




      if (clickedOnThis) {
        clickedImageId = id;
        clickedImageData = imageData;
        // Found clicked image


        // If this image is in crop mode for THIS user, keep pointer-events enabled
        const inCropModeForMe = container.dataset.lockedBy === game.user.id;
        if (!inCropModeForMe) {
          container.style.setProperty("pointer-events", "none", "important");
          // Enable click target for selected image
          const clickTarget = container.querySelector(".wbe-image-click-target");
          if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "auto", "important");
          }
        } else {
          container.style.setProperty("pointer-events", "auto", "important");
          const clickTarget = container.querySelector(".wbe-image-click-target");
          if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "auto", "important");
          }
        }
        break;
      } else {
        // For non-clicked containers, only force none if they aren't in my crop mode
        const inCropModeForMe = container.dataset.lockedBy === game.user.id;
        if (!inCropModeForMe) {
          container.style.setProperty("pointer-events", "none", "important");
          // Disable click target for non-selected images
          const clickTarget = container.querySelector(".wbe-image-click-target");
          if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "none", "important");
          }
        } else {
          container.style.setProperty("pointer-events", "auto", "important");
          const clickTarget = container.querySelector(".wbe-image-click-target");
          if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "auto", "important");
          }
        }
      }
    }

    // Handle selection/deselection
    if (clickedImageId && clickedImageData) {
      // Debug logging removed for performance

      // Clicked on an image
      const isSelected = clickedImageData.container.dataset.selected === "true";

      if (!isSelected) {
        // Selecting image

        // ✅ CRITICAL: Prevent event propagation to avoid dual selection
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Stop other handlers on same element

        // ✅ CLEAR MASS SELECTION when selecting individual image
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }

        // Deselect all others first
        for (const [otherId, otherData] of imageRegistry) {
          if (otherId !== clickedImageId && otherData.container.dataset.selected === "true") {
            await otherData.deselectFn(); // Await async deselect
          }
        }

        // Select this one
        clickedImageData.selectFn();
      } else {
        // Already selected - no action needed
      }
    } else {
      // Clicked elsewhere - deselect images

      // Clicked elsewhere - deselect all selected images (unless scaling)
      // The only exception is the image control panel, which is already handled above
      if (!isScalingImage) {
        for (const [id, imageData] of imageRegistry) {
          if (imageData.container.dataset.selected === "true") {
            await imageData.deselectFn(); // Await async deselect
          }
          // ✅ REMOVED: Redundant SelectionController check that caused state mismatch loop
          // The deselectFn() already handles SelectionController deselection properly
        }
      }
    }
  }, true); // Capture phase

  globalImageSelectionHandlerInstalled = true;
}

/* ----------------------- Canvas Text/Image Functions ------------------ */

function createImageElement(id, src, left, top, scale = 1, crop = { top: 0, right: 0, bottom: 0, left: 0 }, maskType = 'rect', circleOffset = { x: 0, y: 0 }, circleRadiusParam = null, existingZIndex = null) {
  console.log('[DEBUG] Creating image element:', { id, src, left, top, scale, crop, maskType });
  const layer = getOrCreateLayer();
  if (!layer) return;

  // Читаем maskType из глобальных переменных
  let currentMaskType = (maskType !== undefined && maskType !== null) ? maskType : (getImageLocalVars(id).maskType ?? 'rect');

  // ✨ Вспомогательная функция для обновления глобальных переменных
  function updateGlobalVars() {
    updateImageLocalVars(id, {
      maskType: currentMaskType,
      circleOffset: { x: circleOffsetX, y: circleOffsetY },
      circleRadius: circleRadius,
      crop: { ...crop },
      scale: parseFloat(imageElement.style.transform.match(/scale\(([\d.]+)\)/)?.[1] || 1),
      isSelected: selectionController.isSelected(),
      isCropping: isCropping
    });
  }

  // Контейнер для позиционирования (БЕЗ translate)
  const container = document.createElement("div");
  container.id = id;
  container.className = "wbe-canvas-image-container";
  // ✅ Get z-index from ZIndexManager or use existing
  const zIndex = existingZIndex || ZIndexManager.assignImage(id);

  // If using existing z-index, make sure it's registered in the manager
  if (existingZIndex) {
    ZIndexManager.imageZIndexes.set(id, existingZIndex);
  }

  container.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      z-index: ${zIndex};
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
    `;

  // Внутренний элемент для контента + масштабирование
  const imageElement = document.createElement("img");
  imageElement.className = "wbe-canvas-image";

  // ✨ Progressive loading: Show placeholder IMMEDIATELY
  imageElement.style.cssText = `
      transform: scale(${scale});
      transform-origin: top left;
      max-width: 200px;
      max-height: 200px;
      display: block;
      border: none !important;
      pointer-events: none;
      background: linear-gradient(45deg, #f0f0f0 25%, transparent 25%), 
                  linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), 
                  linear-gradient(45deg, transparent 75%, #f0f0f0 75%), 
                  linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
      opacity: 0.8;
      transition: opacity 0.3s ease;
    `;

  // Add loading indicator
  const loadingIndicator = document.createElement("div");
  loadingIndicator.className = "wbe-image-loading";
  loadingIndicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 24px;
      height: 24px;
      border: 2px solid #4a9eff;
      border-top: 2px solid transparent;
      border-radius: 50%;
      animation: wbe-spin 1s linear infinite;
      z-index: 10;
    `;

  // Add CSS animation for spinner
  if (!document.getElementById("wbe-loading-styles")) {
    const style = document.createElement("style");
    style.id = "wbe-loading-styles";
    style.textContent = `
        @keyframes wbe-spin {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `;
    document.head.appendChild(style);
  }

  container.appendChild(loadingIndicator);

  // Track loading start time for minimum display duration
  const loadingStartTime = Date.now();
  const minDisplayDuration = 500; // 0.5 seconds

  // Set up progressive loading
  imageElement.addEventListener("load", () => {
    const elapsedTime = Date.now() - loadingStartTime;
    const remainingTime = Math.max(0, minDisplayDuration - elapsedTime);

    // Ensure placeholder is visible for at least 0.5 seconds
    setTimeout(() => {
      // Image loaded successfully
      imageElement.style.opacity = "1";
      imageElement.style.background = "none";
      loadingIndicator.remove();
      imageElement.style.width = "auto";
      imageElement.style.height = "auto";

      // Update UI elements that depend on image dimensions
      updateClipPath();
      updateSelectionBorderSize();
      updateHandlePosition();

      // Update click target after image loads
      const cropData = getImageCropData(imageElement);
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
    }, remainingTime);
  });

  imageElement.addEventListener("error", () => {
    // Image failed to load - show error state with proper dimensions
    console.error(`[WB-E] Failed to load image: ${src}`);

    // Set a reasonable fallback size for the error state
    imageElement.style.width = "200px";
    imageElement.style.height = "150px";
    imageElement.style.background = "linear-gradient(45deg, #ffcccc 25%, transparent 25%), linear-gradient(-45deg, #ffcccc 25%, transparent 25%)";
    imageElement.style.backgroundSize = "20px 20px";
    imageElement.style.opacity = "1";

    // Update loading indicator to show error
    loadingIndicator.innerHTML = "❌";
    loadingIndicator.style.animation = "none";
    loadingIndicator.style.border = "2px solid #ff4444";
    loadingIndicator.style.backgroundColor = "rgba(255, 255, 255, 0.9)";

    // Update UI elements with fallback dimensions
    setTimeout(() => {
      updateClipPath();
      updateSelectionBorderSize();
      updateHandlePosition();

      // Update click target with error state dimensions
      const cropData = getImageCropData(imageElement);
      const clickTarget = container.querySelector(".wbe-image-click-target");
      updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);
    }, 100);
  });

  // Start loading the image
  imageElement.src = src;

  // ✨ Init circle from the *arguments* first; fall back to locals
  const local = getImageLocalVars(id);
  let circleOffsetX = (circleOffset && typeof circleOffset.x === "number")
    ? circleOffset.x
    : (local.circleOffset?.x ?? 0);
  let circleOffsetY = (circleOffset && typeof circleOffset.y === "number")
    ? circleOffset.y
    : (local.circleOffset?.y ?? 0);

  // Normalize radius: use param if provided, else local, else null
  let circleRadius = (circleRadiusParam !== undefined)
    ? circleRadiusParam
    : (local.circleRadius ?? null);
  if (circleRadius === undefined) circleRadius = null;

  // ✨ Seed the single source of truth (CSS vars + dataset) from incoming state
  setImageCropData(imageElement, {
    crop,
    maskType: currentMaskType,
    circleOffset: { x: circleOffsetX, y: circleOffsetY },
    circleRadius: circleRadius,
    scale
  });

  // Function to clamp circle offset to bounds (moved inside createImageElement for scope access)
  function clampCircleOffsetToBounds() {
    const { width: baseW, height: baseH } = getUnscaledSize(imageElement);
    if (baseW <= 0 || baseH <= 0) return;
    const r = (circleRadius == null) ? Math.min(baseW, baseH) / 2 : circleRadius;
    const minOffX = -(baseW / 2 - r);
    const maxOffX = (baseW / 2 - r);
    const minOffY = -(baseH / 2 - r);
    const maxOffY = (baseH / 2 - r);
    circleOffsetX = Math.max(minOffX, Math.min(maxOffX, circleOffsetX));
    circleOffsetY = Math.max(minOffY, Math.min(maxOffY, circleOffsetY));
    setImageCropData(imageElement, { circleOffset: { x: circleOffsetX, y: circleOffsetY } });
  }

  // Применяем маску (crop)
  function updateClipPath() {
    if (currentMaskType === 'rect') {
      // Прямоугольная маска (inset)
      const clipPath = `inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px)`;
      imageElement.style.clipPath = clipPath;
    } else if (currentMaskType === 'circle') {
      // Круговая маска (circle)
      const width = imageElement.offsetWidth;
      const height = imageElement.offsetHeight;

      if (width === 0 || height === 0) {
        console.warn("⚠️ Image not loaded yet, skipping clip-path");
        return; // Пропускаем если картинка еще не загружена
      }

      // Используем сохраненный радиус или вычисляем по умолчанию
      if (circleRadius === null) {
        circleRadius = Math.min(width, height) / 2; // Радиус = половина меньшей стороны
      }

      const centerX = width / 2 + circleOffsetX;
      const centerY = height / 2 + circleOffsetY;
      const clipPath = `circle(${circleRadius}px at ${centerX}px ${centerY}px)`;
      imageElement.style.clipPath = clipPath;
    }
  }
  updateClipPath();

  // Robust mask-type toggle that creates/destroys the right handles
  function updateMaskType() {
    // 0) Write mask to the single source of truth (CSS/dataset) first
    setImageCropData(imageElement, { maskType: currentMaskType });

    // 1) Mirror to our local vars cache
    updateGlobalVars();

    // 2) Apply visual clip immediately
    updateClipPath();

    // 3) Ensure correct handles exist for the new mode; remove wrong ones
    const ensureRectHandles = () => {
      // ALWAYS force clean slate to avoid stale listeners
      // Remove any existing rect handles (even if partial)

      // Check for orphaned gizmos in DOM
      const allGizmos = container.querySelectorAll('[class*="wbe-crop-handle"]');
      if (allGizmos.length > 0) {
      }

      ["top", "right", "bottom", "left"].forEach(k => {
        if (cropHandles[k] && cropHandles[k].parentNode) {
          cropHandles[k].parentNode.removeChild(cropHandles[k]);
        }
        cropHandles[k] = null;
      });

      // Create all 4 rect handles as a unit (always fresh)
      const handleSize = 12;
      const baseStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: 1003;
          pointer-events: auto;
        `;

      const gizmoId = `gizmo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;


      cropHandles.top = document.createElement("div");
      cropHandles.top.className = "wbe-crop-handle-top";
      cropHandles.top.style.cssText = baseStyle + `cursor: ns-resize;`;
      cropHandles.top.dataset.gizmoId = `${gizmoId}-top`;
      container.appendChild(cropHandles.top);

      cropHandles.right = document.createElement("div");
      cropHandles.right.className = "wbe-crop-handle-right";
      cropHandles.right.style.cssText = baseStyle + `cursor: ew-resize;`;
      cropHandles.right.dataset.gizmoId = `${gizmoId}-right`;
      container.appendChild(cropHandles.right);

      cropHandles.bottom = document.createElement("div");
      cropHandles.bottom.className = "wbe-crop-handle-bottom";
      cropHandles.bottom.style.cssText = baseStyle + `cursor: ns-resize;`;
      cropHandles.bottom.dataset.gizmoId = `${gizmoId}-bottom`;
      container.appendChild(cropHandles.bottom);

      cropHandles.left = document.createElement("div");
      cropHandles.left.className = "wbe-crop-handle-left";
      cropHandles.left.style.cssText = baseStyle + `cursor: ew-resize;`;
      cropHandles.left.dataset.gizmoId = `${gizmoId}-left`;
      container.appendChild(cropHandles.left);

      // ALWAYS attach listeners (to fresh handles)
      setupCropHandleDrag();

      // Remove circle handle if present
      if (cropHandles.circleResize && cropHandles.circleResize.parentNode) {
        cropHandles.circleResize.parentNode.removeChild(cropHandles.circleResize);
      }
      cropHandles.circleResize = null;
      // Also stop circle drag
      cleanupCircleDrag();
    };

    const ensureCircleHandles = () => {
      // ALWAYS force clean slate - remove all rect handles

      // Check for orphaned gizmos in DOM
      const allGizmos = container.querySelectorAll('[class*="wbe-crop-handle"]');
      if (allGizmos.length > 0) {
      }

      ["top", "right", "bottom", "left"].forEach(k => {
        if (cropHandles[k] && cropHandles[k].parentNode) {
          cropHandles[k].parentNode.removeChild(cropHandles[k]);
        }
        cropHandles[k] = null;
      });

      // ALWAYS clean up old circle handle and listeners
      cleanupCircleDrag();
      if (cropHandles.circleResize && cropHandles.circleResize.parentNode) {
        cropHandles.circleResize.parentNode.removeChild(cropHandles.circleResize);
      }
      cropHandles.circleResize = null;

      // ALWAYS create fresh circle handle
      const handleSize = 12;
      const baseStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: 1003;
          pointer-events: auto;
        `;
      const gizmoId = `gizmo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      cropHandles.circleResize = document.createElement("div");
      cropHandles.circleResize.className = "wbe-crop-handle-circle-resize";
      cropHandles.circleResize.style.cssText = baseStyle + `cursor: nw-resize;`;
      cropHandles.circleResize.dataset.gizmoId = `${gizmoId}-circle`;
      container.appendChild(cropHandles.circleResize);

      // ALWAYS attach fresh listeners
      setupCircleResizeHandleDrag();
      setupCircleDrag();
    };

    if (isCropping) {
      selectionBorder.style.display = "block";
      selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)";
      if (currentMaskType === "rect") {
        ensureRectHandles();
      } else {
        ensureCircleHandles();
      }
      updateSelectionBorderSize();
      updateCropHandlesPosition();
      updateCircleResizeHandlePosition();
    } else {
      updateSelectionBorderSize();
      updateCircleResizeHandlePosition();
    }

    // 4) Refresh permanent border and click target from current DOM data
    const dataNow = getImageCropData(imageElement);
    updateImageBorder(permanentBorder, imageElement, dataNow.maskType, dataNow.crop, dataNow.circleOffset, dataNow.circleRadius, dataNow.scale);
    const clickTarget = container.querySelector(".wbe-image-click-target");
    if (clickTarget) {
      updateClickTarget(clickTarget, imageElement, dataNow.maskType, dataNow.crop, dataNow.circleOffset, dataNow.circleRadius, dataNow.scale);
    }
  }



  container.appendChild(imageElement);

  // Permanent border (серая рамка, показывается только когда НЕ выделена)
  const permanentBorder = document.createElement("div");
  permanentBorder.className = "wbe-image-permanent-border";
  permanentBorder.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      border: 2px solid rgba(255, 255, 255, 0.6);
      pointer-events: none;
      display: block;
      z-index: 1001;
    `;
  container.appendChild(permanentBorder);

  // Selection border overlay (синяя рамка при выделении)
  const selectionBorder = document.createElement("div");
  selectionBorder.className = "wbe-image-selection-border";
  selectionBorder.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      border: 1px solid #4a9eff;
      pointer-events: none;
      display: none;
      z-index: 1002;
    `;
  container.appendChild(selectionBorder);

  // ✨ Click target overlay - matches ONLY visible (cropped) area
  // This prevents clicking/dragging by invisible cropped parts
  // Positioned exactly where the visible image is
  const clickTarget = document.createElement("div");
  clickTarget.className = "wbe-image-click-target";
  clickTarget.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      background: transparent;
      pointer-events: none;
      z-index: 998;
    `;
  container.appendChild(clickTarget);

  // DISABLED: Двойной клик → toggle crop mode (on clickTarget since it's on top)
  // clickTarget.addEventListener("dblclick", async (e) => {
  //   if (!isSelected) return; // Работает только на выделенной картинке
  //   e.preventDefault();
  //   e.stopPropagation();
  //   
  //   // Проверяем блокировку перед переключением
  //   if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
  //     ui.notifications.warn("This image is being cropped by another user");
  //     return;
  //   }
  //   
  //   isCropping = !isCropping;
  //   
  //   if (isCropping) {
  //     enterCropMode();
  //   } else {
  //     await exitCropMode(); // Await to ensure save completes
  //   }
  // });

  // Инициализируем размеры рамок (но только ПОСЛЕ загрузки картинки)
  // НЕ вызываем здесь, т.к. imageElement.offsetWidth/Height = 0

  layer.appendChild(container);

  // Click target will be updated after image loads (handled by progressive loading system)

  const resizeController = new ResizeController(container, imageElement, {
    onSave: async () => {
      clampCircleOffsetToBounds();
      await saveImageState();

      if (window.wbeImageControlPanelUpdate) {
        window.wbeImageControlPanelUpdate();
      }
    },
    onScaleChange: (newScale) => {
      if (window.wbeImageControlPanelUpdate) {
        window.wbeImageControlPanelUpdate();
      }

      const clickTarget = container.querySelector(".wbe-image-click-target");
      if (clickTarget) {
        const cropData = getImageCropData(imageElement);
        updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, newScale);
      }

      resizeController.updatePosition();
      updateSelectionBorderSize();
    }
  });

  // Initialize SelectionController to replace closure-based selection
  const selectionController = new SelectionController(container, imageElement, {
    onSelect: (controller) => {
      // Clear mass selection when selecting individual image
      if (window.MassSelection && window.MassSelection.selectedCount > 0) {
        window.MassSelection.clear();
      }
    },
    onDeselect: (controller) => {
      // Hide control panel when deselecting
      killImageControlPanel();
    },
    showControlPanel: (imageElement, container) => {
      // Check if image is frozen and show appropriate panel
      if (isImageFrozen(container.id)) {
        // Show frozen control panel for frozen images
        showFrozenControlPanel(container);
      } else {
        // Show normal control panel for non-frozen images
        showImageControlPanel(imageElement, container, currentMaskType, {
          onCropModeToggle: async (enabled) => {
            if (enabled) {
              await enterCropMode();
            } else {
              await exitCropMode();
            }
          },
          onMaskTypeChange: async (newMaskType) => {
            currentMaskType = newMaskType;
            updateMaskType();

            if (window.wbeImageControlPanel?.updatePanelState) {
              window.wbeImageControlPanel.updatePanelState(newMaskType);
            }

            await saveImageState();
          }
        });
      }
    },
    hideControlPanel: () => {
      // Hide both normal and frozen panels
      killImageControlPanel();
      killFrozenControlPanel();
    },
    clearMassSelection: () => {
      if (window.MassSelection && window.MassSelection.selectedCount > 0) {
        window.MassSelection.clear();
      }
    }
  });



  const resizeHandle = resizeController.handle;


  // Функция для обновления позиции handle
  function updateHandlePosition() {
    resizeController.updatePosition();

    // Старая логика для fallback
    const transform = imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (currentMaskType === 'rect') {
      const croppedWidth = width - crop.left - crop.right;
      const croppedHeight = height - crop.top - crop.bottom;

      const scaledWidth = croppedWidth * currentScale;
      const scaledHeight = croppedHeight * currentScale;

      resizeController.handle.style.left = `${crop.left * currentScale + scaledWidth - 6}px`;
      resizeController.handle.style.top = `${crop.top * currentScale + scaledHeight - 6}px`;
    } else if (currentMaskType === 'circle') {
      const currentRadius = circleRadius !== null ? circleRadius : Math.min(width, height) / 2;

      const centerX = width / 2 + circleOffsetX;
      const centerY = height / 2 + circleOffsetY;

      const handleX = centerX + currentRadius * 0.707;
      const handleY = centerY + currentRadius * 0.707;

      resizeController.handle.style.left = `${handleX * currentScale - 6}px`;
      resizeController.handle.style.top = `${handleY * currentScale - 6}px`;
    }
  }

  function updateSelectionBorderSize() {
    // ✨ CRITICAL: Always read fresh crop data from DOM (not closure variables)
    // This ensures we use the correct scale and crop values after F5
    const cropData = getImageCropData(imageElement);
    const currentCrop = cropData.crop;
    const currentMaskTypeValue = cropData.maskType;
    const currentScale = cropData.scale;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (currentMaskTypeValue === 'rect') {
      // Прямоугольная маска: вычитаем crop из размеров
      const croppedWidth = width - currentCrop.left - currentCrop.right;
      const croppedHeight = height - currentCrop.top - currentCrop.bottom;

      const scaledWidth = croppedWidth * currentScale;
      const scaledHeight = croppedHeight * currentScale;

      const offsetLeft = currentCrop.left * currentScale;
      const offsetTop = currentCrop.top * currentScale;

      // Обновляем ОБЕ рамки (серую и синюю)
      [permanentBorder, selectionBorder].forEach(border => {
        border.style.width = `${scaledWidth}px`;
        border.style.height = `${scaledHeight}px`;
        border.style.left = `${offsetLeft}px`;
        border.style.top = `${offsetTop}px`;
        border.style.borderRadius = "0"; // Прямоугольная
        border.style.clipPath = "none"; // Убираем clip-path для rect
      });
    } else if (currentMaskTypeValue === 'circle') {
      // Круговая маска: используем диаметр круга
      const currentRadius = cropData.circleRadius !== null ? cropData.circleRadius : Math.min(width, height) / 2;
      const diameter = currentRadius * 2;

      const scaledDiameter = diameter * currentScale;

      // Центр круга с учетом offset
      const centerX = width / 2 + cropData.circleOffset.x;
      const centerY = height / 2 + cropData.circleOffset.y;

      const offsetLeft = (centerX - currentRadius) * currentScale;
      const offsetTop = (centerY - currentRadius) * currentScale;

      // Обновляем ОБЕ рамки (серую и синюю)
      [permanentBorder, selectionBorder].forEach(border => {
        border.style.width = `${scaledDiameter}px`;
        border.style.height = `${scaledDiameter}px`;
        border.style.left = `${offsetLeft}px`;
        border.style.top = `${offsetTop}px`;
        border.style.borderRadius = "50%"; // Круговая
        border.style.clipPath = "none"; // Убираем clip-path для circle
      });

    }
  }

  // Crop mode (mask) - гизмо-точки для обрезки
  const cropHandles = {
    top: null,
    right: null,
    bottom: null,
    left: null,
    circleResize: null
  };

  function enterCropMode() {
    // Проверяем, не заблокирована ли картинка другим пользователем
    if (container.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
      ui.notifications.warn("This image is being cropped by another user");
      return;
    }
    isCropping = true;
    // ✨ NEW ARCHITECTURE: Sync closure variables from CSS/Dataset (source of truth)
    // This ensures crop handles start at correct position
    const cropData = getImageCropData(imageElement);
    crop.top = cropData.crop.top;
    crop.right = cropData.crop.right;
    crop.bottom = cropData.crop.bottom;
    crop.left = cropData.crop.left;
    currentMaskType = cropData.maskType;
    circleOffsetX = cropData.circleOffset.x;
    circleOffsetY = cropData.circleOffset.y;
    circleRadius = cropData.circleRadius;




    // Broadcast lock to all users
    game.socket.emit(`module.${MODID}`, {
      type: "imageLock",
      imageId: id,
      userId: game.user.id,
      userName: game.user.name
    });

    // Mark as cropping
    container.setAttribute('data-cropping', 'true');
    // Mark as locked locally
    container.dataset.lockedBy = game.user.id;

    // Allow clicks on UI inside the container while cropping
    container.style.setProperty("pointer-events", "auto", "important");

    // ✨ Обновляем глобальные переменные
    updateGlobalVars();

    // Прячем resize handle и permanent border
    resizeController.handle.style.display = "none";
    permanentBorder.style.display = "none"; // ✨ Ensure gray border is hidden during crop

    // Disable click target during crop mode to allow deselection
    const clickTarget = container.querySelector(".wbe-image-click-target");
    if (clickTarget) {
      clickTarget.style.pointerEvents = "none";
    }

    // Change cursor to default (not move) during crop mode
    container.style.setProperty("cursor", "default", "important");

    // Показываем фиолетовую рамку для crop mode
    selectionBorder.style.display = "block";
    selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Фиолетовый для crop mode

    // ✨ NEW ARCHITECTURE: Update border using synced data
    updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    ui.notifications.info("Crop mode activated (image locked)");



    // Создаем элементы управления в зависимости от типа маски
    if (currentMaskType === 'rect') {
      // Прямоугольная маска: 4 гизмо-точки (top, right, bottom, left)
      const handleSize = 12;
      const handleStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: 1003;
          pointer-events: auto;
        `;

      // Top handle
      cropHandles.top = document.createElement("div");
      cropHandles.top.className = "wbe-crop-handle-top";
      cropHandles.top.style.cssText = handleStyle + `cursor: ns-resize;`;
      container.appendChild(cropHandles.top);

      // Right handle
      cropHandles.right = document.createElement("div");
      cropHandles.right.className = "wbe-crop-handle-right";
      cropHandles.right.style.cssText = handleStyle + `cursor: ew-resize;`;
      container.appendChild(cropHandles.right);

      // Bottom handle
      cropHandles.bottom = document.createElement("div");
      cropHandles.bottom.className = "wbe-crop-handle-bottom";
      cropHandles.bottom.style.cssText = handleStyle + `cursor: ns-resize;`;
      container.appendChild(cropHandles.bottom);

      // Left handle
      cropHandles.left = document.createElement("div");
      cropHandles.left.className = "wbe-crop-handle-left";
      cropHandles.left.style.cssText = handleStyle + `cursor: ew-resize;`;
      container.appendChild(cropHandles.left);

      // Позиционируем ручки
      updateCropHandlesPosition();

      // Добавляем обработчики drag для каждой ручки
      setupCropHandleDrag();
    } else if (currentMaskType === 'circle') {
      // Круговая маска: гизмочка для изменения размера + drag для перемещения
      const handleSize = 12;
      const handleStyle = `
          position: absolute;
          width: ${handleSize}px;
          height: ${handleSize}px;
          background: rgba(128, 0, 255, 0.9);
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          z-index: 1003;
          pointer-events: auto;
        `;

      // Создаем гизмочку для изменения размера круга
      cropHandles.circleResize = document.createElement("div");
      cropHandles.circleResize.className = "wbe-crop-handle-circle-resize";
      cropHandles.circleResize.style.cssText = handleStyle + `cursor: nw-resize;`;
      container.appendChild(cropHandles.circleResize);

      // Позиционируем гизмочку
      updateCircleResizeHandlePosition();

      // Добавляем обработчик для изменения размера
      setupCircleResizeHandleDrag();

      // Включаем режим drag для перемещения картинки внутри круга
      setupCircleDrag();
    }

    // ✨ Ensure resize handle stays hidden (in case socket update tries to show it)
    resizeController.handle.style.display = "none";
  }

  async function exitCropMode() {

    isCropping = false;

    if (window.wbeImageControlPanel?.closeSubpanel) {
      window.wbeImageControlPanel.closeSubpanel();
    }

    // ✨ CRITICAL: Write closure modifications back to CSS/Dataset (source of truth)
    // During crop mode, we only modified closures for performance
    // Now sync everything before broadcasting/reading
    setImageCropData(imageElement, {
      crop: { ...crop },
      maskType: currentMaskType,
      circleOffset: { x: circleOffsetX, y: circleOffsetY },
      circleRadius: circleRadius
    });

    // ✨ FINAL SAVE - Now broadcast all crop changes to everyone
    await saveImageState(true); // Force broadcast

    // Broadcast unlock to all users
    game.socket.emit(`module.${MODID}`, {
      type: "imageUnlock",
      imageId: id
    });

    // Remove cropping flag
    container.removeAttribute('data-cropping');

    // Remove lock locally
    delete container.dataset.lockedBy;

    // Go back to clickTarget-only interactions outside crop mode
    container.style.setProperty("pointer-events", "none", "important");

    // ✨ Обновляем глобальные переменные
    updateGlobalVars();

    // ✨ CRITICAL: Clean up crop handles
    Object.values(cropHandles).forEach(handle => {
      if (handle && handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });
    cropHandles.top = null;
    cropHandles.right = null;
    cropHandles.bottom = null;
    cropHandles.left = null;
    cropHandles.circleResize = null;

    // Cleanup для circle drag
    cleanupCircleDrag();

    // Показываем resize handle и восстанавливаем cursor
    if (selectionController.isSelected() && !isImageFrozen(container.id)) {
      resizeController.handle.style.display = "flex";
      updateHandlePosition();

      // Восстанавливаем move cursor
      // container.style.setProperty("cursor", "move", "important"); // Removed move cursor

      // Возвращаем оригинальный цвет рамки
      selectionBorder.style.borderColor = "#4a9eff";
      updateSelectionBorderSize();
    }

    // ✨ NEW ARCHITECTURE: Update permanent border to reflect NEW crop state
    const cropData = getImageCropData(imageElement);
    updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Update click target to match NEW visible area and re-enable it
    const clickTarget = container.querySelector(".wbe-image-click-target");
    updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Re-enable click target after crop mode
    if (clickTarget) {
      clickTarget.style.pointerEvents = "auto";
    }

    ui.notifications.info("Crop mode deactivated (image unlocked)");

    // Remove gizmo points (for rect and circle)
    Object.values(cropHandles).forEach(handle => {
      if (handle && handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });
    cropHandles.top = null;
    cropHandles.right = null;
    cropHandles.bottom = null;
    cropHandles.left = null;
    cropHandles.circleResize = null;

    // Cleanup для circle drag
    cleanupCircleDrag();
  }

  function updateCropHandlesPosition() {
    if (!isCropping) return;

    const transform = imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    const scaledWidth = width * currentScale;
    const scaledHeight = height * currentScale;

    // Calculate the center of the cropped area
    const croppedWidth = width - crop.left - crop.right;
    const croppedHeight = height - crop.top - crop.bottom;
    const croppedCenterX = crop.left + croppedWidth / 2;
    const croppedCenterY = crop.top + croppedHeight / 2;

    // Top (center top of cropped area)
    if (cropHandles.top) {
      cropHandles.top.style.left = `${croppedCenterX * currentScale - 6}px`;
      cropHandles.top.style.top = `${crop.top * currentScale - 6}px`;
    }

    // Right (center right of cropped area)
    if (cropHandles.right) {
      cropHandles.right.style.left = `${(width - crop.right) * currentScale - 6}px`;
      cropHandles.right.style.top = `${croppedCenterY * currentScale - 6}px`;
    }

    // Bottom (center bottom of cropped area)
    if (cropHandles.bottom) {
      cropHandles.bottom.style.left = `${croppedCenterX * currentScale - 6}px`;
      cropHandles.bottom.style.top = `${(height - crop.bottom) * currentScale - 6}px`;
    }

    // Left (center left of cropped area)
    if (cropHandles.left) {
      cropHandles.left.style.left = `${crop.left * currentScale - 6}px`;
      cropHandles.left.style.top = `${croppedCenterY * currentScale - 6}px`;
    }
  }

  function updateCircleResizeHandlePosition() {
    if (!isCropping || !cropHandles.circleResize) return;

    const transform = imageElement.style.transform || "";
    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (width === 0 || height === 0) return;

    // Position gizmo at the edge of the circle (right-bottom)
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const centerX = width / 2 + circleOffsetX;
    const centerY = height / 2 + circleOffsetY;

    // Gizmo coordinates at the edge of the circle
    const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
    const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707

    cropHandles.circleResize.style.left = `${handleX * currentScale - 6}px`;
    cropHandles.circleResize.style.top = `${handleY * currentScale - 6}px`;

  }

  function setupCircleResizeHandleDrag() {

    cropHandles.circleResize.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startRadius = circleRadius;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // Get current scale
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        // Calculate change in radius (use average of deltaX and deltaY)
        const deltaRadius = (deltaX + deltaY) / (2 * currentScale);
        const newRadius = Math.max(10, Math.min(Math.min(imageElement.offsetWidth, imageElement.offsetHeight) / 2, startRadius + deltaRadius));

        circleRadius = newRadius;

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCircleResizeHandlePosition();

        // ✨ CRITICAL: Update purple border during crop mode with current circle data
        if (isCropping && selectionBorder) {
          const cropData = getImageCropData(imageElement);
          // Use ALL current live values, not mixed old/new data
          updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, cropData.scale);
        } else {
          // Only update selection border size if not in crop mode
          updateSelectionBorderSize();
        }

      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(); // Save radius
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  function setupCropHandleDrag() {
    container.dataset.lockedBy = game.user.id;
    // TOP handle
    cropHandles.top.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startY = e.clientY;
      const startCrop = crop.top;

      let firstMove = true;
      function onMouseMove(e) {
        const deltaY = e.clientY - startY;
        // Get current scale
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        // Recalculate deltaY with scale
        const scaledDelta = deltaY / currentScale;
        crop.top = Math.max(0, startCrop + scaledDelta);

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);

        if (firstMove) {
          firstMove = false;
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState(); // Save crop
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // RIGHT handle
    cropHandles.right.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startCrop = crop.right;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        const scaledDelta = deltaX / currentScale;
        crop.right = Math.max(0, startCrop - scaledDelta); // Invert for right side

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState();
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // BOTTOM handle
    cropHandles.bottom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startY = e.clientY;
      const startCrop = crop.bottom;

      function onMouseMove(e) {
        const deltaY = e.clientY - startY;
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        const scaledDelta = deltaY / currentScale;
        crop.bottom = Math.max(0, startCrop - scaledDelta); // Инвертируем для нижней стороны

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState();
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // LEFT handle
    cropHandles.left.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startCrop = crop.left;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const transform = imageElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        const scaledDelta = deltaX / currentScale;
        crop.left = Math.max(0, startCrop + scaledDelta);

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCropHandlesPosition();
        // Update border using same data source as gizmos for synchronization
        updateImageBorder(selectionBorder, imageElement, currentMaskType, crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, currentScale);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState();
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // Circle drag (moving image inside circle mask)
  let circleDragActive = false;
  let circleDragListeners = null;

  function setupCircleDrag() {
    circleDragActive = true;

    // Drag handler for moving image inside circle mask
    const dragHandler = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startOffsetX = circleOffsetX;
      const startOffsetY = circleOffsetY;

      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // Get scale
        const { width: baseW, height: baseH, scale: currentScale } = getUnscaledSize(imageElement);

        // Calculate new offsets with sensitivity
        const sensitivity = 0.5; // 50% чувствительность для более плавного движения
        let newOffsetX = startOffsetX + (deltaX / currentScale) * sensitivity;
        let newOffsetY = startOffsetY + (deltaY / currentScale) * sensitivity;

        // 🔒 Limit movement by image boundaries
        const width = imageElement.offsetWidth;
        const height = imageElement.offsetHeight;

        if (baseW > 0 && baseH > 0) {
          const r = (circleRadius == null) ? Math.min(baseW, baseH) / 2 : circleRadius;
          // Circle clamp by center in local coordinates
          const centerX = baseW / 2 + newOffsetX;
          const centerY = baseH / 2 + newOffsetY;
          const clampedCenterX = Math.max(r, Math.min(baseW - r, centerX));
          const clampedCenterY = Math.max(r, Math.min(baseH - r, centerY));
          circleOffsetX = clampedCenterX - baseW / 2;
          circleOffsetY = clampedCenterY - baseH / 2;
        } else {
          circleOffsetX = newOffsetX;
          circleOffsetY = newOffsetY;
        }

        // Update global variables
        updateGlobalVars();

        updateClipPath();
        updateCircleResizeHandlePosition(); // Update gizmo position when circle is moved!

        // CRITICAL: Ensure purple border updates during crop mode circle drag
        if (isCropping && selectionBorder) {
          const cropData = getImageCropData(imageElement);
          // Use ALL current live values, not mixed old/new data
          updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, { x: circleOffsetX, y: circleOffsetY }, circleRadius, cropData.scale);
        } else {
          // Only update selection border size if not in crop mode
          updateSelectionBorderSize(); // Update borders when circle is moved!
        }
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveImageState();
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    // Attach to container instead of imageElement to avoid pointer-events issues
    container.addEventListener("mousedown", dragHandler);

    // Save link for cleanup
    circleDragListeners = { dragHandler };
  }

  function cleanupCircleDrag() {
    if (circleDragListeners) {
      container.removeEventListener("mousedown", circleDragListeners.dragHandler);
      circleDragListeners = null;
    }
    circleDragActive = false;
  }

  // Event handlers
  // Read states from global variables
  let isCropping = getImageLocalVars(id).isCropping || false; // Crop mode (mask)
  // maskType, circleOffsetX/Y passed as parameters (don't redeclare)

  // Function for selecting/deselecting
  function selectImage() {
    // Check if image is frozen and handle differently
    if (isImageFrozen(id)) {
      // For frozen images, show frozen selection state instead of normal selection
      
      // ✅ FIX: Only kill text color panel and deselect text elements, don't kill image panels
      if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
        try {
          window.wbeColorPanel.cleanup();
        } catch { }
      }

      // Deselect text elements manually without killing image panels
      document.querySelectorAll(".wbe-canvas-text-container").forEach(container => {
        if (container.id === id) return; // Skip current (shouldn't match anyway)

        const textElement = container.querySelector(".wbe-canvas-text");
        const resizeHandle = container.querySelector(".wbe-text-resize-handle");
        if (textElement && resizeHandle) {
          delete container.dataset.selected;
          container.style.removeProperty("pointer-events");
          textElement.style.removeProperty("outline");
          textElement.style.removeProperty("outline-offset");
          container.style.removeProperty("cursor");
          resizeHandle.style.display = "none";
        }
      });

      // Update global state for backward compatibility
      selectedImageId = id;

      // Update global selection state - other elements should listen to this
      if (typeof setSelectedImageId === 'function') {
        setSelectedImageId(id); // This notifies other modules to deselect themselves
      }

      // Show frozen selection state and frozen panel
      showFrozenSelection(container);
      showFrozenControlPanel(container);
      
      // Ensure resize handle is hidden for frozen images
      resizeController.hide();
      
      return; // Exit early for frozen images
    }

    // Normal selection behavior for non-frozen images
    // Selecting image via SelectionController

    // ✅ FIX: Only kill text color panel and deselect text elements, don't kill image panels
    if (window.wbeColorPanel && typeof window.wbeColorPanel.cleanup === "function") {
      try {
        window.wbeColorPanel.cleanup();
      } catch { }
    }

    // Deselect text elements manually without killing image panels
    document.querySelectorAll(".wbe-canvas-text-container").forEach(container => {
      if (container.id === id) return; // Skip current (shouldn't match anyway)

      const textElement = container.querySelector(".wbe-canvas-text");
      const resizeHandle = container.querySelector(".wbe-text-resize-handle");
      if (textElement && resizeHandle) {
        delete container.dataset.selected;
        container.style.removeProperty("pointer-events");
        textElement.style.removeProperty("outline");
        textElement.style.removeProperty("outline-offset");
        container.style.removeProperty("cursor");
        resizeHandle.style.display = "none";
      }
    });

    // Use SelectionController for selection logic
    selectionController.select();

    // Update global state for backward compatibility
    selectedImageId = id;

    // Update global selection state - other elements should listen to this
    if (typeof setSelectedImageId === 'function') {
      setSelectedImageId(id); // This notifies other modules to deselect themselves
    }

    // Show resize handle when selected
    resizeController.show();
    resizeController.updatePosition();

    // Update visual elements with current crop data
    const cropData = getImageCropData(imageElement);

    // Show blue border (SelectionController handles permanent border)
    selectionBorder.style.display = "block";
    selectionBorder.style.borderColor = "#4a9eff";

    // Update selection border with current crop data
    updateImageBorder(selectionBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Update click target to match visible area
    const clickTarget = container.querySelector(".wbe-image-click-target");
    updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Enable click target pointer events for dragging/scaling/resizing
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "auto", "important");
    }
  }

  async function deselectImage() {
    // Check if image is frozen and handle differently
    if (isImageFrozen(id)) {
      // For frozen images, hide frozen selection state and panel
      hideFrozenSelection(container);
      killFrozenControlPanel();
      
      // Hide resize handle for frozen images
      resizeController.hide();
      
      // Update global state for backward compatibility
      if (selectedImageId === id) {
        selectedImageId = null;
        // Clear global selection state
        if (typeof setSelectedImageId === 'function') {
          setSelectedImageId(null);
        }
      }
      
      return; // Exit early for frozen images
    }

    // Normal deselection behavior for non-frozen images
    // Deselect image and clean up state

    // Use SelectionController for deselection logic
    selectionController.deselect();

    // Update global state for backward compatibility
    if (selectedImageId === id) {
      selectedImageId = null;
      // Clear global selection state
      if (typeof setSelectedImageId === 'function') {
        setSelectedImageId(null);
      }
    }

    // Exit crop mode if it was active
    if (isCropping) {
      isCropping = false;
      await exitCropMode(); // Await to ensure save completes
    }

    // DON'T call updateGlobalVars() here - same issue as selectImage!
    // We should READ current state, not overwrite with stale closure values

    // Always keep pointer-events: none on container - click target handles interactions
    container.style.setProperty("pointer-events", "none", "important");
    container.style.removeProperty("cursor");

    // Hide blue border (SelectionController handles permanent border)
    selectionBorder.style.display = "none";

    // NEW ARCHITECTURE: Update permanent border with current crop data
    const cropData = getImageCropData(imageElement);
    updateImageBorder(permanentBorder, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Update click target to match visible area
    const clickTarget = container.querySelector(".wbe-image-click-target");
    updateClickTarget(clickTarget, imageElement, cropData.maskType, cropData.crop, cropData.circleOffset, cropData.circleRadius, cropData.scale);

    // Disable click target pointer events when deselected to allow canvas drag/pan
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }

    resizeController.hide();

  }

  // Delete by Delete key
  async function deleteImage() {
    // ✅ FIX: Kill image control panel before deletion
    killImageControlPanel();

    resizeController.destroy();
    // Destroy dragController if it exists
    if (resizeController.dragController) {
      resizeController.dragController.destroy();
    }
    // Destroy selectionController
    if (selectionController) {
      selectionController.destroy();
    }
    // Unregister from global registry
    imageRegistry.delete(id);

    // Clean up z-index
    ZIndexManager.removeImage(id);

    container.remove();

    const images = await getAllImages();
    delete images[id];
    await setAllImages(images);
  }

  // Paste copied image
  async function pasteImage() {
    if (!copiedImageData) return;


    // Get position of layer relative to viewport
    const { lastMouseX, lastMouseY } = getSharedVars();
    const layer = getOrCreateLayer();
    if (!layer) return;

    const layerRect = layer.getBoundingClientRect();

    // Convert screen coordinates → layer coordinates → world coordinates
    const layerX = lastMouseX - layerRect.left;
    const layerY = lastMouseY - layerRect.top;

    // Consider layer scale and translate
    const transform = layer.style.transform || "";

    const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
    const translateMatch = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);

    const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    const translateX = translateMatch ? parseFloat(translateMatch[1]) : 0;
    const translateY = translateMatch ? parseFloat(translateMatch[2]) : 0;


    // Consider translate and scale
    const worldX = (layerX - translateX) / scale;
    const worldY = (layerY - translateY) / scale;


    const newImageId = `wbe-image-${Date.now()}`;
    const cropData = copiedImageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    const maskTypeData = copiedImageData.maskType || 'rect';
    const circleOffsetData = copiedImageData.circleOffset || { x: 0, y: 0 };
    const circleRadiusData = copiedImageData.circleRadius || null;
    createImageElement(newImageId, copiedImageData.src, worldX, worldY, copiedImageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData);

    const images = await getAllImages();
    images[newImageId] = {
      src: copiedImageData.src,
      left: worldX,
      top: worldY,
      scale: copiedImageData.scale,
      crop: cropData,
      maskType: maskTypeData,
      circleOffset: circleOffsetData,
      circleRadius: circleRadiusData,
      zIndex: ZIndexManager.getImage(newImageId)
    };
    await setAllImages(images);

    ui.notifications.info("Image pasted");
  }

  // ⚠️ REMOVED: Per-image global handlers (moved to single global handlers at module level)
  // Keydown and copy listeners are now handled globally via selectedImageId

  // ⚠️ REMOVED: Per-image global handler (moved to single global handler below)
  // Selection is now handled by the unified global image selection handler

  // Initialize ImageDragController to replace inline drag handlers
  const dragController = new ImageDragController(container, imageElement, {
    onDragStart: (controller) => {
      // If element is not selected - first select it
      if (!selectionController.isSelected()) {
        // CLEAR MASS SELECTION when selecting image for drag
        if (window.MassSelection && window.MassSelection.selectedCount > 0) {
          window.MassSelection.clear();
        }
        selectImage();
      }
    },
    onDragMove: (controller, newX, newY) => {
      // Position updates are handled internally by the controller
    },
    onDragEnd: async (controller) => {
      await saveImageState();

      // FIX: Show panel again after drag (like text module)
      if (window.wbeImageControlPanel) {
        // Panel already exists, just update position
        if (window.wbeImageControlPanelUpdate) {
          window.wbeImageControlPanelUpdate();
        }
      } else {
        // Panel was killed, recreate it
        showImageControlPanel(imageElement, container, currentMaskType, {
          onCropModeToggle: async (enabled) => {
            if (enabled) {
              await enterCropMode();
            } else {
              await exitCropMode();
            }
          },
          onMaskTypeChange: async (newMaskType) => {
            currentMaskType = newMaskType;
            updateMaskType();

            if (window.wbeImageControlPanel?.updatePanelState) {
              window.wbeImageControlPanel.updatePanelState(newMaskType);
            }

            await saveImageState();
          }
        });
      }
    },
    onSave: async () => {
      await saveImageState();
    },
    getLayer: () => getOrCreateLayer()
  });

  // Add dragController reference to resizeController for cleanup
  resizeController.dragController = dragController;









  // Universal function for saving image state
  async function saveImageState(broadcast = true) {
    // Always snapshot the CURRENT truth from the DOM first
    const domSnap = getImageCropData(imageElement);
    const currentScale = domSnap.scale;
    let useCrop = { ...domSnap.crop };
    let useMaskType = domSnap.maskType;
    let useCircleOffset = { ...domSnap.circleOffset };
    let useCircleRadius = domSnap.circleRadius;

    // Defensive fallback (shouldn't trigger, but safe if DOM is incomplete)
    if (useMaskType == null) useMaskType = currentMaskType;
    if (!useCircleOffset) useCircleOffset = { x: circleOffsetX, y: circleOffsetY };
    if (useCircleRadius === undefined) useCircleRadius = circleRadius;


    const imageData = {
      src: imageElement.src,
      left: parseFloat(container.style.left),
      top: parseFloat(container.style.top),
      scale: currentScale,
      crop: useCrop,
      maskType: useMaskType,
      circleOffset: useCircleOffset,
      circleRadius: useCircleRadius,
      isCropping: isCropping,
      zIndex: ZIndexManager.getImage(id)
    };

    // Keep caches in sync with what we're persisting
    globalImageData[id] = {
      maskType: useMaskType,
      circleOffset: useCircleOffset,
      circleRadius: useCircleRadius,
      crop: useCrop,
      scale: currentScale
    };
    updateImageLocalVars(id, globalImageData[id]);

    // While actively cropping, don't spam sockets/db with intermediate states
    if (isCropping && broadcast) {
      return;
    }

    const images = await getAllImages();
    images[id] = imageData;
    await setAllImages(images);
  }

  // Register this image in the global registry for selection management
  imageRegistry.set(id, {
    container: container,
    selectFn: selectImage,
    deselectFn: deselectImage,
    isFrozen: false,
    dragController: dragController,
    resizeController: resizeController,
    selectionController: selectionController
  });

  // Install global handler if not already installed
  installGlobalImageSelectionHandler();

  return container;
}



/* ----------------------- Canvas Elements Storage ----------------- */




async function getAllImages() {
  try {
    return await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_IMAGES) || {};
  } catch (e) {
    console.error("[WB-E] getAllImages error:", e);
    return {};
  }
}

async function setAllImages(images) {
  try {
    // Sync ZIndexManager with existing z-index values to avoid conflicts
    const existingZIndexes = Object.entries(images).map(([id, data]) => [id, data.zIndex]).filter(([id, zIndex]) => zIndex);
    ZIndexManager.syncWithExisting(existingZIndexes);

    if (game.user.isGM) {
      // GM saves to database
      await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_IMAGES);
      await new Promise(resolve => setTimeout(resolve, 50));
      await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_IMAGES, images);
      // Emit to all
      game.socket.emit(`module.${MODID}`, { type: "imageUpdate", images });
    } else {
      const layer = getOrCreateLayer();
      // Player sends request GM through socket
      game.socket.emit(`module.${MODID}`, { type: "imageUpdateRequest", images, userId: game.user.id });

      // Update locally for immediate UI reaction of the player
      if (layer) {
        // Get all existing images
        const existingElements = layer.querySelectorAll(".wbe-canvas-image-container");
        const existingIds = new Set();

        // Update existing and create new images locally
        for (const [id, imageData] of Object.entries(images)) {
          existingIds.add(id);
          const existing = document.getElementById(id);
          if (existing) {
            // Update existing element
            updateImageElement(existing, imageData);
          } else {
            // Create new element
            const cropData = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
            const maskTypeData = imageData.maskType || 'rect';
            const circleOffsetData = imageData.circleOffset || { x: 0, y: 0 };
            const circleRadiusData = imageData.circleRadius || null;
            createImageElement(id, imageData.src, imageData.left, imageData.top, imageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData, imageData.zIndex);
          }

          // Update global variables for each image
          updateImageLocalVars(id, {
            maskType: imageData.maskType || 'rect',
            circleOffset: imageData.circleOffset || { x: 0, y: 0 },
            circleRadius: imageData.circleRadius,
            crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
            scale: imageData.scale || 1,
            isCropping: imageData.isCropping || false
          });
        }

        // Remove elements that are no longer in images
        existingElements.forEach(element => {
          if (!existingIds.has(element.id)) {
            // Clear runtime caches to prevent resurrection
            clearImageCaches(element.id);
            // Clean up z-index
            ZIndexManager.removeImage(element.id);
            element.remove();
          }
        });
      }
    }
  } catch (e) {
    console.error("[WB-E] setAllImages error:", e);
  }
}


// Function for updating all image parameters
function updateImageElement(existing, imageData) {
  // CRITICAL: Skip socket updates for images locked by current user (actively being manipulated)
  if (existing.dataset.lockedBy && existing.dataset.lockedBy === game.user.id) {
    console.log(`[WB-E] Skipping socket update for ${existing.id} - locked by current user (actively being manipulated)`);
    return; // Don't update during local drag/crop operations!
  }

  // Update basic parameters
  existing.style.left = `${imageData.left}px`;
  existing.style.top = `${imageData.top}px`;

  const imageElement = existing.querySelector(".wbe-canvas-image");
  if (imageElement) {
    imageElement.style.transform = `scale(${imageData.scale})`;

    // Update complex image parameters
    if (imageData.crop) {
      const cropData = imageData.crop;
      if (cropData.top !== undefined) imageElement.style.setProperty('--crop-top', `${cropData.top}px`);
      if (cropData.right !== undefined) imageElement.style.setProperty('--crop-right', `${cropData.right}px`);
      if (cropData.bottom !== undefined) imageElement.style.setProperty('--crop-bottom', `${cropData.bottom}px`);
      if (cropData.left !== undefined) imageElement.style.setProperty('--crop-left', `${cropData.left}px`);
    }

    if (imageData.maskType) {
      imageElement.dataset.maskType = imageData.maskType;
    }

    if (imageData.circleOffset) {
      imageElement.dataset.circleOffsetX = imageData.circleOffset.x;
      imageElement.dataset.circleOffsetY = imageData.circleOffset.y;
    }

    if (imageData.circleRadius !== undefined) {
      imageElement.dataset.circleRadius = (imageData.circleRadius ?? null);
    }

    // Ensure visual styles/UI are applied *after* the image has size
    const applyAll = () => {
      updateImageVisualStyles(imageElement, imageData);
      updateImageUIElements(existing, imageData);
    };
    if (imageElement.complete && imageElement.naturalWidth) {
      applyAll();
    } else {
      imageElement.addEventListener("load", applyAll, { once: true });
    }
  }

  // CRITICAL: Update imageLocalVars so selectImage() reads fresh data
  // This ensures crop data from socket updates is preserved
  updateImageLocalVars(existing.id, {
    maskType: imageData.maskType || 'rect',
    circleOffset: imageData.circleOffset || { x: 0, y: 0 },
    circleRadius: imageData.circleRadius,
    crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    scale: imageData.scale || 1,
    isCropping: imageData.isCropping || false
  });

}

// Function for applying visual styles of the image
function updateImageVisualStyles(imageElement, imageData) {
  const maskType = imageData.maskType || 'rect';
  const crop = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const circleOffset = imageData.circleOffset || { x: 0, y: 0 };
  const circleRadius = imageData.circleRadius;

  if (maskType === 'rect') {
    // Rectangular mask (inset)
    const clipPath = `inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px)`;
    imageElement.style.clipPath = clipPath;
  } else if (maskType === 'circle') {
    // Circular mask (circle)
    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (width === 0 || height === 0) {
      console.warn("⚠️ Image not loaded yet, skipping clip-path");
      return;
    }

    // Use saved radius or calculate by default
    const fallback = Math.min(width, height) / 2;
    const radius = (circleRadius == null) ? fallback : circleRadius;

    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;
    const clipPath = `circle(${radius}px at ${centerX}px ${centerY}px)`;
    imageElement.style.clipPath = clipPath;
  }
}

// Function for full update of UI elements of the image
function updateImageUIElements(container, imageData) {
  const imageElement = container.querySelector(".wbe-canvas-image");
  if (!imageElement) return;

  const maskType = imageData.maskType || 'rect';
  const crop = imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const circleOffset = imageData.circleOffset || { x: 0, y: 0 };
  const circleRadius = imageData.circleRadius;
  const scale = imageData.scale || 1;

  // PRESERVE local selection state - don't override with socket data
  // Selection is managed locally via global click handler
  const isSelected = container.dataset.selected === "true";

  // CRITICAL: Check if THIS user is cropping (locked by them)
  // Local crop mode takes precedence over socket data
  const isLockedByMe = container.dataset.lockedBy === game.user.id;
  const isCropping = isLockedByMe || imageData.isCropping || false;


  // Update permanent border
  const permanentBorder = container.querySelector(".wbe-image-permanent-border");
  if (permanentBorder) {
    updateImageBorder(permanentBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // Update selection border
  const selectionBorder = container.querySelector(".wbe-image-selection-border");
  if (selectionBorder) {
    updateImageBorder(selectionBorder, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // Update position of resize handle
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");
  if (resizeHandle) {
    updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // CRITICAL: Update click target to match visible area
  // This ensures the click target stays synchronized with crop changes from socket updates
  const clickTarget = container.querySelector(".wbe-image-click-target");
  if (clickTarget) {
    updateClickTarget(clickTarget, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  }

  // Update crop handles
  updateCropHandles(container, maskType, crop, circleOffset, circleRadius, scale);

  // Position crop handles if they are visible
  updateCropHandlesPositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale);
  updateCircleResizeHandlePositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale);

  // Apply UI states
  updateImageUIStates(container, isSelected, isCropping);

  // Update local variables of the image
  updateImageLocalVariables(container, imageData);
}

// Function for applying UI states of the image
function updateImageUIStates(container, isSelected, isCropping) {
  const imageElement = container.querySelector(".wbe-canvas-image");
  const permanentBorder = container.querySelector(".wbe-image-permanent-border");
  const selectionBorder = container.querySelector(".wbe-image-selection-border");
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");
  const clickTarget = container.querySelector(".wbe-image-click-target");

  // CRITICAL: If this user is cropping (locked by them), force isCropping to true
  // This prevents socket updates from showing blue border/resize handle during crop mode
  const isLockedByMe = container.dataset.lockedBy === game.user.id;
  if (isLockedByMe) {
    isCropping = true;
  }

  if (isSelected) {
    // Selected - show blue border, show resize handle (SelectionController manages permanent border)
    if (selectionBorder) selectionBorder.style.display = "block";
    // Only show resize handle if not frozen
    if (resizeHandle && !isImageFrozen(container.id)) {
      resizeHandle.style.display = "flex";
    }

    // Enable click target pointer events when selected
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "auto", "important");
    }

    // Don't set pointer-events on container - let click target handle interactions
    // container.style.setProperty("pointer-events", "auto", "important");
    // Cursor will be set based on crop mode below
    // if (!isCropping) {
    //   container.style.setProperty("cursor", "move", "important");
    // }
    container.dataset.selected = "true";
  } else {
    // Not selected - hide blue border, hide resize handle (SelectionController manages permanent border)
    if (selectionBorder) selectionBorder.style.display = "none";
    if (resizeHandle) resizeHandle.style.display = "none";

    // Disable click target pointer events when not selected to allow canvas drag/pan
    if (clickTarget) {
      clickTarget.style.setProperty("pointer-events", "none", "important");
    }

    // Remove container styles
    // Always keep pointer-events: none on container - click target handles interactions
    container.style.setProperty("pointer-events", "none", "important");
    container.style.removeProperty("cursor");
    delete container.dataset.selected;
  }

  if (isCropping) {
    // Crop mode - hide resize handle and gray border, purple border, cursor default
    if (resizeHandle) resizeHandle.style.display = "none";
    if (permanentBorder) permanentBorder.style.display = "none"; // ✨ Hide gray border during crop
    if (selectionBorder) selectionBorder.style.borderColor = "rgba(128, 0, 255, 0.9)"; // Purple for crop mode
    container.style.setProperty("cursor", "default", "important"); // Default cursor for crop mode
  } else {
    // Not crop mode - show resize handle if selected and not frozen, normal blue border
    if (isSelected && resizeHandle && !isImageFrozen(container.id)) {
      resizeHandle.style.display = "flex";
    }
    if (selectionBorder) selectionBorder.style.borderColor = "#4a9eff";
  }
}

// Function for updating local variables of the image
function updateImageLocalVariables(container, imageData) {
  const imageId = container.id;

  // Save data to global storage
  globalImageData[imageId] = {
    maskType: imageData.maskType || 'rect',
    circleOffset: imageData.circleOffset || { x: 0, y: 0 },
    circleRadius: imageData.circleRadius,
    crop: imageData.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    scale: imageData.scale || 1
  };

  // Update global local variables
  updateImageLocalVarsInElement(imageId, imageData);

}

// Function for forced update of UI with global data
function updateImageUIWithGlobalData(container) {
  const imageId = container.id;
  const data = getImageData(imageId);


  // Update borders
  updateImageSelectionBorderGlobal(container);

  // Update resize handle
  updateImageResizeHandleGlobal(container);

  // Update mask type toggle buttons
  updateMaskTypeToggleGlobal(container, data.maskType);
}

// Function for getting actual data of the image
function getImageData(imageId) {
  return globalImageData[imageId] || {
    maskType: 'rect',
    circleOffset: { x: 0, y: 0 },
    circleRadius: null,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    scale: 1
  };
}

// Function for getting local variables of the image
function getImageLocalVars(imageId) {
  return imageLocalVars[imageId] || {
    maskType: 'rect',
    circleOffset: { x: 0, y: 0 },
    circleRadius: null,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    scale: 1
  };
}

// Function for updating local variables of the image
function updateImageLocalVars(imageId, data) {

  imageLocalVars[imageId] = {
    maskType: data.maskType || 'rect',
    circleOffset: data.circleOffset || { x: 0, y: 0 },
    circleRadius: data.circleRadius,
    crop: data.crop || { top: 0, right: 0, bottom: 0, left: 0 },
    scale: data.scale || 1
  };

}

// Global function for updating local variables in createImageElement
function updateImageLocalVarsInElement(imageId, data) {
  // Find image in DOM
  const container = document.getElementById(imageId);
  if (!container) return;

  // Update global local variables
  updateImageLocalVars(imageId, data);

  // Force update UI with actual data
  setTimeout(() => {
    updateImageUIWithGlobalData(container);
  }, 10);
}

// Global function for updating borders of the image with actual data
function updateImageSelectionBorderGlobal(container) {
  const imageId = container.id;
  const data = getImageData(imageId);

  const imageElement = container.querySelector(".wbe-canvas-image");
  const selectionBorder = container.querySelector(".wbe-image-selection-border");

  if (!imageElement || !selectionBorder) return;

  updateImageBorder(selectionBorder, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
}

// Global function for updating mask type toggle buttons with actual data
function updateMaskTypeToggleGlobal(container, maskType) {
  // Update the control panel mask type buttons if panel exists
  if (window.wbeImageControlPanel && typeof window.wbeImageControlPanel.updatePanelState === 'function') {
    window.wbeImageControlPanel.updatePanelState(maskType);
  }
}

// Глобальная функция для обновления позиции resize handle с актуальными данными
function updateImageResizeHandleGlobal(container) {
  const imageId = container.id;
  const data = getImageData(imageId);

  const imageElement = container.querySelector(".wbe-canvas-image");
  const resizeHandle = container.querySelector(".wbe-image-resize-handle");

  if (!imageElement || !resizeHandle) return;

  updateImageResizeHandle(resizeHandle, imageElement, data.maskType, data.crop, data.circleOffset, data.circleRadius, data.scale);
}

// Функция для обновления рамок картинки
function updateImageBorder(border, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  if (maskType === 'rect') {
    // Прямоугольная маска
    const croppedWidth = width - crop.left - crop.right;
    const croppedHeight = height - crop.top - crop.bottom;
    const scaledWidth = croppedWidth * scale;
    const scaledHeight = croppedHeight * scale;
    const offsetLeft = crop.left * scale;
    const offsetTop = crop.top * scale;

    border.style.width = `${scaledWidth}px`;
    border.style.height = `${scaledHeight}px`;
    border.style.left = `${offsetLeft}px`;
    border.style.top = `${offsetTop}px`;
    border.style.borderRadius = "0";
    border.style.clipPath = "none";
  } else if (maskType === 'circle') {
    // Круговая маска
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const diameter = currentRadius * 2;
    const scaledDiameter = diameter * scale;
    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;
    const offsetLeft = (centerX - currentRadius) * scale;
    const offsetTop = (centerY - currentRadius) * scale;

    border.style.width = `${scaledDiameter}px`;
    border.style.height = `${scaledDiameter}px`;
    border.style.left = `${offsetLeft}px`;
    border.style.top = `${offsetTop}px`;
    border.style.borderRadius = "50%";
    border.style.clipPath = "none";
  }
}

// Функция для обновления resize handle
function updateImageResizeHandle(resizeHandle, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  if (maskType === 'rect') {
    // Прямоугольная маска: handle в правом нижнем углу
    const croppedWidth = width - crop.left - crop.right;
    const croppedHeight = height - crop.top - crop.bottom;
    const scaledWidth = croppedWidth * scale;
    const scaledHeight = croppedHeight * scale;
    const offsetLeft = crop.left * scale;
    const offsetTop = crop.top * scale;

    resizeHandle.style.left = `${offsetLeft + scaledWidth - 6}px`;
    resizeHandle.style.top = `${offsetTop + scaledHeight - 6}px`;
  } else if (maskType === 'circle') {
    // Круговая маска: handle на краю круга
    const fallback = Math.min(width, height) / 2;
    const currentRadius = (circleRadius == null) ? fallback : circleRadius;
    const centerX = width / 2 + circleOffset.x;
    const centerY = height / 2 + circleOffset.y;
    const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
    const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707

    resizeHandle.style.left = `${handleX * scale - 6}px`;
    resizeHandle.style.top = `${handleY * scale - 6}px`;
  }
}

// Функция для обновления crop handles
function updateCropHandles(container, maskType, crop, circleOffset, circleRadius, scale) {
  // Kill and recreate handles based on mask type (following updateMaskType() principle)

  if (maskType === 'rect') {
    // Remove circle handles if they exist
    const circleHandle = container.querySelector(".wbe-crop-handle-circle-resize");
    if (circleHandle && circleHandle.parentNode) {
      circleHandle.parentNode.removeChild(circleHandle);
    }

    // Keep rect handles visible (they should exist if in crop mode)
    const rectHandles = [
      container.querySelector(".wbe-crop-handle-top"),
      container.querySelector(".wbe-crop-handle-right"),
      container.querySelector(".wbe-crop-handle-bottom"),
      container.querySelector(".wbe-crop-handle-left")
    ];
    rectHandles.forEach(h => {
      if (h) h.style.display = 'block';
    });

  } else if (maskType === 'circle') {
    // Remove rect handles if they exist
    ["top", "right", "bottom", "left"].forEach(side => {
      const handle = container.querySelector(`.wbe-crop-handle-${side}`);
      if (handle && handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });

    // Keep circle handle visible (should exist if in crop mode)
    const circleHandle = container.querySelector(".wbe-crop-handle-circle-resize");
    if (circleHandle) {
      circleHandle.style.display = 'block';
    }
  }
}

// Глобальная функция для позиционирования crop handles
function updateCropHandlesPositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const cropHandles = {
    top: container.querySelector(".wbe-crop-handle-top"),
    right: container.querySelector(".wbe-crop-handle-right"),
    bottom: container.querySelector(".wbe-crop-handle-bottom"),
    left: container.querySelector(".wbe-crop-handle-left")
  };

  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  // Calculate visible region dimensions (same math as updateImageBorder)
  const croppedW = width - crop.left - crop.right;
  const croppedH = height - crop.top - crop.bottom;
  const left = crop.left * scale;
  const top = crop.top * scale;
  const w = croppedW * scale;
  const h = croppedH * scale;

  // Position handles at edges of visible region
  if (cropHandles.top) {
    cropHandles.top.style.left = `${left + w / 2 - 6}px`;
    cropHandles.top.style.top = `${top - 6}px`;
  }

  if (cropHandles.right) {
    cropHandles.right.style.left = `${left + w - 6}px`;
    cropHandles.right.style.top = `${top + h / 2 - 6}px`;
  }

  if (cropHandles.bottom) {
    cropHandles.bottom.style.left = `${left + w / 2 - 6}px`;
    cropHandles.bottom.style.top = `${top + h - 6}px`;
  }

  if (cropHandles.left) {
    cropHandles.left.style.left = `${left - 6}px`;
    cropHandles.left.style.top = `${top + h / 2 - 6}px`;
  }
}

// Глобальная функция для позиционирования circle resize handle
function updateCircleResizeHandlePositionGlobal(container, imageElement, maskType, crop, circleOffset, circleRadius, scale) {
  const cropHandles = {
    circleResize: container.querySelector(".wbe-crop-handle-circle-resize")
  };

  if (!cropHandles.circleResize) return;

  const width = imageElement.offsetWidth;
  const height = imageElement.offsetHeight;

  if (width === 0 || height === 0) return;

  const fallback = Math.min(width, height) / 2;
  const currentRadius = (circleRadius == null) ? fallback : circleRadius;
  const centerX = width / 2 + circleOffset.x;
  const centerY = height / 2 + circleOffset.y;

  // Координаты гизмочки на краю круга
  const handleX = centerX + currentRadius * 0.707; // cos(45°) ≈ 0.707
  const handleY = centerY + currentRadius * 0.707; // sin(45°) ≈ 0.707

  cropHandles.circleResize.style.left = `${handleX * scale - 6}px`;
  cropHandles.circleResize.style.top = `${handleY * scale - 6}px`;
}

async function globalPasteImage() {
  if (!copiedImageData) return;


  // Конвертируем screen → world coordinates (через Pixi.js)
  const { lastMouseX, lastMouseY } = getSharedVars();
  const worldPos = screenToWorld(lastMouseX, lastMouseY);

  const newImageId = `wbe-image-${Date.now()}`;
  const cropData = copiedImageData.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const maskTypeData = copiedImageData.maskType || 'rect';
  const circleOffsetData = copiedImageData.circleOffset || { x: 0, y: 0 };
  const circleRadiusData = copiedImageData.circleRadius || null;
  createImageElement(newImageId, copiedImageData.src, worldPos.x, worldPos.y, copiedImageData.scale, cropData, maskTypeData, circleOffsetData, circleRadiusData);

  const images = await getAllImages();
  images[newImageId] = {
    src: copiedImageData.src,
    left: worldPos.x,
    top: worldPos.y,
    scale: copiedImageData.scale,
    crop: cropData,
    maskType: maskTypeData,
    circleOffset: circleOffsetData,
    circleRadius: circleRadiusData,
    zIndex: ZIndexManager.getImage(newImageId)
  };
  await setAllImages(images);

  ui.notifications.info("Картинка вставлена");
}

// Вставка картинки из системного буфера
async function handleImagePasteFromClipboard(file) {
  try {
    // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
    copiedImageData = null;

    // Создаем уникальное имя файла
    const timestamp = Date.now();
    const extension = file.type.split('/')[1] || 'png';
    const filename = `wbe-image-${timestamp}.${extension}`;

    // Создаем новый File объект
    const newFile = new File([file], filename, { type: file.type });

    // Загружаем файл (оптимизированный подход)
    let uploadResult;
    const isGM = game.user.isGM;
    const startTime = Date.now();

    if (isGM) {
      // GM: Try direct upload only
      try {
        uploadResult = await foundry.applications.apps.FilePicker.implementation.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
        const directTime = Date.now() - startTime;
      } catch (error) {
        const directTime = Date.now() - startTime;
        console.error(`[WB-E] GM canvas upload failed after ${directTime}ms:`, error);
        throw new Error(`GM canvas upload failed: ${error.message}`);
      }
    } else {
      // Player: Try direct upload only (no timeout, no base64 fallback)
      try {
        uploadResult = await foundry.applications.apps.FilePicker.implementation.upload("data", `worlds/${game.world.id}/`, newFile, { name: filename });
        const directTime = Date.now() - startTime;
      } catch (error) {
        const directTime = Date.now() - startTime;
        console.error(`[WB-E] Player canvas direct upload failed after ${directTime}ms:`, error);
        throw new Error(`Player canvas upload failed: ${error.message}`);
      }
    }

    if (uploadResult && uploadResult.path) {
      // Конвертируем позицию курсора в world coordinates
      const { lastMouseX, lastMouseY } = getSharedVars();
      const worldPos = screenToWorld(lastMouseX, lastMouseY);


      // Создаем новое изображение В ПОЗИЦИИ КУРСОРА
      const imageId = `wbe-image-${timestamp}`;
      const defaultCrop = { top: 0, right: 0, bottom: 0, left: 0 };
      createImageElement(imageId, uploadResult.path, worldPos.x, worldPos.y, 1, defaultCrop, 'rect', { x: 0, y: 0 }, null);

      // Сохраняем в базу
      const images = await getAllImages();
      images[imageId] = {
        src: uploadResult.path,
        left: worldPos.x,
        top: worldPos.y,
        scale: 1,
        crop: defaultCrop,
        zIndex: ZIndexManager.getImage(imageId)
      };
      await setAllImages(images);

      ui.notifications.info("Изображение добавлено");
    } else {
      ui.notifications.error("Не удалось загрузить изображение");
    }
  } catch (err) {
    console.error("[WB-E] Ошибка при вставке картинки:", err);
    ui.notifications.error("Ошибка при вставке изображения");
  }
}

// Utility function to clean up broken images from scene flags
async function cleanupBrokenImages() {
  if (!game.user.isGM) {
    ui.notifications.warn("Only GMs can clean up broken images");
    return;
  }

  const images = await getAllImages();
  const brokenImages = [];

  // Check each image in the scene flags
  for (const [id, data] of Object.entries(images)) {
    const element = document.getElementById(id);
    if (element) {
      const img = element.querySelector('.wbe-canvas-image');
      if (img && (img.style.background.includes('#ffcccc') || !img.complete || img.naturalWidth === 0)) {
        brokenImages.push(id);
      }
    } else if (!data.src || typeof data.src !== 'string') {
      brokenImages.push(id);
    }
  }

  if (brokenImages.length === 0) {
    ui.notifications.info("No broken images found");
    return;
  }

  // Ask for confirmation
  const confirmed = await Dialog.confirm({
    title: "Clean Up Broken Images",
    content: `<p>Found ${brokenImages.length} broken image(s). Remove them from the scene?</p>
              <p><small>IDs: ${brokenImages.join(', ')}</small></p>`,
    yes: () => true,
    no: () => false
  });

  if (confirmed) {
    // Remove broken images from scene flags
    for (const id of brokenImages) {
      delete images[id];
      // Also remove from DOM if present
      const element = document.getElementById(id);
      if (element) element.remove();
    }

    await setAllImages(images);
    ui.notifications.info(`Removed ${brokenImages.length} broken image(s)`);
  }
}

export const ImageTools = {
  // create/update
  createImageElement,
  updateImageElement,

  // storage
  getAllImages,
  setAllImages,

  // paste impl
  globalPasteImage,
  handleImagePasteFromClipboard,

  // locks (socket helpers)
  applyImageLockVisual,
  removeImageLockVisual,

  // selection infra
  installGlobalImageSelectionHandler,

  // state getters/setters (so main can read/write if ever needed)
  get selectedImageId() { return selectedImageId; },
  set selectedImageId(v) { selectedImageId = v; },

  get copiedImageData() { return copiedImageData; },
  set copiedImageData(v) { copiedImageData = v; },

  // if you need to poke local vars from sockets:
  updateImageLocalVars,
  getImageLocalVars,

  // freeze management
  setImageFrozen,
  isImageFrozen,

  // frozen selection functions
  showFrozenSelection,
  hideFrozenSelection,

  // frozen panel functions
  createFrozenControlPanel,
  showFrozenControlPanel,
  killFrozenControlPanel,
  handleUnfreezeAction,
  updateFrozenPanelPosition,

  clearImageCaches,

  // utility functions
  cleanupBrokenImages

};
