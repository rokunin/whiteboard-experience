/**
 * WBE Floating Toolbar
 * Независимый тулбар рядом с Foundry controls
 * 
 * Преимущества:
 * - Не зависит от других плагинов
 * - Полный контроль над UI
 * - Нет конфликтов с getSceneControlButtons
 */

const MODULE_NAME = 'wbe-toolbar';

// Tool registry - модули регистрируют свои тулы здесь
const registeredTools = new Map();

// Toolbar state
let toolbarElement = null;
let isInitialized = false;
let activeToolId = null;

// Drag state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let toolbarStartX = 0;
let toolbarStartY = 0;

const STORAGE_KEY = 'wbe-toolbar-position';

/**
 * CSS стили для тулбара
 */
const TOOLBAR_STYLES = `
/* WBE Floating Toolbar Container */
#wbe-toolbar {
  position: fixed;
  left: 104px;
  top: 55px;
  z-index: 100;
  
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  
  background: rgba(30, 30, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  
  transition: opacity 0.2s ease;
}

#wbe-toolbar:hover {
  background: rgba(40, 40, 40, 0.98);
}

/* Toolbar header/label - drag handle */
#wbe-toolbar .wbe-toolbar-header {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 2px;
  user-select: none;
  cursor: grab;
}

#wbe-toolbar .wbe-toolbar-header:active {
  cursor: grabbing;
}

#wbe-toolbar.dragging {
  opacity: 0.9;
  transition: none;
}

#wbe-toolbar.dragging .wbe-toolbar-header {
  cursor: grabbing;
}

/* Tool button base - reset Foundry styles */
#wbe-toolbar .wbe-tool-btn {
  all: unset;
  box-sizing: border-box;
  
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  background: rgba(60, 60, 60, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  box-shadow: none;
  
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  cursor: pointer;
  
  transition: all 0.15s ease;
}

#wbe-toolbar .wbe-tool-btn:hover {
  background: rgba(80, 80, 80, 0.9);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

#wbe-toolbar .wbe-tool-btn.active {
  background: rgba(100, 149, 237, 0.6);
  border-color: rgba(100, 149, 237, 0.8);
  color: #fff;
}

#wbe-toolbar .wbe-tool-btn.toggle-on {
  background: rgba(76, 175, 80, 0.5);
  border-color: rgba(76, 175, 80, 0.7);
}

#wbe-toolbar .wbe-tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Separator */
#wbe-toolbar .wbe-toolbar-separator {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 0;
}

/* Group label */
#wbe-toolbar .wbe-toolbar-group-label {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 2px 0;
  user-select: none;
}

/* Submenu (для shapes и т.д.) */
#wbe-toolbar .wbe-tool-submenu {
  position: absolute;
  left: 100%;
  top: 0;
  margin-left: 4px;
  
  display: none;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  
  background: rgba(30, 30, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

#wbe-toolbar .wbe-tool-btn:hover .wbe-tool-submenu,
#wbe-toolbar .wbe-tool-submenu:hover {
  display: flex;
}

/* Tooltip */
#wbe-toolbar .wbe-tool-btn[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 100%;
  margin-left: 8px;
  padding: 4px 8px;
  
  background: rgba(0, 0, 0, 0.9);
  color: #fff;
  font-size: 11px;
  white-space: nowrap;
  border-radius: 3px;
  
  pointer-events: none;
  z-index: 1000;
}
`;

/**
 * Загрузить сохраненную позицию из localStorage
 */
function loadSavedPosition() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn(`[${MODULE_NAME}] Failed to load saved position`, e);
  }
  return null;
}

/**
 * Сохранить позицию в localStorage
 */
function savePosition(left, top) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top }));
  } catch (e) {
    console.warn(`[${MODULE_NAME}] Failed to save position`, e);
  }
}

/**
 * Начать перетаскивание
 */
