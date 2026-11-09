# Changelog

Each release's notes come from its section here (the release workflow requires one) and are shown in the app's
update dialog.

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
