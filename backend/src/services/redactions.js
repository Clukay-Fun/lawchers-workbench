/**
 * Redactions 转换器（后端版）
 * 从旧格式 (textEntities + boxes + cancelled + pendingReselect)
 * 确定性转换为 redactions 数组。
 *
 * 与前端 services/redactions.js 的 convertToRedactions 保持同步。
 */

export function convertToRedactions(textEntities = [], boxes = [], cancelled = [], pendingReselect = []) {
  const cancelledSet = cancelled instanceof Set ? cancelled : new Set(cancelled);
  const redactions = [];
  let counter = 0;

  const findBoxesForEntity = (entityId) => boxes.filter(b => {
    const linked = b.entityIds?.length ? b.entityIds : [b.entityId].filter(Boolean);
    return linked.includes(entityId);
  });

  for (const ent of textEntities) {
    const rid = `red_${counter++}`;
    const matchingBoxes = findBoxesForEntity(ent.id);
    const pageRegions = matchingBoxes.map(b => ({
      id: `reg_${b.id || rid}`,
      page: b.page || 1,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }));
    const source = ent.source || (ent.id?.startsWith('manual_') || ent.id?.startsWith('bbox_') ? 'manual' : 'regex');
    redactions.push({
      id: rid,
      enabled: !cancelledSet.has(ent.id),
      status: 'active',
      entityType: ent.entity_type || 'CUSTOM',
      original: ent.original || '',
      source,
      textAnchor: { start: ent.start, end: ent.end },
      pageRegions,
      _legacyId: ent.id,
    });
  }

  for (const p of pendingReselect) {
    const rid = `red_${counter++}`;
    const matchingBoxes = findBoxesForEntity(p.id);
    const pageRegions = matchingBoxes.map(b => ({
      id: `reg_${b.id || rid}`,
      page: b.page || 1,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }));
    redactions.push({
      id: rid,
      enabled: true,
      status: 'needs_reselect',
      entityType: p.entity_type || 'CUSTOM',
      original: p.original || '',
      source: 'regex',
      textAnchor: null,
      pageRegions,
      _legacyId: p.id,
    });
  }

  const entityIdsLinked = new Set();
  for (const ent of textEntities) entityIdsLinked.add(ent.id);
  for (const p of pendingReselect) entityIdsLinked.add(p.id);

  for (const b of boxes) {
    const linked = b.entityIds?.length ? b.entityIds : [b.entityId].filter(Boolean);
    const hasEntity = linked.some(id => entityIdsLinked.has(id));
    if (!hasEntity) {
      const rid = `red_${counter++}`;
      redactions.push({
        id: rid,
        enabled: !cancelledSet.has(b.entityId),
        status: 'active',
        entityType: b.entityType || (b.source === 'seal' ? 'SEAL' : 'CUSTOM'),
        original: b.text || b.original || '',
        source: b.source === 'seal' ? 'seal' : 'manual',
        textAnchor: null,
        pageRegions: [{
          id: `reg_${b.id || rid}`,
          page: b.page || 1,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        }],
        _legacyId: b.id,
      });
    }
  }

  return redactions;
}
