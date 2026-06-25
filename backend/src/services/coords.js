/**
 * Coordinate Transform Utilities for Visual Redaction
 * 
 * Coordinate Contract (from docs/12 P0):
 * ─────────────────────────────────────────────────────────────
 * | Space          | Unit          | Origin    | Used by        |
 * |----------------|---------------|-----------|----------------|
 * | page           | PDF point (pt)| top-left  | fitz, PDF spec |
 * | render         | pixels @ DPI  | top-left  | page image     |
 * | display        | CSS px        | top-left  | browser        |
 * | export         | pt or px      | top-left  | output file    |
 * | page-normalized| [0,1] ratio   | top-left  | box storage    |
 * ─────────────────────────────────────────────────────────────
 * 
 * All boxes are stored in page-normalized coordinates:
 *   { x, y, width, height } ∈ [0,1], relative to page dimensions
 *   Plus: pageWidth, pageHeight in PDF points
 * 
 * PDF coordinate note:
 *   PyMuPDF (fitz) uses top-left origin internally for page.rect
 *   and get_pixmap(). The actual PDF spec uses bottom-left, but
 *   fitz handles the flip transparently. We consistently use top-left.
 */

// ─── Core Types ───────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedBox
 * @property {string} id
 * @property {number} page - 1-indexed page number
 * @property {number} x - [0,1] relative to page width
 * @property {number} y - [0,1] relative to page height
 * @property {number} width - [0,1] relative to page width
 * @property {number} height - [0,1] relative to page height
 * @property {string} coordinateSpace - always 'page-normalized'
 * @property {number} pageWidth - PDF points
 * @property {number} pageHeight - PDF points
 * @property {string} source - 'ocr'|'seal'|'manual'|'rule'
 * @property {string} [entityType]
 * @property {boolean} [locked]
 */

/**
 * @typedef {Object} PageRenderInfo
 * @property {number} pageNumber - 1-indexed
 * @property {number} imageWidth - pixels
 * @property {number} imageHeight - pixels
 * @property {number} pageWidth - PDF points
 * @property {number} pageHeight - PDF points
 * @property {number} dpi - render DPI
 */

/**
 * @typedef {Object} CSSBox
 * @property {number} left - CSS px
 * @property {number} top - CSS px
 * @property {number} width - CSS px
 * @property {number} height - CSS px
 */

/**
 * @typedef {Object} ExportBox
 * @property {number} x - PDF points or raster pixels
 * @property {number} y - PDF points or raster pixels
 * @property {number} width - PDF points or raster pixels
 * @property {number} height - PDF points or raster pixels
 * @property {number} page - 1-indexed
 */

// ─── Normalized ↔ Page (PDF point) ───────────────────────────

/**
 * Convert page-normalized box to PDF point coordinates.
 * @param {NormalizedBox} box
 * @returns {ExportBox}
 */
export function normalizedToPagePt(box) {
  const { x, y, width, height, pageWidth, pageHeight, page } = box;
  return {
    x: x * pageWidth,
    y: y * pageHeight,
    width: width * pageWidth,
    height: height * pageHeight,
    page,
  };
}

/**
 * Convert PDF point coordinates to page-normalized.
 * @param {ExportBox} rect
 * @param {number} pageWidth - PDF points
 * @param {number} pageHeight - PDF points
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function pagePtToNormalized(rect, pageWidth, pageHeight) {
  return {
    x: rect.x / pageWidth,
    y: rect.y / pageHeight,
    width: rect.width / pageWidth,
    height: rect.height / pageHeight,
  };
}

// ─── Normalized ↔ Render (image pixels @ DPI) ────────────────

/**
 * Convert page-normalized box to render pixel coordinates.
 * @param {NormalizedBox} box
 * @param {number} imageWidth - render image width in pixels
 * @param {number} imageHeight - render image height in pixels
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function normalizedToRenderPx(box, imageWidth, imageHeight) {
  const { x, y, width, height } = box;
  return {
    x: x * imageWidth,
    y: y * imageHeight,
    width: width * imageWidth,
    height: height * imageHeight,
  };
}

/**
 * Convert render pixel coordinates to page-normalized.
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function renderPxToNormalized(rect, imageWidth, imageHeight) {
  return {
    x: rect.x / imageWidth,
    y: rect.y / imageHeight,
    width: rect.width / imageWidth,
    height: rect.height / imageHeight,
  };
}

// ─── Normalized ↔ CSS Display ────────────────────────────────

/**
 * Convert page-normalized box to CSS display coordinates.
 * @param {NormalizedBox} box
 * @param {number} displayWidth - CSS width of the page image element
 * @param {number} displayHeight - CSS height of the page image element
 * @returns {CSSBox}
 */
export function normalizedToCSS(box, displayWidth, displayHeight) {
  const { x, y, width, height } = box;
  return {
    left: x * displayWidth,
    top: y * displayHeight,
    width: width * displayWidth,
    height: height * displayHeight,
  };
}

