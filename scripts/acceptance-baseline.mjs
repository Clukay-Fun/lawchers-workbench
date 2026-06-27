// acceptance-baseline.mjs — 只读验收基线 harness
// 驱动真实后端 API，逐份 PDF 跑完整链路（上传→analyze→page-image→mask-export），
// 只落【匿名元数据】到仓库外目录，绝不记录文件名/正文。验收材料不入库。
//
// 前置：
//   1) 后端已启动（建议: PORT=3001 NODE_ENV=production REDACT_TIMEOUT_MS=600000 \
//        LEGAL_DESENS_MODEL_DIR=~/.legal-desens/models/roberta-crf-ner node backend/src/index.js）
//   2) .venv 可用（用于数 PDF 页数）
//
// 用法：
//   node scripts/acceptance-baseline.mjs "<输入PDF目录>" [输出目录] [API_BASE]
//   默认输出: ~/lawchers-acceptance-out   默认 API: http://localhost:3001/api
import { readdir, readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENV_PY = path.join(REPO_ROOT, '.venv', 'bin', 'python3');

const INPUT_DIR = process.argv[2];
const OUT_DIR = process.argv[3] || path.join(os.homedir(), 'lawchers-acceptance-out');
const API = process.argv[4] || 'http://localhost:3001/api';

if (!INPUT_DIR) {
  console.error('用法: node scripts/acceptance-baseline.mjs "<输入PDF目录>" [输出目录] [API_BASE]');
  process.exit(2);
}

const now = () => Date.now();
async function pdfPageCount(file) {
  try {
    const { stdout } = await execFileP(VENV_PY, ['-c', 'import fitz,sys;print(len(fitz.open(sys.argv[1])))', file]);
    return parseInt(stdout.trim(), 10);
  } catch { return null; }
}

async function uploadFile(file) {
  const buf = await readFile(file);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), path.basename(file));
  const r = await fetch(`${API}/tasks`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.success, status: r.status, data: j.data, msg: j.message };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const all = (await readdir(INPUT_DIR)).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  if (all.length === 0) { console.error('目录下没有 PDF'); process.exit(2); }
  const report = [];
  let idx = 0;
  for (const fname of all) {
    idx++;
    const docId = `DOC-${String(idx).padStart(2, '0')}`;
    const fpath = path.join(INPUT_DIR, fname);
    const sizeMB = +((await stat(fpath)).size / 1048576).toFixed(2);
    const srcPages = await pdfPageCount(fpath);
    const rec = { docId, sizeMB, srcPages, stages: {} };
    console.log(`\n[${docId}] size=${sizeMB}MB srcPages=${srcPages} — uploading...`);
    try {
      let t = now();
      const up = await uploadFile(fpath);
      rec.stages.upload = { ok: up.ok, ms: now() - t, status: up.status };
      if (!up.ok) { rec.error = `upload: ${up.msg}`; report.push(rec); await writeFile(path.join(OUT_DIR, `${docId}.json`), JSON.stringify(rec, null, 2)); continue; }
      const taskId = up.data.taskId;
      rec.documentKind = up.data.documentKind;
      rec.candidateCount = up.data.candidateCount;

      t = now();
      const ar = await fetch(`${API}/tasks/${taskId}/analyze`, { method: 'POST' });
      const aj = await ar.json().catch(() => ({}));
      rec.stages.analyze = { ok: ar.ok && aj.success, ms: now() - t, status: ar.status };
      if (!(ar.ok && aj.success)) { rec.error = `analyze: ${aj.message}`; report.push(rec); await writeFile(path.join(OUT_DIR, `${docId}.json`), JSON.stringify(rec, null, 2)); console.log('  analyze FAIL', aj.message); continue; }
      const d = aj.data;
      const pages = d.manifest?.pages || [];
      const diag = d.diagnostics || {};
      const entityTypes = {};
      for (const e of (d.textEntities || [])) { const k = e.entity_type || '?'; entityTypes[k] = (entityTypes[k] || 0) + 1; }
      rec.renderPages = pages.length;
      rec.diagnostics = { ocrLines: diag.ocrLines, regexHits: diag.regexHits, nerHits: diag.nerHits, sealHits: diag.sealHits, filteredOut: diag.filteredOut, nerEnabled: diag.nerEnabled };
      rec.entityTypes = entityTypes;
      rec.refinedBoxes = (d.refinedBoxes || []).length;
      rec.sealBoxes = (d.sealBoxes || []).length;

      let okPages = 0, failPages = 0;
      for (let p = 1; p <= pages.length; p++) {
        try { const pr = await fetch(`${API}/tasks/${taskId}/page-image/${p}`); if (pr.ok) { okPages++; await pr.arrayBuffer(); } else failPages++; }
        catch { failPages++; }
      }
      rec.pageImages = { ok: okPages, fail: failPages };

      const boxes = [...(d.refinedBoxes || []), ...(d.sealBoxes || [])];
      rec.autoBoxes = boxes.length;
      if (boxes.length === 0) {
        rec.stages.maskExport = { ok: false, skipped: 'no-boxes' };
      } else {
        t = now();
        const er = await fetch(`${API}/tasks/${taskId}/mask-export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boxes }) });
        // mask-export 成功返回 PDF 文件(res.download)；失败返回 409/500 JSON。status 200 ⇒ 残留审计通过+产物生成。
        rec.stages.maskExport = { ok: er.status === 200, ms: now() - t, status: er.status };
        if (er.status === 200) {
          const ab = Buffer.from(await er.arrayBuffer());
          const tmp = path.join(OUT_DIR, `${docId}.masked.tmp.pdf`);
          await writeFile(tmp, ab);
          rec.exportPages = await pdfPageCount(tmp);
          rec.exportSizeMB = +(ab.length / 1048576).toFixed(2);
          rec.pagesPreserved = rec.exportPages === rec.renderPages;
          await rm(tmp, { force: true });
        } else {
          const ej = await er.json().catch(() => ({}));
          rec.stages.maskExport.msg = ej.message;
        }
      }
      console.log(`  kind=${rec.documentKind} pages=${rec.renderPages}/${srcPages} ocr=${diag.ocrLines} ner=${diag.nerHits} seal=${diag.sealHits} imgFail=${failPages} export=${rec.stages.maskExport?.ok} preserved=${rec.pagesPreserved}`);
    } catch (e) {
      rec.error = `exception: ${e.message}`;
      console.log('  EXCEPTION', e.message);
    }
    report.push(rec);
    await writeFile(path.join(OUT_DIR, `${docId}.json`), JSON.stringify(rec, null, 2));
  }
  await writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(`\n=== DONE. ${report.length} docs. report → ${OUT_DIR}/summary.json ===`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
