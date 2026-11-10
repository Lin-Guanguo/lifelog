# LifeLog spec

A local-first Android app for logging short, timestamped lines (workouts, thoughts, anything).
Entries are stored raw; organizing them is left to CyberMnema later.

## Data

One SQLite table, append-only: rows are added, never changed except moving forward through
live → trashed → purged (permanently deleted). That one-way rule is what makes sync merging safe.

```sql
CREATE TABLE records (
  id          INTEGER PRIMARY KEY, -- one row per saved text; see below
  entry_id    INTEGER NOT NULL,   -- shared by an entry and all its edits: the id of its first row
  logged_at   INTEGER NOT NULL,   -- when it happened (ms): when written, or a chosen earlier time; copied on edit
  content     TEXT NOT NULL,
  written_at  INTEGER NOT NULL,   -- when this row was saved
  deleted_at  INTEGER,            -- NULL = live; set = in the trash
  purged_at   INTEGER             -- set = permanently deleted: content '' (tombstone kept for sync), v2
);
-- at most one live row per entry
CREATE UNIQUE INDEX records_one_live ON records(entry_id) WHERE deleted_at IS NULL;
```

Ids are created offline on any device: `(ms since 2026-01-01) × 4096 + 12 random bits`. They are ordered by
creation time, exact in JavaScript (below 2⁵³, until about 2095), and strictly increasing per device; two
devices collide only if they create a row in the same millisecond with the same 12 bits.

### Schema versions

The schema version is SQLite's standard `PRAGMA user_version`. `src/data/schema.ts` holds an ordered
list of migrations (v1: the table with text UUIDs; v2: integer ids and `purged_at`); on open, each missing step runs in its own transaction
together with its version bump. Databases from v0.1.x (no version, table already present) upgrade to
v1 without changes. v2 rebuilds the table: text ids convert deterministically (time from the row, low bits
from a hash of the old id; an entry's first row takes the entry's number), so the phone and an old backup
convert identically and merge without duplicates; an interrupted conversion starts over on next launch.
New installs run both steps on an empty table. A database or backup from a newer app version is refused,
never modified.
Shipped migrations are never edited; changes are new migrations.

| Action | Effect |
|---|---|
| Send | insert a row |
| Edit | one transaction: soft-delete the live row, insert a new row with the same `entry_id` and `logged_at` |
| Delete (sheet, full view, multi-select) | soft-delete the entry's live row |
| Restore (trash) | insert a new live row with the same text, `entry_id` and `logged_at`; purge the restored trash row; if the entry has a live row, it is soft-deleted first after an overwrite prompt. One row per entry per restore |
| Delete forever (trash) | purge the selected trashed rows: `content = ''`, `purged_at` set; the row stays as a ~60-byte tombstone |
| Auto-clear | on start and resume, purge rows trashed longer than the retention (1 / 7 / 30 days, or custom hours/days/never; default 7 days) |
| Search | `LIKE '%q%'` on live rows; trash search on trashed (not purged) rows. `%`, `_` and `!` are escaped |

Purged text is gone from the database (`PRAGMA secure_delete` overwrites the freed bytes) and from every later
upload. Older uploads may survive in the WebDAV server's own file history (Nutstore 历史版本) and in copies
pulled with `scripts/lifelog.mjs` until the next pull. Tombstones are kept forever: dropping them would let a
device that still has the text bring it back; they are tiny.

Settings (retention, language, sync) live in Capacitor Preferences, not in the table.

## Photos

An entry's text may contain photo lines; nothing else about photos is stored (no table, no schema change):

```
![](media/<key>.webp "taken=2026-11-10T14:02:12+08:00 size=4032x3024 path=DCIM/Camera/IMG_20261110_140212.jpg")
```

- `<key>`: the first 32 hex digits of the SHA-256 of the **original** file, so the same photo gets the same key on
  every device. The line points at LifeLog's **compressed copy** (long side 1600 px, WebP quality 0.8; JPEG where the
  WebView cannot encode WebP), which has no EXIF (no location). Copies never change once written.
