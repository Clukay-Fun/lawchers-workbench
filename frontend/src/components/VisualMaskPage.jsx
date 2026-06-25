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

// ─── Star mask (module level, before any component) ──────────

function starMask(text, entityType) {
  if (!text) return '';
  const chars = [...text];
  const len = chars.length;
  if (entityType === 'PHONE') return len >= 11 ? chars.slice(0, 3).join('') + '****' + chars.slice(-4).join('') : chars[0] + '***';
  if (entityType === 'ID_CARD') return len >= 15 ? chars.slice(0, 4).join('') + '*'.repeat(len - 8) + chars.slice(-4).join('') : chars.slice(0, 3).join('') + '*'.repeat(Math.max(1, len - 6)) + chars.slice(-3).join('');
  if (entityType === 'PERSON') return chars[0] + '*'.repeat(Math.max(1, len - 1));
  if (entityType === 'ORG') return len > 4 ? chars.slice(0, 2).join('') + '*'.repeat(Math.max(2, len - 4)) + chars.slice(-2).join('') : chars[0] + '*'.repeat(Math.max(1, len - 1));
  if (entityType === 'MONEY') return '****' + (chars[len - 1] || '');
  return chars[0] + '***';
}

// ─── Upload with real progress ────────────────────────────────

function uploadWithProgress(file, rulesConfig, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('rulesConfig', JSON.stringify(rulesConfig || {}));

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success) resolve(result.data);
          else reject(new Error(result.message || '上传失败'));
        } catch { reject(new Error('解析响应失败')); }
      } else {
        try { const err = JSON.parse(xhr.responseText); reject(new Error(err.message || `HTTP ${xhr.status}`)); }
        catch { reject(new Error(`HTTP ${xhr.status}`)); }
      }
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
    xhr.open('POST', '/api/tasks');
    xhr.send(formData);
  });
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
    const target = e.target;
    if (target.dataset.boxId || target.dataset.handle) return;
    const pos = toNormalized(e);
    setDrawing({ startX: pos.x, startY: pos.y });
    onSelectBox?.(null);
  }, [toNormalized, onSelectBox]);

  const handleMouseMove = useCallback((e) => {
    if (drawing) {
      const pos = toNormalized(e);
      setDrawing(prev => prev ? { ...prev, currentX: pos.x, currentY: pos.y } : prev);
    }
    if (dragging) {
      const pos = toNormalized(e);
      const newX = Math.max(0, Math.min(1 - dragging.boxW, pos.x - dragging.offsetX));
      const newY = Math.max(0, Math.min(1 - dragging.boxH, pos.y - dragging.offsetY));
      onBoxesChange(prev => prev.map(b => b.id === dragging.boxId ? { ...b, x: newX, y: newY } : b));
    }
    if (resizing) {
      const pos = toNormalized(e);
      onBoxesChange(prev => prev.map(b => {
        if (b.id !== resizing.boxId) return b;
        const { handle } = resizing;
        let { x, y, width, height } = b;
        if (handle.includes('e')) width = Math.max(BOX_MIN_SIZE, pos.x - x);
        if (handle.includes('s')) height = Math.max(BOX_MIN_SIZE, pos.y - y);
        if (handle.includes('w')) { const newX = Math.min(pos.x, x + width - BOX_MIN_SIZE); width = width + (x - newX); x = newX; }
        if (handle.includes('n')) { const newY = Math.min(pos.y, y + height - BOX_MIN_SIZE); height = height + (y - newY); y = newY; }
        return { ...b, x: Math.max(0, x), y: Math.max(0, y), width: Math.min(1 - x, width), height: Math.min(1 - y, height) };
      }));
    }
  }, [drawing, dragging, resizing, toNormalized, onBoxesChange]);

  const handleMouseUp = useCallback((e) => {
    if (drawing) {
      const pos = toNormalized(e);
      const x = Math.min(drawing.startX, pos.x);
      const y = Math.min(drawing.startY, pos.y);
      const width = Math.abs(pos.x - drawing.startX);
      const height = Math.abs(pos.y - drawing.startY);
      if (width > BOX_MIN_SIZE && height > BOX_MIN_SIZE) {
        onBoxesChange(prev => [...prev, createNormalizedBox({
          id: `manual_${Date.now()}`, page: pageInfo.pageNumber,
          x, y, width, height, pageWidth: pageInfo.pageWidth, pageHeight: pageInfo.pageHeight, source: 'manual',
        })]);
      }
      setDrawing(null);
    }
    setDragging(null);
    setResizing(null);
  }, [drawing, toNormalized, pageInfo, onBoxesChange]);

  const handleBoxMouseDown = useCallback((e, box) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onSelectBox?.(box.id);
    const pos = toNormalized(e);
    setDragging({ boxId: box.id, offsetX: pos.x - box.x, offsetY: pos.y - box.y, boxW: box.width, boxH: box.height });
  }, [toNormalized, onSelectBox]);

  const handleDeleteBox = useCallback((e, boxId) => {
    e.stopPropagation();
    onBoxesChange(prev => prev.filter(b => b.id !== boxId));
  }, [onBoxesChange]);

  const handleResizeStart = useCallback((e, boxId, handle) => {
    e.stopPropagation();
    setResizing({ boxId, handle });
  }, []);

  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);

  return (
    <div className="page-canvas" style={{ position: 'relative', width: displayWidth, height: displayHeight }}>
      <img
        src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`}
        alt={`Page ${pageInfo.pageNumber}`}
        style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }}
        draggable={false}
      />
      <div
        ref={overlayRef} className="box-overlay"
        style={{ position: 'absolute', top: 0, left: 0, width: displayWidth, height: displayHeight, cursor: 'crosshair' }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
      >
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          const isHovered = hoveredBox === box.id;
          const isSelected = selectedBox === box.id;
          const isActive = isHovered || isSelected;
          return (
            <div key={box.id} style={{ position: 'absolute', left: css.left, top: css.top, width: css.width, height: css.height }}>
              <div
                data-box-id={box.id}
                style={{
                  width: '100%', height: '100%',
                  border: `2px solid ${isActive ? '#3b82f6' : 'rgba(59,130,246,0.6)'}`,
                  background: isActive ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.06)',
                  cursor: 'move', transition: 'border-color 0.12s, background 0.12s',
                }}
                onMouseDown={(e) => handleBoxMouseDown(e, box)}
                onMouseEnter={() => setHoveredBox(box.id)}
                onMouseLeave={() => setHoveredBox(null)}
              />
              {box.source === 'seal' && (
                <span style={{ position: 'absolute', top: -16, left: 0, fontSize: 10, color: '#3b82f6', whiteSpace: 'nowrap' }}>公章</span>
              )}
              {isActive && (
                <button
                  style={{
                    position: 'absolute', top: -12, right: -12,
                    width: 22, height: 22, borderRadius: '50%',
                    background: '#ef4444', color: '#fff', border: '2px solid #fff',
                    cursor: 'pointer', fontSize: 13, lineHeight: '18px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleDeleteBox(e, box.id)}
                  title="删除"
                >×</button>
              )}
              {isActive && ['nw', 'ne', 'sw', 'se'].map(handle => (
                <div
                  key={handle} data-handle={handle}
                  style={{
                    position: 'absolute', width: 8, height: 8, background: '#3b82f6',
                    border: '1px solid #fff', borderRadius: 2, zIndex: 10,
                    ...(handle.includes('n') ? { top: -4 } : { bottom: -4 }),
                    ...(handle.includes('w') ? { left: -4 } : { right: -4 }),
                    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                  onMouseDown={(e) => handleResizeStart(e, box.id, handle)}
                />
              ))}
            </div>
          );
        })}
        {drawing && (
          <div style={{
            position: 'absolute',
            left: Math.min(drawing.startX, drawing.currentX || drawing.startX) * displayWidth,
            top: Math.min(drawing.startY, drawing.currentY || drawing.startY) * displayHeight,
            width: Math.abs((drawing.currentX || drawing.startX) - drawing.startX) * displayWidth,
            height: Math.abs((drawing.currentY || drawing.startY) - drawing.startY) * displayHeight,
            border: '2px dashed #3b82f6', background: 'rgba(59,130,246,0.1)', pointerEvents: 'none',
          }} />
        )}
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
      <img
        src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`}
        alt={`Masked page ${pageInfo.pageNumber}`}
        style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }}
        draggable={false}
      />
      <svg width={displayWidth} height={displayHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          return <rect key={box.id} x={css.left} y={css.top} width={css.width} height={css.height} fill="#000000" stroke="none" />;
        })}
      </svg>
      <div style={{ position: 'absolute', bottom: 8, right: 8, color: 'rgba(0,0,0,0.45)', fontSize: 11, background: 'rgba(255,255,255,0.75)', padding: '2px 6px', borderRadius: 4 }}>
        遮蔽预览 · {pageBoxes.length} 个区域
      </div>
    </div>
  );
}

