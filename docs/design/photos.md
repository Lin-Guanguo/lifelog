# Photos in entries — design

Built in 0.4.0; [docs/spec.md](../spec.md) → Photos describes what shipped. Not built from this note: deleting
copies on the server, an optional "keep original" upload, a size limit for copies, iOS.

## Storage

- **LifeLog keeps a compressed copy, never the original.** Long side 1600 px, quality 0.8, WebP (JPEG where the
  WebView cannot encode WebP, e.g. iOS), ~100–200 KB. Drawing to canvas strips EXIF, including GPS.
- **Key** = SHA-256 (hex) of the **original** file's bytes, so the same photo added twice or on two devices gets one key.
- **Copy** at `media/<key>.webp`: app-private storage on the phone, `media/` next to the database on WebDAV.
  Files never change, so each is uploaded once.
- **Original** stays in the system gallery. LifeLog never moves, edits, uploads or deletes it.
- **No table, no schema change.** The entry text is the only record of which photos it uses.

## Reference in the text

A photo is a line of its own, with a blank line around it:

```
![](media/<key>.webp "taken=2026-11-10T14:02:12+08:00 size=4032x3024 path=DCIM/Camera/IMG_20261110_140212.jpg")
```

- `taken`: capture time (EXIF, with offset when present; else the gallery's date taken). The dependable link to the original.
- `size`: the original's pixel size; lets a single photo be laid out before it loads.
- `path`: where the original was found (folder and file name). A hint: it breaks if the photo is moved or renamed.
  **A missing original is acceptable**: nothing depends on it; the viewer, save and share fall back to the copy.
- All optional, `path` last (album names can contain spaces). A bare `![](media/<key>.webp)` is valid.
- Any other line is plain text, as now: no Markdown rendering, no HTML. Search ignores photo lines.
- **Device-local link** to the original (Android: the picker's persisted URI, or the MediaStore URI of a photo the
  camera button saved; iOS: the PHAsset id) is kept on the phone, keyed by `<key>`, never synced.

## Lifecycle and sync

- Deletion (0.4.1): a copy is needed while any non-purged row references it (trash included, so restore works).
  Finding unreferenced copies scans every row, so it runs at sync (low frequency), on the snapshot being uploaded,
  and deletes local copies only (older than a day); copies on the server are kept.
- Upload copies **before** the database, so a synced database never references a missing file. An orphan sweep on
  WebDAV only removes files older than a few days (another device may be mid-sync).
- Other devices download a copy when an entry is opened, and cache it.
- Settings shows the space used by photo copies. Later, if needed: a size limit that evicts uploaded copies oldest-first
  (keeping a small local-only thumbnail) and re-downloads on view.

## Adding photos

- **Record screen**: input first; under it 📷 camera, 🖼 gallery, 🕑 time, and 排版 (layout) on the right.
- 📷: system camera in capture mode, one photo, saved to the gallery, back with the photo in the tray.
- 🖼: system photo picker, multi-select, no permission.
- **Share → LifeLog** from the gallery (Android intent filter; iOS needs a Share Extension).
- Photos wait in a tray above the input; Send puts the text first and all photos after it, as one group.
- 排版 opens the draft in the full editor (the same component as editing an entry).

## Time

- `logged_at` becomes "when it happened" (default: when written); fixed once saved, as now.
- **Time step**: after 🖼 or Share, if any photo was taken more than ~30 min ago, a screen lists each photo with its
  capture time in large type (tap to use it); 现在 (now) and 🕑 自定义 (custom) fixed at the bottom. Starts on the first
  photo's time. Then back to the record screen, with the chosen time as a chip.
- **Custom time picker** (🕑 and 自定义): day chips (today … 6 days ago, 更早 = system date picker), hour and minute
  wheels, a full readout, never later than now.

## Editor

- Plain native text fields (no formatting at all) and photo thumbnails in one column; 📷 / 🖼 insert at the cursor.
- Drag: long-press a photo (or press its grip). While held the entry shrinks to an overview (2-line paragraph previews,
  small photos, groups tinted and labelled), a dashed box shows where it lands, the edges auto-scroll, and the bottom
  bar becomes a remove zone. Paragraphs left touching rejoin with the break they had.

## Display

- Consecutive photos form a group; the count sets the layout, never the user: 1 = own shape, ≤160 px tall and 70% wide
  (cropped to 3:4 … 2:1); 2 = two squares (80% wide); 3 = a row of three; 4 = 2×2 at the three-across size;
  5+ = rows of three. A line of text between photos starts a new group.
- List: text (3 lines) plus up to four thumbnails, "+N" for the rest.
- **Viewer** shows the synced copy. 相册: open the original in the gallery (when found; not possible on iOS).
  保存: original found → "已在相册", nothing saved; else save the copy to a LifeLog album as JPEG with the capture time
  written back. 分享: the original when found, else the copy.

## To check on a real phone

- What the photo picker reports as file name and folder, and whether it strips GPS or the capture time.
- Whether the camera's capture mode adds a confirm step, and which album "save to gallery" uses.
- Touch dragging in the editor.
- Nutstore plan limits (monthly upload, storage).
