# Changelog

Each release's notes come from its section here (the release workflow requires one) and are shown in the app's
update dialog.

## 0.4.7

- The main list draws a window of about 200 entries and extends it while scrolling, so long logs stay smooth.
- ⌖ in an entry's sheet (from the list, search or the photo viewer) shows the entry in the timeline: centred and
  marked until another is located or it leaves the drawn range. The sheet's icons: full screen, ⌖, edit, delete.
- The photo viewer's entry line opens that entry's sheet over the viewer.
- More than about two screens from the newest entries, a button at the bottom left jumps back to them; sending an
  entry goes back to them too.
- Fix: a strong swipe in the photo viewer skipped several photos; it now stops at the next one.

## 0.4.6

- Photo viewer: pinch or double-tap to zoom (up to 5×); zooming in loads the full-resolution original. While zoomed,
  dragging moves within the photo.
- ⓘ in the viewer's top corner lists the photo's details: capture time, camera, lens, settings, location, file.
- Tapping a photo in the list opens it right away; swiping goes on through the photos of other entries. Each photo
  shows its entry's first line; tapping it goes to that entry in the list.
- Swipe down to close the photo viewer.
- Settings: the "remove sync settings" button is gone (easy to tap by mistake, not needed).

## 0.4.5

- 🖼 is back to the system photo picker (the document picker was awkward to use). On some phones (HyperOS) it hands
  over a copy with part of the EXIF removed; LifeLog keeps what it is handed.
- Photo viewer: four actions along the bottom: 原图 (the full-resolution original in place of the 1600 px display),
  打开, 保存, 分享.

## 0.4.4

- LifeLog keeps each photo's **original**, byte for byte, instead of a compressed copy: inside the app only (the
  system gallery never shows it, so nothing is duplicated) and synced to `media/` on WebDAV. Photos already in your
  log keep their copies and work as before.
- 🖼 opens the system document picker, which hands over the photos themselves with their EXIF (some phones' photo
  pickers hand over stripped copies). Camera photos are kept the same way and no longer added to the gallery.
- Photo lines no longer record where a photo came from (no path); only facts about it.
- Viewer: 打开 opens the photo with another app, 分享 shares the original, 保存 exports it to the gallery's LifeLog
  album once. The caption shows the format and size.

## 0.4.3

- Photo viewer: saving a photo that is already in the gallery's LifeLog folder (saved before, or the camera original)
  shows 已在相册 instead of saving another copy. Camera originals there are found again even when the link kept on
  the phone is gone (e.g. app data cleared).
- After saving, 打开 opens the saved copy and 分享 shares it (until then only an original could be opened).
- Photo lines keep more about the original: camera and lens, focal length, aperture, shutter, ISO, exposure
  compensation, flash, white balance, location, altitude, direction, speed, format and size. Camera photos keep
  their location (it was read from the gallery copy, where Android removes it).
- Saving puts the copy itself in the gallery (WebP, no re-encoding, dated by the capture time), named by the whole
  key (`LifeLog_<key>.webp`); copies saved earlier as JPEG are still found.

## 0.4.2

- Photo viewer: the button that opens the original is now called 打开 (open with another app), which is what it does.

## 0.4.1

- Camera photos were lost on some phones: the camera app saved nothing and the photo vanished. The camera now
  writes into LifeLog, which adds the photo to the gallery (Pictures/LifeLog) itself; if a camera app still returns
  nothing, a message says so.
- Entries from the last hour show seconds, under the time.
- Each sync deletes photo copies on the phone that no entry uses any more (after a day's grace); copies on the
  server stay.

## 0.4.0

- Photos in entries: take one with the camera, choose several from the gallery, or share them to LifeLog from
  another app. LifeLog keeps a compressed copy (1600 px, no location data); the original stays in the gallery.
- 排版 (layout): place photos between paragraphs; long-press a photo to move it or drag it away to remove it.
  Photos in a row are laid out automatically.
- Entry time: older photos offer their capture time for the entry; the clock under the input sets any earlier time.
- Photo viewer: open the original in the gallery, save the copy, or share.
- Sync uploads photo copies (to `media/` next to the database); other devices download them when shown.
- Search ignores photo details. Photo copies are not deleted yet when entries are permanently deleted.

## 0.3.0

- Sync is now safe with several devices writing: rows only move forward (live → trash → permanently deleted),
  so every copy converges in any sync order.
- Permanent deletion (and auto-clear) erases the text and keeps a small record so other devices delete it too;
  it can no longer come back from another device.
- Restoring from the trash adds the text back as a new version.
- Row ids are compact, time-ordered integers instead of text UUIDs; existing data converts automatically on
  first launch.
- Database schema v2: update every device to 0.3.0; older versions stop syncing with an error instead of
  merging data they cannot read.

## 0.2.6

- Check for updates (Settings → About): shows the current version and the latest release on GitHub, with
  download (in the browser), view the release page, or later. Nothing is checked automatically.
- The details sheet expands to full screen in place, keeping its icons; drag the handle to expand or close.
- Smoother transitions for the sheet and screens.
- Signed with the new release key. Coming from 0.2.4 or earlier: sync, uninstall, install, then set up sync again.

## 0.2.5

- First release built by GitHub Actions, signed with the release key.
