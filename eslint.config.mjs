export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // FoundryVTT globals
        game: "readonly",
        ui: "readonly",
        Hooks: "readonly",
        CONFIG: "readonly",
        canvas: "readonly",
        socket: "readonly",
        // Browser globals
        console: "readonly",
        window: "readonly",
        document: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
];

