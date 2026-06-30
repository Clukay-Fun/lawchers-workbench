import { describe, expect, it } from 'vitest';
import {
  validateRedaction,
  deriveBoxes,
  deriveTextEntities,
  derivePendingReselect,
  deriveCancelledIds,
  convertToRedactions,
  remapRedactions,
  addRedaction,
  cancelRedaction,
  resolveRedaction,
  updateRedaction,
} from '../redactions';

// ─── 测试夹具：模拟旧格式数据 ─────────────────────────────────

const oldTextEntities = [
  { id: 'ent_0', original: '张三', entity_type: 'PERSON', start: 0, end: 2, source: 'regex' },
  { id: 'ent_1', original: '13912345678', entity_type: 'PHONE', start: 8, end: 19, source: 'regex' },
  { id: 'ent_2', original: '北京市朝阳区', entity_type: 'ADDRESS', start: 22, end: 28, source: 'ner' },
];

const oldBoxes = [
  { id: 'box_a', page: 1, x: 0.1, y: 0.2, width: 0.05, height: 0.01, entityId: 'ent_0', entityIds: ['ent_0'], source: 'ocr', entityType: 'PERSON', text: '张三' },
  { id: 'box_b', page: 1, x: 0.3, y: 0.2, width: 0.15, height: 0.01, entityId: 'ent_1', entityIds: ['ent_1'], source: 'ocr', entityType: 'PHONE', text: '13912345678' },
  { id: 'box_seal', page: 1, x: 0.5, y: 0.8, width: 0.1, height: 0.1, entityId: null, entityIds: [], source: 'seal', entityType: 'SEAL', text: '' },
];

const oldCancelled = ['ent_2'];
const oldPending = [
  { id: 'ent_3', original: '李四', entity_type: 'PERSON' },
];

// ─── 1. 转换器确定性 ─────────────────────────────────────────

describe('convertToRedactions — 确定性转换', () => {
  it('相同输入产生相同输出', () => {
    const r1 = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const r2 = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    expect(r1).toEqual(r2);
  });

  it('生成 red_N 格式 ID', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    for (const item of r) {
      expect(item.id).toMatch(/^red_\d+$/);
    }
  });

  it('保留 _legacyId 用于迁移追溯', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const ent0 = r.find(x => x._legacyId === 'ent_0');
    expect(ent0).toBeDefined();
    expect(ent0.entityType).toBe('PERSON');
    expect(ent0.original).toBe('张三');
  });

  it('textEntity 的 textAnchor 正确转移', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const ent0 = r.find(x => x._legacyId === 'ent_0');
    expect(ent0.textAnchor).toEqual({ start: 0, end: 2 });
  });

  it('box 的 pageRegions 正确关联到对应 redaction', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const ent0 = r.find(x => x._legacyId === 'ent_0');
    expect(ent0.pageRegions).toHaveLength(1);
    expect(ent0.pageRegions[0]).toMatchObject({ page: 1, x: 0.1, y: 0.2, width: 0.05, height: 0.01 });
  });

  it('cancelled 的实体 enabled=false', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const ent2 = r.find(x => x._legacyId === 'ent_2');
    expect(ent2.enabled).toBe(false);
  });

  it('pendingReselect 转为 status=needs_reselect, textAnchor=null', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const pending = r.find(x => x._legacyId === 'ent_3');
    expect(pending).toBeDefined();
    expect(pending.status).toBe('needs_reselect');
    expect(pending.textAnchor).toBeNull();
    expect(pending.original).toBe('李四');
  });

  it('无实体关联的 seal box 转为纯视觉 redaction', () => {
    const r = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);
    const seal = r.find(x => x._legacyId === 'box_seal');
    expect(seal).toBeDefined();
    expect(seal.source).toBe('seal');
    expect(seal.textAnchor).toBeNull();
    expect(seal.pageRegions).toHaveLength(1);
    expect(seal.entityType).toBe('SEAL');
  });

  it('空输入返回空数组', () => {
    expect(convertToRedactions()).toEqual([]);
    expect(convertToRedactions([], [], [], [])).toEqual([]);
  });
});

// ─── 2. 派生等价（转换后派生回三模式，与迁移前语义等价）──────────

