/**
 * Pure hotkey-gating logic for the "Disable all WBE hotkeys" / "Disable tool hotkeys" client
 * settings (openspec/changes/wbe-toolbar-collapse). Zero `window`/`game`/DOM references, so it is
 * safely importable from vitest and from any WBE module - unlike the two client settings
 * themselves, which only `main.mjs` reads (it owns `MODULE_ID` and every `game.settings` call in
 * this module); `shapes.mjs`/`connectors.mjs` reach this logic indirectly, through
 * `window.WBE_isAllHotkeysDisabled`/`window.WBE_isHotkeyBlocked` (main.mjs wraps this module and
 * exposes those two globals), matching the existing `window.WBE_isFeatureEnabled` convention for
 * cross-module state.
 *
 * "Tool-activation" keys CREATE or ACTIVATE a tool (`S`/`C`/`F`/`T`/`B` today - rectangle, circle,
 * freehand, text, connector). "Object hotkeys" (`Delete`/`Backspace`, `Ctrl+C`/`Ctrl+V`/`Ctrl+Z`,
 * `Ctrl+Shift+Z`, `PageUp`/`PageDown`) act on an already-selected object and are NOT in this set -
 * they keep working even while "Disable tool hotkeys" is on.
 */

/** `KeyboardEvent.code` values for keys that create/activate a tool. */
export const TOOL_ACTIVATION_CODES = Object.freeze(['KeyS', 'KeyC', 'KeyF', 'KeyT', 'KeyB']);

const TOOL_ACTIVATION_SET = new Set(TOOL_ACTIVATION_CODES);

/** @param {string} code - a `KeyboardEvent.code` value, e.g. `'KeyS'` */
export function isToolActivationCode(code) {
  return TOOL_ACTIVATION_SET.has(code);
}

/**
 * @param {string} code - the `KeyboardEvent.code` of the key that was pressed
 * @param {{allDisabled?: boolean, toolHotkeysDisabled?: boolean}} [settings]
 * @returns {boolean} `true` if this keypress must be ignored by WBE
 */
export function isHotkeyBlocked(code, settings = {}) {
  const { allDisabled = false, toolHotkeysDisabled = false } = settings;
  if (allDisabled) return true;
  if (toolHotkeysDisabled && isToolActivationCode(code)) return true;
  return false;
}

/**
 * Display rule for the settings popup's own "Disable tool hotkeys" checkbox: "All" implies it, so
 * it shows checked and non-interactive while "All" is on, without that being written back into
 * the `toolHotkeysDisabled` setting's own stored value (see design.md Decision 4 - unchecking
 * "All" later must restore whatever "Disable tool hotkeys" was actually set to beforehand).
 * @param {{allDisabled?: boolean, toolHotkeysDisabled?: boolean}} [settings]
 * @returns {{checked: boolean, locked: boolean}}
 */
export function getToolHotkeysToggleDisplay(settings = {}) {
  const { allDisabled = false, toolHotkeysDisabled = false } = settings;
  return { checked: allDisabled || toolHotkeysDisabled, locked: allDisabled };
}
