// scripts/modules/fractional-index.mjs
// Fractional indexing library for ordering objects without conflicts

export const ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPH.length;
const idx = (c) => ALPH.indexOf(c);

/**
 * Returns a rank string strictly between a and b (lexicographically)
 * @param {string} a - Lower bound rank (empty string means -infinity)
 * @param {string} b - Upper bound rank (empty string means +infinity)
 * @returns {string} A rank between a and b
 */
export function rankBetween(a = "", b = "") {
  let i = 0, res = "";
  for (;;) {
    const ac = i < a.length ? idx(a[i]) : -1;
    const bc = i < b.length ? idx(b[i]) : BASE;
    if (ac + 1 < bc) {
      const mid = Math.floor((ac + bc) / 2);
      return res + ALPH[mid];
    }
    res += i < a.length ? a[i] : ALPH[0];
    i++;
  }
}

/**
 * Returns a rank before the first element
 * @param {string} first - The first rank in the list
 * @returns {string} A rank that comes before first
 */
export function rankBefore(first = "") {
  return rankBetween("", first || "");
}

/**
 * Returns a rank after the last element
 * @param {string} last - The last rank in the list
 * @returns {string} A rank that comes after last
 */
export function rankAfter(last = "") {
  return rankBetween(last || "", "");
}

