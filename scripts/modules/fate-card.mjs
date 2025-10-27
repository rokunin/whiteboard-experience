
// Import utilities from main.mjs
import { MODID, createCardsLayer, updateCardState, deleteCardState } from '../main.mjs';

/* ----------------------- Application --------------------- */
class FateTableCardApp extends Application {
  static instances = new Map(); // id -> app

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "fate-table-card",
      popOut: false,
      minimizable: false,
      resizable: false,
      classes: ["fate-table-card"],
      template: `modules/${MODID}/templates/card.hbs`
    });
  }

  static show(id, state, { fromSocket = false } = {}) {
    let app = this.instances.get(id);
    if (!app) {
      app = new FateTableCardApp(id, state);
      this.instances.set(id, app);
    } else {
      // Проверяем что state - это объект
      if (typeof state === 'object' && state !== null) {
        app.cardData = state;
      } else {
        // Не перезаписываем state если он некорректный
      }
    }
    app.render(true);
    const { left, top, width } = (state && typeof state === 'object' ? state.pos : {}) || {};
    app.setPosition({ left, top, width });
    app.applyScale();
    if (!fromSocket) app._attachOnce();
  }

  static closeOne(id) {
    const app = this.instances.get(id);
    if (app) { 
      // Clean up paste handlers before closing
      if (app._pasteHandlers) {
        app._pasteHandlers.forEach(({ handler }) => {
          document.removeEventListener("paste", handler, true);
        });
        app._pasteHandlers = [];
      }
      app.close(); 
      this.instances.delete(id); 
    }
  }

  static closeAll() {
    for (const id of this.instances.keys()) this.closeOne(id);
  }

  constructor(id, state) {
    super();
    this.cardId = id;
    
    // Убеждаемся что state - это объект
    if (typeof state !== 'object' || state === null) {
      this._cardData = { pos: { left: 0, top: 0, width: 200 } };
    } else {
      this._cardData = { ...state }; // Копируем объект
    }
    
    // Инициализируем pos если его нет
    if (!this._cardData.pos) {
      this._cardData.pos = { left: 0, top: 0, width: 200 };
    }
    
    // Состояние для resize
    this._resizing = false;
    this._resizeStartX = 0;
    this._resizeStartScale = 1.0;
  }
  
  // Геттер для доступа к состоянию
  get cardData() {
    return this._cardData;
  }
  
  // Сеттер для обновления состояния
  set cardData(value) {
    this._cardData = value;
  }
  

  _attachOnce() {
    // CSS is now injected globally in main.mjs
  }

  async getData() { 
    // Возвращаем развернутый объект для шаблона
    return {
      name: this.cardData.name || "",
      portrait: this.cardData.portrait || "",
      approaches: this.cardData.approaches || {},
      aspects: this.cardData.aspects || {},
      aspectsOrder: this.cardData.aspectsOrder || ["concept", "problem", "aspect1"],
      stunts: this.cardData.stunts || "",
      notes: this.cardData.notes || "",
      stress: this.cardData.stress || {},
      consequences: this.cardData.consequences || {},
      consequencesText: this.cardData.consequencesText || ""
    };
  }

  async _render(force, options = {}) {
    await super._render(force, options);
    
    // Вставить element в layer на canvas вместо body
    const layer = getOrCreateLayer();
    if (!layer) {
      console.error("[FATE-TC] Layer not found! Creating fallback...");
    }
    
    if (layer && this.element[0] && !layer.contains(this.element[0])) {
      layer.appendChild(this.element[0]);
    }
    
    const { left, top, width } = this.cardData.pos || {};
    this.setPosition({ left, top, width });
    this.applyScale();
    this._bind(this.element[0]);
  }

  setPosition(pos) {
    if (!this.element?.[0]) return;
    const el = this.element[0];
    el.style.position = "absolute";
    // Don't set pointerEvents here - let CSS handle it
    el.style.zIndex = 40;
    
    // pos уже содержит world coordinates, применяем напрямую
    if (pos.left != null) el.style.left = pos.left + "px";
    if (pos.top  != null) el.style.top  = pos.top  + "px";
    if (pos.width!= null) el.style.width= (typeof pos.width==="number"?pos.width+"px":pos.width);
  }

  applyScale() {
    if (!this.element?.[0]) return;
    // this.element[0] УЖЕ является .ftc-card, применяем transform напрямую
    const card = this.element[0];
    
    const scale = this.cardData.scale || 1.0;
    card.style.transform = `scale(${scale})`;
  }

  _bind(root) {
    const isGM = game.user.isGM;

    // Drag по шапке — все пользователи
    const header = root.querySelector(".ftc-header");
    if (header) {
      let dragging = false, startScreenX = 0, startScreenY = 0, startWorldX = 0, startWorldY = 0;
      
      header.addEventListener("pointerdown", (e) => {
        // НЕ начинать драг, если клик на меню, resize handle или других интерактивных элементах
        if (e.target.closest(".ftc-menu-wrapper, .ftc-resize-handle, button, input, select, a")) return;
        
        // Правая кнопка мыши (2) → пропускаем событие для canvas pan
        if (e.button !== 0) return;
        
        dragging = true;
        startScreenX = e.clientX;
        startScreenY = e.clientY;
        // Запомнить начальные world coordinates
        startWorldX = this.cardData.pos?.left || 0;
        startWorldY = this.cardData.pos?.top || 0;
        header.setPointerCapture(e.pointerId);
      });
      
      header.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        
        // Вычислить дельту в экранных координатах
        const deltaScreenX = e.clientX - startScreenX;
        const deltaScreenY = e.clientY - startScreenY;
        
        // Конвертировать дельту в world space (учитывая zoom)
        const scale = canvas?.stage?.scale?.x || 1;
        const deltaWorldX = deltaScreenX / scale;
        const deltaWorldY = deltaScreenY / scale;
        
        // Применить новую позицию в world coordinates
        this.setPosition({ 
          left: startWorldX + deltaWorldX, 
          top: startWorldY + deltaWorldY 
        });
      });
      
      header.addEventListener("pointerup", async () => {
        if (!dragging) return;
        dragging = false;
        
        // Сохранить финальные world coordinates
        const finalLeft = parseFloat(this.element[0].style.left);
        const finalTop = parseFloat(this.element[0].style.top);
        
        // Инициализируем pos если его нет
        if (!this.cardData || typeof this.cardData !== 'object') {
          this.cardData = { pos: { left: 0, top: 0, width: 200 } };
        }
        if (!this.cardData.pos) {
          this.cardData.pos = { left: 0, top: 0, width: 200 };
        }
        
        this.cardData.pos.left = Math.round(finalLeft);
        this.cardData.pos.top = Math.round(finalTop);
        
        await updateCardState(this.cardId, { pos: this.cardData.pos });
      });
    }

    // Resize по handle
    let resizeHandle = root.querySelector(".ftc-resize-handle");
    
    if (resizeHandle) {
      // Удалить старые обработчики если есть
      if (this._resizeHandlers) {
        resizeHandle.removeEventListener("pointerdown", this._resizeHandlers.down);
        resizeHandle.removeEventListener("pointermove", this._resizeHandlers.move);
        resizeHandle.removeEventListener("pointerup", this._resizeHandlers.up);
      }
      
      // Создать новые обработчики с правильным контекстом
      this._resizeHandlers = {
        down: (e) => {
          this._resizing = true;
          this._resizeStartX = e.clientX;
          this._resizeStartScale = this.cardData.scale || 1.0;
          
          resizeHandle.setPointerCapture(e.pointerId);
          e.stopPropagation();
          e.preventDefault();
        },
        
        move: (e) => {
          if (!this._resizing) return;
          
          const deltaX = e.clientX - this._resizeStartX;
          const newScale = this._resizeStartScale + (deltaX * 0.002);
          const clampedScale = Math.max(0.3, Math.min(3.0, newScale));
          
          this.cardData.scale = clampedScale;
          this.applyScale();
        },
        
        up: async () => {
          if (!this._resizing) return;
          this._resizing = false;
          
          await updateCardState(this.cardId, { scale: this.cardData.scale });
        }
      };
      
      // Привязать обработчики
      resizeHandle.addEventListener("pointerdown", this._resizeHandlers.down);
      resizeHandle.addEventListener("pointermove", this._resizeHandlers.move);
      resizeHandle.addEventListener("pointerup", this._resizeHandlers.up);
    }

    // Меню карточки
    const menuButton = root.querySelector(".ftc-menu-button");
    const menuDropdown = root.querySelector(".ftc-menu-dropdown");
    
    if (menuButton && menuDropdown) {
      // Скрыть кнопку "Удалить" для не-GM
      if (!game.user.isGM) {
        const deleteButton = root.querySelector(".ftc-menu-delete");
        if (deleteButton) deleteButton.style.display = "none";
      }
      
      // Клик на кнопку меню - показать/скрыть dropdown
      menuButton.addEventListener("click", (e) => {
        e.stopPropagation();
        const isActive = menuDropdown.classList.toggle("show");
        menuButton.classList.toggle("active", isActive);
      });
      
      // Клик вне меню - закрыть
      document.addEventListener("click", () => {
        menuDropdown.classList.remove("show");
        menuButton.classList.remove("active");
      });
      
      // Клик на "Редактировать карточку"
      root.querySelector(".ftc-menu-edit")?.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Переключить режим редактирования подходов
        const approaches = root.querySelectorAll(".ftc-approach");
        const isEditMode = approaches[0]?.classList.toggle("edit-mode");
        
        approaches.forEach(approach => {
          const nameSpan = approach.querySelector(".ftc-approach-name");
          const display = approach.querySelector(".ftc-approach-display");
          const editDiv = approach.querySelector(".ftc-approach-edit");
          const nameInput = approach.querySelector(".ftc-approach-name-input");
          const valueInput = approach.querySelector(".ftc-approach-value-input");
          
          if (isEditMode) {
            nameSpan.style.display = "none";
            display.style.display = "none";
            editDiv.style.display = "flex";
            nameInput.focus();
          } else {
            nameSpan.style.display = "inline";
            display.style.display = "inline";
            editDiv.style.display = "none";
            // Обновить отображение
            const value = parseInt(valueInput.value) || 0;
            display.textContent = (value >= 0 ? "+" : "") + value;
          }
        });

        // Имя: ровно как у подходов — переключаем display/input
        const nameInput2 = root.querySelector(".ftc-name");
        const nameDisplay2 = root.querySelector(".ftc-name-display");
        if (nameInput2 && nameDisplay2) {
          if (isEditMode) {
            nameDisplay2.style.display = "none";
            nameInput2.style.display = "block";
            nameInput2.focus();
            nameInput2.select?.();
          } else {
            nameDisplay2.textContent = nameInput2.value;
            nameDisplay2.style.display = "block";
            nameInput2.style.display = "none";
          }
        }

        // Имя персонажа: переключение отображения/редактирования
        const nameInput = root.querySelector(".ftc-name");
        const nameDisplay = root.querySelector(".ftc-name-display");
        if (nameInput && nameDisplay) {
          if (isEditMode) {
            nameDisplay.style.display = "none";
            nameInput.style.display = "block";
            nameInput.focus();
            nameInput.select?.();
          } else {
            nameDisplay.textContent = nameInput.value;
            nameDisplay.style.display = "block";
            nameInput.style.display = "none";
          }
        }

        // Обновляем текст пункта меню
        const editItem = root.querySelector(".ftc-menu-edit");
        if (editItem) {
          const iconHtml = '<i class="fas fa-edit"></i> ';
          editItem.innerHTML = iconHtml + (isEditMode ? 'Завершить редактирование' : 'Редактировать карточку');
        }
        
        // Закрыть меню
        menuDropdown.classList.remove("show");
        menuButton.classList.remove("active");
        
        if (isEditMode) {
          ui.notifications.info("Режим редактирования активирован. Кликните на значения подходов для изменения.");
        } else {
          ui.notifications.info("Режим просмотра активирован.");
        }
      });
      
      // Клик на "Масштабировать"
      root.querySelector(".ftc-menu-scale")?.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Переключить видимость handle
        const isActive = resizeHandle?.classList.toggle("active");
        
        // Обновить подпись пункта меню
        const scaleItem = root.querySelector(".ftc-menu-scale");
        if (scaleItem) {
          const iconHtml = '<i class="fas fa-search-plus"></i> ';
          scaleItem.innerHTML = iconHtml + (isActive ? 'Завершить масштабирование' : 'Масштабировать');
        }

        // Закрыть меню
        menuDropdown.classList.remove("show");
        menuButton.classList.remove("active");
        
        if (isActive) {
          ui.notifications.info("Режим масштабирования активирован. Тяните иконку в правом нижнем углу.");
        }
      });
      
      // Клик на "Удалить карточку" — только GM
      root.querySelector(".ftc-menu-delete")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        
        // Закрыть меню
        menuDropdown.classList.remove("show");
        menuButton.classList.remove("active");
        
        // Проверка прав
        if (!game.user.isGM) {
          ui.notifications.warn("Только GM может удалять карточки!");
          return;
        }
        
      const ok = await Dialog.confirm({
        title: "Удалить карточку?",
          content: "<p>Карточка будет убрана у всех.</p>"
      });
      if (!ok) return;
        
      try {
        await deleteCardState(this.cardId, true);
        FateTableCardApp.closeOne(this.cardId);
      } catch (e) {
        console.error("[FATE-TC] delete error:", e);
        ui.notifications.error("Не удалось удалить карточку (см. консоль).");
      }
    });
    }

    // Имя — в режиме просмотра показываем .ftc-name-display, инпут скрыт
    const nameInput = root.querySelector(".ftc-name");
    const nameDisplay = root.querySelector(".ftc-name-display");
    if (nameInput && nameDisplay) {
      nameDisplay.textContent = this.cardData.name || nameInput.value || "";
      nameInput.style.display = "none";
      nameDisplay.style.display = "block";

      nameInput.addEventListener("input", (e) => {
        this.cardData.name = e.target.value;
        nameDisplay.textContent = this.cardData.name;
      });
      
      nameInput.addEventListener("blur", async (e) => {
        await updateCardState(this.cardId, { name: this.cardData.name });
      });
      
      nameInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.target.blur(); // Это вызовет blur событие
        }
      });
    }

    // Портрет URL
    root.querySelector(".ftc-portrait-url")?.addEventListener("change", async (e) => {
      this.cardData.portrait = e.target.value.trim();
      await updateCardState(this.cardId, { portrait: this.cardData.portrait });
    });

    // Вставка изображения из буфера обмена в портрет
    const portraitDiv = root.querySelector(".ftc-portrait");
    if (portraitDiv) {
        // Сделать элемент focusable чтобы можно было ловить paste
        portraitDiv.setAttribute("tabindex", "0");
        portraitDiv.style.cursor = "pointer";
        
        // Подсказка при наведении
        portraitDiv.title = "Ctrl+V для вставки изображения из буфера";
        
        // Клик = фокус
        portraitDiv.addEventListener("click", () => {
          portraitDiv.focus();
        });
        
        // Обработчик paste на document (т.к. на div не работает)
        const pasteHandler = async (e) => {
          // Проверяем, в фокусе ли наш портрет
          if (document.activeElement !== portraitDiv) {
            return; // Paste событие не для нас
          }
          e.preventDefault();
          e.stopPropagation();
          
          const items = e.clipboardData?.items;
          if (!items) return;
          
          // Ищем изображение в буфере
          let imageFile = null;
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              imageFile = item.getAsFile();
              break;
            }
          }
          
          if (!imageFile) {
            ui.notifications.warn("В буфере нет изображения!");
            return;
          }
          
          try {
            // Показываем индикатор загрузки
            portraitDiv.style.opacity = "0.5";
            portraitDiv.style.filter = "blur(2px)";
            ui.notifications.info("Загружаю изображение...");
            
            // Генерируем уникальное имя файла
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 8);
            const extension = imageFile.type.split("/")[1] || "png";
            const fileName = `portrait_${timestamp}_${randomId}.${extension}`;
            
            // Создаём новый File объект с правильным именем
            const renamedFile = new File([imageFile], fileName, { type: imageFile.type });
            
            // Загружаем файл в Foundry (using v13+ API with fallback)
            const uploadPath = `worlds/${game.world.id}`;
            
            let response;
            const startTime = Date.now();
            const isGM = game.user.isGM;
            
            if (isGM) {
              // GM: Try direct upload with longer timeout, no base64 fallback
              try {
                response = await foundry.applications.apps.FilePicker.implementation.upload("data", uploadPath, renamedFile, {}, {
                  notify: false
                });
                const directTime = Date.now() - startTime;
              } catch (error) {
                const directTime = Date.now() - startTime;
                console.error(`[FATE-TC] GM direct upload failed after ${directTime}ms:`, error);
                throw new Error(`GM upload failed: ${error.message}`);
              }
      } else {
        // Player: Try direct upload only (no timeout, no base64 fallback)
        try {
          response = await foundry.applications.apps.FilePicker.implementation.upload("data", uploadPath, renamedFile, {}, {
            notify: false
          });
          const directTime = Date.now() - startTime;
        } catch (error) {
          const directTime = Date.now() - startTime;
          console.error(`[FATE-TC] Player direct upload failed after ${directTime}ms:`, error);
          throw new Error(`Player upload failed: ${error.message}`);
        }
      }
            
            if (response?.path) {
              // Обновляем портрет
              this.cardData.portrait = response.path;
              await updateCardState(this.cardId, { portrait: this.cardData.portrait });
              
              // Обновляем UI
              portraitDiv.style.backgroundImage = `url(${response.path})`;
              const urlInput = root.querySelector(".ftc-portrait-url");
              if (urlInput) urlInput.value = response.path;
              
              // Ensure the image loads properly
              const img = new Image();
              img.onload = () => {
                portraitDiv.style.backgroundImage = `url(${response.path})`;
              };
              img.onerror = () => {
                console.error("[FATE-TC] Image failed to load:", response.path);
                ui.notifications.error("Ошибка загрузки изображения");
              };
              img.src = response.path;
              
              ui.notifications.success("Портрет обновлён!");
            } else {
              console.error("[FATE-TC] No path in response:", response);
              throw new Error("Не удалось получить путь к файлу");
            }
          } catch (error) {
            console.error("[FATE-TC] Portrait upload error:", error);
            ui.notifications.error(`Ошибка загрузки: ${error.message}`);
          } finally {
            // Убираем индикатор загрузки
            portraitDiv.style.opacity = "";
            portraitDiv.style.filter = "";
          }
        };
        
        // Добавляем обработчик на document с capture=true чтобы он сработал раньше глобального
        document.addEventListener("paste", pasteHandler, true);
        
        // Сохраняем ссылку для очистки при закрытии
        if (!this._pasteHandlers) this._pasteHandlers = [];
        this._pasteHandlers.push({ handler: pasteHandler });
      }

    // Подходы
    const updateApproachSign = (input) => {
      const value = parseInt(input.value, 10);
      const valueSpan = input.parentElement;
      if (valueSpan) {
        valueSpan.setAttribute('data-sign', value >= 0 ? '+' : '');
      }
    };
    
    // Обработчики для полей редактирования подходов
    root.querySelectorAll(".ftc-approach-value-input").forEach(inp => {
      inp.addEventListener("change", async (e) => {
        const label = e.target.closest(".ftc-approach").dataset.key;
        let v = parseInt(e.target.value, 10); if (!Number.isFinite(v)) v = 0;
        
        // Найти и обновить подход в массиве
        if (!this.cardData.approaches) this.cardData.approaches = [];
        const approach = this.cardData.approaches.find(a => a.label === label);
        if (approach) {
          approach.value = v;
        }
        
        // Обновить отображение
        const display = e.target.closest(".ftc-approach").querySelector(".ftc-approach-display");
        if (display) {
          display.textContent = (v >= 0 ? "+" : "") + v;
        }
        
        await updateCardState(this.cardId, { approaches: this.cardData.approaches });
      });
      
      inp.addEventListener("input", (e) => {
        const value = parseInt(e.target.value, 10);
        const display = e.target.closest(".ftc-approach").querySelector(".ftc-approach-display");
        if (display) {
          display.textContent = (value >= 0 ? "+" : "") + value;
        }
      });
    });
    
    // Обработчики для названий подходов
    root.querySelectorAll(".ftc-approach-name-input").forEach(inp => {
      inp.addEventListener("change", async (e) => {
        const approach = e.target.closest(".ftc-approach");
        const oldLabel = approach.dataset.key;
        const newName = e.target.value.trim() || oldLabel;
        
        // Обновить название в отображении
        const nameSpan = approach.querySelector(".ftc-approach-name");
        if (nameSpan) {
          nameSpan.textContent = newName;
        }
        
        // Если название изменилось, обновить в массиве
        if (newName !== oldLabel) {
          approach.dataset.key = newName;
          // Найти и обновить подход в массиве
          if (!this.cardData.approaches) this.cardData.approaches = [];
          const approachObj = this.cardData.approaches.find(a => a.label === oldLabel);
          if (approachObj) {
            approachObj.label = newName;
            await updateCardState(this.cardId, { approaches: this.cardData.approaches });
          }
        }
      });
    });

    // Бросок по клику на подход (в режиме просмотра)
    const rollApproach = async (label, modifier) => {
      try {
        const userName = game.user.name;
        const formula = modifier ? `4dF + ${modifier}` : "4dF";
        const flavor  = `${userName} [${label}]`;


        if (ui?.chat?.processMessage) {
          await ui.chat.processMessage(`/r ${formula}`, {speaker:{...ChatMessage.getSpeaker(), alias: flavor}});
          return;
        }

      } catch (err) {
        console.error("[FATE-TC] Approach roll error:", err);
        ui.notifications.error("Не удалось выполнить бросок подхода");
      }
    };

    root.querySelectorAll(".ftc-approach").forEach(row => {
      row.addEventListener("click", async (e) => {
        // Игнор в режиме редактирования (когда показываются инпуты)
        const editDiv = row.querySelector(".ftc-approach-edit");
        if (editDiv && getComputedStyle(editDiv).display !== "none") return;
        // Игнор кликов по самим инпутам/кнопкам
        if (e.target.closest("input, button")) return;

        const label = row.dataset.key;
        if (!label) return;
        
        // Найти модификатор в массиве подходов
        let modifier = 0;
        if (this.cardData.approaches && Array.isArray(this.cardData.approaches)) {
          const approach = this.cardData.approaches.find(a => a.label === label);
          if (approach) {
            modifier = parseInt(approach.value, 10) || 0;
          }
        }
        
        await rollApproach(label, modifier);
      });
    });

    // Аспекты - обработчики для инпутов
    const setupAspectInput = (input) => {
      input.addEventListener("input", (e) => {
        // Определяем ключ
        let aspectKey;
        if (e.target.dataset.aspectKey) {
          // Для новых аспектов используем сохраненный ключ
          aspectKey = e.target.dataset.aspectKey;
        } else {
          // Для старых аспектов определяем по placeholder
          const placeholder = e.target.placeholder.toLowerCase();
          if (placeholder === "концепт") aspectKey = "concept";
          else if (placeholder === "проблема") aspectKey = "problem";
          else if (placeholder === "аспект 1") aspectKey = "aspect1";
          else aspectKey = placeholder.replace(/\s+/g, '_');
        }
        
        if (!this.cardData.aspects) this.cardData.aspects = {};
        this.cardData.aspects[aspectKey] = e.target.value;
      });
      
      input.addEventListener("blur", async (e) => {
        // Определяем ключ
        let aspectKey;
        if (e.target.dataset.aspectKey) {
          aspectKey = e.target.dataset.aspectKey;
        } else {
          const placeholder = e.target.placeholder.toLowerCase();
          if (placeholder === "концепт") aspectKey = "concept";
          else if (placeholder === "проблема") aspectKey = "problem";
          else if (placeholder === "аспект 1") aspectKey = "aspect1";
          else aspectKey = placeholder.replace(/\s+/g, '_');
        }
        
        if (!this.cardData.aspects) this.cardData.aspects = {};
        this.cardData.aspects[aspectKey] = e.target.value;
        await updateCardState(this.cardId, { aspects: this.cardData.aspects });
      });
      
      input.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.target.blur(); // Это вызовет blur событие
        }
      });
    };
    

    root.querySelectorAll(".ftc-aspect-input").forEach(setupAspectInput);
    
    // Кнопки добавления аспектов
    const setupAspectAdd = (button) => {
      button.addEventListener("click", async (e) => {
        e.preventDefault();
        const aspectItem = e.target.closest(".ftc-aspect-item");
        const newAspectItem = aspectItem.cloneNode(true);
        const newInput = newAspectItem.querySelector(".ftc-aspect-input");
        
        // Генерируем уникальный ключ для нового аспекта
        const newKey = `aspect_${Date.now()}`;
        newInput.value = "";
        newInput.placeholder = "Новый аспект";
        newInput.dataset.aspectKey = newKey;
        
        // Добавляем в состояние
        if (!this.cardData.aspects) this.cardData.aspects = {};
        if (!this.cardData.aspectsOrder) this.cardData.aspectsOrder = [];
        this.cardData.aspects[newKey] = "";
        this.cardData.aspectsOrder.push(newKey);
        
        // Сохраняем изменения
        await updateCardState(this.cardId, { 
          aspects: this.cardData.aspects, 
          aspectsOrder: this.cardData.aspectsOrder 
        });
        
        // Добавляем обработчик для нового инпута
        setupAspectInput(newInput);
        
        // Добавляем обработчики для новых кнопок
        const newAddBtn = newAspectItem.querySelector(".ftc-aspect-add");
        const newRemoveBtn = newAspectItem.querySelector(".ftc-aspect-remove");
        setupAspectAdd(newAddBtn);
        setupAspectRemove(newRemoveBtn);
        
        aspectItem.parentElement.appendChild(newAspectItem);
      });
    };
    
    const setupAspectRemove = (button) => {
      button.addEventListener("click", async (e) => {
        e.preventDefault();
        const aspectItem = e.target.closest(".ftc-aspect-item");
        const aspectsContainer = aspectItem.parentElement;
        
        if (aspectsContainer.children.length > 1) {
          // Определяем ключ удаляемого аспекта
          const input = aspectItem.querySelector(".ftc-aspect-input");
          let aspectKey;
          if (input.dataset.aspectKey) {
            aspectKey = input.dataset.aspectKey;
          } else {
            // Для старых аспектов определяем по placeholder
            const placeholder = input.placeholder.toLowerCase();
            if (placeholder === "концепт") aspectKey = "concept";
            else if (placeholder === "проблема") aspectKey = "problem";
            else if (placeholder === "аспект 1") aspectKey = "aspect1";
          }
          
          // Удаляем из состояния
          if (aspectKey && this.cardData.aspects) {
            delete this.cardData.aspects[aspectKey];
          }
          if (aspectKey && this.cardData.aspectsOrder) {
            const index = this.cardData.aspectsOrder.indexOf(aspectKey);
            if (index > -1) {
              this.cardData.aspectsOrder.splice(index, 1);
            }
          }
          
          // Сохраняем изменения
          await updateCardState(this.cardId, { 
            aspects: this.cardData.aspects, 
            aspectsOrder: this.cardData.aspectsOrder 
          });
          
          // Удаляем элемент из DOM
          aspectItem.remove();
        } else {
          // Если это последний аспект, просто очищаем поле
          const input = aspectItem.querySelector(".ftc-aspect-input");
          input.value = "";
          input.placeholder = "Аспект";
        }
      });
    };
    
    root.querySelectorAll(".ftc-aspect-add").forEach(setupAspectAdd);
    
    // Кнопки удаления аспектов
    root.querySelectorAll(".ftc-aspect-remove").forEach(setupAspectRemove);

    // Функция для авто-расширения textarea
    const autoExpand = (el) => {
      el.style.height = 'auto';
      el.style.height = (el.scrollHeight) + 'px';
    };

    // Трюки - с авто-расширением
    const stuntsTextarea = root.querySelector(".ftc-stunts");
    if (stuntsTextarea) {
      autoExpand(stuntsTextarea);
      stuntsTextarea.addEventListener("input", (e) => {
        autoExpand(e.target);
        this.cardData.stunts = e.target.value;
      });
      
      stuntsTextarea.addEventListener("blur", async (e) => {
        await updateCardState(this.cardId, { stunts: this.cardData.stunts });
      });
    }


    // Стресс
    root.querySelectorAll(".ftc-stress-box").forEach(box => {
      box.addEventListener("click", async (e) => {
        const value = e.currentTarget.dataset.value;
        if (!this.cardData.stress) this.cardData.stress = {};
        
        // Toggle состояния
        this.cardData.stress[value] = !this.cardData.stress[value];
        e.currentTarget.classList.toggle("active", this.cardData.stress[value]);
        
        await updateCardState(this.cardId, { stress: this.cardData.stress });
      });
    });

    // Последствия (боксы)
    root.querySelectorAll(".ftc-consequence-box").forEach(box => {
      box.addEventListener("click", async (e) => {
        const value = e.currentTarget.dataset.value;
        if (!this.cardData.consequences) this.cardData.consequences = {};
        
        // Toggle состояния
        this.cardData.consequences[value] = !this.cardData.consequences[value];
        e.currentTarget.classList.toggle("active", this.cardData.consequences[value]);
        
        await updateCardState(this.cardId, { consequences: this.cardData.consequences });
      });
    });

    // Последствия текст - с авто-расширением
    const consequencesTextarea = root.querySelector(".ftc-consequences-text");
    if (consequencesTextarea) {
      autoExpand(consequencesTextarea);
      consequencesTextarea.addEventListener("input", (e) => {
        autoExpand(e.target);
        this.cardData.consequencesText = e.target.value;
      });
      
      consequencesTextarea.addEventListener("blur", async (e) => {
        await updateCardState(this.cardId, { consequencesText: this.cardData.consequencesText });
      });
    }
  }
}

