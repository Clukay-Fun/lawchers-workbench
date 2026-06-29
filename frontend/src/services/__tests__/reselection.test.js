import { describe, expect, it } from 'vitest';
import { choosePendingReselect } from '../reselection';

const pending = [
  { id: 'ent_1', original: '张三', entity_type: 'PERSON' },
  { id: 'ent_2', original: '李四', entity_type: 'PERSON' },
];

describe('choosePendingReselect', () => {
  it('uses the explicitly selected pending item', () => {
    const result = choosePendingReselect(pending, 'ent_2', '新文字');
    expect(result).toEqual({ status: 'resolve', target: pending[1] });
  });

  it('auto-resolves a unique exact text match', () => {
    const result = choosePendingReselect(pending, null, '张三');
    expect(result).toEqual({ status: 'resolve', target: pending[0] });
  });

  it('blocks ambiguous duplicate text matches', () => {
    const duplicates = [...pending, { id: 'ent_3', original: '张三', entity_type: 'PERSON' }];
    expect(choosePendingReselect(duplicates, null, '张三')).toEqual({
      status: 'ambiguous',
      target: null,
    });
  });

  it('does not consume a pending item when selected text does not match', () => {
    expect(choosePendingReselect(pending, null, '王五')).toEqual({
      status: 'none',
      target: null,
    });
  });
});
