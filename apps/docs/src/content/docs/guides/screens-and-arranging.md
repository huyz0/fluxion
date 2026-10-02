---
title: Screens & arranging
description: Group, align, distribute and order shapes; snap while dragging; manage screens, sections and speaker notes; and fill a screen from the shape library.
---

This guide covers how to structure a deck: the shapes on a screen, and the screens of a document. Open the example
`examples/arrange-demo.flux.json` (in the studio, `example-arrange-demo`) to follow along: it has a group, two sections,
speaker notes and a hidden screen.

## Group

Select shapes and press `Ctrl+G` to group them; `Ctrl+Shift+G` ungroups. A group moves, resizes and rotates as one.
Double-click a group to **enter** it and edit one member; a click now picks within it, and `Esc` leaves it again.
Connectors stay attached to members whether or not they are grouped.

## Align, distribute and order

Right-click a selection and use the **Arrange** lines (they are also in the command palette, `Ctrl+K`):

- **Align** left, centre, right, top, middle or bottom. Several shapes align to their own bounds; one shape aligns to the
  screen. A turned shape is aligned by the box it covers.
- **Distribute** horizontally or vertically: with three or more shapes selected, the gaps between them become equal.
- **Order**: `Ctrl+]` brings the selection forward, `Ctrl+[` sends it backward, `Ctrl+Shift+]` and `Ctrl+Shift+[` bring it
  to the front and send it to the back.

Each of these is one undo step.

## Snapping

While you drag, the selection snaps to the edges and centres of other shapes, to the gaps other shapes keep, and to the
edges and centre of the screen, within 8 screen pixels. Guides show what it lines up with, and an equal gap shows its
size. Hold `Alt` (after pressing) or `Ctrl`/`Cmd` while dragging to skip snapping, or turn **Snapping** off in the
toolbar; the choice is remembered.

## Screens

The **Screens** tab lists the screens with thumbnails. Click to show one, drag to reorder, double-click a name to rename
it, and use **Hide** to leave a screen out of presentation. Right-click a screen for its menu: rename, duplicate, delete,
move it to a section, and its **format**: 16:9, 4:3, 16:10, a 9:16 phone, A4, an infinite canvas, or a custom size such
as `1280x720`.

`F5` presents from the first visible screen; `Shift+F5` presents the screen you are on.

## Sections

**New section** adds a named group of screens. Move a screen into a section from its menu, or drag it onto the section's
header. Click a header to fold the section; right-click it to rename, move or delete it (its screens stay, in no
section).

## Speaker notes

The **Notes** tab holds the speaker notes of the screen you are on, in the same rich-text editor as shape labels. Notes
are saved when you leave the field and are part of the document.

## The shape library

The **Library** tab lists the shapes of each pack by category, each with a thumbnail, and a search box: type a word like
`database` to find the cylinder. **Click** a shape to put it in the middle of the view, or **drag** it onto the canvas to
drop it where you want it. The shape you picked last is the one the shape tool (`R`) draws next.
