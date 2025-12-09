# Whiteboard Experience

FoundryVTT module that provides whiteboard (think Miro / Figma) images and texts tools to the Token Tools layer

## Features

### Text Objects
- Create text anywhere on the canvas (press `T`, then click; right click to disable)
- Rich text styling: font size, color, background, border, opacity
- Drag and scale texts
- Copy/paste support

### Image Objects  
- Paste images directly from clipboard (`Ctrl+V`)
- Crop, scale, and position images
- Border and shadow styling

### Mass Selection
- Select multiple objects at once (toggle in token tools or `Shift+drag`)
- Move, copy, delete selected objects together

### Collaboration
- Real-time sync between players via sockets
- Persistent storage — objects survive page reload
- GM as a single source of truth server 
- Csreful: if GM is not online your edits won't be stored!

### Other
- Z-index control (`PageUp`/`PageDown`)
- Lock objects to prevent accidental edits (when edited)
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
