
# MJS Модули в FoundryVTT

Как выглядят mjs модули: основной и зависимый

## Основной модуль

### main.mjs

```javascript
// Импортируем функции и классы из вспомогательного модуля
import { sayHelloWorld, getGreeting, SimpleGreeter } from './helpers/hello-world.mjs';

// Инициализация модуля
Hooks.once('init', function() {
    
    // Используем импортированную функцию
    sayHelloWorld();
    
    // Создаем объект класса из helper модуля
    const greeter = new SimpleGreeter("Universe");
    greeter.greet();
    
    // Добавляем наш модуль в глобальный объект game для отладки
    game.myModule = {
        sayHello: sayHelloWorld,
        getGreeting: getGreeting,
        SimpleGreeter: SimpleGreeter
    };
});

// Когда Foundry полностью загружен
Hooks.once('ready', function() {
    
    // Демонстрируем использование функции getGreeting
    const message = getGreeting("Universe");
    ui.notifications.info(message);
    
    // Показываем, что модуль доступен через консоль
});
```

## Зависимый модуль

### helpers/hello-world.mjs

```javascript
// Простой вспомогательный модуль

export function sayHelloWorld() {
    ui.notifications.info("Hello World!");
}

export function getGreeting(name = "World") {
    return `Hello ${name}!`;
}

export class SimpleGreeter {
    constructor(defaultName = "Friend") {
        this.defaultName = defaultName;
    }
    
    greet(name) {
        const greetingName = name || this.defaultName;
        return `Greetings, ${greetingName}!`;
    }
}
```

## Конфигурация модуля

### module.json

```json
{
  "id": "hello-universe-module",
  "title": "Hello Universe Module",
  "description": "Пример модуля с несколькими mjs файлами",
  "authors": [
    {
      "name": "Your Name"
    }
  ],
  "version": "1.0.0",
  "compatibility": {
    "minimum": "10",
    "verified": "12"
  },
  "esmodules": [
    "main.mjs"
  ]
}
```

## Структура проекта

```
hello-universe-module/
├── main.mjs
├── helpers/
│   └── hello-world.mjs
└── module.json
```