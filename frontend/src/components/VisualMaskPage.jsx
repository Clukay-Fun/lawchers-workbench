import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { analyzeTask, updateTaskBoxes, maskExportTask, textExportTask, getTaskSession, updateCancelledEntities, updateEditedText, getHistory, deleteHistory, renderTasksPages } from '../api';
import { Button } from '@/components/ui/button';
import { normalizedToCSS, computeDisplaySize, createNormalizedBox } from '../services/coords';

// ─── Constants ───────────────────────────────────────────────

const BOX_MIN_SIZE = 0.005;
const MODES = [
  { key: 'mask', label: '遮蔽', desc: '黑色遮挡块 → PDF' },
  { key: 'star', label: '星号', desc: '部分可见 → TXT/MD/DOCX' },
  { key: 'placeholder', label: '占位', desc: '类型标签 → TXT/MD/DOCX' },
];

// P0: normalize task — upload returns taskId/documentKind, session returns id/document_kind
function normalizeTask(raw) {
  if (!raw) return null;
  const taskId = raw.taskId ?? raw.id;
  const documentKind = raw.document_kind ?? raw.documentKind ?? '';
  return {
    ...raw,
    taskId,
    id: raw.id ?? taskId,
    document_kind: documentKind,
    documentKind,
  };
}

// P1: available modes by document kind
function getAvailableModes(documentKind) {
  if (documentKind === 'pdf-text') return ['star', 'placeholder'];
  return ['mask', 'star', 'placeholder'];
}

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

function PageCanvas({ pageInfo, boxes, onBoxesChange, onBoxCreated, containerWidth, selectedBox, onSelectBox, hoveredBox, onHoverBox, onRightClickBox, status, imageUrl, onLoadSuccess, onLoadError, onReloadPage, onRerenderAll }) {
  const overlayRef = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const { displayWidth, displayHeight } = computeDisplaySize(pageInfo, containerWidth, 2400);

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
        const newBox = createNormalizedBox({
          id: `manual_${Date.now()}`, page: pageInfo.pageNumber, x, y, width: w, height: h,
          pageWidth: pageInfo.pageWidth, pageHeight: pageInfo.pageHeight, source: 'manual',
        });
        onBoxesChange(prev => [...prev, newBox]);
        onBoxCreated?.(newBox);
      }
      setDrawing(null);
    }
    setDragging(null); setResizing(null);
  }, [drawing, toNormalized, pageInfo, onBoxesChange, onBoxCreated]);

  const handleBoxMouseDown = useCallback((e, box) => { e.stopPropagation(); if (e.button !== 0) return; onSelectBox?.(box.id); const p = toNormalized(e); setDragging({ boxId: box.id, offsetX: p.x - box.x, offsetY: p.y - box.y, boxW: box.width, boxH: box.height }); }, [toNormalized, onSelectBox]);
  const handleDeleteBox = useCallback((e, boxId) => { e.stopPropagation(); onBoxesChange(prev => prev.filter(b => b.id !== boxId)); }, [onBoxesChange]);
  const handleResizeStart = useCallback((e, boxId, handle) => { e.stopPropagation(); setResizing({ boxId, handle }); }, []);

  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);
  const isFailed = status === 'failed';
  const isRecovering = status === 'loading' || status === 'recovering';
  const isReady = status === 'ready';

  return (
    <div className="page-canvas" style={{ position: 'relative', width: displayWidth, height: displayHeight }}>
      {/* Image always renders when URL exists; overlays sit on top */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`Page ${pageInfo.pageNumber}`}
          style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }}
          draggable={false}
          onLoad={() => onLoadSuccess?.(pageInfo.pageNumber)}
          onError={() => onLoadError?.(pageInfo.pageNumber)}
        />
      )}
      {/* Loading/recovering overlay */}
      {isRecovering && (
        <div className="page-img-loading" style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)' }}>页面恢复中…</div>
      )}
      {/* Failed overlay with recovery buttons */}
      {isFailed && (
        <div className="page-img-loading" style={{ position: 'absolute', inset: 0, flexDirection: 'column', gap: 8, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--base01)', fontSize: 12, fontWeight: 500 }}>页面加载失败</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => onReloadPage?.(pageInfo.pageNumber)}>重新加载本页</Button>
            <Button variant="outline" size="sm" onClick={onRerenderAll}>重新渲染全部</Button>
          </div>
        </div>
      )}
      {/* Box overlay: only show when image is ready */}
      {isReady && (
      <div ref={overlayRef} className="box-overlay" style={{ position: 'absolute', top: 0, left: 0, width: displayWidth, height: displayHeight, cursor: 'crosshair' }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          const isActive = hoveredBox === box.id || selectedBox === box.id;
          return (
            <div key={box.id} style={{ position: 'absolute', left: css.left, top: css.top, width: css.width, height: css.height }}>
              <div data-box-id={box.id} style={{ width: '100%', height: '100%', border: isActive ? '2px solid #3b82f6' : '1px solid rgba(59,130,246,0.6)', background: isActive ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.06)', borderRadius: '2px', cursor: 'move', transition: 'border-color 0.12s, background 0.12s' }} onMouseDown={(e) => handleBoxMouseDown(e, box)} onContextMenu={(e) => { e.preventDefault(); onRightClickBox?.(box); }} onMouseEnter={() => onHoverBox?.(box.id)} onMouseLeave={() => onHoverBox?.(null)} />
              {isActive && (
                <button
                  style={{
                    position: 'absolute',
                    top: '50%',
                    right: -18,
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#ef4444',
                    color: '#fff',
                    border: '2px solid #fff',
                    cursor: 'pointer',
                    fontSize: 10,
                    lineHeight: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 20,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleDeleteBox(e, box.id)}
                  title="删除"
                >×</button>
              )}
              {isActive && ['nw', 'ne', 'sw', 'se'].map(h => <div key={h} data-handle={h} style={{ position: 'absolute', width: 8, height: 8, background: '#3b82f6', border: '1px solid #fff', borderRadius: 2, zIndex: 10, ...(h.includes('n') ? { top: -4 } : { bottom: -4 }), ...(h.includes('w') ? { left: -4 } : { right: -4 }), cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }} onMouseDown={(e) => handleResizeStart(e, box.id, h)} />)}
            </div>
          );
        })}
        {drawing && <div style={{ position: 'absolute', left: Math.min(drawing.startX, drawing.currentX || drawing.startX) * displayWidth, top: Math.min(drawing.startY, drawing.currentY || drawing.startY) * displayHeight, width: Math.abs((drawing.currentX || drawing.startX) - drawing.startX) * displayWidth, height: Math.abs((drawing.currentY || drawing.startY) - drawing.startY) * displayHeight, border: '2px dashed #3b82f6', background: 'rgba(59,130,246,0.1)', pointerEvents: 'none' }} />}
      </div>
      )}
    </div>
  );
}