function startDrag(e) {
  if (e.button !== 0) return; // Только левая кнопка
  
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  
  const rect = toolbarElement.getBoundingClientRect();
  toolbarStartX = rect.left;
  toolbarStartY = rect.top;
  
  toolbarElement.classList.add('dragging');
  
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  
  e.preventDefault();
}

/**
 * Обработка перетаскивания
 */
function onDrag(e) {
  if (!isDragging) return;
  
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;
  
  let newLeft = toolbarStartX + deltaX;
  let newTop = toolbarStartY + deltaY;
  
  // Ограничить в пределах экрана
  const maxLeft = window.innerWidth - toolbarElement.offsetWidth - 10;
  const maxTop = window.innerHeight - toolbarElement.offsetHeight - 10;
  
  newLeft = Math.max(10, Math.min(newLeft, maxLeft));
  newTop = Math.max(10, Math.min(newTop, maxTop));
  
  toolbarElement.style.left = `${newLeft}px`;
  toolbarElement.style.top = `${newTop}px`;
}

/**
 * Завершить перетаскивание
 */
function stopDrag() {
  if (!isDragging) return;
  
  isDragging = false;
  toolbarElement.classList.remove('dragging');
  
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
  
  // Сохранить позицию
  const rect = toolbarElement.getBoundingClientRect();
  savePosition(rect.left, rect.top);
}

/**
 * Определить позицию Foundry sidebar
 * @returns {{ left: number, top: number }}
 */
function detectFoundryControlsPosition() {
  const controls = document.getElementById('controls');
  
  if (controls) {
    const rect = controls.getBoundingClientRect();
    return {
      left: rect.right + 10, // 10px gap справа от controls
      top: rect.top // Выровнять по верху с Foundry controls
    };
  }
  
  const sidebar = document.getElementById('ui-left');
  if (sidebar) {
    const rect = sidebar.getBoundingClientRect();
    return {
      left: rect.right + 10,
      top: rect.top
    };
  }
  
  // Fallback
  return { left: 110, top: 8 };
}

/**
 * Создать DOM элемент тулбара
 */
function createToolbarElement() {
  // Inject styles
  if (!document.getElementById('wbe-toolbar-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'wbe-toolbar-styles';
    styleEl.textContent = TOOLBAR_STYLES;
    document.head.appendChild(styleEl);
  }
  
  // Create toolbar container
  const toolbar = document.createElement('div');
  toolbar.id = 'wbe-toolbar';
  
  // Загрузить сохраненную позицию или использовать дефолтную
  const savedPos = loadSavedPosition();
  const defaultPos = detectFoundryControlsPosition();
  const pos = savedPos || defaultPos;
  
  toolbar.style.left = `${pos.left}px`;
  toolbar.style.top = `${pos.top}px`;
  
  // Header - drag handle
  const header = document.createElement('div');
  header.className = 'wbe-toolbar-header';
  header.textContent = 'WBE';
  header.addEventListener('mousedown', startDrag);
  toolbar.appendChild(header);
  
  return toolbar;
}

/**
 * Создать кнопку тула
 */
function createToolButton(tool) {
  const btn = document.createElement('button');
  btn.className = 'wbe-tool-btn';
  btn.dataset.toolId = tool.id;
  btn.dataset.tooltip = tool.title;
  
  // Icon
  const icon = document.createElement('i');
  icon.className = tool.icon;
  btn.appendChild(icon);
  
  // Click handler
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleToolClick(tool);
  });
  
  return btn;
}

/**
 * Обработчик клика по тулу
 */
