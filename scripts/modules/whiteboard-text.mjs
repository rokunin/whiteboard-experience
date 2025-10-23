
import {
  MODID,
  FLAG_SCOPE,
  FLAG_KEY_TEXTS,
  screenToWorld,
  worldToScreen,
  getSharedVars,
  setSelectedImageId,
  setCopiedImageData,
  setLastClickX,
  setLastClickY,
  createCardsLayer,
  deselectAllElements
} from "../main.mjs";

let copiedTextData = null; // Буфер для копирования текста
let selectedTextId = null; // ID выделенного текстового элемента

const DEFAULT_TEXT_COLOR = "#000000";
const DEFAULT_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_BORDER_HEX = DEFAULT_TEXT_COLOR;
const DEFAULT_BORDER_OPACITY = 100;
const DEFAULT_BORDER_WIDTH = 0;
const DEFAULT_TEXT_SCALE = 0.7;
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FONT_STYLE = "normal";
const DEFAULT_TEXT_ALIGN = "left";
const DEFAULT_FONT_FAMILY = "Arial";
const DEFAULT_FONT_SIZE = 16;

// Map of element-id -> disposer function
let pendingColorPickerTimeout = null;
let pendingColorPickerRaf = null;
let skipNextTextDeselect = false;
const disposers = new Map();

// Text mode state
let isTextMode = false;
let textModeCursor = null;

function cancelPendingColorPicker() {
  if (pendingColorPickerTimeout) {
    clearTimeout(pendingColorPickerTimeout);
    pendingColorPickerTimeout = null;
  }
  if (pendingColorPickerRaf) {
    cancelAnimationFrame(pendingColorPickerRaf);
    pendingColorPickerRaf = null;
  }
}

function enterTextMode() {
  if (isTextMode) return;
  
  isTextMode = true;
  
  // Create custom T cursor
  textModeCursor = document.createElement("div");
  textModeCursor.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 10000;
    font-family: Arial, sans-serif;
    font-size: 20px;
    font-weight: bold;
    color: #4a9eff;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
    user-select: none;
    display: none;
  `;
  textModeCursor.textContent = "T";
  document.body.appendChild(textModeCursor);
  
  // Update cursor position on mouse move
  const updateCursor = (e) => {
    textModeCursor.style.left = `${e.clientX + 10}px`;
    textModeCursor.style.top = `${e.clientY - 10}px`;
    textModeCursor.style.display = "block";
  };
  
  document.addEventListener("mousemove", updateCursor);
  
  // Store cleanup function
  textModeCursor._cleanup = () => {
    document.removeEventListener("mousemove", updateCursor);
    if (textModeCursor && textModeCursor.parentNode) {
      textModeCursor.parentNode.removeChild(textModeCursor);
    }
    textModeCursor = null;
  };
  
  ui.notifications.info("Text mode: Click to create text (Right-click to exit)");
}

function exitTextMode() {
  if (!isTextMode) return;
  
  isTextMode = false;
  
  if (textModeCursor && textModeCursor._cleanup) {
    textModeCursor._cleanup();
  }
  
  textModeCursor = null;
  ui.notifications.info("Exited text mode");
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeFontWeight = (value) => {
  if (!value) return DEFAULT_FONT_WEIGHT;
  if (value === "bold") return 700;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_FONT_WEIGHT;
};

const normalizeFontStyle = (value) => {
  if (!value) return DEFAULT_FONT_STYLE;
  return value === "italic" ? "italic" : DEFAULT_FONT_STYLE;
};

function hexToRgba(hex, opacity = 100) {
  if (!hex || typeof hex !== "string") return null;
  const normalized = hex.replace("#", "");
  if (![3, 6].includes(normalized.length)) return null;
  const full = normalized.length === 3
    ? normalized.split("").map(ch => ch + ch).join("")
    : normalized;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const alpha = clamp(Number(opacity) / 100, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbaToHexOpacity(input, fallbackHex = DEFAULT_BORDER_HEX, fallbackOpacity = DEFAULT_BORDER_OPACITY) {
  if (!input) {
    return { hex: fallbackHex, opacity: fallbackOpacity };
  }

  const match = String(input).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!match) {
    return { hex: fallbackHex, opacity: fallbackOpacity };
  }

  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = match[4] !== undefined ? clamp(parseFloat(match[4]), 0, 1) : 1;

  const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("")}`;
  const opacity = Math.round(a * 100);
  return { hex, opacity };
}

function updateBorderStyle(textElement, { hexColor = DEFAULT_BORDER_HEX, opacity = DEFAULT_BORDER_OPACITY, width = DEFAULT_BORDER_WIDTH } = {}) {
  if (!textElement) return;

  const safeWidth = clamp(Number(width) || 0, 0, 20);
  const safeOpacity = clamp(Number(opacity) || 0, 0, 100);
  const safeHex = hexColor || DEFAULT_BORDER_HEX;
  const rgba = hexToRgba(safeHex, safeOpacity);

  textElement.dataset.borderHex = safeHex;
  textElement.dataset.borderOpacity = String(safeOpacity);
  textElement.dataset.borderWidth = String(safeWidth);
  textElement.dataset.borderRgba = safeWidth > 0 && rgba ? rgba : "";

  if (safeWidth > 0 && rgba) {
    textElement.style.border = `${safeWidth}px solid ${rgba}`;
  } else {
    textElement.style.border = "none";
  }
}

function applyFontVariantToElement(textElement, fontWeight = DEFAULT_FONT_WEIGHT, fontStyle = DEFAULT_FONT_STYLE) {
  if (!textElement) return;
  const weight = normalizeFontWeight(fontWeight);
  const style = normalizeFontStyle(fontStyle);
  textElement.style.fontWeight = String(weight);
  textElement.style.fontStyle = style;
  textElement.dataset.fontWeight = String(weight);
  textElement.dataset.fontStyle = style;
}

function applyTextAlignmentToElement(textElement, textAlign = DEFAULT_TEXT_ALIGN) {
  if (!textElement) return;
  textElement.style.textAlign = textAlign;
  textElement.dataset.textAlign = textAlign;
}

function applyFontFamilyToElement(textElement, fontFamily = DEFAULT_FONT_FAMILY) {
  if (!textElement) return;
  textElement.style.fontFamily = fontFamily;
  textElement.dataset.fontFamily = fontFamily;
}

function applyFontSizeToElement(textElement, fontSize = DEFAULT_FONT_SIZE) {
  if (!textElement) return;
  textElement.style.fontSize = `${fontSize}px`;
  textElement.dataset.fontSize = fontSize;
}

// Function to detect available fonts using document.fonts API
async function getAvailableFonts() {
  try {
    // Check if document.fonts is available (modern browsers)
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
      const availableFonts = new Set();
      
      // Get all font faces
      for (const fontFace of document.fonts) {
        availableFonts.add(fontFace.family);
      }
      
      // Convert to array and sort
      const fontList = Array.from(availableFonts).sort();
      
      // Add common web-safe fonts if not already present
      const commonFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma'];
      for (const font of commonFonts) {
        if (!fontList.includes(font)) {
          fontList.unshift(font);
        }
      }
      
      return fontList;
    }
  } catch (error) {
    console.warn("[FATE-TC] Could not detect fonts:", error);
  }
  
  // Fallback to common web-safe fonts
  return [
    'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 
    'Verdana', 'Tahoma', 'Trebuchet MS', 'Arial Black', 'Impact'
  ];
}

function makeMiniButton(text, iconClass = null) {
  const button = document.createElement("button");
  if (iconClass) {
    const icon = document.createElement("i");
    icon.className = iconClass;
    icon.style.cssText = "font-size: 12px;";
    button.appendChild(icon);
  } else {
    button.textContent = text;
  }
  button.style.cssText = `
    width: 24px;
    height: 24px;
    border: 1px solid #666;
    background: #f0f0f0;
    color: #333;
    font-size: 12px;
    font-weight: bold;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  `;
  return button;
}

function setMiniActive(button, isActive) {
  if (isActive) {
    button.style.background = "#4a9eff";
    button.style.color = "white";
    button.style.borderColor = "#4a9eff";
  } else {
    button.style.background = "#f0f0f0";
    button.style.color = "#333";
    button.style.borderColor = "#666";
  }
}

function applyBorderDataToElement(textElement, borderColor, borderWidth) {
  if (!textElement) return;
  const width = clamp(Number(borderWidth) || 0, 0, 20);
  const { hex, opacity } = rgbaToHexOpacity(borderColor, textElement.dataset.borderHex || DEFAULT_BORDER_HEX, Number(textElement.dataset.borderOpacity || DEFAULT_BORDER_OPACITY));
  updateBorderStyle(textElement, { hexColor: hex, opacity, width });
}

