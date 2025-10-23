# 🔴 CODE QUALITY REPORT - fate-table-card

## 📊 Summary
- **Total issues found**: 13
- **Critical**: 3
- **Serious**: 3
- **Medium**: 7
- **Total lines analyzed**: 4564

---

## 🏗️ **Overall Architecture**

This is a **FoundryVTT module** that provides:
1. **Character cards** (FATE system) synchronized across all users
2. **Canvas text elements** (placeable, scalable, editable)
3. **Canvas image elements** (with cropping, circular/rectangular masks)
4. **Real-time synchronization** via sockets between GM and players
5. **Canvas layer management** with world ↔ screen coordinate transformations

---

## ✅ **Strengths**

1. **Feature-rich implementation** - Comprehensive FATE card system with approaches, aspects, stress, consequences
2. **Real-time sync** - Socket-based updates work well for multiplayer
3. **Canvas integration** - Clever use of Pixi.js transforms for coordinate mapping
4. **UI polish** - Drag, resize, crop modes with visual handles
5. **Clipboard integration** - Paste images/text from system clipboard
6. **Good use of Handlebars templates** - Clean separation of markup

---

## 🔴 **CRITICAL ISSUES**

### **1️⃣ SEVERE MEMORY LEAK - Event Handler Accumulation**

**Location**: Lines 3580, 3726-3739, 3764-3835

**Problem**:
```javascript
// Added EVERY time _bind() is called (on every render):
document.addEventListener("click", () => {
  menuDropdown.classList.remove("show");
});

document.addEventListener("paste", pasteHandler);

nameInput.addEventListener("input", ...);
nameInput.addEventListener("blur", ...);
```

**Why it's critical**:
- Event listeners **never removed** or deduplicated
- Every card render adds duplicate handlers
- 10 cards × 5 renders = **150+ duplicate handlers**
- Closures prevent garbage collection
- **Result**: Browser crash with memory exhaustion after extended use

**How to fix**:
```javascript
class FateTableCardApp {
  constructor(...args) {
    super(...args);
    this._handlers = new Map(); // Store handler references
  }

  _bind(root) {
    // REMOVE old handlers first
    this._cleanupEventHandlers();
    
    const menuButton = root.querySelector(".ftc-menu-button");
    const menuDropdown = root.querySelector(".ftc-menu-dropdown");
    
    if (menuButton && menuDropdown) {
      // Store new handlers
      const menuClick = () => {
          menuDropdown.classList.remove("show");
          menuButton.classList.remove("active");
      };
      
      this._handlers.set('menuClick', menuClick);
      document.addEventListener("click", menuClick);
    }
    
    // Similar for name input handlers
    const nameInput = root.querySelector(".ftc-name");
    if (nameInput) {
      const inputHandler = (e) => {
        this.cardData.name = e.target.value;
        nameDisplay.textContent = this.cardData.name;
      };
      
      const blurHandler = async (e) => {
        await updateCardState(this.cardId, { name: this.cardData.name });
      };
      
      const keydownHandler = async (e) => {
        if (e.key === "Enter") e.target.blur();
      };
      
      this._handlers.set('nameInput', { element: nameInput, type: 'input', handler: inputHandler });
      this._handlers.set('nameBlur', { element: nameInput, type: 'blur', handler: blurHandler });
      this._handlers.set('nameKeydown', { element: nameInput, type: 'keydown', handler: keydownHandler });
      
      nameInput.addEventListener("input", inputHandler);
      nameInput.addEventListener("blur", blurHandler);
      nameInput.addEventListener("keydown", keydownHandler);
    }
    
    // Similar for paste handler
      const pasteHandler = async (e) => {
        if (document.activeElement !== portraitDiv) return;
      // ... paste logic
      };
      
    this._handlers.set('paste', pasteHandler);
      document.addEventListener("paste", pasteHandler);
  }

  _cleanupEventHandlers() {
    for (const [key, data] of this._handlers) {
      if (typeof data === 'function') {
        // Document-level handlers
        const eventType = key.replace('Click', '').replace('Paste', 'paste').toLowerCase();
        document.removeEventListener(eventType, data);
      } else if (data.element && data.handler) {
        // Element-specific handlers
        data.element.removeEventListener(data.type, data.handler);
      }
    }
    this._handlers.clear();
  }

  async close(options) {
    // CRITICAL: cleanup on close
    this._cleanupEventHandlers();
    return super.close(options);
  }
}
```

