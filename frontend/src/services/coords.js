/**
 * Coordinate Transform Utilities for Visual Redaction (Frontend ESM)
 * 
 * Coordinate Contract:
 * - page-normalized: { x, y, width, height } ∈ [0,1], top-left origin
 * - CSS display: { left, top, width, height } in CSS pixels
 * - All boxes stored in page-normalized coordinates
 */

// ─── Normalized ↔ CSS Display ────────────────────────────────

export function normalizedToCSS(box, displayWidth, displayHeight) {
  return {
    left: box.x * displayWidth,
    top: box.y * displayHeight,
    width: box.width * displayWidth,
    height: box.height * displayHeight,
  };
}

export function cssToNormalized(cssRect, displayWidth, displayHeight) {
  return {
    x: cssRect.left / displayWidth,
    y: cssRect.top / displayHeight,
    width: cssRect.width / displayWidth,
    height: cssRect.height / displayHeight,
  };
}

// ─── Display Scaling ─────────────────────────────────────────

export function computeDisplaySize(pageInfo, containerWidth, maxHeight = 900) {
  const aspectRatio = pageInfo.imageWidth / pageInfo.imageHeight;
  let displayWidth = containerWidth;
  let displayHeight = containerWidth / aspectRatio;

  if (displayHeight > maxHeight) {
    displayHeight = maxHeight;
    displayWidth = maxHeight * aspectRatio;
  }

  const scale = displayWidth / pageInfo.imageWidth;
  return { displayWidth, displayHeight, scale };
}

// ─── Validation ──────────────────────────────────────────────

export function validateNormalizedBox(box) {
  const errors = [];
  if (box.x < 0 || box.x > 1) errors.push(`x=${box.x} out of [0,1]`);
  if (box.y < 0 || box.y > 1) errors.push(`y=${box.y} out of [0,1]`);
  if (box.width < 0 || box.width > 1) errors.push(`width=${box.width} out of [0,1]`);
  if (box.height < 0 || box.height > 1) errors.push(`height=${box.height} out of [0,1]`);
  if (box.x + box.width > 1.001) errors.push(`x+width exceeds 1`);
  if (box.y + box.height > 1.001) errors.push(`y+height exceeds 1`);
  return { valid: errors.length === 0, errors };
}

export function createNormalizedBox(partial) {
  return {
    id: partial.id || `box_${Date.now()}`,
    page: partial.page || 1,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 0,
    height: partial.height ?? 0,
    coordinateSpace: 'page-normalized',
    pageWidth: partial.pageWidth || 595,
    pageHeight: partial.pageHeight || 842,
    source: partial.source || 'manual',
    entityType: partial.entityType || null,
    entityIds: partial.entityIds || [],
    text: partial.text || '',
    original: partial.original || partial.text || '',
    confidence: partial.confidence ?? null,
    locked: partial.locked || false,
  };
}