/* ----------------------- CSS ---------------------------- */
const CARD_CSS = `
.fate-table-card { position: absolute; }
.fate-table-card .window-content{ background: transparent; padding: 0; border: 0; }

.ftc-card{
  position: relative;
  width: 1060px; color: #ffffff; background: transparent; border: none;
  font-size: 13px; line-height: 1.3;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  transform-origin: top left;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
  pointer-events: none;
}

/* Включаем pointer-events для всех интерактивных элементов */
.ftc-header, .ftc-name, .ftc-menu-button, .ftc-menu-dropdown, .ftc-menu-item,
.ftc-resize-handle, .ftc-portrait, .ftc-portrait-url,
.ftc-stress-box, .ftc-consequence-box, .ftc-consequences-text,
.ftc-aspect-input, .ftc-aspect-add, .ftc-aspect-remove,
.ftc-approach, .ftc-approach-input, .ftc-approach-name-input, .ftc-approach-value-input,
.ftc-stunts{
  pointer-events: auto;
}

/* Контейнеры должны быть прозрачными для мыши */
.ftc-body, .ftc-left, .ftc-mid, .ftc-top-row, .ftc-bottom-row, 
.ftc-approaches-block, .ftc-aspects-block, .ftc-stunts-block,
.ftc-aspects, .ftc-approaches, .ftc-aspect-item, .ftc-aspect-controls{
  pointer-events: none;
}

.ftc-header{ display:flex; align-items:center; gap:8px; padding:8px; border-bottom:none; cursor: move; background: rgba(0, 0, 0, 0.8); }
.ftc-title{ font-weight: 800; font-size: 11px; color:#fff; letter-spacing:.6px; }
.ftc-name{
  flex:1; padding:6px 8px; background:transparent; border:none;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
  display:none;
}
.ftc-name-display{
  flex:1; font-weight:800; letter-spacing:.5px; text-transform:uppercase; color:orange; font-size: 11px;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}
.ftc-name:focus{
  outline: none;
}
.ftc-name::placeholder{
  color: rgba(255,255,255,0.5);
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}
.ftc-menu-wrapper{
  position: relative;
  margin-left: 6px;
}
.ftc-menu-button{
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none;
  background: rgba(0,0,0,0.3); color: #ffffff; cursor: pointer;
  transition: all 0.2s;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.9);
}
.ftc-menu-button:hover{ background:rgba(0,0,0,0.5); }
.ftc-menu-button.active{ background:rgba(0,0,0,0.6); }

.ftc-menu-dropdown{
  display: none;
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 180px;
  background: rgba(20, 25, 30, 0.95);
  border: none;
  box-shadow: 0 4px 12px rgba(0,0,0,.8);
  z-index: 1000;
  overflow: hidden;
}
.ftc-menu-dropdown.show{ display: block; }

.ftc-menu-item{
  padding: 8px 12px;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  transition: background 0.15s;
  user-select: none;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.9);
}
.ftc-menu-item:hover{ background: rgba(255,255,255,0.1); }
.ftc-menu-item i{ width: 14px; text-align: center; font-size: 11px; }
.ftc-menu-delete{ color: #ff9999; }
.ftc-menu-delete:hover{ background: rgba(139, 46, 46, 0.4); }

.ftc-resize-handle{
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 24px;
  height: 24px;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.4);
  border: none;
  color: #ffffff;
  cursor: nwse-resize;
  z-index: 100;
  font-size: 10px;
  pointer-events: auto;
  user-select: none;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.9);
}
.ftc-resize-handle.active{ display: flex; }
.ftc-resize-handle:hover{ background:rgba(0,0,0,0.6); color:#ffffff; }

.ftc-body{ display:flex; gap:10px; padding:10px; background: transparent; }
.ftc-left{ width: 200px; display:flex; flex-direction:column; gap:6px; }
.ftc-portrait{
  width:100%; flex: 1; min-height: 200px; background:#0f1216 center/cover no-repeat; border:4px solid rgba(255, 255, 255, 0.6);
  position: relative; transition: all 0.2s ease;
}
.ftc-portrait:focus{
  outline: none; box-shadow: 0 0 8px rgba(0, 170, 255, 0.5);
}
.ftc-portrait:hover{

}
.ftc-portrait:focus::after{
  content: "\\f0ea"; /* fa-paste icon */
  font-family: "Font Awesome 5 Free"; font-weight: 900;
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 32px; color: rgba(0, 170, 255, 0.9);
  text-shadow: 0 0 6px rgba(0, 0, 0, 1), 0 0 12px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
.ftc-portrait-url{
  width:100%; padding:6px 8px; background:transparent; border:none; color:#ffffff;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}
.ftc-portrait-url:focus{
  outline: none;
}
.ftc-portrait-url::placeholder{
  color: rgba(255,255,255,0.5);
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}

.ftc-stress-consequences{
  display: flex; flex-direction: column; gap: 8px;
}
.ftc-stress-block, .ftc-consequences-block{
  background:transparent; border:none; padding:8px;
}
.ftc-stress-boxes, .ftc-consequences-boxes{
  display: flex; gap: 6px;
}
.ftc-stress-box, .ftc-consequence-box{
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.3); border: none;
  font-size: 16px; font-weight: 700; color: #ffffff;
  cursor: pointer; user-select: none;
  transition: all 0.2s ease;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.9);
}
.ftc-stress-box:hover, .ftc-consequence-box:hover{
  background: rgba(0, 0, 0, 0.4);
}
.ftc-stress-box.active, .ftc-consequence-box.active{
  background: rgba(139, 46, 46, 0.7); color: #ffffff;
}
.ftc-stress-box.active:hover, .ftc-consequence-box.active:hover{
  background: rgba(166, 61, 61, 0.8);
}
.ftc-consequences-text{
  width: 100%; min-height: 60px; margin-top: 6px; padding: 6px 8px;
  background: rgba(0, 0, 0, 0.25); border: none; color: #ffffff;
  font-family: inherit; font-size: 13px; resize: vertical;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}
.ftc-consequences-text:focus{
  outline: none; background: rgba(0, 0, 0, 0.35);
}
.ftc-consequences-text::placeholder{
  color: rgba(255,255,255,0.5);
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}

.ftc-mid{ flex:1; display:flex; flex-direction:column; gap:10px; margin-left: 8px; }
.ftc-top-row{ display:flex; gap:2px; }
.ftc-bottom-row{ display:flex; gap:2px; }
.ftc-approaches-block{ width: 140px; flex: none; }
.ftc-aspects-block{ flex:1; display:flex; flex-direction:column; }
.ftc-stunts-block{ flex:1; display:flex; flex-direction:column; }
.ftc-block{ background:transparent; border:none; padding:4px; }

.ftc-aspects{
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 100px;
}
.ftc-aspect-item{
  display: flex;
  align-items: center;
  gap: 4px;
}
.ftc-aspect-input{
  flex: 1;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.25);
  border: none;
  color: #ffffff;
  font-size: 12px;
  font-family: inherit;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}
.ftc-aspect-input:focus{
  outline: none;
  background: rgba(0, 0, 0, 0.35);
}
.ftc-aspect-input::placeholder{
  color: rgba(255,255,255,0.5);
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}
.ftc-aspect-controls{
  display: flex;
  gap: 2px;
}
.ftc-aspect-add, .ftc-aspect-remove{
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  border: none;
  color: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.9);
}
.ftc-aspect-add:hover{
  background: rgba(0, 150, 0, 0.5);
}
.ftc-aspect-remove:hover{
  background: rgba(150, 0, 0, 0.5);
}

.ftc-stunts{
  width:100%;
  min-height:100px;
  padding:6px 8px;
  background:rgba(0, 0, 0, 0.25);
  border:none;
  color:#ffffff;
  font-size:12px;
  line-height:1.4;
  resize:vertical;
  font-family:inherit;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
  box-sizing: border-box;
}
.ftc-stunts:focus{ 
  outline: none; background: rgba(0, 0, 0, 0.35); 
}
.ftc-stunts::placeholder{ 
  color: rgba(255,255,255,0.5);
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.9);
}

.ftc-approaches{ display:flex; flex-direction:column; gap:4px; align-items:flex-end; }
.ftc-approach{ 
  display:flex; align-items:center; gap:0px;
  background: rgba(0, 0, 0, 0.8); border:none; padding:4px 8px;
  width: fit-content;
  cursor: pointer;
  font-weight: bold;
}
.ftc-approach-name{
  color: #ffffff;
  text-shadow: 0 0 4px rgba(0,0,0,0.5);
}
.ftc-approach-value{
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 20px;
  justify-content: flex-end;
}
.ftc-approach-display{
  color: #ffffff;
  text-shadow: 0 0 4px rgba(0,0,0,0.5);
  font-weight: 600;
}
.ftc-approach-edit{
  display: flex;
  align-items: center;
  gap: 8px;
}
.ftc-approach-name-input, .ftc-approach-value-input{ 
  background:transparent; border:none; color:#ffffff;
  text-shadow: 0 0 4px rgba(0,0,0,0.5);
  padding: 2px 4px;
  font-weight: 600;
}
.ftc-approach-name-input{
  flex: 1;
  min-width: 60px;
  max-width: 100px;
}
.ftc-approach-value-input{
  width: 40px;
  text-align: center;
}
.ftc-approach-name-input:focus, .ftc-approach-value-input:focus{
  outline: none;
  background: rgba(255,255,255,0.1);
}


`;

export { FateTableCardApp, CARD_CSS };