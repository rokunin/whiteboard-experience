/**
 * Alignment Guides Module for Whiteboard Experience
 *
 * Показывает линии-подсказки при перетаскивании объектов,
 * как в Miro/Figma. Линии показывают совпадение границ и центров объектов.
 *
 * Работает автоматически при любом перетаскивании:
 * - Показывает направляющие при приближении на 8 ЭКРАННЫХ пикселей (GUIDE_THRESHOLD_PX)
 * - Snap срабатывает при приближении на 5 ЭКРАННЫХ пикселей (SNAP_THRESHOLD_PX)
 * - Один раз "залипнув" на цели, отпускает её только когда расстояние превышает 10 экранных
 *   пикселей (RELEASE_THRESHOLD_PX), и переключается на другую цель только если та ЯВНО ближе
 *   (минимум на SWITCH_MARGIN_PX) - гистерезис, а не пересчёт с нуля на каждый mousemove.
 * - Равные отступы (spacing guides) используют то же экранное правило порогов.
 * - Скрытые (`obj.hidden`) объекты никогда не являются целью прилипания (как и замороженные).
 *
 * wbe-alignment-guides-fix (2026-09-27) rewrote the threshold/hysteresis math into a separate,
 * dependency-free module (`alignment-guides-math.mjs`, unit-tested) because the previous
 * thresholds were fixed WORLD-unit constants (2 world units for all three), compared against
 * bounds that are already converted to world units in `_getObjectBounds` - so at canvas zoom 0.2
 * that was only 0.4 screen px (guides almost never fired) and at zoom 5 it was 10 screen px
 * (over-triggered), and the snap target was recomputed from scratch every mousemove with no
 * hysteresis, so it flickered/flipped between near-equal candidates at the boundary
 * (`_pickBestFromMany`). See that module's own header for the conversion/hysteresis contract.
 *
 * Perf: `layer.getBoundingClientRect()` is read at most ONCE per mousemove (not once per
 * candidate object), and OTHER objects' world bounds are computed at most ONCE PER DRAG (not
 * once per mousemove) - they cannot move while only the dragged object does, and a world bound is
 * itself invariant to pan/zoom - invalidated by any registry created/updated/deleted event (a
 * remote client's edit) and by a new drag starting (`_ensureDragSession`).
 *
 * Архитектура:
 * - Полностью автономный модуль
 * - Подключается к WBE через window.Whiteboard API
 * - Перехватывает mousemove события самостоятельно
 * - НЕ требует изменений в main.mjs
 */
import { computeThresholdsWorld, pickBestFromMany, resolveSnapHysteresis } from './alignment-guides-math.mjs';

const GUIDE_COLOR = '#ff00ff';  // Magenta - хорошо видно на любом фоне
const SPACING_COLOR = '#00d4ff'; // Cyan для spacing guides
const GUIDE_WIDTH = 1;

/**
 * AlignmentGuides - менеджер линий выравнивания
 */
class AlignmentGuides {
  constructor() {
    this.svg = null;
    this.layer = null;
    this.enabled = true;
    this.spacingEnabled = false;  // Toggle for blue spacing guides only
    this._boundMouseMove = null;
    this._boundMouseUp = null;
    this._registryUnsubscribe = null;

    // wbe-alignment-guides-fix: hysteresis state (per-slot lock + last-shown, for the flicker
    // oracle) and the per-drag candidate-bounds cache - both keyed by `_dragSessionKey`, reset by
    // `_ensureDragSession` when a NEW drag starts, deliberately NOT reset on plain `clear()`
    // (called every mousemove) or on mouseup, so a fuzz/e2e oracle can inspect the LAST drag's
    // outcome (`this._hyst.locks`, `this._toggleLog`) right after it ends.
    this._dragSessionKey = null;
    this._hyst = this._freshHysteresis();
    this._toggleLog = [];
    this._candidateCache = null; // Map<objectId, bounds> | null
    // Bumped once per mousemove that actually ran guide computation (`_updateGuides`/
    // `_updateGuidesForGroup`/`_findSnapForEdge`) - lets an external checker (the fuzz oracle)
    // tell "this drag just produced a fresh `_hyst.locks`" apart from "nothing guide-related has
    // happened since I last looked, `_hyst.locks` is just leftover from an old, unrelated drag".
    this._computeCounter = 0;
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

    // wbe-alignment-guides-fix: invalidate the per-drag candidate-bounds cache on any registry
    // mutation (created/updated/deleted) - a remote client's edit mid-drag must not leave us
    // snapping to a stale position/size.
    if (window.Whiteboard.registry?.subscribe && !this._registryUnsubscribe) {
      this._registryUnsubscribe = window.Whiteboard.registry.subscribe((evt) => {
        if (evt?.type === 'created' || evt?.type === 'updated' || evt?.type === 'deleted') {
          this._candidateCache = null;
        }
      });
    }

    console.log('[AlignmentGuides] Initialized');
  }