---

### **2️⃣ Global State Pollution**

**Location**: Lines 512-525

**Problem**:
```javascript
// Global variables WITHOUT cleanup or scoping
let copiedTextData = null;
let copiedImageData = null;
let selectedTextId = null;
let selectedImageId = null;
let globalImageData = {}; // Never cleared
let imageLocalVars = {}; // Never cleared
```

**Issues**:
- Shared across ALL instances and scenes
- Race conditions possible with multiple users
- No cleanup when scene changes
- Data persists after element deletion
- Memory accumulation over time

**How to fix**:
```javascript
// Create a manager class
class CanvasElementManager {
  constructor() {
    this.clipboard = {
      text: null,
      image: null
    };
    this.selection = {
      textId: null,
      imageId: null
    };
    this.imageData = new Map(); // Use Map for better performance
    this.imageVars = new Map();
  }
  
  reset() {
    this.clipboard = { text: null, image: null };
    this.selection = { textId: null, imageId: null };
    this.imageData.clear();
    this.imageVars.clear();
  }
  
  copyText(id, data) {
    this.clipboard.text = data;
    this.clipboard.image = null;
    this.selection.textId = id;
  }
  
  copyImage(id, data) {
    this.clipboard.image = data;
    this.clipboard.text = null;
    this.selection.imageId = id;
  }
}

// Create instance per scene
Hooks.on('canvasReady', () => {
  if (!game.fateElements) {
    game.fateElements = new CanvasElementManager();
  } else {
    game.fateElements.reset();
  }
});

Hooks.on('canvasTearDown', () => {
  game.fateElements?.reset();
});

// Replace all global variable access with:
// copiedTextData → game.fateElements.clipboard.text
// selectedTextId → game.fateElements.selection.textId
// globalImageData[id] → game.fateElements.imageData.get(id)
```

---

### **3️⃣ Socket Flooding / Inefficient Synchronization**

**Location**: Lines 136-177, 218-269, 316-361

**Problem**:
```javascript
// Every text edit sends FULL object to ALL users:
await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, data.texts);
game.socket.emit(`module.${MODID}`, { 
  type: "textUpdate", 
  texts: data.texts // Sends ALL texts
});

// No debouncing on frequent updates
async function handleMouseMove(e) {
  // ... update position
  await setAllTexts(texts); // Saves to DB on EVERY mousemove!
}
```

**Issues**:
- Sends **entire collection** on every change (100 texts = huge payload)
- No debouncing → drag generates 60 updates/second
- Database writes on every mousemove → performance killer
- Network congestion with multiple users editing
- Players spam GM with update requests

**How to fix**:
```javascript
// 1. Implement debouncing for database saves
const debouncedSaveText = debounce(async (id, textData) => {
  const texts = await getAllTexts();
  texts[id] = textData;
  await setAllTexts(texts);
}, 300); // Save max once per 300ms

// 2. Send delta updates instead of full sync
game.socket.emit(`module.${MODID}`, { 
  type: "textDelta", 
  id: textId,
  changes: { left: newLeft, top: newTop } // Only changed fields
});

// 3. Batch updates during drag
let pendingUpdates = new Map();
let updateTimer = null;

function scheduleUpdate(id, changes) {
  pendingUpdates.set(id, { 
    ...pendingUpdates.get(id), 
    ...changes 
  });
  
  if (updateTimer) clearTimeout(updateTimer);
  
  updateTimer = setTimeout(async () => {
    const batch = Array.from(pendingUpdates.entries());
    pendingUpdates.clear();
    
    // Send batch to server
    game.socket.emit(`module.${MODID}`, {
      type: "batchUpdate",
      updates: batch
    });
    
    // Save to DB (debounced)
    for (const [id, changes] of batch) {
      await debouncedSaveText(id, changes);
    }
  }, 50);
}

// 4. In drag handler
async function handleMouseMove(e) {
  // ... calculate new position
  container.style.left = `${newLeft}px`;
  container.style.top = `${newTop}px`;
  
  // Schedule update instead of immediate save
  scheduleUpdate(id, { left: newLeft, top: newTop });
}

async function handleMouseUp() {
  // Force immediate save on release
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
  
  const texts = await getAllTexts();
  texts[id] = {
    text: textElement.textContent,
    left: parseFloat(container.style.left),
    top: parseFloat(container.style.top),
    scale: currentScale
  };
  await setAllTexts(texts);
}
```

