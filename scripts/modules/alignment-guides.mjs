/**
 * Alignment Guides Module for Whiteboard Experience
 * 
 * Показывает линии-подсказки при перетаскивании объектов,
 * как в Miro/Figma. Линии показывают совпадение границ и центров объектов.
 * 
 * Работает автоматически при любом перетаскивании:
 * - Показывает направляющие при приближении на 8px (GUIDE_THRESHOLD)
 * - Snap срабатывает при приближении на 2px (SNAP_THRESHOLD)
 * 
 * Архитектура:
 * - Полностью автономный модуль
 * - Подключается к WBE через window.Whiteboard API
 * - Перехватывает mousemove события самостоятельно
 * - НЕ требует изменений в main.mjs
 */

const GUIDE_COLOR = '#ff00ff';  // Magenta - хорошо видно на любом фоне
const SPACING_COLOR = '#00d4ff'; // Cyan для spacing guides
const GUIDE_WIDTH = 1;
const SNAP_THRESHOLD = 2;  // Порог срабатывания snap
const GUIDE_THRESHOLD = 2; // Порог показа линий (без snap)
const SPACING_THRESHOLD = 2;

/**
 * AlignmentGuides - менеджер линий выравнивания
 */
class AlignmentGuides {
  constructor() {
    this.svg = null;
    this.layer = null;
    this.enabled = true;
    this._boundMouseMove = null;
    this._boundMouseUp = null;
  }

  /**
   * Инициализация - подключение к WBE
   */
  init(retryCount = 0) {
    // Ждём пока WBE инициализируется
    if (!window.Whiteboard?.layer?.element) {
      // Limit retries to avoid console spam when no scene is active
      if (retryCount < 10) {
        if (retryCount === 0) {
          console.log('[AlignmentGuides] Waiting for Whiteboard...');
        }
        setTimeout(() => this.init(retryCount + 1), 500);
      } else {
        console.log('[AlignmentGuides] Whiteboard not available (no active scene?). Will init on canvasReady.');
        // Register canvasReady hook to init when scene becomes active
        Hooks.once('canvasReady', () => this.init(0));
      }
      return;
    }

    this.layer = window.Whiteboard.layer.element;
    
    // Создаём SVG контейнер для линий
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.id = 'wbe-alignment-guides';
    this.svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 99999;
      overflow: visible;
    `;
    this.layer.appendChild(this.svg);

    // Подписываемся на события
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    window.addEventListener('mousemove', this._boundMouseMove, true);
    window.addEventListener('mouseup', this._boundMouseUp, true);

    console.log('[AlignmentGuides] Initialized');
  }

  /**
   * Обработчик mousemove - проверяем drag состояние WBE
   */
  _onMouseMove(e) {
    if (!this.enabled) return;
    
    if (!window.Whiteboard?.interaction) return;

    const interaction = window.Whiteboard.interaction;
    const massSelection = interaction.massSelection;
    
    // Check for mass selection drag first
    if (massSelection?.isDragging) {
      this._handleMassDrag(e, massSelection);
      return;
    }

    // Handle stretch resize - show guides and apply snap
    const stretchState = interaction.stretchResizeState;
    if (stretchState) {
      this._handleStretchResize(e, stretchState, interaction);
      return;
    }

    const dragState = interaction.dragState;

    // Если нет активного drag - очищаем
    if (!dragState) {
      this.clear();
      return;
    }

    // Получаем текущую позицию из dragState
    const currentX = dragState.currentX ?? dragState.objStartX;
    const currentY = dragState.currentY ?? dragState.objStartY;

    // Обновляем guides и получаем snap offsets
    const snap = this._updateGuides(dragState.id, currentX, currentY);
    
    // Применяем snap если есть
    if (snap.x !== 0 || snap.y !== 0) {
      const snappedX = currentX + snap.x;
      const snappedY = currentY + snap.y;
      
      // Обновляем dragState
      dragState.currentX = snappedX;
      dragState.currentY = snappedY;
      
      // Обновляем DOM напрямую
      window.Whiteboard.layer?._updateDOMDuringDrag(dragState.id, snappedX, snappedY);
      window.Whiteboard.layer?.updateSelectionOverlay();
    }
  }

  /**
   * Handle mass selection drag with alignment guides
   * Uses bounding box of all selected objects as a single unit
   */
  _handleMassDrag(e, massSelection) {
    if (!massSelection.selectedIds || massSelection.selectedIds.size === 0) {
      this.clear();
      return;
    }

    // Calculate current group bounds
    const groupBounds = this._getMassSelectionBounds(massSelection);
    if (!groupBounds) {
      this.clear();
      return;
    }

    // Get snap offsets for the group
    const snap = this._updateGuidesForGroup(groupBounds, massSelection.selectedIds);

    // Apply snap if found
    if (snap.x !== 0 || snap.y !== 0) {
      // Store snap offset in massSelection for use in updateMassDrag
      // This allows the main drag logic to apply the snap
      if (!massSelection._snapOffset) {
        massSelection._snapOffset = { x: 0, y: 0 };
      }
      massSelection._snapOffset.x = snap.x;
      massSelection._snapOffset.y = snap.y;

      // Update all objects by the snap offset
      for (const id of massSelection.selectedIds) {
        const obj = window.Whiteboard?.registry?.get(id);
        if (!obj) continue;

        // Get current position from object (not container, to handle crop offset correctly)
        const container = this.layer?.querySelector(`#${id}`);
        if (!container) continue;

        // For images with crop, container position includes crop offset
        // We need to calculate the snapped obj.x/y position
        let currentObjX, currentObjY;
        
        if (obj.type === 'image' && obj.crop) {
          // For cropped images, reverse-calculate obj position from container
          const imageElement = container.querySelector('.wbe-canvas-image');
          if (imageElement) {
            const dims = window.Whiteboard.layer?._calculateImageVisibleDimensions(imageElement, id);
            if (dims) {
              const containerX = parseFloat(container.style.left) || 0;
              const containerY = parseFloat(container.style.top) || 0;
              currentObjX = containerX - (dims.left || 0);
              currentObjY = containerY - (dims.top || 0);
            } else {
              currentObjX = parseFloat(container.style.left) || 0;
              currentObjY = parseFloat(container.style.top) || 0;
            }
          } else {
            currentObjX = parseFloat(container.style.left) || 0;
            currentObjY = parseFloat(container.style.top) || 0;
          }
        } else {
          currentObjX = parseFloat(container.style.left) || 0;
          currentObjY = parseFloat(container.style.top) || 0;
        }

        // Apply snap offset
        const snappedX = currentObjX + snap.x;
        const snappedY = currentObjY + snap.y;

        // Update DOM using layer method (handles crop offset correctly)
        window.Whiteboard.layer?._updateDOMDuringDrag(id, snappedX, snappedY);
      }

