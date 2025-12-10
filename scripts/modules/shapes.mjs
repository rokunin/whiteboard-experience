/**
 * Shapes Module for Whiteboard Experience
 * 
 * Рисование примитивов: прямоугольник, круг, freehand
 * 
 * Архитектура:
 * - Автономный модуль, подключается к WBE через window.Whiteboard API
 * - SVG overlay для рисования
 * - При завершении жеста создаёт объект в Registry
 */

const MODULE_NAME = 'WBE-Shapes';

// Shape types
const SHAPE_TYPES = {
  RECT: 'rect',
  CIRCLE: 'circle',
  FREEHAND: 'freehand'
};

// Default styles
const DEFAULT_STROKE_COLOR = '#ffffff';
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_FILL_COLOR = 'transparent';

/**
 * ShapesManager - управление рисованием примитивов
 */
class ShapesManager {
  constructor() {
    this.svg = null;
    this.layer = null;
    this.enabled = false;
    this.currentTool = null;
    this.isDrawing = false;
    this.startPoint = null;
    this.currentElement = null;
    this.freehandPoints = [];

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  init() {
    // Check if shapes are enabled in settings
    if (window.WBE_isFeatureEnabled && !window.WBE_isFeatureEnabled('shapes')) {
      console.log(`[${MODULE_NAME}] Disabled in settings`);
      return;
    }

    if (!window.Whiteboard?.layer?.element) {
      console.log(`[${MODULE_NAME}] Waiting for Whiteboard...`);
      setTimeout(() => this.init(), 500);
      return;
    }

    this.layer = window.Whiteboard.layer.element;
    this._createSvgOverlay();
    this._registerObjectType();
    this._setupEventListeners();
    this._addToolbarButtons();

    console.log(`[${MODULE_NAME}] Initialized`);
  }

  _createSvgOverlay() {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.id = 'wbe-shapes-overlay';
    this.svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 99998;
      overflow: visible;
    `;
    this.layer.appendChild(this.svg);
  }

  _registerObjectType() {
    if (!window.Whiteboard?.registerObjectType) {
      console.warn(`[${MODULE_NAME}] registerObjectType not available`);
      return;
    }

    window.Whiteboard.registerObjectType('shape', {
      ViewClass: ShapeView,
      PanelClass: ShapePanel
    });

    // Register panel UI selector so clicks don't deselect object
    if (window.Whiteboard.registerUISelector) {
      window.Whiteboard.registerUISelector('.wbe-panel');
      window.Whiteboard.registerUISelector('.wbe-subpanel');
    }

    // Storage type is registered in 'init' hook (before WBE loads data)
    console.log(`[${MODULE_NAME}] Object type 'shape' registered`);
  }

  _setupEventListeners() {
    window.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * Добавить кнопки в WBE Toolbar
   */
  _addToolbarButtons() {
    // Use WBE Floating Toolbar instead of Foundry injection
    if (!window.WBEToolbar?.registerTool) {
      console.warn(`[${MODULE_NAME}] WBEToolbar not available, retrying...`);
      setTimeout(() => this._addToolbarButtons(), 500);
      return;
    }

    const tools = [
      { id: 'wbe-shape-rect', type: SHAPE_TYPES.RECT, icon: 'fa-solid fa-square', title: 'Rectangle (R)' },
      { id: 'wbe-shape-circle', type: SHAPE_TYPES.CIRCLE, icon: 'fa-solid fa-circle', title: 'Circle (C)' },
      { id: 'wbe-shape-freehand', type: SHAPE_TYPES.FREEHAND, icon: 'fa-solid fa-pen', title: 'Freehand (F)' }
    ];

    tools.forEach(tool => {
      window.WBEToolbar.registerTool({
        id: tool.id,
        title: tool.title,
        icon: tool.icon,
        group: 'shapes',
        type: 'tool', // exclusive - только один активен
        onActivate: () => {
          this.enableTool(tool.type);
        },
        onDeactivate: () => {
          this.disableTool();
        }
      });
    });

    console.log(`[${MODULE_NAME}] Tools registered in WBE Toolbar`);
  }

  enableTool(toolType) {
    if (!Object.values(SHAPE_TYPES).includes(toolType)) {
      console.warn(`[${MODULE_NAME}] Unknown tool: ${toolType}`);
      return;
    }

    // Check if SVG overlay exists
    if (!this.svg) {
      console.warn(`[${MODULE_NAME}] SVG overlay not found, recreating...`);
      this._createSvgOverlay();
    }

    this.currentTool = toolType;
    this.enabled = true;
    
    // Set cursor on layer (SVG overlay stays pointer-events: none)
    // mousedown is handled by ShapeDrawHandler in centralized handler system
    this.layer.style.cursor = 'crosshair';

    // mousemove/mouseup still needed for drag tracking
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);

    console.log(`[${MODULE_NAME}] Tool enabled: ${toolType}`);
  }

  disableTool() {
    this.currentTool = null;
    this.enabled = false;
    this.isDrawing = false;
    
    // Reset cursor
    if (this.layer) {
      this.layer.style.cursor = '';
    }

    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);

    if (this.currentElement) {
      this.currentElement.remove();
      this.currentElement = null;
    }

    console.log(`[${MODULE_NAME}] Tool disabled`);
  }

  _getWorldCoords(e) {
    const layerRect = this.layer.getBoundingClientRect();
    const canvasScale = canvas?.stage?.worldTransform?.a || 1;

    return {
      x: (e.clientX - layerRect.left) / canvasScale,
      y: (e.clientY - layerRect.top) / canvasScale
    };
  }

  /**
   * Build smooth SVG path using cubic Bezier curves (Catmull-Rom style)
   * @param {Array} points - Array of {x, y} points
   * @returns {string} SVG path d attribute
   */
  _buildSmoothPath(points) {
    if (points.length < 2) {
      return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : '';
    }
    
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }

    // Start at first point
    let d = `M ${points[0].x} ${points[0].y}`;
    
    // Use cubic Bezier curves for smoother lines
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      
      // Catmull-Rom to Bezier conversion - lower tension = smoother curves
      const tension = 4;
      const cp1x = p1.x + (p2.x - p0.x) / tension;
      const cp1y = p1.y + (p2.y - p0.y) / tension;
      const cp2x = p2.x - (p3.x - p1.x) / tension;
      const cp2y = p2.y - (p3.y - p1.y) / tension;
      
      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
    }
    
    return d;
  }

  _onMouseDown(e) {
    if (!this.enabled || e.button !== 0) return;

    // Note: stopPropagation not needed - ShapeDrawHandler in centralized system
    // handles priority over mass-select

    // Disable Foundry mass-select frame during drawing
    if (canvas?.controls?.select) {
      canvas.controls.select.visible = false;
    }

    this.isDrawing = true;
    this.startPoint = this._getWorldCoords(e);
    this.freehandPoints = [this.startPoint];

    this._createTempElement();
  }

  _onMouseMove(e) {
    if (!this.isDrawing) return;

    const current = this._getWorldCoords(e);
    // Pass shiftKey for proportional constraint
    this._updateTempElement(current, e.shiftKey);
  }

  _onMouseUp(e) {
    if (!this.isDrawing) return;

    this.isDrawing = false;
    const endPoint = this._getWorldCoords(e);

    this._createShapeObject(endPoint, e.shiftKey);

    if (this.currentElement) {
      this.currentElement.remove();
      this.currentElement = null;
    }

    // Re-enable Foundry mass-select frame
    if (canvas?.controls?.select) {
      canvas.controls.select.visible = true;
    }

    // Tool stays active - user can draw more shapes
    // Exit with RMB (handled in RightClickHandler)
  }

  _deactivateToolbarButtons() {
    // Use WBE Toolbar API to deactivate tools
    if (window.WBEToolbar?.deactivateAllTools) {
      window.WBEToolbar.deactivateAllTools();
    }
  }

  _createTempElement() {
    const { x, y } = this.startPoint;

    switch (this.currentTool) {
      case SHAPE_TYPES.RECT:
        this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        this.currentElement.setAttribute('x', x);
        this.currentElement.setAttribute('y', y);
        this.currentElement.setAttribute('width', 0);
        this.currentElement.setAttribute('height', 0);
        break;

      case SHAPE_TYPES.CIRCLE:
        this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        this.currentElement.setAttribute('cx', x);
        this.currentElement.setAttribute('cy', y);
        this.currentElement.setAttribute('rx', 0);
        this.currentElement.setAttribute('ry', 0);
        break;

      case SHAPE_TYPES.FREEHAND:
        this.currentElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.currentElement.setAttribute('d', `M ${x} ${y}`);
        break;
    }

    if (this.currentElement) {
      this.currentElement.setAttribute('stroke', DEFAULT_STROKE_COLOR);
      this.currentElement.setAttribute('stroke-width', DEFAULT_STROKE_WIDTH);
      this.currentElement.setAttribute('fill', DEFAULT_FILL_COLOR);
      // Smooth line caps and joins for freehand
      if (this.currentTool === SHAPE_TYPES.FREEHAND) {
        this.currentElement.setAttribute('stroke-linecap', 'round');
        this.currentElement.setAttribute('stroke-linejoin', 'round');
      }
      this.svg.appendChild(this.currentElement);
    }
  }

  _updateTempElement(current, shiftKey = false) {
    if (!this.currentElement) return;

    const { x: sx, y: sy } = this.startPoint;
    let { x: cx, y: cy } = current;

    // Shift key = proportional constraint (square/circle)
    if (shiftKey && this.currentTool !== SHAPE_TYPES.FREEHAND) {
      const dx = cx - sx;
      const dy = cy - sy;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      cx = sx + size * Math.sign(dx || 1);
      cy = sy + size * Math.sign(dy || 1);
    }

    switch (this.currentTool) {
      case SHAPE_TYPES.RECT:
        const rx = Math.min(sx, cx);
        const ry = Math.min(sy, cy);
        const rw = Math.abs(cx - sx);
        const rh = Math.abs(cy - sy);
        this.currentElement.setAttribute('x', rx);
        this.currentElement.setAttribute('y', ry);
        this.currentElement.setAttribute('width', rw);
        this.currentElement.setAttribute('height', rh);
        break;

      case SHAPE_TYPES.CIRCLE:
        const centerX = (sx + cx) / 2;
        const centerY = (sy + cy) / 2;
        const radiusX = Math.abs(cx - sx) / 2;
        const radiusY = Math.abs(cy - sy) / 2;
        this.currentElement.setAttribute('cx', centerX);
        this.currentElement.setAttribute('cy', centerY);
        this.currentElement.setAttribute('rx', radiusX);
        this.currentElement.setAttribute('ry', radiusY);
        break;

      case SHAPE_TYPES.FREEHAND:
        // Only add point if far enough from last point (reduces jitter)
        const lastPoint = this.freehandPoints[this.freehandPoints.length - 1];
        const dist = Math.hypot(current.x - lastPoint.x, current.y - lastPoint.y);
        if (dist > 6) { // Minimum distance between points - higher = smoother
          this.freehandPoints.push(current);
          // Use cubic Bezier curves for smooth lines
          const d = this._buildSmoothPath(this.freehandPoints);
          this.currentElement.setAttribute('d', d);
        }
        break;
    }
  }

  _createShapeObject(endPoint, shiftKey = false) {
    const im = window.Whiteboard?.interaction;
    if (!im) return;

    const { x: sx, y: sy } = this.startPoint;
    let { x: ex, y: ey } = endPoint;

    // Shift key = proportional constraint (square/circle)
    if (shiftKey && this.currentTool !== SHAPE_TYPES.FREEHAND) {
      const dx = ex - sx;
      const dy = ey - sy;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      ex = sx + size * Math.sign(dx || 1);
      ey = sy + size * Math.sign(dy || 1);
    }

    if (Math.abs(ex - sx) < 5 && Math.abs(ey - sy) < 5) {
      console.log(`[${MODULE_NAME}] Shape too small, ignoring`);
      return;
    }

    // Собираем данные для shape
    let shapeData = {
      shapeType: this.currentTool,
      strokeColor: DEFAULT_STROKE_COLOR,
      strokeWidth: DEFAULT_STROKE_WIDTH,
      fillColor: DEFAULT_FILL_COLOR
    };

    // Вычисляем world coordinates для левого верхнего угла
    const worldX = Math.min(sx, ex);
    const worldY = Math.min(sy, ey);

    switch (this.currentTool) {
      case SHAPE_TYPES.RECT:
        shapeData.width = Math.abs(ex - sx);
        shapeData.height = Math.abs(ey - sy);
        break;

      case SHAPE_TYPES.CIRCLE:
        shapeData.width = Math.abs(ex - sx);
        shapeData.height = Math.abs(ey - sy);
        shapeData.radiusX = Math.abs(ex - sx) / 2;
        shapeData.radiusY = Math.abs(ey - sy) / 2;
        break;

      case SHAPE_TYPES.FREEHAND:
        const minX = Math.min(...this.freehandPoints.map(p => p.x));
        const minY = Math.min(...this.freehandPoints.map(p => p.y));
        const maxX = Math.max(...this.freehandPoints.map(p => p.x));
        const maxY = Math.max(...this.freehandPoints.map(p => p.y));

        shapeData.width = maxX - minX || 1;
        shapeData.height = maxY - minY || 1;
        shapeData.points = this.freehandPoints.map(p => ({
          x: p.x - minX,
          y: p.y - minY
        }));
        break;
    }

    // Конвертируем world coords в screen coords для _createObjectAt
    const t = canvas.stage.worldTransform;
    const screenX = worldX * t.a + t.tx;
    const screenY = worldY * t.d + t.ty;

    // Создаём объект через WBE API (как fate-card)
    const obj = im._createObjectAt('shape', screenX, screenY, shapeData);

    if (obj) {
      console.log(`[${MODULE_NAME}] Shape created:`, obj.id);
    }
  }

  _onKeyDown(e) {
    if (this._isInputFocused()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Use e.code for keyboard layout independence (works with Russian layout too)
    const toolMap = {
      'KeyR': SHAPE_TYPES.RECT,
      'KeyC': SHAPE_TYPES.CIRCLE,
      'KeyF': SHAPE_TYPES.FREEHAND
    };

    const toolType = toolMap[e.code];
    if (toolType) {
      e.preventDefault();
      // Toggle: if same tool active - deactivate, otherwise activate
      if (this.currentTool === toolType) {
        this._deactivateToolbarButtons();
      } else {
        // Activate via toolbar to keep UI in sync
        const toolId = `wbe-shape-${toolType}`;
        if (window.WBEToolbar?.activateTool) {
          window.WBEToolbar.activateTool(toolId);
        } else {
          this.enableTool(toolType);
        }
      }
    }
    // Note: Escape is captured by Foundry menu, use RMB to exit shape tool
  }

  _isInputFocused() {
    const active = document.activeElement;
    return active?.tagName === 'INPUT' ||
      active?.tagName === 'TEXTAREA' ||
      active?.isContentEditable;
  }

  destroy() {
    this.disableTool();
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.svg?.parentNode) {
      this.svg.parentNode.removeChild(this.svg);
    }
  }
}


// ==========================================
// ShapeView - Model + View (как FateCardView)
// ==========================================

class ShapeView {
  /**
   * Build smooth SVG path using cubic Bezier curves (static version for rendering)
   * @param {Array} points - Array of {x, y} points
   * @returns {string} SVG path d attribute
   */
  static _buildSmoothPathStatic(points) {
    if (points.length < 2) {
      return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : '';
    }
    
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }

    let d = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      
      const tension = 4;
      const cp1x = p1.x + (p2.x - p0.x) / tension;
      const cp1y = p1.y + (p2.y - p0.y) / tension;
      const cp2x = p2.x - (p3.x - p1.x) / tension;
      const cp2y = p2.y - (p3.y - p1.y) / tension;
      
      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
    }
    
    return d;
  }

  constructor(data) {
    // CRITICAL: Generate id if not provided (like FateCardView)
    this.id = data.id || `shape-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    this.type = 'shape';
    this.shapeType = data.shapeType || SHAPE_TYPES.RECT;
    this.x = data.x || 0;
    this.y = data.y || 0;
    this.width = data.width || 100;
    this.height = data.height || 100;
    this.radiusX = data.radiusX || 50;
    this.radiusY = data.radiusY || 50;
    this.points = data.points || [];
    this.strokeColor = data.strokeColor || DEFAULT_STROKE_COLOR;
    this.strokeWidth = data.strokeWidth !== undefined ? data.strokeWidth : DEFAULT_STROKE_WIDTH;
    this.fillColor = data.fillColor || DEFAULT_FILL_COLOR;
    this.fillOpacity = data.fillOpacity !== undefined ? data.fillOpacity : 100;
    this.rotation = data.rotation || 0;
    this.scale = data.scale !== undefined ? data.scale : 1;
    this.frozen = data.frozen || false;
    this.selected = data.selected || false;
    this.zIndexRank = data.zIndexRank || '';
    this.zIndex = data.zIndex;

    // Text properties (for rect and circle shapes)
    this.text = data.text || '';
    this.textColor = data.textColor || '#ffffff';
    this.textSize = data.textSize || 16;
    this.textAlign = data.textAlign || 'center';
    this.fontFamily = data.fontFamily || 'Arial';
    this.fontWeight = data.fontWeight || 'normal';
    this.fontStyle = data.fontStyle || 'normal';

    // Shadow properties
    this.shadowColor = data.shadowColor || '#000000';
    this.shadowOpacity = data.shadowOpacity !== undefined ? data.shadowOpacity : 0;
    this.shadowOffsetX = data.shadowOffsetX !== undefined ? data.shadowOffsetX : 4;
    this.shadowOffsetY = data.shadowOffsetY !== undefined ? data.shadowOffsetY : 4;

    this.element = null;
    this.svg = null;
    this.textElement = null;
    this.isEditing = false;
  }

  // ==========================================
  // WBE Interface Methods (required)
  // ==========================================

  getSerializationKey() {
    return 'shape';
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      shapeType: this.shapeType,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      radiusX: this.radiusX,
      radiusY: this.radiusY,
      points: this.points,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fillColor: this.fillColor,
      fillOpacity: this.fillOpacity,
      rotation: this.rotation,
      scale: this.scale,
      frozen: this.frozen,
      zIndexRank: this.zIndexRank,
      // Text properties
      text: this.text,
      textColor: this.textColor,
      textSize: this.textSize,
      textAlign: this.textAlign,
      fontFamily: this.fontFamily,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      // Shadow properties
      shadowColor: this.shadowColor,
      shadowOpacity: this.shadowOpacity,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY
    };
  }

