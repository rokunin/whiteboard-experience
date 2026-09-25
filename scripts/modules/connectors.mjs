/**
 * Connectors Module for Whiteboard Experience
 * 
 * Bezier curve connectors between objects on the whiteboard.
 * 
 * Architecture:
 * - ConnectorGeometry: pure functions for path/control-point calculation (xyflow-inspired)
 * - ConnectorView: entity registered via registerObjectType
 * - ConnectorsManager: tool controller (anchors, pending state, quick-options)
 * 
 * Prototype reference: bezier-proto.js (v0.4.3)
 */

// ============================================
// ConnectorGeometry — pure functions, no side effects
// Direct transfer from bezier-proto.js
// ============================================

/**
 * xyflow-inspired control offset calculation.
 * For positive distance: simple half-distance.
 * For negative distance (target behind source): sqrt-based curve.
 * 
 * @param {number} distance - Signed distance along axis
 * @param {number} curvature - Curvature factor (default 0.25, xyflow default)
 * @returns {number} Unsigned offset for control point
 */
/**
 * Mid-edge anchor points of an object element, in layer coordinates, as the user sees them.
 * WBE objects are positioned with style.left/top and transformed with an inline
 * `scale(...) rotate(...)` around their center, which does not change offsetWidth/Height,
 * so the transform has to be applied explicitly or connectors detach from rotated/scaled objects.
 *
 * @param {HTMLElement} el - Object container element
 * @returns {{top:{cx,cy}, right:{cx,cy}, bottom:{cx,cy}, left:{cx,cy}}}
 */
export function getVisualSideAnchors(el) {
  const x = parseFloat(el.style.left) || 0;
  const y = parseFloat(el.style.top) || 0;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const t = el.style.transform;
  let m = null;
  if (t && t !== 'none') {
    try { m = new DOMMatrix(t); } catch { m = null; }
  }
  const at = (dx, dy) => {
    if (!m || m.isIdentity) return { cx: cx + dx, cy: cy + dy };
    const p = m.transformPoint(new DOMPoint(dx, dy));
    return { cx: cx + p.x, cy: cy + p.y };
  };
  return {
    top: at(0, -h / 2),
    right: at(w / 2, 0),
    bottom: at(0, h / 2),
    left: at(-w / 2, 0),
  };
}

export function calcControlOffset(distance, curvature = 0.25) {
  if (distance >= 0) return 0.5 * distance;
  return curvature * 25 * Math.sqrt(-distance);
}

/**
 * Get control point position for a given side.
 * Control point extends outward from the anchor along the side's axis.
 * 
 * @param {'left'|'right'|'top'|'bottom'} side - Anchor side
 * @param {number} x1 - Anchor X
 * @param {number} y1 - Anchor Y
 * @param {number} x2 - Target X
 * @param {number} y2 - Target Y
 * @param {number} curvature - Curvature factor
 * @returns {[number, number]} [cx, cy] control point coordinates
 */
export function getControlPoint(side, x1, y1, x2, y2, curvature = 0.25) {
  switch (side) {
    case 'left':   return [x1 - calcControlOffset(x1 - x2, curvature), y1];
    case 'right':  return [x1 + calcControlOffset(x2 - x1, curvature), y1];
    case 'top':    return [x1, y1 - calcControlOffset(y1 - y2, curvature)];
    case 'bottom': return [x1, y1 + calcControlOffset(y2 - y1, curvature)];
  }
}

/**
 * xyflow cubic bezier t=0.5 midpoint formula.
 * M = 0.125*P0 + 0.375*CP1 + 0.375*CP2 + 0.125*P3
 * 
 * @returns {[number, number]} [midX, midY]
 */
export function getBezierMidpoint(sx, sy, scx, scy, tcx, tcy, tx, ty) {
  return [
    sx * 0.125 + scx * 0.375 + tcx * 0.375 + tx * 0.125,
    sy * 0.125 + scy * 0.375 + tcy * 0.375 + ty * 0.125
  ];
}

/**
 * Apply bend (perpendicular) and skew (parallel) offsets to base control points.
 * Extracted from proto.updateConnection() bend/skew logic.
 * 
 * @param {{cx: number, cy: number}} fromPos - Source anchor position
 * @param {{cx: number, cy: number}} toPos - Target anchor position
 * @param {number} scx - Base source control point X
 * @param {number} scy - Base source control point Y
 * @param {number} tcx - Base target control point X
 * @param {number} tcy - Base target control point Y
 * @param {number} bend - Perpendicular offset (positive = one side, negative = other)
 * @param {number} skew - Parallel offset (shifts curve peak along from→to line)
 * @returns {{scx: number, scy: number, tcx: number, tcy: number}} Final control points
 */
export function applyBendSkew(fromPos, toPos, scx, scy, tcx, tcy, bend, skew) {
  // Global from→to basis vectors
  const gDx = toPos.cx - fromPos.cx;
  const gDy = toPos.cy - fromPos.cy;
  const gLen = Math.sqrt(gDx * gDx + gDy * gDy) || 1;
  const gPx = -gDy / gLen;  // perpendicular
  const gPy = gDx / gLen;

  // Source CP natural direction (unit vector from anchor to its CP)
  const sDx = scx - fromPos.cx, sDy = scy - fromPos.cy;
  const sLen = Math.sqrt(sDx * sDx + sDy * sDy) || 1;
  const sNx = sDx / sLen, sNy = sDy / sLen;

  // Target CP natural direction (unit vector from anchor to its CP)
  const tDx = tcx - toPos.cx, tDy = tcy - toPos.cy;
  const tLen = Math.sqrt(tDx * tDx + tDy * tDy) || 1;
  const tNx = tDx / tLen, tNy = tDy / tLen;

  // Bend: push both CPs along SAME global perpendicular direction
  let fScx = scx + gPx * bend;
  let fScy = scy + gPy * bend;
  let fTcx = tcx + gPx * bend;
  let fTcy = tcy + gPy * bend;

  // Skew: extend source CP, shorten target CP along their natural axes
  fScx += sNx * skew;
  fScy += sNy * skew;
  fTcx -= tNx * skew;
  fTcy -= tNy * skew;

  return { scx: fScx, scy: fScy, tcx: fTcx, tcy: fTcy };
}

