---
name: Family Tree Creator
phase: Testing
priority: medium
updated: 2026-11-23
blocked: false
links: [https://github.com/phillbagnall/Family-Tree-Creator, https://phillbagnall.github.io/Family-Tree-Creator/]
---
## Summary
A web app (installable on PC, iPhone and Android) for building family trees of characters in books, made for Phill's step-daughter. Trees are vector-drawn so zoom stays sharp, with photos, dates, notes, groups/houses, custom links, search, spoiler protection, PNG/PDF/SVG export, colour themes with gradient backgrounds (per tree, plus a usual look that syncs across devices), photo cropping and offline use. Each tree syncs to the private GitHub repo phillbagnall/family-trees, so the same trees appear on every device. First version is live; next is setting up her devices and trying it with a real book.

## Next steps
- [ ] Create a fine-grained GitHub access key for phillbagnall/family-trees (Contents: read and write)
- [ ] Connect her PC and phone (paste the key, choose a PIN), and add the app to the phone's home screen
- [ ] Try a real book's tree and note what feels awkward

## Key info
- App: https://phillbagnall.github.io/Family-Tree-Creator/ (GitHub Pages from main branch, no build step)
- Data: private repo phillbagnall/family-trees, files at trees/<id>/tree.json and trees/<id>/images/<id>.jpg
- Each device stores the access key encrypted with her PIN (never in the repo)
- PIN: change in Settings; "Forgot PIN?" on the lock screen reconnects with the access key; Settings → "Replace GitHub access key" when the key expires
- Shared settings (the usual look) live in settings.json in the trees repo; light/dark mode and the PIN stay per device
- Local testing: `node dev/serve.mjs 8787` plus `node dev/mock-github.mjs 8788` (see README)
- When changing app files, bump VERSION in sw.js so installed copies update

## Notes

## Visuals
- 2026-11-23: Tree view (light theme) with groups, partners, divorce, spoiler pill
  - Build: first version — initial release
  - ![Tree view](docs/visuals/2026-11-23-tree-view.jpg)
- 2026-11-23: Character editor on a phone
  - Build: first version — initial release
  - ![Phone editor](docs/visuals/2026-11-23-phone-editor.jpg)
- 2026-11-23: Themes — blue default UI, button colour choices, gradient backgrounds from a chosen colour, per-tree look
  - Build: v2 (sw.js VERSION v2) — themes
  - ![Tree theme picker](docs/visuals/2026-11-23-tree-theme-picker.jpg)
  - ![Bold purple background](docs/visuals/2026-11-23-bold-purple-theme.jpg)
- 2026-11-23: Photo cropper — drag, pinch or slider to fit a picture in the circle
  - Build: v3 (sw.js VERSION v3) — photo cropping
  - ![Photo cropper](docs/visuals/2026-11-23-photo-cropper.jpg)

## Decisions
- 2026-11-23: Web app (PWA) rather than native apps, so one codebase covers PC, iPhone and Android with no app-store costs
- 2026-11-23: Sign-in is a repo-limited GitHub key entered once per device, protected by a PIN; no server to run
- 2026-11-23: Per-entity timestamps with merge on conflict, so edits on two devices (even offline) both survive
- 2026-11-23: App code repo is public (free GitHub Pages); tree data stays in a separate private repo
- 2026-11-23: Default UI changed from brown/orange to blue; themes are per tree (synced), the usual look is per device
- 2026-11-23: Usual look syncs via settings.json (newest edit wins); light/dark mode stays per device because it usually follows each device's own setting

## Log
- 2026-11-23: Added to the project dashboard
- 2026-11-23: Built and tested first version (layout, editor, sync with merge, photos, export, spoilers, offline)
- 2026-11-23: Added themes (button colours, gradient backgrounds, per-tree looks) and switched default UI to blue
- 2026-11-23: Added photo cropping (originals kept so photos can be re-cropped) and a replace-access-key option
- 2026-11-23: Usual look now syncs across devices
