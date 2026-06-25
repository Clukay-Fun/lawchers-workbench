import { useState, useRef, useCallback } from 'react';
import { createTask, analyzeTask, updateTaskBoxes, maskExportTask, textExportTask } from '../api';
import { Button } from '@/components/ui/button';
import { normalizedToCSS, computeDisplaySize, createNormalizedBox } from '../services/coords';

// ─── Constants ───────────────────────────────────────────────

const BOX_MIN_SIZE = 0.005; // minimum 0.5% of page
const MODES = [
  { key: 'mask', label: '遮蔽', desc: '黑色遮挡块 → PDF' },
  { key: 'star', label: '星号', desc: '部分可见 → TXT/MD/DOCX' },
  { key: 'placeholder', label: '占位', desc: '类型标签 → TXT/MD/DOCX' },
];

// ─── Page Image Component ────────────────────────────────────

function PageCanvas({ pageInfo, boxes, onBoxesChange, containerWidth }) {
  const overlayRef = useRef(null);
  const [drawing, setDrawing] = useState(null); // { startX, startY } in normalized
  const [dragging, setDragging] = useState(null); // { boxId, offsetX, offsetY }
  const [resizing, setResizing] = useState(null); // { boxId, handle }
  const [hoveredBox, setHoveredBox] = useState(null);

  const { displayWidth, displayHeight } = computeDisplaySize(pageInfo, containerWidth, 900);

  // Convert mouse event to normalized coordinates
  const toNormalized = useCallback((e) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) / displayWidth,
      y: (e.clientY - rect.top) / displayHeight,
    };
  }, [displayWidth, displayHeight]);

  // ─── Drawing ────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    // Check if clicking on existing box
    const target = e.target;
    if (target.dataset.boxId) return; // handled by box
    if (target.dataset.handle) return; // handled by handle

    const pos = toNormalized(e);
    setDrawing({ startX: pos.x, startY: pos.y });
  }, [toNormalized]);

  const handleMouseMove = useCallback((e) => {
    if (drawing) {
      const pos = toNormalized(e);
      setDrawing(prev => prev ? { ...prev, currentX: pos.x, currentY: pos.y } : prev);
    }
    if (dragging) {
      const pos = toNormalized(e);
      const newX = Math.max(0, Math.min(1 - dragging.boxW, pos.x - dragging.offsetX));
      const newY = Math.max(0, Math.min(1 - dragging.boxH, pos.y - dragging.offsetY));
      onBoxesChange(prev => prev.map(b =>
        b.id === dragging.boxId ? { ...b, x: newX, y: newY } : b
      ));
    }
    if (resizing) {
      const pos = toNormalized(e);
      onBoxesChange(prev => prev.map(b => {
        if (b.id !== resizing.boxId) return b;
        const { handle } = resizing;
        let { x, y, width, height } = b;
        if (handle.includes('e')) width = Math.max(BOX_MIN_SIZE, pos.x - x);
        if (handle.includes('s')) height = Math.max(BOX_MIN_SIZE, pos.y - y);
        if (handle.includes('w')) {
          const newX = Math.min(pos.x, x + width - BOX_MIN_SIZE);
          width = width + (x - newX);
          x = newX;
        }
        if (handle.includes('n')) {
          const newY = Math.min(pos.y, y + height - BOX_MIN_SIZE);
          height = height + (y - newY);
          y = newY;
        }
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
        const newBox = createNormalizedBox({
          id: `manual_${Date.now()}`,
          page: pageInfo.pageNumber,
          x, y, width, height,
          pageWidth: pageInfo.pageWidth,
          pageHeight: pageInfo.pageHeight,
          source: 'manual',
        });
        onBoxesChange(prev => [...prev, newBox]);
      }
      setDrawing(null);
    }
    setDragging(null);
    setResizing(null);
  }, [drawing, toNormalized, pageInfo, onBoxesChange]);

  // ─── Box interaction handlers ────────────────────────────────
  const handleBoxMouseDown = useCallback((e, box) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const pos = toNormalized(e);
    setDragging({
      boxId: box.id,
      offsetX: pos.x - box.x,
      offsetY: pos.y - box.y,
      boxW: box.width,
      boxH: box.height,
    });
  }, [toNormalized]);

  const handleDeleteBox = useCallback((e, boxId) => {
    e.stopPropagation();
    onBoxesChange(prev => prev.filter(b => b.id !== boxId));
  }, [onBoxesChange]);

  const handleResizeStart = useCallback((e, boxId, handle) => {
    e.stopPropagation();
    setResizing({ boxId, handle });
  }, []);

  // ─── Render boxes as CSS ─────────────────────────────────────
  const pageBoxes = boxes.filter(b => b.page === pageInfo.pageNumber);

  return (
    <div className="page-canvas" style={{ position: 'relative', width: displayWidth, height: displayHeight }}>
      {/* Page image */}
      <img
        src={`/api/tasks/${pageInfo.taskId}/page-image/${pageInfo.pageNumber}`}
        alt={`Page ${pageInfo.pageNumber}`}
        style={{ width: displayWidth, height: displayHeight, display: 'block', userSelect: 'none' }}
        draggable={false}
      />

      {/* Overlay for mouse events */}
      <div
        ref={overlayRef}
        className="box-overlay"
        style={{
          position: 'absolute', top: 0, left: 0,
          width: displayWidth, height: displayHeight,
          cursor: 'crosshair',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Existing boxes */}
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          const isHovered = hoveredBox === box.id;
          const isSeal = box.source === 'seal';
          const borderColor = isSeal ? '#ef4444' : (isHovered ? '#ef4444' : '#3b82f6');
          const bgColor = isSeal ? 'rgba(239,68,68,0.15)' : (isHovered ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.1)');
          return (
            <div key={box.id}>
              {/* Box rectangle */}
              <div
                data-box-id={box.id}
                style={{
                  position: 'absolute',
                  left: css.left, top: css.top,
                  width: css.width, height: css.height,
                  border: `2px solid ${borderColor}`,
                  background: bgColor,
                  cursor: 'move',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseDown={(e) => handleBoxMouseDown(e, box)}
                onMouseEnter={() => setHoveredBox(box.id)}
                onMouseLeave={() => setHoveredBox(null)}
              >
                {/* Source label */}
                {isSeal && (
                  <span style={{
                    position: 'absolute', top: -16, left: 0,
                    fontSize: 10, color: '#ef4444', whiteSpace: 'nowrap',
                  }}>公章</span>
                )}
                {/* Delete button */}
                {isHovered && (
                  <button
                    style={{
                      position: 'absolute', top: -10, right: -10,
                      width: 20, height: 20, borderRadius: '50%',
                      background: '#ef4444', color: '#fff', border: 'none',
                      cursor: 'pointer', fontSize: 12, lineHeight: '20px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={(e) => handleDeleteBox(e, box.id)}
                    title="删除"
                  >
                    ×
                  </button>
                )}

                {/* Resize handles */}
                {isHovered && ['nw', 'ne', 'sw', 'se'].map(handle => (
                  <div
                    key={handle}
                    data-handle={handle}
                    style={{
                      position: 'absolute',
                      width: 8, height: 8, background: '#3b82f6', border: '1px solid #fff',
                      ...(handle.includes('n') ? { top: -4 } : { bottom: -4 }),
                      ...(handle.includes('w') ? { left: -4 } : { right: -4 }),
                      cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                    }}
                    onMouseDown={(e) => handleResizeStart(e, box.id, handle)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Drawing preview */}
        {drawing && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(drawing.startX, drawing.currentX || drawing.startX) * displayWidth,
              top: Math.min(drawing.startY, drawing.currentY || drawing.startY) * displayHeight,
              width: Math.abs((drawing.currentX || drawing.startX) - drawing.startX) * displayWidth,
              height: Math.abs((drawing.currentY || drawing.startY) - drawing.startY) * displayHeight,
              border: '2px dashed #3b82f6',
              background: 'rgba(59,130,246,0.1)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Preview Panel (masked view) ─────────────────────────────

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
      {/* Render black rectangles over the page image */}
      <svg width={displayWidth} height={displayHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
        {pageBoxes.map(box => {
          const css = normalizedToCSS(box, displayWidth, displayHeight);
          return (
            <rect
              key={box.id}
              x={css.left} y={css.top}
              width={css.width} height={css.height}
              fill="#000000" stroke="none"
            />
          );
        })}
      </svg>
      <div style={{
        position: 'absolute', bottom: 8, right: 8,
        color: 'rgba(0,0,0,0.45)', fontSize: 11,
        background: 'rgba(255,255,255,0.75)', padding: '2px 6px', borderRadius: 4,
      }}>
        遮蔽预览 · {pageBoxes.length} 个区域
      </div>
    </div>
  );
}

// ─── Main VisualMaskPage ─────────────────────────────────────

export default function VisualMaskPage({ settings }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [pageImages, setPageImages] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [mode, setMode] = useState('mask'); // 'mask' | 'star' | 'placeholder'
  const [exportFormat, setExportFormat] = useState('txt'); // 'txt' | 'md' | 'docx'
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  // Upload and analyze
  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setBoxes([]);
    setPageImages([]);

    try {
      // Upload file
      const taskData = await createTask(file, settings?.rulesConfig);
      setTask(taskData);

      // OCR analyze
      setAnalyzing(true);
      const analyzeData = await analyzeTask(taskData.taskId);
      setAnalyzing(false);

      // Convert OCR boxes to normalized boxes
      const ocrBoxes = (analyzeData.ocrBoxes || []).map((b, i) => createNormalizedBox({
        id: `ocr_${i}`,
        page: b.page,
        x: b.x, y: b.y, width: b.width, height: b.height,
        pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
        pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
        source: 'ocr',
        entityType: null,
      }));

      // Convert seal boxes to normalized boxes
      const sealBoxes = (analyzeData.sealBoxes || []).map((b, i) => createNormalizedBox({
        id: b.id || `seal_${i}`,
        page: b.page,
        x: b.x, y: b.y, width: b.width, height: b.height,
        pageWidth: analyzeData.manifest?.pages?.[b.page - 1]?.pageWidth || 595,
        pageHeight: analyzeData.manifest?.pages?.[b.page - 1]?.pageHeight || 842,
        source: 'seal',
        entityType: 'SEAL',
      }));

      const allBoxes = [...ocrBoxes, ...sealBoxes];
      setBoxes(allBoxes);
      setPageImages(analyzeData.manifest?.pages || []);
      setCurrentPage(1);
      const sealCount = sealBoxes.length;
      const ocrCount = ocrBoxes.length;
      showToast(`识别到 ${ocrCount} 个文字区域${sealCount > 0 ? `、${sealCount} 个公章（best-effort）` : ''}`);
    } catch (err) {
      setError(err.message);
      setAnalyzing(false);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Save boxes
  const handleSaveBoxes = async () => {
    if (!task) return;
    try {
      await updateTaskBoxes(task.taskId, boxes);
      showToast('已保存');
    } catch (err) {
      showToast(err.message || '保存失败');
    }
  };

  // Export masked PDF (mask mode)
  const handleExportMask = async () => {
    if (!task || boxes.length === 0) return;
    setExporting(true);
    try {
      await updateTaskBoxes(task.taskId, boxes);
      const response = await maskExportTask(task.taskId, boxes);
      const blob = await response.blob();
      const ext = task.filename ? task.filename.substring(task.filename.lastIndexOf('.')) : '.pdf';
      const baseName = task.filename ? task.filename.substring(0, task.filename.lastIndexOf('.')) : 'document';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.masked${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('遮蔽导出成功');
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // Export text replacement (star/placeholder mode)
  const handleExportText = async () => {
    if (!task || boxes.length === 0) return;
    setExporting(true);
    try {
      // Convert boxes to entities format for text export
      const entities = boxes.map(b => ({
        original: b.text || '', // OCR text from box
        entity_type: b.entityType || 'MANUAL',
        start: 0, end: 0, // Will be resolved by engine from OCR text
      })).filter(e => e.original);

      const response = await textExportTask(task.taskId, entities, mode, exportFormat);
      const blob = await response.blob();
      const baseName = task.filename ? task.filename.substring(0, task.filename.lastIndexOf('.')) : 'document';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.${mode === 'star' ? 'star' : 'placeholder'}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast(`${mode === 'star' ? '星号' : '占位'}导出成功 (${exportFormat.toUpperCase()})`);
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleExport = mode === 'mask' ? handleExportMask : handleExportText;

  const pageInfo = pageImages[currentPage - 1];
  const totalPages = pageImages.length;

  // ─── Empty state ─────────────────────────────────────────────
  if (!task && !loading) {
    return (
      <div className="tool-empty">
        <strong>上传 PDF 开始视觉遮蔽</strong>
        <p>支持文本 PDF 和扫描 PDF</p>
        <Button variant="default" onClick={() => fileInputRef.current?.click()}>选择文件</Button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
    );
  }

  if (loading) {
    return <div className="tool-loading">{analyzing ? '正在 OCR 识别文字区域…' : '正在上传…'}</div>;
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

  return (
    <div className="visual-mask-page" ref={containerRef}>
      {/* Top bar */}
      <div className="mask-toolbar">
        <div className="mask-toolbar-left">
          <span className="mask-filename">{task?.filename}</span>
          <span className="mask-box-count">{boxes.length} 个遮蔽区域</span>
          {boxes.some(b => b.source === 'seal') && (
            <span className="mask-seal-notice">公章识别为 best-effort，不保证全中</span>
          )}
        </div>
        <div className="mask-toolbar-center">
          <div className="mode-switch">
            {MODES.map(m => (
              <button
                key={m.key}
                className={`mode-btn ${mode === m.key ? 'active' : ''}`}
                onClick={() => setMode(m.key)}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode !== 'mask' && (
            <select
              className="format-select"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
            >
              <option value="txt">TXT</option>
              <option value="md">MD</option>
              <option value="docx">DOCX</option>
            </select>
          )}
          {totalPages > 1 && (
            <div className="page-nav">
              <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>←</Button>
              <span>{currentPage} / {totalPages}</span>
              <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>→</Button>
            </div>
          )}
        </div>
        <div className="mask-toolbar-right">
          <Button variant="outline" size="sm" onClick={handleSaveBoxes}>保存框</Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>换文件</Button>
          <Button variant="default" size="sm" onClick={handleExport} disabled={exporting || boxes.length === 0}>
            {exporting ? '导出中…' : mode === 'mask' ? '导出遮蔽 PDF' : `导出${mode === 'star' ? '星号' : '占位'} ${exportFormat.toUpperCase()}`}
          </Button>
        </div>
      </div>

      {/* Dual column */}
      <div className="mask-dual-column">
        <div className="mask-left-panel">
          {pageInfo && (
            <PageCanvas
              pageInfo={{ ...pageInfo, taskId: task?.taskId }}
              boxes={boxes}
              onBoxesChange={setBoxes}
              containerWidth={600}
            />
          )}
        </div>
        <div className="mask-right-panel">
          {pageInfo && (
            <MaskPreview
              pageInfo={{ ...pageInfo, taskId: task?.taskId }}
              boxes={boxes}
              containerWidth={400}
            />
          )}
        </div>
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf" onChange={(e) => handleFile(e.target.files?.[0])} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
