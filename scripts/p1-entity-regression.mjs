// p1-entity-regression.mjs — P1 不可变 ID + 编辑持久化 + 导出闭环回归测试
// 驱动真实后端 API，验证：
// - 实体 ID 不可变（非位置依赖）
// - 编辑文本持久化与恢复
// - 导出使用编辑后文本（star + placeholder）
// - map.json 的 source_sha256 / redacted_sha256 与实际数据匹配
// - 占位还原可逆
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

async function patchEditedTextRaw(text, textEntities) {
  const r = await fetch(`${API}/tasks/${taskId}/edited-text`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, textEntities }),
  });
  const j = await r.json();
  return { status: r.status, ...j };
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

async function downloadMap() {
  const r = await fetch(`${API}/history/${taskId}/download-map`);
  return r;
}

async function restore(redactedBlob, redactedName, mapBlob, mapName) {
  const fd = new FormData();
  fd.append('redactedFile', redactedBlob, redactedName);
  fd.append('mapFile', mapBlob, mapName);
  const r = await fetch(`${API}/restore`, { method: 'POST', body: fd });
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
  const ocrText = analyzeData.ocrText || session1.ocrText || '';
  if (ocrText && entities.length > 0) {
    // Prepend a char so shifting start/end by 1 keeps original matching text.slice
    const prefixedText = ' ' + ocrText;
    const shiftedEntities = entities.map(e => ({ ...e, start: e.start + 1, end: e.end + 1 }));
    await patchEditedText(prefixedText, shiftedEntities);
    const session2 = await getSession();
    assert(session2.textEntities[0]?.start === shiftedEntities[0]?.start, `实体 offset 已持久化`);
    // Restore original
    await patchEditedText(ocrText, entities);
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
    await patchEditedText(ocrText, entities); // restore
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
  if (ocrText && entities.length > 0) {
    const firstEnt = entities[0];

    // 7a: 原文 + 实体 → 输出不应含实体原文（引擎已掩码）
    const r1 = await textExport(entities, 'star', 'txt', ocrText);
    const buf1 = Buffer.from(await r1.arrayBuffer());
    const content1 = buf1.toString('utf-8');
    assert(r1.status === 200, `star 导出状态码 200 (got ${r1.status})`);
    assert(!content1.includes(firstEnt.original), `实体 "${firstEnt.original.slice(0, 10)}" 已不在导出文本中`);

    // 验证实体位置已发生替换: 该位置的原文不应保持
    const entSlice = content1.slice(firstEnt.start, firstEnt.end);
    assert(entSlice !== firstEnt.original, `实体位置 ${firstEnt.start}-${firstEnt.end} 的内容已替换 (非原文)`);
    assert(entSlice.length > 0, `实体位置非空`);

    // 7b: 注入标记证明引擎消费了发送的 text 参数
    const marker = '[[MARKER]]';
    const modifiedText = marker + ocrText;
    const shiftedEntities = entities.map(e => ({
      ...e, start: e.start + marker.length, end: e.end + marker.length,
    }));
    const r2 = await textExport(shiftedEntities, 'star', 'txt', modifiedText);
    const buf2 = Buffer.from(await r2.arrayBuffer());
    const content2 = buf2.toString('utf-8');
    assert(content2.startsWith(marker), `导出文本以 "${marker}" 开头，证明引擎使用发送的 text`);
    assert(!content2.includes(firstEnt.original), `调整位置后实体原文仍不在导出中`);

    // 7c: 合成手机号实体验证 PHONE 类型预期模式
    const fakePhone = '13812348000';
    const fakeText = ocrText + fakePhone;
    const fakeEntities = [{
      start: ocrText.length,
      end: ocrText.length + fakePhone.length,
      original: fakePhone,
      entity_type: 'PHONE',
      id: 'ent_9999',
    }];
    const r3 = await textExport(fakeEntities, 'star', 'txt', fakeText);
    const buf3 = Buffer.from(await r3.arrayBuffer());
    const content3 = buf3.toString('utf-8');
    assert(r3.status === 200, `合成手机号 star 导出 200`);
    assert(!content3.includes(fakePhone), `合成手机号原文不存在`);
    const phoneSlice = content3.slice(fakeEntities[0].start, fakeEntities[0].end);
    assert(phoneSlice === '138****8000', `手机号被掩码为 138****8000 (got "${phoneSlice}")`);
  } else {
    console.log('  ⚠ 无文本或实体，跳过 text-export 测试');
  }

  // ── 8. 验证 edited-text 实体校验 ──
  console.log('\n8. 验证 edited-text 实体边界与 original 校验');
  const badBodyCases = [
    { text: 'hello', textEntities: [{ start: -1, end: 5, id: 'e1', original: 'hello' }], desc: '负 start' },
    { text: 'hello', textEntities: [{ start: 5, end: 3, id: 'e1', original: '' }], desc: 'end <= start' },
    { text: 'hi', textEntities: [{ start: 0, end: 999, id: 'e1', original: 'hi' }], desc: 'end 超出文本长度' },
    { text: 'hello world', textEntities: [{ start: 0, end: 5, id: 'e1', original: 'hello' }, { start: 10, end: 15, id: 'e1', original: 'world' }], desc: '重复 id' },
    { text: 'hello', textEntities: [{ start: 0, end: 5, id: 'e1', original: 'wrong' }], desc: 'original 与文本不匹配' },
    { text: 'hello', textEntities: [{ start: 0, end: 3, id: 'e1' }], desc: '缺少 original 字段' },
  ];
  for (const { text, textEntities: badEntities, desc } of badBodyCases) {
    const res = await patchEditedTextRaw(text, badEntities);
    assert(res.status === 400, `${desc} → 返回 400 (got ${res.status})`);
  }

  // ── 9. 验证 text-export placeholder 模式 map.json hash + restore ──
  console.log('\n9. 验证 text-export placeholder 模式 map.json hash 与 restore');
  if (ocrText && entities.length > 0) {
    // 9a: 占位导出
    const r1 = await textExport(entities, 'placeholder', 'txt', ocrText);
    const buf1 = Buffer.from(await r1.arrayBuffer());
    const redactedContent = buf1.toString('utf-8');
    assert(r1.status === 200, `placeholder 导出状态码 200 (got ${r1.status})`);
    assert(redactedContent.length > 0, `导出内容非空`);

    // 9b: 下载 map.json 并验证哈希
    const r2 = await downloadMap();
    assert(r2.status === 200, `map.json 下载 200 (got ${r2.status})`);
    const mapBuf = Buffer.from(await r2.arrayBuffer());
    let mapData;
    try {
      mapData = JSON.parse(mapBuf.toString('utf-8'));
    } catch {
      assert(false, `map.json 可解析为 JSON`);
      mapData = {};
    }

    const expectedSourceSha = createHash('sha256').update(ocrText).digest('hex');
    const expectedRedactedSha = createHash('sha256').update(redactedContent).digest('hex');
    assert(mapData.source_sha256 === expectedSourceSha, `source_sha256 匹配 (${mapData.source_sha256} === ${expectedSourceSha})`);
    assert(mapData.redacted_sha256 === expectedRedactedSha, `redacted_sha256 匹配 (${mapData.redacted_sha256} === ${expectedRedactedSha})`);

    // 9c: 用 map + 脱敏文件执行 restore
    const contentDisp = r1.headers.get('content-disposition') || 'document.txt';
    const redactedFilename = contentDisp.includes('filename=')
      ? contentDisp.split('filename=').pop().split(';')[0].replace(/["']/g, '').trim()
      : 'redacted.txt';
    const r3 = await restore(
      new Blob([buf1], { type: 'text/plain' }), redactedFilename,
      new Blob([mapBuf], { type: 'application/json' }), 'map.json',
    );
    assert(r3.status === 200, `restore 状态码 200 (got ${r3.status})`);
    const restoredBuf = Buffer.from(await r3.arrayBuffer());
    const restoredContent = restoredBuf.toString('utf-8');
    assert(restoredContent === ocrText, `restore 文本与编辑文本一致 (长度 ${restoredContent.length} === ${ocrText.length})`);
  } else {
    console.log('  ⚠ 无文本或实体，跳过 map/restore 测试');
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
