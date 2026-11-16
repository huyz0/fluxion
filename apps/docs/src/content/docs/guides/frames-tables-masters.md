---
title: Frames, tables & masters
description: Clip content in frames, order elements in the layers panel, combine and edit paths, build tables, share a layout with master screens, and connect and find shapes quickly.
---

This guide covers the tools for structured diagrams. Open `examples/masters-tables.flux.json` (in the studio,
`example-masters-tables`) to follow along: its screen uses a master with a filled title placeholder, holds a table with a merged
cell, and has a clipping frame with a child that overflows it. The same deck written in FluxScript is
`examples/dsl/masters-tables.flux.yaml` (see [Writing FluxScript](../writing-fluxscript/)).

Every action here is one step in the undo history.

## Frames

Press **F** and drag to draw a frame. A frame holds the elements you drop into it: when a drag ends with an element's centre inside
a frame, the element joins it; dragged out, it leaves. Moving, rotating or flipping a frame takes its contents along. Resizing a
frame changes only its box: its contents stay where they are, and whatever falls outside is hidden. You cannot click a hidden part.
A frame clips unless you turn off **Clip contents** in the inspector.

## Layers

The **Layers** tab lists the shown screen's elements, front first, with members indented under their group or frame. Click a row to
select it (Shift adds or removes), drag a row among its siblings to change the stacking order, or press **Alt+Up** / **Alt+Down** to
step it. Each row's **Hide** button hides the element and its **Lock** keeps it in place and stops the canvas from picking it (the Layers tab still
can).

## Locks and flips

The Layers lock is the everyday one. A file (written by hand, the CLI or an AI client) can also set finer locks on an element:
position, size, rotation, aspect ratio and selection, and the canvas respects each one. **Flip horizontally** and **Flip vertically**
in the palette mirror the selection; a flipped frame mirrors its contents with it.

## Combining and editing paths

Select two or more shapes and choose **Union**, **Subtract**, **Intersect** or **Exclude** from the command palette (`Ctrl+K`).
Subtract removes the upper shapes from the bottom one. The result is one path shape. Choose **Edit path** to move its vertices and
bezier handles.

## Tables

Choose **Insert table** from the palette. With the table selected, click a cell to pick it (Shift+click extends the range), then use
**Insert row above/below**, **Insert column left/right**, **Delete row**, **Delete column**, **Merge cells** and **Split cell**.
**Tab** and **Shift+Tab** move to the next and previous cell; drag a border between two rows or columns to resize them.

## Master screens

A master screen holds a background and elements that other screens share. In the screen navigator's menu, **Make master** turns a
screen into a master (masters are listed in their own section and never presented); on another screen, **Use master** picks one, and
**No master** drops it. On a master, select an element and choose **Make placeholder**: on each screen using the master it shows as a
dashed hint, and a double-click fills it with your own copy. **Edit master** opens the shown screen's master; editing it updates every
screen that uses it, and **Close master** goes back. The Problems tab says why a master does not apply, for example when the sizes
differ.

## Quick-connect and find

Hover a shape to see a **+** beside each side. Drag from one onto another shape to join them, or drop on empty canvas and pick a shape
to add it already joined. **Ctrl+F** (Cmd+F on macOS) opens the find bar: it highlights every element whose text, name or label
matches, and **Enter** / **Shift+Enter** jump to the next or previous match, across screens.
