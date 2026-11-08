# LifeLog spec

A local-first Android app for logging short, timestamped lines (workouts, thoughts, anything).
Entries are stored raw; organizing them is left to CyberMnema later.

## Data

One SQLite table. Content is never modified in place.

```sql
CREATE TABLE records (
  id          TEXT PRIMARY KEY,   -- one row per saved text
  entry_id    TEXT NOT NULL,      -- shared by an entry and all its edits
  logged_at   INTEGER NOT NULL,   -- original time (ms), copied on edit
  content     TEXT NOT NULL,
  written_at  INTEGER NOT NULL,   -- when this row was saved
  deleted_at  INTEGER             -- NULL = live; set = in the trash
);
-- at most one live row per entry
CREATE UNIQUE INDEX records_one_live ON records(entry_id) WHERE deleted_at IS NULL;
```

### Schema versions

The schema version is SQLite's standard `PRAGMA user_version`. `src/data/schema.ts` holds an ordered
list of migrations (the table above is v1); on open, each missing step runs in its own transaction
together with its version bump. Databases from v0.1.x (no version, table already present) upgrade to
v1 without changes. A database or backup from a newer app version is refused, never modified.
Shipped migrations are never edited; changes are new migrations.

| Action | Effect |
|---|---|
| Send | insert a row |
| Edit | one transaction: soft-delete the live row, insert a new row with the same `entry_id` and `logged_at` |
| Delete (sheet, full view, multi-select) | soft-delete the entry's live row |
| Restore (trash) | clear `deleted_at`; if the entry has a live row, it is soft-deleted first after an overwrite prompt. One row per entry per restore |
| Delete forever (trash) | `DELETE` the selected trashed rows |
| Auto-clear | on start and resume, delete rows trashed longer than the retention (1 / 7 / 30 days, or custom hours/days/never; default 7 days) |
| Search | `LIKE '%q%'` on live rows; trash search on trashed rows. `%`, `_` and `!` are escaped |

Settings (retention, language, sync) live in Capacitor Preferences, not in the table.

## Sync (WebDAV)

Configured with server URL, username, password and remote folder (created if missing; https only on
Android). The server keeps one file, `<folder>/lifelog.sqlite`: a standard SQLite snapshot of the whole
table (live and trashed rows) at the current schema version, readable by any SQLite tool.

One sync step:

1. `PROPFIND` the remote file's version (ETag, or modification time + size).
2. If it differs from the version this device last wrote or merged, download it and merge:
   rows missing locally are added; a deletion on either side wins; a remote live text that would give
   an entry a second live row (edited on both devices) goes to the trash instead.
3. Upload only if the server lacks something (local changes, data changed by the merge, or no file
   yet): `PUT` to `lifelog.sqlite.uploading`, then `MOVE` over the target so readers never see a
   partial file. Otherwise just adopt the remote version (no ping-pong between devices).

Automatic sync runs on start, on resume and every minute while open, but only once the chosen
interval (5 minutes / 1 hour / 1 day / manual only; default 1 day) has passed since the last sync or
failed attempt. "Sync now" runs immediately. A fresh install restores itself by merging the backup.

Known limit: rows deleted forever on one device come back (into the trash) when merged from a
device that still has them; tombstones would be needed to prevent that.

On Android, requests go through a small native plugin (OkHttp, `WebDavHttpPlugin`), because the
WebView's `fetch` is subject to CORS and Capacitor's HTTP plugin cannot send WebDAV methods.

## Screens

- **Main**: chat-style stream, oldest at top, newest at the bottom above the composer; grouped by day; long text clamped to 3 lines.
  - Tap: half-screen sheet with the full text and three icons (full screen, edit, delete with confirmation).
  - Long-press: multi-select; tap more rows; delete moves them to the trash.
  - "LifeLog ›" opens Settings; the search icon opens Search.
- **Full screen view**: full text, edit and delete.
- **Edit**: explicit Save; leaving with changes (back arrow or Android back) asks Save / Discard / Keep editing. Unchanged text saves nothing.
- **Search**: highlighted matches grouped by day; tap opens the sheet.
- **Settings**: language (system / 中文 / English); trash auto-clear period (presets + custom dialog) and trash entry; WebDAV sync (connection, status, sync now, interval). The main header shows a sync status chip.
- **Trash**: search box; cards grouped by entry (current text shown for reference); rows show original/saved time and days left; select rows or whole entries; restore or delete forever.

## Internationalization

All UI text lives in `src/i18n/<locale>.ts`; `zh-CN` is the source catalog and other locales are type-checked against it.
Dates and durations use `Intl.DateTimeFormat` / `Intl.NumberFormat` with the active locale.

## Not yet

- iOS (needs an iOS counterpart of the native WebDAV HTTP plugin).
- Swipe-down to close the sheet (tap outside or Android back instead).
- Context lines around search matches.
