import {
    MODID,
    ZIndexConstants
} from "../main.mjs";

// Internal freeze state storage (this module owns this data)
const frozenImages = new Map(); // { imageId: { isFrozen: boolean, container: HTMLElement } }

// Event system for loose coupling
const freezeEventHandlers = {
    onFreezeStateChange: null,  // (imageId, frozen, container) => void
    onPersistFreezeState: null, // (imageId, frozen) => Promise<void>
    onSyncFreezeState: null,    // (imageId, frozen) => void
    onGetImageData: null,       // (imageId) => { maskType, crop, etc. }
    onGetContainer: null        // (imageId) => HTMLElement
};

// Initialize event handlers
export function initImageFreezeManager(eventHandlers) {
    Object.assign(freezeEventHandlers, eventHandlers);
}

// Scale sensitivity constant
const FREEZE_FADE_DURATION = 0.5; // Duration in seconds for normal panel fade when freezing

// Inject CSS for frozen selection styling
function injectFrozenSelectionStyles() {
    if (!document.querySelector('#wbe-frozen-selection-styles')) {
        const style = document.createElement('style');
        style.id = 'wbe-frozen-selection-styles';
        style.textContent = `
      .wbe-image-selection-border.wbe-frozen-selected {
        border-color: #666666 !important;
        border-width: 2px !important;
        border-style: solid !important;
        opacity: 1 !important;
        z-index: ${ZIndexConstants.SELECTION_BORDER_FROZEN} !important;
      }
      
      .wbe-image-frozen .wbe-image-selection-border.wbe-frozen-selected {
        border-color: #666666 !important;
        border-width: 2px !important;
        z-index: ${ZIndexConstants.SELECTION_BORDER_FROZEN} !important;
      }
    `;
        document.head.appendChild(style);
    }
}

// Initialize CSS on module load
Hooks.once("init", injectFrozenSelectionStyles);

/**
 * Set image frozen state (pure state management)
 * @param {string} id - Image ID
 * @param {boolean} frozen - Frozen state
 * @param {boolean} sync - Whether to sync with other clients
 */
function setImageFrozen(id, frozen, sync = false) {
    // Get container through event handler (loose coupling)
    const container = freezeEventHandlers.onGetContainer?.(id);
    if (!container) {
        console.warn('[ImageFreezeManager] Container not found for image:', id);
        return;
    }

    const wasSelected = container.dataset.selected === "true";
    const wasFrozen = frozenImages.has(id);

    // Handle sync logic for players (non-GM users)
    if (sync && !game.user.isGM) {
        try {
            game.socket.emit(`module.${MODID}`, {
                type: 'gm-request',
                action: 'freeze-image',
                data: { imageId: id, frozen: frozen, userId: game.user.id }
            });
            return;
        } catch (error) {
            console.error('[ImageFreezeManager] Failed to send freeze request to GM, falling back to local-only:', error);
        }
    }

    // Update internal state (this module owns freeze state)
    if (frozen) {
        frozenImages.set(id, { isFrozen: true, container });
        container.dataset.frozen = "true";
        container.classList.add("wbe-image-frozen");

        // Apply freeze-specific styling (this module's responsibility)
        const clickTarget = container.querySelector('.wbe-image-click-target');
        if (clickTarget) {
            clickTarget.style.setProperty("pointer-events", "none", "important");
        }
        container.style.setProperty("pointer-events", "none", "important");

        // Show unfreeze icon (this module's UI)
        const delay = wasSelected ? (FREEZE_FADE_DURATION * 1000 + 100) : 0;
        setTimeout(() => {
            showUnfreezeIcon(container);
        }, delay);
    } else {
        frozenImages.delete(id);
        delete container.dataset.frozen;
        container.classList.remove("wbe-image-frozen");
        hideUnfreezeIcon(container);
    }

    // Notify other modules about state change (loose coupling)
    freezeEventHandlers.onFreezeStateChange?.(id, frozen, container, wasSelected);

    // Persist state (delegate to parent module)
    if (game.user.isGM) {
        freezeEventHandlers.onPersistFreezeState?.(id, frozen);
    }

    // Handle sync (delegate to parent module)
    if (sync && game.user.isGM) {
        freezeEventHandlers.onSyncFreezeState?.(id, frozen);
    }
}

