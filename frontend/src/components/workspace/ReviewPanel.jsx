import { useState, useEffect, useRef } from 'react';
import { getReviewData, updateDecisions, completeReview, exportWithDecisions, prepareMaterial } from '../../api';
import { Button } from '@/components/ui/button';

/**
 * 描述: 脱敏复核面板（内联式）
 * 主要功能:
 *     - 渲染预处理出的 Markdown 文本预览
 *     - 脱敏候选以统一黄色高亮内联显示（默认掩码）
 *     - 左键点击 → 临时显示原文（变灰）；右键 → 取消脱敏还原为普通文字
 *     - 框选普通文字 → 弹出「脱敏」浮层，添加人工脱敏
 */
export default function ReviewPanel({ materialId, materialName }) {
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(null);
  const [processingStatus, setProcessingStatus] = useState('');
  const [documentKind, setDocumentKind] = useState('');
  const [previewMd, setPreviewMd] = useState('');
  const [manifest, setManifest] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [revealed, setRevealed] = useState(() => new Set()); // 临时显示原文的决策 id
  const [selection, setSelection] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState('');
  const previewRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await getReviewData(materialId);
        if (cancelled) return;
        setProcessingStatus(data.processingStatus);
        setDocumentKind(data.documentKind);
        setPreviewMd(data.previewMd);
        setManifest(data.manifest);
        setDecisions(data.decisions);
        setRevealed(new Set());
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [materialId]);

  const refreshReview = async () => {
    try {
      const data = await getReviewData(materialId);
      setProcessingStatus(data.processingStatus);
      setDocumentKind(data.documentKind);
      setPreviewMd(data.previewMd);
      setManifest(data.manifest);
      setDecisions(data.decisions);
    } catch (err) {
      console.warn('[ReviewPanel] refresh failed:', err.message);
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const handlePrepare = async () => {
    try { setPreparing(true); setError(null); await prepareMaterial(materialId); await refreshReview(); }
    catch (err) { setError(err.message); }
    finally { setPreparing(false); }
  };

  // 左键：临时切换显示原文/掩码
  const toggleReveal = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 右键：取消脱敏（自动候选→保留；手动候选→删除），还原为普通文字
  const cancelRedaction = async (decision) => {
    try {
      const action = decision.origin === 'manual' ? 'cancel' : 'keep';
      await updateDecisions(materialId, [{ id: decision.id, action, confirmed: true }]);
      await refreshReview();
    } catch (err) { showToast(err.message); }
  };

  // 框选普通文字 → 添加人工脱敏
  const captureSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel.rangeCount) { setSelection(null); return; }
    const range = sel.getRangeAt(0);
    const blockEl = range.startContainer.parentElement?.closest('[data-block-id]');
    if (!blockEl || !previewRef.current?.contains(blockEl)) { setSelection(null); return; }
    const blockId = blockEl.getAttribute('data-block-id');
    const block = (manifest?.blocks || []).find((b) => b.id === blockId);
    if (!block) { setSelection(null); return; }
    const start = block.text.indexOf(text);
    if (start < 0) { setSelection(null); return; }
    const rect = range.getBoundingClientRect();
    setSelection({ blockId, start, end: start + text.length, x: rect.left, y: Math.max(12, rect.top - 44) });
  };

  const addManualRedaction = async () => {
    if (!selection) return;
    try {
      await updateDecisions(materialId, [{ blockId: selection.blockId, start: selection.start, end: selection.end, action: 'redact', confirmed: true }]);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      await refreshReview();
    } catch (err) { showToast(err.message); }
  };

  const handleComplete = async () => {
    try {
      // 把所有未确认的自动候选按当前（脱敏）确认
      const unconfirmed = decisions.filter((d) => !d.confirmed && d.action === 'redact');
      if (unconfirmed.length) {
        await updateDecisions(materialId, unconfirmed.map((d) => ({ id: d.id, action: 'redact', confirmed: true })));
      }
      await completeReview(materialId);
      setProcessingStatus('ready');
      showToast('复核完成，可以导出');
      await refreshReview();
    } catch (err) { showToast(err.message); }
  };

  const handleExport = async () => {
    try { setExporting(true); await exportWithDecisions(materialId, materialName); showToast('导出成功'); }
    catch (err) { showToast(err.message); }
    finally { setExporting(false); }
  };

  const redactCount = decisions.filter((d) => d.action === 'redact').length;

  const renderPreview = () => {
    if (!previewMd && !(manifest?.blocks || []).length) {
      return <div className="review-empty">暂无预览内容</div>;
    }
    const blockDecisions = {};
    for (const d of decisions) {
      if (d.action !== 'redact') continue; // 仅渲染脱敏项；保留/取消的显示为普通文字
      (blockDecisions[d.blockId] ||= []).push(d);
    }
    return (manifest?.blocks || []).map((block) => {
      const text = block.text || '';
      const blockD = (blockDecisions[block.id] || []).sort((a, b) => a.start - b.start);
      if (!blockD.length) {
        return <p key={block.id} data-block-id={block.id} className="review-block">{text || ' '}</p>;
      }
      const parts = [];
      let cursor = 0;
      for (const d of blockD) {
        if (d.start < cursor) continue;
        if (d.start > cursor) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, d.start)}</span>);
        const original = text.slice(d.start, d.end);
        const isRevealed = revealed.has(d.id);
        parts.push(
          <span
            key={`d-${d.id}`}
            className={`redaction-mark${isRevealed ? ' revealed' : ''}`}
            title="左键查看原文 · 右键取消脱敏"
            onClick={(e) => { e.stopPropagation(); toggleReveal(d.id); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); cancelRedaction(d); }}
          >
            {isRevealed ? original : '＊'.repeat(Math.min(6, Math.max(1, [...original].length)))}
          </span>
        );
        cursor = d.end;
      }
      if (cursor < text.length) parts.push(<span key="t-end">{text.slice(cursor)}</span>);
      return <p key={block.id} data-block-id={block.id} className="review-block">{parts}</p>;
    });
  };

  if (loading) return <div className="review-state">正在加载复核数据…</div>;

  if (processingStatus === 'uploaded' || (!previewMd && !(manifest?.blocks || []).length && processingStatus !== 'ready')) {
    return (
      <div className="review-state review-prepare">
        <strong>材料尚未预处理</strong>
        <p>自动识别文档结构与敏感信息候选位置后开始复核。</p>
        <Button variant="default" onClick={handlePrepare} disabled={preparing}>{preparing ? '正在预处理…' : '开始预处理'}</Button>
        {error && <p className="review-error">{error}</p>}
      </div>
    );
  }

  return (
    <section className="review-panel">
      <div className="review-toolbar">
        <div className="review-toolbar-left">
          <span className="review-filename">{materialName}</span>
          <span className={`review-status ${processingStatus === 'ready' ? 'ready' : ''}`}>
            {processingStatus === 'ready' ? '可导出' : '待复核'}
          </span>
        </div>
        <div className="review-toolbar-right">
          <span className="review-count">{redactCount} 处脱敏</span>
          {processingStatus === 'ready' ? (
            <Button variant="default" onClick={handleExport} disabled={exporting}>{exporting ? '导出中…' : '导出脱敏副本'}</Button>
          ) : (
            <Button variant="default" onClick={handleComplete}>完成复核</Button>
          )}
        </div>
      </div>

      {documentKind === 'pdf-scan' && (
        <div className="review-scan-note">扫描件基于 OCR 识别，属 best-effort；导出为不可逆的像素级脱敏。</div>
      )}

      <div className="review-body" ref={previewRef} onMouseUp={captureSelection}>
        {renderPreview()}
      </div>

      <div className="review-hint">框选文字可手动脱敏 · 左键查看原文 · 右键取消脱敏</div>

      {selection && (
        <div className="selection-popover" style={{ left: selection.x, top: selection.y }} onMouseDown={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={addManualRedaction} className="text-white hover:bg-white/10 hover:text-white h-7 text-xs px-3 font-normal">脱敏</Button>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </section>
  );
}
