# seekchat

The Expo / React Native app behind **LoveSeek**. Features, screenshots, and
the full introduction live in the [repository README](../README.md).

## Development

```bash
npm install
npx expo start   # Expo Go covers most features; native module needs a dev build
npm test         # jest test suites in src/__tests__/
npm run lint
```

## Building an APK

See [BUILD.md](BUILD.md) — `npm run build:apk` runs a local EAS build with
your own Expo account and Android keystore.
