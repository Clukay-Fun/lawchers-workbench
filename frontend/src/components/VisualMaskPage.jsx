import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { analyzeTask, updateTaskBoxes, maskExportTask, textExportTask } from '../api';
import { Button } from '@/components/ui/button';
import { normalizedToCSS, computeDisplaySize, createNormalizedBox } from '../services/coords';

// ─── Constants ───────────────────────────────────────────────

const BOX_MIN_SIZE = 0.005;
const MODES = [
  { key: 'mask', label: '遮蔽', desc: '黑色遮挡块 → PDF' },
  { key: 'star', label: '星号', desc: '部分可见 → TXT/MD/DOCX' },
  { key: 'placeholder', label: '占位', desc: '类型标签 → TXT/MD/DOCX' },
];

const MASK_FORMATS = [
  { value: 'pdf', label: '导出 PDF（遮蔽版）' },
  { value: 'docx', label: '导出 DOCX（星号）' },
  { value: 'txt', label: '导出 TXT（星号）' },
  { value: 'md', label: '导出 MD（星号）' },
];
const TEXT_FORMATS = [
  { value: 'docx', label: '导出 DOCX' },
  { value: 'txt', label: '导出 TXT' },
  { value: 'md', label: '导出 MD' },
];

// ─── Star mask (module level) ────────────────────────────────

function starMask(text, entityType) {
  if (!text) return '';
  const chars = [...text];
  const len = chars.length;
  if (entityType === 'PHONE') return len >= 11 ? chars.slice(0, 3).join('') + '****' + chars.slice(-4).join('') : chars[0] + '***';
  if (entityType === 'ID_CARD') return len >= 15 ? chars.slice(0, 4).join('') + '*'.repeat(len - 8) + chars.slice(-4).join('') : chars.slice(0, 3).join('') + '*'.repeat(Math.max(1, len - 6)) + chars.slice(-3).join('');
  if (entityType === 'PERSON') return chars[0] + '*'.repeat(Math.max(1, len - 1));
  if (entityType === 'ORG') return len > 4 ? chars.slice(0, 2).join('') + '*'.repeat(Math.max(2, len - 4)) + chars.slice(-2).join('') : chars[0] + '*'.repeat(Math.max(1, len - 1));
  if (entityType === 'MONEY') return '****' + (chars[len - 1] || '');
  if (entityType === 'DATE') return chars.map(c => '年月日号'.includes(c) ? c : '*').join('');
  return chars[0] + '***';
}

function placeholderMask(entityType) {
  const labels = {
    PHONE: '手机', ID_CARD: '证件号', PERSON: '姓名', ORG: '单位',
    EMAIL: '邮箱', MONEY: '金额', DATE: '日期', BANK_CARD: '银行卡',
    CASE_NO: '案号', LOC: '地址', API_TOKEN: '密钥',
  };
  return `<${labels[entityType] || entityType}>`;
}

// ─── Upload with real progress ────────────────────────────────

function uploadWithProgress(file, rulesConfig, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('rulesConfig', JSON.stringify(rulesConfig || {}));
    xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const r = JSON.parse(xhr.responseText); r.success ? resolve(r.data) : reject(new Error(r.message || '上传失败')); }
        catch { reject(new Error('解析响应失败')); }
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).message || `HTTP ${xhr.status}`)); }
        catch { reject(new Error(`HTTP ${xhr.status}`)); }
      }
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
    xhr.open('POST', '/api/tasks');
    xhr.send(formData);
  });
}

// ─── Horizontal Progress Bar ─────────────────────────────────

function ProgressBar({ percent, step }) {
  const isUpload = percent > 0 && percent < 100;
  return (
    <div className="progress-container">
      <div className="progress-bar-wrapper">
        <div
          className={`progress-bar-fill ${isUpload ? 'determinate' : 'indeterminate'}`}
          style={isUpload ? { width: `${percent}%` } : undefined}
        />
      </div>
      <div className="progress-step-text">
        {isUpload ? `上传中 ${percent}%` : step || '处理中…'}
      </div>
    </div>
  );
}

// ─── Page Image Component ────────────────────────────────────

