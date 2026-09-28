/**
 * Pure, dependency-free math for alignment-guides.mjs (no `window`/`Hooks`/DOM - safe to import
 * from vitest). Split out by wbe-alignment-guides-fix so the threshold-conversion and hysteresis
 * decisions - the two things the audit found actually broken - can be unit-tested directly,
 * instead of only through a live Foundry canvas.
 *
 * alignment-guides.mjs (the DOM-coupled class: candidate geometry, drawing, event wiring) is the
 * only importer. See that file's own header for the feature this supports.
 */

/** The owner's decision (product-decisions.md, "16b."): thresholds in SCREEN pixels, not world
 * units - show a guide within 8px, snap within 5px, release (once locked) only beyond 10px,
 * switch to a different target only when it is at least 2px clearly closer. */
export const DEFAULT_THRESHOLDS_PX = { guide: 8, snap: 5, release: 10, switchMargin: 2 };

/**
 * Converts the fixed screen-pixel thresholds to the WORLD units candidate distances are measured
 * in (`_getObjectBounds` divides screen measurements by canvas scale). `1 world unit = zoom
 * screen px`, so a SCREEN threshold becomes a SMALLER world distance at higher zoom (zoomed in:
 * less world-space movement needed for the same on-screen distance) and a LARGER one at lower
 * zoom (zoomed out: more world-space movement needed) - the bug this replaces used a fixed WORLD
 * threshold (2), which is why guides "almost never fire when zoomed out and over-trigger when
 * zoomed in" (the same 2 world units is 0.4 screen px at zoom 0.2, 10 screen px at zoom 5).
 */
export function computeThresholdsWorld(zoom, screenPx = DEFAULT_THRESHOLDS_PX) {
  const z = typeof zoom === 'number' && zoom > 0 ? zoom : 1;
  return {
    guide: screenPx.guide / z,
    snap: screenPx.snap / z,
    release: screenPx.release / z,
    switchMargin: screenPx.switchMargin / z,
  };
}

/** Picks the closest of a list of candidates (`{ dist, ... }`, `null`/`undefined` entries
 * skipped) - ties keep whichever came first. Used both for the raw "best this frame" pick and,
 * inside `resolveSnapHysteresis`, to decide whether a strictly different target has appeared. */
export function pickBestFromMany(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || c.dist < best.dist) best = c;
  }
  return best;
}

/**
 * The hysteresis decision (product-decisions.md "16b.", replacing "recomputed from the raw
 * pointer every mousemove" - the audited cause of both snap-target flicker and rapid guide
 * add/remove toggling at a boundary): given the target a slot (a guide "line", e.g. one axis's
 * center-alignment, edge-alignment, or equal-spacing candidate) is currently locked onto, and
 * this frame's fresh candidates for that same slot, decides whether to keep, switch, or release.
 *
 * `locked` is `null` or a previous return value's own `.locked` (carries an `identity` tag).
 * `candidates` is an array of `{ dist, offset, guide, ...anything }` (world units; `null`/
 * `undefined` entries allowed and skipped) - for a single-candidate slot (center, spacing) this
 * is a one-element array; for an edge slot it is every edge sub-type (left/right/leftRight/
 * rightLeft) so a locked one can be told apart from a freshly-better one. `identity(candidate)`
 * must return a value equal for "the same real-world target" across frames (e.g. a sub-type tag
 * plus the target position) - used only to tell "still the same thing, just recomputed" apart
 * from "a genuinely different target".
 *
 * Rules: not yet locked -> lock onto the best candidate at or under `thresholds.snap`. Locked ->
 * stay locked (using THIS FRAME's recomputed distance/offset for the same target) as long as its
 * distance is at or under `thresholds.release`, UNLESS a candidate with a DIFFERENT identity is
 * at least `thresholds.switchMargin` closer, in which case switch to it. A lock whose own target
 * has drifted past `thresholds.release` is dropped.
 *
 * Returns `{ locked, show, snap }`: `locked` is the new state to pass back in next frame (or
 * `null`); `show` is the candidate whose guide line should be drawn this frame (locked, OR - not
 * locked - anything still within `thresholds.guide`), or `null`; `snap` is the candidate whose
 * `offset` should actually be applied (only when actually locked), or `null`.
 */
export function resolveSnapHysteresis(locked, candidates, thresholds, identity) {
  const list = candidates.filter(Boolean);
  const overallBest = pickBestFromMany(list);
  let nowLocked = null;

  if (locked) {
    const same = list.find((c) => identity(c) === locked.identity) || null;
    if (!same || same.dist > thresholds.release) {
      nowLocked = null; // the locked target itself is gone or has drifted past release
    } else if (
      overallBest &&
      identity(overallBest) !== locked.identity &&
      overallBest.dist < same.dist - thresholds.switchMargin
    ) {
      nowLocked = { ...overallBest, identity: identity(overallBest) };
    } else {
      nowLocked = { ...same, identity: locked.identity };
    }
  } else if (overallBest && overallBest.dist <= thresholds.snap) {
    nowLocked = { ...overallBest, identity: identity(overallBest) };
  }

  if (nowLocked) return { locked: nowLocked, show: nowLocked, snap: nowLocked };
  if (overallBest && overallBest.dist <= thresholds.guide) return { locked: null, show: overallBest, snap: null };
  return { locked: null, show: null, snap: null };
}
