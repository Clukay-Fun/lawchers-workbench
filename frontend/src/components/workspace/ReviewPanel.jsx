import { useState, useEffect, useRef } from 'react';
import { getReviewData, updateDecisions, exportWithDecisions, prepareMaterial } from '../../api';
import { Button } from '@/components/ui/button';

/**
 * A4: 掩码规则表 — 按实体类型生成部分掩码
 */
function maskValue(original, entityType) {
  if (!original) return '';
  const chars = [...original];
  const len = chars.length;
  switch (entityType) {
    case 'PHONE':
    case 'LANDLINE': {
      // 138****5678 / 010-****5678
      if (len >= 11) return chars.slice(0, 3).join('') + '****' + chars.slice(-4).join('');
      if (len >= 8) return chars.slice(0, Math.min(3, len - 4)).join('') + '****' + chars.slice(-4).join('');
      return chars[0] + '***';
    }
    case 'ID_CARD': {
      // 1101**********1234
      if (len >= 15) return chars.slice(0, 4).join('') + '*'.repeat(len - 8) + chars.slice(-4).join('');
      return chars.slice(0, 3).join('') + '*'.repeat(Math.max(1, len - 6)) + chars.slice(-3).join('');
    }
    case 'PERSON': {
      // 王**
      return chars[0] + '*'.repeat(Math.max(1, len - 1));
    }
    case 'ORG': {
      // 北京****公司
      if (len > 4) return chars.slice(0, 2).join('') + '*'.repeat(Math.max(2, len - 4)) + chars.slice(-2).join('');
      return chars[0] + '*'.repeat(Math.max(1, len - 1));
    }
    case 'EMAIL': {
      // wa***@a.com
      const atIdx = original.indexOf('@');
      if (atIdx > 0) {
        const local = original.slice(0, atIdx);
        const domain = original.slice(atIdx);
        const localChars = [...local];
        return localChars.slice(0, Math.min(2, localChars.length)).join('') + '***' + domain;
      }
      return chars.slice(0, 2).join('') + '***';
    }
    case 'BANK_CARD': {
      // ****1234
      if (len >= 8) return '*'.repeat(len - 4) + chars.slice(-4).join('');
      return '*'.repeat(Math.max(1, len - 2)) + chars.slice(-2).join('');
    }
    case 'MONEY': {
      // ****元
      return '****' + (chars[len - 1] || '');
    }
    case 'DATE':
    case 'TIME': {
      // ****年**月**日
      let result = '';
      for (const c of chars) {
        result += '年月日号时分秒'.includes(c) ? c : '*';
      }
      return result;
    }
    default:
      return chars[0] + '***';
  }
}

/**
 * 描述: 脱敏复核面板（内联式）
 */
export default function ReviewPanel({ materialId, materialName }) {
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(null);
  const [documentKind, setDocumentKind] = useState('');
  const [previewMd, setPreviewMd] = useState('');
  const [manifest, setManifest] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [revealed, setRevealed] = useState(() => new Set());
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

  const toggleReveal = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const cancelRedaction = async (decision) => {
    try {
      const action = decision.origin === 'manual' ? 'cancel' : 'keep';
      await updateDecisions(materialId, [{ id: decision.id, action, confirmed: true }]);
      await refreshReview();
    } catch (err) { showToast(err.message); }
  };

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
    // P1 fix: 计算 DOM Range 相对 block 元素的真实字符偏移（不用 indexOf，避免重复文字定位到第一次出现）
    const blockRange = document.createRange();
    blockRange.selectNodeContents(blockEl);
    blockRange.setEnd(range.startContainer, range.startOffset);
    const start = blockRange.toString().length;
    const selectedText = range.toString();
    if (start < 0 || !selectedText) { setSelection(null); return; }
    const end = start + selectedText.length;
    if (end > block.text.length) { setSelection(null); return; }
    const rect = range.getBoundingClientRect();
    setSelection({ blockId, start, end, x: rect.left, y: Math.max(12, rect.top - 36) });
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
      if (d.action !== 'redact') continue;
      (blockDecisions[d.blockId] ||= []).push(d);
    }
    return (manifest?.blocks || []).map((block) => {
      const text = block.text || '';
      const blockD = (blockDecisions[block.id] || []).sort((a, b) => a.start - b.start);
      if (!blockD.length) {
        return <p key={block.id} data-block-id={block.id} className="review-block">{text || ' '}</p>;
      }
      const parts = [];
      let cursor = 0;
      for (const d of blockD) {
        if (d.start < cursor) continue;
        if (d.start > cursor) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, d.start)}</span>);
        const original = text.slice(d.start, d.end);
        const isRevealed = revealed.has(d.id);
        const masked = maskValue(original, d.entityType);
        parts.push(
          <span
            key={`d-${d.id}`}
            className={`redaction-mark${isRevealed ? ' revealed' : ''}`}
            title="左键查看原文 · 右键取消脱敏"
            onClick={(e) => { e.stopPropagation(); toggleReveal(d.id); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); cancelRedaction(d); }}
          >
            {isRevealed ? original : masked}
          </span>
        );
        cursor = d.end;
      }
      if (cursor < text.length) parts.push(<span key="t-end">{text.slice(cursor)}</span>);
      return <p key={block.id} data-block-id={block.id} className="review-block">{parts}</p>;
    });
  };

  if (loading) return <div className="review-state">正在加载复核数据…</div>;

  if (!previewMd && !(manifest?.blocks || []).length) {
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
        </div>
        <div className="review-toolbar-right">
          <span className="review-count">{redactCount} 处脱敏</span>
          <Button variant="default" onClick={handleExport} disabled={exporting}>{exporting ? '导出中…' : '导出脱敏副本'}</Button>
        </div>
      </div>

      {documentKind === 'pdf-scan' && (
        <div className="review-scan-note">扫描件基于 OCR 识别，属 best-effort；导出为不可逆的像素级脱敏。</div>
      )}

      <div className="review-body" ref={previewRef} onMouseUp={captureSelection}>
        {renderPreview()}
      </div>

      {selection && (
        <div className="selection-popover" style={{ left: selection.x, top: selection.y }} onMouseDown={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={addManualRedaction} className="text-white hover:bg-white/10 hover:text-white h-6 text-xs px-2 py-0 font-normal">脱敏</Button>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </section>
  );
}
