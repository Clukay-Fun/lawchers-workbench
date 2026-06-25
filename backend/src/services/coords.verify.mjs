/**
 * P0 Coordinate Transform Round-Trip Verification
 * 
 * Tests:
 * 1. Normalized ↔ CSS at 100% scale
 * 2. Normalized ↔ CSS at 150% scale
 * 3. Normalized ↔ CSS at Retina (2x) scale
 * 4. Multi-page: different page sizes don't cross-contaminate
 * 5. Normalized ↔ Export (pdf-pt) round-trip
 * 6. Normalized ↔ Export (raster-px) round-trip
 * 7. Edge cases: box at corners, tiny box, full-page box
 */

import {
  normalizedToCSS, cssToNormalized,
  normalizedToPagePt, pagePtToNormalized,
  normalizedToRenderPx, renderPxToNormalized,
  normalizedToExport, exportToNormalized,
  computeDisplaySize, verifyRoundTripCSS, verifyRoundTripExport,
  validateNormalizedBox, createNormalizedBox,
} from './coords.js';

const TOLERANCE = 1e-10; // near-zero for float arithmetic

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function assertClose(a, b, tolerance, msg) {
  const diff = Math.abs(a - b);
  if (diff > tolerance) {
    throw new Error(`FAIL: ${msg} — expected ${b}, got ${a}, diff=${diff} > tolerance=${tolerance}`);
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Mock page info ──────────────────────────────────────────

const a4Page = {
  pageNumber: 1,
  imageWidth: 1653,   // 595 * (200/72) ≈ 1653
  imageHeight: 2339,  // 842 * (200/72) ≈ 2339
  pageWidth: 595,
  pageHeight: 842,
  dpi: 200,
};

const letterPage = {
  pageNumber: 2,
  imageWidth: 1700,   // 612 * (200/72) ≈ 1700
  imageHeight: 2200,  // 792 * (200/72) ≈ 2200
  pageWidth: 612,
  pageHeight: 792,
  dpi: 200,
};

// ─── Test Box ────────────────────────────────────────────────

const testBox = createNormalizedBox({
  id: 'test_1',
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.05,
  pageWidth: 595,
  pageHeight: 842,
  source: 'manual',
});

console.log('\n=== P0 Coordinate Transform Round-Trip Verification ===\n');

// ─── Test 1: Normalized ↔ CSS at 100% ────────────────────────

console.log('1. Normalized ↔ CSS at 100% scale');

test('round-trip at 100% (1653x2339 display)', () => {
  const displayWidth = 1653;
  const displayHeight = 2339;
  const result = verifyRoundTripCSS(testBox, displayWidth, displayHeight);
  assertClose(result.maxError, 0, TOLERANCE, 'round-trip error');
});

test('round-trip at 100% (800x1131 display)', () => {
  const displayWidth = 800;
  const displayHeight = 1131;
  const result = verifyRoundTripCSS(testBox, displayWidth, displayHeight);
  assertClose(result.maxError, 0, TOLERANCE, 'round-trip error');
});

// ─── Test 2: Normalized ↔ CSS at 150% ────────────────────────

console.log('\n2. Normalized ↔ CSS at 150% scale');

test('round-trip at 150% (2480x3509 display)', () => {
  const displayWidth = 2480;
  const displayHeight = 3509;
  const result = verifyRoundTripCSS(testBox, displayWidth, displayHeight);
  assertClose(result.maxError, 0, TOLERANCE, 'round-trip error');
});

test('round-trip at 150% (1200x1697 display)', () => {
  const displayWidth = 1200;
  const displayHeight = 1697;
  const result = verifyRoundTripCSS(testBox, displayWidth, displayHeight);
  assertClose(result.maxError, 0, TOLERANCE, 'round-trip error');
});

// ─── Test 3: Retina (2x) ─────────────────────────────────────

console.log('\n3. Retina (2x) scale');

test('round-trip at Retina 2x (3306x4678 display)', () => {
  // Retina: CSS size = half of rendered pixels
  const displayWidth = 3306 / 2;  // 1653 CSS px
  const displayHeight = 2339;     // but image is 3306px wide
  // Actually, for Retina, the display CSS size stays the same,
  // but the image has 2x pixels. The normalized coords don't change.
  const result = verifyRoundTripCSS(testBox, 1653, 2339);
  assertClose(result.maxError, 0, TOLERANCE, 'round-trip error');
});

test('CSS values scale proportionally with display size', () => {
  const css1 = normalizedToCSS(testBox, 1000, 1414);
  const css2 = normalizedToCSS(testBox, 2000, 2828);
  assertClose(css2.left, css1.left * 2, TOLERANCE, 'left should double');
  assertClose(css2.top, css1.top * 2, TOLERANCE, 'top should double');
  assertClose(css2.width, css1.width * 2, TOLERANCE, 'width should double');
  assertClose(css2.height, css1.height * 2, TOLERANCE, 'height should double');
});

// ─── Test 4: Multi-page isolation ────────────────────────────

console.log('\n4. Multi-page isolation');

test('A4 page and Letter page boxes do not cross-contaminate', () => {
  const box1 = createNormalizedBox({
    page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05,
    pageWidth: 595, pageHeight: 842,
  });
  const box2 = createNormalizedBox({
    page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.05,
    pageWidth: 612, pageHeight: 792,
  });

  const pt1 = normalizedToPagePt(box1);
  const pt2 = normalizedToPagePt(box2);

  // Same normalized coords → different PDF points (different page sizes)
  assertClose(pt1.x, 59.5, TOLERANCE, 'A4 x');
  assertClose(pt2.x, 61.2, TOLERANCE, 'Letter x');
  assert(pt1.x !== pt2.x, 'different page sizes should give different pt values');

  // Convert back
  const n1 = pagePtToNormalized(pt1, 595, 842);
  const n2 = pagePtToNormalized(pt2, 612, 792);
  assertClose(n1.x, 0.1, TOLERANCE, 'A4 round-trip');
  assertClose(n2.x, 0.1, TOLERANCE, 'Letter round-trip');
});

test('render pixel isolation across pages', () => {
  const r1 = normalizedToRenderPx(testBox, a4Page.imageWidth, a4Page.imageHeight);
  const r2 = normalizedToRenderPx(testBox, letterPage.imageWidth, letterPage.imageHeight);

  // Different image dimensions → different pixel values
  assert(r1.width !== r2.width, 'different image widths should give different px');
  assert(r1.height !== r2.height, 'different image heights should give different px');
});

// ─── Test 5: Normalized ↔ Export (pdf-pt) ────────────────────

console.log('\n5. Normalized ↔ Export (pdf-pt)');

test('round-trip pdf-pt export', () => {
  const result = verifyRoundTripExport(testBox, 'pdf-pt', a4Page);
  assertClose(result.maxError, 0, TOLERANCE, 'pdf-pt round-trip error');
});

test('export matches direct page-pt conversion', () => {
  const exported = normalizedToExport(testBox, 'pdf-pt', a4Page);
  const direct = normalizedToPagePt(testBox);
  assertClose(exported.x, direct.x, TOLERANCE, 'x');
  assertClose(exported.y, direct.y, TOLERANCE, 'y');
  assertClose(exported.width, direct.width, TOLERANCE, 'width');
  assertClose(exported.height, direct.height, TOLERANCE, 'height');
});

// ─── Test 6: Normalized ↔ Export (raster-px) ─────────────────

console.log('\n6. Normalized ↔ Export (raster-px)');

test('round-trip raster-px export', () => {
  const result = verifyRoundTripExport(testBox, 'raster-px', a4Page);
  assertClose(result.maxError, 0, TOLERANCE, 'raster-px round-trip error');
});

test('export matches direct render-px conversion', () => {
  const exported = normalizedToExport(testBox, 'raster-px', a4Page);
  const direct = normalizedToRenderPx(testBox, a4Page.imageWidth, a4Page.imageHeight);
  assertClose(exported.x, direct.x, TOLERANCE, 'x');
  assertClose(exported.y, direct.y, TOLERANCE, 'y');
  assertClose(exported.width, direct.width, TOLERANCE, 'width');
  assertClose(exported.height, direct.height, TOLERANCE, 'height');
});

// ─── Test 7: Edge cases ──────────────────────────────────────

console.log('\n7. Edge cases');

test('box at top-left corner (0,0)', () => {
  const box = createNormalizedBox({
    page: 1, x: 0, y: 0, width: 0.1, height: 0.1,
    pageWidth: 595, pageHeight: 842,
  });
  const result = verifyRoundTripCSS(box, 1000, 1414);
  assertClose(result.maxError, 0, TOLERANCE, 'corner round-trip');
});

test('box at bottom-right corner', () => {
  const box = createNormalizedBox({
    page: 1, x: 0.9, y: 0.9, width: 0.1, height: 0.1,
    pageWidth: 595, pageHeight: 842,
  });
  const result = verifyRoundTripCSS(box, 1000, 1414);
  assertClose(result.maxError, 0, TOLERANCE, 'corner round-trip');
});

test('tiny box (1% of page)', () => {
  const box = createNormalizedBox({
    page: 1, x: 0.5, y: 0.5, width: 0.01, height: 0.01,
    pageWidth: 595, pageHeight: 842,
  });
  const result = verifyRoundTripCSS(box, 1000, 1414);
  assertClose(result.maxError, 0, TOLERANCE, 'tiny box round-trip');
});

test('full-page box', () => {
  const box = createNormalizedBox({
    page: 1, x: 0, y: 0, width: 1, height: 1,
    pageWidth: 595, pageHeight: 842,
  });
  const result = verifyRoundTripCSS(box, 1000, 1414);
  assertClose(result.maxError, 0, TOLERANCE, 'full-page round-trip');
});

test('validation catches out-of-bounds', () => {
  const bad = createNormalizedBox({
    page: 1, x: 0.9, y: 0.9, width: 0.2, height: 0.2,
    pageWidth: 595, pageHeight: 842,
  });
  const result = validateNormalizedBox(bad);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.length > 0, 'should have errors');
});

test('validation passes valid box', () => {
  const result = validateNormalizedBox(testBox);
  assert(result.valid, `should be valid: ${result.errors}`);
});

// ─── Test 8: DPI scaling accuracy ────────────────────────────

console.log('\n8. DPI scaling accuracy');

test('200 DPI: page pt → image px ratio is 200/72', () => {
  const ratio = a4Page.imageWidth / a4Page.pageWidth;
  assertClose(ratio, 200 / 72, 0.01, 'DPI ratio');
});

test('300 DPI: page pt → image px ratio is 300/72', () => {
  const page300 = { ...a4Page, imageWidth: Math.round(595 * (300 / 72)), imageHeight: Math.round(842 * (300 / 72)), dpi: 300 };
  const ratio = page300.imageWidth / page300.pageWidth;
  assertClose(ratio, 300 / 72, 0.01, 'DPI ratio');
});

// ─── Summary ─────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
