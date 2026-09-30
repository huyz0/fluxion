---
title: Canvas basics
description: Move around the canvas, select, move, resize and rotate, create elements, and present in place.
---

The editor shows the document's screen on a canvas, with the toolbar above it, the screens,
library and layers panel on the left and the inspector on the right. Panels resize with their
splitters and hide from the toolbar; **Focus mode** hides them all. On a phone the side panels
start collapsed.

## Moving around

- **Pan**: scroll the wheel (with Shift, sideways), drag with the middle button, or hold Space and
  drag. On a touch screen, drag with two fingers.
- **Zoom**: Ctrl (⌘ on a Mac) with the wheel, or pinch a trackpad or touch screen; the point under
  the pointer stays put. Ctrl + `+` and Ctrl + `-` zoom about the centre.
- **Shift + 0** (or Ctrl + 0) goes to 100 %, **Shift + 1** fits the screen, **Shift + 2** fits the
  selection. The toolbar's zoom controls do the same. Zoom stays between 5 % and 3200 %.

## Selecting

- Click an element to select it (a click on a group's member selects the group); **Shift**-click adds
  or removes an element. Click on nothing to clear the selection.
- Drag on empty canvas for a **marquee**: dragged to the right it selects what it contains, dragged
  to the left what it touches.
- Ctrl + A selects everything on the screen.

## Moving, resizing, rotating

- Drag a selected element to move it; the arrow keys nudge it 1 px, with **Shift** 10 px.
- **Alt**-drag moves a copy and leaves the original.
- Drag one of the eight handles to resize: **Shift** keeps the proportions, **Alt** resizes about the
  centre. Drag the round handle above the selection to rotate; **Shift** snaps to 15° steps.
- **Esc** during a drag puts everything back. Ctrl + Z undoes and Ctrl + Shift + Z (or Ctrl + Y)
  redoes; a whole drag is one step.

## Tools

The toolbar lists the tools; each has a key. **V** select, **H** hand (drag to pan), **R** shape,
**T** text, **F** frame, **I** image, **C** connector, **P** pen, **D** freehand. A click with a
creation tool places its default size, a drag its box (with **Shift**, square); the new element is
selected and the select tool is back.

- The **connector** joins the element you press on to the one you release on; with **Alt** it is
  curved. An end released on nothing stays where it is.
- The **pen** places a vertex per click; **Enter**, or a click on the last vertex, ends the path.
- The **image** tool asks which image to place: the document's images, or an image placeholder.

**Esc** returns any tool to select.

## Touch

Tap to select, drag to move, drag a handle to resize (a finger reaches a handle from further away
than a mouse). Two fingers pan and pinch to zoom. Hold a finger still to ask for the context menu.

## Presenting

**F5** (or the toolbar's **Present** button) presents the screen in place, filling the window with
no editing chrome; **F5** or **Esc** returns to editing. While presenting nothing can change the
document, and the pointer is a laser whose trail fades behind it.