  updateClickTarget(_container) {
    // Shapes don't need special click-target handling
  }

  getContainerSelector() {
    return '.wbe-shape-container';
  }

  usesTransformScale() {
    return true; // Use transform scale like FateCardView
  }

  isFrozen() {
    return this.frozen === true;
  }

  getCapabilities() {
    return {
      scalable: true,
      draggable: true,
      freezable: true,
      editable: this.shapeType !== SHAPE_TYPES.FREEHAND
    };
  }

  /**
   * Check if shape can be edited (has text capability)
   */
  canEdit() {
    return this.shapeType !== SHAPE_TYPES.FREEHAND;
  }

  getCopyData(_layer) {
    return this.toJSON();
  }

  getElementForHitTest(layer) {
    const container = layer?.getObjectContainer(this.id);
    return container || this.element;
  }

  onCreated(_interactionManager, _options) {
    // Shapes don't need special post-creation logic
  }

  render() {
    const scale = this.scale !== undefined ? this.scale : 1;
    const width = this.width;
    const height = this.height;

    // Build transform string
    let transform = '';
    if (scale !== 1) transform += `scale(${scale}) `;
    if (this.rotation) transform += `rotate(${this.rotation}deg)`;

    // Container
    this.element = document.createElement('div');
    this.element.id = this.id;
    this.element.className = 'wbe-shape-container';
    this.element.dataset.objectType = 'shape';
    
    this.element.style.cssText = `
      position: absolute;
      left: ${Math.round(this.x)}px;
      top: ${Math.round(this.y)}px;
      width: ${width}px;
      height: ${height}px;
      pointer-events: auto;
      transform-origin: center;
      ${transform ? `transform: ${transform.trim()};` : ''}
    `;

    // SVG element
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText = `
      overflow: visible;
      display: block;
      width: 100%;
      height: 100%;
    `;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Add shadow filter if needed
    this._addShadowFilter();

    // Shape element (transform handles scaling)
    const shapeEl = this._createShapeElement();
    if (shapeEl) {
      // Apply shadow filter to shape
      if (this.shadowOpacity > 0) {
        shapeEl.setAttribute('filter', `url(#shadow-${this.id})`);
      }
      this.svg.appendChild(shapeEl);
    }

    this.element.appendChild(this.svg);

    // Text element (for rect and circle only)
    if (this.shapeType !== SHAPE_TYPES.FREEHAND) {
      this._createTextElement();
    }

    // NOTE: Selection border is handled by WBE's _showSelectionOverlay() (SVG-based)
    // No need for custom selection border here - WBE provides unified selection UI

    return this.element;
  }

