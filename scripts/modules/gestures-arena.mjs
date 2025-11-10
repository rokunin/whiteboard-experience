/**
 * GesturesArena - централизованный менеджер жестов
 * 
 * Определяет приоритеты обработки событий мыши и клавиатуры.
 * Высший приоритет: правый клик + драг (pan) и колесико мыши (zoom).
 * 
 * Пока не интегрирован в основной код - только базовая структура.
 */

class GesturesArena {
  constructor() {
    // Участники арены: eventType -> Array<Participant>
    this.participants = new Map();
    
    // Состояние для отслеживания правого клика + драга
    this.rightMouseState = {
      isDown: false,
      startX: null,
      startY: null,
      isDragging: false,
      dragThreshold: 5 // пикселей для определения драга
    };
    
    // Флаг установки глобальных обработчиков
    this.handlersInstalled = false;
  }

  /**
   * Установить глобальные обработчики событий
   * Вызывается один раз при инициализации модуля
   */
  install() {
    if (this.handlersInstalled) return;
    this.handlersInstalled = true;

    // Обработка правого клика + драга (pan)
    document.addEventListener("mousedown", (e) => {
      if (e.button === 2) { // Правая кнопка мыши
        this.rightMouseState.isDown = true;
        this.rightMouseState.startX = e.clientX;
        this.rightMouseState.startY = e.clientY;
        this.rightMouseState.isDragging = false;
      }
    }, true); // Capture phase для максимального приоритета

    document.addEventListener("mousemove", (e) => {
      if (!this.rightMouseState.isDown) return;
      
      // Проверяем, нажата ли правая кнопка
      if (!(e.buttons & 2)) {
        // Правая кнопка отпущена - сброс состояния
        this.rightMouseState.isDown = false;
        this.rightMouseState.isDragging = false;
        this.rightMouseState.startX = null;
        this.rightMouseState.startY = null;
        return;
      }

      // Проверяем, превышен ли порог для определения драга
      if (!this.rightMouseState.isDragging) {
        const deltaX = Math.abs(e.clientX - this.rightMouseState.startX);
        const deltaY = Math.abs(e.clientY - this.rightMouseState.startY);
        
        if (deltaX > this.rightMouseState.dragThreshold || 
            deltaY > this.rightMouseState.dragThreshold) {
          // Это драг, а не просто клик
          this.rightMouseState.isDragging = true;
          
          // Уведомляем участников арены о начале pan жеста
          this.notifyParticipants("panStart", {
            type: "panStart",
            clientX: e.clientX,
            clientY: e.clientY,
            startX: this.rightMouseState.startX,
            startY: this.rightMouseState.startY
          });
        }
      } else {
        // Продолжение драга - уведомляем участников
        this.notifyParticipants("panMove", {
          type: "panMove",
          clientX: e.clientX,
          clientY: e.clientY,
          startX: this.rightMouseState.startX,
          startY: this.rightMouseState.startY
        });
      }
    }, true); // Capture phase

    document.addEventListener("mouseup", (e) => {
      if (e.button === 2) { // Правая кнопка мыши
        const wasDragging = this.rightMouseState.isDragging;
        
        // Сброс состояния
        this.rightMouseState.isDown = false;
        this.rightMouseState.isDragging = false;
        this.rightMouseState.startX = null;
        this.rightMouseState.startY = null;

        // Уведомляем участников о завершении pan жеста
        if (wasDragging) {
          this.notifyParticipants("panEnd", {
            type: "panEnd",
            clientX: e.clientX,
            clientY: e.clientY
          });
        }
      }
    }, true); // Capture phase

    // Обработка колесика мыши (zoom)
    document.addEventListener("wheel", (e) => {
      if (e.deltaY === 0 && e.deltaX === 0) return;
      
      // Уведомляем участников о zoom жесте
      this.notifyParticipants("zoom", {
        type: "zoom",
        deltaY: e.deltaY,
        deltaX: e.deltaX,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey
      });
    }, { capture: true, passive: true }); // Capture phase + passive для производительности
  }

  /**
   * Зарегистрировать участника арены
   * @param {string} gestureType - тип жеста: "panStart", "panMove", "panEnd", "zoom"
   * @param {Object} participant - участник арены
   * @param {number} participant.priority - приоритет (чем выше, тем раньше обрабатывается)
   * @param {Function} participant.handler - функция-обработчик
   * @param {Function} [participant.canHandle] - функция проверки, может ли участник обработать событие
   * @param {Function} [participant.shouldStop] - функция проверки, нужно ли остановить дальнейшую обработку
   */
  registerParticipant(gestureType, participant) {
    if (!this.participants.has(gestureType)) {
      this.participants.set(gestureType, []);
    }

    const participants = this.participants.get(gestureType);
    
    // Проверяем обязательные поля
    if (typeof participant.priority !== "number") {
      throw new Error(`Participant for ${gestureType} must have a priority number`);
    }
    if (typeof participant.handler !== "function") {
      throw new Error(`Participant for ${gestureType} must have a handler function`);
    }

    // Добавляем участника
    participants.push({
      priority: participant.priority,
      handler: participant.handler,
      canHandle: participant.canHandle || (() => true), // По умолчанию всегда может обработать
      shouldStop: participant.shouldStop || (() => false), // По умолчанию не останавливает
      metadata: participant.metadata || {} // Дополнительные данные для отладки
    });

    // Сортируем по приоритету (от большего к меньшему)
    participants.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Уведомить всех участников о событии
   * @param {string} gestureType - тип жеста
   * @param {Object} eventData - данные события
   */
  notifyParticipants(gestureType, eventData) {
    const participants = this.participants.get(gestureType);
    if (!participants || participants.length === 0) {
      // Нет участников для этого типа жеста - событие проходит дальше
      return;
    }

    // Проходим по участникам в порядке приоритета
    for (const participant of participants) {
      try {
        // Проверяем, может ли участник обработать это событие
        if (!participant.canHandle(eventData)) {
          continue; // Пропускаем этого участника
        }

        // Вызываем обработчик
        const result = participant.handler(eventData);

        // Проверяем, нужно ли остановить дальнейшую обработку
        if (participant.shouldStop(eventData, result)) {
          // Останавливаем распространение события
          break;
        }
      } catch (error) {
        console.error(`[GesturesArena] Error in participant handler for ${gestureType}:`, error);
        // Продолжаем обработку других участников даже при ошибке
      }
    }
  }

  /**
   * Удалить участника из арены
   * @param {string} gestureType - тип жеста
   * @param {Function} handler - функция-обработчик для удаления
   */
  unregisterParticipant(gestureType, handler) {
    const participants = this.participants.get(gestureType);
    if (!participants) return;

    const index = participants.findIndex(p => p.handler === handler);
    if (index !== -1) {
      participants.splice(index, 1);
    }
  }

  /**
   * Получить информацию о текущем состоянии арены (для отладки)
   */
  getState() {
    return {
      handlersInstalled: this.handlersInstalled,
      rightMouseState: { ...this.rightMouseState },
      participantsCount: Array.from(this.participants.entries()).map(([type, parts]) => ({
        gestureType: type,
        count: parts.length,
        priorities: parts.map(p => p.priority)
      }))
    };
  }
}

// Экспортируем singleton экземпляр
const gesturesArena = new GesturesArena();

// Экспортируем класс для тестирования
export { GesturesArena, gesturesArena };

