// The editor's command and tool titles by id (ADR-0023, NFR-I18N-001). `@fluxion/core` and the tool definitions keep an English title, the default; the
// editor shows the message `command.<id>` or `tool.<id>` when it has one, found by the extraction because each is a `msg` with an explicit id. A command
// or tool without an entry is shown with its own title (a plugin's, for one); the T0 test names every built-in one, so a new built-in without a message
// fails it.

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { i18n } from './i18n.js';

/** The messages of the editor commands, by command id. */
export const COMMAND_MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  'history.undo': msg({ id: 'command.history.undo', message: 'Undo' }),
  'history.redo': msg({ id: 'command.history.redo', message: 'Redo' }),
  'camera.zoomIn': msg({ id: 'command.camera.zoomIn', message: 'Zoom in' }),
  'camera.zoomOut': msg({ id: 'command.camera.zoomOut', message: 'Zoom out' }),
  'camera.zoom100': msg({ id: 'command.camera.zoom100', message: 'Zoom to 100 %' }),
  'camera.fitScreen': msg({ id: 'command.camera.fitScreen', message: 'Zoom to fit the screen' }),
  'camera.fitSelection': msg({ id: 'command.camera.fitSelection', message: 'Zoom to the selection' }),
  'tool.escape': msg({ id: 'command.tool.escape', message: 'Cancel' }),
  'selection.group': msg({ id: 'command.selection.group', message: 'Group' }),
  'selection.ungroup': msg({ id: 'command.selection.ungroup', message: 'Ungroup' }),
  'selection.align.left': msg({ id: 'command.selection.align.left', message: 'Align left' }),
  'selection.align.center': msg({ id: 'command.selection.align.center', message: 'Align centre' }),
  'selection.align.right': msg({ id: 'command.selection.align.right', message: 'Align right' }),
  'selection.align.top': msg({ id: 'command.selection.align.top', message: 'Align top' }),
  'selection.align.middle': msg({ id: 'command.selection.align.middle', message: 'Align middle' }),
  'selection.align.bottom': msg({ id: 'command.selection.align.bottom', message: 'Align bottom' }),
  'selection.distribute.horizontal': msg({ id: 'command.selection.distribute.horizontal', message: 'Distribute horizontally' }),
  'selection.distribute.vertical': msg({ id: 'command.selection.distribute.vertical', message: 'Distribute vertically' }),
  'selection.order.front': msg({ id: 'command.selection.order.front', message: 'Bring to front' }),
  'selection.order.forward': msg({ id: 'command.selection.order.forward', message: 'Bring forward' }),
  'selection.order.backward': msg({ id: 'command.selection.order.backward', message: 'Send backward' }),
  'selection.order.back': msg({ id: 'command.selection.order.back', message: 'Send to back' }),
  'tool.use': msg({ id: 'command.tool.use', message: 'Use a tool' }),
  'selection.nudge': msg({ id: 'command.selection.nudge', message: 'Nudge the selection' }),
  'selection.all': msg({ id: 'command.selection.all', message: 'Select all' }),
  'selection.sameType': msg({ id: 'command.selection.sameType', message: 'Select same type' }),
  'selection.sameStyle': msg({ id: 'command.selection.sameStyle', message: 'Select same style' }),
  'selection.delete': msg({ id: 'command.selection.delete', message: 'Delete the selection' }),
  'clipboard.copy': msg({ id: 'command.clipboard.copy', message: 'Copy' }),
  'clipboard.cut': msg({ id: 'command.clipboard.cut', message: 'Cut' }),
  'clipboard.paste': msg({ id: 'command.clipboard.paste', message: 'Paste' }),
  'clipboard.duplicate': msg({ id: 'command.clipboard.duplicate', message: 'Duplicate' }),
  'text.edit': msg({ id: 'command.text.edit', message: 'Edit the text' }),
  'help.keys': msg({ id: 'command.help.keys', message: 'Keyboard shortcuts' }),
  'palette.open': msg({ id: 'command.palette.open', message: 'Command palette' }),
  'mode.present': msg({ id: 'command.mode.present', message: 'Present from the first visible screen' }),
  'mode.toggle': msg({ id: 'command.mode.toggle', message: 'Present the shown screen / stop presenting' }),
};

/** The messages of the built-in tools, by tool id. */
export const TOOL_MESSAGES: Readonly<Record<string, MessageDescriptor>> = {
  select: msg({ id: 'tool.select', message: 'Select' }),
  hand: msg({ id: 'tool.hand', message: 'Hand' }),
  shape: msg({ id: 'tool.shape', message: 'Shape' }),
  text: msg({ id: 'tool.text', message: 'Text' }),
  frame: msg({ id: 'tool.frame', message: 'Frame' }),
  image: msg({ id: 'tool.image', message: 'Image' }),
  connector: msg({ id: 'tool.connector', message: 'Connector' }),
  pen: msg({ id: 'tool.pen', message: 'Pen' }),
  freehand: msg({ id: 'tool.freehand', message: 'Freehand' }),
  laser: msg({ id: 'tool.laser', message: 'Laser' }),
};

/** The title to show for a command: its message if it has one, else its own title. */
export function commandTitle(command: { readonly id: string; readonly title: string }): string {
  const message = COMMAND_MESSAGES[command.id];
  return message === undefined ? command.title : i18n._(message);
}

/** The title to show for a tool: its message if it has one, else its own title. */
export function toolTitle(tool: { readonly id: string; readonly title: string }): string {
  const message = TOOL_MESSAGES[tool.id];
  return message === undefined ? tool.title : i18n._(message);
}