describe('派生等价 — 转换后派生回三模式', () => {
  const redactions = convertToRedactions(oldTextEntities, oldBoxes, oldCancelled, oldPending);

  it('deriveTextEntities: active+enabled+textAnchor 的记录派生为文本实体', () => {
    const entities = deriveTextEntities(redactions);
    // ent_0 (active, enabled) + ent_1 (active, enabled) = 2 条
    // ent_2 (cancelled → enabled=false) 排除
    // ent_3 (needs_reselect) 排除
    // seal (无 textAnchor) 排除
    expect(entities).toHaveLength(2);
    const names = entities.map(e => e.original).sort();
    expect(names).toEqual(['13912345678', '张三']);
  });

  it('deriveTextEntities: 派生的实体 start/end 与原文一致', () => {
    const entities = deriveTextEntities(redactions);
    const zhangsan = entities.find(e => e.original === '张三');
    expect(zhangsan.start).toBe(0);
    expect(zhangsan.end).toBe(2);
    const phone = entities.find(e => e.original === '13912345678');
    expect(phone.start).toBe(8);
    expect(phone.end).toBe(19);
  });

  it('deriveBoxes: enabled+有pageRegions 的记录派生为遮蔽框（含 needs_reselect 保留框）', () => {
    const boxes = deriveBoxes(redactions);
    // ent_0 有 box_a → 1 框
    // ent_1 有 box_b → 1 框
    // ent_2 cancelled → 不派生
    // ent_3 (needs_reselect) → 保留框（如果有 box 的话，此处无 box → 0 框）
    // seal → 1 框
    // 总计: ent_0(1) + ent_1(1) + seal(1) = 3
    expect(boxes).toHaveLength(3);
  });

  it('deriveBoxes: 派生的框坐标与原文一致', () => {
    const boxes = deriveBoxes(redactions);
    const zhangsanBox = boxes.find(b => b.entityType === 'PERSON');
    expect(zhangsanBox).toMatchObject({ x: 0.1, y: 0.2, width: 0.05, height: 0.01, page: 1 });
    const sealBox = boxes.find(b => b.entityType === 'SEAL');
    expect(sealBox).toMatchObject({ x: 0.5, y: 0.8, width: 0.1, height: 0.1 });
  });

  it('derivePendingReselect: needs_reselect 的记录派生为待重选列表', () => {
    const pending = derivePendingReselect(redactions);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ original: '李四', entity_type: 'PERSON' });
  });

  it('deriveCancelledIds: enabled=false 的记录 ID 派生为已取消集合', () => {
    const cancelled = deriveCancelledIds(redactions);
    expect(cancelled).toHaveLength(1);
    // 新 ID 是 red_N 格式，不是旧的 ent_2
    expect(cancelled[0]).toMatch(/^red_\d+$/);
  });
});

// ─── 3. needs_reselect 语义验证 ──────────────────────────────

describe('needs_reselect 语义', () => {
  it('needs_reselect 记录: 遮蔽框仍派生，文本不派生', () => {
    const redactions = [
      { id: 'red_0', enabled: true, status: 'needs_reselect', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: null, pageRegions: [{ id: 'reg_0', page: 1, x: 0.1, y: 0.2, width: 0.05, height: 0.01 }] },
    ];
    expect(deriveBoxes(redactions)).toHaveLength(1);  // 框保留
    expect(deriveTextEntities(redactions)).toHaveLength(0);  // 文本暂停
    expect(derivePendingReselect(redactions)).toHaveLength(1);  // 待重选列表有
  });

  it('纯视觉记录(seal): 框派生，文本不派生', () => {
    const redactions = [
      { id: 'red_0', enabled: true, status: 'active', entityType: 'SEAL', original: '', source: 'seal', textAnchor: null, pageRegions: [{ id: 'reg_0', page: 1, x: 0.5, y: 0.8, width: 0.1, height: 0.1 }] },
    ];
    expect(deriveBoxes(redactions)).toHaveLength(1);
    expect(deriveTextEntities(redactions)).toHaveLength(0);
    expect(derivePendingReselect(redactions)).toHaveLength(0);
  });

  it('enabled=false: 三模式均不派生', () => {
    const redactions = [
      { id: 'red_0', enabled: false, status: 'active', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: { start: 0, end: 2 }, pageRegions: [{ id: 'reg_0', page: 1, x: 0.1, y: 0.2, width: 0.05, height: 0.01 }] },
    ];
    expect(deriveBoxes(redactions)).toHaveLength(0);
    expect(deriveTextEntities(redactions)).toHaveLength(0);
    expect(derivePendingReselect(redactions)).toHaveLength(0);
  });
});

// ─── 4. remapRedactions — 复用 diff 算法 ─────────────────────

