// Keyboard shortcuts that pick the drawing tools: R rectangle, E ellipse, P polygon, S star, T text.
// Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node
// (tests/toolShortcuts.test.ts). The key listener itself is in components/ToolsPanel.tsx.

import type { DrawTool } from '@/lib/inlineEdit';

/** The key for each drawing tool, in lower case. */
export const TOOL_SHORTCUTS: Readonly<Record<DrawTool, string>> = {
  rectangle: 'r',
  ellipse: 'e',
  polygon: 'p',
  star: 's',
  text: 't',
};

/** The key shown in a tool's tooltip, in capitals. */
export function shortcutHint(tool: DrawTool): string {
  return TOOL_SHORTCUTS[tool].toUpperCase();
}

/** The part of a keyboard event this file needs. Any KeyboardEvent fits. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

/** Where the key was pressed, or null when it was not on a page element. */
export interface KeyTarget {
  tag: string;
  contentEditable: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * The drawing tool a key press picks, or null when it should be left alone. Never fires while
 * typing in a box (so letters go into the box), while a dialog is open, with Ctrl, Alt, Shift or
 * the Windows/Command key held (those are other shortcuts), on auto-repeat, or while an input
 * method is composing text.
 */
export function toolForKey(e: KeyLike, target: KeyTarget | null, modalOpen: boolean): DrawTool | null {
  if (modalOpen) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return null;
  if (target && (TYPING_TAGS.has(target.tag.toUpperCase()) || target.contentEditable)) return null;
  const key = e.key.toLowerCase();
  for (const tool of Object.keys(TOOL_SHORTCUTS) as DrawTool[]) {
    if (TOOL_SHORTCUTS[tool] === key) return tool;
  }
  return null;
}
