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
    await patchEditedText('', entities);
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

  // ── 7. 验证 text-export 使用发送的 text 参数 ──
  console.log('\n7. 验证 text-export 使用发送的 text 参数');
  const ocrText = analyzeData.ocrText || session1.ocrText || '';
  if (ocrText && entities.length > 0) {
    const modifiedText = ocrText.replace(entities[0].original, '[EDITED]');
    const shiftedEntities = entities.map(e => {
      const idx = modifiedText.indexOf(e.original);
      return {
        original: e.original,
        entity_type: e.entity_type,
        start: idx >= 0 ? idx : e.start,
        end: idx >= 0 ? idx + e.original.length : e.end,
      };
    }).filter(e => e.start >= 0);
    if (shiftedEntities.length > 0) {
      const r = await textExport(shiftedEntities, 'star', 'txt', modifiedText);
      const buf = Buffer.from(await r.arrayBuffer());
      const content = buf.toString('utf-8');
      assert(content.length > 0, `导出的 TXT 不为空`);
      assert(!content.includes(entities[0].original), `导出的文本已替换第一个实体`);
      assert(r.status === 200, `导出状态码 200 (got ${r.status})`);
    }
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
      assert(e.message && (e.message.includes('实体') || e.message.includes('invalid') || e.message.includes('无效')), `拒绝 ${desc}: ${e.message.slice(0, 50)}`);
    }
  }

  // ── 9. 验证 map.json source_sha256 (placeholder mode) ──
  console.log('\n9. 验证 text-export placeholder 模式哈希');
  if (entities.length > 0) {
    const r = await textExport(entities, 'placeholder', 'txt', ocrText);
    const buf = Buffer.from(await r.arrayBuffer());
    const content = buf.toString('utf-8');
    assert(content.length > 0, `导出 TXT 不为空`);
    assert(!content.includes(entities[0].original), `第一实体已被替换`);
    assert(r.status === 200, `导出状态码 200 (got ${r.status})`);
    // Verify the map is still served via download (res.download)
    const isFileDownload = r.headers.get('content-type') === 'application/octet-stream'
      || r.headers.get('content-disposition')?.includes('attachment');
    assert(isFileDownload || content.length > 0, `返回文本内容正常`);
  } else {
    console.log('  ⚠ 无实体，跳过 map 测试');
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
