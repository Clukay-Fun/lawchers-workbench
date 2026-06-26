import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { analyzeTask, updateTaskBoxes, maskExportTask, textExportTask, getTaskSession, updateCancelledEntities, getHistory, deleteHistory } from '../api';
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

function PageCanvas({ pageInfo, boxes, onBoxesChange, containerWidth, selectedBox, onSelectBox, hoveredBox, onHoverBox, onRightClickBox }) {
  const overlayRef = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
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
      {!imgLoaded && !imgError && <div className="page-img-loading" style={{ position: 'absolute', inset: 0 }}>页面恢复中…</div>}
      {imgError && <div className="page-img-loading" style={{ position: 'absolute', inset: 0 }}>页面加载失败</div>}
      <img src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`} alt={`Page ${pageInfo.pageNumber}`} style={{ width: displayWidth, height: displayHeight, display: imgLoaded ? 'block' : 'none', userSelect: 'none' }} draggable={false} onLoad={() => setImgLoaded(true)} onError={() => setImgError(true)} />
      <div ref={overlayRef} className="box-overlay" style={{ position: 'absolute', top: 0, left: 0, width: displayWidth, height: displayHeight, cursor: 'crosshair' }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          const isActive = hoveredBox === box.id || selectedBox === box.id;
          return (
            <div key={box.id} style={{ position: 'absolute', left: css.left, top: css.top, width: css.width, height: css.height }}>
              <div data-box-id={box.id} style={{ width: '100%', height: '100%', border: `2px solid ${isActive ? '#3b82f6' : 'rgba(59,130,246,0.6)'}`, background: isActive ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.06)', cursor: 'move', transition: 'border-color 0.12s, background 0.12s' }} onMouseDown={(e) => handleBoxMouseDown(e, box)} onContextMenu={(e) => { e.preventDefault(); onRightClickBox?.(box); }} onMouseEnter={() => onHoverBox?.(box.id)} onMouseLeave={() => onHoverBox?.(null)} />
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

// ─── Mask Preview Panel (P9-3: white border on selected) ────

function MaskPreview({ pageInfo, boxes, containerWidth, selectedBox, hoveredBox, onRightClickBox }) {
  const { displayWidth, displayHeight } = computeDisplaySize(pageInfo, containerWidth, 900);
  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  return (
    <div className="mask-preview" style={{ position: 'relative', width: displayWidth, height: displayHeight, background: '#fff' }}>
      {!imgLoaded && !imgError && <div className="page-img-loading" style={{ position: 'absolute', inset: 0 }}>页面恢复中…</div>}
      {imgError && <div className="page-img-loading" style={{ position: 'absolute', inset: 0 }}>页面加载失败</div>}
      <img src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`} alt="" style={{ width: displayWidth, height: displayHeight, display: imgLoaded ? 'block' : 'none', userSelect: 'none' }} draggable={false} onLoad={() => setImgLoaded(true)} onError={() => setImgError(true)} />
      <svg width={displayWidth} height={displayHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          const isSelected = selectedBox === box.id || hoveredBox === box.id;
          return (
            <g key={box.id} onContextMenu={(e) => { e.preventDefault(); onRightClickBox?.(box); }} style={{ cursor: 'pointer' }}>
              <rect x={css.left} y={css.top} width={css.width} height={css.height} fill="#000000" stroke="none" />
              {isSelected && <rect x={css.left - 1} y={css.top - 1} width={css.width + 2} height={css.height + 2} fill="none" stroke="#ffffff" strokeWidth="2" />}
              {isSelected && <rect x={css.left - 3} y={css.top - 3} width={css.width + 6} height={css.height + 6} fill="none" stroke="rgba(59,130,246,0.4)" strokeWidth="1" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Text Dual-Column (P9-3: sync scroll + hover highlight) ─

function TextDualColumn({ ocrText, entities, mode, onRightClickEntity }) {
  const [hoveredEntity, setHoveredEntity] = useState(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const syncingRef = useRef(false);

  // Build highlighted original text (sequential, left-to-right)
  const highlightedOriginal = useMemo(() => {
    if (!ocrText || !entities.length) return ocrText || '';
    const parts = [];
    let last = 0;
    const sorted = [...entities].sort((a, b) => (a.start || 0) - (b.start || 0));
    for (const ent of sorted) {
      if (ent.start > last) parts.push({ text: ocrText.substring(last, ent.start), type: 'normal' });
      parts.push({ text: ent.original, type: 'entity', entity: ent });
      last = ent.end;
    }
    if (last < ocrText.length) parts.push({ text: ocrText.substring(last), type: 'normal' });
    return parts;
  }, [ocrText, entities]);

  // Build highlighted replaced text (sequential, left-to-right, no offset drift)
  const highlightedReplaced = useMemo(() => {
    if (!ocrText || !entities.length) return ocrText || '';
    const parts = [];
    let last = 0;
    const sorted = [...entities].sort((a, b) => (a.start || 0) - (b.start || 0));
    for (const ent of sorted) {
      if (ent.start > last) parts.push({ text: ocrText.substring(last, ent.start), type: 'normal' });
      const masked = mode === 'star' ? starMask(ent.original, ent.entity_type) : placeholderMask(ent.entity_type);
      parts.push({ text: masked, type: 'entity', entity: ent });
      last = ent.end;
    }
    if (last < ocrText.length) parts.push({ text: ocrText.substring(last), type: 'normal' });
    return parts;
  }, [ocrText, entities, mode]);

  // Sync scroll between left and right panels
  const handleLeftScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (rightRef.current && leftRef.current) {
      rightRef.current.scrollTop = leftRef.current.scrollTop;
    }
    syncingRef.current = false;
  }, []);

  const handleRightScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    }
    syncingRef.current = false;
  }, []);

  const isHighlighted = useCallback((ent) => {
    if (!hoveredEntity) return false;
    return ent.start === hoveredEntity.start && ent.end === hoveredEntity.end && ent.entity_type === hoveredEntity.entity_type;
  }, [hoveredEntity]);

  return (
    <div className="text-dual-column">
      <div className="text-panel">
        <div className="text-panel-header">OCR 抽取原文（{entities.length} 个敏感实体命中）</div>
        <div className="text-panel-body" ref={leftRef} onScroll={handleLeftScroll}>
          <pre className="text-content">
            {Array.isArray(highlightedOriginal)
              ? highlightedOriginal.map((part, i) => part.type === 'entity'
                ? <span key={i} className={`text-entity-highlight ${isHighlighted(part.entity) ? 'active' : ''}`} onMouseEnter={() => setHoveredEntity(part.entity)} onMouseLeave={() => setHoveredEntity(null)} onContextMenu={(e) => { e.preventDefault(); onRightClickEntity?.(part.entity); }}>{part.text}</span>
                : <span key={i}>{part.text}</span>
              )
              : highlightedOriginal
            }
          </pre>
        </div>
      </div>
      <div className="text-panel">
        <div className="text-panel-header">{mode === 'star' ? '星号替换预览' : '占位替换预览'}</div>
        <div className="text-panel-body" ref={rightRef} onScroll={handleRightScroll}>
          <pre className="text-content">
            {Array.isArray(highlightedReplaced)
              ? highlightedReplaced.map((part, i) => part.type === 'entity'
                ? <span key={i} className={`text-entity-highlight replaced ${isHighlighted(part.entity) ? 'active' : ''}`} onMouseEnter={() => setHoveredEntity(part.entity)} onMouseLeave={() => setHoveredEntity(null)} onContextMenu={(e) => { e.preventDefault(); onRightClickEntity?.(part.entity); }}>{part.text}</span>
                : <span key={i}>{part.text}</span>
              )
              : highlightedReplaced
            }
          </pre>
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

export default function VisualMaskPage({ settings: _settings, resumeTaskId, onResumeDone }) {
  const [task, setTask] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState(null);

  const [boxes, setBoxes] = useState([]);
  const [textEntities, setTextEntities] = useState([]);
  const [ocrText, setOcrText] = useState('');
  const [pageImages, setPageImages] = useState([]);
  const cancelledRef = useRef(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedBox, setSelectedBox] = useState(null);
  const [hoveredBox, setHoveredBox] = useState(null);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState('mask');

  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const pageRowRefs = useRef({});
  const hasLoadedRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(560);

  // Track container width for adaptive layout — rebind when mask mode renders
  useEffect(() => {
    if (mode !== 'mask' || !task || pageImages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const w = el.getBoundingClientRect().width || 560;
      const pageW = Math.min(Math.floor((w - 48) / 2), 720);
      setContainerWidth(Math.max(pageW, 280));
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, task, pageImages.length]);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); }, []);

  // #region 任务列表与会话管理

  /**
   * 加载历史任务列表
   * 用途: 从后端获取历史上传材料列表
   */
  const loadTasksList = useCallback(async () => {
    setTasksLoading(true);
    try {
      const list = await getHistory();
      setTasks(list || []);
    } catch (err) {
      showToast(err.message || '加载历史任务失败');
    } finally {
      setTasksLoading(false);
    }
  }, [showToast]);

  /**
   * 加载特定的任务会话
   * 用途: 恢复任务会话，更新所有分析和脱敏状态
   * 参数: taskId - 任务 ID
   */
  const loadTaskSession = useCallback(async (taskId) => {
    setLoading(true); setProcessingStep('正在加载任务会话…'); setError(null);
    try {
      const session = await getTaskSession(taskId);
      setTask(session.task);
      setBoxes(session.boxes || []);
      setTextEntities(session.textEntities || []);
      setOcrText(session.ocrText || '');
      setPageImages(session.manifest?.pages || []);
      cancelledRef.current = new Set(session.cancelledEntities || []);
      setCurrentPage(1);
      hasLoadedRef.current = true;
      localStorage.setItem('activeTaskId', String(taskId));
    } catch (err) {
      setError(err.message || '加载任务会话失败');
      localStorage.removeItem('activeTaskId');
    } finally {
      setLoading(false); setProcessingStep('');
    }
  }, []);

  /**
   * 删除材料
   * 用途: 删除特定的历史文档记录及分析缓存
   * 参数: taskId - 任务 ID, e - 点击事件
   */
  const handleDeleteTask = useCallback(async (taskId, e) => {
    e.stopPropagation();
    if (!window.confirm('确认删除此材料？这将清除该文档的脱敏记录及所有分析缓存。')) return;
    try {
      await deleteHistory(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      showToast('材料已删除');
      
      // 如果删除的是当前活动任务，重置工作区
      if (task && task.taskId === taskId) {
        setTask(null);
        setBoxes([]);
        setTextEntities([]);
        setOcrText('');
        setPageImages([]);
        localStorage.removeItem('activeTaskId');
      }
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }, [task, showToast]);

  // 挂载时拉取任务列表
  useEffect(() => {
    loadTasksList();
  }, [loadTasksList]);

  // #endregion

  // ─── S2: Auto-restore from localStorage on mount ───────────
  useEffect(() => {
    if (resumeTaskId) return; // handled by resumeTaskId effect
    const storedId = localStorage.getItem('activeTaskId');
    if (!storedId) return;
    loadTaskSession(parseInt(storedId, 10));
  }, [resumeTaskId, loadTaskSession]);

  // ─── Hydrate from session (P9-1) ──────────────────────────
  useEffect(() => {
    if (!resumeTaskId) return;
    loadTaskSession(resumeTaskId);
    onResumeDone?.();
  }, [resumeTaskId, loadTaskSession, onResumeDone]);

  // ─── Scroll → update currentPage ──────────────────────────
  const scrollIgnoreRef = useRef(false);

  useEffect(() => {
    if (mode !== 'mask' || pageImages.length <= 1) return;
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver((entries) => {
      if (scrollIgnoreRef.current) return; // ignore during programmatic scroll
      let best = 0, bestPage = currentPage;
      for (const e of entries) { if (e.intersectionRatio > best) { best = e.intersectionRatio; bestPage = parseInt(e.target.dataset.page, 10) || currentPage; } }
      if (best > 0.3 && bestPage !== currentPage) setCurrentPage(bestPage);
    }, { root: container, threshold: [0.3, 0.5, 0.7] });
    Object.values(pageRowRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [mode, pageImages.length, currentPage]);

  const scrollToPage = useCallback((n) => {
    if (n < 1 || n > pageImages.length) return;
    setCurrentPage(n);
    const container = scrollRef.current;
    const el = pageRowRefs.current[n];
    if (!container || !el) return;
    scrollIgnoreRef.current = true;
    const headerHeight = 56;
    container.scrollTo({ top: el.offsetTop - headerHeight, behavior: 'smooth' });
    setTimeout(() => { scrollIgnoreRef.current = false; }, 500);
  }, [pageImages.length]);

  // ─── S5: Right-click cancel handler (Slice 2: persist to backend) ──
  const persistCancelled = useCallback((newSet) => {
    if (!task) return;
    updateCancelledEntities(task.taskId, [...newSet]).catch(() => {});
  }, [task]);

  const handleRightClickBox = useCallback((box) => {
    setBoxes(prev => prev.filter(b => b.id !== box.id));
    if (box.entityId) {
      setTextEntities(prev => prev.filter(e => e.id !== box.entityId));
      cancelledRef.current.add(box.entityId);
      persistCancelled(cancelledRef.current);
    }
    showToast('已取消该区域脱敏');
  }, [showToast, persistCancelled]);

  const handleRightClickEntity = useCallback((entity) => {
    setTextEntities(prev => prev.filter(e => e.id !== entity.id));
    setBoxes(prev => prev.filter(b => !(b.entityId && b.entityId === entity.id)));
    cancelledRef.current.add(entity.id);
    persistCancelled(cancelledRef.current);
    showToast('已取消该实体脱敏');
  }, [showToast, persistCancelled]);

  // Persist boxes on change (debounced) — allow empty array to clear
  useEffect(() => {
    if (!task) hasLoadedRef.current = false;
  }, [task]);

  useEffect(() => {
    if (!task || !hasLoadedRef.current) return;
    const timer = setTimeout(() => {
      updateTaskBoxes(task.taskId, boxes).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [task, boxes]);

  // ─── Upload + Analyze ────────────────────────────────────────

  const handleFile = async (file) => {
    if (!file) return;
    localStorage.removeItem('activeTaskId'); // S4: clear before new upload
    setLoading(true); setError(null); setBoxes([]); setTextEntities([]); setOcrText(''); setPageImages([]); cancelledRef.current = new Set(); setUploadPercent(0); setProcessingStep('上传中…');
    try {
      const taskData = await uploadWithProgress(file, _settings?.rulesConfig, setUploadPercent);
      setTask(taskData); setUploadPercent(100);
      localStorage.setItem('activeTaskId', String(taskData.taskId));

      setProcessingStep('正在 OCR 识别…');
      const analyzeData = await analyzeTask(taskData.taskId);

      setProcessingStep('正在规则匹配…');

      const backendTextEntities = (analyzeData.textEntities || []).map(e => {
        const entityType = e.entity_type || 'CUSTOM';
        const start = e.start ?? 0;
        const end = e.end ?? 0;
        return {
          id: `${entityType}:${start}:${end}`,
          original: e.original || '',
          entity_type: entityType,
          start,
          end,
        };
      });
      const fullText = (analyzeData.ocrBoxes || []).map(b => b.text || '').join('\n');
      setTextEntities(backendTextEntities);
      setOcrText(fullText);

      const refined = (analyzeData.refinedBoxes || []).map((b, i) => {
        return createNormalizedBox({
          id: `cand_${i}`, page: b.page,
          x: b.x, y: b.y, width: b.width, height: b.height,
          pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
          pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
          source: 'ocr', entityType: b.entityType || 'CUSTOM',
          text: b.text || '', confidence: b.confidence ?? null,
          entityId: b.entityId || null,
        });
      });

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
      hasLoadedRef.current = true;

      setProcessingStep('生成预览…');
      showToast('文档分析完成');
      loadTasksList();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false); setProcessingStep(''); setUploadPercent(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
        if (boxes.length === 0) { showToast('没有遮蔽框'); return; }
        const response = await maskExportTask(task.taskId, boxes);
        downloadBlob(await response.blob(), `${baseName}_脱敏${ext}`);
      } else {
        const payloadEntities = textEntities.map(e => ({
          original: e.original,
          entity_type: e.entity_type,
          start: e.start,
          end: e.end,
        }));
        const response = await textExportTask(task.taskId, payloadEntities, mode, exportFormat);
        const exportExt = exportFormat === 'pdf' ? 'txt' : exportFormat;
        downloadBlob(await response.blob(), `${baseName}_脱敏.${exportExt}`);
      }
      showToast('导出成功');
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  function downloadBlob(blob, filename) { const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url); }

  const redactionCount = boxes.length;
  const totalPages = pageImages.length;
  const isMaskMode = mode === 'mask';

  // ─── Main render ──────────────────────────────────────────

  return (
    <div className="workspace-container">
      {/* 左栏：本案材料列表 */}
      <div className="workspace-sidebar">
        <h4 className="sidebar-title">本案材料</h4>
        
        {tasksLoading && tasks.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">加载中…</div>
        ) : (
          <div className="file-list">
            {tasks.length === 0 ? (
              <div className="text-xs text-muted-foreground py-8 text-center italic">暂无材料，请在下方追加</div>
            ) : (
              tasks.map(t => {
                const isActive = task && task.taskId === t.id;
                const stats = (() => { try { return JSON.parse(t.entity_stats || '{}'); } catch { return {}; } })();
                const totalEntities = Object.values(stats).reduce((acc, curr) => acc + curr, 0);
                
                return (
                  <div
                    key={t.id}
                    className={`file-card ${isActive ? 'active' : ''}`}
                    onClick={() => { if (!isActive) loadTaskSession(t.id); }}
                  >
                    <div className="file-card-title" title={t.filename}>{t.filename}</div>
                    <div className="file-card-meta">
                      <span>{(t.ext || '').toUpperCase().replace('.', '') || 'PDF'} 格式</span>
                      <span>
                        {totalEntities > 0 ? `命中 ${totalEntities} 处` : '待分析'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={(e) => handleDeleteTask(t.id, e)}
                        title="删除材料"
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="sidebar-upload-btn" onClick={() => fileInputRef.current?.click()}>
          ＋ 追加上传本地材料
        </div>

        <h4 className="sidebar-title" style={{ marginTop: '24px' }}>操作提示</h4>
        <div className="sidebar-hint">
          可在“遮蔽”模式下通过<strong>鼠标拖拽划词</strong>手动高亮脱敏；在文本模式下对高亮词汇<strong>右键</strong>可取消脱敏。
        </div>
      </div>

      {/* 右栏：主编辑区 */}
      <div className="workspace-main" ref={containerRef}>
        {loading ? (
          <ProgressBar percent={uploadPercent} step={processingStep || '正在加载任务…'} />
        ) : error ? (
          <div className="tool-error">
            <strong>处理失败</strong>
            <p>{error}</p>
            <Button variant="outline" onClick={() => { setError(null); setTask(null); }}>返回列表</Button>
          </div>
        ) : !task ? (
          <div className="tool-empty">
            <strong>请在左侧选择或上传文档</strong>
            <p>支持文本 PDF 和扫描 PDF 两种文件格式</p>
            <Button variant="default" onClick={() => fileInputRef.current?.click()}>上传新文件</Button>
          </div>
        ) : (
          /* 核心编辑器渲染内容 */
          <>
            {/* S4: Top bar — left=filename, center=modes, right=upload+export */}
            <div className="mask-topbar">
              <div className="mask-topbar-left">
                <span className="mask-filename">{task?.filename}</span>
              </div>
              <div className="mask-topbar-center">
                <div className="mode-switch">
                  {MODES.map(m => <button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)} title={m.desc}>{m.label}</button>)}
                </div>
              </div>
              <div className="mask-topbar-right" style={{ display: 'flex', gap: '8px' }}>
                <ExportDropdown mode={mode} onExport={doExport} exporting={exporting} disabled={isMaskMode ? redactionCount === 0 : textEntities.length === 0} />
              </div>
            </div>

            {isMaskMode ? (
              /* Mask mode: shared header + continuous scroll pages */
              <div className="mask-scroll-container" ref={scrollRef}>
                {/* S2: Shared header — renders once, sticky */}
                <div className="mask-col-header-row">
                  <div className="mask-col-header" style={{ width: containerWidth ? `${containerWidth}px` : 'auto' }}>
                    <span className="mask-col-header-title">OCR 抽取原文</span>
                    <div className="page-nav">
                      <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => scrollToPage(currentPage - 1)}>←</Button>
                      <span>{currentPage} / {totalPages}</span>
                      <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => scrollToPage(currentPage + 1)}>→</Button>
                    </div>
                  </div>
                  <div className="mask-col-header" style={{ width: containerWidth ? `${containerWidth}px` : 'auto', justifyContent: 'center' }}>
                    <span className="mask-col-header-title">高保真脱敏预览</span>
                  </div>
                </div>
                {/* Page rows — no headers, just content */}
                {pageImages.map((pg) => {
                  const pgInfo = { ...pg, taskId: task?.taskId };
                  return (
                    <div key={pg.pageNumber} className="mask-page-row" data-page={pg.pageNumber} ref={el => { pageRowRefs.current[pg.pageNumber] = el; }}>
                      <div className="mask-page-col">
                        <PageCanvas
                          pageInfo={pgInfo} boxes={boxes} onBoxesChange={setBoxes} containerWidth={containerWidth}
                          selectedBox={selectedBox} onSelectBox={setSelectedBox}
                          hoveredBox={hoveredBox} onHoverBox={setHoveredBox}
                          onRightClickBox={handleRightClickBox}
                        />
                      </div>
                      <div className="mask-page-col">
                        <MaskPreview
                          pageInfo={pgInfo} boxes={boxes} containerWidth={containerWidth}
                          selectedBox={selectedBox} hoveredBox={hoveredBox}
                          onRightClickBox={handleRightClickBox}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Star/Placeholder mode: text dual-column */
              <div className="text-mode-container">
                <TextDualColumn ocrText={ocrText} entities={textEntities} mode={mode} onRightClickEntity={handleRightClickEntity} />
              </div>
            )}
          </>
        )}
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
