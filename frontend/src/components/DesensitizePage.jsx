import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { createTask, exportTask } from '../api';
import { Button } from '@/components/ui/button';

const ENTITY_COLORS = {
  PERSON: { bg: '#dbeafe', border: '#3b82f6', label: '姓名' },
  ORG: { bg: '#fce7f3', border: '#ec4899', label: '机构' },
  PHONE: { bg: '#d1fae5', border: '#10b981', label: '手机' },
  ID_CARD: { bg: '#fef3c7', border: '#f59e0b', label: '证件' },
  EMAIL: { bg: '#e0e7ff', border: '#6366f1', label: '邮箱' },
  MONEY: { bg: '#fef9c3', border: '#eab308', label: '金额' },
  DATE: { bg: '#f0f9ff', border: '#0ea5e9', label: '日期' },
  TIME: { bg: '#f0f9ff', border: '#0ea5e9', label: '时间' },
  LOC: { bg: '#ecfdf5', border: '#14b8a6', label: '地点' },
  ADDRESS: { bg: '#ecfdf5', border: '#14b8a6', label: '地址' },
};

function maskValue(original, entityType) {
  if (!original) return '';
  const chars = [...original];
  const len = chars.length;
  switch (entityType) {
    case 'PHONE': return len >= 11 ? chars.slice(0, 3).join('') + '****' + chars.slice(-4).join('') : chars[0] + '***';
    case 'ID_CARD': return len >= 15 ? chars.slice(0, 4).join('') + '*'.repeat(len - 8) + chars.slice(-4).join('') : chars.slice(0, 3).join('') + '*'.repeat(Math.max(1, len - 6)) + chars.slice(-3).join('');
    case 'PERSON': return chars[0] + '*'.repeat(Math.max(1, len - 1));
    case 'ORG': return len > 4 ? chars.slice(0, 2).join('') + '*'.repeat(Math.max(2, len - 4)) + chars.slice(-2).join('') : chars[0] + '*'.repeat(Math.max(1, len - 1));
    case 'EMAIL': { const at = original.indexOf('@'); return at > 0 ? chars.slice(0, Math.min(2, at)).join('') + '***' + original.slice(at) : chars.slice(0, 2).join('') + '***'; }
    case 'MONEY': return '****' + (chars[len - 1] || '');
    case 'DATE': case 'TIME': return chars.map(c => '年月日号时分秒'.includes(c) ? c : '*').join('');
    default: return chars[0] + '***';
  }
}