// ─── Mask Preview Panel ──────────────────────────────────────

function MaskPreview({ pageInfo, boxes, containerWidth, selectedBox, hoveredBox, onRightClickBox, status, imageUrl }) {
  const { displayWidth, displayHeight } = computeDisplaySize(pageInfo, containerWidth, 2400);
  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);
  
  const isFailed = status === 'failed';
  const isRecovering = status === 'loading' || status === 'recovering';
  const isReady = status === 'ready';

  return (
    <div className="mask-preview" style={{ position: 'relative', width: displayWidth, height: displayHeight, background: '#fff' }}>
      {/* Image always renders when URL exists */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }}
          draggable={false}
        />
      )}
      {/* Loading overlay */}
      {isRecovering && (
        <div className="page-img-loading" style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)' }}>页面恢复中…</div>
      )}
      {/* Failed overlay */}
      {isFailed && (
        <div className="page-img-loading" style={{ position: 'absolute', inset: 0, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--base01)', fontSize: 12, fontWeight: 500 }}>预览不可用</span>
        </div>
      )}
      {/* SVG overlay: only show when ready */}
      {isReady && (
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
      )}
    </div>
  );
}

// ─── Text Dual-Column (P9-3: sync scroll + hover highlight) ─

function TextDualColumn({ ocrText, entities, mode, onRightClickEntity, onAddManualEntity, onTextChange }) {
  const [hoveredEntity, setHoveredEntity] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(ocrText || '');
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const syncingRef = useRef(false);
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);

  // Build highlighted original text (sequential, left-to-right)
  const highlightedOriginal = useMemo(() => {
    if (!ocrText || !entities.length) return ocrText || '';
    const parts = [];
    let last = 0;
    const sorted = [...entities].sort((a, b) => (a.start || 0) - (b.start || 0));
    for (const ent of sorted) {
      if (ent.start > last) parts.push({ text: ocrText.substring(last, ent.start), type: 'normal', start: last, end: ent.start });
      parts.push({ text: ent.original, type: 'entity', entity: ent, start: ent.start, end: ent.end });
      last = ent.end;
    }
    if (last < ocrText.length) parts.push({ text: ocrText.substring(last), type: 'normal', start: last, end: ocrText.length });
    return parts;
  }, [ocrText, entities]);

  // Build highlighted replaced text (sequential, left-to-right, no offset drift)
  const highlightedReplaced = useMemo(() => {
    if (!ocrText || !entities.length) return ocrText || '';
    const parts = [];
    let last = 0;
    const sorted = [...entities].sort((a, b) => (a.start || 0) - (b.start || 0));
    for (const ent of sorted) {
      if (ent.start > last) parts.push({ text: ocrText.substring(last, ent.start), type: 'normal', start: last, end: ent.start });
      const masked = mode === 'star' ? starMask(ent.original, ent.entity_type) : placeholderMask(ent.entity_type);
      parts.push({ text: masked, type: 'entity', entity: ent, start: ent.start, end: ent.end });
      last = ent.end;
    }
    if (last < ocrText.length) parts.push({ text: ocrText.substring(last), type: 'normal', start: last, end: ocrText.length });
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

  const handleEditScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const isHighlighted = useCallback((ent) => {
    if (!hoveredEntity) return false;
    return ent.start === hoveredEntity.start && ent.end === hoveredEntity.end && ent.entity_type === hoveredEntity.entity_type;
  }, [hoveredEntity]);

  // Build highlight overlay for edit mode (entity backgrounds from ocrText positions)
  const highlightOverlay = useMemo(() => {
    if (!entities.length) return [{ text: draftText || '', type: 'normal' }];
    const parts = [];
    let last = 0;
    const sorted = [...entities].sort((a, b) => (a.start || 0) - (b.start || 0));
    for (const ent of sorted) {
      const s = Math.min(ent.start, draftText.length);
      if (s > last) parts.push({ text: draftText.substring(last, s), type: 'normal' });
      const e = Math.min(ent.end, draftText.length);
      if (e > s) parts.push({ text: draftText.substring(s, e), type: 'entity' });
      last = Math.max(last, e);
    }
    if (last < draftText.length) parts.push({ text: draftText.substring(last), type: 'normal' });
    if (!parts.length) parts.push({ text: draftText || '', type: 'normal' });
    return parts;
  }, [draftText, entities]);

  const getSelectionOffset = useCallback((node, offset) => {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const span = el?.closest?.('[data-src-start]');
    if (!span) return null;
    return parseInt(span.getAttribute('data-src-start'), 10) + offset;
  }, []);

  const handleOriginalMouseUp = useCallback(() => {
    if (editing) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !leftRef.current?.contains(selection.anchorNode) || !leftRef.current?.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    const start = getSelectionOffset(range.startContainer, range.startOffset);
    const end = getSelectionOffset(range.endContainer, range.endOffset);
    if (start === null || end === null) return;
    const s = Math.min(start, end);
    const e = Math.max(start, end);
    const original = ocrText.substring(s, e).trim();
    if (!original) return;
    onAddManualEntity?.({ start: s, end: e, original });
    selection.removeAllRanges();
  }, [editing, getSelectionOffset, ocrText, onAddManualEntity]);

  const saveEdit = useCallback(() => {
    onTextChange?.(draftText);
    setEditing(false);
  }, [draftText, onTextChange]);

  return (
    <div className="text-dual-column">
      <div className="text-panel">
        <div className="text-panel-header">
          <span>OCR 抽取原文（{entities.length} 个敏感实体命中）</span>
          <div className="text-panel-actions">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setDraftText(ocrText || ''); setEditing(false); }}>退出编辑</Button>
                <Button variant="outline" size="sm" onClick={saveEdit}>保存原文</Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => { setDraftText(ocrText || ''); setEditing(true); }}>编辑原文</Button>
            )}
          </div>
        </div>
        <div className="text-panel-body" ref={leftRef} onScroll={handleLeftScroll} onMouseUp={handleOriginalMouseUp}>
          {editing ? (
            <div className="text-edit-overlay-container">
              <pre className="text-edit-highlights" ref={highlightRef} aria-hidden="true">
                {highlightOverlay.map((part, i) =>
                  part.type === 'entity'
                    ? <span key={i} className="text-entity-bg">{part.text}</span>
                    : <span key={i}>{part.text}</span>
                )}
              </pre>
              <textarea className="text-edit-area" ref={textareaRef} value={draftText} onChange={(e) => setDraftText(e.target.value)} onScroll={handleEditScroll} />
            </div>
          ) : (
            <pre className="text-content">
              {Array.isArray(highlightedOriginal)
                ? highlightedOriginal.map((part, i) => part.type === 'entity'
                  ? <span key={i} data-src-start={part.start} className={`text-entity-highlight ${isHighlighted(part.entity) ? 'active' : ''}`} onMouseEnter={() => setHoveredEntity(part.entity)} onMouseLeave={() => setHoveredEntity(null)} onContextMenu={(e) => { e.preventDefault(); onRightClickEntity?.(part.entity); }}>{part.text}</span>
                  : <span key={i} data-src-start={part.start}>{part.text}</span>
                )
                : highlightedOriginal
              }
            </pre>
          )}
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
  const [ocrBoxes, setOcrBoxes] = useState([]);
  const [ocrText, setOcrText] = useState('');
  const [pageImages, setPageImages] = useState([]);
  const cancelledRef = useRef(new Set());
  const entityIdCounterRef = useRef(0);
  const ocrTextRef = useRef('');
  const textEntitiesRef = useRef([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedBox, setSelectedBox] = useState(null);
  const [hoveredBox, setHoveredBox] = useState(null);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState('mask');

  const [pageStatus, setPageStatus] = useState({});
  const [imageUrls, setImageUrls] = useState({});
  const renderCacheRef = useRef('unknown'); // 'ready' | 'missing' | 'unknown'

  // ─── Initialize page load status and image URLs ──────────────
  // Only reset when taskId or pageImages length changes (not on every render)
  useEffect(() => {
    if (!task || !pageImages.length) {
      setPageStatus({}); // eslint-disable-line react-hooks/set-state-in-effect
      setImageUrls({});
      return;
    }
    const tid = task.taskId;
    const cacheReady = renderCacheRef.current === 'ready';
    const initialStatus = {};
    const initialUrls = {};
    pageImages.forEach((pg) => {
      // If cache is ready, start as 'ready' — image will display immediately
      // onLoad will still fire and confirm. If it fails, status goes to 'recovering'.
      initialStatus[pg.pageNumber] = cacheReady ? 'ready' : 'loading';
      initialUrls[pg.pageNumber] = `/api/tasks/${tid}/page-image/${pg.pageNumber}`;
    });
    setPageStatus(initialStatus);
    setImageUrls(initialUrls);
  }, [task?.taskId, pageImages.length]);

  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const maskPreviewScrollRef = useRef(null);
  const maskScrollSyncRef = useRef(false);
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
      // scrollRef is now the left panel body, i.e. already a single-column width.
      // Do not divide by 2 here; that belonged to the old shared dual-column container.
      const pageW = Math.min(Math.floor(w), 860);
      setContainerWidth(Math.max(pageW, 280));
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, task, pageImages.length]);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); }, []);

  useEffect(() => {
    if (!task?.taskId) return;
    localStorage.setItem(`taskMode:${task.taskId}`, mode);
  }, [mode, task?.taskId]);

  // ─── 页面图片加载三层处理逻辑 ──────────────────────────
  
  /**
   * 页面图片加载成功回调
   * 参数: pageNum - 页码
   */
  const handlePageLoadSuccess = useCallback((pageNum) => {
    setPageStatus(prev => ({ ...prev, [pageNum]: 'ready' }));
  }, []);

  /**
   * 页面图片加载失败回调
   * 参数: pageNum - 页码
   */
  const handlePageLoadError = useCallback((pageNum) => {
    if (!task) return;
    setPageStatus(prev => {
      const current = prev[pageNum];
      if (current === 'loading') {
        // 第一层：尝试自动重试，状态转为 recovering
        console.warn(`Page ${pageNum} failed to load first time. Auto retrying...`);
        setImageUrls(prevUrls => ({
          ...prevUrls,
          [pageNum]: `/api/tasks/${task.taskId}/page-image/${pageNum}?retry=1&t=${Date.now()}`
        }));
        return { ...prev, [pageNum]: 'recovering' };
      } else if (current === 'recovering') {
        // 第二层：自动重试仍然失败，状态转为 failed
        console.error(`Page ${pageNum} failed to load second time. Mark as failed.`);
        return { ...prev, [pageNum]: 'failed' };
      }
      return prev;
    });
  }, [task]);

  /**
   * 重新加载单页 (手动恢复出口)
   * 参数: pageNum - 页码
   */
  const handleReloadPage = useCallback((pageNum) => {
    if (!task) return;
    setPageStatus(prev => ({ ...prev, [pageNum]: 'loading' }));
    setImageUrls(prevUrls => ({
      ...prevUrls,
      [pageNum]: `/api/tasks/${task.taskId}/page-image/${pageNum}?t=${Date.now()}`
    }));
  }, [task]);

  /**
   * 重新渲染全部页面 (手动恢复出口)
   */
  const handleRerenderAll = useCallback(async () => {
    if (!task) return;
    setLoading(true);
    setProcessingStep('正在重新渲染全部页面…');
    try {
      await renderTasksPages(task.taskId);
      
      // 成功后，将所有页面状态重置为 loading，并加上防缓存时间戳重新请求
      setPageStatus(prev => {
        const nextStatus = {};
        Object.keys(prev).forEach(k => { nextStatus[k] = 'loading'; });
        return nextStatus;
      });
      setImageUrls(prevUrls => {
        const nextUrls = {};
        Object.keys(prevUrls).forEach(pageNum => {
          nextUrls[pageNum] = `/api/tasks/${task.taskId}/page-image/${pageNum}?t=${Date.now()}`;
        });
        return nextUrls;
      });
      showToast('所有页面重新渲染完成，正在重新加载');
    } catch (err) {
      showToast(err.message || '重新渲染页面失败');
    } finally {
      setLoading(false);
      setProcessingStep('');
    }
  }, [task, showToast]);

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
      const normalized = normalizeTask(session.task);
      renderCacheRef.current = session.renderCacheStatus || 'unknown';
      setTask(normalized);
      setBoxes(session.boxes || []);
      const restoredEntities = session.textEntities || [];
      setTextEntities(restoredEntities);
      textEntitiesRef.current = restoredEntities;
      // Initialize manual entity counter past existing manual IDs
      // Must scan both active AND cancelled entities to avoid ID reuse
      const cancelledEntities = session.cancelledEntities || [];
      const allKnownIds = [...restoredEntities.map(e => e.id), ...cancelledEntities];
      const maxManual = allKnownIds.reduce((max, id) => {
        const m = (id || '').match(/^manual_(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      entityIdCounterRef.current = maxManual;
      setOcrBoxes(session.ocrBoxes || []);
      const restoredOcrText = session.ocrText || '';
      setOcrText(restoredOcrText);
      ocrTextRef.current = restoredOcrText;
      setPageImages(session.manifest?.pages || []);
      cancelledRef.current = new Set(session.cancelledEntities || []);
      setCurrentPage(1);
      hasLoadedRef.current = true;
      localStorage.setItem('activeTaskId', String(taskId));
      // Adjust mode to document kind
      const availModes = getAvailableModes(normalized?.document_kind);
      const savedMode = localStorage.getItem(`taskMode:${normalized.taskId}`);
      setMode(prev => {
        if (savedMode && availModes.includes(savedMode)) return savedMode;
        return availModes.includes(prev) ? prev : availModes[0];
      });
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
      const remaining = tasks.filter(t => t.id !== taskId);
      setTasks(remaining);
      showToast('材料已删除');

      if (task && (task.taskId === taskId || task.id === taskId)) {
        if (remaining.length > 0) {
          // Switch to first remaining task
          loadTaskSession(remaining[0].id);
        } else {
          // Clear everything — show empty state
          setTask(null);
          setBoxes([]);
          setTextEntities([]);
          setOcrBoxes([]);
          setOcrText('');
          setPageImages([]);
          setPageStatus({});
          setImageUrls({});
          cancelledRef.current = new Set();
          hasLoadedRef.current = false;
          setCurrentPage(1);
          localStorage.removeItem('activeTaskId');
        }
      }
    } catch (err) {
      showToast(err.message || '删除失败');
    }
  }, [task, tasks, showToast, loadTaskSession]);

  // 挂载时拉取任务列表
  useEffect(() => {
    loadTasksList(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadTasksList]);

  // #endregion

  // ─── S2: Auto-restore from localStorage on mount ───────────
  useEffect(() => {
    if (resumeTaskId) return;
    const storedId = localStorage.getItem('activeTaskId');
    if (!storedId) return;
    loadTaskSession(parseInt(storedId, 10)); // eslint-disable-line react-hooks/set-state-in-effect
  }, [resumeTaskId, loadTaskSession]);

  // ─── Hydrate from session (P9-1) ──────────────────────────
  useEffect(() => {
    if (!resumeTaskId) return;
    loadTaskSession(resumeTaskId); // eslint-disable-line react-hooks/set-state-in-effect
    onResumeDone?.();
  }, [resumeTaskId, loadTaskSession, onResumeDone]);

  // ─── Scroll → update currentPage ──────────────────────────
  const scrollIgnoreRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

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
    scrollIgnoreRef.current = true;
    maskScrollSyncRef.current = true;

    const scrollPanelToPage = (container) => {
      if (!container) return;
      const el = container.querySelector(`[data-page="${n}"]`);
      if (!el) return;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetTop = container.scrollTop + (elRect.top - containerRect.top) - 8;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    };

    scrollPanelToPage(scrollRef.current);
    scrollPanelToPage(maskPreviewScrollRef.current);

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      scrollIgnoreRef.current = false;
      maskScrollSyncRef.current = false;
    }, 900);
  }, [pageImages.length]);

  const handleMaskLeftScroll = useCallback(() => {
    if (maskScrollSyncRef.current) return;
    maskScrollSyncRef.current = true;
    if (maskPreviewScrollRef.current && scrollRef.current) {
      maskPreviewScrollRef.current.scrollTop = scrollRef.current.scrollTop;
    }
    maskScrollSyncRef.current = false;
  }, []);

  const handleMaskRightScroll = useCallback(() => {
    if (maskScrollSyncRef.current) return;
    maskScrollSyncRef.current = true;
    if (scrollRef.current && maskPreviewScrollRef.current) {
      scrollRef.current.scrollTop = maskPreviewScrollRef.current.scrollTop;
    }
    maskScrollSyncRef.current = false;
  }, []);

  // ─── S5: Right-click cancel handler (Slice 2: persist to backend) ──
  const persistCancelled = useCallback((newSet) => {
    if (!task) return;
    updateCancelledEntities(task.taskId, [...newSet]).catch(() => {});
  }, [task]);

  const cancelEntity = useCallback((entityId) => {
    if (!entityId) return;
    setTextEntities(prev => prev.filter(e => e.id !== entityId));
    setBoxes(prev => prev.filter(b => b.entityId !== entityId));
    cancelledRef.current.add(entityId);
    persistCancelled(cancelledRef.current);
    showToast('已取消该区域脱敏');
  }, [showToast, persistCancelled]);

  const handleRightClickBox = useCallback((box) => {
    setBoxes(prev => prev.filter(b => b.id !== box.id));
    (box.entityIds?.length ? box.entityIds : [box.entityId].filter(Boolean)).forEach(cancelEntity);
  }, [cancelEntity]);

  const handleRightClickEntity = useCallback((entity) => {
    cancelEntity(entity.id);
  }, [cancelEntity]);

  const createBoxForTextEntity = useCallback((entity) => {
    let offset = 0;
    for (const line of ocrBoxes) {
      const text = line.text || '';
      const lineStart = offset;
      const lineEnd = offset + text.length;
      offset = lineEnd + 1;
      if (entity.start < lineStart || entity.start >= lineEnd || !text.length) continue;
      const startInLine = Math.max(0, entity.start - lineStart);
      const endInLine = Math.min(text.length, entity.end - lineStart);
      const ratioStart = startInLine / text.length;
      const ratioWidth = Math.max(1 / text.length, (endInLine - startInLine) / text.length);
      return createNormalizedBox({
        id: `manual_box_${entity.id}`,
        page: line.page || line.pageNumber || 1,
        x: (line.x || 0) + (line.width || 0) * ratioStart,
        y: line.y || 0,
        width: (line.width || 0) * ratioWidth,
        height: line.height || 0.015,
        pageWidth: 595,
        pageHeight: 842,
        source: 'manual-text',
        entityType: entity.entity_type,
        text: entity.original,
        entityId: entity.id,
      });
    }
    return null;
  }, [ocrBoxes]);

  const handleAddManualEntity = useCallback(({ start, end, original }) => {
    const cleanOriginal = original.trim();
    if (!cleanOriginal) return;
    const entity = {
      id: `manual_${++entityIdCounterRef.current}`,
      original: cleanOriginal,
      entity_type: 'CUSTOM',
      start,
      end,
      source: 'manual',
    };
    setTextEntities(prev => {
      if (prev.some(e => e.start === start && e.end === end && e.original === cleanOriginal)) return prev;
      return [...prev, entity].sort((a, b) => a.start - b.start);
    });
    const box = createBoxForTextEntity(entity);
    if (box) setBoxes(prev => prev.some(b => b.entityId === entity.id) ? prev : [...prev, box]);
    showToast(box ? '已新增脱敏' : '已新增文本脱敏，遮蔽框需手动补充');
  }, [createBoxForTextEntity, showToast]);

  // P1.5: 画框后 OCR 反查 → 生成文本实体 → entityIds[]
  const handleBoxCreated = useCallback((newBox) => {
    if (!ocrBoxes?.length) return;
    const matchedEntities = [];
    let cumulativeOffset = 0;

    for (const line of ocrBoxes) {
      const bPage = line.page || line.pageNumber || 1;
      const lineLen = (line.text || '').length;
      const lineStart = cumulativeOffset;
      const lineEnd = cumulativeOffset + lineLen;

      if (bPage === newBox.page) {
        if (lineLen > 0) {
          // Vertical overlap check
          const lineY = line.y || 0;
          const lineH = line.height || 0;
          if (lineY < newBox.y + newBox.height && newBox.y < lineY + lineH) {
            const charWidth = (line.width || 0) / lineLen;

            const lineRight = (line.x || 0) + (line.width || 0);
            const boxRight = newBox.x + newBox.width;

            // Horizontal overlap
            if (lineRight > newBox.x && (line.x || 0) < boxRight) {
              const relStart = Math.max(0, (newBox.x - (line.x || 0)) / charWidth);
              const relEnd = Math.max(relStart, (boxRight - (line.x || 0)) / charWidth);
              let charStart = Math.floor(relStart);
              let charEnd = Math.ceil(relEnd);
              charStart = Math.max(0, Math.min(lineLen, charStart));
              charEnd = Math.max(charStart, Math.min(lineLen, charEnd));

              if (charStart < charEnd) {
                const coveredText = (line.text || '').substring(charStart, charEnd);
                if (coveredText.trim()) {
                  const globalStart = lineStart + charStart;
                  const globalEnd = lineStart + charEnd;

                  const existing = textEntitiesRef.current.find(
                    e => e.start === globalStart && e.end === globalEnd && e.original === coveredText
                  );

                  if (existing) {
                    matchedEntities.push(existing);
                  } else {
                    matchedEntities.push({
                      id: `ent_${++entityIdCounterRef.current}`,
                      original: coveredText,
                      entity_type: 'OCR',
                      start: globalStart,
                      end: globalEnd,
                      source: 'manual',
                    });
                  }
                }
              }
            }
          }
        }
      }

      cumulativeOffset = lineEnd + 1;
    }

    if (matchedEntities.length === 0) return;

    const entityIds = matchedEntities.map(e => e.id);
    setBoxes(prev => prev.map(b =>
      b.id === newBox.id ? { ...b, entityIds } : b
    ));

    setTextEntities(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      const toAdd = matchedEntities.filter(e => !existingIds.has(e.id));
      if (toAdd.length === 0) return prev;
      return [...prev, ...toAdd].sort((a, b) => a.start - b.start);
    });
  }, [ocrBoxes]);

  const handleTextChange = useCallback((nextText) => {
    const prevText = ocrTextRef.current;
    const prevEntities = textEntitiesRef.current;
    setOcrText(nextText);
    ocrTextRef.current = nextText;

    if (!prevText || !prevEntities?.length) {
      setTextEntities([]);
      setBoxes(prev => prev.filter(b => !b.entityId));
      cancelledRef.current = new Set();
      if (task?.taskId) updateCancelledEntities(task.taskId, []).catch(() => {});
      showToast('原文已更新，请重新滑选需要脱敏的内容');
      return;
    }

    // Longest common prefix
    const minLen = Math.min(prevText.length, nextText.length);
    let prefixLen = 0;
    while (prefixLen < minLen && prevText[prefixLen] === nextText[prefixLen]) prefixLen++;

    // Longest common suffix (after prefix)
    const maxSuffix = Math.min(prevText.length - prefixLen, nextText.length - prefixLen);
    let suffixLen = 0;
    while (suffixLen < maxSuffix &&
           prevText[prevText.length - 1 - suffixLen] === nextText[nextText.length - 1 - suffixLen]) {
      suffixLen++;
    }

    const oldChangeStart = prefixLen;
    const oldChangeEnd = prevText.length - suffixLen;
    const newChangeEnd = nextText.length - suffixLen;
    const delta = (newChangeEnd - prefixLen) - (oldChangeEnd - oldChangeStart);

    const keptEntities = [];
    const toCancel = [];

    for (const entity of prevEntities) {
      const { start, end, id } = entity;
      if (end <= oldChangeStart) {
        // Entity entirely before change region — keep as-is
        keptEntities.push(entity);
      } else if (start >= oldChangeEnd) {
        // Entity entirely after change region — shift offsets
        keptEntities.push({ ...entity, start: start + delta, end: end + delta });
      } else {
        // Entity overlaps change region — cancel
        toCancel.push(id);
      }
    }

    setTextEntities(keptEntities);
    textEntitiesRef.current = keptEntities;
    // Only remove boxes for cancelled entities — text offset changes do not
    // affect PDF/scan visual positions, so kept entities keep their existing boxes.
    setBoxes(prev => prev.filter(b => !b.entityId || !toCancel.includes(b.entityId)));

    // Update cancelled set
    for (const id of toCancel) cancelledRef.current.add(id);
    if (task?.taskId) updateCancelledEntities(task.taskId, [...cancelledRef.current]).catch(() => {});
    showToast(toCancel.length > 0
      ? `原文已更新，${toCancel.length} 个实体因位置变动已取消`
      : '原文已更新，实体位置已自动调整');
  }, [showToast, task]);

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

  // Keep refs in sync with state for handleTextChange
  useEffect(() => { ocrTextRef.current = ocrText; }, [ocrText]);
  useEffect(() => { textEntitiesRef.current = textEntities; }, [textEntities]);

  // Debounced save of edited text + entities (P0: persist edits across refresh)
  useEffect(() => {
    if (!task || !hasLoadedRef.current) return;
    const timer = setTimeout(() => {
      updateEditedText(task.taskId, { text: ocrText, textEntities }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [task, ocrText, textEntities]);

  // ─── Upload + Analyze ────────────────────────────────────────

  const handleFile = async (file) => {
    if (!file) return;
    localStorage.removeItem('activeTaskId');
    renderCacheRef.current = 'unknown';
    setLoading(true); setError(null); setBoxes([]); setTextEntities([]); textEntitiesRef.current = []; setOcrBoxes([]); setOcrText(''); ocrTextRef.current = ''; setPageImages([]); cancelledRef.current = new Set(); setUploadPercent(0); setProcessingStep('上传中…');
    try {
      const taskData = await uploadWithProgress(file, _settings?.rulesConfig, setUploadPercent);
      const normalized = normalizeTask(taskData);
      setTask(normalized); setUploadPercent(100);
      localStorage.setItem('activeTaskId', String(normalized.taskId));
      const initialModes = getAvailableModes(normalized.document_kind);
      setMode(prev => initialModes.includes(prev) ? prev : initialModes[0]);

      setProcessingStep('正在 OCR 识别…');
      const analyzeData = await analyzeTask(taskData.taskId);

      setProcessingStep('正在规则匹配…');

      const backendTextEntities = (analyzeData.textEntities || []).map(e => ({
        id: e.id,
        original: e.original || '',
        entity_type: e.entity_type || 'CUSTOM',
        start: e.start ?? 0,
        end: e.end ?? 0,
      }));
      const fullText = (analyzeData.ocrBoxes || []).map(b => b.text || '').join('\n');
      setTextEntities(backendTextEntities);
      textEntitiesRef.current = backendTextEntities;
      setOcrBoxes(analyzeData.ocrBoxes || []);
      setOcrText(fullText);
      ocrTextRef.current = fullText;

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

    if (mode === 'mask') {
      const hasFailedPages = Object.values(pageStatus).some(status => status === 'failed' || status === 'recovering');
      if (hasFailedPages) {
        showToast('有页面未成功加载，请恢复页面后再导出');
        return;
      }
    }

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
        const response = await textExportTask(task.taskId, payloadEntities, mode, exportFormat, ocrText);
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

  // ─── Empty state (no sidebar) ─────────────────────────────

  if (!task && !loading) {
    return (
      <div className="visual-mask-page" ref={containerRef}>
        <div className="tool-empty">
          <strong>请选择或上传文档</strong>
          <p>支持文本 PDF 和扫描 PDF 两种文件格式</p>
          <Button variant="default" onClick={() => fileInputRef.current?.click()}>上传新文件</Button>
        </div>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="visual-mask-page-full-loading" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ProgressBar percent={uploadPercent} step={processingStep || '正在加载任务…'} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="tool-error" style={{ padding: '40px', maxWidth: '600px', margin: '40px auto', textAlign: 'center' }}>
        <strong>处理失败</strong>
        <p>{error}</p>
        <Button variant="outline" onClick={() => { setError(null); setTask(null); }}>重试</Button>
      </div>
    );
  }

  return (
    <div className="workspace-container" ref={containerRef}>
      {/* 左栏：本案材料列表 */}
      <div className="workspace-sidebar">
        <h4 className="sidebar-title">本案材料</h4>
        
        {tasksLoading && tasks.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">加载中…</div>
        ) : (
          <div className="file-list">
            {tasks.length === 0 ? (
              <div className="text-xs text-muted-foreground py-8 text-center italic">暂无材料</div>
            ) : (
              tasks.map(t => {
                const isActive = task && task.taskId === t.id;
                return (
                  <div
                    key={t.id}
                    className={`file-card ${isActive ? 'active' : ''}`}
                    onClick={() => { if (!isActive) loadTaskSession(t.id); }}
                  >
                    <div className="file-card-title" title={t.filename}>{t.filename}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="file-card-delete-btn text-muted-foreground hover:text-destructive"
                      onClick={(e) => handleDeleteTask(t.id, e)}
                      title="删除材料"
                    >
                      ×
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="sidebar-upload-btn" onClick={() => fileInputRef.current?.click()}>
          ＋ 追加上传本地材料
        </div>
      </div>

      {/* 右栏：主编辑区 */}
      <div className="workspace-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}>
        {/* S4: Top bar — left=filename, center=modes, right=upload+export */}
        <div className="mask-topbar">
          <div className="mask-topbar-left">
            <span className="mask-filename">{task?.filename}</span>
          </div>
          <div className="mask-topbar-center">
            <div className="mode-switch">
              {MODES.filter(m => getAvailableModes(task?.document_kind).includes(m.key)).map(m => (
                <button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)} title={m.desc}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="mask-topbar-right" style={{ display: 'flex', gap: '8px' }}>
            <ExportDropdown mode={mode} onExport={doExport} exporting={exporting} disabled={isMaskMode ? redactionCount === 0 : textEntities.length === 0} />
          </div>
        </div>

        {isMaskMode ? (
          /* Mask mode: panel/header/body layout like text mode */
          <div className="mask-dual-column">
            <div className="mask-panel">
              <div className="mask-panel-header">
                <span className="mask-col-header-title">OCR 抽取原文</span>
                <div className="page-nav">
                  <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => scrollToPage(currentPage - 1)}>←</Button>
                  <span>{currentPage} / {totalPages}</span>
                  <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => scrollToPage(currentPage + 1)}>→</Button>
                </div>
              </div>
              <div className="mask-panel-body" ref={scrollRef} onScroll={handleMaskLeftScroll}>
                {pageImages.map((pg) => {
                  const pgInfo = { ...pg, taskId: task?.taskId };
                  return (
                    <div key={pg.pageNumber} className="mask-page-row" data-page={pg.pageNumber} ref={el => { pageRowRefs.current[pg.pageNumber] = el; }}>
                      <PageCanvas
                        pageInfo={pgInfo} boxes={boxes} onBoxesChange={setBoxes} onBoxCreated={handleBoxCreated} containerWidth={containerWidth}
                        selectedBox={selectedBox} onSelectBox={setSelectedBox}
                        hoveredBox={hoveredBox} onHoverBox={setHoveredBox}
                        onRightClickBox={handleRightClickBox}
                        status={pageStatus[pg.pageNumber]}
                        imageUrl={imageUrls[pg.pageNumber]}
                        onLoadSuccess={handlePageLoadSuccess}
                        onLoadError={handlePageLoadError}
                        onReloadPage={handleReloadPage}
                        onRerenderAll={handleRerenderAll}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mask-panel">
              <div className="mask-panel-header mask-panel-header-left">
                <span className="mask-col-header-title">脱敏预览</span>
              </div>
              <div className="mask-panel-body" ref={maskPreviewScrollRef} onScroll={handleMaskRightScroll}>
                {pageImages.map((pg) => {
                  const pgInfo = { ...pg, taskId: task?.taskId };
                  return (
                    <div key={pg.pageNumber} className="mask-page-row" data-page={pg.pageNumber}>
                      <MaskPreview
                        pageInfo={pgInfo} boxes={boxes} containerWidth={containerWidth}
                        selectedBox={selectedBox} hoveredBox={hoveredBox}
                        onRightClickBox={handleRightClickBox}
                        status={pageStatus[pg.pageNumber]}
                        imageUrl={imageUrls[pg.pageNumber]}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Star/Placeholder mode: text dual-column */
          <div className="text-mode-container">
            <TextDualColumn
              ocrText={ocrText}
              entities={textEntities}
              mode={mode}
              onRightClickEntity={handleRightClickEntity}
              onAddManualEntity={handleAddManualEntity}
              onTextChange={handleTextChange}
            />
          </div>
        )}
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