---

## ⚠️ **SERIOUS ISSUES**

### **4️⃣ Missing Error Boundaries**

**Location**: Throughout (lines 2495+, 3089+, etc.)

**Problem**:
   ```javascript
async function addTextToCanvas(clickX, clickY) {
  if (!canvas || !canvas.ready) {
    ui.notifications.warn("Canvas не готов");
    return; // Silent fail - no indication why
  }
  // No try/catch for rest of function
  // Any error here crashes entire module
}
```

**Issues**:
- Errors crash entire module
- No recovery mechanism
- User sees broken state with no explanation
- Console errors but no user-facing messages

**How to fix**:
```javascript
// Create error handler utility
function handleModuleError(context, error, userMessage = null) {
  console.error(`[FATE-TC] Error in ${context}:`, error);
  ui.notifications.error(userMessage || `Error in ${context}: ${error.message}`);
  
  // Optional: Send telemetry/logging
if (game.user.isGM) {
    console.warn(`[FATE-TC] Stack trace:`, error.stack);
  }
}

// Wrap all async functions
async function addTextToCanvas(clickX, clickY) {
  try {
    if (!canvas?.ready) {
      throw new Error("Canvas not ready");
    }
    
    // ... rest of function
    
  } catch (err) {
    handleModuleError('addTextToCanvas', err, 'Failed to add text to canvas');
    return null;
  }
}

// Wrap socket handlers
game.socket.on(`module.${MODID}`, async (data) => {
  try {
    if (!data || !data.type) return;
    
    // ... handler logic
    
  } catch (err) {
    handleModuleError('socket handler', err, 'Synchronization error occurred');
  }
});

// Wrap event handlers
textElement.addEventListener("blur", async () => {
  try {
    if (isEditing) {
      // ... save logic
    }
  } catch (err) {
    handleModuleError('text blur', err, 'Failed to save text changes');
  }
});
```

---

### **5️⃣ Coordinate Transform Fragility**

**Location**: Lines 449-471, 1214-1237

**Problem**:
```javascript
function screenToWorld(screenX, screenY) {
  if (!canvas?.ready || !canvas?.stage?.worldTransform) {
    console.warn("[FATE-TC] Canvas not ready, using screen coordinates");
    return { x: screenX, y: screenY }; // WRONG FALLBACK!
  }
  // ... transform logic
}
```

**Issues**:
- Falls back to screen coordinates when canvas not ready
- Objects placed at wrong positions
- Silent failure - user doesn't know something is wrong
- Can result in elements placed outside visible area

**How to fix**:
```javascript
function screenToWorld(screenX, screenY) {
  if (!canvas?.ready || !canvas?.stage?.worldTransform) {
    throw new Error("Cannot convert coordinates: canvas not ready");
  }
  
  try {
    const transform = canvas.stage.worldTransform;
    const inverted = transform.clone().invert();
    const point = inverted.apply({ x: screenX, y: screenY });
    return { x: point.x, y: point.y };
  } catch (e) {
    console.error("[FATE-TC] Transform error:", e);
    throw new Error(`Coordinate transformation failed: ${e.message}`);
  }
}

// All callers must handle the error:
async function addTextToCanvas(clickX, clickY) {
  try {
    const worldPos = screenToWorld(clickX, clickY);
    // ... use worldPos
  } catch (err) {
    ui.notifications.warn("Please wait for canvas to load before adding elements");
    console.warn("[FATE-TC]", err);
    return;
  }
}

// Alternative: Add retry logic
async function screenToWorldWithRetry(screenX, screenY, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return screenToWorld(screenX, screenY);
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
```

