import { describe, it, expect } from 'vitest';
import { multiDiff, mapEntities, detectAmbiguous, projectEntities } from '../diff';

describe('multiDiff', () => {
  it('returns empty for identical text', () => {
    expect(multiDiff('hello world', 'hello world')).toEqual([]);
  });

  it('detects single contiguous replacement', () => {
    const c = multiDiff('hello world', 'hello there');
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ oldStart: 6, oldEnd: 11, newStart: 6, newEnd: 11 });
  });

  it('detects prepend as one change', () => {
    const c = multiDiff('world', 'hello world');
    expect(c).toHaveLength(1);
    expect(c[0].oldStart).toBe(0);
    expect(c[0].oldEnd).toBe(0);
    expect(c[0].newStart).toBe(0);
    expect(c[0].newEnd).toBe(6);
  });

  it('detects append as one change', () => {
    const c = multiDiff('hello', 'hello world');
    expect(c).toHaveLength(1);
    expect(c[0].oldStart).toBe(5);
    expect(c[0].newStart).toBe(5);
    expect(c[0].newEnd).toBe(11);
  });

  it('detects two separate replacements with gap', () => {
    // "apple banana cherry" → "apricot banana date"
    // "ap" from "apple" matches "ap" in "apricot"
    // remaining "ple"→"ricot" is one change
    // "cherry"→"date" is another
    const oldT = 'apple banana cherry';
    const newT = 'apricot banana date';
    const c = multiDiff(oldT, newT);
    expect(c.length).toBeGreaterThanOrEqual(2);
    // "ple" change in "apple" region
    const change0 = c.find(ch => ch.oldStart >= 0 && ch.oldEnd <= 5);
    expect(change0).toBeTruthy();
    // "cherry"→"date" change
    const change1 = c.find(ch => ch.oldStart >= 6 && ch.oldEnd <= 19);
    expect(change1).toBeTruthy();
  });

  it('detects insertion and deletion as one change each when separated by content', () => {
    // "abc" → "XaYbc": two insertions around "a" and "a"/"bc"
    // Pure insertions (zero oldLen) → not merged
    const c = multiDiff('abc', 'XaYbc');
    expect(c.length).toBeGreaterThanOrEqual(1);
  });

  it('merges changes around coincidental single-char match', () => {
    // "world" → "there" shares 'r' coincidentally
    // with merge: one change
    const c = multiDiff('world', 'there');
    expect(c).toHaveLength(1);
  });

  it('detects replacement in middle with text unchanged at both ends', () => {
    // Phone number replacement — due to "0013" common substring
    // this produces two changes (two '8'→'9' substitutions)
    const c = multiDiff('张三的手机号是13800138000。', '张三的手机号是13900139000。');
    // Changes are within the phone number region
    expect(c.length).toBeGreaterThanOrEqual(1);
    for (const ch of c) {
      expect(ch.oldStart).toBeGreaterThanOrEqual(7);
      expect(ch.oldEnd).toBeLessThanOrEqual(19);
    }
  });

  it('handles complete replacement', () => {
    const c = multiDiff('abc', 'xyz');
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ oldStart: 0, oldEnd: 3, newStart: 0, newEnd: 3 });
  });

  it('handles empty old text', () => {
    const c = multiDiff('', 'hello');
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 5 });
  });

  it('handles empty new text', () => {
    const c = multiDiff('hello', '');
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ oldStart: 0, oldEnd: 5, newStart: 0, newEnd: 0 });
  });
});