// ─── Text Dual-Column (star/placeholder mode) ────────────────

function TextDualColumn({ originalText, replacedText, mode }) {
  return (
    <div className="text-dual-column">
      <div className="text-panel">
        <div className="text-panel-header">抽取原文</div>
        <div className="text-panel-body"><pre className="text-content">{originalText || '（暂无文本）'}</pre></div>
      </div>
      <div className="text-panel">
        <div className="text-panel-header">{mode === 'star' ? '星号替换预览' : '占位替换预览'}</div>
        <div className="text-panel-body">
          <pre className="text-content">{replacedText || '（暂无预览）'}</pre>
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

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="export-dropdown" ref={ref}>
      <Button variant="default" size="sm" onClick={() => setOpen(!open)} disabled={exporting || disabled}>
        {exporting ? '导出中…' : '导出 ▾'}
      </Button>
      {open && (
        <div className="export-menu">
          {formats.map(f => (
            <button key={f.value} className="export-menu-item" onClick={() => { setOpen(false); onExport(f.value); }}>
              {f.label}
            </button>
          ))}
        </div>
      )}
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

  const [boxes, setBoxes] = useState([]);
  const [ocrBoxes, setOcrBoxes] = useState([]);
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

  // ─── #3: Scroll → update currentPage ──────────────────────

  useEffect(() => {
    if (mode !== 'mask' || pageImages.length <= 1) return;
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the most visible page row
        let bestRatio = 0;
        let bestPage = currentPage;
        for (const entry of entries) {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPage = parseInt(entry.target.dataset.page, 10) || currentPage;
          }
        }
        if (bestRatio > 0.3 && bestPage !== currentPage) {
          setCurrentPage(bestPage);
        }
      },
      { root: container, threshold: [0.3, 0.5, 0.7] }
    );

    // Observe all page rows
    Object.values(pageRowRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [mode, pageImages.length, currentPage]);

  // Arrow click → scroll to page
  const scrollToPage = useCallback((pageNum) => {
    const el = pageRowRefs.current[pageNum];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentPage(pageNum);
  }, []);

  // ─── #2: Text preview (useMemo, not useEffect) ────────────

  const previewText = useMemo(() => {
    if (mode === 'mask' || !task) return { original: '', replaced: '' };
    const allText = ocrBoxes.map(b => b.text).join('\n');
    let replaced = allText;
    for (const box of boxes) {
      if (!box.text) continue;
      const entityType = box.entityType || 'MANUAL';
      const masked = mode === 'star' ? starMask(box.text, entityType) : `<${entityType}>`;
      replaced = replaced.split(box.text).join(masked);
    }
    return { original: allText, replaced };
  }, [mode, boxes, ocrBoxes, task]);

  // ─── Upload + Analyze ────────────────────────────────────────

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setBoxes([]);
    setOcrBoxes([]);
    setPageImages([]);
    setUploadPercent(0);
    setProcessingStep('上传中…');

    try {
      // #6: Upload with real progress + rulesConfig
      const taskData = await uploadWithProgress(file, _settings?.rulesConfig, setUploadPercent);
      setTask(taskData);
      setUploadPercent(100);

      setProcessingStep('渲染页面 + OCR 识别…');
      const analyzeData = await analyzeTask(taskData.taskId);

      setProcessingStep('规则匹配…');

      // #1: Separate OCR/redaction boxes
      const allOcr = (analyzeData.ocrBoxes || []).map((b, i) => ({
        id: `ocr_${i}`, page: b.page,
        x: b.x, y: b.y, width: b.width, height: b.height,
        pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
        pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
        source: 'ocr', entityType: b.entityType || b.entity_type || null,
        text: b.text || '', confidence: b.confidence ?? null,
      }));

      const candidateBoxes = allOcr.filter(b => b.entityType && b.entityType !== 'MANUAL').map(b => createNormalizedBox(b));
      const sealBoxes = (analyzeData.sealBoxes || []).map((b, i) => createNormalizedBox({
        id: b.id || `seal_${i}`, page: b.page,
        x: b.x, y: b.y, width: b.width, height: b.height,
        pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
        pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
        source: 'seal', entityType: 'SEAL',
      }));

      setOcrBoxes(allOcr);
      setBoxes([...candidateBoxes, ...sealBoxes]);
      setPageImages(analyzeData.manifest?.pages || []);
      setCurrentPage(1);

      setProcessingStep('生成预览…');
      showToast(`识别到 ${candidateBoxes.length} 个敏感区域${sealBoxes.length > 0 ? `、${sealBoxes.length} 个公章候选` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProcessingStep('');
      setUploadPercent(0);
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
    if (!task || boxes.length === 0) return;
    setExporting(true);
    try {
      await updateTaskBoxes(task.taskId, boxes);
      const baseName = task.filename ? task.filename.substring(0, task.filename.lastIndexOf('.')) : 'document';
      const ext = task.filename ? task.filename.substring(task.filename.lastIndexOf('.')) : '';

      if (mode === 'mask' && exportFormat === 'pdf') {
        const response = await maskExportTask(task.taskId, boxes);
        downloadBlob(await response.blob(), `${baseName}_脱敏${ext}`);
      } else {
        const entities = boxes.filter(b => b.text).map(b => ({
          original: b.text, entity_type: b.entityType || 'MANUAL', start: 0, end: 0,
        }));
        if (entities.length === 0) { showToast('当前框没有文本内容'); return; }
        const response = await textExportTask(task.taskId, entities, mode === 'mask' ? 'star' : mode, exportFormat);
        downloadBlob(await response.blob(), `${baseName}_脱敏.${exportFormat}`);
      }
      showToast('导出成功');
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  }

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

  // ─── Loading with steps ────────────────────────────────────

  if (loading) {
    return (
      <div className="tool-loading-steps">
        <div className="loading-step active">{uploadPercent < 100 ? `上传中 ${uploadPercent}%` : '✓ 上传完成'}</div>
        <div className={`loading-step ${processingStep.includes('渲染') || processingStep.includes('OCR') ? 'active' : ''}`}>渲染页面 + OCR 识别…</div>
        <div className={`loading-step ${processingStep.includes('规则') ? 'active' : ''}`}>规则匹配…</div>
        <div className={`loading-step ${processingStep.includes('预览') ? 'active' : ''}`}>生成预览…</div>
      </div>
    );
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
      <div className="mask-toolbar sticky">
        <div className="mask-toolbar-left">
          <span className="mask-filename">{task?.filename}</span>
          <span className="mask-box-count">{redactionCount} 个遮蔽区域</span>
          {boxes.some(b => b.source === 'seal') && (
            <span className="mask-seal-notice">已识别公章候选，可手动补充或调整</span>
          )}
        </div>
        <div className="mask-toolbar-center">
          <div className="mode-switch">
            {MODES.map(m => (
              <button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`}
                onClick={() => setMode(m.key)} title={m.desc}>{m.label}</button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="page-nav">
              <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => scrollToPage(currentPage - 1)}>←</Button>
              <span>{currentPage} / {totalPages}</span>
              <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => scrollToPage(currentPage + 1)}>→</Button>
            </div>
          )}
        </div>
        <div className="mask-toolbar-right">
          <Button variant="outline" size="sm" onClick={handleSaveBoxes}>保存框</Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>换文件</Button>
          <ExportDropdown mode={mode} onExport={doExport} exporting={exporting} disabled={redactionCount === 0} />
        </div>
      </div>

      {isMaskMode ? (
        <div className="mask-scroll-container" ref={scrollRef}>
          {pageImages.map((pg) => {
            const pgInfo = { ...pg, taskId: task?.taskId };
            return (
              <div
                key={pg.pageNumber}
                className="mask-page-row"
                data-page={pg.pageNumber}
                ref={el => { pageRowRefs.current[pg.pageNumber] = el; }}
              >
                <div className="mask-page-col">
                  <PageCanvas
                    pageInfo={pgInfo} boxes={boxes} onBoxesChange={setBoxes}
                    containerWidth={560} selectedBox={selectedBox} onSelectBox={setSelectedBox}
                  />
                </div>
                <div className="mask-page-col">
                  <MaskPreview pageInfo={pgInfo} boxes={boxes} containerWidth={560} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <TextDualColumn originalText={previewText.original} replacedText={previewText.replaced} mode={mode} />
      )}

      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