---

### **6️⃣ Regex Parsing in Hot Path**

**Location**: Lines 1092-1094, 1246-1248, 1304-1306, 1505-1507 (used 50+ times throughout)

**Problem**:
```javascript
// Called on EVERY mousemove during drag/resize (60fps):
const transform = element.style.transform || "";
const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
```

**Issues**:
- Regex parsing executed 60 times per second during interactions
- CPU spike during drag/resize operations
- Unnecessary garbage collection from string operations
- Performance degradation with multiple elements

**How to fix**:
```javascript
// Create a caching class for transform values
class TransformCache {
  constructor(element) {
    this.element = element;
    this._scale = 1;
    this._needsUpdate = true;
    this._observer = null;
  }
  
  get scale() {
    if (this._needsUpdate) {
      this._parseTransform();
    }
    return this._scale;
  }
  
  set scale(value) {
    this._scale = value;
    this.element.style.transform = `scale(${value})`;
    this._needsUpdate = false;
  }
  
  _parseTransform() {
    const transform = this.element.style.transform || "";
    const match = transform.match(/scale\(([\d.]+)\)/);
    this._scale = match ? parseFloat(match[1]) : 1;
    this._needsUpdate = false;
  }
  
  invalidate() {
    this._needsUpdate = true;
  }
  
  destroy() {
    if (this._observer) {
      this._observer.disconnect();
    }
  }
}

// Usage in createTextElement / createImageElement:
const transformCache = new TransformCache(textElement);

// In resize handler:
function handleResize(e) {
  if (!resizing) return;
  
  const deltaX = e.clientX - resizeStartX;
  const newScale = resizeStartScale + (deltaX * 0.002);
  const clampedScale = Math.max(0.3, Math.min(3.0, newScale));
  
  // Use cache instead of regex
  transformCache.scale = clampedScale;
  
  updateHandlePosition();
}

// Alternative: Store scale as data attribute
textElement.dataset.scale = scale;
textElement.style.transform = `scale(${scale})`;

// Then read directly:
const scale = parseFloat(textElement.dataset.scale) || 1;
```

---

## ⚡ **MEDIUM PRIORITY ISSUES**

### **7️⃣ Inefficient DOM Queries**

**Location**: Lines 184, 274, 1015, 1241, etc. (repeated throughout)

**Problem**:
```javascript
// Queried multiple times per second:
const layer = document.getElementById("fate-cards-layer");
```

**How to fix**:
```javascript
// Cache at module scope with invalidation
let layerCache = null;

function getLayer() {
  if (!layerCache || !document.contains(layerCache)) {
    layerCache = document.getElementById("fate-cards-layer");
  }
  return layerCache;
}

// Invalidate when needed
Hooks.on('canvasReady', () => {
  layerCache = null;
  createCardsLayer();
});

Hooks.on('canvasTearDown', () => {
  layerCache = null;
});
```

---

### **8️⃣ Magic Numbers Everywhere**

**Location**: Lines 1286, 2434, 3540, etc.

**Problem**:
```javascript
const newScale = resizeStartScale + (deltaX * 0.002); // What is 0.002?
const clampedScale = Math.max(0.3, Math.min(3.0, newScale)); // Why 0.3 and 3.0?
```

**How to fix**:
```javascript
// At top of file:
const CONFIG = {
  SCALE: {
    MIN: 0.3,
    MAX: 3.0,
    SENSITIVITY: 0.002,
    DEFAULT: 1.0
  },
  RESIZE_HANDLE: {
    SIZE: 12,
    OFFSET: 6
  },
  DEBOUNCE: {
    TEXT_SAVE: 300,
    IMAGE_SAVE: 300,
    SOCKET_UPDATE: 50
  },
  CROP_HANDLE: {
    SIZE: 12,
    MIN_DIMENSION: 10
  }
};

// Usage:
const newScale = resizeStartScale + (deltaX * CONFIG.SCALE.SENSITIVITY);
const clampedScale = Math.max(CONFIG.SCALE.MIN, Math.min(CONFIG.SCALE.MAX, newScale));
```

