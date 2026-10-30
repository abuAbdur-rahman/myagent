# Chromium page tree activation

Walk the renderer window, not the top-level Chromium window.

- `Chrome_WidgetWin_1` (Edge/Chrome/Electron) exposes only browser chrome from
  the top-level window: tabs, toolbar, address bar (`OmniboxViewViews`).
- The page tree lives on the `Chrome_RenderWidgetHostHWND` child. Resolve it
  with `EnumChildWindows`, then `IUIAutomation::ElementFromHandle` on that
  handle, and read a property to force Chromium to switch the renderer into
  accessibility mode.
- Poll until a `Document` node appears; activation is asynchronous.
- `WM_GETOBJECT` with `OBJID_CLIENT` (-4) is the MSAA path and does not give UIA
  a provider. `UiaRootObjectId` (-25) is the UIA object id if the message is
  sent directly.
- Chromium drops the mode again after the tab has been hidden for a while, so a
  failed lookup must retry rather than assume the tree is gone.

## Consequences in MyAgent

- `get_state` builds the tree from the renderer element when the window class
  contains `chrome_widgetwin`, and reports `page_tree_unavailable` plus a hint
  when even that yields no `Document`.
- Element typing into a Chromium window without a page tree is refused with
  `chromium_content_unavailable`, because the only reachable edit is the
  address bar.
- App-only typing in a Chromium window requires `confirm=true`
  (`unverified_focus` otherwise), because the focused control cannot be
  verified through UIA there.
- Every snapshot stores the window handle, and coordinate clicks refuse with
  `not_foreground` unless the target window is foreground, so a click cannot
  land in another window, a popup, or browser chrome.