function PageCanvas({ pageInfo, boxes, onBoxesChange, containerWidth, selectedBox, onSelectBox }) {
  const overlayRef = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [hoveredBox, setHoveredBox] = useState(null);
  const { displayWidth, displayHeight } = computeDisplaySize(pageInfo, containerWidth, 900);

  const toNormalized = useCallback((e) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (e.clientX - rect.left) / displayWidth, y: (e.clientY - rect.top) / displayHeight };
  }, [displayWidth, displayHeight]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.dataset.boxId || e.target.dataset.handle) return;
    setDrawing({ startX: toNormalized(e).x, startY: toNormalized(e).y });
    onSelectBox?.(null);
  }, [toNormalized, onSelectBox]);

  const handleMouseMove = useCallback((e) => {
    if (drawing) { const p = toNormalized(e); setDrawing(prev => prev ? { ...prev, currentX: p.x, currentY: p.y } : prev); }
    if (dragging) {
      const p = toNormalized(e);
      onBoxesChange(prev => prev.map(b => b.id === dragging.boxId ? { ...b, x: Math.max(0, Math.min(1 - dragging.boxW, p.x - dragging.offsetX)), y: Math.max(0, Math.min(1 - dragging.boxH, p.y - dragging.offsetY)) } : b));
    }
    if (resizing) {
      const p = toNormalized(e);
      onBoxesChange(prev => prev.map(b => {
        if (b.id !== resizing.boxId) return b;
        let { x, y, width, height } = b;
        const h = resizing.handle;
        if (h.includes('e')) width = Math.max(BOX_MIN_SIZE, p.x - x);
        if (h.includes('s')) height = Math.max(BOX_MIN_SIZE, p.y - y);
        if (h.includes('w')) { const nx = Math.min(p.x, x + width - BOX_MIN_SIZE); width += x - nx; x = nx; }
        if (h.includes('n')) { const ny = Math.min(p.y, y + height - BOX_MIN_SIZE); height += y - ny; y = ny; }
        return { ...b, x: Math.max(0, x), y: Math.max(0, y), width: Math.min(1 - x, width), height: Math.min(1 - y, height) };
      }));
    }
  }, [drawing, dragging, resizing, toNormalized, onBoxesChange]);

  const handleMouseUp = useCallback((e) => {
    if (drawing) {
      const p = toNormalized(e);
      const x = Math.min(drawing.startX, p.x), y = Math.min(drawing.startY, p.y);
      const w = Math.abs(p.x - drawing.startX), h = Math.abs(p.y - drawing.startY);
      if (w > BOX_MIN_SIZE && h > BOX_MIN_SIZE) {
        onBoxesChange(prev => [...prev, createNormalizedBox({
          id: `manual_${Date.now()}`, page: pageInfo.pageNumber, x, y, width: w, height: h,
          pageWidth: pageInfo.pageWidth, pageHeight: pageInfo.pageHeight, source: 'manual',
        })]);
      }
      setDrawing(null);
    }
    setDragging(null); setResizing(null);
  }, [drawing, toNormalized, pageInfo, onBoxesChange]);

  const handleBoxMouseDown = useCallback((e, box) => { e.stopPropagation(); if (e.button !== 0) return; onSelectBox?.(box.id); const p = toNormalized(e); setDragging({ boxId: box.id, offsetX: p.x - box.x, offsetY: p.y - box.y, boxW: box.width, boxH: box.height }); }, [toNormalized, onSelectBox]);
  const handleDeleteBox = useCallback((e, boxId) => { e.stopPropagation(); onBoxesChange(prev => prev.filter(b => b.id !== boxId)); }, [onBoxesChange]);
  const handleResizeStart = useCallback((e, boxId, handle) => { e.stopPropagation(); setResizing({ boxId, handle }); }, []);

  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);

  return (
    <div className="page-canvas" style={{ position: 'relative', width: displayWidth, height: displayHeight }}>
      <img src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`} alt={`Page ${pageInfo.pageNumber}`} style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }} draggable={false} />
      <div ref={overlayRef} className="box-overlay" style={{ position: 'absolute', top: 0, left: 0, width: displayWidth, height: displayHeight, cursor: 'crosshair' }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          const isActive = hoveredBox === box.id || selectedBox === box.id;
          return (
            <div key={box.id} style={{ position: 'absolute', left: css.left, top: css.top, width: css.width, height: css.height }}>
              <div data-box-id={box.id} style={{ width: '100%', height: '100%', border: `2px solid ${isActive ? '#3b82f6' : 'rgba(59,130,246,0.6)'}`, background: isActive ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.06)', cursor: 'move', transition: 'border-color 0.12s, background 0.12s' }} onMouseDown={(e) => handleBoxMouseDown(e, box)} onMouseEnter={() => setHoveredBox(box.id)} onMouseLeave={() => setHoveredBox(null)} />
              {box.source === 'seal' && <span style={{ position: 'absolute', top: -16, left: 0, fontSize: 10, color: '#3b82f6', whiteSpace: 'nowrap' }}>公章</span>}
              {isActive && <button style={{ position: 'absolute', top: -12, right: -12, width: 22, height: 22, borderRadius: '50%', background: '#ef4444', color: '#fff', border: '2px solid #fff', cursor: 'pointer', fontSize: 13, lineHeight: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => handleDeleteBox(e, box.id)} title="删除">×</button>}
              {isActive && ['nw', 'ne', 'sw', 'se'].map(h => <div key={h} data-handle={h} style={{ position: 'absolute', width: 8, height: 8, background: '#3b82f6', border: '1px solid #fff', borderRadius: 2, zIndex: 10, ...(h.includes('n') ? { top: -4 } : { bottom: -4 }), ...(h.includes('w') ? { left: -4 } : { right: -4 }), cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }} onMouseDown={(e) => handleResizeStart(e, box.id, h)} />)}
            </div>
          );
        })}
        {drawing && <div style={{ position: 'absolute', left: Math.min(drawing.startX, drawing.currentX || drawing.startX) * displayWidth, top: Math.min(drawing.startY, drawing.currentY || drawing.startY) * displayHeight, width: Math.abs((drawing.currentX || drawing.startX) - drawing.startX) * displayWidth, height: Math.abs((drawing.currentY || drawing.startY) - drawing.startY) * displayHeight, border: '2px dashed #3b82f6', background: 'rgba(59,130,246,0.1)', pointerEvents: 'none' }} />}
      </div>
    </div>
  );
}

// ─── Mask Preview Panel ───────────────────────────────────────

function MaskPreview({ pageInfo, boxes, containerWidth }) {
  const { displayWidth, displayHeight } = computeDisplaySize(pageInfo, containerWidth, 900);
  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);
  return (
    <div className="mask-preview" style={{ position: 'relative', width: displayWidth, height: displayHeight, background: '#fff' }}>
      <img src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`} alt="" style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }} draggable={false} />
      <svg width={displayWidth} height={displayHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
        {pageBoxes.map(box => { const css = normalizedToCSS(box, displayWidth, displayHeight); return <rect key={box.id} x={css.left} y={css.top} width={css.width} height={css.height} fill="#000000" stroke="none" />; })}
      </svg>
      <div style={{ position: 'absolute', bottom: 8, right: 8, color: 'rgba(0,0,0,0.45)', fontSize: 11, background: 'rgba(255,255,255,0.75)', padding: '2px 6px', borderRadius: 4 }}>遮蔽预览 · {pageBoxes.length} 个区域</div>
    </div>
  );
}

