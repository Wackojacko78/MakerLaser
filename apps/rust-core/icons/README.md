# App icons

All files here are generated from the MakerLaser logo:

| File | Use |
|---|---|
| `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` | Linux bundles / window icon (RGBA PNG) |
| `icon.ico` | **Windows** (required by `tauri-build`): 16, 24, 32, 48, 64 and 256 px layers |
| `icon.icns` | macOS |

To regenerate every size from a new master image, run from the repository root:

```bash
npm run tauri icon path/to/new-icon.png
```
