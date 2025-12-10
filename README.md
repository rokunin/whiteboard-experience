# Whiteboard Experience

FoundryVTT module that provides whiteboard-style tools for images, text, shapes, and freehand drawing.

**Important:** WBE objects live in a layer ABOVE the standard Foundry canvas. They will overlay tokens, tiles, drawings, and other native VTT objects.

## Why This Plugin Exists

I love narrative games like Fate — light, collaborative, fast-paced. All I need is pretty dice, quick table setup, and everything visible to everyone.

Foundry is powerful but heavyweight, built for tactical grid combat and beautiful but cumbersome scenes. Simple collaborative layouts are trivially easy in whiteboard tools, but overkill in Foundry's UI.

So I built this: whiteboard vibes inside Foundry. Fast, lightweight, collaborative. Beautiful game tables in minutes.

## Features

### WBE Floating Toolbar
- Independent toolbar next to Foundry controls
- Draggable — grab the "WBE" header and move it anywhere
- Position persists between sessions
- Tools: Rectangle (`R`), Circle (`C`), Freehand (`F`), Multi-select, Alignment guides toggle

### Shapes (Rectangles & Circles)
- Create rectangles and circles directly on canvas
- Hotkeys: `R` — rectangle, `C` — circle
- Styling: fill color, border (color, width, style, radius), shadow
- Shadow with color, opacity, and X/Y offset controls
- Drag & resize like other objects

### Freehand Drawing
- Draw freehand directly on canvas (`F`)
- Settings: color, stroke width, smoothing
- SVG-based — clean vector lines

### Text Objects
- Create text anywhere on the canvas (press `T`, then click; right click to disable)
- Rich text styling: font size, color, background, border, opacity
- Drag and scale texts
- Copy/paste support

### Image Objects  
- Paste images directly from clipboard (`Ctrl+V`)
- Crop, scale, and position images
- Border and shadow styling (with X/Y offset)

### Mass Selection
- Select multiple objects at once (toggle in toolbar or `Shift+drag`)
- Move, copy, delete selected objects together

### Smart Alignment
- Hold `Shift` while dragging to see alignment guides
- Snap to edges and centers of other objects
- Visual guides show matching boundaries
- Toggle on/off from WBE toolbar

### Collaboration
- Real-time sync between players via sockets
- Persistent storage — objects survive page reload
- GM as a single source of truth server 
- Careful: if GM is not online your edits won't be stored!

### Styling
- Enhanced color picker with swatches and custom colors
- Shadow controls for all object types (shapes use SVG filters, images use CSS)
- Compact sliders for shadow opacity and X/Y offset
- Border subpanel with all border + shadow settings in one place

### Hotkeys
- `R` — Rectangle tool
- `C` — Circle tool  
- `F` — Freehand tool
- `T` — Text tool
- `Delete` — delete selected
- `PageUp/PageDown` — z-index control
- `Ctrl+C/V` — copy/paste

### Other
- Z-index control (`PageUp`/`PageDown`)
- Lock objects to prevent accidental edits
- Freeze images from the style panel

## Compatibility
- Foundry VTT v11 - v13

## Installation

1. In Foundry, go to Add-on Modules → Install Module
2. Paste manifest URL: `https://github.com/rokunin/whiteboard-experience/releases/latest/download/module.json`
3. Enable the module in your world

## Usage

1. Make sure the WBE icon is in your Token Layer toolbar
2. Press `T` to enter text mode, click to create text
3. Paste images with `Ctrl+V`
4. Use the styling panel (appears on selection) to customize objects
5. Toggle WBE icon in token tools for multi-select without Shift

## License

MIT