---

### **9️⃣ Inconsistent Null Checks**

**Location**: Throughout

**Problem**:
```javascript
// Line 405: Chained optional
if (!layer || !board || !canvas?.ready || !canvas.stage) return;

// Line 450: Different style  
if (!canvas?.ready || !canvas?.stage?.worldTransform) {

// Line 2497: Yet another style
if (!canvas || !canvas.ready) {
```

**How to fix**:
```javascript
// Choose one consistent style - prefer optional chaining
if (!layer || !board || !canvas?.ready || !canvas?.stage) return;

// Or create helper
function isCanvasReady() {
  return canvas?.ready && canvas?.stage?.worldTransform;
}

if (!isCanvasReady()) {
  ui.notifications.warn("Canvas not ready");
  return;
}
```

---

### **🔟 Missing Lifecycle Cleanup**

**Location**: No cleanup hooks present

**Problem**:
- No `Hooks.on("canvasTearDown")` → elements persist
- No scene change cleanup → data accumulates
- No module disable cleanup → handlers remain

**How to fix**:
```javascript
Hooks.on("canvasTearDown", () => {
  // Close all cards
  FateTableCardApp.closeAll();
  
  // Remove layer
  const layer = document.getElementById("fate-cards-layer");
  if (layer) {
    layer.remove();
  }
  layerCache = null;
  
  // Stop sync
  stopContinuousSync();
  
  // Clear global state
  if (game.fateElements) {
    game.fateElements.reset();
  }
});

Hooks.on("deleteScene", (scene) => {
  if (scene.id === canvas.scene?.id) {
    // Cleanup for deleted scene
    FateTableCardApp.closeAll();
  }
});
```

---

### **1️⃣1️⃣ Massive Code Duplication**

**Location**: 
- Lines 1010-1055 vs 2236-2287 (text/image paste functions)
- Lines 998-1007 vs 2226-2233 (delete functions)
- Lines 868-1321 vs 1323-2493 (text vs image element creation)

**Problem**: 
```javascript
// pasteText() and pasteImage() are 95% identical
async function pasteText() {
  if (!copiedTextData) return;
  const worldPos = screenToWorld(lastMouseX, lastMouseY);
  const newTextId = `fate-text-${Date.now()}`;
  createTextElement(newTextId, copiedTextData.text, worldPos.x, worldPos.y, copiedTextData.scale);
  const texts = await getAllTexts();
  texts[newTextId] = { /* ... */ };
  await setAllTexts(texts);
  ui.notifications.info("Текст вставлен");
}

async function pasteImage() {
  if (!copiedImageData) return;
  const worldPos = screenToWorld(lastMouseX, lastMouseY);
  const newImageId = `fate-image-${Date.now()}`;
  createImageElement(/* ... */);
  const images = await getAllImages();
  images[newImageId] = { /* ... */ };
  await setAllImages(images);
  ui.notifications.info("Картинка вставлена");
}
```

**How to fix**:
```javascript
// Generic paste function
async function pasteElement(type, copiedData, createFn, getAllFn, setAllFn) {
  if (!copiedData) return;
  
  try {
    const worldPos = screenToWorld(lastMouseX, lastMouseY);
    const newId = `fate-${type}-${Date.now()}`;
    
    // Create element
    createFn(newId, copiedData, worldPos);
    
    // Save to DB
    const allElements = await getAllFn();
    allElements[newId] = {
      ...copiedData,
      left: worldPos.x,
      top: worldPos.y
    };
    await setAllFn(allElements);
    
    ui.notifications.info(`${type} вставлен`);
    return newId;
  } catch (err) {
    handleModuleError(`paste${type}`, err);
    return null;
  }
}

// Usage
async function globalPasteText() {
  await pasteElement(
    'text',
    copiedTextData,
    (id, data, pos) => createTextElement(id, data.text, pos.x, pos.y, data.scale),
    getAllTexts,
    setAllTexts
  );
}

async function globalPasteImage() {
  await pasteElement(
    'image',
    copiedImageData,
    (id, data, pos) => createImageElement(id, data.src, pos.x, pos.y, data.scale, data.crop, data.maskType, data.circleOffset, data.circleRadius),
    getAllImages,
    setAllImages
  );
}
```