/**
 * Check if image is frozen (pure state query)
 * @param {string} id - Image ID
 * @returns {boolean}
 */
function isImageFrozen(id) {
    return frozenImages.has(id);
}

// REMOVED: showFrozenSelection and hideFrozenSelection
// These functions manipulate borders, handles, and selection state
// which belong to other modules. The parent module should handle
// these visual changes in response to freeze state change events.

/**
 * Show unfreeze icon in top-left corner of frozen image
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function showUnfreezeIcon(container) {
    try {
        if (!container) {
            console.error('[showUnfreezeIcon] Invalid container provided');
            return;
        }

        hideUnfreezeIcon(container);

        const imageElement = container.querySelector('.wbe-canvas-image');
        if (!imageElement) {
            console.error('[showUnfreezeIcon] Image element not found');
            return;
        }

        if (!isImageFrozen(container.id)) {
            console.warn('[showUnfreezeIcon] Image is not frozen:', container.id);
            return;
        }

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
      z-index: ${ZIndexConstants.UNFREEZE_ICON};
      pointer-events: auto !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: all 0.2s ease;
      opacity: .5;
    `;

        const unlockIcon = document.createElement('i');
        unlockIcon.className = 'fas fa-unlock';
        unlockIcon.style.cssText = 'color: #666666;';
        icon.appendChild(unlockIcon);

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

        // Hold-to-activate logic
        let holdTimer = null;
        let holdStartTime = 0;
        const HOLD_DURATION = 1500;
        let isHolding = false;

        // CSS animation for progress ring
        if (!document.getElementById('wbe-unfreeze-styles')) {
            const style = document.createElement('style');
            style.id = 'wbe-unfreeze-styles';
            style.textContent = `
        @keyframes wbe-unfreeze-rotate {
          0% { transform: translate(-50%, -50%) rotate(-90deg); }
          100% { transform: translate(-50%, -50%) rotate(270deg); }
        }
        .wbe-unfreeze-icon.active .wbe-unfreeze-progress {
          animation: wbe-unfreeze-rotate 1.5s linear forwards;
        }
      `;
            document.head.appendChild(style);
        }

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            isHolding = true;
            holdStartTime = Date.now();
            icon.classList.add('active');
            progressRing.style.opacity = '1';

            holdTimer = setTimeout(() => {
                if (isHolding && isImageFrozen(container.id)) {
                    handleUnfreezeAction(container);
                }
            }, HOLD_DURATION);
        };

        const onMouseUp = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }

            isHolding = false;
            icon.classList.remove('active');
            progressRing.style.opacity = '0';
            progressRing.style.animation = 'none';
            void progressRing.offsetWidth;
            progressRing.style.animation = '';
        };

        const onMouseLeave = () => {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }

            isHolding = false;
            icon.classList.remove('active');
            progressRing.style.opacity = '0';
            progressRing.style.animation = 'none';
            void progressRing.offsetWidth;
            progressRing.style.animation = '';
        };

        icon.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        icon.addEventListener('mouseleave', onMouseLeave);

        // Hover effects
        icon.addEventListener('mouseenter', () => {
            icon.style.background = 'rgba(255, 255, 255, 1)';
            icon.style.borderColor = '#4a9eff';
            unlockIcon.style.color = '#4a9eff';
        });

        icon.addEventListener('mouseleave', () => {
            if (!isHolding) {
                icon.style.background = 'rgba(255, 255, 255, 0.9)';
                icon.style.borderColor = '#666666';
                unlockIcon.style.color = '#666666';
            }
        });

        icon.cleanup = () => {
            if (holdTimer) {
                clearTimeout(holdTimer);
            }
            document.removeEventListener('mouseup', onMouseUp);
            icon.remove();
        };

        container.appendChild(icon);
        container._unfreezeIcon = icon;

        updateUnfreezeIconPosition(container);

    } catch (error) {
        console.error('[showUnfreezeIcon] Failed to show unfreeze icon:', error);
    }
}

/**
 * Update unfreeze icon position based on visible cropped area
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function updateUnfreezeIconPosition(container) {
    if (!container) return;

    const icon = container._unfreezeIcon || container.querySelector('.wbe-unfreeze-icon');
    if (!icon) return;

    const imageElement = container.querySelector('.wbe-canvas-image');
    if (!imageElement) return;

    const imageId = container.id;
    const data = freezeEventHandlers.onGetImageData?.(imageId);
    if (!data) return;

    const { maskType, crop, circleOffset, circleRadius, scale } = data;
    const width = imageElement.offsetWidth;
    const height = imageElement.offsetHeight;

    if (width === 0 || height === 0) return;

    let offsetLeft, offsetTop;
    let iconSize = 12;
    let iconOffset = 8;

    if (maskType === 'rect') {
        offsetLeft = crop.left * scale;
        offsetTop = crop.top * scale;
    } else if (maskType === 'circle') {
        const fallback = Math.min(width, height) / 2;
        const currentRadius = (circleRadius == null) ? fallback : circleRadius;
        const centerX = width / 2 + circleOffset.x;
        const centerY = height / 2 + circleOffset.y;
        offsetLeft = (centerX - currentRadius) * scale;
        offsetTop = (centerY - currentRadius) * scale;
    }

    icon.style.left = `${offsetLeft - iconOffset}px`;
    icon.style.top = `${offsetTop - iconOffset}px`;
    icon.style.width = `${iconSize}px`;
    icon.style.height = `${iconSize}px`;

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
 * Hide unfreeze icon
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function hideUnfreezeIcon(container) {
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

        hideFrozenSelection(container);
        hideUnfreezeIcon(container);

        setImageFrozen(container.id, false, true);

        // Notify parent module to handle selection after unfreeze
        setTimeout(() => {
            freezeEventHandlers.onFreezeStateChange?.(container.id, false, container, false);
        }, 50);

        console.log('[handleUnfreezeAction] Successfully unfroze image:', container.id);

    } catch (error) {
        console.error('[handleUnfreezeAction] Failed to unfreeze image:', error);
    }
}

/**
 * Re-initialize all unfreeze icons
 */