function extractTextState(id, textElement, container) {
  if (!textElement || !container) return null;
  const transform = textElement.style.transform || "";
  const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
  const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

  const fontWeight = normalizeFontWeight(textElement.dataset.fontWeight || textElement.style.fontWeight || getComputedStyle(textElement).fontWeight);
  const fontStyle = normalizeFontStyle(textElement.dataset.fontStyle || textElement.style.fontStyle || getComputedStyle(textElement).fontStyle);
  const textAlign = textElement.dataset.textAlign || textElement.style.textAlign || DEFAULT_TEXT_ALIGN;
  const fontFamily = textElement.dataset.fontFamily || textElement.style.fontFamily || getComputedStyle(textElement).fontFamily || DEFAULT_FONT_FAMILY;
  const fontSize = parseInt(textElement.dataset.fontSize || textElement.style.fontSize || getComputedStyle(textElement).fontSize || DEFAULT_FONT_SIZE);

  const borderWidth = Number(textElement.dataset.borderWidth || DEFAULT_BORDER_WIDTH);
  const borderColor = borderWidth > 0
    ? (textElement.dataset.borderRgba || textElement.style.borderColor || null)
    : null;
  const left = parseFloat(container.style.left);
  const top = parseFloat(container.style.top);
  const width = textElement.style.width ? parseFloat(textElement.style.width) : null;

  return {
    text: textElement.textContent,
    left: Number.isFinite(left) ? left : 0,
    top: Number.isFinite(top) ? top : 0,
    scale,
    color: textElement.style.color || DEFAULT_TEXT_COLOR,
    backgroundColor: textElement.style.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    fontWeight,
    fontStyle,
    textAlign,
    fontFamily,
    fontSize,
    borderColor,
    borderWidth,
    width
  };
}

async function persistTextState(id, textElement, container) {
  if (!id || !textElement || !container) return;
  const state = extractTextState(id, textElement, container);
  if (!state) return;
  const texts = await getAllTexts();
  texts[id] = state;
  await setAllTexts(texts);
}

function killColorPanel() {
  cancelPendingColorPicker();
  const p = window.fateColorPanel;
  if (p && typeof p.cleanup === "function") {
    try { p.cleanup(); } catch {}
  }
}

function destroyTextElementById(id) {
  const dispose = disposers.get(id);
  if (dispose) {
    try { dispose(); } catch {}
    disposers.delete(id);
  }
  const el = document.getElementById(id);
  if (el) el.remove();
  killColorPanel(); // ensure stray panel listeners are gone
}