---

### **1️⃣2️⃣ Inconsistent Async Patterns**

**Location**: Throughout (e.g., lines 3547-3552)

**Problem**: 
```javascript
// Marked as async but doesn't need to be
up: async () => {
  if (!this._resizing) return;
  this._resizing = false;
  await updateCardState(...); // Only one await at very end
}

// Or fire-and-forget that should be awaited
menuButton.addEventListener("click", (e) => {
  updateCardState(this.cardId, { /* ... */ }); // Not awaited
});
```

**How to fix**:
```javascript
// Option 1: Don't mark as async if not needed
up: () => {
  if (!this._resizing) return;
  this._resizing = false;
  
  // Fire and forget (or handle error)
  updateCardState(...)
    .catch(err => handleModuleError('resize', err));
}

// Option 2: If you need await, use it properly
up: async () => {
  if (!this._resizing) return;
  this._resizing = false;
  
  try {
    await updateCardState(...);
  } catch (err) {
    handleModuleError('resize', err);
  }
}
```

---

### **1️⃣3️⃣ Monolithic File Structure**

**Location**: Entire file (4564 lines)

**Problem**:
- Single 4564-line file is difficult to navigate
- Hard to test individual components
- Merge conflicts likely in team development
- Makes code review challenging

**How to fix**:
```
/scripts
  /core
    - main.js (initialization, 200 lines)
    - card-app.js (FateTableCardApp class, 500 lines)
    - canvas-layer.js (layer management + sync, 200 lines)
  
  /elements
    - text-element.js (createTextElement + handlers, 400 lines)
    - image-element.js (createImageElement + handlers, 600 lines)
    - element-base.js (shared element functionality, 200 lines)
  
  /utils
    - coordinates.js (screenToWorld, worldToScreen, 100 lines)
    - storage.js (getAllStates, getAllTexts, etc., 200 lines)
    - sockets.js (socket handlers, 300 lines)
    - transform-cache.js (performance optimization, 100 lines)
  
  /ui
    - toolbar.js (tool injection, 200 lines)
    - styles.js (CSS constants, 200 lines)
  
  /config
    - constants.js (all magic numbers, 50 lines)
```

---

## 🎯 **Priority Action Items**

| Priority | Issue | Impact | Effort | Status |
|----------|-------|--------|--------|--------|
| 🔴 **CRITICAL** | #1 Memory Leak | Browser crash | Medium | ⏳ TODO |
| 🔴 **CRITICAL** | #3 Socket Flooding | Network congestion | Medium | ⏳ TODO |
| 🔴 **CRITICAL** | #2 Global State | Data corruption | Low | ⏳ TODO |
| 🟠 **HIGH** | #4 Error Boundaries | Module crashes | Low | ⏳ TODO |
| 🟠 **HIGH** | #6 Regex in Hot Path | Performance lag | Medium | ⏳ TODO |
| 🟡 **MEDIUM** | #5 Coordinate Fragility | Wrong placement | Low | ⏳ TODO |
| 🟡 **MEDIUM** | #7 DOM Queries | Performance | Low | ⏳ TODO |
| 🟡 **MEDIUM** | #10 Lifecycle Cleanup | Memory leaks | Low | ⏳ TODO |

---

## 📈 **Code Quality Metrics**

