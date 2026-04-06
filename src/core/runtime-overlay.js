import { FRAME_OVERLAY_ID } from '../config.js';

export const RUNTIME_OVERLAY_SELECTOR = `[data-editor-overlay], [data-editor-runtime="1"], #${FRAME_OVERLAY_ID}`;

export function markRuntimeOverlay(element, kind = 'runtime') {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return element;
  element.dataset.editorRuntime = '1';
  element.dataset.editorOverlay = String(kind || 'runtime');
  return element;
}

export function isRuntimeOverlayElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.id === FRAME_OVERLAY_ID) return true;
  if (element.hasAttribute('data-editor-overlay')) return true;
  return element.dataset.editorRuntime === '1';
}

export function removeRuntimeOverlayNodes(root) {
  if (!root?.querySelectorAll) return 0;
  const nodes = Array.from(root.querySelectorAll(RUNTIME_OVERLAY_SELECTOR));
  for (const node of nodes) {
    if (!node?.isConnected) continue;
    node.remove();
  }
  return nodes.length;
}
