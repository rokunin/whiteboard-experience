/**
 * HandlerResolver - Centralized handler resolution system for event handling
 * 
 * ARCHITECTURE:
 * - Manages handlers by event type with priority-based resolution
 * - Handlers are sorted by priority (descending) with registration order as tiebreaker
 * - Provides resolve() to find first matching handler and execute() to run it
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

/**
 * @typedef {Object} Handler
 * @property {string} name - Unique handler name
 * @property {number} priority - Handler priority (higher = processed first)
 * @property {function(EventContext): boolean} canHandle - Returns true if handler can process the event
 * @property {function(EventContext): boolean} handle - Processes the event, returns true if handled
 */

/**
 * HandlerResolver class for managing and resolving event handlers by priority
 */
export class HandlerResolver {
  constructor() {
    /** @type {Map<string, Handler[]>} */
    this.handlers = new Map(); // eventType -> sorted handlers array
  }

  /**
   * Register a handler for an event type
   * Handlers are stored sorted by priority (descending), with registration order as tiebreaker
   * 
   * @param {string} eventType - Event type (e.g., 'mousedown', 'keydown')
   * @param {Handler} handler - Handler object with name, priority, canHandle, handle
   * @throws {TypeError} If handler is missing required properties
   */
  register(eventType, handler) {
    // Validate handler
    if (!handler || typeof handler !== 'object') {
      throw new TypeError('Handler must be an object');
    }
    if (typeof handler.name !== 'string' || !handler.name) {
      throw new TypeError('Handler must have a non-empty string "name" property');
    }
    if (typeof handler.priority !== 'number' || !Number.isFinite(handler.priority)) {
      throw new TypeError('Handler must have a finite number "priority" property');
    }
    if (typeof handler.canHandle !== 'function') {
      throw new TypeError('Handler must have a "canHandle" function');
    }
    if (typeof handler.handle !== 'function') {
      throw new TypeError('Handler must have a "handle" function');
    }

    // Get or create handlers array for this event type
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    const handlers = this.handlers.get(eventType);

    // Check for duplicate name - warn and replace
    const existingIndex = handlers.findIndex(h => h.name === handler.name);
    if (existingIndex !== -1) {
      console.warn(`[HandlerResolver] Handler "${handler.name}" already registered for "${eventType}", replacing`);
      handlers.splice(existingIndex, 1);
    }

    // Insert in sorted position (descending by priority)
    // For equal priorities, new handler goes after existing ones (registration order tiebreaker)
    let insertIndex = handlers.length;
    for (let i = 0; i < handlers.length; i++) {
      if (handler.priority > handlers[i].priority) {
        insertIndex = i;
        break;
      }
    }
    handlers.splice(insertIndex, 0, handler);
  }

  /**
   * Unregister a handler by name
   * 
   * @param {string} eventType - Event type
   * @param {string} handlerName - Handler name to remove
   * @returns {boolean} True if handler was found and removed
   */
  unregister(eventType, handlerName) {
    const handlers = this.handlers.get(eventType);
    if (!handlers) return false;

    const index = handlers.findIndex(h => h.name === handlerName);
    if (index !== -1) {
      handlers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Resolve the first handler that can handle the event
   * 
   * @param {string} eventType - Event type
   * @param {EventContext} ctx - Event context
   * @returns {Handler|null} First matching handler or null if none match
   */
  resolve(eventType, ctx) {
    const handlers = this.handlers.get(eventType);
    if (!handlers || handlers.length === 0) {
      return null;
    }

    for (const handler of handlers) {
      try {
        if (handler.canHandle(ctx)) {
          return handler;
        }
      } catch (error) {
        console.error(`[HandlerResolver] Error in canHandle for "${handler.name}":`, error);
        // Skip to next handler on error
      }
    }

    return null;
  }

  /**
   * Execute the first matching handler for the event
   * 
   * @param {string} eventType - Event type
   * @param {EventContext} ctx - Event context
   * @returns {boolean} Result from handler.handle() or false if no handler matched
   */
  execute(eventType, ctx) {
    const handler = this.resolve(eventType, ctx);
    if (!handler) {
      return false;
    }

    try {
      return handler.handle(ctx);
    } catch (error) {
      console.error(`[HandlerResolver] Error in handle for "${handler.name}":`, error);
      return false;
    }
  }

  /**
   * Get all handlers for an event type (for debugging/testing)
   * 
   * @param {string} eventType - Event type
   * @returns {Handler[]} Array of handlers (copy)
   */
  getHandlers(eventType) {
    const handlers = this.handlers.get(eventType);
    return handlers ? [...handlers] : [];
  }

  /**
   * Clear all handlers for an event type
   * 
   * @param {string} eventType - Event type
   */
  clear(eventType) {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }
}