// ─── Text Dual-Column ────────────────────────────────────────

function TextDualColumn({ ocrText, entities, mode }) {
  const replaced = useMemo(() => {
    if (!ocrText) return '';
    let result = ocrText;
    // Sort by start position descending to replace from end to start
    const sorted = [...entities].sort((a, b) => (b.start || 0) - (a.start || 0));
    for (const ent of sorted) {
      if (!ent.original) continue;
      const masked = mode === 'star' ? starMask(ent.original, ent.entity_type) : placeholderMask(ent.entity_type);
      result = result.substring(0, ent.start) + masked + result.substring(ent.end);
    }
    return result;
  }, [ocrText, entities, mode]);

  return (
    <div className="text-dual-column">
      <div className="text-panel">
        <div className="text-panel-header">OCR 抽取原文（{entities.length} 个敏感实体命中）</div>
        <div className="text-panel-body"><pre className="text-content">{ocrText || '（暂无文本）'}</pre></div>
      </div>
      <div className="text-panel">
        <div className="text-panel-header">{mode === 'star' ? '星号替换预览' : '占位替换预览'}</div>
        <div className="text-panel-body">
          <pre className="text-content">{replaced || '（暂无预览）'}</pre>
          <div className="text-preview-note">预览仅供参考，以实际导出为准</div>
        </div>
      </div>
    </div>
  );
}

// ─── Export Dropdown ──────────────────────────────────────────

