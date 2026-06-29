/**
 * Map a normalized visual box back to OCR text spans.
 * Offsets follow the same "\n"-joined OCR line order used by VisualMaskPage.
 */
export function findOcrSpansForBox(box, ocrBoxes) {
  if (!box || !Array.isArray(ocrBoxes)) return [];

  const spans = [];
  let cumulativeOffset = 0;

  for (const line of ocrBoxes) {
    const text = line.text || '';
    const lineStart = cumulativeOffset;
    cumulativeOffset += text.length + 1;

    if (!text || (line.page || line.pageNumber || 1) !== box.page) continue;

    const lineX = line.x || 0;
    const lineY = line.y || 0;
    const lineWidth = line.width || 0;
    const lineHeight = line.height || 0;
    if (lineWidth <= 0 || lineHeight <= 0) continue;

    const boxRight = box.x + box.width;
    const boxBottom = box.y + box.height;
    const lineRight = lineX + lineWidth;
    const lineBottom = lineY + lineHeight;
    if (lineRight <= box.x || lineX >= boxRight || lineBottom <= box.y || lineY >= boxBottom) continue;

    const charWidth = lineWidth / text.length;
    const epsilon = 1e-7;
    const charStart = Math.max(0, Math.min(
      text.length,
      Math.floor(((Math.max(box.x, lineX) - lineX) / charWidth) + epsilon),
    ));
    const charEnd = Math.max(charStart, Math.min(
      text.length,
      Math.ceil(((Math.min(boxRight, lineRight) - lineX) / charWidth) - epsilon),
    ));
    if (charStart >= charEnd) continue;

    const original = text.substring(charStart, charEnd);
    if (!original.trim()) continue;

    spans.push({
      original,
      start: lineStart + charStart,
      end: lineStart + charEnd,
    });
  }

  return spans;
}
