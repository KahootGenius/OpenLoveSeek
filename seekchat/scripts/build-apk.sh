#!/usr/bin/env bash
# Local EAS build — free & unlimited, signed with the SAME remote keystore as
# cloud builds, so the APK installs over any existing LoveSeek install.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
STAMP=$(date +%Y%m%d-%H%M)
# Resolve-then-verify: java_home -v 21 silently returns the DEFAULT JDK (exit 0)
# when 21 is missing — fail fast instead of dying 15 min into gradle.
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21)"
  case "$JAVA_HOME" in
    *21*) ;;
    *) echo "error: JDK 21 not found (java_home returned: $JAVA_HOME); install JDK 21 or set JAVA_HOME" >&2; exit 1 ;;
  esac
fi
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
# On this macOS setup, Kotlin daemon writes under
# ~/Library/Application Support/kotlin/daemon can be denied during local EAS
# builds. Run the build under a temp HOME, but seed Expo auth so eas-cli stays
# logged in.
REAL_HOME="$HOME"
BUILD_HOME="$(mktemp -d "${TMPDIR:-/tmp}/loveseek-build-home.XXXXXX")"
trap 'rm -rf "$BUILD_HOME"' EXIT
mkdir -p "$BUILD_HOME/.expo" "$BUILD_HOME/Library/Application Support/kotlin/daemon"
if [ -f "$REAL_HOME/.expo/state.json" ]; then
  cp "$REAL_HOME/.expo/state.json" "$BUILD_HOME/.expo/state.json"
fi
export HOME="$BUILD_HOME"
# Stale local-build temp dirs eat GIGABYTES each; a full disk (or a Mac going
# to sleep) kills gradle mid-build with a bare "termination signal" (field
# incident 2026-07-18). Clean first, then build under caffeinate.
rm -rf "${TMPDIR:-/tmp}"/eas-build-local-nodejs/* 2>/dev/null || true
FREE_GB=$(df -g . | awk 'NR==2 {print $4}')
if [ "${FREE_GB:-0}" -lt 8 ]; then
  echo "error: only ${FREE_GB}GB free — the build needs ~8GB headroom; free some space" >&2
  exit 1
fi
caffeinate -i -m npx -y eas-cli build -p android --profile preview --local \
  --non-interactive --output "dist/loveseek-$STAMP.apk"
echo "APK: dist/loveseek-$STAMP.apk"