  /**
   * Create text element overlay for shape
   */
  _createTextElement() {
    this.textElement = document.createElement('div');
    this.textElement.className = 'wbe-shape-text';
    this.textElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: ${this.textAlign === 'left' ? 'flex-start' : this.textAlign === 'right' ? 'flex-end' : 'center'};
      padding: 8px;
      box-sizing: border-box;
      color: ${this.textColor};
      font-size: ${this.textSize}px;
      font-family: ${this.fontFamily};
      font-weight: ${this.fontWeight};
      font-style: ${this.fontStyle};
      text-align: ${this.textAlign};
      overflow: hidden;
      word-wrap: break-word;
      pointer-events: none;
      user-select: none;
    `;
    this.textElement.textContent = this.text;
    this.element.appendChild(this.textElement);
  }

  _createShapeElement() {
    let el;
    const sw = this.strokeWidth;
    const width = this.width;
    const height = this.height;

    switch (this.shapeType) {
      case SHAPE_TYPES.RECT:
        el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        el.setAttribute('x', sw / 2);
        el.setAttribute('y', sw / 2);
        el.setAttribute('width', Math.max(0, width - sw));
        el.setAttribute('height', Math.max(0, height - sw));
        break;

      case SHAPE_TYPES.CIRCLE:
        el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        el.setAttribute('cx', width / 2);
        el.setAttribute('cy', height / 2);
        el.setAttribute('rx', Math.max(0, width / 2 - sw / 2));
        el.setAttribute('ry', Math.max(0, height / 2 - sw / 2));
        break;

      case SHAPE_TYPES.FREEHAND:
        el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        if (this.points.length > 0) {
          // Use smooth curves for rendering
          const d = ShapeView._buildSmoothPathStatic(this.points);
          el.setAttribute('d', d);
        }
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('stroke-linejoin', 'round');
        break;
    }

    if (el) {
      el.setAttribute('stroke', this.strokeColor);
      el.setAttribute('stroke-width', sw);
      if (this.shapeType !== SHAPE_TYPES.FREEHAND) {
        el.setAttribute('fill', this.fillColor);
        // Apply fill opacity
        const opacity = (this.fillOpacity !== undefined ? this.fillOpacity : 100) / 100;
        el.setAttribute('fill-opacity', opacity);
      }
    }

    return el;
  }

  /**
   * Add SVG drop shadow filter to SVG element
   * Creates/updates <defs><filter> with feDropShadow
   */
  _addShadowFilter() {
    if (!this.svg) return;
    
    const filterId = `shadow-${this.id}`;
    const opacity = this.shadowOpacity ?? 0;
    
    // Remove existing defs
    const existingDefs = this.svg.querySelector('defs');
    if (existingDefs) existingDefs.remove();
    
    if (opacity <= 0) return;
    
    const color = this.shadowColor || '#000000';
    const alpha = opacity / 100;
    
    // Create defs with filter
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
    
    const dropShadow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    dropShadow.setAttribute('dx', String(this.shadowOffsetX ?? 4));
    dropShadow.setAttribute('dy', String(this.shadowOffsetY ?? 4));
    dropShadow.setAttribute('stdDeviation', '6');
    dropShadow.setAttribute('flood-color', color);
    dropShadow.setAttribute('flood-opacity', String(alpha));
    
    filter.appendChild(dropShadow);
    defs.appendChild(filter);
    this.svg.insertBefore(defs, this.svg.firstChild);
  }

  /**
   * Update internal state from data (called by WBE on sync/load)
   * CRITICAL for persistence and multi-client sync
   */
  updateFromData(data) {
    if (data.x !== undefined) this.x = data.x;
    if (data.y !== undefined) this.y = data.y;
    if (data.width !== undefined) this.width = data.width;
    if (data.height !== undefined) this.height = data.height;
    if (data.scale !== undefined) this.scale = data.scale;
    if (data.rotation !== undefined) this.rotation = data.rotation;
    if (data.frozen !== undefined) this.frozen = data.frozen;
    if (data.selected !== undefined) this.selected = data.selected;
    if (data.shapeType !== undefined) this.shapeType = data.shapeType;
    if (data.strokeColor !== undefined) this.strokeColor = data.strokeColor;
    if (data.strokeWidth !== undefined) this.strokeWidth = data.strokeWidth;
    if (data.fillColor !== undefined) this.fillColor = data.fillColor;
    if (data.fillOpacity !== undefined) this.fillOpacity = data.fillOpacity;
    if (data.points !== undefined) this.points = data.points;
    if (data.radiusX !== undefined) this.radiusX = data.radiusX;
    if (data.radiusY !== undefined) this.radiusY = data.radiusY;
    if (data.zIndexRank !== undefined) this.zIndexRank = data.zIndexRank;
    if (data.zIndex !== undefined) this.zIndex = data.zIndex;
    // Text properties
    if (data.text !== undefined) this.text = data.text;
    if (data.textColor !== undefined) this.textColor = data.textColor;
    if (data.textSize !== undefined) this.textSize = data.textSize;
    if (data.textAlign !== undefined) this.textAlign = data.textAlign;
    if (data.fontFamily !== undefined) this.fontFamily = data.fontFamily;
    if (data.fontWeight !== undefined) this.fontWeight = data.fontWeight;
    if (data.fontStyle !== undefined) this.fontStyle = data.fontStyle;
    // Shadow properties
    if (data.shadowColor !== undefined) this.shadowColor = data.shadowColor;
    if (data.shadowOpacity !== undefined) this.shadowOpacity = data.shadowOpacity;
    if (data.shadowOffsetX !== undefined) this.shadowOffsetX = data.shadowOffsetX;
    if (data.shadowOffsetY !== undefined) this.shadowOffsetY = data.shadowOffsetY;
  }

  /**
   * Apply scale transform to container (called by WBE scale gizmo)
   */
  applyScaleTransform(container, scale) {
    const rotation = this.rotation || 0;
    container.style.transform = `scale(${scale})${rotation ? ` rotate(${rotation}deg)` : ''}`;
    container.style.transformOrigin = 'center';
  }

  /**
   * Update DOM element from changes (called by WBE after registry update)
   * @param {HTMLElement} container - the container element
   * @param {Object} changes - changed properties
   */
  updateElement(container, changes) {
    if (!container) return;

    // Position
    if (!changes || 'x' in changes || 'y' in changes) {
      container.style.left = `${Math.round(this.x)}px`;
      container.style.top = `${Math.round(this.y)}px`;
    }

    // Scale and Rotation (combined)
    if (!changes || 'scale' in changes || 'rotation' in changes) {
      const scale = this.scale !== undefined ? this.scale : 1;
      const rotation = this.rotation || 0;
      container.style.transform = `scale(${scale})${rotation ? ` rotate(${rotation}deg)` : ''}`;
      container.style.transformOrigin = 'center';
    }

    // Size/style changes - re-render SVG
    if (!changes || 'strokeColor' in changes || 'strokeWidth' in changes ||
      'fillColor' in changes || 'fillOpacity' in changes || 'width' in changes || 'height' in changes) {
      this._updateSvgContent();
    }

    // Text changes
    if (!changes || 'text' in changes || 'textColor' in changes || 'textSize' in changes ||
      'textAlign' in changes || 'fontFamily' in changes || 'fontWeight' in changes || 'fontStyle' in changes) {
      this._updateTextElement(container);
    }

    // Shadow changes - update SVG filter
    if (!changes || 'shadowColor' in changes || 'shadowOpacity' in changes ||
      'shadowOffsetX' in changes || 'shadowOffsetY' in changes) {
      this._addShadowFilter();
      // Update filter attribute on shape element
      const shapeEl = this.svg?.querySelector('rect, ellipse, path');
      if (shapeEl) {
        if (this.shadowOpacity > 0) {
          shapeEl.setAttribute('filter', `url(#shadow-${this.id})`);
        } else {
          shapeEl.removeAttribute('filter');
        }
      }
    }

    // Selection is handled by WBE's _showSelectionOverlay() - no custom border needed

    // Frozen - show/hide unfreeze icon and deselect
    if (!changes || 'frozen' in changes) {
      container.style.pointerEvents = this.frozen ? 'none' : 'auto';
      if (this.frozen) {
        this._showUnfreezeIcon(container);
        // Deselect when frozen
        if (this.selected) {
          this.selected = false;
          // Hide selection border
          const border = container.querySelector('.wbe-shape-selection-border');
          if (border) border.style.display = 'none';
          // Tell WBE to deselect
          if (window.Whiteboard?.interaction?._deselect) {
            window.Whiteboard.interaction._deselect();
          }
        }
      } else {
        this._hideUnfreezeIcon(container);
      }
    }
  }

  /**
   * Show unfreeze icon on frozen shape (WBE style)
   * Uses wbe-unfreeze-icon class so WBE's UnfreezeIconHandler handles events
   */
  _showUnfreezeIcon(container) {
    if (!container || container.querySelector('.wbe-unfreeze-icon')) return;

    const iconSize = 12;
    const iconOffset = 8;
    // Compensate for container's transform: scale()
    const scale = this.scale || 1;
    const invScale = 1 / scale;

    const icon = document.createElement('div');
    icon.className = 'wbe-unfreeze-icon';
    icon.dataset.objectId = this.id; // For WBE handler to find the object
    icon.style.cssText = `
      position: absolute;
      left: -${iconOffset}px;
      top: -${iconOffset}px;
      width: ${iconSize}px;
      height: ${iconSize}px;
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
      transform: scale(${invScale});
      transform-origin: top left;
    `;

    // Create unlock icon (same as WBE images)
    const unlockIcon = document.createElement('i');
    unlockIcon.className = 'fas fa-unlock';
    unlockIcon.style.cssText = `color: #666666; font-size: ${iconSize * 0.67}px;`;
    icon.appendChild(unlockIcon);

    // Create progress ring (hidden initially)
    const progressRing = document.createElement('div');
    progressRing.className = 'wbe-unfreeze-progress';
    progressRing.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: ${iconSize * 1.25}px;
      height: ${iconSize * 1.25}px;
      transform: translate(-50%, -50%) rotate(-90deg);
      border: 3px solid transparent;
      border-top-color: #4a9eff;
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;
    icon.appendChild(progressRing);

    container.appendChild(icon);
    container._unfreezeIcon = icon;
  }

  /**
   * Hide unfreeze icon
   */
  _hideUnfreezeIcon(container) {
    const icon = container?.querySelector('.wbe-unfreeze-icon');
    if (icon) icon.remove();
    if (container) container._unfreezeIcon = null;
  }

  /**
   * Update text element styles and content
   */
  _updateTextElement(container) {
    if (this.shapeType === SHAPE_TYPES.FREEHAND) return;
    
    let textEl = container?.querySelector('.wbe-shape-text');
    
    // Create if doesn't exist
    if (!textEl && container) {
      this._createTextElement();
      textEl = this.textElement;
      if (textEl) container.appendChild(textEl);
    }
    
    if (!textEl) return;
    
    textEl.textContent = this.text;
    textEl.style.color = this.textColor;
    textEl.style.fontSize = `${this.textSize}px`;
    textEl.style.fontFamily = this.fontFamily;
    textEl.style.fontWeight = this.fontWeight;
    textEl.style.fontStyle = this.fontStyle;
    textEl.style.textAlign = this.textAlign;
    textEl.style.justifyContent = this.textAlign === 'left' ? 'flex-start' : this.textAlign === 'right' ? 'flex-end' : 'center';
  }

  /**
   * Enter text editing mode (double-click)
   */
  startEditing() {
    if (this.shapeType === SHAPE_TYPES.FREEHAND || this.isEditing) return;
    
    const textEl = this.element?.querySelector('.wbe-shape-text');
    if (!textEl) return;
    
    this.isEditing = true;
    textEl.contentEditable = 'true';
    textEl.style.pointerEvents = 'auto';
    textEl.style.userSelect = 'text';
    textEl.style.cursor = 'text';
    textEl.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    
    // Register this shape as being edited (for WBE to handle outside clicks)
    if (window.Whiteboard?.interaction) {
      window.Whiteboard.interaction._editingObject = this;
    }
    
    // Handle blur to finish editing
    textEl.addEventListener('blur', () => this.finishEditing(), { once: true });
  }

  /**
   * Finish text editing mode
   */
  finishEditing() {
    if (!this.isEditing) return;
    
    const textEl = this.element?.querySelector('.wbe-shape-text');
    if (!textEl) return;
    
    this.isEditing = false;
    textEl.contentEditable = 'false';
    textEl.style.pointerEvents = 'none';
    textEl.style.userSelect = 'none';
    textEl.style.cursor = '';
    
    // Clear editing object reference in WBE
    if (window.Whiteboard?.interaction?._editingObject === this) {
      window.Whiteboard.interaction._editingObject = null;
    }
    
    // Save text to registry
    const newText = textEl.textContent || '';
    if (newText !== this.text) {
      this.text = newText;
      if (window.Whiteboard?.registry) {
        window.Whiteboard.registry.update(this.id, { text: newText }, 'local');
      }
    }
  }

  _updateSvgContent() {
    if (!this.element || !this.svg) return;
    
    const width = this.width;
    const height = this.height;

    // Update container size (transform handles scale)
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;

    // Update SVG
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Re-create shape element
    this.svg.innerHTML = '';
    
    // Re-add shadow filter
    this._addShadowFilter();
    
    const shapeEl = this._createShapeElement();
    if (shapeEl) {
      // Apply shadow filter if needed
      if (this.shadowOpacity > 0) {
        shapeEl.setAttribute('filter', `url(#shadow-${this.id})`);
      }
      this.svg.appendChild(shapeEl);
    }
  }

  destroy() {
    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.svg = null;
  }
}

