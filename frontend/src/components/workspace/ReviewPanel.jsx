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
export default function ReviewPanel({ materialId, materialName, rulesConfig }) {
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(null);
  const [documentKind, setDocumentKind] = useState('');
  const [previewMd, setPreviewMd] = useState('');
  const [manifest, setManifest] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [diagInfo, setDiagInfo] = useState({
    processingStatus: '', verificationStatus: '', sourceSha256: '',
    rulesConfig: null, nerEnabled: null, preparedAt: null, updatedAt: null,
  });
  const [revealed, setRevealed] = useState(() => new Set());
  const [selection, setSelection] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [toast, setToast] = useState('');
  const previewRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A1: materialId 变化时彻底重置全部本地状态
      setLoading(true);
      setError(null);
      setDocumentKind('');
      setPreviewMd('');
      setManifest(null);
      setDecisions([]);
      setDiagInfo({ processingStatus: '', verificationStatus: '', sourceSha256: '', rulesConfig: null, nerEnabled: null, preparedAt: null, updatedAt: null });
      setRevealed(new Set());
      setSelection(null);
      setExporting(false);
      setShowExportConfirm(false);
      setDiagOpen(false);

      try {
        const data = await getReviewData(materialId);
        if (cancelled) return;
        setDocumentKind(data.documentKind);
        setPreviewMd(data.previewMd);
        setManifest(data.manifest);
        setDecisions(data.decisions);
        setDiagInfo({
          processingStatus: data.processingStatus || '',
          verificationStatus: data.verificationStatus || '',
          sourceSha256: data.sourceSha256 || '',
          rulesConfig: data.rulesConfig || null,
          nerEnabled: data.nerEnabled ?? null,
          preparedAt: data.preparedAt || null,
          updatedAt: data.updatedAt || null,
        });
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
      setDiagInfo({
        processingStatus: data.processingStatus || '',
        verificationStatus: data.verificationStatus || '',
        sourceSha256: data.sourceSha256 || '',
        rulesConfig: data.rulesConfig || null,
        nerEnabled: data.nerEnabled ?? null,
        preparedAt: data.preparedAt || null,
        updatedAt: data.updatedAt || null,
      });
    } catch (err) {
      // A2: 不再吞错，surface 给用户
      showToast(err.message || '刷新复核数据失败');
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const handlePrepare = async () => {
    try { setPreparing(true); setError(null); await prepareMaterial(materialId, rulesConfig); await refreshReview(); }
    catch (err) { setError(err.message); }
    finally { setPreparing(false); }
  };

  // 左键：确认脱敏（标记 confirmed），临时查看掩码变灰
  const handleConfirmRedact = async (decision) => {
    if (!decision.confirmed) {
      try {
        await updateDecisions(materialId, [{ id: decision.id, action: 'redact', confirmed: true }]);
        // 局部更新，不全量刷新
        setDecisions((prev) => prev.map((d) => d.id === decision.id ? { ...d, confirmed: true } : d));
      } catch (err) { showToast(err.message); }
    }
    toggleReveal(decision.id);
  };

  // 右键：keep（不脱敏）或 cancel（删除手工决策）
  const cancelRedaction = async (decision) => {
    try {
      const action = decision.origin === 'manual' ? 'cancel' : 'keep';
      await updateDecisions(materialId, [{ id: decision.id, action, confirmed: true }]);
      if (action === 'cancel') {
        // 删除该决策
        setDecisions((prev) => prev.filter((d) => d.id !== decision.id));
      } else {
        setDecisions((prev) => prev.map((d) => d.id === decision.id ? { ...d, action: 'keep', confirmed: true } : d));
      }
    } catch (err) { showToast(err.message); }
  };

  const toggleReveal = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
    // P1 fix: 使用 data-src 属性计算原始文本偏移（不受掩码长度影响）
    const startSpan = range.startContainer.parentElement?.closest('[data-src]');
    if (!startSpan) { setSelection(null); return; }
    const baseOffset = parseInt(startSpan.getAttribute('data-src'), 10) || 0;
    // 计算选区在该 span 内的字符偏移
    const preRange = document.createRange();
    preRange.selectNodeContents(startSpan);
    preRange.setEnd(range.startContainer, range.startOffset);
    const intraOffset = preRange.toString().length;
    const start = baseOffset + intraOffset;
    const selectedText = range.toString();
    const end = start + selectedText.length;
    if (start < 0 || end > block.text.length || start >= end) { setSelection(null); return; }
    const rect = range.getBoundingClientRect();
    setSelection({ blockId, start, end, x: rect.left, y: Math.max(12, rect.top - 36) });
  };

  const addManualRedaction = async () => {
    if (!selection) return;
    try {
      // A3: 后端返回新增决策的真实 id/origin，保证右键可精准删除
      const result = await updateDecisions(materialId, [{
        blockId: selection.blockId,
        start: selection.start,
        end: selection.end,
        action: 'redact',
        confirmed: true,
      }]);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      // 用后端返回的完整决策刷新（含真实 id）
      if (result?.added?.length) {
        setDecisions((prev) => [...prev, ...result.added]);
      } else {
        await refreshReview();
      }
    } catch (err) { showToast(err.message); }
  };

  // A5: 是否为不可导出的 PDF（扫描件/hybrid 禁用，pdf-text 可导出）
  const isUnsupportedPdf = documentKind === 'pdf-scan' || documentKind === 'pdf-hybrid';
  // A6: 统计
  const keepCount = decisions.filter((d) => d.action === 'keep').length;
  const manualCount = decisions.filter((d) => d.origin === 'manual').length;
  const unconfirmedCount = decisions.filter((d) => d.action === 'redact' && !d.confirmed).length;

  const handleExportClick = () => {
    if (isUnsupportedPdf) {
      showToast('扫描件/混合型 PDF 按决策导出尚未支持，请转换为 DOCX 或拆分处理');
      return;
    }
    // A6: 弹确认框
    setShowExportConfirm(true);
  };

  const handleConfirmExport = async () => {
    setShowExportConfirm(false);
    try {
      setExporting(true);
      await exportWithDecisions(materialId, materialName, unconfirmedCount > 0);
      showToast('导出成功');
      await refreshReview();
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const redactCount = decisions.filter((d) => d.action === 'redact').length;

  // 诊断信息计算
  const entityTypeStats = {};
  for (const d of decisions) {
    const t = d.entityType || 'UNKNOWN';
    entityTypeStats[t] = (entityTypeStats[t] || 0) + 1;
  }
  const dateOff = diagInfo.rulesConfig && diagInfo.rulesConfig.DATE === false;
  const isRegexOnly = diagInfo.nerEnabled === false;

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
        return <p key={block.id} data-block-id={block.id} className="review-block"><span data-src={0}>{text || ' '}</span></p>;
      }
      const parts = [];
      let cursor = 0;
      for (const d of blockD) {
        if (d.start < cursor) continue;
        // 普通文本：用 span 包裹并标注原始位置
        if (d.start > cursor) {
          const segStart = cursor;
          const segText = text.slice(cursor, d.start);
          parts.push(<span key={`t-${cursor}`} data-src={segStart}>{segText}</span>);
        }
        const original = text.slice(d.start, d.end);
        const isRevealed = revealed.has(d.id);
        const masked = maskValue(original, d.entityType);
        parts.push(
          <span
            key={`d-${d.id}`}
            data-src={d.start}
            data-decision-id={d.id}
            className={`redaction-mark${isRevealed ? ' revealed' : ''}`}
            title="左键确认脱敏（可临时查看原文） · 右键取消脱敏"
            onClick={(e) => { e.stopPropagation(); handleConfirmRedact(d); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); cancelRedaction(d); }}
          >
            {isRevealed ? original : masked}
          </span>
        );
        cursor = d.end;
      }
      if (cursor < text.length) {
        parts.push(<span key="t-end" data-src={cursor}>{text.slice(cursor)}</span>);
      }
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
          {/* A5: 扫描件/hybrid 禁用导出，pdf-text 和 DOCX 可用 */}
          <Button
            variant="default"
            onClick={handleExportClick}
            disabled={exporting || isUnsupportedPdf}
            title={isUnsupportedPdf ? '扫描件/混合型 PDF 按决策导出尚未支持' : ''}
          >
            {exporting ? '导出中…' : isUnsupportedPdf ? '导出尚未支持' : '导出脱敏副本'}
          </Button>
        </div>
      </div>

      {documentKind === 'pdf-scan' && (
        <div className="review-scan-note">扫描件基于 OCR 识别，属 best-effort；导出为不可逆的像素级脱敏。</div>
      )}

      <div className="review-body" ref={previewRef} onMouseUp={captureSelection}>
        {renderPreview()}
      </div>

      {/* 诊断信息折叠区 */}
      <div className="review-diagnostics">
        <button
          className="review-diagnostics-toggle"
          onClick={() => setDiagOpen(!diagOpen)}
          aria-expanded={diagOpen}
        >
          <span className={`chevron ${diagOpen ? 'open' : ''}`}>▶</span>
          <span>诊断信息</span>
        </button>
        {diagOpen && (
          <div className="review-diagnostics-body">
            <div className="diag-row">
              <span className="diag-label">documentKind</span>
              <span className="diag-value">{documentKind || '未知'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">processing_status</span>
              <span className="diag-value">{diagInfo.processingStatus || '未知'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">source_sha256</span>
              <span className="diag-value" title={diagInfo.sourceSha256}>
                {diagInfo.sourceSha256 ? `${diagInfo.sourceSha256.slice(0, 16)}…` : '未知'}
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-label">prepared_at</span>
              <span className="diag-value">{diagInfo.preparedAt || '未知'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">updated_at</span>
              <span className="diag-value">{diagInfo.updatedAt || '未知'}</span>
            </div>

            <div className="diag-section-title">预处理参数</div>
            {diagInfo.rulesConfig ? (
              <div className="diag-row">
                <span className="diag-label">rulesConfig</span>
                <span className="diag-value">
                  {Object.entries(diagInfo.rulesConfig)
                    .filter(([, v]) => v === false)
                    .map(([k]) => `${k}:off`)
                    .join(', ') || '全部启用'}
                </span>
              </div>
            ) : (
              <div className="diag-row">
                <span className="diag-label">rulesConfig</span>
                <span className="diag-value">未知（旧材料）</span>
              </div>
            )}
            {dateOff && (
              <div className="diag-date-off">DATE/TIME preserved（日期关闭，日期候选被过滤）</div>
            )}
            <div className="diag-row">
              <span className="diag-label">regex-only</span>
              <span className={`diag-value ${isRegexOnly ? 'alert' : ''}`}>
                {diagInfo.nerEnabled === null ? '未知' : isRegexOnly ? '是' : '否'}
              </span>
            </div>
            {isRegexOnly && (
              <div className="diag-alert">
                该材料预处理时使用 regex-only；如需 NER，请安装/修复模型后重新预处理。
              </div>
            )}

            <div className="diag-section-title">候选统计</div>
            <div className="diag-entity-stats">
              {Object.entries(entityTypeStats).map(([type, count]) => (
                <span key={type} className="diag-entity-tag">{type} ×{count}</span>
              ))}
            </div>

            <div className="diag-section-title">决策计数</div>
            <div className="diag-row">
              <span className="diag-label">redact</span>
              <span className="diag-value">{redactCount}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">keep</span>
              <span className="diag-value">{keepCount}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">manual</span>
              <span className="diag-value">{manualCount}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">confirmed</span>
              <span className="diag-value">{decisions.filter((d) => d.confirmed).length}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">unconfirmed</span>
              <span className="diag-value">{unconfirmedCount}</span>
            </div>
          </div>
        )}
      </div>

      {selection && (
        <div className="selection-popover" style={{ left: selection.x, top: selection.y }} onMouseDown={(e) => e.stopPropagation()}>
          <Button variant="ghost" onClick={addManualRedaction} className="text-white hover:bg-white/10 hover:text-white h-6 text-xs px-2 py-0 font-normal">脱敏</Button>
        </div>
      )}

      {/* A6: 导出确认弹窗 */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowExportConfirm(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-3">确认导出</h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              本次将导出：<strong>{redactCount}</strong> 处脱敏、<strong>{keepCount}</strong> 处保留、<strong>{manualCount}</strong> 处手工补标。
              {unconfirmedCount > 0 && (
                <><br />还有 <strong className="text-amber-600">{unconfirmedCount}</strong> 处自动标注未逐项确认，是否按当前状态统一确认并导出？</>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowExportConfirm(false)}>返回复核</Button>
              <Button variant="default" onClick={handleConfirmExport}>确认并导出</Button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </section>
  );
}