// Global showColorPicker function
async function showColorPicker() {
  if (!selectedTextId) return;

  const container = document.getElementById(selectedTextId);
  const textElement = container?.querySelector(".fate-canvas-text");
  if (!textElement) return;

  killColorPanel();

  const computed = getComputedStyle(textElement);
  const textColorInfo = rgbaToHexOpacity(
    computed.color || textElement.style.color || DEFAULT_TEXT_COLOR,
    DEFAULT_TEXT_COLOR,
    100
  );
  const backgroundColorInfo = rgbaToHexOpacity(
    computed.backgroundColor || textElement.style.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    "#000000",
    0
  );
  const currentBorderWidth = Number(textElement.dataset.borderWidth || DEFAULT_BORDER_WIDTH);
  const borderColorInfo = rgbaToHexOpacity(
    currentBorderWidth > 0 ? (textElement.dataset.borderRgba || computed.borderColor || null) : null,
    textElement.dataset.borderHex || DEFAULT_BORDER_HEX,
    Number(textElement.dataset.borderOpacity || DEFAULT_BORDER_OPACITY)
  );

  const panel = document.createElement("div");
  panel.className = "fate-color-picker-panel";
  panel.style.cssText = `
    position: fixed;
    background: white;
    border: 1px solid #d7d7d7;
    border-radius: 14px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
    padding: 10px 18px;
    z-index: 10000;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-width: 240px;
    min-height: 60px;
    aspect-ratio: 4 / 1;
    transform: translateX(-50%) scale(0.9) translateY(12px);
    opacity: 0;
    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;

  const toolbar = document.createElement("div");
  toolbar.style.cssText = `
    display: flex;
    gap: 12px;
    position: relative;
  `;

  const setButtonActive = (button, isActive) => {
    if (!button) return;
    if (isActive) {
      button.dataset.active = "1";
      button.style.background = "#e0ebff";
      button.style.borderColor = "#4d8dff";
      button.style.color = "#1a3f8b";
    } else {
      button.dataset.active = "0";
      button.style.background = "#f5f5f7";
      button.style.borderColor = "#d2d2d8";
      button.style.color = "#333";
    }
  };

  const makeToolbarButton = (label, iconClass) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fate-color-toolbar-btn";
    btn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 40px;
      padding: 0;
      border-radius: 10px;
      border: 1px solid #d2d2d8;
      background: #f5f5f7;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
    `;
    btn.dataset.active = "0";
    btn.title = label;

    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.cssText = "font-size: 18px;";
      btn.appendChild(icon);
    }

    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active === "1") return;
      btn.style.background = "#ededf8";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active === "1") return;
      setButtonActive(btn, false);
    });

    return btn;
  };

  const makeSwatch = (hex, size = 30) => {
    const swatch = document.createElement("div");
    swatch.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
      cursor: pointer;
      background: ${hex};
      position: relative;
      overflow: hidden;
    `;
    return swatch;
  };

  const createSlider = (value, { min, max, step = 1, format = (v) => `${Math.round(v)}%` }) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
    `;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = `
      flex: 1;
      height: 6px;
    `;

    const label = document.createElement("span");
    label.textContent = format(Number(value));
    label.style.cssText = `
      font-size: 12px;
      color: #555;
      width: 48px;
      text-align: right;
    `;

    wrapper.appendChild(slider);
    wrapper.appendChild(label);

    return { wrapper, slider, label, update: (v) => { label.textContent = format(Number(v)); } };
  };

  const applyTextColor = async (hex, opacity) => {
    const rgba = hexToRgba(hex, opacity) || hex;
    textElement.style.color = rgba;
    await persistTextState(selectedTextId, textElement, container);
  };

  const applyBackgroundColor = async (hex, opacity) => {
    const rgba = hexToRgba(hex, opacity) || hex;
    textElement.style.backgroundColor = rgba;
    await persistTextState(selectedTextId, textElement, container);
  };

  const applyBorder = async (hex, opacity, width) => {
    updateBorderStyle(textElement, { hexColor: hex, opacity, width });
    await persistTextState(selectedTextId, textElement, container);
  };

  let activeSubpanel = null;
  let activeButton = null;

  const closeSubpanel = () => {
    if (activeSubpanel) activeSubpanel.remove();
    if (activeButton) setButtonActive(activeButton, false);
    activeSubpanel = null;
    activeButton = null;
  };

  const positionSubpanel = () => {
    if (!activeSubpanel || !activeButton) return;
    const left = activeButton.offsetLeft + activeButton.offsetWidth / 2;
    activeSubpanel.style.left = `${left}px`;
    activeSubpanel.style.top = `-${activeSubpanel.offsetHeight + 10}px`;
  };

  const buildTextSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "fate-color-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Text";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 12px;";
    sub.appendChild(row);

    const swatch = makeSwatch(textColorInfo.hex);
    row.appendChild(swatch);

    const textColorInput = document.createElement("input");
    textColorInput.type = "color";
    textColorInput.value = textColorInfo.hex;
    textColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(textColorInput);

    const { wrapper: sliderRow, slider, update: updateLabel } = createSlider(textColorInfo.opacity, { min: 0, max: 100 });
    row.appendChild(sliderRow);

    const fontControls = document.createElement("div");
    fontControls.style.cssText = "display: flex; gap: 8px;";
    sub.appendChild(fontControls);

    const boldBtn = makeMiniButton("B");
    const italicBtn = makeMiniButton("I");
    const regularBtn = makeMiniButton("Aa");
    const textAlignLeftBtn = makeMiniButton("", "fas fa-align-left");
    const textAlignCenterBtn = makeMiniButton("", "fas fa-align-center");
    const textAlignRightBtn = makeMiniButton("", "fas fa-align-right");

    const computedFont = getComputedStyle(textElement);
    let isBold = normalizeFontWeight(textElement.dataset.fontWeight || textElement.style.fontWeight || computedFont.fontWeight) >= 600;
    let isItalic = normalizeFontStyle(textElement.dataset.fontStyle || textElement.style.fontStyle || computedFont.fontStyle) === "italic";
    let currentTextAlign = textElement.dataset.textAlign || textElement.style.textAlign || DEFAULT_TEXT_ALIGN;
    let currentFontFamily = textElement.dataset.fontFamily || textElement.style.fontFamily || computedFont.fontFamily || DEFAULT_FONT_FAMILY;
    let currentFontSize = parseInt(textElement.dataset.fontSize || textElement.style.fontSize || computedFont.fontSize || DEFAULT_FONT_SIZE);

    const syncFontButtons = () => {
      setMiniActive(boldBtn, isBold);
      setMiniActive(italicBtn, isItalic);
      setMiniActive(regularBtn, !isBold && !isItalic);
    };

    const syncAlignmentButtons = () => {
      setMiniActive(textAlignLeftBtn, currentTextAlign === "left");
      setMiniActive(textAlignCenterBtn, currentTextAlign === "center");
      setMiniActive(textAlignRightBtn, currentTextAlign === "right");
    };

    const applyFontSelection = async () => {
      const weight = isBold ? 700 : DEFAULT_FONT_WEIGHT;
      const style = isItalic ? "italic" : DEFAULT_FONT_STYLE;
      applyFontVariantToElement(textElement, weight, style);
      await persistTextState(selectedTextId, textElement, container);
      syncFontButtons();
    };

    const applyAlignmentSelection = async (alignment) => {
      currentTextAlign = alignment;
      applyTextAlignmentToElement(textElement, alignment);
      await persistTextState(selectedTextId, textElement, container);
      syncAlignmentButtons();
    };

    const applyFontFamilySelection = async (fontFamily) => {
      currentFontFamily = fontFamily;
      applyFontFamilyToElement(textElement, fontFamily);
      await persistTextState(selectedTextId, textElement, container);
    };

    const applyFontSizeSelection = async (fontSize) => {
      currentFontSize = fontSize;
      applyFontSizeToElement(textElement, fontSize);
      await persistTextState(selectedTextId, textElement, container);
    };

    boldBtn.addEventListener("click", async () => {
      isBold = !isBold;
      await applyFontSelection();
    });

    italicBtn.addEventListener("click", async () => {
      isItalic = !isItalic;
      await applyFontSelection();
    });

    regularBtn.addEventListener("click", async () => {
      isBold = false;
      isItalic = false;
      await applyFontSelection();
    });

    textAlignLeftBtn.addEventListener("click", async () => {
      await applyAlignmentSelection("left");
    });

    textAlignCenterBtn.addEventListener("click", async () => {
      await applyAlignmentSelection("center");
    });

    textAlignRightBtn.addEventListener("click", async () => {
      await applyAlignmentSelection("right");
    });

    fontControls.appendChild(regularBtn);
    fontControls.appendChild(boldBtn);
    fontControls.appendChild(italicBtn);
    fontControls.appendChild(textAlignLeftBtn);
    fontControls.appendChild(textAlignCenterBtn);
    fontControls.appendChild(textAlignRightBtn);
    syncFontButtons();
    syncAlignmentButtons();

    // Font family dropdown
    const fontFamilyRow = document.createElement("div");
    fontFamilyRow.style.cssText = "display: flex; align-items: center; gap: 8px;";
    sub.appendChild(fontFamilyRow);

    const fontLabel = document.createElement("span");
    fontLabel.textContent = "Font:";
    fontLabel.style.cssText = "font-size: 12px; color: #555; min-width: 40px;";
    fontFamilyRow.appendChild(fontLabel);

    const fontSelect = document.createElement("select");
    fontSelect.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      border: 1px solid #d0d0d0;
      border-radius: 6px;
      background: white;
      font-size: 12px;
      color: #333;
      cursor: pointer;
    `;
    fontFamilyRow.appendChild(fontSelect);

    // Populate font dropdown
    const populateFontDropdown = async () => {
      const availableFonts = await getAvailableFonts();
      fontSelect.innerHTML = '';
      
      for (const font of availableFonts) {
        const option = document.createElement("option");
        option.value = font;
        option.textContent = font;
        option.style.fontFamily = font;
        if (font === currentFontFamily) {
          option.selected = true;
        }
        fontSelect.appendChild(option);
      }
    };

    // Set initial font and populate dropdown
    fontSelect.value = currentFontFamily;
    populateFontDropdown();

    // Handle font change
    fontSelect.addEventListener("change", async (e) => {
      await applyFontFamilySelection(e.target.value);
    });

    // Font size slider
    const fontSizeRow = document.createElement("div");
    fontSizeRow.style.cssText = "display: flex; align-items: center; gap: 8px;";
    sub.appendChild(fontSizeRow);

    const fontSizeLabel = document.createElement("span");
    fontSizeLabel.textContent = "Size:";
    fontSizeLabel.style.cssText = "font-size: 12px; color: #555; min-width: 40px;";
    fontSizeRow.appendChild(fontSizeLabel);

    const { wrapper: fontSizeSliderRow, slider: fontSizeSlider, update: updateFontSizeLabel } = createSlider(currentFontSize, {
      min: 8,
      max: 72,
      step: 1,
      format: (v) => `${Math.round(v)}px`
    });
    fontSizeRow.appendChild(fontSizeSliderRow);

    // Handle font size change
    fontSizeSlider.addEventListener("input", async (e) => {
      updateFontSizeLabel(e.target.value);
      await applyFontSizeSelection(Number(e.target.value));
    });

    swatch.addEventListener("click", () => textColorInput.click());
    textColorInput.addEventListener("change", async (e) => {
      swatch.style.background = e.target.value;
      await applyTextColor(e.target.value, Number(slider.value));
    });
    slider.addEventListener("input", async (e) => {
      updateLabel(e.target.value);
      await applyTextColor(textColorInput.value, Number(e.target.value));
    });

    return sub;
  };

  const buildBackgroundSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "fate-color-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Background";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 12px;";
    sub.appendChild(row);

    const swatch = makeSwatch(backgroundColorInfo.hex);
    row.appendChild(swatch);

    const bgColorInput = document.createElement("input");
    bgColorInput.type = "color";
    bgColorInput.value = backgroundColorInfo.hex;
    bgColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(bgColorInput);

    const { wrapper: sliderRow, slider, update: updateLabel } = createSlider(backgroundColorInfo.opacity, { min: 0, max: 100 });
    row.appendChild(sliderRow);

    swatch.addEventListener("click", () => bgColorInput.click());
    bgColorInput.addEventListener("change", async (e) => {
      swatch.style.background = e.target.value;
      await applyBackgroundColor(e.target.value, Number(slider.value));
    });
    slider.addEventListener("input", async (e) => {
      updateLabel(e.target.value);
      await applyBackgroundColor(bgColorInput.value, Number(e.target.value));
    });

    return sub;
  };

  const buildBorderSubpanel = () => {
    const sub = document.createElement("div");
    sub.className = "fate-color-subpanel";
    sub.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #dcdcdc;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      padding: 14px;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: auto;
    `;

    const header = document.createElement("div");
    header.textContent = "Border";
    header.style.cssText = "font-size: 13px; font-weight: 600; color: #1f1f24;";
    sub.appendChild(header);

    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 12px;";
    sub.appendChild(row);

    const swatch = makeSwatch(borderColorInfo.hex);
    swatch.style.opacity = currentBorderWidth > 0 ? "1" : "0.45";
    row.appendChild(swatch);

    const borderColorInput = document.createElement("input");
    borderColorInput.type = "color";
    borderColorInput.value = borderColorInfo.hex;
    borderColorInput.style.cssText = "position:absolute; opacity:0; pointer-events:none;";
    sub.appendChild(borderColorInput);

    const { wrapper: opacityRow, slider: opacitySlider, update: updateOpacityLabel } = createSlider(borderColorInfo.opacity, { min: 0, max: 100 });
    row.appendChild(opacityRow);

    const { wrapper: widthRow, slider: widthSlider, update: updateWidthLabel } = createSlider(currentBorderWidth, {
      min: 0,
      max: 12,
      step: 0.5,
      format: (v) => {
        const numeric = Number(v) || 0;
        return Number.isInteger(numeric) ? `${numeric}px` : `${numeric.toFixed(1)}px`;
      }
    });
    sub.appendChild(widthRow);

    const sync = async () => {
      const width = Number(widthSlider.value);
      const opacity = Number(opacitySlider.value);
      updateOpacityLabel(opacity);
      updateWidthLabel(width);
      swatch.style.opacity = width > 0 ? "1" : "0.45";
      await applyBorder(borderColorInput.value, opacity, width);
    };

    swatch.addEventListener("click", () => borderColorInput.click());
    borderColorInput.addEventListener("change", async (e) => {
      swatch.style.background = e.target.value;
      await sync();
    });
    opacitySlider.addEventListener("input", sync);
    widthSlider.addEventListener("input", sync);

    return sub;
  };

  const openSubpanel = (type, button) => {
    if (activeButton === button) {
      closeSubpanel();
      return;
    }

    closeSubpanel();

    let subpanel = null;
    if (type === "text") subpanel = buildTextSubpanel();
    else if (type === "background") subpanel = buildBackgroundSubpanel();
    else if (type === "border") subpanel = buildBorderSubpanel();

    if (!subpanel) return;

    subpanel.style.opacity = "0";
    subpanel.style.transform = "translateY(-8px)";
    panel.appendChild(subpanel);

    activeSubpanel = subpanel;
    activeButton = button;
    setButtonActive(button, true);
    positionSubpanel();

    requestAnimationFrame(() => {
      if (!activeSubpanel) return;
      activeSubpanel.style.transition = "opacity 0.16s ease, transform 0.16s ease";
      activeSubpanel.style.opacity = "1";
      activeSubpanel.style.transform = "translateY(0)";
    });
  };

  const textBtn = makeToolbarButton("Text", "fas fa-font");
  const bgBtn = makeToolbarButton("Background", "fas fa-fill");
  const borderBtn = makeToolbarButton("Border", "fas fa-border-all");

  setButtonActive(textBtn, false);
  setButtonActive(bgBtn, false);
  setButtonActive(borderBtn, false);

  textBtn.addEventListener("click", () => openSubpanel("text", textBtn));
  bgBtn.addEventListener("click", () => openSubpanel("background", bgBtn));
  borderBtn.addEventListener("click", () => openSubpanel("border", borderBtn));

  toolbar.appendChild(textBtn);
  toolbar.appendChild(bgBtn);
  toolbar.appendChild(borderBtn);
  panel.appendChild(toolbar);
  document.body.appendChild(panel);

  const updatePanelPosition = () => {
    const rect = textElement.getBoundingClientRect();
    panel.style.left = `${rect.left + rect.width / 2}px`;
    panel.style.top = `${rect.top - 110}px`;
    positionSubpanel();
  };

  updatePanelPosition();
  requestAnimationFrame(() => {
    panel.style.transform = "translateX(-50%) scale(1) translateY(0)";
    panel.style.opacity = "1";
  });

  const onOutside = (ev) => {
    if (panel.contains(ev.target)) return;

    const activeContainer = selectedTextId ? document.getElementById(selectedTextId) : null;
    const clickedInsideText = activeContainer?.contains(ev.target);

    if (activeSubpanel) {
      closeSubpanel();
      window.fateColorPanelUpdate?.();
    }

    if (clickedInsideText) {
      window.fateColorPanelUpdate?.();
      return;
    }

    if (activeContainer) skipNextTextDeselect = true;
    cleanup();
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") cleanup();
  };

  panel.addEventListener("mousedown", (ev) => ev.stopPropagation());
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);

  function cleanup() {
    try { document.removeEventListener("mousedown", onOutside, true); } catch {}
    document.removeEventListener("keydown", onKey);
    closeSubpanel();
    panel.remove();
    window.fateColorPanel = null;
    window.fateColorPanelUpdate = null;
  }

  panel.cleanup = cleanup;
  window.fateColorPanel = panel;
  window.fateColorPanelUpdate = updatePanelPosition;
}

