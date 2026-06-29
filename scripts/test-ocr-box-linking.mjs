import assert from 'node:assert/strict';
import { findOcrSpansForBox } from '../frontend/src/services/ocrBoxLinking.js';

const ocrBoxes = [
  { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.05, text: '甲方电话13812348000' },
  { page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.05, text: '乙方名称测试公司' },
  { page: 2, x: 0.1, y: 0.1, width: 0.5, height: 0.05, text: '第二页内容' },
];

const firstLineCharWidth = 0.5 / ocrBoxes[0].text.length;
const phoneStart = ocrBoxes[0].text.indexOf('13812348000');
const phoneBox = {
  page: 1,
  x: 0.1 + phoneStart * firstLineCharWidth,
  y: 0.1,
  width: 11 * firstLineCharWidth,
  height: 0.05,
};
assert.deepEqual(findOcrSpansForBox(phoneBox, ocrBoxes), [{
  original: '13812348000',
  start: phoneStart,
  end: phoneStart + 11,
}]);

const secondLineCharWidth = 0.5 / ocrBoxes[1].text.length;
const companyStart = ocrBoxes[1].text.indexOf('测试公司');
const movedBox = {
  page: 1,
  x: 0.1 + companyStart * secondLineCharWidth,
  y: 0.2,
  width: 4 * secondLineCharWidth,
  height: 0.05,
};
const secondLineOffset = ocrBoxes[0].text.length + 1;
assert.deepEqual(findOcrSpansForBox(movedBox, ocrBoxes), [{
  original: '测试公司',
  start: secondLineOffset + companyStart,
  end: secondLineOffset + companyStart + 4,
}]);

const expandedBox = {
  ...movedBox,
  x: 0.1,
  width: 0.5,
};
assert.deepEqual(findOcrSpansForBox(expandedBox, ocrBoxes), [{
  original: ocrBoxes[1].text,
  start: secondLineOffset,
  end: secondLineOffset + ocrBoxes[1].text.length,
}]);

assert.deepEqual(findOcrSpansForBox({ ...phoneBox, page: 99 }, ocrBoxes), []);

console.log('OCR box linking: 4 passed');