function handleToolClick(tool) {
  const btn = toolbarElement?.querySelector(`[data-tool-id="${tool.id}"]`);
  
  if (tool.type === 'toggle') {
    // Toggle tool (вкл/выкл)
    const isActive = btn?.classList.contains('toggle-on');
    const newState = !isActive;
    
    if (newState) {
      btn?.classList.add('toggle-on');
    } else {
      btn?.classList.remove('toggle-on');
    }
    
    tool.onToggle?.(newState);
    
  } else if (tool.type === 'button') {
    // One-shot button
    tool.onClick?.();
    
  } else if (tool.type === 'tool') {
    // Exclusive tool (только один активен)
    if (activeToolId === tool.id) {
      // Деактивировать
      deactivateTool(tool.id);
    } else {
      // Активировать (деактивировать предыдущий)
      if (activeToolId) {
        deactivateTool(activeToolId);
      }
      activateTool(tool.id);
    }
  }
}

/**
 * Активировать тул
 */
function activateTool(toolId) {
  const tool = registeredTools.get(toolId);
  if (!tool) return;
  
  const btn = toolbarElement?.querySelector(`[data-tool-id="${toolId}"]`);
  btn?.classList.add('active');
  
  activeToolId = toolId;
  tool.onActivate?.();
}

/**
 * Деактивировать тул
 */
function deactivateTool(toolId) {
  const tool = registeredTools.get(toolId);
  if (!tool) return;
  
  const btn = toolbarElement?.querySelector(`[data-tool-id="${toolId}"]`);
  btn?.classList.remove('active');
  
  if (activeToolId === toolId) {
    activeToolId = null;
  }
  tool.onDeactivate?.();
}

// Group order for consistent toolbar layout
const GROUP_ORDER = ['selection', 'shapes', 'objects', 'default'];

/**
 * Перерендерить тулбар
 */
function renderToolbar() {
  if (!toolbarElement) return;
  
  // Очистить (кроме header)
  const header = toolbarElement.querySelector('.wbe-toolbar-header');
  toolbarElement.innerHTML = '';
  if (header) toolbarElement.appendChild(header);
  
  // Группировать тулы
  const groups = new Map();
  for (const [id, tool] of registeredTools) {
    const group = tool.group || 'default';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(tool);
  }
  
  // Сортировать группы по заданному порядку
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const orderA = GROUP_ORDER.indexOf(a[0]);
    const orderB = GROUP_ORDER.indexOf(b[0]);
    // Unknown groups go to the end
    const posA = orderA === -1 ? 999 : orderA;
    const posB = orderB === -1 ? 999 : orderB;
    return posA - posB;
  });
  
  // Рендерить по группам
  let isFirst = true;
  for (const [groupName, tools] of sortedGroups) {
    // Separator между группами
    if (!isFirst) {
      const sep = document.createElement('div');
      sep.className = 'wbe-toolbar-separator';
      toolbarElement.appendChild(sep);
    }
    isFirst = false;
    
    // Кнопки группы
    for (const tool of tools) {
      const btn = createToolButton(tool);
      toolbarElement.appendChild(btn);
    }
  }
}

// ==========================================
// Public API
// ==========================================

/**
 * Инициализировать тулбар
 * Вызывается из main.mjs в Hooks.once('ready')
 */
export function initToolbar() {
  if (isInitialized) return;
  
  toolbarElement = createToolbarElement();
  document.body.appendChild(toolbarElement);
  
  isInitialized = true;
  console.log(`[${MODULE_NAME}] Toolbar initialized`);
  
  // Register toolbar as UI element so clicks don't pass through to WBE objects
  if (window.Whiteboard?.registerUISelector) {
    window.Whiteboard.registerUISelector('#wbe-toolbar');
    window.Whiteboard.registerUISelector('#wbe-toolbar *');
  }
  
  // Рендерить если уже есть зарегистрированные тулы
  if (registeredTools.size > 0) {
    renderToolbar();
  }
  
  // Update position when Foundry UI changes (only if no saved position)
  Hooks.on('renderSceneControls', () => {
    setTimeout(() => {
      // Не перезаписываем позицию если пользователь её перетащил
      if (loadSavedPosition()) return;
      
      const pos = detectFoundryControlsPosition();
      if (toolbarElement) {
        toolbarElement.style.left = `${pos.left}px`;
        toolbarElement.style.top = `${pos.top}px`;
      }
    }, 100);
  });
}

