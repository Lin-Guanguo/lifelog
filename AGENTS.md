# AGENTS.md

LifeLog: a local-first Android app (Vue 3 + Vite + Capacitor 8) for logging short timestamped lines.
The owner (Lin Guanguo) uses it for workouts and passing thoughts; organizing the log happens later,
elsewhere (CyberMnema). Behaviour and data model: [docs/spec.md](docs/spec.md).

## Reading the owner's data

When asked to look at, analyze or summarize the owner's log, use `scripts/lifelog.mjs`; do not query the
WebDAV server by other means and never write to it.

```bash
pnpm --silent lifelog pull          # fetch the latest synced file → .data/lifelog.sqlite
pnpm --silent lifelog info --json   # what is there: counts, date range, schema version
pnpm --silent lifelog list --from 2026-11-01 --to today --json
pnpm --silent lifelog search 卧推 --json
pnpm --silent lifelog sql "SELECT ..." --json   # anything else; changes are never saved
pnpm --silent lifelog help
```

- `pull` needs `.env` (keys in `.env.example`). If it is missing, ask the owner; never invent credentials.
- Pull first when freshness matters; `info` shows when the local copy was fetched.
- Use `--silent` (not `-s`) or `node scripts/lifelog.mjs` so `--json` output parses.
- Data model: one row per saved text in `records`. Rows with the same `entry_id` are one entry and its edits;
  `deleted_at IS NULL` marks the entry's current text, other rows are in the trash (deleted or pre-edit).
  `logged_at` is when the entry was written (epoch ms), unchanged by edits. Analyze live rows unless asked.
- The log is private: don't commit `.env` or `.data/`, and don't send its contents to outside services.

## Development

Tools are pinned in `mise.toml`; run commands through it (`mise x -- pnpm …`) if they are not on PATH.

```bash
pnpm install
pnpm test               # unit tests (vitest): data layer, migrations, sync, i18n
pnpm e2e                # browser flows on the production build (Playwright; PW_CHROMIUM_PATH for a local Chromium)
pnpm gallery            # every screen, light + dark, with flow notes → docs/design/ui.html (review UI changes here)
pnpm build              # type-check + production build
pnpm android && (cd android && ./gradlew :app:testDebugUnitTest assembleDebug)   # APK
```

Layout: `src/views` (screens), `src/components`, `src/data` (all SQL in `records.ts`, platform-free;
`schema.ts` migrations; `sqlite.ts` Capacitor adapter), `src/sync` (WebDAV), `src/i18n`, `e2e`,
`test-support` (mock WebDAV server), `android` (incl. the native `WebDavHttpPlugin`), `resources` (icon source).

Rules that are easy to break:
- **Schema**: never edit a shipped migration in `src/data/schema.ts`; append a new one. The version is
  `PRAGMA user_version`.
- **Text**: every user-visible string goes through `t()` with keys in `src/i18n/zh-CN.ts` (source) and every
  other catalog; the i18n test checks keys and placeholders match.
- **Content is immutable**: edits insert a new row and soft-delete the old one; only `deleted_at` changes.
  Sync merging relies on this.
- **sql.js stays at 1.12.0** (`pnpm-workspace.yaml`): jeep-sqlite bundles that version's glue.
- UI changes: keep `e2e/gallery.spec.ts` covering every screen and its flow notes current.
- **Signing key** (`~/.android/lifelog-release.jks` + `.password`): the app's identity; never commit, print or move it.
  Releases: `.github/workflows/release.yml`, run by hand only when the owner asks (README → Release). The version lives
  only in `package.json`; each release needs its `CHANGELOG.md` section.
- Icons: edit `resources/icon-foreground.svg`, then `node scripts/gen-icons.mjs`.