| Metric | Score | Notes |
|--------|-------|-------|
| **Functionality** | 9/10 | Feature-complete, works well in normal usage |
| **Performance** | 4/10 | Memory leaks, regex in hot path, socket flooding |
| **Maintainability** | 3/10 | Monolithic file, duplication, magic numbers |
| **Robustness** | 5/10 | Missing error handling, fragile coordinate transforms |
| **Architecture** | 6/10 | Good patterns but needs modularization |
| **Code Style** | 7/10 | Consistent naming, good comments (in Russian) |
| **Security** | 8/10 | Proper GM checks, no obvious vulnerabilities |
| **Documentation** | 4/10 | Inline comments but no external docs |
| **Overall** | **5.6/10** | Solid features but needs stability work |

---

## 💡 **Recommendations**

### **Phase 1: Immediate (This Week)**
1. ✅ Fix memory leak (#1) - Add event handler cleanup in `close()` and `_bind()`
2. ✅ Add error boundaries (#4) - Wrap all async functions in try/catch
3. ✅ Move globals to manager (#2) - Create CanvasElementManager class

### **Phase 2: Short-term (This Month)**
4. ✅ Implement debouncing (#3) - Add debounce to all socket updates
5. ✅ Cache transform parsing (#6) - Create TransformCache class
6. ✅ Add lifecycle cleanup (#10) - Hook into canvasTearDown
7. ✅ Extract constants (#8) - Create CONFIG object

### **Phase 3: Medium-term (This Quarter)**
8. ✅ Refactor to modules (#13) - Split into logical files
9. ✅ Reduce duplication (#11) - Extract common patterns
10. ✅ Optimize DOM queries (#7) - Add caching layer
11. ✅ Write unit tests - Test coordinate transforms, state management

### **Phase 4: Long-term (Future)**
12. ✅ Add TypeScript - Type safety for large codebase
13. ✅ Performance monitoring - Add telemetry for bottlenecks
14. ✅ User documentation - Create usage guide
15. ✅ Internationalization - Support multiple languages

---

## 🧪 **Testing Recommendations**

### **Critical Paths to Test**
1. **Memory management**: Open/close cards 50 times, check RAM usage
2. **Socket sync**: Multiple users editing simultaneously
3. **Coordinate transforms**: At various zoom levels and pan positions
4. **Drag performance**: Drag 10+ elements simultaneously
5. **Scene switching**: Switch scenes rapidly, check for orphaned elements

### **Test Scenarios**
```javascript
// Example test for memory leak
async function testMemoryLeak() {
  const initialMemory = performance.memory.usedJSHeapSize;
  
  // Create and close 50 cards
  for (let i = 0; i < 50; i++) {
    const { id, state } = await createCardState();
    FateTableCardApp.show(id, state);
    await new Promise(r => setTimeout(r, 100));
    FateTableCardApp.closeOne(id);
  }
  
  // Force GC (in Chrome with --expose-gc flag)
  if (global.gc) global.gc();
  
  const finalMemory = performance.memory.usedJSHeapSize;
  const leaked = finalMemory - initialMemory;
  
  console.log(`Memory leaked: ${(leaked / 1024 / 1024).toFixed(2)} MB`);
  
  // Should be < 5MB for 50 cards
  if (leaked > 5 * 1024 * 1024) {
    console.error('MEMORY LEAK DETECTED');
  }
}
```

---

## 📝 **Notes**

- **Language**: Code comments are in Russian - consider English for international collaboration
- **FoundryVTT Version**: Targets v13+ (check compatibility with v11, v12)
- **Dependencies**: Relies on FontAwesome icons, Handlebars templates
- **Browser Support**: Tested on Chrome/Firefox? Check Safari compatibility
- **Module ID**: Uses "fate-table-card" consistently (good!)

---

## 🚀 **Quick Wins** (Easy fixes with high impact)

1. **Add error boundaries** (30 min) - Wrap async functions in try/catch
2. **Extract constants** (20 min) - Create CONFIG object for magic numbers  
3. **Add debounce utility** (15 min) - Already exists, just use it more
4. **Cache layer element** (10 min) - Create getLayer() helper
5. **Fix coordinate fallback** (10 min) - Throw instead of returning screen coords

---

**Last Updated**: 2025-10-17  
**Analyzed By**: AI Code Review  
**Analyzer Version**: 1.0
