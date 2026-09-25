// scripts/modules/fractional-index.mjs
// Fractional indexing library for ordering objects without conflicts
//
// Uses an alphabet where we can always find a char "before" any given char.
// The trick: use ASCII chars starting from '!' (33) which is before '0' (48).

// Alphabet: printable ASCII from '!' to '~' (33-126), excluding problematic chars
// This gives us ~90 chars with '!' being the smallest
const ALPHABET_START = 33;  // '!'
const ALPHABET_END = 126;   // '~'

// Build alphabet string, skipping chars that might cause issues in JSON/URLs
function buildAlphabet() {
  let alph = '';
  for (let i = ALPHABET_START; i <= ALPHABET_END; i++) {
    const c = String.fromCharCode(i);
    // Skip: " ' \ ` (could cause escaping issues)
    if (c !== '"' && c !== "'" && c !== '\\' && c !== '`') {
      alph += c;
    }
  }
  return alph;
}

export const ALPH = buildAlphabet();
const BASE = ALPH.length;
const idx = (c) => {
  const i = ALPH.indexOf(c);
  return i >= 0 ? i : -1;
};

const SMALLEST = ALPH[0];
const MID = Math.floor(BASE / 2);

/**
 * Returns a rank string strictly between a and b (lexicographically)
 * 
 * Special case: when b starts with ALPH[0] (smallest char), we can't find
 * a single char between "" and b[0]. In this case, we need to return
 * a string that's lexicographically smaller than b.
 * 
 * Key insight: "!" < "!X" for any X, because shorter string is "less"
 * when they share a prefix. But we need something < "!", not < "!X".
 * 
 * The ONLY strings < "!" are:
 * 1. Empty string ""
 * 2. Strings starting with a char < '!' (but '!' is our smallest)
 * 
 * So it's IMPOSSIBLE to return a non-empty string < "!" with this alphabet.
 * 
 * SOLUTION: We need to handle this at a higher level. When we hit the
 * minimum, we should either:
 * 1. Rebalance all ranks (expensive)
 * 2. Accept a practical limit on prepends
 * 3. Use a different representation
 * 
 * For now, we'll throw an error when this happens, so the caller knows
 * to handle it (e.g., by rebalancing).
 * 
 * @param {string} a - Lower bound rank (empty string means -infinity)
 * @param {string} b - Upper bound rank (empty string means +infinity)
 * @returns {string} A rank between a and b
 */
export function rankBetween(a = "", b = "") {
  // Special case: if b is non-empty and starts with smallest char,
  // and a is empty, we have a problem
  if (!a && b && idx(b[0]) === 0) {
    // b starts with smallest char, e.g., "!" or "!xyz"
    // We need to find something between "" and "!..."
    // 
    // If b has more chars after the first, we can work with that:
    // rankBetween("", "!xyz") -> "!" + rankBetween("", "xyz")
    if (b.length > 1) {
      return SMALLEST + rankBetween("", b.slice(1));
    }
    // b is just "!" - we can't go lower
    // Return a special marker or throw
    throw new Error(`rankBetween: cannot find rank before minimum "${b}". Consider rebalancing.`);
  }
  
  let i = 0, res = "";
  
  for (let safety = 0; safety < 1000; safety++) {
    const ac = i < a.length ? idx(a[i]) : -1;
    const bc = i < b.length ? idx(b[i]) : BASE;
    
    if (ac + 1 < bc) {
      const mid = Math.floor((ac + bc) / 2);
      return res + ALPH[mid];
    }
    
    res += i < a.length ? a[i] : SMALLEST;
    i++;
  }
  
  throw new Error(`rankBetween: exceeded max iterations for a="${a}", b="${b}"`);
}

/**
 * Returns a rank before the first element
 * 
 * Strategy: Find the leftmost char that can be decremented, decrement it,
 * and append a middle char to leave room for future insertions.
 * 
 * @param {string} first - The first rank in the list
 * @returns {string} A rank that comes before first
 */
export function rankBefore(first = "") {
  if (!first) {
    return ALPH[MID];
  }
  
  // Find the leftmost char that can be decremented
  for (let i = 0; i < first.length; i++) {
    const c = idx(first[i]);
    if (c > 0) {
      // Decrement this char and append middle char for future space
      return first.slice(0, i) + ALPH[c - 1] + ALPH[MID];
    }
  }
  
  // All chars are the smallest ('!'), e.g., "!", "!!", "!!!"
  // We can't go lower with this alphabet.
  // Throw an error so caller can handle (e.g., rebalance)
  throw new Error(`rankBefore: cannot find rank before minimum "${first}". Consider rebalancing.`);
}

/**
 * Returns a rank after the last element
 * @param {string} last - The last rank in the list
 * @returns {string} A rank that comes after last
 */
export function rankAfter(last = "") {
  return rankBetween(last || "", "");
}

