/**
 * Whiteboard Experience Debug Logger
 * Система инструментации для сбора полных данных о выполнении блоков кода
 * 
 * Принцип работы:
 * 1. В проблемных местах проверяем флаг
 * 2. Если флаг true - собираем объект с полными данными (входные, промежуточные, выходные)
 * 3. Сохраняем объект в хранилище
 * 4. Логирование вызывается ЯВНО из тестов или main.mjs, а не автоматически
 */

export const WbeLogger = {
  // Флаги для управления сбором данных по типам операций
  flags: {
    flushImages: false,
    setAllImages: false,
    saveImageState: false,
    imageHandler: false,
    imageUpdateRequest: false,
    imageUpdate: false,
    imageDelete: false,
    dbSync: false,  // Отслеживание всех операций с БД (getAllImages/setFlag)
    textSelection: false,  // Выбор текста (handleMouseDown, selectText)
    textDrag: false,  // Перетаскивание текста
    textPaste: false,  // Вставка текста
    textClick: false  // Клики по тексту (для отладки)
  },

  // Хранилище объектов дебага
  debugObjects: [],

  /**
   * Начать сбор данных для блока кода
   * @param {string} flagName - Имя флага (например, 'flushImages')
   * @param {string} context - Контекст выполнения (например, 'FlushImages')
   * @param {Object} inputs - Полные входные данные блока кода
   * @returns {Object|null} Объект дебага или null если флаг выключен
   */
  start(flagName, context, inputs = {}) {
    if (!this.flags[flagName]) return null;

    const debugObj = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      flag: flagName,
      context: context,
      inputs: this._safeClone(inputs),
      steps: [],
      outputs: null,
      error: null
    };

    this.debugObjects.push(debugObj);
    return debugObj;
  },

  /**
   * Записать промежуточный шаг выполнения
   * @param {Object} debugObj - Объект дебага из start()
   * @param {string} stepName - Имя шага
   * @param {Object} data - Полные данные на этом шаге
   */
  step(debugObj, stepName, data = {}) {
    if (!debugObj) return;
    
    debugObj.steps.push({
      name: stepName,
      time: performance.now(),
      data: this._safeClone(data)
    });
  },

  /**
   * Завершить сбор данных
   * @param {Object} debugObj - Объект дебага из start()
   * @param {Object} outputs - Полные выходные данные блока кода
   */
  finish(debugObj, outputs = {}) {
    if (!debugObj) return;

    debugObj.endTime = performance.now();
    debugObj.duration = debugObj.endTime - (debugObj.steps[0]?.time || debugObj.timestamp);
    debugObj.outputs = this._safeClone(outputs);

    this._cleanup();
  },

  /**
   * Записать ошибку
   * @param {Object} debugObj - Объект дебага из start()
   * @param {Error} error - Объект ошибки
   */
  error(debugObj, error) {
    if (!debugObj) return;

    debugObj.error = {
      message: error?.message || String(error),
      stack: error?.stack,
      name: error?.name
    };
  },

  /**
   * Получить все объекты дебага (вызывается из тестов/main.mjs)
   * @param {string} flagName - Опционально: фильтр по флагу
   * @returns {Array} Массив объектов дебага
   */
  getLogs(flagName = null) {
    if (flagName) {
      return this.debugObjects.filter(obj => obj.flag === flagName);
    }
    return [...this.debugObjects];
  },

  /**
   * Очистить все логи
   */
  clear() {
    this.debugObjects = [];
  },

  /**
   * Безопасное клонирование объектов (обработка циклических ссылок)
   */
  _safeClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return {
        _cloneError: e.message,
        _partialData: String(obj)
      };
    }
  },

  /**
   * Очистка старых логов (ограничение памяти)
   */
  _cleanup() {
    if (this.debugObjects.length > 1000) {
      this.debugObjects.shift();
    }
  }
};

// Экспорт в глобальную область для доступа из тестов
window.WbeLogger = WbeLogger;

