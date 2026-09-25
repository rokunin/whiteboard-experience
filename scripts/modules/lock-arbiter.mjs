// scripts/modules/lock-arbiter.mjs
// Authoritative object-lock arbiter (pure logic, no DOM / no sockets).
//
// A single client (the Foundry activeGM) owns one instance of this table and is the
// sole authority that grants / denies / renews / releases locks. Every decision is a
// pure function of the table + current time, so it is fully unit-testable by injecting
// a deterministic clock.
//
// See specs/authoritative-lock-design.md for the full design.

// Timing defaults (see spec §6). Exported so the socket layer and tests share one source.
export const LOCK_TTL_MS = 15000;            // a lock is valid for this long after grant/renew
export const LOCK_RENEW_MS = 5000;           // owner sends a renew heartbeat this often
export const LOCK_REAP_MS = 5000;            // arbiter sweeps for expired locks this often
export const LOCK_ACQUIRE_TIMEOUT_MS = 3000; // requester gives up waiting for a grant after this

/**
 * @typedef {Object} Lock
 * @property {string} ownerId    - Foundry user id of the lock owner
 * @property {string} ownerName  - display name (for badge/overlay on other clients)
 * @property {number} expiresAt  - absolute ms timestamp (on the shared server clock)
 */

export class LockArbiter {
  /**
   * @param {() => number} now - clock function (injectable for tests); should return the
   *                             server-synchronized time in ms.
   * @param {number} ttl - lock time-to-live in ms.
   */
  constructor(now = () => Date.now(), ttl = LOCK_TTL_MS) {
    this._now = now;
    this._ttl = ttl;
    /** @type {Map<string, Lock>} */
    this.locks = new Map();
  }

  /**
   * Request a lock. Grants if the object is free, its lock is expired, or the requester
   * already owns it (idempotent renew-on-request). Denies if held by someone else.
   * @returns {{ result: 'granted'|'denied', lock: Lock }}
   */
  request(objectId, userId, userName) {
    const existing = this.locks.get(objectId);
    const now = this._now();
    if (existing && existing.expiresAt > now && existing.ownerId !== userId) {
      return { result: 'denied', lock: existing };
    }
    return { result: 'granted', lock: this._set(objectId, userId, userName, now) };
  }

  /**
   * Renew (heartbeat) an existing lock. Only the current, non-expired owner may renew.
   * @returns {{ result: 'granted'|'denied', lock: Lock|null }}
   */
  renew(objectId, userId) {
    const existing = this.locks.get(objectId);
    const now = this._now();
    if (!existing || existing.ownerId !== userId || existing.expiresAt <= now) {
      // Not the owner, unknown, or already expired -> caller must stop editing.
      const stillHeld = existing && existing.expiresAt > now ? existing : null;
      return { result: 'denied', lock: stillHeld };
    }
    existing.expiresAt = now + this._ttl;
    return { result: 'granted', lock: existing };
  }

  /**
   * Explicitly release a lock. Only the owner may release.
   * @returns {boolean} true if a lock was actually removed.
   */
  release(objectId, userId) {
    const existing = this.locks.get(objectId);
    if (existing && existing.ownerId === userId) {
      this.locks.delete(objectId);
      return true;
    }
    return false;
  }

  /**
   * Auto-grant a lock to a creator (create-then-edit shortcut). Unconditional set —
   * the caller (arbiter) is expected to broadcast the resulting grant to all clients.
   * @returns {Lock}
   */
  grantTo(objectId, userId, userName) {
    return this._set(objectId, userId, userName, this._now());
  }

  /**
   * Drop every lock owned by a user (call on that user's disconnect).
   * @returns {string[]} objectIds that were freed (caller broadcasts lockReleased for each).
   */
  releaseAllByUser(userId) {
    const freed = [];
    for (const [objectId, lock] of this.locks) {
      if (lock.ownerId === userId) {
        this.locks.delete(objectId);
        freed.push(objectId);
      }
    }
    return freed;
  }

  /**
   * Reaper sweep: remove all expired locks.
   * @returns {string[]} objectIds that were freed (caller broadcasts lockReleased for each).
   */
  reap() {
    const now = this._now();
    const freed = [];
    for (const [objectId, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(objectId);
        freed.push(objectId);
      }
    }
    return freed;
  }

  /**
   * Current owner id of an object, or null if free/expired. Does not mutate.
   * @returns {string|null}
   */
  getOwner(objectId) {
    const lock = this.locks.get(objectId);
    if (!lock || lock.expiresAt <= this._now()) return null;
    return lock.ownerId;
  }

  _set(objectId, userId, userName, now) {
    const lock = { ownerId: userId, ownerName: userName, expiresAt: now + this._ttl };
    this.locks.set(objectId, lock);
    return lock;
  }
}