function EntityList({ decisions, onToggle }) {
  const byType = {};
  for (const d of decisions) {
    const t = d.entityType || 'OTHER';
    (byType[t] ||= []).push(d);
  }
  return (
    <div className="entity-list">
      {Object.entries(byType).map(([type, items]) => {
        const style = ENTITY_COLORS[type] || { bg: '#f1f5f9', border: '#94a3b8', label: type };
        return (
          <div key={type} className="entity-group">
            <div className="entity-group-head">
              <span className="entity-dot" style={{ background: style.border }} />
              <strong>{style.label}</strong>
              <span className="entity-count">{items.length}</span>
            </div>
            {items.map((d) => (
              <div
                key={d.id}
                className={`entity-item ${d.action === 'keep' ? 'kept' : ''}`}
                onClick={() => onToggle(d)}
                title={d.action === 'redact' ? '点击保留（不脱敏）' : '点击脱敏'}
              >
                <span className="entity-original">{d.original}</span>
                <span className="entity-action">{d.action === 'redact' ? '脱敏' : '保留'}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PreviewPane({ previewMd, manifest, decisions, revealed, onToggleReveal, onAddManual }) {
  const previewRef = useRef(null);

  const blockDecisions = useMemo(() => {
    const map = {};
    for (const d of decisions) {
      if (d.action !== 'redact') continue;
      (map[d.blockId] ||= []).push(d);
    }
    return map;
  }, [decisions]);

  const captureSelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const blockEl = range.startContainer.parentElement?.closest('[data-block-id]');
    if (!blockEl || !previewRef.current?.contains(blockEl)) return;
    const blockId = blockEl.getAttribute('data-block-id');
    const block = (manifest?.blocks || []).find((b) => b.id === blockId);
    if (!block) return;
    const startSpan = range.startContainer.parentElement?.closest('[data-src]');
    if (!startSpan) return;
    const baseOffset = parseInt(startSpan.getAttribute('data-src'), 10) || 0;
    const preRange = document.createRange();
    preRange.selectNodeContents(startSpan);
    preRange.setEnd(range.startContainer, range.startOffset);
    const intraOffset = preRange.toString().length;
    const start = baseOffset + intraOffset;
    const end = start + text.length;
    if (start < 0 || end > block.text.length || start >= end) return;
    const rect = range.getBoundingClientRect();
    onAddManual({ blockId, start, end, x: rect.left, y: Math.max(12, rect.top - 36) });
  }, [manifest, onAddManual]);

  return (
    <div className="review-body" ref={previewRef} onMouseUp={captureSelection}>
      {(manifest?.blocks || []).map((block) => {
        const text = block.text || '';
        const blockD = (blockDecisions[block.id] || []).sort((a, b) => a.start - b.start);
        if (!blockD.length) {
          return <p key={block.id} data-block-id={block.id} className="review-block"><span data-src={0}>{text || ' '}</span></p>;
        }
        const parts = [];
        let cursor = 0;
        for (const d of blockD) {
          if (d.start < cursor) continue;
          if (d.start > cursor) parts.push(<span key={`t-${cursor}`} data-src={cursor}>{text.slice(cursor, d.start)}</span>);
          const original = text.slice(d.start, d.end);
          const isRevealed = revealed.has(d.id);
          const masked = maskValue(original, d.entityType);
          const style = ENTITY_COLORS[d.entityType] || { bg: '#fef08a', border: '#facc15' };
          parts.push(
            <span
              key={`d-${d.id}`}
              data-src={d.start}
              className={`redaction-mark${isRevealed ? ' revealed' : ''}`}
              style={d.action === 'redact' ? { background: style.bg, borderColor: style.border } : undefined}
              title="左键临时查看 · 右键取消脱敏"
              onClick={(e) => { e.stopPropagation(); onToggleReveal(d.id); }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(d, 'keep'); }}
            >
              {isRevealed ? original : masked}
            </span>
          );
          cursor = d.end;
        }
        if (cursor < text.length) parts.push(<span key="t-end" data-src={cursor}>{text.slice(cursor)}</span>);
        return <p key={block.id} data-block-id={block.id} className="review-block">{parts}</p>;
      })}
    </div>
  );
}

export default function DesensitizePage({ settings }) {
  const [task, setTask] = useState(null); // { taskId, filename, ext, documentKind, manifest, sourceMap, decisions, previewMd, ... }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revealed, setRevealed] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState('');
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [manualPopover, setManualPopover] = useState(null); // { blockId, start, end, x, y }
  const fileInputRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setTask(null);
    setRevealed(new Set());
    try {
      const data = await createTask(file, settings?.rulesConfig);
      const decisions = (data.manifest?.candidates || []).map((c) => ({
        id: c.id,
        blockId: c.blockId,
        start: c.start,
        end: c.end,
        action: 'redact',
        origin: 'automatic',
        entityType: c.entityType,
        original: c.original || c.text || '',
        confirmed: false,
      }));
      setTask({ ...data, decisions });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleDecision = useCallback((decision, newAction) => {
    setTask((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        decisions: prev.decisions.map((d) =>
          d.id === decision.id ? { ...d, action: newAction || (d.action === 'redact' ? 'keep' : 'redact') } : d
        ),
      };
    });
  }, []);

  const toggleReveal = useCallback((id) => {
    setRevealed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const handleAddManual = useCallback(({ blockId, start, end, x, y }) => {
    setManualPopover({ blockId, start, end, x, y });
  }, []);

  const confirmManual = useCallback(() => {
    if (!manualPopover || !task) return;
    const block = task.manifest?.blocks?.find((b) => b.id === manualPopover.blockId);
    if (!block) { setManualPopover(null); return; }
    const newDecision = {
      id: `manual_${Date.now()}`,
      blockId: manualPopover.blockId,
      start: manualPopover.start,
      end: manualPopover.end,
      action: 'redact',
      origin: 'manual',
      entityType: 'MANUAL',
      confirmed: false,
    };
    setTask((prev) => ({ ...prev, decisions: [...prev.decisions, newDecision] }));
    window.getSelection()?.removeAllRanges();
    setManualPopover(null);
  }, [manualPopover, task]);

  const handleExport = async () => {
    if (!task) return;
    setShowExportConfirm(false);
    setExporting(true);
    try {
      const response = await exportTask(task.taskId, {
        decisions: task.decisions,
      });
      const blob = await response.blob();
      const ext = task.filename ? task.filename.substring(task.filename.lastIndexOf('.')) : '';
      const baseName = task.filename ? task.filename.substring(0, task.filename.lastIndexOf('.')) : 'document';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.redacted${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('导出成功');
    } catch (err) {
      showToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const redactCount = task?.decisions?.filter((d) => d.action === 'redact').length || 0;
  const keepCount = task?.decisions?.filter((d) => d.action === 'keep').length || 0;
  const manualCount = task?.decisions?.filter((d) => d.origin === 'manual').length || 0;
  const unconfirmedCount = task?.decisions?.filter((d) => d.action === 'redact' && !d.confirmed).length || 0;
  const isUnsupportedPdf = task?.documentKind?.includes('pdf');

  if (!task && !loading) {
    return (
      <div className="tool-empty">
        <strong>上传一份文档开始脱敏</strong>
        <p>支持 DOCX、PDF、TXT、MD</p>
        <Button variant="default" onClick={() => fileInputRef.current?.click()}>选择文件</Button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>
    );
  }

  if (loading) {
    return <div className="tool-loading">正在识别文档结构与敏感信息…</div>;
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
    <div className="desensitize-layout">
      {/* 左侧：实体列表 */}
      <aside className="entity-panel">
        <div className="entity-panel-head">
          <h3>识别结果</h3>
          <span className="entity-total">{task.decisions.length} 处</span>
        </div>
        <EntityList decisions={task.decisions} onToggle={toggleDecision} />
      </aside>

      {/* 右侧：预览 + 工具栏 */}
      <div className="preview-panel">
        <div className="preview-toolbar">
          <span className="preview-filename">{task.filename}</span>
          <div className="preview-toolbar-right">
            <span className="preview-count">{redactCount} 处脱敏</span>
            <Button
              variant="default"
              onClick={handleExportClick}
              disabled={exporting || isUnsupportedPdf}
              title={isUnsupportedPdf ? 'PDF 按决策导出尚未支持' : ''}
            >
              {exporting ? '导出中…' : isUnsupportedPdf ? '导出尚未支持' : '导出脱敏副本'}
            </Button>
          </div>
        </div>

        {isUnsupportedPdf && (
          <div className="review-scan-note">PDF 按决策导出尚未支持，请转换为 DOCX 或拆分处理。</div>
        )}

        <PreviewPane
          previewMd={task.previewMd}
          manifest={task.manifest}
          decisions={task.decisions}
          revealed={revealed}
          onToggleReveal={toggleReveal}
          onToggle={toggleDecision}
          onAddManual={handleAddManual}
        />

        {/* 手动新增浮层 */}
        {manualPopover && (
          <div className="selection-popover" style={{ left: manualPopover.x, top: manualPopover.y }} onMouseDown={(e) => e.stopPropagation()}>
            <Button variant="ghost" onClick={confirmManual} className="text-white hover:bg-white/10 hover:text-white h-6 text-xs px-2 py-0 font-normal">脱敏</Button>
          </div>
        )}
      </div>

      {/* 导出确认弹窗 */}
      {showExportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowExportConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>确认导出</h3>
            <p>
              本次将导出：<strong>{redactCount}</strong> 处脱敏、<strong>{keepCount}</strong> 处保留、<strong>{manualCount}</strong> 处手工补标。
              {unconfirmedCount > 0 && (
                <><br />还有 <strong className="text-amber-600">{unconfirmedCount}</strong> 处自动标注未逐项确认，是否按当前状态统一确认并导出？</>
              )}
            </p>
            <div className="modal-actions">
              <Button variant="outline" onClick={() => setShowExportConfirm(false)}>返回复核</Button>
              <Button variant="default" onClick={handleExport}>确认并导出</Button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );

  function handleExportClick() {
    if (isUnsupportedPdf) {
      showToast('PDF 按决策导出尚未支持，请转换为 DOCX 或拆分处理');
      return;
    }
    setShowExportConfirm(true);
  }
}
