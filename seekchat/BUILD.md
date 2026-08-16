# Building LoveSeek APKs locally

Local builds are free and unlimited (no EAS build quota) and are signed with
the same keystore as your cloud builds — the APK installs over an existing
LoveSeek install with all chats/memories intact.

## One-time setup

- JDK 21 — the build script auto-detects it via `/usr/libexec/java_home` on
  macOS; elsewhere, set `JAVA_HOME` yourself
- Android SDK (+ NDK 27.x) — defaults to `~/Library/Android/sdk`, or set
  `ANDROID_HOME`
- An [Expo](https://expo.dev) account, logged in: `npx eas-cli login`
- Link the app to *your own* EAS project: `npx eas-cli init`
  (writes `extra.eas.projectId` into `app.json`)
- Android signing credentials: `npx eas-cli credentials -p android` to
  generate a keystore once — local builds fetch it on each run

## One command

```bash
npm run build:apk
```

Output: `dist/loveseek-<YYYYMMDD-HHMM>.apk`.

Takes ~10–20 min. Run it backgrounded with output to a log file and check an
explicit end marker — never trust a piped exit code past a shell timeout:

```bash
npm run build:apk > build-local.log 2>&1 &
tail -f build-local.log   # look for "APK: dist/…"
```

## Known contingency: appVersionSource

`eas.json` uses `"appVersionSource": "remote"`. If a local build errors on
version resolution, switch to local versioning:

1. In `eas.json`: `"appVersionSource": "local"`.
2. In `app.json`: set `expo.android.versionCode` to ONE GREATER than the last
   cloud build's code:
   `npx eas-cli build:list --limit 1 --json | python3 -c "import sys,json; print(json.loads(sys.stdin.read(),strict=False)[0].get('appBuildVersion'))"`
3. Commit with the reason; bump versionCode by 1 for every subsequent release.

## Fallback chain

1. Retry — gradle downloads resume from cache, so flaky networks usually
   succeed on the second attempt.
2. Fully offline signing: `npx eas-cli credentials -p android` → download
   `credentials.json` + keystore (BOTH are gitignored — never commit them).
3. Cloud build (`npx eas-cli build -p android --profile preview`) as last
   resort — it consumes the free-tier quota (~15 builds/month).

## Installing on a device

Transfer the APK to the phone and tap to install OVER the existing app — do
NOT uninstall first (uninstalling wipes the local SQLite database). Before
major upgrades, run 设置 → 导出 as a belt-and-braces backup.