/**
 * Build complete SVG path data for a connector.
 * Combines getControlPoint + applyBendSkew + getBezierMidpoint.
 * 
 * @param {{cx: number, cy: number}} fromPos - Source anchor position
 * @param {{cx: number, cy: number}} toPos - Target anchor position
 * @param {'left'|'right'|'top'|'bottom'} fromSide - Source anchor side
 * @param {'left'|'right'|'top'|'bottom'} toSide - Target anchor side
 * @param {number} bend - Perpendicular offset
 * @param {number} skew - Parallel offset
 * @param {number} curvature - Curvature factor (default 0.25)
 * @returns {{d: string, midX: number, midY: number, arrowAngle: number}}
 */
export function buildConnectorPath(fromPos, toPos, fromSide, toSide, bend, skew, curvature = 0.25) {
  let [scx, scy] = getControlPoint(fromSide, fromPos.cx, fromPos.cy, toPos.cx, toPos.cy, curvature);
  let [tcx, tcy] = getControlPoint(toSide, toPos.cx, toPos.cy, fromPos.cx, fromPos.cy, curvature);

  if (bend !== 0 || skew !== 0) {
    ({ scx, scy, tcx, tcy } = applyBendSkew(fromPos, toPos, scx, scy, tcx, tcy, bend, skew));
  }

  const d = `M${fromPos.cx},${fromPos.cy} C${scx},${scy} ${tcx},${tcy} ${toPos.cx},${toPos.cy}`;
  const [midX, midY] = getBezierMidpoint(fromPos.cx, fromPos.cy, scx, scy, tcx, tcy, toPos.cx, toPos.cy);
  const arrowAngle = Math.atan2(toPos.cy - tcy, toPos.cx - tcx);

  return { d, midX, midY, arrowAngle };
}


// ============================================
// ConnectorView — Entity registered via registerObjectType
// ============================================

/**
 * ConnectorView represents a Bezier connector between two whiteboard objects.
 * Registered as object type 'connector' via Whiteboard.registerObjectType().
 * 
 * Data schema matches the spec: id, type, from, to, style, shape.
 */
export class ConnectorView {
  /**
   * @param {Object} data - Connector data (from schema or toJSON output)
   * @param {string} data.id - Unique connector ID
   * @param {Object} data.from - Source endpoint { objectId, side }
   * @param {Object} data.to - Target endpoint { objectId, side }
   * @param {Object} [data.style] - Visual style (strokeColor, strokeWidth, arrowEnd)
   * @param {Object} [data.shape] - Curve shape (bend, skew)
   */
  constructor(data) {
    this.id = data.id;
    this.type = 'connector';
    
    // Migration: support old format (sourceId/targetId) and new format (from/to)
    const fromObjectId = data.from?.objectId ?? data.sourceId;
    const fromSide = data.from?.side ?? data.sourceAnchor ?? 'right';
    const toObjectId = data.to?.objectId ?? data.targetId;
    const toSide = data.to?.side ?? data.targetAnchor ?? 'left';
    
    if (!fromObjectId || !toObjectId) {
      throw new Error(`Invalid connector data: missing endpoint IDs`);
    }
    
    this.from = { objectId: fromObjectId, side: fromSide };
    this.to = { objectId: toObjectId, side: toSide };
    this.style = {
      strokeColor: data.style?.strokeColor ?? data.strokeColor ?? '#4a9eff',
      strokeWidth: data.style?.strokeWidth ?? data.strokeWidth ?? 2,
      arrowEnd:    data.style?.arrowEnd ?? true
    };
    this.shape = {
      bend: data.shape?.bend ?? 0,
      skew: data.shape?.skew ?? 0
    };
    // Position at origin — connector uses SVG coordinates, not CSS left/top
    this.x = 0;
    this.y = 0;
  }

  /** @returns {'connector'} Serialization key for persistence adapter */
  getSerializationKey() {
    return 'connector';
  }

  /**
   * Serialize to plain object for persistence.
   * Returns a deep copy — mutating the result does not affect this instance.
   * @returns {Object} Plain data object matching the connector schema
   */
  toJSON() {
    return {
      id: this.id,
      type: 'connector',
      from: { objectId: this.from.objectId, side: this.from.side },
      to: { objectId: this.to.objectId, side: this.to.side },
      style: {
        strokeColor: this.style.strokeColor,
        strokeWidth: this.style.strokeWidth,
        arrowEnd: this.style.arrowEnd
      },
      shape: {
        bend: this.shape.bend,
        skew: this.shape.skew
      }
    };
  }

  /** No-op: connectors don't need click targets (hit-test via SVG path). */
  updateClickTarget(_container) {}

  /** Connectors are not hit-testable via bounding rect — interaction is via SVG path clicks. */
  getElementForHitTest(_layer) { return null; }

