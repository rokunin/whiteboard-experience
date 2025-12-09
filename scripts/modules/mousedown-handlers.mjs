/**
 * MouseDown Handlers - Complete Priority Groups
 * 
 * ARCHITECTURE:
 * - Each handler has: name, priority, canHandle(ctx), handle(ctx)
 * - Handlers are registered with HandlerResolver by priority (descending)
 * - Higher priority = processed first
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
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

/**
 * PanelImmunityHandler (priority 1000)
 * 
 * Prevents interference with panel interactions (text styling, image control).
 * Returns true from handle() without consuming the event, allowing panels to work normally.
 * 
 * Requirements: 3.1, 6.1
 */
export const PanelImmunityHandler = {
  name: 'panelImmunity',
  priority: 1000,

  /**
   * Check if click is on a panel element
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if click is on panel
   */
  canHandle(ctx) {
    const target = ctx.target;
    if (!target || typeof target.closest !== 'function') {
      return false;
    }
    
    return !!(
      target.closest('.wbe-color-picker-panel') ||
      target.closest('.wbe-text-styling-panel') ||
      target.closest('.wbe-image-control-panel') ||
      target.closest('.wbe-text-styling-subpanel') ||
      target.closest('.wbe-image-control-subpanel') ||
      target.closest('.wbe-color-subpanel') ||
      target.closest('.wbe-rotation-subpanel')
    );
  },

  /**
   * Handle panel click - return true without consuming
   * This allows the panel to handle the click normally
   * @param {EventContext} _ctx - Event context (unused)
   * @returns {boolean} Always true (event handled, but not consumed)
   */
  handle(_ctx) {
    // Don't consume - let panel handle the click
    // But return true to indicate we've "handled" it (stop further handler processing)
    return true;
  }
};

/**
 * EditImmunityHandler (priority 900)
 * 
 * Prevents interference with text editing in contenteditable elements.
 * Returns true from handle() without consuming, allowing browser text editing.
 * 
 * Requirements: 3.2, 6.2
 */
export const EditImmunityHandler = {
  name: 'editImmunity',
  priority: 900,

  /**
   * Check if click is on an editable element
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if click is on editable element
   */
  canHandle(ctx) {
    const target = ctx.target;
    if (!target || typeof target.getAttribute !== 'function') {
      return false;
    }
    
    return (
      target.isContentEditable ||
      target.getAttribute('contenteditable') === 'true' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA'
    );
  },

  /**
   * Handle editable element click - return true without consuming
   * This allows browser text editing to work normally
   * @param {EventContext} _ctx - Event context (unused)
   * @returns {boolean} Always true (event handled, but not consumed)
   */
  handle(_ctx) {
    // Don't consume - let browser handle text editing
    // Return true to stop further handler processing
    return true;
  }
};

/**
 * RightClickHandler (priority 800)
 * 
 * Handles right mouse button clicks:
 * - In text mode: exits text mode
 * - Otherwise: starts canvas pan
 * 
 * Requirements: 3.3, 6.3
 */
