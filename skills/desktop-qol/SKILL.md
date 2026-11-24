---
name: desktop-qol
description: Open the native Desktop QoL settings side-pane panel or help configure CDP (--remote-debugging-port) for Antigravity Desktop custom wallpaper, flat UI, live session stats bar, and double-ESC cancel.
---

# Desktop QoL Panel

Open or guide the user to the **Desktop QoL** side-pane panel (`agy-desktop-qol/qol_panel`), or help them launch Antigravity Desktop with CDP enabled.

## Instructions

1. Check read-only whether the `agy-desktop-qol/qol_panel` sidecar is active:
   - Look up `.sidecars["agy-desktop-qol/qol_panel"].enabled == true` in `~/.gemini/config/config.json`, or
   - Check if `~/.gemini/antigravity/sidecar_data/agy-desktop-qol/qol_panel/logs/sidecar.log` exists and is non-empty.
2. **If active**, output the one-click pill on its own line:
   `[Desktop QoL](sidecar://agy-desktop-qol/qol_panel/)`
   Tell the user they can also open it from the side panel `+` menu (`Cmd+T`) or `⋮ -> Extensions -> Desktop QoL`.
3. **If not yet enabled**, do not emit a `sidecar://` link. Instead, provide:
   - `[Desktop QoL](customization://agy-desktop-qol)`
   - `[Open Sidecars Dashboard](sidecar://dashboard)`
   Ask the user to enable **Desktop QoL** once so it runs in the side panel `+` menu (`Cmd+T`).
4. **If the user asks how to enable CDP** (or styles/stats are not injecting):
   Provide the launch commands with `--remote-debugging-port=9222`:
   - **macOS**: `open -a Antigravity --args --remote-debugging-port=9222`
   - **Windows**: `Antigravity.exe --remote-debugging-port=9222`
   - **Linux**: `antigravity --remote-debugging-port=9222`
   Note that the CDP port can also be customized inside the Desktop QoL panel or via `AGY_CDP_PORT`, and the plugin modifies zero Antigravity application files.
