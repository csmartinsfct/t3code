{
  "targets": [{
    "target_name": "panel_window",
    "sources": [],
    "cflags_cc": ["-std=c++17"],
    "conditions": [
      ["OS=='mac'", {
        "sources": ["panel-window.mm"],
        "libraries": ["Foundation.framework", "AppKit.framework"],
        "xcode_settings": {
          "OTHER_CFLAGS": ["-x objective-c++ -stdlib=libc++"],
          "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
          "MACOSX_DEPLOYMENT_TARGET": "12.0"
        }
      }]
    ]
  }]
}