      // Update bounding box
      massSelection._updateBoundingBox();
    } else {
      // Clear snap offset when no snap
      if (massSelection._snapOffset) {
        massSelection._snapOffset.x = 0;
        massSelection._snapOffset.y = 0;
      }
    }
  }

  /**
   * Handle stretch resize with alignment guides
   * Shows guides and applies snap when resizing object edges
   * @param {MouseEvent} e - Mouse event
   * @param {Object} stretchState - Stretch resize state from InteractionManager
   * @param {Object} interaction - InteractionManager reference
   */
  _handleStretchResize(e, stretchState, _interaction) {
    this.clear();

    const { id, direction } = stretchState;
    const obj = window.Whiteboard?.registry?.get(id);
    if (!obj) return;

    // Get current visual bounds of the object (already reflects current DOM state)
    const currentBounds = this._getObjectBounds(obj);
    if (!currentBounds) return;

    // The active edge is the one being resized - its current position is what we snap
    let activeEdge;
    let currentEdgePosition;
    
    switch (direction) {
      case 'right':
        activeEdge = 'right';
        currentEdgePosition = currentBounds.right;
        break;
      case 'left':
        activeEdge = 'left';
        currentEdgePosition = currentBounds.left;
        break;
      case 'bottom':
        activeEdge = 'bottom';
        currentEdgePosition = currentBounds.bottom;
        break;
      case 'top':
        activeEdge = 'top';
        currentEdgePosition = currentBounds.top;
        break;
      default:
        return;
    }

    // Find snap targets for the active edge
    const snap = this._findSnapForEdge(id, activeEdge, currentEdgePosition, currentBounds);
    
    // Draw guides
    this._drawGuides(snap.verticalGuides, snap.horizontalGuides);

    // Apply snap offset to stretchResizeState if found
    if (snap.offset !== 0) {
      // Store snap in stretchState for _updateStretchResize to use
      stretchState._snapOffset = snap.offset;
      stretchState._snapDirection = direction;
    } else {
      stretchState._snapOffset = 0;
      stretchState._snapDirection = null;
    }
  }

  /**
   * Find snap targets for a specific edge during resize
   * @param {string} objId - ID of object being resized
   * @param {string} edge - Which edge: 'left', 'right', 'top', 'bottom'
   * @param {number} newPosition - Where the edge will be
   * @param {Object} currentBounds - Current bounds of the object
   * @returns {{ offset: number, verticalGuides: Array, horizontalGuides: Array }}
   */
  _findSnapForEdge(objId, edge, newPosition, currentBounds) {
    const result = { offset: 0, verticalGuides: [], horizontalGuides: [] };
    
    if (!window.Whiteboard?.registry) return result;

    const allObjects = window.Whiteboard.registry.getAll();
    const isVerticalEdge = (edge === 'left' || edge === 'right');
    
    let bestSnap = null;

    for (const obj of allObjects) {
      if (obj.id === objId || obj.frozen) continue;

      const bounds = this._getObjectBounds(obj);
      if (!bounds) continue;

      // Check alignment with target object edges
      const targetEdges = isVerticalEdge 
        ? [bounds.left, bounds.right, bounds.centerX]
        : [bounds.top, bounds.bottom, bounds.centerY];

      for (const targetPos of targetEdges) {
        const dist = Math.abs(newPosition - targetPos);
        
        if (dist <= GUIDE_THRESHOLD) {
          // Found alignment!
          const snapOffset = targetPos - newPosition;
          
          if (!bestSnap || dist < bestSnap.dist) {
            bestSnap = { 
              dist, 
              offset: dist <= SNAP_THRESHOLD ? snapOffset : 0,
              targetPos
            };
          }

          // Add guide line
          if (isVerticalEdge) {
            result.verticalGuides.push({
              x: targetPos,
              minY: Math.min(currentBounds.top, bounds.top) - 20,
              maxY: Math.max(currentBounds.bottom, bounds.bottom) + 20
            });
          } else {
            result.horizontalGuides.push({
              y: targetPos,
              minX: Math.min(currentBounds.left, bounds.left) - 20,
              maxX: Math.max(currentBounds.right, bounds.right) + 20
            });
          }
        }
      }
    }

    if (bestSnap) {
      result.offset = bestSnap.offset;
    }

    return result;
  }

  /**
   * Get bounding box of all mass-selected objects
   */
  _getMassSelectionBounds(massSelection) {
    if (!massSelection.selectedIds || massSelection.selectedIds.size === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const id of massSelection.selectedIds) {
      const obj = window.Whiteboard?.registry?.get(id);
      if (!obj) continue;

      const bounds = this._getObjectBounds(obj);
      if (!bounds) continue;

      minX = Math.min(minX, bounds.left);
      minY = Math.min(minY, bounds.top);
      maxX = Math.max(maxX, bounds.right);
      maxY = Math.max(maxY, bounds.bottom);
    }

    if (minX === Infinity) return null;

    return {
      left: minX,
      right: maxX,
      top: minY,
      bottom: maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  /**
   * Update guides for a group of objects (mass selection)
   * Treats the group bounding box as a single object for alignment
   * 
   * Оптимизации (как в Figma/Miro):
   * - Проверяем только 5 пар: center↔center, left↔left, right↔right
   * - Показываем только ближайшую линию каждого типа
   * - Максимум 2 линии на ось
   */
  _updateGuidesForGroup(groupBounds, selectedIds) {
    this.clear();

    if (!window.Whiteboard?.registry) return { x: 0, y: 0 };

    const allObjects = window.Whiteboard.registry.getAll();
    
    // Кандидаты по типам (храним только лучшего для каждого типа)
    const xCandidates = { 
      center: null, left: null, right: null,
      leftRight: null, rightLeft: null 
    };
    const yCandidates = { 
      center: null, top: null, bottom: null,
      topBottom: null, bottomTop: null 
    };

    // Check alignment against non-selected objects
    for (const obj of allObjects) {
      if (selectedIds.has(obj.id) || obj.frozen) continue;

      const bounds = this._getObjectBounds(obj);
      if (!bounds) continue;

      // === X axis (vertical guides) ===
      const xChecks = [
        { type: 'center', dv: groupBounds.centerX, tv: bounds.centerX },
        { type: 'left', dv: groupBounds.left, tv: bounds.left },
        { type: 'right', dv: groupBounds.right, tv: bounds.right },
        { type: 'leftRight', dv: groupBounds.left, tv: bounds.right },
        { type: 'rightLeft', dv: groupBounds.right, tv: bounds.left },
      ];
      
      for (const { type, dv, tv } of xChecks) {
        const dist = Math.abs(dv - tv);
        if (dist <= GUIDE_THRESHOLD) {
          if (!xCandidates[type] || dist < xCandidates[type].dist) {
            xCandidates[type] = {
              guide: {
                x: tv,
                minY: Math.min(groupBounds.top, bounds.top) - 20,
                maxY: Math.max(groupBounds.bottom, bounds.bottom) + 20
              },
              dist,
              offset: tv - dv
            };
          }
        }
      }

      // === Y axis (horizontal guides) ===
      const yChecks = [
        { type: 'center', dv: groupBounds.centerY, tv: bounds.centerY },
        { type: 'top', dv: groupBounds.top, tv: bounds.top },
        { type: 'bottom', dv: groupBounds.bottom, tv: bounds.bottom },
        { type: 'topBottom', dv: groupBounds.top, tv: bounds.bottom },
        { type: 'bottomTop', dv: groupBounds.bottom, tv: bounds.top },
      ];
      
      for (const { type, dv, tv } of yChecks) {
        const dist = Math.abs(dv - tv);
        if (dist <= GUIDE_THRESHOLD) {
          if (!yCandidates[type] || dist < yCandidates[type].dist) {
            yCandidates[type] = {
              guide: {
                y: tv,
                minX: Math.min(groupBounds.left, bounds.left) - 20,
                maxX: Math.max(groupBounds.right, bounds.right) + 20
              },
              dist,
              offset: tv - dv
            };
          }
        }
      }
    }

    // Собираем guides с лимитом (макс 2 на ось)
    const verticalGuides = [];
    const horizontalGuides = [];
    let bestSnapX = null;
    let bestSnapY = null;

    // X axis
    if (xCandidates.center) {
      verticalGuides.push(xCandidates.center.guide);
      if (xCandidates.center.dist <= SNAP_THRESHOLD) {
        bestSnapX = { offset: xCandidates.center.offset, distance: xCandidates.center.dist };
      }
    }
    const bestXEdge = this._pickBestFromMany([
      xCandidates.left, xCandidates.right,
      xCandidates.leftRight, xCandidates.rightLeft
    ]);
    if (bestXEdge) {
      verticalGuides.push(bestXEdge.guide);
      if (bestXEdge.dist <= SNAP_THRESHOLD && (!bestSnapX || bestXEdge.dist < bestSnapX.distance)) {
        bestSnapX = { offset: bestXEdge.offset, distance: bestXEdge.dist };
      }
    }

    // Y axis
    if (yCandidates.center) {
      horizontalGuides.push(yCandidates.center.guide);
      if (yCandidates.center.dist <= SNAP_THRESHOLD) {
        bestSnapY = { offset: yCandidates.center.offset, distance: yCandidates.center.dist };
      }
    }
    const bestYEdge = this._pickBestFromMany([
      yCandidates.top, yCandidates.bottom,
      yCandidates.topBottom, yCandidates.bottomTop
    ]);
    if (bestYEdge) {
      horizontalGuides.push(bestYEdge.guide);
      if (bestYEdge.dist <= SNAP_THRESHOLD && (!bestSnapY || bestYEdge.dist < bestSnapY.distance)) {
        bestSnapY = { offset: bestYEdge.offset, distance: bestYEdge.dist };
      }
    }

    // Equal spacing for group
    const otherBounds = allObjects
      .filter(o => !selectedIds.has(o.id) && !o.frozen)
      .map(o => this._getObjectBounds(o))
      .filter(b => b !== null);
    
    const spacingGuides = this._findEqualSpacing(groupBounds, otherBounds);
    
    if (spacingGuides.snapX !== null && (!bestSnapX || spacingGuides.snapX.distance < bestSnapX.distance)) {
      bestSnapX = spacingGuides.snapX;
    }
    if (spacingGuides.snapY !== null && (!bestSnapY || spacingGuides.snapY.distance < bestSnapY.distance)) {
      bestSnapY = spacingGuides.snapY;
    }

    this._drawGuides(verticalGuides, horizontalGuides);
    this._drawSpacingGuides(spacingGuides.horizontal, spacingGuides.vertical);
    
    return {
      x: Math.round(bestSnapX?.offset ?? 0),
      y: Math.round(bestSnapY?.offset ?? 0)
    };
  }

  /**
   * Обработчик mouseup - очищаем линии
   */
  _onMouseUp() {
    this.clear();
  }

  /**
   * Обновить guides и вернуть snap offsets
   * 
   * Оптимизации (как в Figma/Miro):
   * - Проверяем только 5 пар: center↔center, left↔left, right↔right (без cross-alignment)
   * - Показываем только ближайшую линию каждого типа
   * - Максимум 2 линии на ось (center + edge)
   * - Приоритет: center > edge
   * 
   * @returns {{ x: number, y: number }} Смещение для snap (0 если нет snap)
   */
  _updateGuides(draggedId, currentX, currentY) {
    this.clear();

    if (!window.Whiteboard?.registry) return { x: 0, y: 0 };

    const allObjects = window.Whiteboard.registry.getAll();
    const draggedObj = allObjects.find(o => o.id === draggedId);
    if (!draggedObj) return { x: 0, y: 0 };

    // Вычисляем bounds драгаемого объекта на основе currentX/Y (не из DOM!)
    const draggedBounds = this._getDraggedBounds(draggedObj, currentX, currentY);
    if (!draggedBounds) return { x: 0, y: 0 };

    // Кандидаты по типам (храним только лучшего для каждого типа)
    // X axis (vertical guides)
    const xCandidates = {
      center: null,  // { guide, dist, offset }
      left: null,
      right: null,
      leftRight: null,  // cross-alignment для стыковки (left↔right)
      rightLeft: null   // cross-alignment для стыковки (right↔left)
    };
    // Y axis (horizontal guides)  
    const yCandidates = {
      center: null,
      top: null,
      bottom: null,
      topBottom: null,  // cross-alignment для стыковки (top↔bottom)
      bottomTop: null   // cross-alignment для стыковки (bottom↔top)
    };

    // Проверяем каждый другой объект
    for (const obj of allObjects) {
      if (obj.id === draggedId || obj.frozen) continue;

      const bounds = this._getObjectBounds(obj);
      if (!bounds) continue;

      // === X axis (vertical guides) ===
      // 5 пар: center↔center, left↔left, right↔right + cross для стыковки
      const xChecks = [
        { type: 'center', dv: draggedBounds.centerX, tv: bounds.centerX },
        { type: 'left', dv: draggedBounds.left, tv: bounds.left },
        { type: 'right', dv: draggedBounds.right, tv: bounds.right },
        { type: 'leftRight', dv: draggedBounds.left, tv: bounds.right },   // стыковка: мой левый к его правому
        { type: 'rightLeft', dv: draggedBounds.right, tv: bounds.left },   // стыковка: мой правый к его левому
      ];
      
      for (const { type, dv, tv } of xChecks) {
        const dist = Math.abs(dv - tv);
        if (dist <= GUIDE_THRESHOLD) {
          // Проверяем, лучше ли этот кандидат текущего
          if (!xCandidates[type] || dist < xCandidates[type].dist) {
            xCandidates[type] = {
              guide: {
                x: tv,
                minY: Math.min(draggedBounds.top, bounds.top) - 20,
                maxY: Math.max(draggedBounds.bottom, bounds.bottom) + 20
              },
              dist,
              offset: tv - dv
            };
          }
        }
      }

      // === Y axis (horizontal guides) ===
      // 5 пар: center↔center, top↔top, bottom↔bottom + cross для стыковки
      const yChecks = [
        { type: 'center', dv: draggedBounds.centerY, tv: bounds.centerY },
        { type: 'top', dv: draggedBounds.top, tv: bounds.top },
        { type: 'bottom', dv: draggedBounds.bottom, tv: bounds.bottom },
        { type: 'topBottom', dv: draggedBounds.top, tv: bounds.bottom },   // стыковка: мой верх к его низу
        { type: 'bottomTop', dv: draggedBounds.bottom, tv: bounds.top },   // стыковка: мой низ к его верху
      ];
      
      for (const { type, dv, tv } of yChecks) {
        const dist = Math.abs(dv - tv);
        if (dist <= GUIDE_THRESHOLD) {
          if (!yCandidates[type] || dist < yCandidates[type].dist) {
            yCandidates[type] = {
              guide: {
                y: tv,
                minX: Math.min(draggedBounds.left, bounds.left) - 20,
                maxX: Math.max(draggedBounds.right, bounds.right) + 20
              },
              dist,
              offset: tv - dv
            };
          }
        }
      }
    }

    // Собираем guides с лимитом (макс 2 на ось: center + лучший edge)
    const verticalGuides = [];
    const horizontalGuides = [];
    let bestSnapX = null;
    let bestSnapY = null;

    // X axis: приоритет center, затем лучший из edges (включая cross-alignment)
    if (xCandidates.center) {
      verticalGuides.push(xCandidates.center.guide);
      if (xCandidates.center.dist <= SNAP_THRESHOLD) {
        bestSnapX = { offset: xCandidates.center.offset, distance: xCandidates.center.dist };
      }
    }
    // Добавляем лучший edge (left, right, или cross-alignment), но только один
    const bestXEdge = this._pickBestFromMany([
      xCandidates.left, 
      xCandidates.right,
      xCandidates.leftRight,
      xCandidates.rightLeft
    ]);
    if (bestXEdge) {
      verticalGuides.push(bestXEdge.guide);
      if (bestXEdge.dist <= SNAP_THRESHOLD && (!bestSnapX || bestXEdge.dist < bestSnapX.distance)) {
        bestSnapX = { offset: bestXEdge.offset, distance: bestXEdge.dist };
      }
    }

    // Y axis: приоритет center, затем лучший из edges (включая cross-alignment)
    if (yCandidates.center) {
      horizontalGuides.push(yCandidates.center.guide);
      if (yCandidates.center.dist <= SNAP_THRESHOLD) {
        bestSnapY = { offset: yCandidates.center.offset, distance: yCandidates.center.dist };
      }
    }
    const bestYEdge = this._pickBestFromMany([
      yCandidates.top, 
      yCandidates.bottom,
      yCandidates.topBottom,
      yCandidates.bottomTop
    ]);
    if (bestYEdge) {
      horizontalGuides.push(bestYEdge.guide);
      if (bestYEdge.dist <= SNAP_THRESHOLD && (!bestSnapY || bestYEdge.dist < bestSnapY.distance)) {
        bestSnapY = { offset: bestYEdge.offset, distance: bestYEdge.dist };
      }
    }

    // === Equal Spacing Detection ===
    const otherBounds = allObjects
      .filter(o => o.id !== draggedId && !o.frozen)
      .map(o => this._getObjectBounds(o))
      .filter(b => b !== null);
    
    const spacingGuides = this._findEqualSpacing(draggedBounds, otherBounds);
    
    // Snap to equal spacing if found
    if (spacingGuides.snapX !== null && (!bestSnapX || spacingGuides.snapX.distance < bestSnapX.distance)) {
      bestSnapX = spacingGuides.snapX;
    }
    if (spacingGuides.snapY !== null && (!bestSnapY || spacingGuides.snapY.distance < bestSnapY.distance)) {
      bestSnapY = spacingGuides.snapY;
    }

    this._drawGuides(verticalGuides, horizontalGuides);
    this._drawSpacingGuides(spacingGuides.horizontal, spacingGuides.vertical);
    
    // Round snap offsets to avoid subpixel positioning
    return {
      x: Math.round(bestSnapX?.offset ?? 0),
      y: Math.round(bestSnapY?.offset ?? 0)
    };
  }

  /**
   * Выбрать лучшего кандидата из двух (ближайший по расстоянию)
   * @param {Object|null} a - Первый кандидат { guide, dist, offset }
   * @param {Object|null} b - Второй кандидат
   * @returns {Object|null} Лучший кандидат или null
   */
  _pickBestCandidate(a, b) {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return a.dist <= b.dist ? a : b;
  }

  /**
   * Выбрать лучшего кандидата из массива (ближайший по расстоянию)
   * @param {Array} candidates - Массив кандидатов { guide, dist, offset } или null
   * @returns {Object|null} Лучший кандидат или null
   */
  _pickBestFromMany(candidates) {
    let best = null;
    for (const c of candidates) {
      if (!c) continue;
      if (!best || c.dist < best.dist) {
        best = c;
      }
    }
    return best;
  }

  /**
   * Найти equal spacing между объектами
   */
  _findEqualSpacing(draggedBounds, otherBounds) {
    const result = { horizontal: [], vertical: [], snapX: null, snapY: null };
    
    // Фильтруем null bounds на всякий случай
    const validBounds = otherBounds.filter(b => b !== null);
    
    // === Горизонтальный spacing ===
    const leftObjects = validBounds.filter(b => b.right < draggedBounds.left);
    const rightObjects = validBounds.filter(b => b.left > draggedBounds.right);
    
    leftObjects.sort((a, b) => b.right - a.right); // Ближайший первый
    rightObjects.sort((a, b) => a.left - b.left);
    
    // Случай 1: Объекты с обеих сторон - выравниваем по центру
    if (leftObjects.length > 0 && rightObjects.length > 0) {
      const leftNearest = leftObjects[0];
      const rightNearest = rightObjects[0];
      
      const gapLeft = draggedBounds.left - leftNearest.right;
      const gapRight = rightNearest.left - draggedBounds.right;
      
      const diff = Math.abs(gapLeft - gapRight);
      if (diff <= SPACING_THRESHOLD * 2) {
        const avgGap = (gapLeft + gapRight) / 2;
        const snapOffset = (gapRight - gapLeft) / 2;
        // Y position: use intersection of all objects (not average of centers)
        const minBottom = Math.min(draggedBounds.bottom, leftNearest.bottom, rightNearest.bottom);
        const maxTop = Math.max(draggedBounds.top, leftNearest.top, rightNearest.top);
        const y = (minBottom + maxTop) / 2;
        
        result.horizontal.push({ x1: leftNearest.right, x2: draggedBounds.left, y, gap: avgGap });
        result.horizontal.push({ x1: draggedBounds.right, x2: rightNearest.left, y, gap: avgGap });
        
        if (diff <= SPACING_THRESHOLD) {
          result.snapX = { offset: snapOffset, distance: diff };
        }
      }
    }
    
    // Случай 2: Два объекта слева - [A]--gap--[B]--gap--[Dragged]
    if (leftObjects.length >= 2) {
      const nearest = leftObjects[0];
      const second = leftObjects[1];
      
      const existingGap = nearest.left - second.right; // gap между A и B
      const currentGap = draggedBounds.left - nearest.right; // gap между B и Dragged
      
      const diff = Math.abs(existingGap - currentGap);
      if (diff <= SPACING_THRESHOLD * 2 && existingGap > 0) {
        // Y position: use intersection of all objects
        const minBottom = Math.min(draggedBounds.bottom, nearest.bottom, second.bottom);
        const maxTop = Math.max(draggedBounds.top, nearest.top, second.top);
        const y = (minBottom + maxTop) / 2;
        const snapOffset = existingGap - currentGap; // Сдвинуть чтобы gaps были равны
        
        result.horizontal.push({ x1: second.right, x2: nearest.left, y, gap: existingGap });
        result.horizontal.push({ x1: nearest.right, x2: draggedBounds.left, y, gap: existingGap });
        
        if (diff <= SPACING_THRESHOLD && (!result.snapX || diff < result.snapX.distance)) {
          result.snapX = { offset: snapOffset, distance: diff };
        }
      }
    }
    
    // Случай 3: Два объекта справа - [Dragged]--gap--[A]--gap--[B]
    if (rightObjects.length >= 2) {
      const nearest = rightObjects[0];
      const second = rightObjects[1];
      
      const existingGap = second.left - nearest.right;
      const currentGap = nearest.left - draggedBounds.right;
      
      const diff = Math.abs(existingGap - currentGap);
      if (diff <= SPACING_THRESHOLD * 2 && existingGap > 0) {
        // Y position: use intersection of all objects
        const minBottom = Math.min(draggedBounds.bottom, nearest.bottom, second.bottom);
        const maxTop = Math.max(draggedBounds.top, nearest.top, second.top);
        const y = (minBottom + maxTop) / 2;
        const snapOffset = currentGap - existingGap;
        
        result.horizontal.push({ x1: draggedBounds.right, x2: nearest.left, y, gap: existingGap });
        result.horizontal.push({ x1: nearest.right, x2: second.left, y, gap: existingGap });
        
        if (diff <= SPACING_THRESHOLD && (!result.snapX || diff < result.snapX.distance)) {
          result.snapX = { offset: snapOffset, distance: diff };
        }
      }
    }
    
    // === Вертикальный spacing ===
    const topObjects = validBounds.filter(b => b.bottom < draggedBounds.top);
    const bottomObjects = validBounds.filter(b => b.top > draggedBounds.bottom);
    
    topObjects.sort((a, b) => b.bottom - a.bottom);
    bottomObjects.sort((a, b) => a.top - b.top);
    
    // Случай 1: Объекты сверху и снизу
    if (topObjects.length > 0 && bottomObjects.length > 0) {
      const topNearest = topObjects[0];
      const bottomNearest = bottomObjects[0];
      
      const gapTop = draggedBounds.top - topNearest.bottom;
      const gapBottom = bottomNearest.top - draggedBounds.bottom;
      
      const diff = Math.abs(gapTop - gapBottom);
      if (diff <= SPACING_THRESHOLD * 2) {
        const avgGap = (gapTop + gapBottom) / 2;
        const snapOffset = (gapBottom - gapTop) / 2;
        
        // X position: use intersection of all objects, fallback to dragged center
        const minRight = Math.min(draggedBounds.right, topNearest.right, bottomNearest.right);
        const maxLeft = Math.max(draggedBounds.left, topNearest.left, bottomNearest.left);
        // If objects don't overlap horizontally, use dragged object's center
        const x = minRight >= maxLeft ? (minRight + maxLeft) / 2 : draggedBounds.centerX;
        
        result.vertical.push({
          y1: topNearest.bottom,
          y2: draggedBounds.top,
          x,
          gap: avgGap
        });
        result.vertical.push({
          y1: draggedBounds.bottom,
          y2: bottomNearest.top,
          x,
          gap: avgGap
        });
        
        if (diff <= SPACING_THRESHOLD) {
          result.snapY = { offset: snapOffset, distance: diff };
        }
      }
    }
    
    // Случай 2: Два объекта сверху
    if (topObjects.length >= 2) {
      const nearest = topObjects[0];
      const second = topObjects[1];
      
      const existingGap = nearest.top - second.bottom;
      const currentGap = draggedBounds.top - nearest.bottom;
      
      const diff = Math.abs(existingGap - currentGap);
      if (diff <= SPACING_THRESHOLD * 2 && existingGap > 0) {
        // X position: use intersection of all objects, fallback to dragged center
        const minRight = Math.min(draggedBounds.right, nearest.right, second.right);
        const maxLeft = Math.max(draggedBounds.left, nearest.left, second.left);
        const x = minRight >= maxLeft ? (minRight + maxLeft) / 2 : draggedBounds.centerX;
        const snapOffset = existingGap - currentGap;
        
        result.vertical.push({ y1: second.bottom, y2: nearest.top, x, gap: existingGap });
        result.vertical.push({ y1: nearest.bottom, y2: draggedBounds.top, x, gap: existingGap });
        
        if (diff <= SPACING_THRESHOLD && (!result.snapY || diff < result.snapY.distance)) {
          result.snapY = { offset: snapOffset, distance: diff };
        }
      }
    }
    
    // Случай 3: Два объекта снизу
    if (bottomObjects.length >= 2) {
      const nearest = bottomObjects[0];
      const second = bottomObjects[1];
      
      const existingGap = second.top - nearest.bottom;
      const currentGap = nearest.top - draggedBounds.bottom;
      
      const diff = Math.abs(existingGap - currentGap);
      if (diff <= SPACING_THRESHOLD * 2 && existingGap > 0) {
        // X position: use intersection of all objects, fallback to dragged center
        const minRight = Math.min(draggedBounds.right, nearest.right, second.right);
        const maxLeft = Math.max(draggedBounds.left, nearest.left, second.left);
        const x = minRight >= maxLeft ? (minRight + maxLeft) / 2 : draggedBounds.centerX;
        const snapOffset = currentGap - existingGap;
        
        result.vertical.push({ y1: draggedBounds.bottom, y2: nearest.top, x, gap: existingGap });
        result.vertical.push({ y1: nearest.bottom, y2: second.top, x, gap: existingGap });
        
        if (diff <= SPACING_THRESHOLD && (!result.snapY || diff < result.snapY.distance)) {
          result.snapY = { offset: snapOffset, distance: diff };
        }
      }
    }
    
    return result;
  }

  /**
   * Отрисовка spacing guides с засечками
   * Использует vector-effect: non-scaling-stroke для постоянной толщины
   * Размер засечек компенсируется зумом для постоянного размера на экране
   */
  _drawSpacingGuides(horizontal, vertical) {
    if (!this.svg) return;
    
    const scale = this._getCanvasScale();
    // Засечки должны быть ~6px на экране независимо от зума
    const TICK_SIZE = 6 / scale;
    
    // Дедупликация по позиции линии
    const uniqueH = this._dedupeSpacing(horizontal, 'y');
    const uniqueV = this._dedupeSpacing(vertical, 'x');
    
    for (const g of uniqueH) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', g.x1);
      line.setAttribute('y1', g.y);
      line.setAttribute('x2', g.x2);
      line.setAttribute('y2', g.y);
      line.setAttribute('stroke', SPACING_COLOR);
      line.setAttribute('stroke-width', GUIDE_WIDTH);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      this.svg.appendChild(line);
      
      for (const x of [g.x1, g.x2]) {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', x);
        tick.setAttribute('y1', g.y - TICK_SIZE);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', g.y + TICK_SIZE);
        tick.setAttribute('stroke', SPACING_COLOR);
        tick.setAttribute('stroke-width', GUIDE_WIDTH);
        tick.setAttribute('vector-effect', 'non-scaling-stroke');
        this.svg.appendChild(tick);
      }
    }
    
    for (const g of uniqueV) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', g.x);
      line.setAttribute('y1', g.y1);
      line.setAttribute('x2', g.x);
      line.setAttribute('y2', g.y2);
      line.setAttribute('stroke', SPACING_COLOR);
      line.setAttribute('stroke-width', GUIDE_WIDTH);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      this.svg.appendChild(line);
      
      for (const y of [g.y1, g.y2]) {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', g.x - TICK_SIZE);
        tick.setAttribute('y1', y);
        tick.setAttribute('x2', g.x + TICK_SIZE);
        tick.setAttribute('y2', y);
        tick.setAttribute('stroke', SPACING_COLOR);
        tick.setAttribute('stroke-width', GUIDE_WIDTH);
        tick.setAttribute('vector-effect', 'non-scaling-stroke');
        this.svg.appendChild(tick);
      }
    }
  }
  
  _dedupeSpacing(guides, key) {
    const result = [];
    for (const g of guides) {
      const pos = g[key];
      // Проверяем есть ли уже линия на этой позиции (с порогом)
      const existing = result.find(r => Math.abs(r[key] - pos) < GUIDE_THRESHOLD);
      if (!existing) {
        result.push({ ...g });
      }
      // Если есть — пропускаем дубликат
    }
    return result;
  }

  /**
   * Вычислить bounds драгаемого объекта на основе currentX/Y
   * Использует getBoundingClientRect для точности (учитывает все трансформации и borders)
   */
  _getDraggedBounds(obj, currentX, currentY) {
    if (!this.layer) return null;
    
    const container = this.layer.querySelector(`#${obj.id}`);
    if (!container) return null;
    
    // Получаем текущие bounds из DOM через getBoundingClientRect
    // Это точно учитывает все трансформации, scale, borders и т.д.
    const currentBounds = this._getObjectBounds(obj);
    if (!currentBounds) return null;
    
    // Вычисляем смещение от текущей позиции к новой
    const currentContainerX = parseFloat(container.style.left) || 0;
    const currentContainerY = parseFloat(container.style.top) || 0;
    const deltaX = currentX - currentContainerX;
    const deltaY = currentY - currentContainerY;
    
    // Применяем смещение к текущим bounds
    return {
      left: currentBounds.left + deltaX,
      right: currentBounds.right + deltaX,
      top: currentBounds.top + deltaY,
      bottom: currentBounds.bottom + deltaY,
      centerX: currentBounds.centerX + deltaX,
      centerY: currentBounds.centerY + deltaY
    };
  }

  /**
   * Получить bounds объекта
   * Использует getBoundingClientRect для точности — автоматически учитывает
   * все трансформации (scale), borders, и любые CSS эффекты.
   * Конвертирует screen coordinates в world coordinates.
   */
  _getObjectBounds(obj) {
    if (!this.layer) return null;
    
    const container = this.layer.querySelector(`#${obj.id}`);
    if (!container) return null;
    
    // Находим элемент с permanent-border (если есть) — его границы нас интересуют
    // Для разных типов объектов разные классы:
    // - images: .wbe-image-permanent-border (SVG)
    // - text: .wbe-text-permanent-border (div)
    // - shapes: .wbe-permanent-border (div)
    const permaBorder = container.querySelector('.wbe-image-permanent-border, .wbe-text-permanent-border, .wbe-permanent-border');
    const targetElement = permaBorder || container;
    
    // Получаем screen bounds через getBoundingClientRect
    const screenRect = targetElement.getBoundingClientRect();
    
    // Конвертируем в world coordinates
    const canvasScale = this._getCanvasScale();
    const layerRect = this.layer.getBoundingClientRect();
    
    const left = (screenRect.left - layerRect.left) / canvasScale;
    const top = (screenRect.top - layerRect.top) / canvasScale;
    const width = screenRect.width / canvasScale;
    const height = screenRect.height / canvasScale;
    
    return {
      left,
      right: left + width,
      top,
      bottom: top + height,
      centerX: left + width / 2,
      centerY: top + height / 2
    };
  }

  /**
   * Получить scale канваса
   */
  _getCanvasScale() {
    if (!canvas?.stage?.worldTransform?.a) return 1;
    return canvas.stage.worldTransform.a;
  }

  /**
   * Отрисовка линий
   */
  _drawGuides(verticalGuides, horizontalGuides) {
    if (!this.svg) return;

    // Дедупликация
    const uniqueV = this._dedupe(verticalGuides, 'x');
    const uniqueH = this._dedupe(horizontalGuides, 'y');

    for (const g of uniqueV) {
      this._drawLine(g.x, g.minY, g.x, g.maxY);
    }
    for (const g of uniqueH) {
      this._drawLine(g.minX, g.y, g.maxX, g.y);
    }
  }

  /**
   * Нарисовать линию
   * Использует vector-effect: non-scaling-stroke для постоянной толщины 1px независимо от зума
   */
  _drawLine(x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', GUIDE_COLOR);
    line.setAttribute('stroke-width', GUIDE_WIDTH);
    // Магия! Толщина линии не масштабируется вместе с канвасом
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    this.svg.appendChild(line);
  }

  /**
   * Дедупликация близких линий
   */
  _dedupe(guides, key) {
    const result = [];
    for (const g of guides) {
      // Порог = GUIDE_THRESHOLD чтобы близкие линии сливались
      const existing = result.find(r => Math.abs(r[key] - g[key]) < GUIDE_THRESHOLD);
      if (existing) {
        if (key === 'x') {
          existing.minY = Math.min(existing.minY, g.minY);
          existing.maxY = Math.max(existing.maxY, g.maxY);
        } else {
          existing.minX = Math.min(existing.minX, g.minX);
          existing.maxX = Math.max(existing.maxX, g.maxX);
        }
      } else {
        result.push({ ...g });
      }
    }
    return result;
  }

  /**
   * Очистить линии
   */
  clear() {
    if (this.svg) {
      this.svg.innerHTML = '';
    }
  }

  /**
   * Уничтожить модуль
   */
  destroy() {
    this.clear();
    if (this._boundMouseMove) {
      window.removeEventListener('mousemove', this._boundMouseMove, true);
    }
    if (this._boundMouseUp) {
      window.removeEventListener('mouseup', this._boundMouseUp, true);
    }
    if (this.svg?.parentNode) {
      this.svg.parentNode.removeChild(this.svg);
    }
    this.svg = null;
    this.layer = null;
  }

  /**
   * Включить/выключить
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }
}

// Автоматическая инициализация при загрузке модуля
const instance = new AlignmentGuides();

// Ждём Foundry ready hook
if (typeof Hooks !== 'undefined') {
  Hooks.once('ready', () => {
    // Даём WBE время инициализироваться
    setTimeout(() => instance.init(), 100);
  });
  
  // Переинициализация при смене сцены - layer пересоздаётся
  Hooks.on('canvasReady', () => {
    console.log('[AlignmentGuides] Canvas ready - reinitializing...');
    instance.destroy();
    setTimeout(() => instance.init(), 100);
  });
} else {
  // Fallback для тестов
  setTimeout(() => instance.init(), 1000);
}

// Экспорт для внешнего доступа
export { AlignmentGuides };
export default instance;

// Глобальный доступ
window.WBE_AlignmentGuides = instance;