function safeReshowColorPicker(targetId, delayMs = 0) {
  cancelPendingColorPicker();
  const open = async () => {
    const el = document.getElementById(targetId);
    if (!el) return;
    // Reassert selection target in case other handlers nulled it
    selectedTextId = targetId;
    await showColorPicker();
  };

  if (delayMs <= 0) {
    pendingColorPickerRaf = requestAnimationFrame(() => {
      pendingColorPickerRaf = requestAnimationFrame(() => {
        pendingColorPickerRaf = null;
        open();
      });
    });
  } else {
    pendingColorPickerTimeout = setTimeout(() => {
      pendingColorPickerTimeout = null;
      pendingColorPickerRaf = requestAnimationFrame(() => {
        pendingColorPickerRaf = requestAnimationFrame(() => {
          pendingColorPickerRaf = null;
          open();
        });
      });
    }, delayMs);
  }
}

// Install global pan hooks (module scope, once)
let __fatePanHooksInstalled = false;

function installGlobalPanHooks() {
  if (__fatePanHooksInstalled) return;
  __fatePanHooksInstalled = true;

  let isCanvasPanningGlobal = false;

  // Start pan on ANY right-button down; close panel immediately
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    if (e.target.closest(".fate-canvas-text-container")) {
      // If you want to keep the panel when RMB starts ON the text, comment this line:
      killColorPanel();
    } else {
      killColorPanel();
    }
    isCanvasPanningGlobal = true;
  }, true);

  // On pan end, reopen for the currently selected text (if any)
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    if (!isCanvasPanningGlobal) return;
    isCanvasPanningGlobal = false;

    if (selectedTextId && !window.fateColorPanel) {
      // Give the canvas a tick to settle transforms
      safeReshowColorPicker(selectedTextId, 100);
    }
  }, true);

  // Zoom wheel should also temporarily hide + then restore
  document.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    if (!selectedTextId) return;
    killColorPanel();
    safeReshowColorPicker(selectedTextId, 150);
  }, { passive: true });
}

// call this once, after defining killColorPanel/safeReshowColorPicker
installGlobalPanHooks();

// Global text mode key handler
let textModeKeyHandler = null;

function installTextModeKeys() {
  if (textModeKeyHandler) return;
  
  textModeKeyHandler = (e) => {
    // T key to enter text mode
    if (e.key === "t" || e.key === "T") {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Don't interfere with shortcuts
      e.preventDefault();
      enterTextMode();
    }
  };
  
  document.addEventListener("keydown", textModeKeyHandler);
}

// Install text mode keys
installTextModeKeys();

// Right-click handler to exit text mode
let textModeMouseHandler = null;

function installTextModeMouseHandler() {
  if (textModeMouseHandler) return;
  
  let rightClickStartX = 0;
  let rightClickStartY = 0;
  let isRightClickDragging = false;
  
  textModeMouseHandler = (e) => {
    if (!isTextMode) return;
    
    // Right mouse button down - start tracking
    if (e.button === 2 && e.type === "mousedown") {
      rightClickStartX = e.clientX;
      rightClickStartY = e.clientY;
      isRightClickDragging = false;
    }
    
    // Mouse move during right click - check if dragging
    if (e.type === "mousemove" && e.buttons === 2) {
      const deltaX = Math.abs(e.clientX - rightClickStartX);
      const deltaY = Math.abs(e.clientY - rightClickStartY);
      if (deltaX > 3 || deltaY > 3) {
        isRightClickDragging = true;
      }
    }
    
    // Right mouse button up - exit text mode if not dragging
    if (e.button === 2 && e.type === "mouseup") {
      if (!isRightClickDragging) {
        exitTextMode();
      }
      isRightClickDragging = false;
    }
  };
  
  document.addEventListener("mousedown", textModeMouseHandler);
  document.addEventListener("mouseup", textModeMouseHandler);
  document.addEventListener("mousemove", textModeMouseHandler);
}

// Install text mode mouse handler
installTextModeMouseHandler();

// Canvas click handler for text mode
let canvasClickHandler = null;

function installCanvasTextModeHandler() {
  if (canvasClickHandler) return;
  
  canvasClickHandler = (e) => {
    if (!isTextMode) return;
    
    // Only handle left clicks
    if (e.button !== 0) return;
    
    // Don't create text if clicking on existing elements
    if (e.target.closest(".fate-canvas-text-container") || 
        e.target.closest(".fate-color-picker-panel")) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Create text in text mode with auto-edit
    addTextToCanvas(e.clientX, e.clientY, true);
    
    // Exit text mode after creating text
    exitTextMode();
  };
  
  // Listen for clicks on the canvas layer
  document.addEventListener("mousedown", canvasClickHandler, true);
}