// ==========================================
// ShapePanel - uses WBE BasePanelView for consistent UI
// All controls come from BasePanelView API
// ==========================================

class ShapePanel {
  constructor(registry, layer) {
    this.registry = registry;
    this.layer = layer;
    this.shapeId = null;
    this.view = null;
    this._outsideClickHandler = null;
  }

  show(shapeId) {
    const obj = this.registry.get(shapeId);
    if (!obj || obj.type !== 'shape') return;

    this.hide();
    this.shapeId = shapeId;

    const container = this.layer?.getObjectContainer(shapeId);
    if (!container) return;

    this._createPanel(container, obj);
  }

  _createPanel(container, obj) {
    const BasePanelView = window.WBE_BasePanelView;
    if (!BasePanelView) {
      console.warn('[WBE-Shapes] BasePanelView not available');
      return;
    }

    this.view = new BasePanelView();
    this.view.createPanel();

    // Fill/Background (not for freehand) - same as Background in text panel
    if (obj.shapeType !== SHAPE_TYPES.FREEHAND) {
      const fillBtn = this.view.makeToolbarButton('Fill', 'fas fa-fill', () => {
        const current = this.registry.get(this.shapeId);
        const fillColor = current?.fillColor === 'transparent' ? '#ffffff' : (current?.fillColor || '#ffffff');
        const fillOpacity = current?.fillOpacity ?? 100;
        this.view.openBackgroundSubpanel(fillBtn, { color: fillColor, opacity: fillOpacity }, (color, opacity) => {
          this.registry.update(this.shapeId, { fillColor: color, fillOpacity: opacity }, 'local');
        });
      });
      this.view.toolbar.appendChild(fillBtn);

      // Text formatting button (uses BasePanelView.openTextSubpanel)
      const textBtn = this.view.makeToolbarButton('Text', 'fas fa-font', () => {
        const current = this.registry.get(this.shapeId);
        this.view.openTextSubpanel(textBtn, {
          textColor: current?.textColor || '#ffffff',
          textSize: current?.textSize || 16,
          textAlign: current?.textAlign || 'center',
          fontWeight: current?.fontWeight || 'normal',
          fontStyle: current?.fontStyle || 'normal'
        }, (changes) => {
          this.registry.update(this.shapeId, changes, 'local');
        });
      });
      this.view.toolbar.appendChild(textBtn);
    }

    // Border + Shadow (stroke color + width + shadow) - same as Border in image panels
    const borderBtn = this.view.makeToolbarButton('Border', 'fas fa-border-all', () => {
      const current = this.registry.get(this.shapeId);
      this.view.openBorderWithShadowSubpanel(borderBtn, {
        borderColor: current?.strokeColor,
        borderOpacity: 100,
        borderWidth: current?.strokeWidth,
        shadowColor: current?.shadowColor,
        shadowOpacity: current?.shadowOpacity,
        shadowOffsetX: current?.shadowOffsetX,
        shadowOffsetY: current?.shadowOffsetY
      }, (borderColor, borderOpacity, borderWidth, shadowColor, shadowOpacity, shadowOffsetX, shadowOffsetY) => {
        this.registry.update(this.shapeId, {
          strokeColor: borderColor,
          strokeWidth: borderWidth,
          shadowColor: shadowColor,
          shadowOpacity: shadowOpacity,
          shadowOffsetX: shadowOffsetX,
          shadowOffsetY: shadowOffsetY
        }, 'local');
      });
    });
    this.view.toolbar.appendChild(borderBtn);

    // Rotate - uses subpanel (same as text/image)
    const rotateBtn = this.view.makeToolbarButton('Rotate', 'fas fa-sync-alt', () => {
      const current = this.registry.get(this.shapeId);
      this.view.openRotationSubpanel(rotateBtn, current?.rotation || 0, (rotation) => {
        this.registry.update(this.shapeId, { rotation }, 'local');
      });
    });
    this.view.toolbar.appendChild(rotateBtn);

    // Lock toggle
    const lockBtn = this.view.makeLockButton(obj.frozen, (newFrozenState) => {
      this.registry.update(this.shapeId, { frozen: newFrozenState }, 'local');
      this.hide();
    });
    this.view.toolbar.appendChild(lockBtn);

    document.body.appendChild(this.view.panel);
    this.view.positionNear(container);

    // Close on outside click
    setTimeout(() => {
      this._outsideClickHandler = (e) => {
        if (!this.view?.isClickInside(e)) {
          this.hide();
        }
      };
      document.addEventListener('mousedown', this._outsideClickHandler);
    }, 100);
  }

  hide() {
    if (this._outsideClickHandler) {
      document.removeEventListener('mousedown', this._outsideClickHandler);
      this._outsideClickHandler = null;
    }
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    this.shapeId = null;
  }

  updatePosition() {
    if (!this.shapeId || !this.view?.panel) return;
    const container = this.layer?.getObjectContainer(this.shapeId);
    if (container) {
      this.view.positionNear(container);
    }
  }
}

// ==========================================
// Initialization
// ==========================================

const shapesManager = new ShapesManager();

if (typeof Hooks !== 'undefined') {
  // Register storage type EARLY (before WBE loads data in 'ready')
  Hooks.once('init', () => {
    if (window.Whiteboard?.registerStorageType) {
      window.Whiteboard.registerStorageType('shape', 'shapes');
      console.log(`[${MODULE_NAME}] Queued storage type 'shape' -> 'shapes'`);
    }
  });

  // Initialize manager after WBE is ready
  Hooks.once('ready', () => {
    setTimeout(() => shapesManager.init(), 200);
  });
} else {
  setTimeout(() => shapesManager.init(), 1000);
}

export { ShapesManager, ShapeView, ShapePanel, SHAPE_TYPES };
export default shapesManager;

window.WBE_Shapes = shapesManager;