describe('remapRedactions — 文本编辑重映射', () => {
  const baseRedactions = [
    { id: 'red_0', enabled: true, status: 'active', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: { start: 0, end: 2 }, pageRegions: [{ id: 'reg_0', page: 1, x: 0.1, y: 0.2, width: 0.05, height: 0.01 }] },
    { id: 'red_1', enabled: true, status: 'active', entityType: 'PHONE', original: '13912345678', source: 'regex', textAnchor: { start: 8, end: 19 }, pageRegions: [] },
    { id: 'red_2', enabled: true, status: 'active', entityType: 'SEAL', original: '', source: 'seal', textAnchor: null, pageRegions: [{ id: 'reg_1', page: 1, x: 0.5, y: 0.8, width: 0.1, height: 0.1 }] },
  ];

  it('前插文字: 后续实体平移，纯视觉记录不变', () => {
    const prev = '张三的联系电话是13912345678';
    const next = '【注】张三的联系电话是13912345678';
    const result = remapRedactions(baseRedactions, prev, next);
    const r1 = result.find(r => r.id === 'red_1');
    const r2 = result.find(r => r.id === 'red_2');
    // red_0 "张三" 与变更区 [0,3) 相交 → cancelled/remapped/needs_reselect
    // red_1 在后面，应该平移 +3
    expect(r1.textAnchor.start).toBe(8 + 3);
    expect(r1.textAnchor.end).toBe(19 + 3);
    expect(r1.status).toBe('active');
    // red_2 纯视觉，不变
    expect(r2).toEqual(baseRedactions[2]);
  });

  it('修改实体内部: 该实体取消，其余保留', () => {
    const prev = '张三的联系电话是13912345678';
    const next = '张四的联系电话是13912345678';
    const result = remapRedactions(baseRedactions, prev, next);
    const r0 = result.find(r => r.id === 'red_0');
    const r1 = result.find(r => r.id === 'red_1');
    // red_0 "张三" → "张四"，区间相交
    // "张三" 在 next 中不出现 → trulyCancelled → enabled=false
    expect(r0.enabled).toBe(false);
    // red_1 不受影响
    expect(r1.textAnchor).toEqual({ start: 8, end: 19 });
    expect(r1.status).toBe('active');
  });

  it('重复文字编辑: 无法唯一定位 → needs_reselect', () => {
    // 实体 "张三" 在 [3,5)，编辑改了它的一个字 → cancelled
    // "张三" 在新文本中出现 2 次（位置 0 和 9）→ ambiguous → needs_reselect
    const prev = '张三和张三和文字张三';
    const next = '张三和张X和文字张三';
    const redactions = [
      { id: 'red_0', enabled: true, status: 'active', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: { start: 0, end: 2 }, pageRegions: [] },
      { id: 'red_1', enabled: true, status: 'active', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: { start: 3, end: 5 }, pageRegions: [] },
    ];
    const result = remapRedactions(redactions, prev, next);
    const reselectCount = result.filter(r => r.status === 'needs_reselect').length;
    expect(reselectCount).toBeGreaterThanOrEqual(1);
  });

  it('文本不变: redactions 原样返回', () => {
    const result = remapRedactions(baseRedactions, 'abc', 'abc');
    expect(result).toBe(baseRedactions);
  });

  it('pageRegions 在编辑后保留不变', () => {
    const prev = '张三的联系电话是13912345678';
    const next = '【注】张三的联系电话是13912345678';
    const result = remapRedactions(baseRedactions, prev, next);
    const r0 = result.find(r => r.id === 'red_0');
    expect(r0.pageRegions).toEqual(baseRedactions[0].pageRegions);
  });
});

// ─── 5. 操作辅助 ─────────────────────────────────────────────

describe('操作辅助', () => {
  const base = [
    { id: 'red_0', enabled: true, status: 'active', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: { start: 0, end: 2 }, pageRegions: [] },
  ];

  it('addRedaction: 生成递增 ID', () => {
    const result = addRedaction(base, { entityType: 'PHONE', original: '123', textAnchor: { start: 5, end: 8 } });
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('red_1');
    expect(result[1].enabled).toBe(true);
  });

  it('cancelRedaction: enabled→false', () => {
    const result = cancelRedaction(base, 'red_0');
    expect(result[0].enabled).toBe(false);
  });

  it('resolveRedaction: needs_reselect→active + 更新 textAnchor', () => {
    const pending = [{ id: 'red_0', enabled: true, status: 'needs_reselect', entityType: 'PERSON', original: '张三', source: 'regex', textAnchor: null, pageRegions: [] }];
    const result = resolveRedaction(pending, 'red_0', { start: 10, end: 12 }, '张三');
    expect(result[0].status).toBe('active');
    expect(result[0].textAnchor).toEqual({ start: 10, end: 12 });
  });

  it('updateRedaction: 只改 patch 字段', () => {
    const result = updateRedaction(base, 'red_0', { pageRegions: [{ id: 'reg_0', page: 1, x: 0.2, y: 0.3, width: 0.1, height: 0.02 }] });
    expect(result[0].pageRegions).toHaveLength(1);
    expect(result[0].entityType).toBe('PERSON');  // 未改字段保留
  });
});

// ─── 6. 校验器 ───────────────────────────────────────────────

describe('validateRedaction', () => {
  const valid = {
    id: 'red_0', enabled: true, status: 'active', entityType: 'PERSON',
    original: '张三', source: 'regex', textAnchor: { start: 0, end: 2 },
    pageRegions: [{ id: 'reg_0', page: 1, x: 0.1, y: 0.2, width: 0.05, height: 0.01 }],
  };

  it('合法 redaction 通过校验', () => {
    const { valid: ok, errors } = validateRedaction(valid);
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('缺少 id 报错', () => {
    const { valid: ok, errors } = validateRedaction({ ...valid, id: '' });
    expect(ok).toBe(false);
    expect(errors.join()).toContain('id');
  });

  it('pageRegions 越界报错', () => {
    const { valid: ok, errors } = validateRedaction({ ...valid, pageRegions: [{ id: 'r', page: 1, x: 0.9, y: 0, width: 0.5, height: 0.1 }] });
    expect(ok).toBe(false);
    expect(errors.join()).toContain('bounds');
  });

  it('status 非法值报错', () => {
    const { valid: ok, errors } = validateRedaction({ ...valid, status: 'deleted' });
    expect(ok).toBe(false);
    expect(errors.join()).toContain('status');
  });
});
