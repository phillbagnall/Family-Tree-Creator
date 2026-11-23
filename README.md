# Family Tree Creator

A web app for building family trees of characters in books. It works in any modern browser on PC, iPhone and Android, and can be added to the home screen like an app. Trees are drawn as vectors (SVG), so they stay sharp at any zoom.

## Features

- A library of trees (one per book or series): open one to carry on, or start a new one
- Characters with photo, name, title, born/died, other dates and notes
- Parents and children (birth, adopted, step, foster), partners (married, partners, engaged, affair) with status (divorced, separated, widowed), half-siblings, "unknown parents" sibling groups
- Groups/houses with colours, plus custom links such as "rival" or "mentor"
- Automatic layout; drag anyone to adjust (Tree settings → Tidy up layout resets)
- Search, spoiler protection (hide characters who appear after where she's read up to)
- Export as PNG, PDF or SVG
- Works offline and syncs when back online; edits made on two devices are merged

## How saving works

Each tree is saved to a private GitHub repository (the "trees repository"):

```
trees/<treeId>/tree.json         the tree
trees/<treeId>/images/<id>.jpg   photos
```

Each device is connected once with a fine-grained GitHub access key limited to that one repository (Contents: read and write). The key is stored on the device encrypted with a PIN that she types when opening the app.

### Making an access key

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
2. Repository access: **Only select repositories** → the trees repository
3. Permissions → Repository → **Contents: Read and write**
4. No expiry (or remember to replace it when it expires)

## Running it locally

```bash
node dev/serve.mjs 8787
```

For testing without touching GitHub, run the fake GitHub server too (`node dev/mock-github.mjs 8788`), then in the browser console on localhost run `localStorage.setItem('ftc.api', 'http://localhost:8788')` and connect with repo `test/family-trees` and key `test-key`.

## Deploying

It is a static site (no build step). It's served by GitHub Pages. When you change app files, bump `VERSION` in `sw.js` so installed copies pick up the update.
