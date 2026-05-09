// N-API port of @egoist/electron-panel-window (MIT), simplified approach.
// Instead of object_setClass (which overwrites Electron's style mask and
// breaks the native frame), we just set the collection behavior and prevent
// activation directly on the existing NSWindow. This preserves the frame.

#import <AppKit/AppKit.h>
#include <node_api.h>

@interface NSWindow (Private)
- (void)_setPreventsActivation:(bool)preventsActivation;
@end

// ---- MakePanel --------------------------------------------------------------

static napi_value MakePanel(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  void* data = nullptr;
  size_t byteLength = 0;
  napi_get_buffer_info(env, args[0], &data, &byteLength);

  NSView* view = data ? *reinterpret_cast<NSView**>(data) : nil;
  napi_value result;
  if (!view) { napi_get_boolean(env, false, &result); return result; }

  NSWindow* win = view.window;

  // Allow the window to appear alongside the full-screen Space as an auxiliary
  // window, without being in a completely separate Space.
  win.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary |
                           NSWindowCollectionBehaviorParticipatesInCycle;

  // Prevent the popup from stealing focus/activating the app when clicked.
  [win _setPreventsActivation:true];

  napi_get_boolean(env, true, &result);
  return result;
}

// ---- MakeWindow -------------------------------------------------------------

static napi_value MakeWindow(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  void* data = nullptr;
  size_t byteLength = 0;
  napi_get_buffer_info(env, args[0], &data, &byteLength);

  NSView* view = data ? *reinterpret_cast<NSView**>(data) : nil;
  napi_value result;
  if (!view) { napi_get_boolean(env, false, &result); return result; }

  view.window.collectionBehavior = NSWindowCollectionBehaviorDefault;

  napi_get_boolean(env, true, &result);
  return result;
}

// ---- Module init ------------------------------------------------------------

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "MakePanel", NAPI_AUTO_LENGTH, MakePanel, nullptr, &fn);
  napi_set_named_property(env, exports, "MakePanel", fn);
  napi_create_function(env, "MakeWindow", NAPI_AUTO_LENGTH, MakeWindow, nullptr, &fn);
  napi_set_named_property(env, exports, "MakeWindow", fn);
  return exports;
}

NAPI_MODULE(panel_window, Init)
