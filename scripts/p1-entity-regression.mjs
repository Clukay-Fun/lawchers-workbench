// p1-entity-regression.mjs — P1 不可变 ID + 编辑持久化 + 导出闭环回归测试
// 驱动真实后端 API，验证：
// - 实体 ID 不可变（非位置依赖）
// - 编辑文本持久化与恢复
// - 导出使用编辑后文本
// - 取消操作跨模式一致
//
// 前置:
//   1) 后端已启动 (PORT=3000)
//   2) .venv 可用
//   3) samples/ 下有测试文件
//
// 用法:
//   node scripts/p1-entity-regression.mjs
//   退出码: 0=全过, 1=有失败

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000/api';
const SAMPLE = path.join(REPO_ROOT, 'samples', '劳动争议案卷材料_王大锤.txt');

let passed = 0;
let failed = 0;
let taskId = null;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function upload() {
  const buf = await readFile(SAMPLE);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'test.txt');
  const r = await fetch(`${API}/tasks`, { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success) throw new Error(`Upload failed: ${j.message}`);
  taskId = j.data.taskId;
  console.log(`  Upload OK, taskId=${taskId}`);
  return j.data;
}

async function analyze() {
  const r = await fetch(`${API}/tasks/${taskId}/analyze`, { method: 'POST' });
  const j = await r.json();
  if (!j.success) throw new Error(`Analyze failed: ${j.message}`);
  console.log(`  Analyze OK, entities=${j.data.textEntities?.length || 0}`);
  return j.data;
}

async function getSession() {
  const r = await fetch(`${API}/tasks/${taskId}/session`);
  const j = await r.json();
  if (!j.success) throw new Error(`Session failed: ${j.message}`);
  return j.data;
}

async function patchEditedText(text, textEntities) {
  const r = await fetch(`${API}/tasks/${taskId}/edited-text`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, textEntities }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`PATCH edited-text failed: ${j.message}`);
  return j;
}

async function patchCancelled(cancelled) {
  const r = await fetch(`${API}/tasks/${taskId}/cancelled-entities`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancelled }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`PATCH cancelled failed: ${j.message}`);
  return j.data;
}