- Title fields, all optional hints about the original: `taken` (capture time from EXIF, with offset; else the
  gallery's date taken), `size` (pixels), `path` (folder/name where it was found; may be gone, which is fine).
  `"` and `\` are escaped; `path` comes last.
- A photo is a line of its own with a blank line around it; any other line is plain text (no Markdown rendering).
  Lists and search use the text without photo lines.
- The original stays in the system gallery; LifeLog never moves, uploads or deletes it. Where it was found is
  remembered on this device only (Android content URI, never synced) for "open in gallery" and sharing it.
- Copies live in the app's files (`media/`; IndexedDB in the browser build) and on the server in `<folder>/media/`.
  At each sync (automatic or manual), after merging, copies on this device that no row references any more
  (permanently deleted, or removed in an edit and purged) are deleted, unless written in the last 24 hours (a photo
  in the tray or an unsaved edit is not referenced yet; adding a photo again refreshes its date). The check uses the
  same snapshot as the upload. Copies on the server are never deleted.

Adding photos (Android, no permissions): the system photo picker (several at once), the system camera (one photo,
saved to Pictures/LifeLog), or Share → LifeLog from another app. A quick send puts the text first and the photos after
it; 排版 (layout) opens the draft in the editor to place photos between paragraphs. Photos in a row form one group
laid out by count: 1 keeps its shape (≤160 px tall, ≤70 % wide, cropped to 3:4 … 2:1), 2 side by side, 3 in a row,
4 as 2×2, 5+ in rows of three.

Entry time: when photos from the picker or Share include one taken over 30 minutes ago, a step offers each photo's
capture time, now, or a custom time (also from the clock under the input: last week's days, or any earlier date,
and hour/minute; never later than now). The entry's `logged_at` is that time.

## Sync (WebDAV)

Configured with server URL, username, password and remote folder (created if missing; https only on
Android). The server keeps one file, `<folder>/lifelog.sqlite`: a standard SQLite snapshot of the whole
table (live and trashed rows) at the current schema version, readable by any SQLite tool.

One sync step:

1. `PROPFIND` the remote file's version (ETag, or modification time + size).
2. If it differs from the version this device last wrote or merged, download it and merge. Per row id the
   copy further along wins (live < trashed < purged; when both are trashed or purged, the earlier time);
   a purged row erases the text everywhere; rows missing locally are added. If an entry ends up with two
   live texts (edited on two devices), the later-written stays live and the other is trashed as of that
   time. Every copy computes the same result, so devices converge in any sync order (tested with random
   two-device runs).
3. Upload only if the server lacks something (local changes, data changed by the merge, or no file
   yet) with a plain `PUT` over `lifelog.sqlite`. Otherwise just adopt the remote version (no ping-pong
   between devices). Uploading to a temporary name and `MOVE`-ing it over the target is not portable:
   Nutstore (坚果云) answers 409 to a MOVE onto an existing file even with `Overwrite: T`. A leftover
   `lifelog.sqlite.uploading` from v0.2.0–0.2.2 is deleted after the next upload. Before the database, photo
   copies this device has that rows reference and `<folder>/media/` lacks (one `PROPFIND`, `Depth: 1`) are
   uploaded, so the server never references a missing photo. Other devices download a copy when they first show it.

Automatic sync runs on start, on resume and every minute while open, but only once the chosen
interval (5 minutes / 1 hour / 1 day, or custom minutes/hours/days or manual only; default 1 day) has passed since the last sync or
failed attempt. "Sync now" runs immediately. A fresh install restores itself by merging the backup.

A newer schema in the remote file stops sync with an error on older app versions (they never merge what they
cannot read), so update every device after a schema change.

On Android, requests go through a small native plugin (OkHttp, `WebDavHttpPlugin`), because the
WebView's `fetch` is subject to CORS and Capacitor's HTTP plugin cannot send WebDAV methods.

## Screens

- **Main**: chat-style stream, oldest at top, newest at the bottom above the composer; grouped by day; long text clamped to 3 lines.
  Entries from the last hour show seconds on a small line under HH:MM, so the time column keeps its width.
  - Tap: half-screen sheet with the full text and three icons stacked bottom-right (full screen, edit, delete with
    confirmation). Full screen expands the same sheet in place, keeping the icons; the first icon or back collapses it.
    Dragging the handle up expands, down collapses or closes.
  - Long-press: multi-select; tap more rows; delete moves them to the trash.
  - "LifeLog ›" opens Settings; the search icon opens Search.
  - Composer: the input, then camera / gallery / entry time on the left and 排版 (layout) on the right; photos wait in a
    tray above the input, a chosen time shows as a chip.
- **Edit** (and **New entry**, from 排版): text fields and photo thumbnails, no formatting; camera / gallery insert at the
  cursor; long-press a photo to move it (the entry shrinks to an overview, the bottom bar becomes a remove zone).
  Explicit Save; leaving with changes (back arrow or Android back) asks Save / Discard / Keep editing. Unchanged text saves nothing.
- **Photo viewer** (tap a photo in the sheet): the synced copy, full screen, swipe between photos; open the original in
  the gallery (when still on this device), save the copy to the gallery (JPEG with the capture time; "already in
  gallery" when the original is there), share (the original, else the copy).
- **Search**: highlighted matches grouped by day; tap opens the sheet.
- **Settings**: language (system / 中文 / English); trash auto-clear period (presets + custom dialog) and trash entry; photo copies (count, size); WebDAV sync (connection, status, sync now, interval); about (check for updates, author pop-up). The main header shows a sync status chip.
- **Trash**: search box; cards grouped by entry (current text shown for reference); rows show original/saved time and days left; select rows or whole entries; restore or delete forever.

## Updates and releases

- Version: `package.json` is the single source (web bundle, Android versionName; versionCode = x·10000 + y·100 + z).
- Releases are GitHub Releases `vX.Y.Z` with one asset `lifelog-X.Y.Z.apk`, built and signed by the manually started
  release workflow; notes come from that version's section in `CHANGELOG.md`.
- Check: only when the user taps Settings → About → "检查更新" (nothing automatic). A dialog shows the current version
  and asks GitHub's `releases/latest` API (no login): up to date, failed, or a newer version with its notes and
  "下载更新" (the APK URL in the system browser; Android shows its install prompt from the download), "查看更新" (the
  release page in the browser), "以后再说" (close). No in-app download, no install permission. Updates install over the
  old app only with the same signing key.

## Internationalization

All UI text lives in `src/i18n/<locale>.ts`; `zh-CN` is the source catalog and other locales are type-checked against it.
Dates and durations use `Intl.DateTimeFormat` / `Intl.NumberFormat` with the active locale.

## Not yet

- iOS (needs iOS counterparts of the native WebDAV HTTP and Photos plugins; copies would be JPEG).
- Deleting photo copies on the server that no row references any more.
- Pinch to zoom in the photo viewer.
- Context lines around search matches.