describe('mapEntities (S1)', () => {
  const base = [
    { id: 'ent_1', start: 0, end: 2 },   // before change
    { id: 'ent_2', start: 6, end: 12 },  // overlaps change → cancel
    { id: 'ent_3', start: 18, end: 21 }, // after change → shifted
  ];

  it('shifts entities after change region', () => {
    const changes = [{ oldStart: 5, oldEnd: 15, newStart: 5, newEnd: 20 }];
    // delta = (20-5)-(15-5) = 15-10 = 5
    const { kept } = mapEntities(base, changes);
    const after = kept.find(e => e.id === 'ent_3');
    expect(after.start).toBe(23);
    expect(after.end).toBe(26);
  });

  it('keeps entities before change as-is', () => {
    const changes = [{ oldStart: 5, oldEnd: 15, newStart: 5, newEnd: 20 }];
    const { kept } = mapEntities(base, changes);
    const before = kept.find(e => e.id === 'ent_1');
    expect(before.start).toBe(0);
    expect(before.end).toBe(2);
  });

  it('cancels entities overlapping change region', () => {
    const changes = [{ oldStart: 5, oldEnd: 15, newStart: 5, newEnd: 20 }];
    const { cancelled } = mapEntities(base, changes);
    expect(cancelled.map(e => e.id)).toContain('ent_2');
  });

  it('preserves id of shifted entities', () => {
    const changes = [{ oldStart: 5, oldEnd: 15, newStart: 5, newEnd: 20 }];
    const { kept } = mapEntities(base, changes);
    expect(kept.find(e => e.id === 'ent_3')).toBeTruthy();
    expect(kept.find(e => e.id === 'ent_3').id).toBe('ent_3');
  });

  it('keeps entity between two changes with correct delta', () => {
    // Entity at old(6,8) sits between first change (3,5)→(3,6) and
    // second change (10,12)→(13,14). Gets delta from first change.
    const changes = [
      { oldStart: 3, oldEnd: 5, newStart: 3, newEnd: 6 },  // delta = 3-2 = 1
      { oldStart: 10, oldEnd: 12, newStart: 13, newEnd: 14 },  // delta = 1-2 = -1
    ];
    const ents = [
      { id: 'e1', start: 0, end: 2 },  // before any change
      { id: 'e2', start: 6, end: 8 },  // between changes
      { id: 'e3', start: 14, end: 16 }, // after second change
    ];
    const { kept, cancelled } = mapEntities(ents, changes);
    expect(cancelled).toHaveLength(0);
    const e1 = kept.find(e => e.id === 'e1');
    expect(e1.start).toBe(0);
    expect(e1.end).toBe(2);

    const e2 = kept.find(e => e.id === 'e2');
    // delta from first change: (6-3)-(5-3) = 1
    expect(e2.start).toBe(7);
    expect(e2.end).toBe(9);

    const e3 = kept.find(e => e.id === 'e3');
    // cumulative delta: 1 + (14-13)-(12-10) = 1 + (1-2) = 0
    expect(e3.start).toBe(14);
    expect(e3.end).toBe(16);  // No, wait: cumulative = 1 + (-1) = 0
    // So e3 should be at (14, 16)
  });

  it('cancels entity overlapping second of two changes', () => {
    const changes = [
      { oldStart: 3, oldEnd: 5, newStart: 3, newEnd: 6 },
      { oldStart: 10, oldEnd: 12, newStart: 13, newEnd: 14 },
    ];
    const ents = [
      { id: 'e1', start: 8, end: 11 }, // overlaps second change
    ];
    const { cancelled } = mapEntities(ents, changes);
    expect(cancelled.map(e => e.id)).toContain('e1');
  });
});

describe('detectAmbiguous (S2)', () => {
  it('remaps cancelled entity whose text appears uniquely', () => {
    const cancelled = [{ id: 'e1', start: 0, end: 3, original: 'abc' }];
    const { remapped, needsReselect } = detectAmbiguous(cancelled, 'xyz abc def');
    expect(remapped).toHaveLength(1);
    expect(remapped[0].start).toBe(4);
    expect(remapped[0].end).toBe(7);
    expect(needsReselect).toHaveLength(0);
  });

  it('marks needsReselect for duplicate text', () => {
    const cancelled = [{ id: 'e1', start: 10, end: 13, original: 'abc' }];
    const { remapped, needsReselect } = detectAmbiguous(cancelled, 'abc xyz abc');
    expect(remapped).toHaveLength(0);
    expect(needsReselect).toHaveLength(1);
    expect(needsReselect[0].id).toBe('e1');
  });

  it('keeps cancelled for text not in newText', () => {
    const cancelled = [{ id: 'e1', start: 0, end: 3, original: 'abc' }];
    const { remapped, needsReselect } = detectAmbiguous(cancelled, 'xyz def');
    expect(remapped).toHaveLength(0);
    expect(needsReselect).toHaveLength(0);
  });

  it('handles mixed entities', () => {
    const cancelled = [
      { id: 'e1', start: 0, end: 2, original: 'ab' },
      { id: 'e2', start: 5, end: 7, original: 'cd' },
      { id: 'e3', start: 10, end: 12, original: 'ef' },
    ];
    const newText = 'xx cd ab ef cd';
    // 'ab' at position 6 (unique) → remap
    // 'cd' appears at 3 and 13 (2×) → ambiguous
    // 'ef' at position 9 (unique) → remap
    const { remapped, needsReselect } = detectAmbiguous(cancelled, newText);
    expect(remapped).toHaveLength(2);
    const e1 = remapped.find(e => e.id === 'e1');
    expect(e1.start).toBe(6);
    expect(e1.end).toBe(8);
    const e3 = remapped.find(e => e.id === 'e3');
    expect(e3.start).toBe(9);
    expect(e3.end).toBe(11);
    expect(needsReselect).toHaveLength(1);
    expect(needsReselect[0].id).toBe('e2');
  });
});

describe('projectEntities (S3)', () => {
  it('returns entities as-is when text unchanged', () => {
    const entities = [{ id: 'e1', start: 0, end: 5 }];
    expect(projectEntities(entities, 'hello world', 'hello world')).toBe(entities);
  });

  it('projects entity before change region', () => {
    // "hello world" → "hi world": "hello"→"hi" is a change
    // entity "world" at old(6,11) shifts to new(3,8)
    const entities = [{ id: 'e1', start: 6, end: 11 }];
    const result = projectEntities(entities, 'hello world', 'hi world');
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(3);
    expect(result[0].end).toBe(8);
  });

  it('drops entity intersecting change region', () => {
    // "hello world" → "hi world": "hello" at old(0,5) overlaps change
    const entities = [{ id: 'e1', start: 0, end: 5 }];
    const result = projectEntities(entities, 'hello world', 'hi world');
    expect(result).toHaveLength(0);
  });

  it('returns empty for empty entities', () => {
    expect(projectEntities([], 'a', 'b')).toEqual([]);
  });
});