// Install canvas text mode handler
installCanvasTextModeHandler();
// Глобальная функция вставки текста
async function globalPasteText() {
    if (!copiedTextData) return;
    
    // Конвертируем screen → world coordinates (через Pixi.js)
    const { lastMouseX, lastMouseY } = getSharedVars();
    const worldPos = screenToWorld(lastMouseX, lastMouseY);
    
    const newTextId = `fate-text-${Date.now()}`;
    const container = createTextElement(
      newTextId,
      copiedTextData.text,
      worldPos.x,
      worldPos.y,
      copiedTextData.scale ?? DEFAULT_TEXT_SCALE,
      copiedTextData.color || DEFAULT_TEXT_COLOR,
      copiedTextData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
      copiedTextData.borderColor || null,
      copiedTextData.borderWidth ?? DEFAULT_BORDER_WIDTH,
      copiedTextData.fontWeight || DEFAULT_FONT_WEIGHT,
      copiedTextData.fontStyle || DEFAULT_FONT_STYLE,
      copiedTextData.textAlign || DEFAULT_TEXT_ALIGN,
      copiedTextData.fontFamily || DEFAULT_FONT_FAMILY,
      copiedTextData.fontSize || DEFAULT_FONT_SIZE,
      copiedTextData.width || null
    );
    if (!container) return;
    const textEl = container.querySelector(".fate-canvas-text");
    if (!textEl) return;
    await persistTextState(newTextId, textEl, container);
    
    ui.notifications.info("Текст вставлен");
}

async function handleTextPasteFromClipboard(text) {
  try {
    // Сбрасываем наши скопированные элементы (вставляем из системного буфера)
    setCopiedImageData(null);
    copiedTextData = null;
    
    // Конвертируем позицию курсора в world coordinates
    const { lastMouseX, lastMouseY } = getSharedVars();
    const worldPos = screenToWorld(lastMouseX, lastMouseY);
    
    
    // Создаем новый текстовый элемент
    const textId = `fate-text-${Date.now()}`;
    const container = createTextElement(textId, text, worldPos.x, worldPos.y, DEFAULT_TEXT_SCALE, DEFAULT_TEXT_COLOR, DEFAULT_BACKGROUND_COLOR, null, DEFAULT_BORDER_WIDTH, DEFAULT_FONT_WEIGHT, DEFAULT_FONT_STYLE, DEFAULT_TEXT_ALIGN, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, null);
    if (!container) return;
    const textEl = container.querySelector(".fate-canvas-text");
    if (!textEl) return;
    await persistTextState(textId, textEl, container);
    
    // Update container dimensions after paste
    updateTextUI(container);
    
    ui.notifications.info("Текст добавлен");
  } catch (err) {
    console.error("[FATE-TC] Ошибка при вставке текста:", err);
    ui.notifications.error("Ошибка при вставке текста");
  }
}

async function injectTextTool() {
    const sc = ui.controls;
    if (!sc || !sc.controls) return;
  
    const groupsObj = sc.controls;
    const group =
      groupsObj.tokens || groupsObj.token || groupsObj.notes ||
      Object.values(groupsObj)[0];
  
    if (!group) return;
  
    const toolName = "fate-text-tool";
    const tool = {
      name: toolName,
      title: "Добавить текст на стол",
      icon: "fas fa-font",
      button: true,
      onChange: async () => {
        const { lastClickX, lastClickY } = getSharedVars();
        await addTextToCanvas(lastClickX, lastClickY);
      }
    };
  
    const t = group.tools;
    const exists = Array.isArray(t) ? t.some(x => x?.name === toolName) : t?.[toolName];
    if (exists) return;
  
    if (Array.isArray(t)) t.push(tool);
    else if (t && typeof t === "object") {
      t[toolName] = tool;
      if (Array.isArray(group._toolOrder)) group._toolOrder.push(toolName);
    } else group.tools = [tool];
  
    await sc.render?.(true);
    
    // Отслеживаем клики на кнопке инструмента
    setTimeout(() => {
      const toolButton = document.querySelector(`[data-tool="${toolName}"]`);
      if (toolButton && !toolButton.dataset.fateTextListener) {
        toolButton.addEventListener("click", (e) => {
          setLastClickX(e.clientX);
          setLastClickY(e.clientY);
        });
        toolButton.dataset.fateTextListener = "1";
      }
    }, 100);
}

