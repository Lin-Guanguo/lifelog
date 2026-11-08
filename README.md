# LifeLog

Local-first Android app for logging short timestamped lines. See [docs/spec.md](docs/spec.md) and the
[mockups](docs/design/mockups.html).

Stack: Vue 3 + TypeScript + Vite, Capacitor 8, SQLite via `@capacitor-community/sqlite` (jeep-sqlite/sql.js on the web).

## Layout

```text
src/
  main.ts, App.vue     startup and screen stack
  views/               full screens (main log, view, edit, search, settings, trash)
  components/          shared pieces (sheet, dialogs, icons, highlighting)
  data/                records.ts (all SQL, platform-free), sqlite.ts (Capacitor adapter), preferences.ts
  i18n/                message catalogs; zh-CN is the source, others are type-checked against it
  store.ts, back.ts    shared state, Android back-button stack
e2e/                   Playwright acceptance flow
android/               Capacitor Android project (committed; build output ignored)
docs/                  spec and mockups
```

## Setup

Tools are pinned in `mise.toml` (Node, pnpm, JDK 21, Android command-line tools).

```bash
mise install
mise run android-setup   # Android platform, build-tools, platform-tools
pnpm install
```

## Develop

```bash
pnpm dev                 # browser at http://localhost:5173 (SQLite persisted in IndexedDB)
pnpm test                # data-layer and i18n unit tests
pnpm e2e                 # browser acceptance flow (Playwright)
```

`pnpm e2e` uses Playwright's pinned Chromium; set `PW_CHROMIUM_PATH` to use another Chromium binary.

## Build the APK

```bash
pnpm android             # web build + copy into android/
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with this machine's debug key; later builds from the same machine install as updates.

## Notes

- `sql.js` is pinned to 1.12.0 (`pnpm-workspace.yaml`): jeep-sqlite bundles that version's JS glue, and the
  `sql-wasm.wasm` copied to `public/assets` must match it.
