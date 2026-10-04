---
title: Saving & opening
description: Open and save .flux files, keep a self-contained .flux.html you can present offline, and get your work back after a crash.
---

A Fluxion document is **one file**. This guide covers the formats, how to open and save, what autosave protects, and how to
recover work after a crash.

## The formats

- **`.flux`** is the document and everything it needs (images, fonts, a preview) in one compact file. This is the file to keep, send and
  open again in the studio.
- **`.flux.html`** is the same document with a player inside. Double-click it and it presents in any browser, **offline**: it makes no
  network request. Open it in the studio and it comes back as an editable document.
- **`.flux.json`** is the document alone, as readable JSON, for diffs and tests.

Fonts you use travel inside the file, so text looks the same on a computer that does not have them. Images over 2560 px are scaled down
and stored as WebP when that is smaller.

## Open a file

On the studio's home page choose **Open a file…**, or drag a file onto the page. A link of the form `/?src=https://example.com/deck.flux`
opens the file at that address, and pasting a `.flux` outside a text field opens it too. Where the browser lets the installed app handle
`.flux` files, double-clicking one in your file manager opens it.

Recent files are listed on the home page with a thumbnail. A file that is damaged is repaired where possible, and what was changed is shown.
A file made by a newer version of Fluxion opens **read-only**: you can look at it, and **Save** asks for a copy instead of writing over it.

## Save

**Save** (Ctrl/Cmd+S) writes over the file you opened. Browsers with the File System Access API (Chromium) replace the file only once the
new one is complete, so a failed save never leaves a half-written file. Other browsers download a new copy each time. **Save a copy**
always asks for a new file.

## Autosave and recovering

While you edit, every change is kept on your device within a few seconds; the toolbar says when it is. A **version** of the file is
also kept on each save and every ten minutes of editing, the last twenty.

If the tab is closed or the browser crashes before you save, the next time the studio starts it offers **Recover unsaved changes** with a
preview (the title, when it was kept, how much is in it). Choose **Recover** to continue, **Not now** to be asked again later, or
**Discard** to forget it for good.

Opening the same document in a second tab opens it **read-only** and says so, so two tabs never overwrite each other.
