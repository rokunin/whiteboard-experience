/**
 * Text width modes (openspec change wbe-text-width-and-panel-focus, design D2-D5).
 *
 * 'auto'  - the width fits the content; refitted when the content or font changes.
 * 'fixed' - the width was set with a width/stretch handle and is kept; content wraps.
 * null    - saved before modes existed; resolved on the first width-affecting change.
 *
 * In every mode the width is stored in `textWidth`, so all clients break lines the same way.
 * The pure helpers (fitWidth, resolveTextWidthMode) are unit-tested; the DOM helpers measure
 * on a hidden clone, never on the live element.
 */

/** Rounding used for a fitted width: whole pixels plus 1px of slack for subpixel differences
 * between clients' font rendering. */
export function fitWidth(rawWidth) {
  return Math.ceil(rawWidth) + 1;
}

/**
 * The width mode a text should have.
 * @param {'auto'|'fixed'|null|undefined} mode  Stored mode.
 * @param {number|null} storedWidth            Stored textWidth.
 * @param {number} fittedWidth                 fitWidth() of the content's natural one-line width,
 *                                             measured with the text's CURRENT styles.
 * @returns {'auto'|'fixed'}
 */
export function resolveTextWidthMode(mode, storedWidth, fittedWidth) {
  if (mode === 'auto' || mode === 'fixed') return mode;
  if (!storedWidth || storedWidth <= 0) return 'auto';
  // Needing more room than it has means the text already wraps at its stored width: someone
  // shaped it, so keep the width (owner decision 2026-10-04).
  return fittedWidth > storedWidth + 1 ? 'fixed' : 'auto';
}

/**
 * Inline styles that size and wrap a text element for its width mode (design D4).
 * - auto: the stored fitted width, no wrapping; while editing, `width: auto` so the box grows
 *   as the user types (the fitted width is stored when editing ends).
 * - fixed: the stored width, wrapping, overlong words broken the same way in view and edit
 *   mode instead of being clipped after editing.
 * - legacy (null): exactly as before width modes existed.
 * @param {{textWidthMode: string|null, textWidth: number|null}} obj
 * @param {boolean} [editing=false]
 */
export function textWidthStyles(obj, editing = false) {
  const width = obj?.textWidth > 0 ? obj.textWidth : 0;
  if (obj?.textWidthMode === 'auto') {
    return editing || !width
      ? { width: 'auto', maxWidth: 'none', whiteSpace: 'nowrap', overflowWrap: '' }
      : { width: `${width}px`, maxWidth: '', whiteSpace: 'nowrap', overflowWrap: '' };
  }
  if (obj?.textWidthMode === 'fixed' && width) {
    return { width: `${width}px`, maxWidth: '', whiteSpace: 'normal', overflowWrap: 'anywhere' };
  }
  return width
    ? { width: `${width}px`, maxWidth: '', whiteSpace: '', overflowWrap: '' }
    : { width: 'auto', maxWidth: '400px', whiteSpace: '', overflowWrap: '' };
}

/** Applies textWidthStyles() to a text element. */
export function applyTextWidthStyles(textElement, obj, editing = false) {
  if (textElement) Object.assign(textElement.style, textWidthStyles(obj, editing));
}

/**
 * Natural one-line width of a text element, measured on a hidden clone with optional style or
 * content overrides (for a change that is about to be applied). Explicit line breaks still
 * break; nothing else wraps. The element's own min-width still applies.
 * @param {HTMLElement} textElement
 * @param {{fontSize?: number, fontFamily?: string, fontWeight?: string|number, fontStyle?: string, html?: string}} [overrides]
 * @returns {number} fitted width in px (see fitWidth)
 */
export function measureAutoTextWidth(textElement, overrides = {}) {
  const clone = textElement.cloneNode(true);
  const s = clone.style;
  s.position = 'absolute';
  s.left = '-99999px';
  s.top = '0';
  s.visibility = 'hidden';
  s.pointerEvents = 'none';
  s.width = 'auto';
  s.maxWidth = 'none';
  s.whiteSpace = 'nowrap';
  if (overrides.fontSize) s.fontSize = `${overrides.fontSize}px`;
  if (overrides.fontFamily) s.fontFamily = overrides.fontFamily;
  if (overrides.fontWeight) s.fontWeight = String(overrides.fontWeight);
  if (overrides.fontStyle) s.fontStyle = overrides.fontStyle;
  if (overrides.html !== undefined) {
    const span = clone.querySelector('.wbe-text-background-span');
    if (span) span.innerHTML = overrides.html;
  }
  document.body.appendChild(clone);
  const raw = clone.getBoundingClientRect().width;
  clone.remove();
  return fitWidth(raw);
}

/**
 * Width fields to merge into a registry update that changes a text's content or font.
 * Resolves a legacy (null) mode from the text as it is now, then refits an auto text with the
 * overrides applied. A fixed text keeps its width.
 * @param {{textWidthMode: string|null, textWidth: number|null}} obj
 * @param {HTMLElement|null} textElement
 * @param {object} [overrides] see measureAutoTextWidth
 * @returns {{textWidth?: number, textWidthMode?: 'auto'|'fixed'}}
 */
export function widthUpdateFor(obj, textElement, overrides = {}) {
  if (!obj || !textElement) return {};
  const known = obj.textWidthMode === 'auto' || obj.textWidthMode === 'fixed';
  const mode = known ? obj.textWidthMode : resolveTextWidthMode(null, obj.textWidth, measureAutoTextWidth(textElement));
  if (mode === 'fixed') return known ? {} : { textWidthMode: 'fixed' };
  const textWidth = measureAutoTextWidth(textElement, overrides);
  const changes = {};
  if (obj.textWidthMode !== 'auto') changes.textWidthMode = 'auto';
  if (obj.textWidth !== textWidth) changes.textWidth = textWidth;
  return changes;
}
