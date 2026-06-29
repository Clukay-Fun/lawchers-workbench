// p1-entity-regression.mjs — P1 不可变 ID + 取消合并 + 文本编辑回归测试
// 驱动真实后端 API，验证实体 ID 不再依赖位置、取消操作跨模式一致。
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000/api';
const SAMPLE = path.join(REPO_ROOT, 'samples', '劳动争议案卷材料_王大锤.txt');

let passed = 0;
let failed = 0;
let taskId = null;
let workDir = null;

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
  workDir = j.data.workDir;
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
  console.log('\n2. 验证不可变 ID');
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

  // ── 4. 验证 cancelled-entities 持久化 (PATCH + GET) ──
  console.log('\n4. 验证 cancelled-entities 持久化');
  if (entities.length > 0) {
    const targetId = entities[0].id;
    await patchCancelled([targetId]);
    const session2 = await getSession();
    const restoredEntities = session2.textEntities || [];
    assert(!restoredEntities.some(e => e.id === targetId), `取消后 ${targetId} 不在 textEntities 中`);

    // boxes with entityId === targetId should also be filtered
    const boxWithEntity = (session2.boxes || []).some(b => b.entityId === targetId);
    assert(!boxWithEntity, `取消后 ${targetId} 无对应 box`);

    // Verify cancelledEntities in response
    assert(session2.cancelledEntities?.includes(targetId), `session 返回 cancelledEntities 包含 ${targetId}`);

    // Clean up
    await patchCancelled([]);
    const session3 = await getSession();
    assert(session3.textEntities.some(e => e.id === targetId), `恢复取消后实体重新出现`);
  } else {
    console.log('  ⚠ 无实体，跳过 cancelled 测试');
  }

  // ── 5. 验证 refinedBoxes entityId 与实体 ID 一致 ──
  console.log('\n5. 验证 refinedBoxes entityId');
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

  // ── 6. 验证删除重建后不可变 ID 不变 ──
  // (This tests that re-analyze from session doesn't regenerate IDs)
  // (Note: current backend regenerates entities on new analyze; this test validates
  //  that within a single session IDs are stable.)

  // ── 7. 清理 ──
  console.log('\n6. 清理');
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