  _freshHysteresis() {
    return { locks: {}, lastShow: {} };
  }

  /**
   * Starts a fresh hysteresis/cache session when the active drag changes identity (a different
   * object, or single-drag -> mass-drag -> stretch-resize, or drag ended and a new one began).
   * Deliberately NOT called from `clear()` (every mousemove) or `_onMouseUp` - see the
   * constructor's own doc comment on why locks/toggle log must survive past mouseup.
   */
  _ensureDragSession(key) {
    if (this._dragSessionKey !== key) {
      this._dragSessionKey = key;
      this._hyst = this._freshHysteresis();
      this._toggleLog = [];
      this._candidateCache = null;
    }
  }

  /**
   * Resolves one guide "slot" (e.g. `'x.center'`, `'x.edge'`, `'y.spacing'`, `'stretch'`) through
   * the hysteresis rule (alignment-guides-math.mjs) and records a toggle-log entry whenever the
   * slot's visibility (shown/not shown) flips - read by the fuzz flicker-detector oracle
   * (`tests/e2e/fuzz/oracles.mjs`) as `window.WBE_AlignmentGuides._toggleLog.length` after a
   * drag with small back-and-forth deltas near a boundary.
   */
  _resolveSlot(key, candidates, T, identity) {
    const r = resolveSnapHysteresis(this._hyst.locks[key] || null, candidates, T, identity);
    this._hyst.locks[key] = r.locked;
    const isShown = !!r.show;
    const wasShown = !!this._hyst.lastShow[key];
    if (isShown !== wasShown) this._toggleLog.push({ key, shown: isShown, t: Date.now() });
    this._hyst.lastShow[key] = isShown;
    return r;
  }

