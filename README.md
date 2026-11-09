# LifeLog

Local-first Android app for logging short timestamped lines. See [docs/spec.md](docs/spec.md); `pnpm gallery`
renders every screen into `docs/design/ui.html` for design review.

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
e2e/                   Playwright acceptance flows and the UI gallery
android/               Capacitor Android project (committed; build output ignored)
docs/                  spec; docs/design/ui.html is generated (git-ignored)
resources/             icon source SVG
scripts/               build helpers (sql.js wasm copy, icon generation)
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
pnpm gallery             # screenshots of every screen, light + dark, with flow notes → docs/design/ui.html
```

`pnpm e2e` uses Playwright's pinned Chromium; set `PW_CHROMIUM_PATH` to use another Chromium binary.

## Build the APK

```bash
pnpm android             # web build + copy into android/
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Builds are signed with the release key `~/.android/lifelog-release.jks` (password in `lifelog-release.password`
beside it; both kept on N100 and tencent2, never in git) when it is present, so local builds and GitHub releases
install over each other. Without it, debug builds fall back to the SDK debug key, which cannot update a released app.
The version is `package.json`'s (versionCode = x·10000 + y·100 + z).

## Release

1. Bump `version` in `package.json` and add its section to `CHANGELOG.md` (the release notes, shown in the app).
2. Commit and push to main, then start the workflow by hand:

```bash
gh workflow run release.yml   # or GitHub → Actions → Release → Run workflow
```

It refuses a version that is not newer than the latest release or has no changelog section, runs the unit, browser
and Android tests, builds the APK signed with the key from the repository secrets `LIFELOG_KEYSTORE_BASE64` and
`LIFELOG_KEYSTORE_PASSWORD`, tags `vX.Y.Z` and publishes the Release with `lifelog-X.Y.Z.apk`. Installed apps find it
through their update check.

## Read the data on a computer

The app syncs a standard SQLite file to `<folder>/lifelog.sqlite` on WebDAV. `scripts/lifelog.mjs` fetches
and queries it. Copy `.env.example` to `.env` (ignored by git) and fill in the same server, user, app
password and folder, then:

```bash
pnpm --silent lifelog pull                    # → .data/lifelog.sqlite (ignored by git)
pnpm --silent lifelog info
pnpm --silent lifelog list --from 2026-11-01 --to today
pnpm --silent lifelog search 卧推 --json
pnpm --silent lifelog sql "SELECT COUNT(*) FROM records"
pnpm --silent lifelog help                    # all commands and options (--db, --out, --remote, …)
```

Use `--silent` (not `-s`) or `node scripts/lifelog.mjs …` so stdout carries only the output.

## App icon

`resources/icon-foreground.svg` is the source. After changing it, regenerate the Android launcher icons and
splash screens (needs a Chromium for Playwright; `PW_CHROMIUM_PATH` works here too):

```bash
node scripts/gen-icons.mjs
```

## Notes

- `sql.js` is pinned to 1.12.0 (`pnpm-workspace.yaml`): jeep-sqlite bundles that version's JS glue, and the
  `sql-wasm.wasm` copied to `public/assets` must match it.