export const RightClickHandler = {
  name: 'rightClick',
  priority: 800,

  /**
   * Check if this is a right click (button === 2)
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if right click
   */
  canHandle(ctx) {
    return ctx.button === 2;
  },

  /**
   * Handle right click - exit text mode or start pan
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    const im = ctx.im;
    
    // In text mode, right click exits text mode instead of panning
    if (ctx.isTextMode) {
      im._exitTextMode();
      return true;
    }
    
    // Otherwise, start pan
    im._startPan(ctx.event);
    return true;
  }
};

/**
 * Get all high-priority mousedown handlers
 * @returns {Array} Array of handler objects
 */
export function getHighPriorityMouseDownHandlers() {
  return [
    PanelImmunityHandler,
    EditImmunityHandler,
    RightClickHandler
  ];
}

// ============================================
// MEDIUM PRIORITY HANDLERS (700-550)
// ============================================

/**
 * MassSelectionDragHandler (priority 700)
 * 
 * Handles dragging of mass-selected objects when clicking inside the bounding box.
 * If click is outside bounding box, clears mass selection and continues to normal handling.
 * 
 * Requirements: 3.4, 6.4
 */
export const MassSelectionDragHandler = {
  name: 'massSelectionDrag',
  priority: 700,

  /**
   * Check if mass selection is active and click is inside bounding box
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle mass drag
   */
  canHandle(ctx) {
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Must have mass selection controller
    const massSelection = ctx.massSelection;
    if (!massSelection) return false;
    
    // Must have selected objects
    if (!massSelection.selectedIds || massSelection.selectedIds.size === 0) return false;
    
    // Check if click is inside bounding box
    return massSelection.isPointInsideBoundingBox(ctx.clientX, ctx.clientY);
  },

  /**
   * Handle mass drag - start dragging all selected objects
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.consume();
    ctx.massSelection.startMassDrag(ctx.event);
    return true;
  }
};

/**
 * MassSelectionClearHandler (priority 695)
 * 
 * Clears mass selection when clicking outside the bounding box.
 * This allows normal handling to continue after clearing.
 * 
 * Requirements: 6.4
 */
export const MassSelectionClearHandler = {
  name: 'massSelectionClear',
  priority: 695,

  /**
   * Check if mass selection is active and click is outside bounding box
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should clear mass selection
   */
  canHandle(ctx) {
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Must have mass selection controller
    const massSelection = ctx.massSelection;
    if (!massSelection) return false;
    
    // Must have selected objects
    if (!massSelection.selectedIds || massSelection.selectedIds.size === 0) return false;
    
    // Click is outside bounding box (MassSelectionDragHandler handles inside)
    return !massSelection.isPointInsideBoundingBox(ctx.clientX, ctx.clientY);
  },

  /**
   * Handle click outside bounding box - clear mass selection
   * Does NOT consume event - allows normal handling to continue
   * @param {EventContext} ctx - Event context
   * @returns {boolean} False to allow other handlers to process
   */
  handle(ctx) {
    ctx.massSelection.clear();
    // Return false to allow other handlers to process (might select another object)
    return false;
  }
};

/**
 * MassSelectionStartHandler (priority 650)
 * 
 * Starts mass selection box when Shift+drag or toggle mode is active.
 * Only starts if clicking on empty space (not on object).
 * 
 * Requirements: 6.4
 */
export const MassSelectionStartHandler = {
  name: 'massSelectionStart',
  priority: 650,

  /**
   * Check if should start mass selection (Shift+drag or toggle mode)
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should start selection
   */
  canHandle(ctx) {
    // Check if mass selection is enabled in settings
    if (window.WBE_isFeatureEnabled && !window.WBE_isFeatureEnabled('massSelection')) {
      return false;
    }
    
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Must have mass selection controller
    const massSelection = ctx.massSelection;
    if (!massSelection) return false;
    
    // Check if should start selection (Shift held or toggle mode)
    // This delegates to massSelection's internal logic
    if (!massSelection.toggleMode && !ctx.shiftKey) return false;
    
    // Only start if clicking on empty space (not on object)
    const hitResult = ctx.hitResult;
    if (hitResult.type === 'object') return false;
    
    return true;
  },

  /**
   * Handle start of mass selection box
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    // Deselect single selection before starting mass selection
    if (ctx.im.selectedId) {
      ctx.im._deselect();
    }
    
    // Start selection through massSelection controller
    const started = ctx.massSelection.startSelection(ctx.event);
    if (started) {
      ctx.consume();
      return true;
    }
    return false;
  }
};

/**
 * TextModeCreateHandler (priority 660)
 * 
 * Creates text at cursor position when in text mode and clicking on canvas or image.
 * If clicking on existing text, edits it instead of creating new.
 * Priority above MassSelectionStartHandler (650) so T-cursor works even with toggle mode on.
 * 
 * Requirements: 3.5, 6.5
 */
export const TextModeCreateHandler = {
  name: 'textModeCreate',
  priority: 660,

  /**
   * Check if in text mode and left click on non-UI element
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle text creation
   */
  canHandle(ctx) {
    // Check if texts are enabled in settings
    if (window.WBE_isFeatureEnabled && !window.WBE_isFeatureEnabled('texts')) {
      return false;
    }
    
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Must be in text mode
    if (!ctx.isTextMode) return false;
    
    // Don't handle UI clicks
    const hitResult = ctx.hitResult;
    if (hitResult.type === 'ui') return false;
    
    return true;
  },

  /**
   * Handle text creation or editing
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    const hitResult = ctx.hitResult;
    const im = ctx.im;
    
    // If clicking on existing TEXT object - edit it instead of creating new
    if (hitResult.type === 'object' && hitResult.object?.type === 'text') {
      ctx.consume();
      
      // Select and start editing the existing text
      im._select(hitResult.object.id);
      im._startEditText(hitResult.object.id);
      
      // Exit text mode
      im._exitTextMode();
      return true;
    }
    
    // Allow text creation on canvas OR over images
    if (hitResult.type === 'canvas' || hitResult.type === 'object') {
      ctx.consume();
      
      // Create text at cursor position and start editing
      im._createTextAt(ctx.clientX, ctx.clientY, true);
      
      // Exit text mode after creating text
      im._exitTextMode();
      return true;
    }
    
    return false;
  }
};

/**
 * UnfreezeIconHandler (priority 550)
 * 
 * Handles click on unfreeze icon to start hold-to-activate unfreeze.
 * 
 * Requirements: 6.7
 */
export const UnfreezeIconHandler = {
  name: 'unfreezeIcon',
  priority: 550,

  /**
   * Check if clicking on unfreeze icon
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if clicking on unfreeze icon
   */
  canHandle(ctx) {
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Check if target is unfreeze icon
    const target = ctx.target;
    if (!target || typeof target.closest !== 'function') return false;
    
    return !!target.closest('.wbe-unfreeze-icon');
  },

  /**
   * Handle unfreeze icon click - start hold-to-activate
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    const unfreezeIcon = ctx.target.closest('.wbe-unfreeze-icon');
    if (!unfreezeIcon) return false;
    
    // Delegate to InteractionManager's unfreeze handling
    ctx.im._handleUnfreezeIconMouseDown(unfreezeIcon, ctx.event);
    return true;
  }
};

/**
 * Get all medium-priority mousedown handlers
 * @returns {Array} Array of handler objects
 */
export function getMediumPriorityMouseDownHandlers() {
  return [
    MassSelectionDragHandler,
    MassSelectionClearHandler,
    MassSelectionStartHandler,
    TextModeCreateHandler,
    UnfreezeIconHandler
  ];
}


// ============================================
// LOW PRIORITY HANDLERS (500-100)
// ============================================

/**
 * WidthResizeHandler (priority 500)
 * 
 * Handles text width resize when clicking on the right border of a selected text object.
 * Only applies to text objects that are selected but not being edited.
 * 
 * Requirements: 6.7
 */
export const WidthResizeHandler = {
  name: 'widthResize',
  priority: 500,

  /**
   * Check if clicking on text border for width resize
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle width resize
   */
  canHandle(ctx) {
    // Check if texts are enabled in settings
    if (window.WBE_isFeatureEnabled && !window.WBE_isFeatureEnabled('texts')) {
      return false;
    }
    
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Must have a selected object
    const selectedId = ctx.selectedId;
    if (!selectedId) return false;
    
    // Must be a text object
    const selectedObj = ctx.selectedObject;
    if (!selectedObj || selectedObj.type !== 'text') return false;
    
    // Must not be editing (editing mode allows caret positioning)
    if (ctx.editingId === selectedId) return false;
    
    // Skip if clicking on scale handle (scale handle takes priority)
    const target = ctx.target;
    if (target && typeof target.closest === 'function') {
      const scaleHandle = target.closest('.wbe-selection-overlay-handle');
      if (scaleHandle) return false;
    }
    
    // Check if clicking on the right border of the selection
    const layer = ctx.layer;
    if (!layer) return false;
    
    const container = layer.getObjectContainer(selectedId);
    const selectionBorder = container?.querySelector('.wbe-text-selection-border');
    if (!selectionBorder || selectionBorder.style.display === 'none') return false;
    
    const rect = selectionBorder.getBoundingClientRect();
    const x = ctx.clientX - rect.left;
    const width = rect.width;
    const BORDER_THRESHOLD = 8;
    
    // Check if click is near right border
    return x >= width - BORDER_THRESHOLD && x <= width + BORDER_THRESHOLD;
  },

  /**
   * Handle width resize start
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.consume();
    ctx.im._startWidthResize(ctx.selectedId, ctx.event);
    return true;
  }
};

/**
 * CropHandleHandler (priority 450)
 * 
 * Handles crop handle interactions for images in crop mode.
 * Supports both rect crop (edge handles) and circle crop (resize handle).
 * 
 * Requirements: 6.7
 */
export const CropHandleHandler = {
  name: 'cropHandle',
  priority: 450,

  /**
   * Check if clicking on a crop handle
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle crop
   */
  canHandle(ctx) {
    // Check if images are enabled in settings
    if (window.WBE_isFeatureEnabled && !window.WBE_isFeatureEnabled('images')) {
      return false;
    }
    
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Check hit result for crop handle
    const hitResult = ctx.hitResult;
    if (!hitResult.handleType) return false;
    if (!hitResult.handleType.startsWith('crop-')) return false;
    
    // Must be an image in crop mode
    const obj = hitResult.object;
    if (!obj || obj.type !== 'image' || !obj.isCropping) return false;
    
    return true;
  },

  /**
   * Handle crop handle interaction
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.consume();
    
    const hitResult = ctx.hitResult;
    const id = hitResult.object.id;
    const handleType = hitResult.handleType;
    
    if (handleType === 'crop-circle-resize') {
      ctx.im._startCropCircleResize(id, ctx.event);
    } else if (handleType.startsWith('crop-rect-')) {
      const direction = handleType.replace('crop-rect-', ''); // 'top', 'right', 'bottom', 'left'
      ctx.im._startCropRectDrag(id, direction, ctx.event);
    }
    
    return true;
  }
};

/**
 * ScaleHandleHandler (priority 400)
 * 
 * Handles scale resize when clicking on scale handles.
 * Works for both text and image objects.
 * 
 * Requirements: 6.7
 */
export const ScaleHandleHandler = {
  name: 'scaleHandle',
  priority: 400,

  /**
   * Check if clicking on a scale handle
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle scale
   */
  canHandle(ctx) {
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Check hit result for scale handle
    const hitResult = ctx.hitResult;
    if (hitResult.handleType !== 'scale') return false;
    
    // Must have an object that supports scaling
    const obj = hitResult.object;
    if (!obj) return false;
    
    // Check if object supports scaling via capabilities interface
    const capabilities = obj.getCapabilities?.() || {};
    if (!capabilities.scalable) return false;
    
    // Check if feature is enabled for this object type
    if (obj.isEnabled && !obj.isEnabled()) {
      return false;
    }
    
    // Skip frozen objects
    if (obj.isFrozen?.()) {
      return false;
    }
    
    return true;
  },

  /**
   * Handle scale resize start
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.consume();
    ctx.im._startScaleResize(ctx.hitResult.object.id, ctx.event);
    return true;
  }
};

/**
 * CircleCropDragHandler (priority 350)
 * 
 * Handles dragging the image inside a circle crop mask.
 * Only applies when image is in circle crop mode.
 * 
 * Requirements: 6.7
 */
export const CircleCropDragHandler = {
  name: 'circleCropDrag',
  priority: 350,

  /**
   * Check if should handle circle crop drag
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle
   */
  canHandle(ctx) {
    // Check if images are enabled in settings
    if (window.WBE_isFeatureEnabled && !window.WBE_isFeatureEnabled('images')) {
      return false;
    }
    
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Check hit result for object
    const hitResult = ctx.hitResult;
    if (hitResult.type !== 'object') return false;
    
    // Must be an image in circle crop mode
    const obj = hitResult.object;
    if (!obj || obj.type !== 'image') return false;
    if (!obj.isCropping || obj.maskType !== 'circle') return false;
    
    return true;
  },

  /**
   * Handle circle crop drag start
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.consume();
    const id = ctx.hitResult.object.id;
    ctx.im._select(id);
    ctx.im._startCropCircleDrag(id, ctx.event);
    return true;
  }
};

/**
 * ObjectDragHandler (priority 300)
 * 
 * Handles selecting and dragging objects (text and images).
 * Skips frozen images and respects image locks.
 * 
 * Requirements: 3.6, 6.6
 */
export const ObjectDragHandler = {
  name: 'objectDrag',
  priority: 300,

  /**
   * Check if should handle object drag
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle
   */
  canHandle(ctx) {
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Check hit result for object
    const hitResult = ctx.hitResult;
    if (hitResult.type !== 'object') return false;
    
    const obj = hitResult.object;
    if (!obj || !obj.id) return false;
    
    // Check if feature is enabled for this object type
    if (obj.isEnabled && !obj.isEnabled()) {
      return false;
    }
    
    // Check if object is being edited - let browser handle click for caret positioning
    if (obj.canEdit && obj.canEdit() && ctx.editingId === obj.id) {
      return false;
    }
    
    // Check if object is locked (e.g., image in crop mode on another client)
    if (obj.isLocked?.()) {
      const layer = ctx.layer;
      if (layer) {
        const container = layer.getObjectContainer(obj.id);
        if (container?.dataset.lockedBy && container.dataset.lockedBy !== game.user.id) {
          return false;
        }
      }
    }
    
    // Skip frozen objects - they allow pan/zoom through them
    if (obj.isFrozen?.()) {
      return false;
    }
    
    return true;
  },

  /**
   * Handle object selection and drag start
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.consume();
    const id = ctx.hitResult.object.id;
    ctx.im._select(id);
    ctx.im._startDrag(id, ctx.event);
    return true;
  }
};

/**
 * CanvasDeselectHandler (priority 100)
 * 
 * Handles clicking on empty canvas to deselect current selection.
 * Lowest priority - only triggers if no other handler matched.
 * 
 * Requirements: 3.7, 6.8
 */
export const CanvasDeselectHandler = {
  name: 'canvasDeselect',
  priority: 100,

  /**
   * Check if clicking on empty canvas
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if should handle
   */
  canHandle(ctx) {
    // Only left click
    if (ctx.button !== 0) return false;
    
    // Check hit result for canvas
    const hitResult = ctx.hitResult;
    return hitResult.type === 'canvas';
  },

  /**
   * Handle canvas click - deselect current selection
   * @param {EventContext} ctx - Event context
   * @returns {boolean} True if handled
   */
  handle(ctx) {
    ctx.im._deselect();
    // Don't consume - allows Foundry canvas panning if mode is 'select'
    return true;
  }
};

/**
 * Get all low-priority mousedown handlers
 * @returns {Array} Array of handler objects
 */
export function getLowPriorityMouseDownHandlers() {
  return [
    WidthResizeHandler,
    CropHandleHandler,
    ScaleHandleHandler,
    CircleCropDragHandler,
    ObjectDragHandler,
    CanvasDeselectHandler
  ];
}

/**
 * Get all mousedown handlers (high, medium, and low priority)
 * @returns {Array} Array of all handler objects
 */
export function getAllMouseDownHandlers() {
  return [
    ...getHighPriorityMouseDownHandlers(),
    ...getMediumPriorityMouseDownHandlers(),
    ...getLowPriorityMouseDownHandlers()
  ];
}