function reinitializeUnfreezeIcons() {
    console.log('[reinitializeUnfreezeIcons] Re-initializing unfreeze icons...');

    const frozenImages = document.querySelectorAll('.wbe-canvas-image-container.wbe-image-frozen');
    let reinitCount = 0;

    frozenImages.forEach(container => {
        const imageId = container.id;
        if (isImageFrozen(imageId)) {
            hideUnfreezeIcon(container);
            showUnfreezeIcon(container);
            reinitCount++;
        }
    });

    console.log(`[reinitializeUnfreezeIcons] Re-initialized ${reinitCount} unfreeze icons`);
    return reinitCount;
}

/**
 * Setup canvas pass-through for frozen images
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function setupFrozenImageCanvasPassThrough(container) {
    if (!container) return;
    // Frozen images already have pointer-events: none set
    // No special handlers needed - canvas pan/zoom works automatically
}

/**
 * Remove canvas pass-through for frozen images
 * @param {HTMLElement} container - The .wbe-canvas-image-container element
 */
function removeFrozenImageCanvasPassThrough(container) {
    if (!container) return;
    // No cleanup needed since we don't install special handlers
}

// Export the public API (clean modular interface)
export const ImageFreezeManager = {
    // Core state management (this module's responsibility)
    setImageFrozen,
    isImageFrozen,

    // Freeze-specific UI (unfreeze icon only)
    showUnfreezeIcon,
    hideUnfreezeIcon,
    updateUnfreezeIconPosition,
    handleUnfreezeAction,
    reinitializeUnfreezeIcons,

    // Initialization
    initImageFreezeManager
};