/**
 * Зарегистрировать тул
 * @param {Object} tool - Конфигурация тула
 * @param {string} tool.id - Уникальный ID
 * @param {string} tool.title - Название (для tooltip)
 * @param {string} tool.icon - FontAwesome класс иконки
 * @param {string} tool.group - Группа ('selection', 'shapes', 'objects')
 * @param {string} tool.type - Тип: 'button' | 'toggle' | 'tool'
 * @param {Function} [tool.onClick] - Для type='button'
 * @param {Function} [tool.onToggle] - Для type='toggle', получает (isActive)
 * @param {Function} [tool.onActivate] - Для type='tool'
 * @param {Function} [tool.onDeactivate] - Для type='tool'
 */
export function registerTool(tool) {
  if (!tool.id) {
    console.error(`[${MODULE_NAME}] Tool must have an id`);
    return;
  }
  
  registeredTools.set(tool.id, tool);
  console.log(`[${MODULE_NAME}] Tool registered: ${tool.id}`);
  
  // Перерендерить если тулбар уже создан
  if (isInitialized) {
    renderToolbar();
  }
}

/**
 * Удалить тул
 */
export function unregisterTool(toolId) {
  if (registeredTools.delete(toolId)) {
    if (activeToolId === toolId) {
      activeToolId = null;
    }
    renderToolbar();
  }
}

/**
 * Получить состояние toggle тула
 */
export function getToggleState(toolId) {
  const btn = toolbarElement?.querySelector(`[data-tool-id="${toolId}"]`);
  return btn?.classList.contains('toggle-on') ?? false;
}

/**
 * Установить состояние toggle тула программно
 */
export function setToggleState(toolId, isOn) {
  const btn = toolbarElement?.querySelector(`[data-tool-id="${toolId}"]`);
  if (!btn) return;
  
  if (isOn) {
    btn.classList.add('toggle-on');
  } else {
    btn.classList.remove('toggle-on');
  }
}

/**
 * Получить активный тул
 */
export function getActiveTool() {
  return activeToolId;
}

/**
 * Деактивировать все тулы
 */
export function deactivateAllTools() {
  if (activeToolId) {
    deactivateTool(activeToolId);
  }
}

/**
 * Показать/скрыть тулбар
 */
export function setToolbarVisible(visible) {
  if (toolbarElement) {
    toolbarElement.style.display = visible ? 'flex' : 'none';
  }
}

/**
 * Обновить позицию тулбара (если Foundry sidebar изменился)
 */
export function updateToolbarPosition(leftOffset = 110) {
  if (toolbarElement) {
    toolbarElement.style.left = `${leftOffset}px`;
  }
}

/**
 * Сбросить позицию тулбара к дефолтной
 */
export function resetToolbarPosition() {
  localStorage.removeItem(STORAGE_KEY);
  const pos = detectFoundryControlsPosition();
  if (toolbarElement) {
    toolbarElement.style.left = `${pos.left}px`;
    toolbarElement.style.top = `${pos.top}px`;
  }
}

/**
 * Activate a tool by ID (for hotkey support)
 */
function activateToolById(toolId) {
  const tool = registeredTools.get(toolId);
  if (!tool || tool.type !== 'tool') return false;
  
  // Deactivate current tool if different
  if (activeToolId && activeToolId !== toolId) {
    deactivateTool(activeToolId);
  }
  
  if (activeToolId !== toolId) {
    activateTool(toolId);
  }
  return true;
}

// Export для глобального доступа
window.WBEToolbar = {
  init: initToolbar,
  registerTool,
  unregisterTool,
  getToggleState,
  setToggleState,
  getActiveTool,
  activateTool: activateToolById,
  deactivateAllTools,
  setToolbarVisible,
  updateToolbarPosition,
  resetToolbarPosition
};