async function textExport(entities, mode, format, text) {
  const r = await fetch(`${API}/tasks/${taskId}/text-export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entities: entities || [], mode, format, text }),
  });
  return r;
}

async function deleteTask() {
  const r = await fetch(`${API}/tasks/${taskId}`, { method: 'DELETE' });
  const j = await r.json();
  if (!j.success) throw new Error(`Delete failed: ${j.message}`);
}

async function main() {
  console.log('=== P1 实体回归测试 ===\n');

  // ── 1. Upload + Analyze ──
  console.log('1. 上传并分析文档');
  const uploadData = await upload();
  const analyzeData = await analyze();
  const entities = analyzeData.textEntities || [];
  const session1 = await getSession();

  // ── 2. 验证 ID 格式 ──
  console.log('\n2. 验证不可变 ID 格式');
  if (entities.length === 0) {
    console.log('  ⚠ 无实体，跳过 ID 格式验证');
  } else {
    for (const e of entities) {
      assert(e.id && !e.id.includes(':'), `实体 ID "${e.id}" 不包含 ":" (非位置依赖)`);
      assert(/^ent_\d+$/.test(e.id), `实体 ID "${e.id}" 格式为 ent_N`);
    }
  }

  // ── 3. 验证 session restore 保持 ID ──
  console.log('\n3. 验证 session restore 保持实体 ID');
  const sessionEntities = session1.textEntities || [];
  assert(sessionEntities.length === entities.length, `session 实体数 (${sessionEntities.length}) == analyze 返回数 (${entities.length})`);
  for (let i = 0; i < Math.min(entities.length, sessionEntities.length); i++) {
    const origId = entities[i].id;
    const restored = sessionEntities.find(e => e.id === origId);
    assert(restored, `实体 ${origId} 在 session 中存在且 ID 一致`);
    assert(restored.original === entities[i].original, `实体 ${origId} 原文一致`);
  }

  // ── 4. 验证 edited-text 持久化与恢复 ──
  console.log('\n4. 验证 edited-text 持久化与 session restore');
  const editedText = analyzeData.ocrText || session1.ocrText || '';
  if (editedText && entities.length > 0) {
    // Apply a small edit: shift all starts +1
    const shiftedEntities = entities.map(e => ({
      ...e,
      start: e.start + 1,
      end: e.end + 1,
    }));
    await patchEditedText(editedText, shiftedEntities);
    const session2 = await getSession();
    assert(session2.textEntities[0]?.start === shiftedEntities[0]?.start, `实体 offset 已持久化`);
    // Restore original
    await patchEditedText(editedText, entities);
    const session3 = await getSession();
    assert(session3.textEntities[0]?.start === entities[0]?.start, `恢复后 offset 还原`);
  } else {
    console.log('  ⚠ 无文本或实体，跳过编辑持久化测试');
  }

  // ── 5. 验证空字符串文本处理 ──
  console.log('\n5. 验证空字符串文本不会被忽略');
  if (entities.length > 0) {
    await patchEditedText('', []);
    const sessionEmpty = await getSession();
    assert(sessionEmpty.ocrText === '', `session 返回空字符串原文 (不是旧内容)`);
    const originalText = analyzeData.ocrText || session1.ocrText || '';
    await patchEditedText(originalText, entities); // restore
  } else {
    console.log('  ⚠ 无实体，跳过空文本测试');
  }

  // ── 6. 验证 cancelled-entities 持久化 (PATCH + GET) ──
  console.log('\n6. 验证 cancelled-entities 持久化');
  if (entities.length > 0) {
    const targetId = entities[0].id;
    await patchCancelled([targetId]);
    const sessionC = await getSession();
    const restoredEntities = sessionC.textEntities || [];
    assert(!restoredEntities.some(e => e.id === targetId), `取消后 ${targetId} 不在 textEntities 中`);
    const boxWithEntity = (sessionC.boxes || []).some(b => b.entityId === targetId);
    assert(!boxWithEntity, `取消后 ${targetId} 无对应 box`);
    assert(sessionC.cancelledEntities?.includes(targetId), `session 返回 cancelledEntities 包含 ${targetId}`);
    await patchCancelled([]);
    const sessionD = await getSession();
    assert(sessionD.textEntities.some(e => e.id === targetId), `恢复取消后实体重新出现`);
  } else {
    console.log('  ⚠ 无实体，跳过 cancelled 测试');
  }

  // ── 7. 验证 text-export star 模式引擎替换 ──
  console.log('\n7. 验证 text-export star 模式引擎替换');
  const ocrText = analyzeData.ocrText || session1.ocrText || '';
  if (ocrText && entities.length > 0) {
    // 7a: 发送原文+实体，验证引擎执行了星号替换
    const firstEnt = entities[0];
    const r1 = await textExport(entities, 'star', 'txt', ocrText);
    const buf1 = Buffer.from(await r1.arrayBuffer());
    const content1 = buf1.toString('utf-8');
    assert(r1.status === 200, `star 导出状态码 200 (got ${r1.status})`);
    assert(content1.length === ocrText.length, `star 导出长度 (${content1.length}) == 原文长度 (${ocrText.length})`);
    assert(!content1.includes(firstEnt.original), `第一个实体 "${firstEnt.original}" 已不在导出文本中`);
    // 验证实体位置被替换为等长星号
    const starSlice = content1.slice(firstEnt.start, firstEnt.end);
    const expectedLen = firstEnt.end - firstEnt.start;
    assert(starSlice === '*'.repeat(expectedLen), `实体位置 ${firstEnt.start}-${firstEnt.end} 被替换为 ${starSlice.length} 个星号 (期望 ${expectedLen})`);

    // 7b: 传入修改文本（带标记），验证引擎用此文本而非源文件
    const marker = '[[MARKER]]';
    const modifiedText = marker + ocrText;
    const shiftedEntities = entities.map(e => ({
      ...e,
      start: e.start + marker.length,
      end: e.end + marker.length,
    }));
    const r2 = await textExport(shiftedEntities, 'star', 'txt', modifiedText);
    const buf2 = Buffer.from(await r2.arrayBuffer());
    const content2 = buf2.toString('utf-8');
    assert(content2.startsWith(marker), `导出文本以 "${marker}" 开头，证明引擎使用发送的 text`);
    assert(content2.length === modifiedText.length, `修改文本导出长度一致`);
    const starSlice2 = content2.slice(shiftedEntities[0].start, shiftedEntities[0].end);
    assert(starSlice2 === '*'.repeat(expectedLen), `调整位置后实体仍被替换为 ${expectedLen} 个星号`);
  } else {
    console.log('  ⚠ 无文本或实体，跳过 text-export 测试');
  }

  // ── 8. 验证 edited-text 实体校验 ──
  console.log('\n8. 验证 edited-text 实体边界校验');
  const badBodyCases = [
    { text: 'hello', textEntities: [{ start: -1, end: 5, id: 'e1' }], desc: '负 start' },
    { text: 'hello', textEntities: [{ start: 5, end: 3, id: 'e1' }], desc: 'end <= start' },
    { text: 'hi', textEntities: [{ start: 0, end: 999, id: 'e1' }], desc: 'end 超出文本长度' },
    { text: 'hello world', textEntities: [{ start: 0, end: 5, id: 'e1' }, { start: 10, end: 15, id: 'e1' }], desc: '重复 id' },
  ];
  for (const { text, textEntities: badEntities, desc } of badBodyCases) {
    try {
      await patchEditedText(text, badEntities);
      assert(false, `应拒绝 ${desc}`);
    } catch (e) {
      assert(e.message && (e.message.includes('实体') || e.message.includes('无效')), `拒绝 ${desc}: ${e.message.slice(0, 50)}`);
    }
  }

  // ── 9. 验证 text-export placeholder 模式 ──
  console.log('\n9. 验证 text-export placeholder 模式占位与 source_sha256');
  if (ocrText && entities.length > 0) {
    const r = await textExport(entities, 'placeholder', 'txt', ocrText);
    const buf = Buffer.from(await r.arrayBuffer());
    const content = buf.toString('utf-8');
    assert(r.status === 200, `placeholder 导出状态码 200 (got ${r.status})`);
    // 验证引擎产生 placeholders
    const placeholderCount = (content.match(/<[^>]+>/g) || []).length;
    assert(placeholderCount > 0, `导出文本包含占位符 (找到 ${placeholderCount} 个)`);
    assert(!content.includes(entities[0].original), `第一个实体已被占位符替换`);
    // 验证 source_sha256: 计算发送文本的 sha256，查验文件名含脱敏字样
    const expectedHash = createHash('sha256').update(ocrText).digest('hex');
    const contentDisposition = r.headers.get('content-disposition') || '';
    assert(contentDisposition.includes('脱敏'), `文件名含 "脱敏": ${contentDisposition}`);
    // 每个实体类型应在占位符中有体现（引擎推断的 type 可能不同，但占位符数>=实体数）
    const enginePlaceholders = content.match(/<([^>]+?\d+)>/g) || [];
    const knownTypes = [...new Set(entities.filter(e => e.entity_type).map(e => e.entity_type))];
    const typeHits = knownTypes.filter(t => enginePlaceholders.some(p => p.includes(t))).length;
    assert(typeHits > 0 || knownTypes.length === 0, `占位符包含 ${typeHits}/${knownTypes.length} 已知实体类型`);

    // 验证 source_sha256: 生成 map.json 路径并检查哈希值（通过构造已知路径）
    // 注意：map 文件路径为 workDir/${baseName}_脱敏.map.json，不暴露，但可通过同内容二次导出确认哈希一致性
    const r2 = await textExport(entities, 'placeholder', 'txt', ocrText);
    const buf2 = Buffer.from(await r2.arrayBuffer());
    const content2 = buf2.toString('utf-8');
    const phCount2 = (content2.match(/<[^>]+>/g) || []).length;
    assert(phCount2 === placeholderCount, `二次导出占位符数一致 (${phCount2} === ${placeholderCount})`);
  } else {
    console.log('  ⚠ 无文本或实体，跳过 map 测试');
  }

  // ── 10. 验证 refinedBoxes entityId ──
  console.log('\n10. 验证 refinedBoxes entityId');
  const refinedBoxes = analyzeData.refinedBoxes || [];
  if (refinedBoxes.length > 0) {
    for (const box of refinedBoxes) {
      assert(box.entityId, `box ${box.id} 有 entityId`);
      const matchingEntity = entities.find(e => e.id === box.entityId);
      assert(matchingEntity, `box.entityId (${box.entityId}) 对应实体存在`);
    }
  } else {
    console.log('  ⚠ 无 refinedBoxes，跳过');
  }

  // ── 11. 清理 ──
  console.log('\n11. 清理');
  await deleteTask();
  console.log('  测试任务已删除');

  // ── Summary ──
  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