function createTextElement(
    id,
    text,
    left,
    top,
    scale = DEFAULT_TEXT_SCALE,
    color = DEFAULT_TEXT_COLOR,
    backgroundColor = DEFAULT_BACKGROUND_COLOR,
    borderColor = null,
    borderWidth = DEFAULT_BORDER_WIDTH,
    fontWeight = DEFAULT_FONT_WEIGHT,
    fontStyle = DEFAULT_FONT_STYLE,
    textAlign = DEFAULT_TEXT_ALIGN,
    fontFamily = DEFAULT_FONT_FAMILY,
    fontSize = DEFAULT_FONT_SIZE,
    width = null
  ) {
    const layer = getOrCreateLayer();
    if (!layer) return null;
    
    // Контейнер для позиционирования (БЕЗ translate)
    const container = document.createElement("div");
    container.id = id;
    container.className = "fate-canvas-text-container";
    container.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      z-index: 1000;
    `;
    
    // Внутренний элемент для контента + масштабирование
    const textElement = document.createElement("div");
    textElement.className = "fate-canvas-text";
    textElement.contentEditable = "false";
    textElement.textContent = text;
    textElement.style.cssText = `
      transform: scale(${scale});
      transform-origin: top left;
      background: ${backgroundColor || "transparent"};
      color: ${color};
      padding: 0;
      border: none;
      font-size: 16px;
      font-weight: 400;
      user-select: none;
      min-width: 100px;
      text-align: left;
      overflow-wrap: break-word;
      word-wrap: break-word;
      word-break: break-word;
      overflow: visible;
    `;
    
    // Apply width if it was manually set
    if (width && width > 0) {
      textElement.style.width = `${width}px`;
      textElement.dataset.manualWidth = "true"; // Mark as manually set
    }
    
    // Apply font weight and style
    applyFontVariantToElement(textElement, fontWeight, fontStyle);
    
    // Apply text alignment
    applyTextAlignmentToElement(textElement, textAlign);
    
    // Apply font family
    applyFontFamilyToElement(textElement, fontFamily);
    
    // Apply font size
    applyFontSizeToElement(textElement, fontSize);
    
    container.appendChild(textElement);
    layer.appendChild(container);
    applyBorderDataToElement(textElement, borderColor, borderWidth);
    
    // Resize handle (круглая точка) - в контейнере, позиционируется относительно textElement
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "fate-text-resize-handle";
    resizeHandle.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 12px;
      height: 12px;
      display: none;
      background: #4a9eff;
      border: 2px solid white;
      border-radius: 50%;
      cursor: nwse-resize;
      z-index: 1002;
      pointer-events: auto;
      user-select: none;
      transform-origin: center center;
    `;
    container.appendChild(resizeHandle);
    
    // No separate resize handles - borders will be directly draggable
    
    // Color picker will be shown automatically when text is selected
    // No button needed - we'll trigger the color picker directly
    
    // Функция для обновления позиции handle относительно масштабированного textElement
    function updateHandlePosition() {
      // Читаем текущий scale
      const transform = textElement.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      // Получаем размеры textElement БЕЗ масштаба
      const width = textElement.offsetWidth;
      const height = textElement.offsetHeight;
      
      // Вычисляем позицию правого нижнего угла С УЧЁТОМ масштаба
      const scaledWidth = width * currentScale;
      const scaledHeight = height * currentScale;
      
      // Позиционируем resize handle в правом нижнем углу
      resizeHandle.style.left = `${scaledWidth - 6}px`;
      resizeHandle.style.top = `${scaledHeight - 6}px`;
    }
    
    // Обработчики событий
    let isEditing = false;
    let isSelected = false;
    let dragging = false, dragInitialized = false, startScreenX = 0, startScreenY = 0, startWorldX = 0, startWorldY = 0;
    let resizing = false, resizeStartX = 0, resizeStartScale = scale;
    
    // Функция выделения/снятия выделения
    function selectText() {
      isSelected = true;
      selectedTextId = id; // Устанавливаем глобальный ID
      setSelectedImageId(null); // Сбрасываем выделение картинки
      
      // Снимаем выделение со ВСЕХ других элементов (кроме текущего)
      deselectAllElements(id);
      
      // Mark container as selected
      container.dataset.selected = "true";
      
      container.style.setProperty("pointer-events", "auto", "important");
      textElement.style.setProperty("outline", "1px solid #4a9eff", "important");
      textElement.style.setProperty("outline-offset", "0px", "important");
      // container.style.setProperty("cursor", "move", "important"); // Removed move cursor
      resizeHandle.style.display = "flex";
      resizeHandle.style.opacity = "0";
      resizeHandle.style.transform = "scale(0.8)";
      updateHandlePosition();
      
      // Animate scale handle appearance
      requestAnimationFrame(() => {
        resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        resizeHandle.style.opacity = "1";
        resizeHandle.style.transform = "scale(1)";
      });
      
      // Automatically show color pickers when text is selected
      if (window.fateColorPanel) {
        window.fateColorPanelUpdate?.();
      } else {
        safeReshowColorPicker(id, 100);
      }
      
      // Создаем программный selection, чтобы Ctrl+C работал
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textElement);
      selection.removeAllRanges();
      selection.addRange(range);
      
    }
    
    function deselectText() {
      if (!isEditing) {
        isSelected = false;
        delete container.dataset.selected; // Убираем метку
        if (selectedTextId === id) selectedTextId = null; // Сбрасываем глобальный ID только если это МЫ
        
        container.style.removeProperty("pointer-events");
        textElement.style.removeProperty("outline");
        textElement.style.removeProperty("outline-offset");
        container.style.removeProperty("cursor");
        resizeHandle.style.display = "none";
        
        // Очищаем selection
        window.getSelection().removeAllRanges();
        
      }
    }
    
    // Удаление по клавише Delete
    async function deleteText() {
      killColorPanel();
      destroyTextElementById(id);
      
      const texts = await getAllTexts();
      delete texts[id];
      await setAllTexts(texts);
    }
    
    // Вставка скопированного текста
    async function pasteText() {
      if (!copiedTextData) return;
      
      const { lastMouseX, lastMouseY } = getSharedVars();
      
      // Получаем позицию слоя относительно viewport
      const layer = getOrCreateLayer();
      if (!layer) return;
      
      const layerRect = layer.getBoundingClientRect();
      
      // Конвертируем screen coordinates → layer coordinates → world coordinates
      const layerX = lastMouseX - layerRect.left;
      const layerY = lastMouseY - layerRect.top;
      
      // Учитываем масштаб слоя и translate
      const transform = layer.style.transform || "";
      
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const translateMatch = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      const translateX = translateMatch ? parseFloat(translateMatch[1]) : 0;
      const translateY = translateMatch ? parseFloat(translateMatch[2]) : 0;
      
      
      // Учитываем translate И scale
      const worldX = (layerX - translateX) / scale;
      const worldY = (layerY - translateY) / scale;
      
      
      // Создаём новый текст
      const newTextId = `fate-text-${Date.now()}`;
      const container = createTextElement(
        newTextId,
        copiedTextData.text,
        worldX,
        worldY,
        copiedTextData.scale ?? DEFAULT_TEXT_SCALE,
        copiedTextData.color || DEFAULT_TEXT_COLOR,
        copiedTextData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
        copiedTextData.borderColor || null,
        copiedTextData.borderWidth ?? DEFAULT_BORDER_WIDTH,
        copiedTextData.fontWeight || DEFAULT_FONT_WEIGHT,
        copiedTextData.fontStyle || DEFAULT_FONT_STYLE,
        copiedTextData.textAlign || DEFAULT_TEXT_ALIGN,
        copiedTextData.fontFamily || DEFAULT_FONT_FAMILY,
        copiedTextData.fontSize || DEFAULT_FONT_SIZE,
        copiedTextData.width || null
      );
      
      if (container) {
        const textEl = container.querySelector(".fate-canvas-text");
        if (textEl) await persistTextState(newTextId, textEl, container);
        
        // Update container dimensions after paste
        updateTextUI(container);
      }
      
      ui.notifications.info("Текст вставлен");
    }
    
    // ---- Document-level handlers bound to this element ----
    const keydownHandler = (e) => {
      if (selectedTextId !== id) return;
      if (!isEditing && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault(); e.stopPropagation();
        deleteText();
      }
      if (!isEditing && (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "с" || e.code === "KeyC")) {
        e.preventDefault();
        document.execCommand('copy');
      }
    };

    const copyHandler = (e) => {
      if (selectedTextId !== id || isEditing) return;
      e.preventDefault(); e.stopPropagation();
      const transform = textElement.style.transform || "";
      const m = transform.match(/scale\(([\d.]+)\)/);
      const currentScale = m ? parseFloat(m[1]) : 1;
      const currentColor = textElement.style.color || DEFAULT_TEXT_COLOR;
      const currentBackgroundColor = textElement.style.backgroundColor || DEFAULT_BACKGROUND_COLOR;
      const currentBorderWidth = Number(textElement.dataset.borderWidth || DEFAULT_BORDER_WIDTH);
      const currentBorderColor = currentBorderWidth > 0
        ? (textElement.dataset.borderRgba || textElement.style.borderColor || null)
        : null;
      
      // Normalize font properties before copying
      const rawFontWeight = textElement.dataset.fontWeight || textElement.style.fontWeight || getComputedStyle(textElement).fontWeight;
      const rawFontStyle = textElement.dataset.fontStyle || textElement.style.fontStyle || getComputedStyle(textElement).fontStyle;
      
      // Capture current state for copying (includes font data)
      copiedTextData = {
        text: textElement.textContent,
        scale: currentScale,
        color: currentColor,
        backgroundColor: currentBackgroundColor,
        borderColor: currentBorderColor,
        borderWidth: currentBorderWidth,
        fontWeight: normalizeFontWeight(rawFontWeight),
        fontStyle: normalizeFontStyle(rawFontStyle),
        textAlign: textElement.dataset.textAlign || textElement.style.textAlign || DEFAULT_TEXT_ALIGN,
        fontFamily: textElement.dataset.fontFamily || textElement.style.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: parseInt(textElement.dataset.fontSize || textElement.style.fontSize || DEFAULT_FONT_SIZE),
        width: textElement.style.width ? parseFloat(textElement.style.width) : null
      };
      setCopiedImageData(null);
      
      // Persist current state to scene flags to ensure fonts are saved across socket hops
      persistTextState(id, textElement, container);

      // Add marker to clipboard so paste handler knows this is a FATE text copy
      if (e.clipboardData) e.clipboardData.setData("text/plain", `[FATE-TEXT-COPY:${id}]\n${textElement.textContent}`);
      ui.notifications.info("Текст скопирован (Ctrl+V для вставки)");
    };

    const onDocMouseDown = (e) => {
      if (window.fateColorPanel && window.fateColorPanel.contains(e.target)) {
        return;
      }
      if (e.button !== 0) return;
      container.style.setProperty("pointer-events", "auto", "important");
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit === container || container.contains(hit)) {
        if (!isSelected) {
          e.preventDefault(); e.stopPropagation();
          selectText();
        } else if (!window.fateColorPanel) {
          safeReshowColorPicker(id, 0);
        }
      } else {
        if (skipNextTextDeselect) {
          skipNextTextDeselect = false;
          return;
        }
        if (isSelected) {
          deselectText();
        } else {
          container.style.removeProperty("pointer-events");
        }
      }
    };

    document.addEventListener("keydown", keydownHandler);
    document.addEventListener("copy",    copyHandler);
    document.addEventListener("mousedown", onDocMouseDown, true);

    // Register disposer for this element
    disposers.set(id, () => {
      document.removeEventListener("keydown",  keydownHandler);
      document.removeEventListener("copy",     copyHandler);
      document.removeEventListener("mousedown", onDocMouseDown, true);
    });
  
    // Двойной клик для редактирования
    textElement.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isEditing = true;
      textElement.contentEditable = "true";
      textElement.style.userSelect = "text";
      textElement.focus();
      
      // Hide scale gizmo during editing with smooth animation
      if (resizeHandle.style.display !== "none") {
        resizeHandle.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
      }
      
      // Выделяем весь текст
      const range = document.createRange();
      range.selectNodeContents(textElement);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  
    // Завершение редактирования по Enter или потере фокуса
    textElement.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        textElement.contentEditable = "false";
        textElement.style.userSelect = "none";
        isEditing = false;
        textElement.blur();
        
        // Show scale gizmo after editing ends with smooth animation
        if (isSelected) {
          resizeHandle.style.display = "flex";
          resizeHandle.style.opacity = "0";
          resizeHandle.style.transform = "scale(0.8)";
          
          setTimeout(() => {
            requestAnimationFrame(() => {
              resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
              resizeHandle.style.opacity = "1";
              resizeHandle.style.transform = "scale(1)";
            });
          }, 100);
        }
      }
    });
    
    // Auto-expand width during typing
    textElement.addEventListener("input", async () => {
      if (isEditing) {
        // Check if width was manually set (not auto-expanded)
        const hasManualWidth = textElement.dataset.manualWidth === "true";
        
        if (!hasManualWidth) {
          // Only auto-expand if width wasn't manually set
          // Temporarily remove width constraint to measure natural width
          const currentWidth = textElement.style.width;
          textElement.style.width = "auto";
          
          // Get the natural width of the content
          const naturalWidth = textElement.scrollWidth;
          const minWidth = 100; // Minimum width
          const maxWidth = 800; // Maximum width to prevent excessive expansion
          
          // Set width to natural width, but within bounds
          const newWidth = Math.max(minWidth, Math.min(maxWidth, naturalWidth));
          textElement.style.width = `${newWidth}px`;
        }
        
        // Update panel position if it's open
        if (window.fateColorPanelUpdate) {
          window.fateColorPanelUpdate();
        }
        
        // Save the width change to sync with other clients
        await persistTextState(id, textElement, container);
        
        // Update container dimensions after size change
        updateTextUI(container);
      }
    });
  
    textElement.addEventListener("blur", async () => {
      if (isEditing) {
        textElement.contentEditable = "false";
        textElement.style.userSelect = "none";
        isEditing = false;
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить изменения
        await persistTextState(id, textElement, container);
        
        // Возвращаем в выделенное состояние
        selectText();
        
        // Show scale gizmo after editing ends with smooth animation
        if (isSelected) {
          resizeHandle.style.display = "flex";
          resizeHandle.style.opacity = "0";
          resizeHandle.style.transform = "scale(0.8)";
          
          setTimeout(() => {
            requestAnimationFrame(() => {
              resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
              resizeHandle.style.opacity = "1";
              resizeHandle.style.transform = "scale(1)";
            });
          }, 100);
        }
      }
    });
  
  
    // Перетаскивание — только левой кнопкой (на container)
    container.addEventListener("mousedown", (e) => {
      if (isEditing) return;
      
      // Только левая кнопка (0) → перетаскивание объекта
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        
        dragging = true;
        dragInitialized = false;
        startScreenX = e.clientX;
        startScreenY = e.clientY;
      
        // Запоминаем НАЧАЛЬНУЮ позицию КОНТЕЙНЕРА в пикселях
        startWorldX = parseFloat(container.style.left) || 0;
        startWorldY = parseFloat(container.style.top) || 0;
        
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      }
    });
  
    async function handleMouseMove(e) {
      if (isEditing || !dragging) return;
      
      // Дельта в экранных координатах
      const deltaScreenX = e.clientX - startScreenX;
      const deltaScreenY = e.clientY - startScreenY;

      if (!dragInitialized && (Math.abs(deltaScreenX) > 1 || Math.abs(deltaScreenY) > 1)) {
        dragInitialized = true;
        killColorPanel();
      }
      
      // Получаем текущий масштаб canvas (scale)
      const layer = getOrCreateLayer();
      const transform = layer?.style?.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      // Конвертируем дельту в world space (делим на scale)
      const deltaWorldX = deltaScreenX / scale;
      const deltaWorldY = deltaScreenY / scale;
      
      // Новая позиция в world coordinates - двигаем КОНТЕЙНЕР
      const newLeft = startWorldX + deltaWorldX;
      const newTop = startWorldY + deltaWorldY;
      
      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
      
      // Update panel position if it exists
      if (window.fateColorPanelUpdate) {
        window.fateColorPanelUpdate();
      }
    }
  
    async function handleMouseUp() {
      if (dragging) {
        dragging = false;
        dragInitialized = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить позицию КОНТЕЙНЕРА
        await persistTextState(id, textElement, container);
        
        // Re-assert selection and refresh panel positioning
        selectText();            // keeps outline, selection state, id
        window.fateColorPanelUpdate?.();
      }
    }
    
    // Resize handle
    resizeHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      
      resizing = true;
      resizeStartX = e.clientX;
      
      // Читаем ТЕКУЩИЙ scale из transform
      const transform = textElement.style.transform || "";
      const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
      resizeStartScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      
      
      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", handleResizeUp);
    });
    
    // Show resize cursor when hovering over borders
    textElement.addEventListener("mousemove", (e) => {
      if (isEditing || resizing) return;
      
      const rect = textElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      // Check if mouse is near left or right border (within 8px)
      if (x <= 8 || x >= width - 8) {
        textElement.style.cursor = "ew-resize";
      } else {
        textElement.style.cursor = "";
      }
    });
    
    // Border dragging functionality - detect when dragging left or right border
    textElement.addEventListener("mousedown", (e) => {
      if (isEditing || e.button !== 0) return;
      
      const rect = textElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      
      // Check if click is near left border (within 8px)
      if (x <= 8) {
        e.preventDefault();
        e.stopPropagation();
        
        resizing = true;
        resizeStartX = e.clientX;
        resizeStartScale = textElement.offsetWidth;
        
        // Hide scaling gizmo during resize with smooth animation
        resizeHandle.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
        
        // Set cursor to ew-resize
        textElement.style.cursor = "ew-resize";
        
        document.addEventListener("mousemove", handleLeftResize);
        document.addEventListener("mouseup", handleResizeUp);
      }
      // Check if click is near right border (within 8px)
      else if (x >= width - 8) {
        e.preventDefault();
        e.stopPropagation();
        
        resizing = true;
        resizeStartX = e.clientX;
        resizeStartScale = textElement.offsetWidth;
        
        // Hide scaling gizmo during resize with smooth animation
        resizeHandle.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        resizeHandle.style.opacity = "0";
        resizeHandle.style.transform = "scale(0.8)";
        setTimeout(() => {
          resizeHandle.style.display = "none";
        }, 150);
        
        // Set cursor to ew-resize
        textElement.style.cursor = "ew-resize";
        
        document.addEventListener("mousemove", handleRightResize);
        document.addEventListener("mouseup", handleResizeUp);
      }
    });
    
    function handleResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      
      // Новый scale (минимум 0.3, максимум 3.0, как у карточки)
      const newScale = resizeStartScale + (deltaX * 0.002);
      const clampedScale = Math.max(0.3, Math.min(3.0, newScale));
      
      // Применяем ТОЛЬКО scale к textElement
      textElement.style.transform = `scale(${clampedScale})`;
      
      // Обновляем позицию handle
      updateHandlePosition();
      
      // Update container dimensions after scale change
      updateTextUI(container);
      
      if (window.fateColorPanelUpdate) {
        window.fateColorPanelUpdate();
      }
    }
    
    function handleLeftResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      const newWidth = Math.max(50, resizeStartScale - deltaX);
      
      textElement.style.width = `${newWidth}px`;
      textElement.dataset.manualWidth = "true"; // Mark as manually set
      
      if (window.fateColorPanelUpdate) {
        window.fateColorPanelUpdate();
      }
      
      // Save the width change to sync with other clients
      persistTextState(id, textElement, container);
    }
    
    function handleRightResize(e) {
      if (!resizing) return;
      
      const deltaX = e.clientX - resizeStartX;
      const newWidth = Math.max(50, resizeStartScale + deltaX);
      
      textElement.style.width = `${newWidth}px`;
      textElement.dataset.manualWidth = "true"; // Mark as manually set
      
      if (window.fateColorPanelUpdate) {
        window.fateColorPanelUpdate();
      }
      
      // Save the width change to sync with other clients
      persistTextState(id, textElement, container);
    }
    
    async function handleResizeUp() {
      if (resizing) {
        resizing = false;
        document.removeEventListener("mousemove", handleResize);
        document.removeEventListener("mousemove", handleLeftResize);
        document.removeEventListener("mousemove", handleRightResize);
        document.removeEventListener("mouseup", handleResizeUp);
        
        // Reset cursor and show scaling gizmo again after resize
        textElement.style.cursor = "";
        if (isSelected) {
          resizeHandle.style.display = "flex";
          resizeHandle.style.opacity = "0";
          resizeHandle.style.transform = "scale(0.8)";
          
          // Animate scale handle reappearance with slight delay
          setTimeout(() => {
            requestAnimationFrame(() => {
              resizeHandle.style.transition = "opacity 0.2s ease, transform 0.2s ease";
              resizeHandle.style.opacity = "1";
              resizeHandle.style.transform = "scale(1)";
            });
          }, 100);
        }
        
        // Извлекаем scale из transform textElement
        const transform = textElement.style.transform || "";
        const scaleMatch = transform.match(/scale\(([\d.]+)\)/);
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        
        // Сохранить позицию контейнера + scale textElement
        await persistTextState(id, textElement, container);
        
        // Re-assert selection and refresh panel positioning
        selectText();            // keeps outline, selection state, id
        window.fateColorPanelUpdate?.();
      }
    }
    
    
    
    updateTextUI(container);
    return container;
}

