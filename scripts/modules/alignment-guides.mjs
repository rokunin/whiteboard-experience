/**
 * Alignment Guides Module for Whiteboard Experience
 * 
 * Показывает линии-подсказки при перетаскивании объектов с зажатым Ctrl,
 * как в Miro/Figma. Линии показывают совпадение границ и центров объектов.
 * 
 * Ctrl+Drag = alignment guides (Shift используется для добавления в группу)
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
const SNAP_THRESHOLD = 2;  // Порог срабатывания в пикселях (world coordinates)
const SPACING_THRESHOLD = 2; // Порог для equal spacing

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
    if (!this.enabled || !window.Whiteboard?.interaction) return;

    const interaction = window.Whiteboard.interaction;
    const massSelection = interaction.massSelection;
    
    // Check for mass selection drag first
    if (massSelection?.isDragging && e.ctrlKey) {
      this._handleMassDrag(e, massSelection);
      return;
    }

    const dragState = interaction.dragState;

    // Если нет активного drag или Ctrl не зажат - очищаем
    if (!dragState || !e.ctrlKey) {
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
   */
  _updateGuidesForGroup(groupBounds, selectedIds) {
    this.clear();

    if (!window.Whiteboard?.registry) return { x: 0, y: 0 };

    const allObjects = window.Whiteboard.registry.getAll();
    const horizontalGuides = [];
    const verticalGuides = [];
    
    let bestSnapX = null;
    let bestSnapY = null;

    // Check alignment against non-selected objects
    for (const obj of allObjects) {
      // Skip selected objects and frozen objects
      if (selectedIds.has(obj.id) || obj.frozen) continue;

      const bounds = this._getObjectBounds(obj);
      if (!bounds) continue;

      // Vertical alignments (X axis)
      const xPairs = [
        { dv: groupBounds.left, tv: bounds.left },
        { dv: groupBounds.left, tv: bounds.right },
        { dv: groupBounds.left, tv: bounds.centerX },
        { dv: groupBounds.right, tv: bounds.left },
        { dv: groupBounds.right, tv: bounds.right },
        { dv: groupBounds.right, tv: bounds.centerX },
        { dv: groupBounds.centerX, tv: bounds.left },
        { dv: groupBounds.centerX, tv: bounds.right },
        { dv: groupBounds.centerX, tv: bounds.centerX },
      ];
      
      for (const { dv, tv } of xPairs) {
        const dist = Math.abs(dv - tv);
        if (dist <= SNAP_THRESHOLD) {
          const offset = tv - dv;
          verticalGuides.push({
            x: tv,
            minY: Math.min(groupBounds.top, bounds.top) - 20,
            maxY: Math.max(groupBounds.bottom, bounds.bottom) + 20
          });
          if (!bestSnapX || dist < bestSnapX.distance) {
            bestSnapX = { offset, distance: dist };
          }
        }
      }

      // Horizontal alignments (Y axis)
      const yPairs = [
        { dv: groupBounds.top, tv: bounds.top },
        { dv: groupBounds.top, tv: bounds.bottom },
        { dv: groupBounds.top, tv: bounds.centerY },
        { dv: groupBounds.bottom, tv: bounds.top },
        { dv: groupBounds.bottom, tv: bounds.bottom },
        { dv: groupBounds.bottom, tv: bounds.centerY },
        { dv: groupBounds.centerY, tv: bounds.top },
        { dv: groupBounds.centerY, tv: bounds.bottom },
        { dv: groupBounds.centerY, tv: bounds.centerY },
      ];
      
      for (const { dv, tv } of yPairs) {
        const dist = Math.abs(dv - tv);
        if (dist <= SNAP_THRESHOLD) {
          const offset = tv - dv;
          horizontalGuides.push({
            y: tv,
            minX: Math.min(groupBounds.left, bounds.left) - 20,
            maxX: Math.max(groupBounds.right, bounds.right) + 20
          });
          if (!bestSnapY || dist < bestSnapY.distance) {
            bestSnapY = { offset, distance: dist };
          }
        }
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
      x: bestSnapX?.offset ?? 0,
      y: bestSnapY?.offset ?? 0
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
   * @returns {{ x: number, y: number }} Смещение для snap (0 если нет snap)
   */
  _updateGuides(draggedId, currentX, currentY) {
    this.clear();

    if (!window.Whiteboard?.registry) return { x: 0, y: 0 };

    const allObjects = window.Whiteboard.registry.getAll();
    const draggedObj = allObjects.find(o => o.id === draggedId);
    if (!draggedObj) return { x: 0, y: 0 };

    // Вычисляем bounds драгаемого объекта на основе currentX/Y (не из DOM!)
    // Это предотвращает "дрейф" snap offset при пересчёте
    const draggedBounds = this._getDraggedBounds(draggedObj, currentX, currentY);
    if (!draggedBounds) return { x: 0, y: 0 };

    const horizontalGuides = [];
    const verticalGuides = [];
    
    // Лучшие snap кандидаты
    let bestSnapX = null;  // { offset, distance }
    let bestSnapY = null;

    // Проверяем каждый другой объект
    for (const obj of allObjects) {
      if (obj.id === draggedId || obj.frozen) continue;

      const bounds = this._getObjectBounds(obj);

      // Вертикальные совпадения (по X)
      // draggedBounds.left -> bounds.left/right/centerX
      // draggedBounds.right -> bounds.left/right/centerX  
      // draggedBounds.centerX -> bounds.left/right/centerX
      const xPairs = [
        { dv: draggedBounds.left, tv: bounds.left },
        { dv: draggedBounds.left, tv: bounds.right },
        { dv: draggedBounds.left, tv: bounds.centerX },
        { dv: draggedBounds.right, tv: bounds.left },
        { dv: draggedBounds.right, tv: bounds.right },
        { dv: draggedBounds.right, tv: bounds.centerX },
        { dv: draggedBounds.centerX, tv: bounds.left },
        { dv: draggedBounds.centerX, tv: bounds.right },
        { dv: draggedBounds.centerX, tv: bounds.centerX },
      ];
      
      for (const { dv, tv } of xPairs) {
        const dist = Math.abs(dv - tv);
        if (dist <= SNAP_THRESHOLD) {
          const offset = tv - dv;  // Сколько нужно сдвинуть объект
          verticalGuides.push({
            x: tv,
            minY: Math.min(draggedBounds.top, bounds.top) - 20,
            maxY: Math.max(draggedBounds.bottom, bounds.bottom) + 20
          });
          if (!bestSnapX || dist < bestSnapX.distance) {
            bestSnapX = { offset, distance: dist };
          }
        }
      }

      // Горизонтальные совпадения (по Y)
      const yPairs = [
        { dv: draggedBounds.top, tv: bounds.top },
        { dv: draggedBounds.top, tv: bounds.bottom },
        { dv: draggedBounds.top, tv: bounds.centerY },
        { dv: draggedBounds.bottom, tv: bounds.top },
        { dv: draggedBounds.bottom, tv: bounds.bottom },
        { dv: draggedBounds.bottom, tv: bounds.centerY },
        { dv: draggedBounds.centerY, tv: bounds.top },
        { dv: draggedBounds.centerY, tv: bounds.bottom },
        { dv: draggedBounds.centerY, tv: bounds.centerY },
      ];
      
      for (const { dv, tv } of yPairs) {
        const dist = Math.abs(dv - tv);
        if (dist <= SNAP_THRESHOLD) {
          const offset = tv - dv;
          horizontalGuides.push({
            y: tv,
            minX: Math.min(draggedBounds.left, bounds.left) - 20,
            maxX: Math.max(draggedBounds.right, bounds.right) + 20
          });
          if (!bestSnapY || dist < bestSnapY.distance) {
            bestSnapY = { offset, distance: dist };
          }
        }
      }
    }

    // === Equal Spacing Detection ===
    const otherBounds = allObjects
      .filter(o => o.id !== draggedId && !o.frozen)
      .map(o => this._getObjectBounds(o));
    
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
    
    return {
      x: bestSnapX?.offset ?? 0,
      y: bestSnapY?.offset ?? 0
    };
  }

  /**
   * Найти equal spacing между объектами
   */
  _findEqualSpacing(draggedBounds, otherBounds) {
    const result = { horizontal: [], vertical: [], snapX: null, snapY: null };
    
    // === Горизонтальный spacing ===
    const leftObjects = otherBounds.filter(b => b.right < draggedBounds.left);
    const rightObjects = otherBounds.filter(b => b.left > draggedBounds.right);
    
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
    const topObjects = otherBounds.filter(b => b.bottom < draggedBounds.top);
    const bottomObjects = otherBounds.filter(b => b.top > draggedBounds.bottom);
    
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
        
        // X position: use intersection of all objects (not average of centers)
        // This ensures the line is within visible bounds of all objects
        const minRight = Math.min(draggedBounds.right, topNearest.right, bottomNearest.right);
        const maxLeft = Math.max(draggedBounds.left, topNearest.left, bottomNearest.left);
        const x = (minRight + maxLeft) / 2;
        
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
        // X position: use intersection of all objects
        const minRight = Math.min(draggedBounds.right, nearest.right, second.right);
        const maxLeft = Math.max(draggedBounds.left, nearest.left, second.left);
        const x = (minRight + maxLeft) / 2;
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
        // X position: use intersection of all objects
        const minRight = Math.min(draggedBounds.right, nearest.right, second.right);
        const maxLeft = Math.max(draggedBounds.left, nearest.left, second.left);
        const x = (minRight + maxLeft) / 2;
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
   * Толщина и размеры компенсируются зумом канваса
   */
  _drawSpacingGuides(horizontal, vertical) {
    if (!this.svg) return;
    
    // Компенсируем зум канваса
    const scale = this._getCanvasScale();
    const compensatedWidth = GUIDE_WIDTH / scale;
    const TICK_SIZE = 6 / scale;
    
    // Горизонтальные spacing линии
    for (const g of horizontal) {
      // Основная линия
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', g.x1);
      line.setAttribute('y1', g.y);
      line.setAttribute('x2', g.x2);
      line.setAttribute('y2', g.y);
      line.setAttribute('stroke', SPACING_COLOR);
      line.setAttribute('stroke-width', compensatedWidth);
      this.svg.appendChild(line);
      
      // Засечки на концах
      for (const x of [g.x1, g.x2]) {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', x);
        tick.setAttribute('y1', g.y - TICK_SIZE);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', g.y + TICK_SIZE);
        tick.setAttribute('stroke', SPACING_COLOR);
        tick.setAttribute('stroke-width', compensatedWidth);
        this.svg.appendChild(tick);
      }
    }
    
    // Вертикальные spacing линии
    for (const g of vertical) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', g.x);
      line.setAttribute('y1', g.y1);
      line.setAttribute('x2', g.x);
      line.setAttribute('y2', g.y2);
      line.setAttribute('stroke', SPACING_COLOR);
      line.setAttribute('stroke-width', compensatedWidth);
      this.svg.appendChild(line);
      
      for (const y of [g.y1, g.y2]) {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', g.x - TICK_SIZE);
        tick.setAttribute('y1', y);
        tick.setAttribute('x2', g.x + TICK_SIZE);
        tick.setAttribute('y2', y);
        tick.setAttribute('stroke', SPACING_COLOR);
        tick.setAttribute('stroke-width', compensatedWidth);
        this.svg.appendChild(tick);
      }
    }
  }

  /**
   * Вычислить bounds драгаемого объекта на основе currentX/Y
   * Использует ту же логику что updateSelectionOverlay в main.mjs
   */
  _getDraggedBounds(obj, currentX, currentY) {
    if (!this.layer) return null;
    
    const container = this.layer.querySelector(`#${obj.id}`);
    if (!container) return null;
    
    // Базовые размеры из container.style (не из getBoundingClientRect!)
    const baseWidth = parseFloat(container.style.width) || container.offsetWidth;
    const baseHeight = parseFloat(container.style.height) || container.offsetHeight;
    const scale = obj.scale !== undefined ? obj.scale : 1;
    const borderWidth = obj.borderWidth || obj.strokeWidth || 0;
    
    // Определяем тип масштабирования
    const usesTransformScale = obj.usesTransformScale?.() ?? (obj.type === 'text' || obj.type === 'shape' || obj.type === 'fate-card');
    
    let width, height, borderPadding;
    
    if (usesTransformScale) {
      // transform: scale() - размеры масштабируются, border тоже
      width = baseWidth * scale;
      height = baseHeight * scale;
      borderPadding = borderWidth * scale;
    } else {
      // images - размеры уже в container, border не масштабируется
      width = baseWidth;
      height = baseHeight;
      borderPadding = borderWidth;
    }
    
    // Финальные размеры с учётом border
    const finalWidth = width + 2 * borderPadding;
    const finalHeight = height + 2 * borderPadding;
    
    // Центр объекта (для transform-origin: center это x + baseWidth/2)
    const centerX = currentX + baseWidth / 2;
    const centerY = currentY + baseHeight / 2;
    
    // Позиция = центр - половина финального размера
    const left = centerX - finalWidth / 2;
    const top = centerY - finalHeight / 2;
    
    return {
      left,
      right: left + finalWidth,
      top,
      bottom: top + finalHeight,
      centerX,
      centerY
    };
  }

  _getBoundsFromSelectionOverlay() {
    const overlay = this.layer?.querySelector('.wbe-selection-overlay');
    if (!overlay) return null;
    
    const rect = overlay.getBoundingClientRect();
    const canvasScale = this._getCanvasScale();
    
    // Конвертируем screen coords в world coords
    const layerRect = this.layer.getBoundingClientRect();
    // Selection overlay has SELECTION_PADDING=1 built in - compensate to get perma-border edge
    const padding = 1;
    
    const left = (rect.left - layerRect.left) / canvasScale + padding;
    const top = (rect.top - layerRect.top) / canvasScale + padding;
    const width = rect.width / canvasScale - 2 * padding;
    const height = rect.height / canvasScale - 2 * padding;
    
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
   * Получить bounds объекта
   * Использует ту же логику что updateSelectionOverlay в main.mjs
   */
  _getObjectBounds(obj) {
    if (!this.layer) return null;
    
    const container = this.layer.querySelector(`#${obj.id}`);
    if (!container) return null;
    
    // Позиция из container.style (world coordinates)
    const x = parseFloat(container.style.left) || 0;
    const y = parseFloat(container.style.top) || 0;
    
    // Базовые размеры из container.style
    const baseWidth = parseFloat(container.style.width) || container.offsetWidth;
    const baseHeight = parseFloat(container.style.height) || container.offsetHeight;
    const scale = obj.scale !== undefined ? obj.scale : 1;
    const borderWidth = obj.borderWidth || obj.strokeWidth || 0;
    
    // Определяем тип масштабирования
    const usesTransformScale = obj.usesTransformScale?.() ?? (obj.type === 'text' || obj.type === 'shape' || obj.type === 'fate-card');
    
    let width, height, borderPadding;
    
    if (usesTransformScale) {
      // transform: scale() - размеры масштабируются, border тоже
      width = baseWidth * scale;
      height = baseHeight * scale;
      borderPadding = borderWidth * scale;
    } else {
      // images - размеры уже в container, border не масштабируется
      width = baseWidth;
      height = baseHeight;
      borderPadding = borderWidth;
    }
    
    // Финальные размеры с учётом border
    const finalWidth = width + 2 * borderPadding;
    const finalHeight = height + 2 * borderPadding;
    
    // Центр объекта (для transform-origin: center это x + baseWidth/2)
    const centerX = x + baseWidth / 2;
    const centerY = y + baseHeight / 2;
    
    // Позиция = центр - половина финального размера
    const left = centerX - finalWidth / 2;
    const top = centerY - finalHeight / 2;
    
    return {
      left,
      right: left + finalWidth,
      top,
      bottom: top + finalHeight,
      centerX,
      centerY
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
   * Толщина компенсируется зумом канваса, чтобы линии были видны на любом масштабе
   */
  _drawLine(x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', GUIDE_COLOR);
    
    // Компенсируем зум канваса - линия всегда 1px на экране
    const scale = this._getCanvasScale();
    const compensatedWidth = GUIDE_WIDTH / scale;
    const compensatedDash = 4 / scale;
    
    line.setAttribute('stroke-width', compensatedWidth);
    line.setAttribute('stroke-dasharray', `${compensatedDash},${compensatedDash}`);
    this.svg.appendChild(line);
  }

  /**
   * Дедупликация близких линий
   */
  _dedupe(guides, key) {
    const result = [];
    for (const g of guides) {
      const existing = result.find(r => Math.abs(r[key] - g[key]) < 1);
      if (existing) {
        // Расширяем
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