/**
 * Convert CSS display coordinates to page-normalized.
 * @param {CSSBox} cssRect
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function cssToNormalized(cssRect, displayWidth, displayHeight) {
  return {
    x: cssRect.left / displayWidth,
    y: cssRect.top / displayHeight,
    width: cssRect.width / displayWidth,
    height: cssRect.height / displayHeight,
  };
}

// ─── Normalized ↔ Export ─────────────────────────────────────

/**
 * Convert page-normalized box to export coordinates.
 * For text PDF: returns PDF points.
 * For scan PDF: returns raster pixels at render DPI.
 * 
 * @param {NormalizedBox} box
 * @param {'pdf-pt'|'raster-px'} exportMode
 * @param {PageRenderInfo} pageInfo
 * @returns {ExportBox}
 */
export function normalizedToExport(box, exportMode, pageInfo) {
  if (exportMode === 'pdf-pt') {
    return normalizedToPagePt(box);
  }
  // raster-px: use render image dimensions
  const px = normalizedToRenderPx(box, pageInfo.imageWidth, pageInfo.imageHeight);
  return {
    x: px.x,
    y: px.y,
    width: px.width,
    height: px.height,
    page: box.page,
  };
}

/**
 * Convert export coordinates to page-normalized.
 * @param {ExportBox} rect
 * @param {'pdf-pt'|'raster-px'} exportMode
 * @param {PageRenderInfo} pageInfo
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function exportToNormalized(rect, exportMode, pageInfo) {
  if (exportMode === 'pdf-pt') {
    return pagePtToNormalized(rect, pageInfo.pageWidth, pageInfo.pageHeight);
  }
  return renderPxToNormalized(rect, pageInfo.imageWidth, pageInfo.imageHeight);
}

// ─── Display Scaling Helpers ─────────────────────────────────

/**
 * Compute CSS display dimensions preserving aspect ratio.
 * @param {PageRenderInfo} pageInfo
 * @param {number} containerWidth - available CSS width
 * @param {number} [maxHeight=800] - max CSS height
 * @returns {{ displayWidth: number, displayHeight: number, scale: number }}
 */
export function computeDisplaySize(pageInfo, containerWidth, maxHeight = 800) {
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

// ─── Round-trip Verification ─────────────────────────────────

/**
 * Verify round-trip accuracy: normalized → CSS → normalized.
 * Returns the maximum absolute error in normalized coordinates.
 * 
 * @param {NormalizedBox} originalBox
 * @param {number} displayWidth
 * @param {number} displayHeight
 * @returns {{ maxError: number, details: object }}
 */
export function verifyRoundTripCSS(originalBox, displayWidth, displayHeight) {
  const css = normalizedToCSS(originalBox, displayWidth, displayHeight);
  const back = cssToNormalized(css, displayWidth, displayHeight);

  const errors = {
    x: Math.abs(originalBox.x - back.x),
    y: Math.abs(originalBox.y - back.y),
    width: Math.abs(originalBox.width - back.width),
    height: Math.abs(originalBox.height - back.height),
  };

  return {
    maxError: Math.max(errors.x, errors.y, errors.width, errors.height),
    details: { original: originalBox, css, back, errors },
  };
}

/**
 * Verify round-trip accuracy: normalized → export → normalized.
 * @param {NormalizedBox} originalBox
 * @param {'pdf-pt'|'raster-px'} exportMode
 * @param {PageRenderInfo} pageInfo
 * @returns {{ maxError: number, details: object }}
 */
export function verifyRoundTripExport(originalBox, exportMode, pageInfo) {
  const exported = normalizedToExport(originalBox, exportMode, pageInfo);
  const back = exportToNormalized(exported, exportMode, pageInfo);

  const errors = {
    x: Math.abs(originalBox.x - back.x),
    y: Math.abs(originalBox.y - back.y),
    width: Math.abs(originalBox.width - back.width),
    height: Math.abs(originalBox.height - back.height),
  };

  return {
    maxError: Math.max(errors.x, errors.y, errors.width, errors.height),
    details: { original: originalBox, exported, back, errors },
  };
}

// ─── Validation ──────────────────────────────────────────────

/**
 * Validate that a normalized box is within [0,1] bounds.
 * @param {NormalizedBox} box
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNormalizedBox(box) {
  const errors = [];
  if (box.coordinateSpace !== 'page-normalized') {
    errors.push(`coordinateSpace must be 'page-normalized', got '${box.coordinateSpace}'`);
  }
  if (box.x < 0 || box.x > 1) errors.push(`x=${box.x} out of [0,1]`);
  if (box.y < 0 || box.y > 1) errors.push(`y=${box.y} out of [0,1]`);
  if (box.width < 0 || box.width > 1) errors.push(`width=${box.width} out of [0,1]`);
  if (box.height < 0 || box.height > 1) errors.push(`height=${box.height} out of [0,1]`);
  if (box.x + box.width > 1.001) errors.push(`x+width=${box.x + box.width} exceeds 1`);
  if (box.y + box.height > 1.001) errors.push(`y+height=${box.y + box.height} exceeds 1`);
  if (!box.pageWidth || box.pageWidth <= 0) errors.push(`invalid pageWidth=${box.pageWidth}`);
  if (!box.pageHeight || box.pageHeight <= 0) errors.push(`invalid pageHeight=${box.pageHeight}`);
  return { valid: errors.length === 0, errors };
}

/**
 * Create a normalized box from raw values.
 * @param {Partial<NormalizedBox>} partial
 * @returns {NormalizedBox}
 */
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
    locked: partial.locked || false,
  };
}