  /**
   * Обработчик mousemove - проверяем drag состояние WBE
   */
  _onMouseMove(e) {
    if (!this.enabled) return;

    if (!window.Whiteboard?.interaction) return;

    const interaction = window.Whiteboard.interaction;
    const massSelection = interaction.massSelection;
    // wbe-alignment-guides-fix (perf): ONE layer rect for this whole mousemove, shared by every
    // bounds computation this frame - was one `getBoundingClientRect()` call per candidate object.
    const layerRect = this.layer?.getBoundingClientRect() || null;

    // Check for mass selection drag first
    if (massSelection?.isDragging) {
      this._ensureDragSession('mass:' + [...massSelection.selectedIds].sort().join(','));
      this._handleMassDrag(e, massSelection, layerRect);
      return;
    }

    // Handle stretch resize - show guides and apply snap
    const stretchState = interaction.stretchResizeState;
    if (stretchState) {
      this._ensureDragSession('stretch:' + stretchState.id + ':' + stretchState.direction);
      this._handleStretchResize(e, stretchState, interaction, layerRect);
      return;
    }

    const dragState = interaction.dragState;

    // Если нет активного drag - очищаем. Session key resets too, but locks/toggle log from the
    // drag that just ended are left alone (see `_ensureDragSession`'s own doc comment).
    if (!dragState) {
      this._dragSessionKey = null;
      this.clear();
      return;
    }
    this._ensureDragSession('drag:' + dragState.id);

    // Получаем текущую позицию из dragState
    const currentX = dragState.currentX ?? dragState.objStartX;
    const currentY = dragState.currentY ?? dragState.objStartY;

    // Обновляем guides и получаем snap offsets
    const snap = this._updateGuides(dragState.id, currentX, currentY, layerRect);

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
  _handleMassDrag(e, massSelection, layerRect) {
    if (!massSelection.selectedIds || massSelection.selectedIds.size === 0) {
      this.clear();
      return;
    }

    // Calculate current group bounds
    const groupBounds = this._getMassSelectionBounds(massSelection, layerRect);
    if (!groupBounds) {
      this.clear();
      return;
    }

    // Get snap offsets for the group
    const snap = this._updateGuidesForGroup(groupBounds, massSelection.selectedIds, layerRect);

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
        // Review finding 6: `massSelection.startPositions` (main.mjs's `startMassDrag`) leaves
        // out non-movable ids ON PURPOSE, so `updateMassDrag`/`endMassDrag` never reposition them
        // - the rest of the group moves, they stay put. This loop used to apply the snap offset
        // to EVERY selected id regardless, so a non-movable object in the selection still got
        // dragged along by the snap alone, contradicting that "stays in place" contract.
        if (massSelection.startPositions && !massSelection.startPositions.has(id)) continue;

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
  _handleStretchResize(e, stretchState, _interaction, layerRect) {
    this.clear();

    const { id, direction } = stretchState;
    const obj = window.Whiteboard?.registry?.get(id);
    if (!obj) return;

    // Get current visual bounds of the object (already reflects current DOM state)
    const currentBounds = this._getObjectBounds(obj, layerRect);
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

    // Review finding 5: `currentBounds`/`currentEdgePosition` are read straight off the DOM,
    // which already reflects whatever snap offset THIS SAME `stretchState` applied on the
    // PREVIOUS mousemove - main.mjs's `_updateStretchResize` bakes `stretchState._snapOffset`
    // into the rendered width/position before this method runs again. Left uncorrected, that
    // stale offset poisons this frame's own edge measurement: `_findSnapForEdge` computes a new
    // snap against an edge that has already moved by the last snap, so the offset can compound
    // frame over frame or flip-flop between snapped/unsnapped as the mouse crosses the
    // threshold. Subtract it back out to recover the actual mouse-driven ("raw") edge position -
    // the same sign convention main.mjs uses when it added `_snapOffset` into `visualDeltaX`/
    // `visualDeltaY` for this same direction.
    currentEdgePosition -= stretchState._snapOffset || 0;

    // Find snap targets for the active edge
    const snap = this._findSnapForEdge(id, activeEdge, currentEdgePosition, currentBounds, layerRect);

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
  _findSnapForEdge(objId, edge, newPosition, currentBounds, layerRect) {
    this._computeCounter++;
    const result = { offset: 0, verticalGuides: [], horizontalGuides: [] };

    if (!window.Whiteboard?.registry) return result;

    const T = computeThresholdsWorld(this._getCanvasScale());
    const candidateBounds = this._getCandidateBoundsMap(layerRect);
    const allObjects = window.Whiteboard.registry.getAll();
    const isVerticalEdge = (edge === 'left' || edge === 'right');

    const candidates = [];
    for (const obj of allObjects) {
      // wbe-alignment-guides-fix: hidden objects are never a snap target (frozen already excluded).
      if (obj.id === objId || obj.frozen || obj.hidden) continue;

      const bounds = candidateBounds.get(obj.id);
      if (!bounds) continue;

      const targetEdges = isVerticalEdge
        ? [bounds.left, bounds.right, bounds.centerX]
        : [bounds.top, bounds.bottom, bounds.centerY];

      for (const targetPos of targetEdges) {
        const dist = Math.abs(newPosition - targetPos);
        if (dist > T.release) continue; // collect up to the release threshold, not just guide/snap
        candidates.push({
          dist,
          offset: targetPos - newPosition,
          targetPos,
          guide: isVerticalEdge
            ? { x: targetPos, minY: Math.min(currentBounds.top, bounds.top) - 20, maxY: Math.max(currentBounds.bottom, bounds.bottom) + 20 }
            : { y: targetPos, minX: Math.min(currentBounds.left, bounds.left) - 20, maxX: Math.max(currentBounds.right, bounds.right) + 20 },
        });
      }
    }

    const r = this._resolveSlot('stretch', candidates, T, (c) => c.targetPos.toFixed(3));
    if (r.show) {
      if (isVerticalEdge) result.verticalGuides.push(r.show.guide);
      else result.horizontalGuides.push(r.show.guide);
    }
    result.offset = r.snap ? r.snap.offset : 0;

    return result;
  }

  /**
   * Get bounding box of all mass-selected objects
   */
  _getMassSelectionBounds(massSelection, layerRect) {
    if (!massSelection.selectedIds || massSelection.selectedIds.size === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const id of massSelection.selectedIds) {
      const obj = window.Whiteboard?.registry?.get(id);
      if (!obj) continue;

      // The dragged group's OWN bounds change every frame - always measured fresh (unlike
      // candidate/target bounds, which are cached per drag - see `_getCandidateBoundsMap`).
      const bounds = this._getObjectBounds(obj, layerRect);
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
  _updateGuidesForGroup(groupBounds, selectedIds, layerRect) {
    this.clear();
    this._computeCounter++;

    if (!window.Whiteboard?.registry) return { x: 0, y: 0 };

    const T = computeThresholdsWorld(this._getCanvasScale());
    const candidateBounds = this._getCandidateBoundsMap(layerRect);
    const allObjects = window.Whiteboard.registry.getAll();

    // Кандидаты по типам (храним только лучшего для каждого типа, в пределах RELEASE - не
    // GUIDE - порога: гистерезису нужно видеть, что уже залипшая цель ушла дальше, а не просто
    // выпала из окна отбора)
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
      // wbe-alignment-guides-fix: hidden objects are never a snap target (frozen already excluded).
      if (selectedIds.has(obj.id) || obj.frozen || obj.hidden) continue;

      const bounds = candidateBounds.get(obj.id);
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
        if (dist <= T.release) {
          if (!xCandidates[type] || dist < xCandidates[type].dist) {
            xCandidates[type] = {
              guide: {
                x: tv,
                minY: Math.min(groupBounds.top, bounds.top) - 20,
                maxY: Math.max(groupBounds.bottom, bounds.bottom) + 20
              },
              dist,
              offset: tv - dv,
              subtype: type,
              tv,
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
        if (dist <= T.release) {
          if (!yCandidates[type] || dist < yCandidates[type].dist) {
            yCandidates[type] = {
              guide: {
                y: tv,
                minX: Math.min(groupBounds.left, bounds.left) - 20,
                maxX: Math.max(groupBounds.right, bounds.right) + 20
              },
              dist,
              offset: tv - dv,
              subtype: type,
              tv,
            };
          }
        }
      }
    }

    const idOf = (c) => c.subtype + ':' + c.tv.toFixed(3);
    const centerX = this._resolveSlot('x.center', [xCandidates.center], T, () => 'center');
    const edgeX = this._resolveSlot('x.edge', [xCandidates.left, xCandidates.right, xCandidates.leftRight, xCandidates.rightLeft], T, idOf);
    const centerY = this._resolveSlot('y.center', [yCandidates.center], T, () => 'center');
    const edgeY = this._resolveSlot('y.edge', [yCandidates.top, yCandidates.bottom, yCandidates.topBottom, yCandidates.bottomTop], T, idOf);

    // Equal spacing for group
    const otherBounds = allObjects
      .filter(o => !selectedIds.has(o.id) && !o.frozen && !o.hidden)
      .map(o => candidateBounds.get(o.id))
      .filter(b => b !== null && b !== undefined);

    const spacingGuides = this._findEqualSpacing(groupBounds, otherBounds, T);
    const spacingX = this._resolveSlot('x.spacing', [spacingGuides.snapX], T, (c) => c.kind || 'spacing');
    const spacingY = this._resolveSlot('y.spacing', [spacingGuides.snapY], T, (c) => c.kind || 'spacing');

    const verticalGuides = [centerX.show, edgeX.show].filter(Boolean).map(c => c.guide);
    const horizontalGuides = [centerY.show, edgeY.show].filter(Boolean).map(c => c.guide);

    this._drawGuides(verticalGuides, horizontalGuides);
    this._drawSpacingGuides(spacingGuides.horizontal, spacingGuides.vertical);

    const bestSnapX = pickBestFromMany([centerX.snap, edgeX.snap, spacingX.snap]);
    const bestSnapY = pickBestFromMany([centerY.snap, edgeY.snap, spacingY.snap]);

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
   * Perf fix (wbe-alignment-guides-fix): candidate objects' world bounds computed at most once
   * per drag session - see the module's own header. `layerRect` is only used to seed the cache
   * on its first build within a session; later reads of the SAME cache ignore whatever
   * `layerRect` the calling frame passed (correct - world bounds don't depend on it).
   */
  _getCandidateBoundsMap(layerRect) {
    if (this._candidateCache) return this._candidateCache;
    const bounds = new Map();
    if (window.Whiteboard?.registry) {
      for (const obj of window.Whiteboard.registry.getAll()) {
        const b = this._getObjectBounds(obj, layerRect);
        if (b) bounds.set(obj.id, b);
      }
    }
    this._candidateCache = bounds;
    return bounds;
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
  _updateGuides(draggedId, currentX, currentY, layerRect) {
    this.clear();
    this._computeCounter++;

    if (!window.Whiteboard?.registry) return { x: 0, y: 0 };

    const allObjects = window.Whiteboard.registry.getAll();
    const draggedObj = allObjects.find(o => o.id === draggedId);
    if (!draggedObj) return { x: 0, y: 0 };

    // Вычисляем bounds драгаемого объекта на основе currentX/Y (не из DOM!)
    const draggedBounds = this._getDraggedBounds(draggedObj, currentX, currentY, layerRect);
    if (!draggedBounds) return { x: 0, y: 0 };

    const T = computeThresholdsWorld(this._getCanvasScale());
    const candidateBounds = this._getCandidateBoundsMap(layerRect);

    // Кандидаты по типам (храним только лучшего для каждого типа, в пределах RELEASE порога -
    // см. `_updateGuidesForGroup`'s own comment on why)
    // X axis (vertical guides)
    const xCandidates = {
      center: null,  // { guide, dist, offset, subtype, tv }
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
      // wbe-alignment-guides-fix: hidden objects are never a snap target (frozen already excluded).
      if (obj.id === draggedId || obj.frozen || obj.hidden) continue;

      const bounds = candidateBounds.get(obj.id);
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
        if (dist <= T.release) {
          if (!xCandidates[type] || dist < xCandidates[type].dist) {
            xCandidates[type] = {
              guide: {
                x: tv,
                minY: Math.min(draggedBounds.top, bounds.top) - 20,
                maxY: Math.max(draggedBounds.bottom, bounds.bottom) + 20
              },
              dist,
              offset: tv - dv,
              subtype: type,
              tv,
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
        if (dist <= T.release) {
          if (!yCandidates[type] || dist < yCandidates[type].dist) {
            yCandidates[type] = {
              guide: {
                y: tv,
                minX: Math.min(draggedBounds.left, bounds.left) - 20,
                maxX: Math.max(draggedBounds.right, bounds.right) + 20
              },
              dist,
              offset: tv - dv,
              subtype: type,
              tv,
            };
          }
        }
      }
    }

    const idOf = (c) => c.subtype + ':' + c.tv.toFixed(3);
    const centerX = this._resolveSlot('x.center', [xCandidates.center], T, () => 'center');
    const edgeX = this._resolveSlot('x.edge', [xCandidates.left, xCandidates.right, xCandidates.leftRight, xCandidates.rightLeft], T, idOf);
    const centerY = this._resolveSlot('y.center', [yCandidates.center], T, () => 'center');
    const edgeY = this._resolveSlot('y.edge', [yCandidates.top, yCandidates.bottom, yCandidates.topBottom, yCandidates.bottomTop], T, idOf);

    // === Equal Spacing Detection ===
    const otherBounds = allObjects
      .filter(o => o.id !== draggedId && !o.frozen && !o.hidden)
      .map(o => candidateBounds.get(o.id))
      .filter(b => b !== null && b !== undefined);

    const spacingGuides = this._findEqualSpacing(draggedBounds, otherBounds, T);
    const spacingX = this._resolveSlot('x.spacing', [spacingGuides.snapX], T, (c) => c.kind || 'spacing');
    const spacingY = this._resolveSlot('y.spacing', [spacingGuides.snapY], T, (c) => c.kind || 'spacing');

    const verticalGuides = [centerX.show, edgeX.show].filter(Boolean).map(c => c.guide);
    const horizontalGuides = [centerY.show, edgeY.show].filter(Boolean).map(c => c.guide);

    this._drawGuides(verticalGuides, horizontalGuides);
    this._drawSpacingGuides(spacingGuides.horizontal, spacingGuides.vertical);

    const bestSnapX = pickBestFromMany([centerX.snap, edgeX.snap, spacingX.snap]);
    const bestSnapY = pickBestFromMany([centerY.snap, edgeY.snap, spacingY.snap]);

    // Round snap offsets to avoid subpixel positioning
    return {
      x: Math.round(bestSnapX?.offset ?? 0),
      y: Math.round(bestSnapY?.offset ?? 0)
    };
  }

  /**
   * Найти equal spacing между объектами
   * @param {Object} T - world-unit thresholds from `computeThresholdsWorld` (wbe-alignment-guides-fix:
   *   same screen-px treatment as the alignment guides - `T.guide` gates showing a spacing guide,
   *   `T.snap` gates actually snapping to it).
   */
  _findEqualSpacing(draggedBounds, otherBounds, T) {
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
      if (diff <= T.guide) {
        const avgGap = (gapLeft + gapRight) / 2;
        const snapOffset = (gapRight - gapLeft) / 2;
        // Y position: use intersection of all objects (not average of centers)
        const minBottom = Math.min(draggedBounds.bottom, leftNearest.bottom, rightNearest.bottom);
        const maxTop = Math.max(draggedBounds.top, leftNearest.top, rightNearest.top);
        const y = (minBottom + maxTop) / 2;

        result.horizontal.push({ x1: leftNearest.right, x2: draggedBounds.left, y, gap: avgGap });
        result.horizontal.push({ x1: draggedBounds.right, x2: rightNearest.left, y, gap: avgGap });

        if (diff <= T.snap) {
          result.snapX = { offset: snapOffset, dist: diff, kind: 'bothX' };
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
      if (diff <= T.guide && existingGap > 0) {
        // Y position: use intersection of all objects
        const minBottom = Math.min(draggedBounds.bottom, nearest.bottom, second.bottom);
        const maxTop = Math.max(draggedBounds.top, nearest.top, second.top);
        const y = (minBottom + maxTop) / 2;
        const snapOffset = existingGap - currentGap; // Сдвинуть чтобы gaps были равны

        result.horizontal.push({ x1: second.right, x2: nearest.left, y, gap: existingGap });
        result.horizontal.push({ x1: nearest.right, x2: draggedBounds.left, y, gap: existingGap });

        if (diff <= T.snap && (!result.snapX || diff < result.snapX.dist)) {
          result.snapX = { offset: snapOffset, dist: diff, kind: 'twoLeftX' };
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
      if (diff <= T.guide && existingGap > 0) {
        // Y position: use intersection of all objects
        const minBottom = Math.min(draggedBounds.bottom, nearest.bottom, second.bottom);
        const maxTop = Math.max(draggedBounds.top, nearest.top, second.top);
        const y = (minBottom + maxTop) / 2;
        const snapOffset = currentGap - existingGap;

        result.horizontal.push({ x1: draggedBounds.right, x2: nearest.left, y, gap: existingGap });
        result.horizontal.push({ x1: nearest.right, x2: second.left, y, gap: existingGap });

        if (diff <= T.snap && (!result.snapX || diff < result.snapX.dist)) {
          result.snapX = { offset: snapOffset, dist: diff, kind: 'twoRightX' };
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
      if (diff <= T.guide) {
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

        if (diff <= T.snap) {
          result.snapY = { offset: snapOffset, dist: diff, kind: 'bothY' };
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
      if (diff <= T.guide && existingGap > 0) {
        // X position: use intersection of all objects, fallback to dragged center
        const minRight = Math.min(draggedBounds.right, nearest.right, second.right);
        const maxLeft = Math.max(draggedBounds.left, nearest.left, second.left);
        const x = minRight >= maxLeft ? (minRight + maxLeft) / 2 : draggedBounds.centerX;
        const snapOffset = existingGap - currentGap;

        result.vertical.push({ y1: second.bottom, y2: nearest.top, x, gap: existingGap });
        result.vertical.push({ y1: nearest.bottom, y2: draggedBounds.top, x, gap: existingGap });

        if (diff <= T.snap && (!result.snapY || diff < result.snapY.dist)) {
          result.snapY = { offset: snapOffset, dist: diff, kind: 'twoTopY' };
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
      if (diff <= T.guide && existingGap > 0) {
        // X position: use intersection of all objects, fallback to dragged center
        const minRight = Math.min(draggedBounds.right, nearest.right, second.right);
        const maxLeft = Math.max(draggedBounds.left, nearest.left, second.left);
        const x = minRight >= maxLeft ? (minRight + maxLeft) / 2 : draggedBounds.centerX;
        const snapOffset = currentGap - existingGap;

        result.vertical.push({ y1: draggedBounds.bottom, y2: nearest.top, x, gap: existingGap });
        result.vertical.push({ y1: nearest.bottom, y2: second.top, x, gap: existingGap });

        if (diff <= T.snap && (!result.snapY || diff < result.snapY.dist)) {
          result.snapY = { offset: snapOffset, dist: diff, kind: 'twoBottomY' };
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
    if (!this.svg || !this.spacingEnabled) return;

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
      const existing = result.find(r => Math.abs(r[key] - pos) < 2);
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
  _getDraggedBounds(obj, currentX, currentY, layerRect) {
    if (!this.layer) return null;

    const container = this.layer.querySelector(`#${obj.id}`);
    if (!container) return null;

    // Получаем текущие bounds из DOM через getBoundingClientRect
    // Это точно учитывает все трансформации, scale, borders и т.д.
    const currentBounds = this._getObjectBounds(obj, layerRect);
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
   * @param {Object} obj
   * @param {DOMRect} [layerRect] - reuse a layer rect already read this frame (perf fix); falls
   *   back to reading one itself if the caller didn't have one yet.
   */
  _getObjectBounds(obj, layerRect) {
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
    const layerRectResolved = layerRect || this.layer.getBoundingClientRect();

    const left = (screenRect.left - layerRectResolved.left) / canvasScale;
    const top = (screenRect.top - layerRectResolved.top) / canvasScale;
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
      // Порог слияния близких линий - независим от снап-гистерезиса, чисто визуальный
      const existing = result.find(r => Math.abs(r[key] - g[key]) < 2);
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
    if (this._registryUnsubscribe) {
      this._registryUnsubscribe();
      this._registryUnsubscribe = null;
    }
    if (this.svg?.parentNode) {
      this.svg.parentNode.removeChild(this.svg);
    }
    this.svg = null;
    this.layer = null;
    this._dragSessionKey = null;
    this._hyst = this._freshHysteresis();
    this._toggleLog = [];
    this._candidateCache = null;
  }

  /**
   * Включить/выключить
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  /**
   * Toggle blue spacing guides only (keeps magenta alignment guides)
   */
  setSpacingEnabled(enabled) {
    this.spacingEnabled = enabled;
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
} else if (typeof window !== 'undefined') {
  // Fallback для тестов (браузерных, не vitest - vitest never imports this file directly, only
  // the dependency-free alignment-guides-math.mjs, precisely so this branch never runs there).
  setTimeout(() => instance.init(), 1000);
}

// Экспорт для внешнего доступа
export { AlignmentGuides };
export default instance;

// Глобальный доступ
if (typeof window !== 'undefined') {
  window.WBE_AlignmentGuides = instance;
}