  /**
   * Create DOM element for this connector.
   * Container is a 0x0 div with overflow:visible, positioned at origin.
   * SVG inside holds path, arrow polygon, and midpoint handle circle.
   * @returns {HTMLElement} The connector container element
   */
  render() {
    const container = document.createElement('div');
    container.id = this.id;
    container.className = 'wbe-connector-container';
    container.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Use large fixed size instead of 100% (which would be 0 from 0x0 container)
    // overflow:visible ensures paths outside bounds are still rendered
    svg.style.cssText = 'position:absolute;top:0;left:0;width:10000px;height:10000px;overflow:visible;pointer-events:none;';

    // Curve path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', this.style.strokeColor);
    path.setAttribute('stroke-width', this.style.strokeWidth);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('pointer-events', 'stroke');
    path.dataset.connectorId = this.id;
    svg.appendChild(path);

    // Arrow head
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrow.setAttribute('fill', this.style.strokeColor);
    arrow.dataset.connectorId = this.id;
    if (!this.style.arrowEnd) arrow.style.display = 'none';
    svg.appendChild(arrow);

    // Midpoint handle
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('r', 3);
    handle.setAttribute('fill', '#fff');
    handle.setAttribute('stroke', '#4a9eff');
    handle.setAttribute('stroke-width', 1);
    handle.setAttribute('vector-effect', 'non-scaling-stroke');
    handle.style.cursor = 'grab';
    handle.style.pointerEvents = 'auto';
    handle.classList.add('bezier-interactive');
    handle.dataset.connectorHandle = 'true';
    handle.dataset.connectorId = this.id;
    svg.appendChild(handle);

    container.appendChild(svg);
    this.element = container;

    // Initial position update
    this._updateDOM();

    return container;
  }

  /**
   * Update connector when data changes (from registry update).
   * @param {Object} data - Full connector data
   * @param {Object} changes - Changed fields
   */
  update(data, changes) {
    if (changes?.style) {
      Object.assign(this.style, changes.style);
    }
    if (changes?.shape) {
      Object.assign(this.shape, changes.shape);
    }
    if (changes?.from) {
      Object.assign(this.from, changes.from);
    }
    if (changes?.to) {
      Object.assign(this.to, changes.to);
    }
    this._updateDOM();
  }

  /**
   * Update DOM elements based on current data.
   * Reads endpoint positions from DOM and recalculates path.
   */
  _updateDOM() {
    if (!this.element) return;

    const positions = this.getEndpointPositions();
    if (!positions) return;

    const { d, midX, midY, arrowAngle } = buildConnectorPath(
      positions.from, positions.to,
      this.from.side, this.to.side,
      this.shape.bend, this.shape.skew, 0.25
    );

    const svg = this.element.querySelector('svg');
    if (!svg) return;

    const path = svg.querySelector('path');
    if (path) {
      path.setAttribute('d', d);
      path.setAttribute('stroke', this.style.strokeColor);
      path.setAttribute('stroke-width', this.style.strokeWidth);
    }

    const arrow = svg.querySelector('polygon');
    if (arrow) {
      if (this.style.arrowEnd) {
        const aLen = 10, aSpread = 0.4;
        arrow.setAttribute('fill', this.style.strokeColor);
        arrow.setAttribute('points',
          `${positions.to.cx},${positions.to.cy} ` +
          `${positions.to.cx - aLen * Math.cos(arrowAngle - aSpread)},${positions.to.cy - aLen * Math.sin(arrowAngle - aSpread)} ` +
          `${positions.to.cx - aLen * Math.cos(arrowAngle + aSpread)},${positions.to.cy - aLen * Math.sin(arrowAngle + aSpread)}`
        );
        arrow.style.display = '';
      } else {
        arrow.style.display = 'none';
      }
    }

    const handle = svg.querySelector('circle[data-connector-handle]');
    if (handle) {
      handle.setAttribute('cx', midX);
      handle.setAttribute('cy', midY);
    }
  }

  /**
   * Get positions of endpoint anchors from DOM.
   * @returns {{ from: {cx, cy}, to: {cx, cy} } | null} null if endpoint deleted
   */
  getEndpointPositions() {
    const fromPos = this._getAnchorPos(this.from.objectId, this.from.side);
    const toPos = this._getAnchorPos(this.to.objectId, this.to.side);
    if (!fromPos || !toPos) return null;
    return { from: fromPos, to: toPos };
  }

  /**
   * Get mid-edge position for a given object and side.
   * @param {string} objId - Object element ID
   * @param {string} side - 'top' | 'right' | 'bottom' | 'left'
   * @returns {{cx: number, cy: number} | null}
   */
  _getAnchorPos(objId, side) {
    const el = document.getElementById(objId);
    if (!el) return null;
    return getVisualSideAnchors(el)[side] ?? null;
  }
}


// ============================================
// Theme config — sizes and colors
// ============================================

const CONNECTOR_THEME = {
  anchor: {
    radius: 3,
    radiusHover: 3,
    fill: 'rgba(30,30,30,0.6)',
    fillHover: 'rgba(74,158,255,0.4)',
    fillActive: '#4a9eff',
    stroke: '#4a9eff',
    strokeActive: '#fff',
    strokeWidth: 2,
  },
  handle: {
    radius: 3,
    radiusHover: 3,
    fill: '#fff',
    fillHover: 'rgba(74,158,255,0.3)',
    stroke: '#4a9eff',
    strokeWidth: 1,
  },
  arrow: {
    length: 10,
    spread: 0.4,
  },
  preview: {
    dashArray: '6 4',
  },
  objectBounds: {
    stroke: 'rgba(74,158,255,0.6)',
    strokeWidth: 1,
    dashArray: '4 3',
  },
  curvature: 0.25,
  thicknessPresets: [1, 2, 4, 8, 12],
};

const T = CONNECTOR_THEME;
const MODULE_NAME = 'WBE-Connectors';


