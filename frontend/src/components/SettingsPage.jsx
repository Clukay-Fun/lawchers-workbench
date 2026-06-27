import { useState, useEffect, useCallback } from 'react';
import { getDiagnostics, updateSettings } from '../api';

let cachedDiagnostics = null;
let diagnosticsPromise = null;

export default function SettingsPage({ settings, onSettingsChange }) {
  const [diagnostics, setDiagnostics] = useState(cachedDiagnostics);
  const [loading, setLoading] = useState(!cachedDiagnostics);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  // Load diagnostics (cached)
  useEffect(() => {
    if (cachedDiagnostics) return;
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    if (!diagnosticsPromise) {
      diagnosticsPromise = getDiagnostics().finally(() => {});
    }
    diagnosticsPromise
      .then((data) => {
        cachedDiagnostics = data;
        if (!cancelled) setDiagnostics(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Persist a single setting to backend
  const persist = useCallback(async (key, value) => {
    setSaving(true);
    try {
      await updateSettings({ [key]: value });
      onSettingsChange(prev => ({ ...prev, [key]: value }));
      showToast('已保存');
    } catch (err) {
      showToast(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [onSettingsChange]);

  const isNerOff = diagnostics?.nerEnabled === false || diagnostics?.nerEnabled === 'unknown';

  const engineRows = [
    { label: '识别引擎', value: diagnostics?.binPath ? '已安装' : '未安装' },
    { label: 'NER 模型', value: diagnostics?.nerEnabled === true ? '已启用' : diagnostics?.nerEnabled === false ? '未启用' : String(diagnostics?.nerEnabled || '—'), alert: diagnostics?.nerEnabled === false },
    { label: '规则路径', value: diagnostics?.rulesPath ? '已加载' : '—' },
  ];

  return (
    <div className="settings-view">
      <h2 className="settings-group-title">识别</h2>
      <section className="settings-section">
        <div className="settings-row">
          <span><strong>识别质量</strong><small>影响文字识别的精细程度，质量越高越慢</small></span>
          <select
            value={settings.recognitionQuality || 'standard'}
            onChange={(e) => persist('recognitionQuality', e.target.value)}
          >
            <option value="fast">快速（适合简单文档）</option>
            <option value="standard">标准</option>
            <option value="fine">精细（适合复杂排版）</option>
          </select>
        </div>
      </section>

      <h2 className="settings-group-title">上传</h2>
      <section className="settings-section">
        <div className="settings-row">
          <span><strong>单个文件大小上限</strong><small>超过限制的文件会被拒绝上传</small></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.uploadMaxMB || 100}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0 && v <= 500) {
                  onSettingsChange(prev => ({ ...prev, uploadMaxMB: v }));
                }
              }}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0 && v <= 500) {
                  persist('uploadMaxMB', v);
                }
              }}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 13, color: 'var(--base01)' }}>MB</span>
          </div>
        </div>
      </section>

      <h2 className="settings-group-title">脱敏</h2>
      <section className="settings-section">
        <div className="settings-row">
          <span><strong>脱敏符号</strong><small>用于文本预览中的统一脱敏标记</small></span>
          <select
            value={settings.maskChar || '*'}
            onChange={(e) => persist('maskChar', e.target.value)}
          >
            <option value="*">星号（王*锤 / 138****5678）</option>
            <option value="●">圆点（王●锤 / 138●●●●5678）</option>
            <option value="_">下划线（王_锤 / 138____5678）</option>
          </select>
        </div>
        <div className="settings-row">
          <span><strong>保持原文件格式</strong><small>DOCX、PDF、Markdown 与 TXT 均生成同格式副本</small></span>
          <button
            className={`toggle-btn ${settings.preserveFormat ? 'on' : 'off'}`}
            onClick={() => persist('preserveFormat', !settings.preserveFormat)}
            disabled={saving}
          >
            {settings.preserveFormat ? '已启用' : '已停用'}
          </button>
        </div>
        <div className="settings-row">
          <span><strong>导出前残留检查</strong><small>复检失败时阻止下载</small></span>
          <button
            className={`toggle-btn ${settings.verifyBeforeExport ? 'on' : 'off'}`}
            onClick={() => persist('verifyBeforeExport', !settings.verifyBeforeExport)}
            disabled={saving}
          >
            {settings.verifyBeforeExport ? '已启用' : '已停用'}
          </button>
        </div>
      </section>

      <h2 className="settings-group-title">引擎状态</h2>
      <section className="settings-section">
        {isNerOff && (
          <div className="engine-alert">
            <strong>NER 未启用：</strong>当前将以 regex-only 运行，姓名/机构/地址识别能力会下降。
          </div>
        )}
        {loading ? (
          <div className="engine-status-loading">正在加载诊断信息…</div>
        ) : (
          <div className="engine-status-grid">
            {engineRows.map((row) => (
              <div key={row.label} className={`engine-status-row${row.alert ? ' alert' : ''}`}>
                <span className="engine-status-label">{row.label}</span>
                <span className="engine-status-value" title={String(row.value)}>
                  {String(row.value || '—')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