async function addTextToCanvas(clickX, clickY, autoEdit = false) {
    // Проверяем готовность canvas
    if (!canvas || !canvas.ready) {
      ui.notifications.warn("Canvas не готов");
      return;
    }
  
    const layer = getOrCreateLayer();
  
    // Позиция: клик + 30px вправо (в screen space)
    const screenX = clickX + 30;
    const screenY = clickY;
    
    // Конвертируем screen → world coordinates
    const worldPos = screenToWorld(screenX, screenY);
    
    // Создаем новый текст в world coordinates
    const textId = `fate-text-${Date.now()}`;
    const container = createTextElement(textId, autoEdit ? "" : "Двойной клик для редактирования", worldPos.x, worldPos.y, DEFAULT_TEXT_SCALE, DEFAULT_TEXT_COLOR, DEFAULT_BACKGROUND_COLOR, null, DEFAULT_BORDER_WIDTH, DEFAULT_FONT_WEIGHT, DEFAULT_FONT_STYLE, DEFAULT_TEXT_ALIGN, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, null);
    if (!container) return;
    const textEl = container.querySelector(".fate-canvas-text");
    if (!textEl) return;
    await persistTextState(textId, textEl, container);
    
    // Update container dimensions after creation
    updateTextUI(container);
    
    // If in text mode, automatically enter edit mode
    if (autoEdit) {
      // Select the text element first
      const selectEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: clickX,
        clientY: clickY
      });
      container.dispatchEvent(selectEvent);
      
      // Then trigger edit mode
      setTimeout(() => {
        const editEvent = new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          clientX: clickX,
          clientY: clickY
        });
        textEl.dispatchEvent(editEvent);
      }, 100);
    }
    
    ui.notifications.info("Текстовый элемент добавлен. Двойной клик для редактирования.");
  }