function ExportDropdown({ mode, onExport, exporting, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const formats = mode === 'mask' ? MASK_FORMATS : TEXT_FORMATS;
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  return (
    <div className="export-dropdown" ref={ref}>
      <Button variant="default" size="sm" onClick={() => setOpen(!open)} disabled={exporting || disabled}>{exporting ? '导出中…' : '导出 ▾'}</Button>
      {open && <div className="export-menu">{formats.map(f => <button key={f.value} className="export-menu-item" onClick={() => { setOpen(false); onExport(f.value); }}>{f.label}</button>)}</div>}
    </div>
  );
}

// ─── Main VisualMaskPage ─────────────────────────────────────

export default function VisualMaskPage({ settings: _settings }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState(null);

  // boxes = redaction candidates for mask mode (entityType + seal + manual)
  const [boxes, setBoxes] = useState([]);
  // textEntities = precise rule-based entities for text mode (from backend analyze)
  const [textEntities, setTextEntities] = useState([]);
  const [ocrText, setOcrText] = useState('');
  const [pageImages, setPageImages] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedBox, setSelectedBox] = useState(null);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState('mask');

  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const pageRowRefs = useRef({});

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  // ─── Scroll → update currentPage (#3) ─────────────────────

  useEffect(() => {
    if (mode !== 'mask' || pageImages.length <= 1) return;
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver((entries) => {
      let best = 0, bestPage = currentPage;
      for (const e of entries) { if (e.intersectionRatio > best) { best = e.intersectionRatio; bestPage = parseInt(e.target.dataset.page, 10) || currentPage; } }
      if (best > 0.3 && bestPage !== currentPage) setCurrentPage(bestPage);
    }, { root: container, threshold: [0.3, 0.5, 0.7] });
    Object.values(pageRowRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [mode, pageImages.length, currentPage]);

  const scrollToPage = useCallback((n) => { const el = pageRowRefs.current[n]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); setCurrentPage(n); }, []);

  // ─── Upload + Analyze ────────────────────────────────────────

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true); setError(null); setBoxes([]); setTextEntities([]); setOcrText(''); setPageImages([]); setUploadPercent(0); setProcessingStep('上传中…');
    try {
      const taskData = await uploadWithProgress(file, _settings?.rulesConfig, setUploadPercent);
      setTask(taskData); setUploadPercent(100);

      setProcessingStep('正在 OCR 识别…');
      const analyzeData = await analyzeTask(taskData.taskId);

      setProcessingStep('正在规则匹配…');

      // ── Text entities from backend (precise rule-based, not line-level OCR) ──
      const backendTextEntities = (analyzeData.textEntities || []).map(e => ({
        original: e.original || '',
        entity_type: e.entity_type || 'CUSTOM',
        start: e.start ?? 0,
        end: e.end ?? 0,
      }));
      const fullText = (analyzeData.ocrBoxes || []).map(b => b.text || '').join('\n');
      setTextEntities(backendTextEntities);
      setOcrText(fullText);

      // ── Redaction boxes: refined entity-level sub-boxes from backend ──
      const refined = (analyzeData.refinedBoxes || []).map((b, i) => createNormalizedBox({
        id: `cand_${i}`, page: b.page,
        x: b.x, y: b.y, width: b.width, height: b.height,
        pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
        pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
        source: 'ocr', entityType: b.entityType || 'CUSTOM',
        text: b.text || '', confidence: b.confidence ?? null,
      }));

      const sealBoxes = (analyzeData.sealBoxes || []).map((b, i) => createNormalizedBox({
        id: b.id || `seal_${i}`, page: b.page,
        x: b.x, y: b.y, width: b.width, height: b.height,
        pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
        pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
        source: 'seal', entityType: 'SEAL',
      }));

      setBoxes([...refined, ...sealBoxes]);
      setPageImages(analyzeData.manifest?.pages || []);
      setCurrentPage(1);

      setProcessingStep('生成预览…');
      showToast(`识别到 ${refined.length} 个敏感区域、${backendTextEntities.length} 个文本实体${sealBoxes.length > 0 ? `、${sealBoxes.length} 个公章候选` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false); setProcessingStep(''); setUploadPercent(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─── Save ─────────────────────────────────────────────────

  const handleSaveBoxes = async () => {
    if (!task) return;
    try { await updateTaskBoxes(task.taskId, boxes); showToast('已保存'); }
    catch (err) { showToast(err.message || '保存失败'); }
  };

  // ─── Export ────────────────────────────────────────────────

  const doExport = async (exportFormat) => {
    if (!task) return;
    setExporting(true);
    try {
      await updateTaskBoxes(task.taskId, boxes);
      const baseName = task.filename ? task.filename.substring(0, task.filename.lastIndexOf('.')) : 'document';
      const ext = task.filename ? task.filename.substring(task.filename.lastIndexOf('.')) : '';

      if (mode === 'mask' && exportFormat === 'pdf') {
        // Mask mode → PDF
        if (boxes.length === 0) { showToast('没有遮蔽框'); return; }
        const response = await maskExportTask(task.taskId, boxes);
        downloadBlob(await response.blob(), `${baseName}_脱敏${ext}`);
      } else {
        // Text mode (star/placeholder): only use textEntities from backend
        if (textEntities.length === 0) { showToast('没有检测到可替换的文本实体'); return; }
        const response = await textExportTask(task.taskId, textEntities, mode === 'mask' ? 'star' : mode, exportFormat);
        downloadBlob(await response.blob(), `${baseName}_脱敏.${exportFormat}`);
      }
      showToast('导出成功');
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally { setExporting(false); }
  };

  function downloadBlob(blob, filename) { const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url); }

  const redactionCount = boxes.length;
  const totalPages = pageImages.length;
  const isMaskMode = mode === 'mask';

  // ─── Empty state ───────────────────────────────────────────

  if (!task && !loading) {
    return (
      <div className="tool-empty">
        <strong>上传 PDF 开始脱敏</strong>
        <p>支持文本 PDF 和扫描 PDF</p>
        <Button variant="default" onClick={() => fileInputRef.current?.click()}>选择文件</Button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
    );
  }

  // ─── Loading with progress bar (#1) ──────────────────────

  if (loading) {
    return <ProgressBar percent={uploadPercent} step={processingStep} />;
  }

  if (error) {
    return (
      <div className="tool-error">
        <strong>处理失败</strong>
        <p>{error}</p>
        <Button variant="outline" onClick={() => { setError(null); setTask(null); }}>重试</Button>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────

  return (
    <div className="visual-mask-page" ref={containerRef}>
      {/* Global top-right: export only */}
      <div className="mask-topbar">
        <div className="mask-topbar-left">
          <span className="mask-filename">{task?.filename}</span>
        </div>
        <div className="mask-topbar-right">
          <ExportDropdown mode={mode} onExport={doExport} exporting={exporting} disabled={isMaskMode ? redactionCount === 0 : textEntities.length === 0} />
        </div>
      </div>

      {isMaskMode ? (
        /* Mask mode: toolbar inside scroll area + image dual-column */
        <div className="mask-scroll-container" ref={scrollRef}>
          {/* #2: Document-local sticky toolbar */}
          <div className="mask-doc-toolbar">
            <div className="mask-doc-toolbar-left">
              <div className="mode-switch">
                {MODES.map(m => <button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)} title={m.desc}>{m.label}</button>)}
              </div>
              {totalPages > 1 && (
                <div className="page-nav">
                  <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => scrollToPage(currentPage - 1)}>←</Button>
                  <span>{currentPage} / {totalPages}</span>
                  <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => scrollToPage(currentPage + 1)}>→</Button>
                </div>
              )}
            </div>
            <div className="mask-doc-toolbar-right">
              <span className="mask-box-count">{redactionCount} 个遮蔽区域</span>
              {boxes.some(b => b.source === 'seal') && <span className="mask-seal-notice">已识别公章候选，可手动补充或调整</span>}
              <Button variant="outline" size="sm" onClick={handleSaveBoxes}>保存框</Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>换文件</Button>
            </div>
          </div>
          {pageImages.map((pg) => {
            const pgInfo = { ...pg, taskId: task?.taskId };
            return (
              <div key={pg.pageNumber} className="mask-page-row" data-page={pg.pageNumber} ref={el => { pageRowRefs.current[pg.pageNumber] = el; }}>
                <div className="mask-page-col"><PageCanvas pageInfo={pgInfo} boxes={boxes} onBoxesChange={setBoxes} containerWidth={560} selectedBox={selectedBox} onSelectBox={setSelectedBox} /></div>
                <div className="mask-page-col"><MaskPreview pageInfo={pgInfo} boxes={boxes} containerWidth={560} /></div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Star/Placeholder mode: text dual-column + mode switch above */
        <div className="text-mode-container">
          <div className="mask-doc-toolbar">
            <div className="mask-doc-toolbar-left">
              <div className="mode-switch">
                {MODES.map(m => <button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)} title={m.desc}>{m.label}</button>)}
              </div>
            </div>
            <div className="mask-doc-toolbar-right">
              <span className="mask-box-count">{textEntities.length} 个敏感实体</span>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>换文件</Button>
            </div>
          </div>
          <TextDualColumn ocrText={ocrText} entities={textEntities} mode={mode} />
        </div>
      )}

      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
