#!/usr/bin/env bash
# Install the debug APK and run each first-run scenario on a fresh app.
set -u
PKG=com.kspress.thread
mkdir -p smoke
APK=$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' | head -1)
echo "APK: $APK"
adb install -r "$APK"
for scenario in newvault sample loom; do
  echo "::group::scenario $scenario"
  adb shell pm clear "$PKG" > /dev/null
  adb logcat -c
  adb shell am start -n "$PKG/.MainActivity"
  sleep 25
  SOCK=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
  echo "devtools socket: $SOCK"
  adb forward --remove-all
  adb forward tcp:9222 "localabstract:$SOCK"
  timeout 180 node scripts/android-smoke.mjs "$scenario" || echo "driver exited with $?"
  sleep 3
  if adb shell pidof "$PKG" > /dev/null; then echo "RESULT $scenario: app alive"; else echo "RESULT $scenario: APP DIED"; fi
  adb exec-out screencap -p > "smoke/$scenario-end.png"
  adb logcat -d > "smoke/$scenario-logcat.txt"
  echo "--- crash / error lines ---"
  grep -E "FATAL|AndroidRuntime|panicked|RustStdoutStderr|Tauri|SIGABRT|SIGSEGV|libc *:|chromium.*(Uncaught|Error)|Console" "smoke/$scenario-logcat.txt" | tail -80
  echo "::endgroup::"
done