// ============================================
// ConnectorsManager — tool controller
// ============================================

class ConnectorsManager {
  constructor() {
    this.enabled = false;
    this.pendingFrom = null;
    this.selectedConnectorId = null;
    this.lineStyle = { strokeColor: '#4a9eff', strokeWidth: 2 };
    this._rafId = null;
    this._draggingHandle = null;
    this.previewSvg = null;   // Preview path layer (below anchors so path does not steal clicks)
    this.anchorSvg = null;
    this.anchorElements = new Map();
    this.boundsElements = new Map();  // objId -> dashed rect (object bounds helper)
    this.previewPath = null;
    this._quickOptionsPanel = null;
    this._savedTooltip = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  // ==========================================
  // Initialization
  // ==========================================

  init(retryCount = 0) {
    if (!window.Whiteboard?.layer?.element) {
      if (retryCount < 10) {
        if (retryCount === 0) console.log(`[${MODULE_NAME}] Waiting for Whiteboard...`);
        setTimeout(() => this.init(retryCount + 1), 500);
      } else {
        console.log(`[${MODULE_NAME}] Whiteboard not available. Will init on canvasReady.`);
        Hooks.once('canvasReady', () => this.init(0));
      }
      return;
    }

    this.layer = window.Whiteboard.layer.element;

    // Register object type
    window.Whiteboard.registerObjectType('connector', {
      ViewClass: ConnectorView,
    });
    console.log(`[${MODULE_NAME}] Object type 'connector' registered`);

    // Register toolbar button
    this._addToolbarButton();

    // Subscribe to registry for live updates
    this._subscribeRegistry();

    // Keyboard listener for hotkey B
    window.addEventListener('keydown', this._onKeyDown);

    console.log(`[${MODULE_NAME}] Initialized`);
  }

  _addToolbarButton() {
    if (!window.WBEToolbar?.registerTool) {
      console.warn(`[${MODULE_NAME}] WBEToolbar not available, retrying...`);
      setTimeout(() => this._addToolbarButton(), 500);
      return;
    }

    window.WBEToolbar.registerTool({
      id: 'wbe-connector',
      title: 'Connector (B)',
      icon: 'fa-solid fa-bezier-curve',
      group: 'shapes',
      type: 'tool',
      onActivate: () => this.enableTool(),
      onDeactivate: () => this.disableTool(),
    });

    console.log(`[${MODULE_NAME}] Tool registered in WBE Toolbar`);
  }

  // ==========================================
  // Tool enable/disable
  // ==========================================

  enableTool() {
    this.enabled = true;
    // Clear selection so outline does not obscure anchor dots (same UX as shape tool)
    if (window.Whiteboard?.interaction?.selectedId) {
      window.Whiteboard.interaction._deselect();
    }
    if (window.Whiteboard?.interaction?.massSelection?.selectedIds?.size > 0) {
      window.Whiteboard.interaction.massSelection.clear();
    }
    this._createAnchorOverlay();
    this._updateAnchorPositions();
    this._showQuickOptions('wbe-connector');
    this._startRafLoop();

    window.addEventListener('mousemove', this._onMouseMove, true);
    window.addEventListener('mouseup', this._onMouseUp, true);

    console.log(`[${MODULE_NAME}] Tool enabled`);
  }

  disableTool() {
    this.enabled = false;
    this._hideQuickOptions();
    this._cancelPending();
    this.deselectConnector();
    // NOTE: Don't stop RAF loop here — _stopRafLoop checks if connectors exist
    // and keeps running if they do (so connectors follow objects)
    this._stopRafLoop();

    if (this.previewSvg) this.previewSvg.style.display = 'none';
    if (this.anchorSvg) this.anchorSvg.style.display = 'none';
    this._draggingHandle = null;

    window.removeEventListener('mousemove', this._onMouseMove, true);
    window.removeEventListener('mouseup', this._onMouseUp, true);

    console.log(`[${MODULE_NAME}] Tool disabled`);
  }

  // ==========================================
  // Quick Options Panel (color + thickness)
  // Reuses CSS classes from shapes: .wbe-quick-options, .wbe-qo-*
  // ==========================================

  _showQuickOptions(toolId) {
    this._hideQuickOptions();

    const btn = document.querySelector(`[data-tool-id="${toolId}"]`);
    if (!btn) return;

    // Suppress tooltip while panel is shown
    if (btn.dataset.tooltip) {
      this._savedTooltip = btn.dataset.tooltip;
      delete btn.dataset.tooltip;
    }

    const panel = document.createElement('div');
    panel.className = 'wbe-quick-options';
    panel.id = 'wbe-connector-quick-options';

    // Color swatch
    const colorSwatch = document.createElement('div');
    colorSwatch.className = 'wbe-qo-color';
    colorSwatch.style.backgroundColor = this.lineStyle.strokeColor;
    colorSwatch.title = 'Stroke color';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'wbe-qo-color-input';
    colorInput.value = this.lineStyle.strokeColor;

    colorSwatch.addEventListener('click', (e) => {
      e.stopPropagation();
      colorInput.click();
    });

    colorInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const color = e.target.value;
      colorSwatch.style.backgroundColor = color;
      this.lineStyle.strokeColor = color;
      this._syncPreviewStyle();
    });

    // Prevent panel clicks from triggering canvas
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.appendChild(colorSwatch);
    panel.appendChild(colorInput);

    // Separator
    const sep = document.createElement('div');
    sep.className = 'wbe-qo-sep';
    panel.appendChild(sep);

    // Thickness presets
    const thicknessRow = document.createElement('div');
    thicknessRow.className = 'wbe-qo-thickness-row';