async function getAllTexts() {
  try {
    return await canvas.scene?.getFlag(FLAG_SCOPE, FLAG_KEY_TEXTS) || {};
  } catch (e) {
    console.error("[FATE-TC] getAllTexts error:", e);
    return {};
  }
}

async function setAllTexts(texts) {
    try {
      if (game.user.isGM) {
        // GM сохраняет в базу
        await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_KEY_TEXTS);
        await new Promise(resolve => setTimeout(resolve, 50));
        await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_KEY_TEXTS, texts);
        // Эмитим всем
        game.socket.emit(`module.${MODID}`, { type: "textUpdate", texts });
      } else {
        // Игрок отправляет запрос GM через сокет
        game.socket.emit(`module.${MODID}`, { type: "textUpdateRequest", texts, userId: game.user.id });
        
        // Обновляем локально для немедленной реакции UI у игрока
        const layer = getOrCreateLayer();
        if (layer) {
          // Получаем все существующие текстовые элементы
          const existingElements = layer.querySelectorAll(".fate-canvas-text-container");
          const existingIds = new Set();
          
          // Обновляем существующие и создаем новые тексты локально
          for (const [id, textData] of Object.entries(texts)) {
            existingIds.add(id);
            const existing = document.getElementById(id);
            if (existing) {
              // Обновляем существующий элемент
              const textElement = existing.querySelector(".fate-canvas-text");
              if (textElement) {
                textElement.textContent = textData.text;
                existing.style.left = `${textData.left}px`;
                existing.style.top = `${textData.top}px`;
                textElement.style.transform = `scale(${textData.scale})`;
                textElement.style.color = textData.color || DEFAULT_TEXT_COLOR;
                textElement.style.backgroundColor = textData.backgroundColor || DEFAULT_BACKGROUND_COLOR;
                applyBorderDataToElement(textElement, textData.borderColor, textData.borderWidth);
                
                // Apply font weight and style to existing elements
                applyFontVariantToElement(textElement, textData.fontWeight || DEFAULT_FONT_WEIGHT, textData.fontStyle || DEFAULT_FONT_STYLE);

                // Apply text alignment to existing elements
                applyTextAlignmentToElement(textElement, textData.textAlign || DEFAULT_TEXT_ALIGN);

                // Apply font family to existing elements
                applyFontFamilyToElement(textElement, textData.fontFamily || DEFAULT_FONT_FAMILY);

                // Apply font size to existing elements
                applyFontSizeToElement(textElement, textData.fontSize || DEFAULT_FONT_SIZE);

                // Apply width if present
                if (textData.width && textData.width > 0) {
                  textElement.style.width = `${textData.width}px`;
                  textElement.dataset.manualWidth = "true"; // Mark as manually set
                } else {
                  textElement.style.width = '';
                  textElement.dataset.manualWidth = "false"; // Mark as auto
                }
                
                // Clamp container to scaled dimensions
                const scale = getTextScale(textElement);
                const width = textElement.offsetWidth * scale;
                const height = textElement.offsetHeight * scale;
                existing.style.width = `${width}px`;
                existing.style.height = `${height}px`;
                
                // Update resize handle position after scale/size changes
                updateTextUI(existing);
              }
            } else {
              // Создаем новый элемент
              const createdContainer = createTextElement(
                id,
                textData.text,
                textData.left,
                textData.top,
                textData.scale,
                textData.color || DEFAULT_TEXT_COLOR,
                textData.backgroundColor || DEFAULT_BACKGROUND_COLOR,
                textData.borderColor || null,
                textData.borderWidth ?? DEFAULT_BORDER_WIDTH,
                textData.fontWeight || DEFAULT_FONT_WEIGHT,
                textData.fontStyle || DEFAULT_FONT_STYLE,
                textData.textAlign || DEFAULT_TEXT_ALIGN,
                textData.fontFamily || DEFAULT_FONT_FAMILY,
                textData.fontSize || DEFAULT_FONT_SIZE,
                textData.width ?? null
              );
              
              if (createdContainer) {
                const textElement = createdContainer.querySelector(".fate-canvas-text");
                if (textElement) {
                  textElement.style.color = textData.color || DEFAULT_TEXT_COLOR;
                  textElement.style.backgroundColor = textData.backgroundColor || DEFAULT_BACKGROUND_COLOR;
                  applyBorderDataToElement(textElement, textData.borderColor, textData.borderWidth);
                  
                  // Apply manual width flag if width was set
                  if (textData.width && textData.width > 0) {
                    textElement.dataset.manualWidth = "true";
                  } else {
                    textElement.dataset.manualWidth = "false";
                  }
                  
                  // Clamp container to scaled dimensions for new elements
                  const scale = getTextScale(textElement);
                  const width = textElement.offsetWidth * scale;
                  const height = textElement.offsetHeight * scale;
                  createdContainer.style.width = `${width}px`;
                  createdContainer.style.height = `${height}px`;
                }
                updateTextUI(createdContainer);
              }
            }
          }
          
          // Удаляем элементы, которых больше нет в texts
          existingElements.forEach(element => {
            if (!existingIds.has(element.id)) {
              // Clean up color pickers before removing element
              killColorPanel();
              destroyTextElementById(element.id);
            }
          });
        }
      }
    } catch (e) {
      console.error("[FATE-TC] setAllTexts error:", e);
    }
}

function getTextScale(textEl) {
  const m = (textEl.style.transform || "").match(/scale\(([\d.]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}

function updateTextResizeHandlePosition(container) {
  if (!container) return;
  const textEl = container.querySelector(".fate-canvas-text");
  const handle = container.querySelector(".fate-text-resize-handle");
  if (!textEl || !handle) return;

  const scale = getTextScale(textEl);
  const w = textEl.offsetWidth * scale;
  const h = textEl.offsetHeight * scale;

  // sync container to the visual footprint so selection hits match what you see
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;

  handle.style.left = `${w - 6}px`;
  handle.style.top  = `${h - 6}px`;
}

/** Public one-shot refresher used after socket-driven updates */
function updateTextUI(containerOrId) {
  const container = typeof containerOrId === "string"
    ? document.getElementById(containerOrId)
    : containerOrId;
  if (!container) return;
  updateTextResizeHandlePosition(container);
}

export const TextTools = {
  // UI and actions
  createTextElement,
  injectTextTool,
  handleTextPasteFromClipboard,
  globalPasteText,
  addTextToCanvas,

  // scene storage
  getAllTexts,
  setAllTexts,

  // controlled access to mutable state
  get selectedTextId() { return selectedTextId; },
  set selectedTextId(v) { selectedTextId = v; },

  get copiedTextData() { return copiedTextData; },
  set copiedTextData(v) { copiedTextData = v; },

  // re-export helpers for convenience
  screenToWorld,
  worldToScreen,

  // UI refresher
  updateTextUI,

  // border helper for external callers
  applyBorderDataToElement,

  // font helper for external callers
  applyFontVariantToElement,

  // text alignment helper for external callers
  applyTextAlignmentToElement,

  // font family helper for external callers
  applyFontFamilyToElement,

  // font size helper for external callers
  applyFontSizeToElement,

  // font detection helper
  getAvailableFonts,

  // defaults
  DEFAULT_TEXT_COLOR,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_TEXT_SCALE,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_FONT_STYLE,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE
};
