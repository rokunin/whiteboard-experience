// scripts/modules/lock-manager.mjs
// Orchestration layer for authoritative object locking.
//
// Wraps the pure LockArbiter and drives the request/grant/deny/renew/release protocol on
// top of an injected socket transport. One LockManager runs on every client:
//   - As a REQUESTER: acquires/renews/releases locks it wants, keeps a local "view" of
//     which objects are locked by whom (for entry guards + badges).
//   - As the ARBITER: only when this client is the Foundry activeGM, it owns the single
//     authoritative LockArbiter, answers lockRequest/lockRenew/lockRelease, runs the reaper,
//     and releases a user's locks on disconnect.
//
// All environment access (socket emit, clock, self identity, activeGM check, timers, and
// DOM lock rendering) is injected, so this module is unit-testable without Foundry/DOM.
//
// See specs/authoritative-lock-design.md.

import {
  LockArbiter,
  LOCK_TTL_MS,
  LOCK_RENEW_MS,
  LOCK_REAP_MS,
  LOCK_ACQUIRE_TIMEOUT_MS,
} from './lock-arbiter.mjs';

let _reqSeq = 0;
function nextRequestId(selfId) {
  _reqSeq = (_reqSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `${selfId || 'anon'}:${_reqSeq}`;
}

export class LockManager {
  /**
   * @param {object} deps
   * @param {(action: string, data: object) => void} deps.emit - broadcast a socket message.
   * @param {() => number} deps.now - server-synchronized clock (ms).
   * @param {() => string} deps.getSelfId - current user's id.
   * @param {() => string} deps.getSelfName - current user's display name.
   * @param {() => boolean} deps.isActiveGM - true if THIS client is the lock arbiter.
   * @param {() => boolean} deps.hasArbiter - true if an active GM exists anywhere (someone
   *        will answer lock requests). When false, editing is lock-free (spec §8).
   * @param {(objectId: string, ownerId: string, ownerName: string) => void} deps.onLockApplied
   *        - render another user's lock locally (badge/overlay + data-lockedBy).
   * @param {(objectId: string) => void} deps.onLockCleared - clear local lock rendering.
   * @param {object} [timers] - injectable timer fns (default to globals) for tests.
   */
  constructor(deps, timers = {}) {
    this._emit = deps.emit;
    this._now = deps.now;
    this._getSelfId = deps.getSelfId;
    this._getSelfName = deps.getSelfName;
    this._isActiveGM = deps.isActiveGM;
    this._hasArbiter = deps.hasArbiter || (() => true);
    this._onLockApplied = deps.onLockApplied || (() => {});
    this._onLockCleared = deps.onLockCleared || (() => {});

    this._setInterval = timers.setInterval || ((f, ms) => setInterval(f, ms));
    this._clearInterval = timers.clearInterval || ((h) => clearInterval(h));
    this._setTimeout = timers.setTimeout || ((f, ms) => setTimeout(f, ms));
    this._clearTimeout = timers.clearTimeout || ((h) => clearTimeout(h));

    // Arbiter table (only meaningful while this client is activeGM). Clock is shared.
    this._arbiter = new LockArbiter(this._now, LOCK_TTL_MS);
    this._reaperHandle = null;

    // Local view: objectId -> ownerId (who holds it, per broadcasts). Excludes our own held.
    this._view = new Map();

    // Locks WE currently hold: objectId -> { renewHandle }.
    this._held = new Map();

    // Pending acquire requests: requestId -> { objectId, resolve, timeoutHandle }.
    this._pending = new Map();
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Start the arbiter reaper if we are (or become) the activeGM. Idempotent. */
  startArbiterIfNeeded() {
    if (!this._isActiveGM()) return;
    if (this._reaperHandle != null) return;
    this._reaperHandle = this._setInterval(() => this._reap(), LOCK_REAP_MS);
  }

  /** Stop arbiter reaper (e.g. we lost activeGM role or on teardown). */
  stopArbiter() {
    if (this._reaperHandle != null) {
      this._clearInterval(this._reaperHandle);
      this._reaperHandle = null;
    }
  }

  /** Full teardown: stop all timers, clear pending. Local view is left to callers. */
  destroy() {
    this.stopArbiter();
    for (const [, held] of this._held) {
      if (held.renewHandle != null) this._clearInterval(held.renewHandle);
    }
    this._held.clear();
    for (const [, p] of this._pending) {
      if (p.timeoutHandle != null) this._clearTimeout(p.timeoutHandle);
    }
    this._pending.clear();
  }

  // ---- requester API -------------------------------------------------------

  /**
   * True if some OTHER user currently holds this object (per local view). Used by entry
   * guards to refuse selection/drag/edit/etc. Our own held locks return false.
   */
  isLockedByOther(objectId) {
    const owner = this._view.get(objectId);
    return owner != null && owner !== this._getSelfId();
  }

  /** Owner id for badge/messages, or null. */
  ownerOf(objectId) {
    return this._view.get(objectId) ?? null;
  }

  /** True if we currently hold the lock on this object. */
  isHeldBySelf(objectId) {
    return this._held.has(objectId);
  }

  /**
   * Object ids we currently hold the lock on. Read-only snapshot (a new array each call),
   * so callers can safely release() while iterating. Used e.g. to release every lock this
   * client holds on scene teardown, mirroring the isHeldBySelf-based release already used
   * on the GM-hide path.
   */
  heldObjectIds() {
    return Array.from(this._held.keys());
  }

  /**
   * Request a lock. Returns a Promise<boolean> resolving true if granted, false if denied
   * or timed out. If there is no active GM, resolves true immediately (lock-free local
   * editing per spec §8). If we already hold it, resolves true.
   */
  requestLock(objectId, objectType) {
    if (this._held.has(objectId)) return Promise.resolve(true);

    // No arbiter present -> lock-free local editing (single-user / GM-less session).
    if (!this._hasArbiter()) return Promise.resolve(true);

    const selfId = this._getSelfId();
    const selfName = this._getSelfName();
    const requestId = nextRequestId(selfId);

    return new Promise((resolve) => {
      const timeoutHandle = this._setTimeout(() => {
        if (this._pending.has(requestId)) {
          this._pending.delete(requestId);
          resolve(false); // acquire timeout (spec §6)
        }
      }, LOCK_ACQUIRE_TIMEOUT_MS);

      this._pending.set(requestId, { objectId, resolve, timeoutHandle });
      // Broadcast to other clients (the arbiter, if remote, answers). game.socket.emit does
      // NOT loop back to the sender, so if WE are the arbiter we must also process it locally.
      const payload = { objectId, objectType, userId: selfId, userName: selfName, requestId };
      this._emit('lockRequest', payload);
      if (this._isActiveGM()) this._onArbiterRequest(payload);
    });
  }

  /** Release a lock we hold (stops heartbeat, notifies arbiter). Safe if not held. */
  releaseLock(objectId) {
    const held = this._held.get(objectId);
    if (!held) return;
    if (held.renewHandle != null) this._clearInterval(held.renewHandle);
    this._held.delete(objectId);
    if (this._hasArbiter()) {
      const payload = { objectId, userId: this._getSelfId() };
      this._emit('lockRelease', payload);
      // No socket loopback: if we are the arbiter, apply the release to our own table too.
      if (this._isActiveGM()) this._onArbiterRelease(payload);
    }
  }

  // ---- message routing -----------------------------------------------------

  /**
   * Route an incoming socket message. Returns true if it was a lock-protocol message
   * (so the caller can stop further dispatch), false otherwise.
   */
  handleMessage(action, payload) {
    switch (action) {
      case 'lockRequest':  this._onArbiterRequest(payload);  return true;
      case 'lockRenew':    this._onArbiterRenew(payload);    return true;
      case 'lockRelease':  this._onArbiterRelease(payload);  return true;
      case 'lockGranted':  this._onGranted(payload);         return true;
      case 'lockDenied':   this._onDenied(payload);          return true;
      case 'lockReleased': this._onReleased(payload);        return true;
      default: return false;
    }
  }

  /**
   * Arbiter-side: auto-grant a freshly created object to its creator, then broadcast so all
   * clients render the lock (spec §5). Called on a 'created' message when this client is the
   * arbiter. `creatorId` is the user who created the object.
   */
  arbiterAutoGrantCreated(objectId, creatorId, creatorName) {
    if (!this._isActiveGM()) return;
    const lock = this._arbiter.grantTo(objectId, creatorId, creatorName);
    this._emitToClients('lockGranted', {
      objectId, ownerId: lock.ownerId, ownerName: lock.ownerName,
      expiresAt: lock.expiresAt, requestId: null,
    });
  }

  /** Arbiter-side: release all locks owned by a disconnected user, broadcast releases. */
  handleUserDisconnected(userId) {
    if (!this._isActiveGM()) return;
    for (const objectId of this._arbiter.releaseAllByUser(userId)) {
      this._emitToClients('lockReleased', { objectId });
    }
  }

  // ---- arbiter-side handlers ----------------------------------------------

  _onArbiterRequest({ objectId, userId, userName, requestId }) {
    if (!this._isActiveGM()) return;
    const { result, lock } = this._arbiter.request(objectId, userId, userName);
    if (result === 'granted') {
      this._emitToClients('lockGranted', {
        objectId, ownerId: lock.ownerId, ownerName: lock.ownerName,
        expiresAt: lock.expiresAt, requestId,
      });
    } else {
      this._emitToClients('lockDenied', {
        objectId, ownerId: lock.ownerId, ownerName: lock.ownerName, requestId,
      });
    }
  }

  _onArbiterRenew({ objectId, userId }) {
    if (!this._isActiveGM()) return;
    const { result, lock } = this._arbiter.renew(objectId, userId);
    if (result === 'granted') {
      this._emitToClients('lockGranted', {
        objectId, ownerId: lock.ownerId, ownerName: lock.ownerName,
        expiresAt: lock.expiresAt, requestId: null,
      });
    } else {
      // Renew refused: tell the (would-be) owner it lost the lock so it stops editing.
      this._emitToClients('lockReleased', { objectId });
    }
  }

  _onArbiterRelease({ objectId, userId }) {
    if (!this._isActiveGM()) return;
    if (this._arbiter.release(objectId, userId)) {
      this._emitToClients('lockReleased', { objectId });
    }
  }

  _reap() {
    if (!this._isActiveGM()) { this.stopArbiter(); return; }
    for (const objectId of this._arbiter.reap()) {
      this._emitToClients('lockReleased', { objectId });
    }
  }

  // ---- requester-side handlers --------------------------------------------

  _onGranted({ objectId, ownerId, ownerName, requestId }) {
    const selfId = this._getSelfId();

    // Resolve our pending request (if this grant is ours).
    this._resolvePending(requestId, objectId, true);

    if (ownerId === selfId) {
      // We own it -> ensure heartbeat is running, and it's not in the "others" view.
      this._view.delete(objectId);
      if (!this._held.has(objectId)) {
        const renewHandle = this._setInterval(() => {
          const p = { objectId, userId: selfId };
          this._emit('lockRenew', p);
          // No socket loopback: if we are the arbiter, renew against our own table too.
          if (this._isActiveGM()) this._onArbiterRenew(p);
        }, LOCK_RENEW_MS);
        this._held.set(objectId, { renewHandle });
      }
    } else {
      // Someone else owns it -> update view + render lock locally.
      this._view.set(objectId, ownerId);
      this._onLockApplied(objectId, ownerId, ownerName);
    }
  }

  _onDenied({ objectId, ownerId, ownerName, requestId }) {
    // Reflect the true owner in our view and render it.
    if (ownerId && ownerId !== this._getSelfId()) {
      this._view.set(objectId, ownerId);
      this._onLockApplied(objectId, ownerId, ownerName);
    }
    this._resolvePending(requestId, objectId, false);
  }

  _onReleased({ objectId }) {
    this._view.delete(objectId);
    // If WE were holding it and got force-released (renew refused / reaped), stop heartbeat.
    const held = this._held.get(objectId);
    if (held) {
      if (held.renewHandle != null) this._clearInterval(held.renewHandle);
      this._held.delete(objectId);
    }
    this._onLockCleared(objectId);
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Arbiter -> clients broadcast that also applies to OURSELVES. game.socket.emit does not
   * loop back to the sender, so the arbiter (which is also a participant that renders locks
   * and may hold locks itself) must self-deliver its own client-facing decisions.
   */
  _emitToClients(action, payload) {
    this._emit(action, payload);
    this._applyClientMessage(action, payload);
  }

  _applyClientMessage(action, payload) {
    switch (action) {
      case 'lockGranted':  this._onGranted(payload);  break;
      case 'lockDenied':   this._onDenied(payload);   break;
      case 'lockReleased': this._onReleased(payload); break;
    }
  }

  _resolvePending(requestId, objectId, granted) {
    if (requestId == null) return;
    const pending = this._pending.get(requestId);
    if (!pending || pending.objectId !== objectId) return;
    if (pending.timeoutHandle != null) this._clearTimeout(pending.timeoutHandle);
    this._pending.delete(requestId);
    pending.resolve(granted);
  }

}