    const currentWidth = this.lineStyle.strokeWidth;

    for (const value of T.thicknessPresets) {
      const dot = document.createElement('div');
      dot.className = 'wbe-qo-dot';
      if (value === currentWidth) dot.classList.add('active');
      const d = Math.max(4, Math.min(20, value + 3));
      dot.style.width = `${d}px`;
      dot.style.height = `${d}px`;
      dot.title = `${value}px`;

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        thicknessRow.querySelectorAll('.wbe-qo-dot').forEach(x => x.classList.remove('active'));
        dot.classList.add('active');
        const label = panel.querySelector('.wbe-qo-label');
        if (label) label.textContent = `${value}px`;
        this.lineStyle.strokeWidth = value;
        this._syncPreviewStyle();
      });

      thicknessRow.appendChild(dot);
    }

    panel.appendChild(thicknessRow);

    // Thickness label
    const label = document.createElement('span');
    label.className = 'wbe-qo-label';
    label.textContent = `${currentWidth}px`;
    panel.appendChild(label);

    btn.appendChild(panel);
    this._quickOptionsPanel = panel;
  }

  _hideQuickOptions() {
    if (this._savedTooltip && this._quickOptionsPanel) {
      const btn = this._quickOptionsPanel.parentElement;
      if (btn) btn.dataset.tooltip = this._savedTooltip;
    }
    this._savedTooltip = null;

    if (this._quickOptionsPanel) {
      this._quickOptionsPanel.remove();
      this._quickOptionsPanel = null;
    }
  }

  _syncPreviewStyle() {
    if (!this.previewPath) return;
    this.previewPath.setAttribute('stroke', this.lineStyle.strokeColor);
    this.previewPath.setAttribute('stroke-width', this.lineStyle.strokeWidth);
    this.previewPath.setAttribute('stroke-opacity', '0.45');
  }

  // ==========================================
  // Anchor overlay (SVG layer for anchor dots)
  // ==========================================

  _createAnchorOverlay() {
    if (this.anchorSvg) {
      this.anchorSvg.style.display = '';
      if (this.previewSvg) this.previewSvg.style.display = '';
      return;
    }

    const layer = document.getElementById('whiteboard-experience-layer');
    if (!layer) return;

    // Preview layer below anchors (same as bezier-proto: path must not compete for hit-test)
    this.previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.previewSvg.id = 'wbe-connector-preview';
    this.previewSvg.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:visible;';
    layer.appendChild(this.previewSvg);

    this.previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.previewPath.setAttribute('fill', 'none');
    this.previewPath.setAttribute('stroke', this.lineStyle.strokeColor);
    this.previewPath.setAttribute('stroke-width', this.lineStyle.strokeWidth);
    this.previewPath.setAttribute('stroke-dasharray', T.preview.dashArray);
    this.previewPath.setAttribute('stroke-opacity', '0.45');
    this.previewPath.setAttribute('vector-effect', 'non-scaling-stroke');
    this.previewPath.style.display = 'none';
    this.previewPath.style.pointerEvents = 'none';
    this.previewSvg.appendChild(this.previewPath);

    this.anchorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.anchorSvg.id = 'wbe-connector-anchors';
    this.anchorSvg.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100000;overflow:visible;';
    layer.appendChild(this.anchorSvg);
  }

  _ensureBoundsRect(objId) {
    if (this.boundsElements.has(objId)) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', T.objectBounds.stroke);
    rect.setAttribute('stroke-width', T.objectBounds.strokeWidth);
    rect.setAttribute('stroke-dasharray', T.objectBounds.dashArray);
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    rect.style.pointerEvents = 'none';
    this.anchorSvg.insertBefore(rect, this.anchorSvg.firstChild);
    this.boundsElements.set(objId, rect);
  }

  _ensureAnchors(objId) {
    if (this.anchorElements.has(objId)) return;
    const sides = ['top', 'right', 'bottom', 'left'];
    const map = {};
    for (const side of sides) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', T.anchor.radius);
      c.setAttribute('fill', T.anchor.fill);
      c.setAttribute('stroke', T.anchor.stroke);
      c.setAttribute('stroke-width', T.anchor.strokeWidth);
      c.setAttribute('vector-effect', 'non-scaling-stroke');
      c.style.cursor = 'pointer';
      c.style.pointerEvents = 'auto';
      c.dataset.objId = objId;
      c.dataset.side = side;
      c.classList.add('bezier-interactive');

      // Hover effects
      c.addEventListener('mouseenter', () => {
        c.setAttribute('fill', T.anchor.fillHover);
        c.setAttribute('r', T.anchor.radiusHover);
      });
      c.addEventListener('mouseleave', () => {
        if (!(this.pendingFrom?.objId === objId && this.pendingFrom?.side === side)) {
          c.setAttribute('fill', T.anchor.fill);
          c.setAttribute('r', T.anchor.radius);
        }
      });

      this.anchorSvg.appendChild(c);
      map[side] = c;
    }
    this.anchorElements.set(objId, map);
  }

  _getAnchors(objId) {
    const el = document.getElementById(objId);
    if (!el) return null;
    return getVisualSideAnchors(el);
  }

  _updateAnchorPositions() {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;
    const liveIds = new Set();

    for (const obj of registry.getAll()) {
      if (obj.type === 'connector') continue;
      liveIds.add(obj.id);
      this._ensureAnchors(obj.id);
      this._ensureBoundsRect(obj.id);
      const anchors = this._getAnchors(obj.id);
      if (!anchors) continue;
      const map = this.anchorElements.get(obj.id);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        map[side].setAttribute('cx', anchors[side].cx);
        map[side].setAttribute('cy', anchors[side].cy);
      }
      const el = document.getElementById(obj.id);
      const rect = this.boundsElements.get(obj.id);
      if (el && rect) {
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', el.offsetWidth);
        rect.setAttribute('height', el.offsetHeight);
      }
    }

    // Cleanup stale anchors
    for (const [objId, map] of this.anchorElements.entries()) {
      if (!liveIds.has(objId)) {
        for (const side of ['top', 'right', 'bottom', 'left']) {
          map[side].remove();
        }
        this.anchorElements.delete(objId);
      }
    }
    // Cleanup stale bounds
    for (const [objId, rect] of this.boundsElements.entries()) {
      if (!liveIds.has(objId)) {
        rect.remove();
        this.boundsElements.delete(objId);
      }
    }
  }

  // ==========================================
  // Connection creation (two-click state machine)
  // ==========================================

  onAnchorClick(objId, side) {
    if (this._draggingHandle) return;

    if (!this.pendingFrom) {
      // First click — select start anchor
      this.pendingFrom = { objId, side };
      const map = this.anchorElements.get(objId);
      if (map?.[side]) {
        map[side].setAttribute('fill', T.anchor.fillActive);
        map[side].setAttribute('stroke', T.anchor.strokeActive);
        map[side].setAttribute('r', T.anchor.radiusHover);
      }
    } else {
      // Second click
      if (this.pendingFrom.objId === objId) {
        // Same object — cancel
        this._cancelPending();
        return;
      }
      // Create connector via registry
      this._createConnector(this.pendingFrom.objId, this.pendingFrom.side, objId, side);
      this._resetAnchorStyle(this.pendingFrom.objId, this.pendingFrom.side);
      this.pendingFrom = null;
      if (this.previewPath) this.previewPath.style.display = 'none';
    }
  }

  _createConnector(fromObjId, fromSide, toObjId, toSide) {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;

    const id = `connector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const connectorData = {
      id,
      type: 'connector',
      from: { objectId: fromObjId, side: fromSide },
      to: { objectId: toObjId, side: toSide },
      style: {
        strokeColor: this.lineStyle.strokeColor,
        strokeWidth: this.lineStyle.strokeWidth,
        arrowEnd: true,
      },
      shape: { bend: 0, skew: 0 },
    };

    // Create ConnectorView instance (registry stores objects as-is,
    // _renderObject calls obj.render() so we need a real instance)
    const view = new ConnectorView(connectorData);
    registry.register(view, 'local');
    console.log(`[${MODULE_NAME}] Connector created: ${id}`);
  }

  cancelPending() {
    this._cancelPending();
  }

  _cancelPending() {
    if (this.pendingFrom) {
      this._resetAnchorStyle(this.pendingFrom.objId, this.pendingFrom.side);
      this.pendingFrom = null;
    }
    if (this.previewPath) this.previewPath.style.display = 'none';
  }

  _resetAnchorStyle(objId, side) {
    const map = this.anchorElements.get(objId);
    if (map?.[side]) {
      map[side].setAttribute('fill', T.anchor.fill);
      map[side].setAttribute('stroke', T.anchor.stroke);
      map[side].setAttribute('r', T.anchor.radius);
    }
  }

  // ==========================================
  // Connector selection / deletion
  // ==========================================

  selectConnector(connectorId) {
    // Deselect previous
    if (this.selectedConnectorId && this.selectedConnectorId !== connectorId) {
      this.deselectConnector();
    }

    this.selectedConnectorId = connectorId;

    // Visual feedback: add selection class to connector container
    const container = document.getElementById(connectorId);
    if (container) {
      const path = container.querySelector('path');
      if (path) {
        path.setAttribute('stroke-dasharray', '8 4');
        path.dataset.selected = 'true';
      }
    }
  }

  deselectConnector() {
    if (!this.selectedConnectorId) return;

    const container = document.getElementById(this.selectedConnectorId);
    if (container) {
      const path = container.querySelector('path');
      if (path) {
        path.removeAttribute('stroke-dasharray');
        delete path.dataset.selected;
      }
    }

    this.selectedConnectorId = null;
  }

  // ==========================================
  // Midpoint handle drag
  // ==========================================

  startMidpointDrag(connectorId) {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;

    const connData = registry.get(connectorId);
    if (!connData) return;

    this._draggingHandle = {
      connectorId,
      startBend: connData.shape?.bend ?? 0,
      startSkew: connData.shape?.skew ?? 0,
    };

    // Visual feedback
    const container = document.getElementById(connectorId);
    if (container) {
      const handle = container.querySelector('circle[data-connector-handle]');
      if (handle) handle.style.cursor = 'grabbing';
    }
  }

  // ==========================================
  // Mouse move / mouse up (preview + handle drag)
  // ==========================================

  _onMouseMove(e) {
    // Midpoint handle drag — decompose into bend (perp) + skew (parallel)
    if (this._draggingHandle) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const registry = window.Whiteboard?.interaction?.registry;
      if (!registry) return;

      const connData = registry.get(this._draggingHandle.connectorId);
      if (!connData) return;

      const world = this._getWorldCoords(e);

      // Get endpoint positions
      const fromEl = document.getElementById(connData.from.objectId);
      const toEl = document.getElementById(connData.to.objectId);
      if (!fromEl || !toEl) return;

      const fromAnchors = this._getAnchors(connData.from.objectId);
      const toAnchors = this._getAnchors(connData.to.objectId);
      if (!fromAnchors || !toAnchors) return;

      const from = fromAnchors[connData.from.side];
      const to = toAnchors[connData.to.side];

      // from->to line basis vectors
      const dx = to.cx - from.cx;
      const dy = to.cy - from.cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const parX = dx / len, parY = dy / len;
      const perpX = -parY, perpY = parX;

      // Midpoint of straight line
      const medX = (from.cx + to.cx) / 2;
      const medY = (from.cy + to.cy) / 2;

      // Vector from midpoint to mouse
      const toMx = world.x - medX;
      const toMy = world.y - medY;

      // Decompose into two axes
      const bend = toMx * perpX + toMy * perpY;
      const skew = toMx * parX + toMy * parY;

      // Live update the connector view (visual only, no registry update during drag)
      this._updateConnectorVisual(this._draggingHandle.connectorId, bend, skew);
      // Store current values for mouseup
      this._draggingHandle.currentBend = bend;
      this._draggingHandle.currentSkew = skew;
      return;
    }

    // Preview line (after first anchor click)
    if (!this.pendingFrom || !this.enabled) return;
    const anchors = this._getAnchors(this.pendingFrom.objId);
    if (!anchors) return;
    const from = anchors[this.pendingFrom.side];
    const world = this._getWorldCoords(e);
    const [scx, scy] = getControlPoint(this.pendingFrom.side, from.cx, from.cy, world.x, world.y);
    if (this.previewPath) {
      this.previewPath.setAttribute('d',
        `M${from.cx},${from.cy} C${scx},${scy} ${world.x},${world.y} ${world.x},${world.y}`
      );
      this.previewPath.style.display = '';
    }
  }

  _onMouseUp(_e) {
    if (this._draggingHandle) {
      const registry = window.Whiteboard?.interaction?.registry;
      if (registry && this._draggingHandle.currentBend !== undefined) {
        // Commit bend/skew to registry (triggers undo/redo capture)
        registry.update(this._draggingHandle.connectorId, {
          shape: {
            bend: this._draggingHandle.currentBend,
            skew: this._draggingHandle.currentSkew,
          }
        }, 'local');
      }

      // Reset handle visual
      const container = document.getElementById(this._draggingHandle.connectorId);
      if (container) {
        const handle = container.querySelector('circle[data-connector-handle]');
        if (handle) {
          handle.style.cursor = 'grab';
          handle.setAttribute('r', T.handle.radius);
          handle.setAttribute('fill', T.handle.fill);
        }
      }

      this._draggingHandle = null;
    }
  }

  // ==========================================
  // Visual update (during drag, no registry write)
  // ==========================================

  _updateConnectorVisual(connectorId, bend, skew) {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;

    const connData = registry.get(connectorId);
    if (!connData) return;

    const fromAnchors = this._getAnchors(connData.from.objectId);
    const toAnchors = this._getAnchors(connData.to.objectId);
    if (!fromAnchors || !toAnchors) return;

    const fromPos = fromAnchors[connData.from.side];
    const toPos = toAnchors[connData.to.side];

    const { d, midX, midY, arrowAngle } = buildConnectorPath(
      fromPos, toPos, connData.from.side, connData.to.side, bend, skew, T.curvature
    );

    const container = document.getElementById(connectorId);
    if (!container) return;

    const path = container.querySelector('path');
    if (path) path.setAttribute('d', d);

    const arrow = container.querySelector('polygon');
    if (arrow && connData.style?.arrowEnd !== false) {
      const aLen = T.arrow.length, aSpread = T.arrow.spread;
      arrow.setAttribute('points',
        `${toPos.cx},${toPos.cy} ` +
        `${toPos.cx - aLen * Math.cos(arrowAngle - aSpread)},${toPos.cy - aLen * Math.sin(arrowAngle - aSpread)} ` +
        `${toPos.cx - aLen * Math.cos(arrowAngle + aSpread)},${toPos.cy - aLen * Math.sin(arrowAngle + aSpread)}`
      );
    }

    const handle = container.querySelector('circle[data-connector-handle]');
    if (handle) {
      handle.setAttribute('cx', midX);
      handle.setAttribute('cy', midY);
    }
  }

  // ==========================================
  // RAF loop — smooth updates for anchors + connectors
  // Runs whenever tool is enabled OR connectors exist (like prototype)
  // ==========================================

  _startRafLoop() {
    if (this._rafId) return;
    const loop = () => {
      // Check if we should keep running:
      // - Tool is enabled (need to update anchor positions)
      // - OR connectors exist (need to follow object movement)
      const registry = window.Whiteboard?.interaction?.registry;
      const hasConnectors = registry?.getAll().some(o => o.type === 'connector') ?? false;
      
      if (!this.enabled && !hasConnectors) {
        this._rafId = null;
        return;
      }
      
      // Only update anchor overlay when tool is enabled
      if (this.enabled) {
        this._updateAnchorPositions();
      }
      
      // Always update connectors (they must follow objects even when tool disabled)
      this._updateAllConnectors();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopRafLoop() {
    // Don't actually stop if connectors exist — they need to keep updating
    const registry = window.Whiteboard?.interaction?.registry;
    const hasConnectors = registry?.getAll().some(o => o.type === 'connector') ?? false;
    
    if (hasConnectors) {
      // Keep running, just hide anchor overlay
      return;
    }
    
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
  
  /**
   * Ensure RAF loop is running (called when connectors are loaded from DB)
   */
  ensureRafLoop() {
    this._startRafLoop();
  }

  _updateAllConnectors() {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;

    for (const obj of registry.getAll()) {
      if (obj.type !== 'connector') continue;

      // Skip connector being dragged (visual update handled in _onMouseMove)
      if (this._draggingHandle?.connectorId === obj.id) continue;

      const fromAnchors = this._getAnchors(obj.from.objectId);
      const toAnchors = this._getAnchors(obj.to.objectId);

      if (!fromAnchors || !toAnchors) {
        // Dangling reference — endpoint deleted
        registry.unregister(obj.id, 'local');
        continue;
      }

      const fromPos = fromAnchors[obj.from.side];
      const toPos = toAnchors[obj.to.side];

      const { d, midX, midY, arrowAngle } = buildConnectorPath(
        fromPos, toPos, obj.from.side, obj.to.side,
        obj.shape?.bend ?? 0, obj.shape?.skew ?? 0, T.curvature
      );

      const container = document.getElementById(obj.id);
      if (!container) continue;

      const path = container.querySelector('path');
      if (path) path.setAttribute('d', d);

      const arrow = container.querySelector('polygon');
      if (arrow && obj.style?.arrowEnd !== false) {
        const aLen = T.arrow.length, aSpread = T.arrow.spread;
        arrow.setAttribute('points',
          `${toPos.cx},${toPos.cy} ` +
          `${toPos.cx - aLen * Math.cos(arrowAngle - aSpread)},${toPos.cy - aLen * Math.sin(arrowAngle - aSpread)} ` +
          `${toPos.cx - aLen * Math.cos(arrowAngle + aSpread)},${toPos.cy - aLen * Math.sin(arrowAngle + aSpread)}`
        );
      }

      const handle = container.querySelector('circle[data-connector-handle]');
      if (handle) {
        handle.setAttribute('cx', midX);
        handle.setAttribute('cy', midY);
      }
    }
  }

  // ==========================================
  // Registry subscription (live update + dangling reference)
  // ==========================================

  _subscribeRegistry() {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;

    registry.subscribe(({ id, type, changes, data }) => {
      // When a connector is registered (loaded from DB after a reload, received from another
      // client, or created locally), make sure the RAF loop runs. ObjectRegistry emits 'created'
      // with the object in `data`; listening for 'registered'/`object` left connectors frozen.
      if (type === 'created' && data?.type === 'connector') {
        this._startRafLoop();
      }
      
      // Update connectors when endpoint objects move
      if (type === 'updated' && (changes?.x !== undefined || changes?.y !== undefined)) {
        this._updateConnectorsForEndpoint(id);
      }

      // Remove connectors when endpoint object is deleted
      if (type === 'deleted') {
        this._removeConnectorsForEndpoint(id);
      }
    });
    
    // Check if connectors already exist (loaded before subscription)
    const hasConnectors = registry.getAll().some(o => o.type === 'connector');
    if (hasConnectors) {
      this._startRafLoop();
    }
  }

  _updateConnectorsForEndpoint(endpointId) {
    // Visual update happens in RAF loop, no action needed here
    // The RAF loop already reads live positions from DOM
  }

  _removeConnectorsForEndpoint(endpointId) {
    const registry = window.Whiteboard?.interaction?.registry;
    if (!registry) return;

    for (const obj of registry.getAll()) {
      if (obj.type !== 'connector') continue;
      if (obj.from.objectId === endpointId || obj.to.objectId === endpointId) {
        registry.unregister(obj.id, 'local');
      }
    }
  }

  // ==========================================
  // Keyboard handler (hotkey B + Delete)
  // ==========================================

  _onKeyDown(e) {
    // Guard: don't fire during text editing
    if (this._isInputFocused()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Guard: don't fire with open Foundry windows
    if (document.querySelector('.app.window-app:not([style*="display: none"])')) return;

    // Delete selected connector
    if (e.key === 'Delete' && this.selectedConnectorId) {
      const registry = window.Whiteboard?.interaction?.registry;
      if (registry) {
        registry.unregister(this.selectedConnectorId, 'local');
      }
      this.selectedConnectorId = null;
      e.preventDefault();
      return;
    }

    // Hotkey B — toggle connector tool
    if (e.code === 'KeyB') {
      e.preventDefault();
      if (this.enabled) {
        window.WBEToolbar?.deactivateAllTools?.();
      } else {
        window.WBEToolbar?.activateTool?.('wbe-connector');
      }
    }
  }

  _isInputFocused() {
    const active = document.activeElement;
    return active?.tagName === 'INPUT' ||
      active?.tagName === 'TEXTAREA' ||
      active?.isContentEditable;
  }

  // ==========================================
  // Coordinate conversion
  // ==========================================

  _getWorldCoords(e) {
    const t = canvas.stage.worldTransform;
    const det = t.a * t.d - t.b * t.c;
    return {
      x: (t.d * (e.clientX - t.tx) - t.c * (e.clientY - t.ty)) / det,
      y: (t.a * (e.clientY - t.ty) - t.b * (e.clientX - t.tx)) / det
    };
  }
}


// ============================================
// Module initialization
// ============================================

const connectorsManager = new ConnectorsManager();

if (typeof Hooks !== 'undefined') {
  // Register storage type EARLY (before WBE loads data in 'ready')
  Hooks.once('init', () => {
    if (window.Whiteboard?.registerStorageType) {
      window.Whiteboard.registerStorageType('connector', 'connectors');
      console.log(`[${MODULE_NAME}] Queued storage type 'connector' -> 'connectors'`);
    }
  });

  // Initialize manager after WBE is ready
  Hooks.once('ready', () => {
    setTimeout(() => connectorsManager.init(), 200);
  });
} else if (typeof window !== 'undefined') {
  setTimeout(() => connectorsManager.init(), 1000);
}

export { ConnectorsManager, CONNECTOR_THEME };
export default connectorsManager;

if (typeof window !== 'undefined') {
  window.WBE_Connectors = connectorsManager;
}
