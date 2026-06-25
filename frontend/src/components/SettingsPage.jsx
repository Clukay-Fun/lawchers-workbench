import { useState, useEffect } from 'react';
import { getDiagnostics } from '../api';

export default function SettingsPage({ settings, onSettingsChange }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDiagnostics()
      .then((data) => { if (!cancelled) setDiagnostics(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const isNerOff = diagnostics?.nerEnabled === false || diagnostics?.nerEnabled === 'unknown';
  const dateRules = diagnostics?.defaultRules || {};

  const rows = [
    { label: 'legal-desens 路径', value: diagnostics?.binPath },
    { label: '安装版本', value: diagnostics?.installedVersion },
    { label: 'requirements pin commit', value: diagnostics?.pinnedCommit },
    { label: 'NER 状态', value: diagnostics?.nerEnabled === true ? '已启用' : diagnostics?.nerEnabled === false ? '未启用' : String(diagnostics?.nerEnabled || 'unknown'), alert: diagnostics?.nerEnabled === false },
    { label: 'NER model_dir', value: diagnostics?.modelDir },
    { label: '规则路径', value: diagnostics?.rulesPath },
    { label: '默认规则', value: Object.entries(dateRules).filter(([, v]) => v === false).map(([k]) => `${k} 关闭`).join('、') || '全部启用' },
  ];

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h2>引擎状态</h2>
        {isNerOff && (
          <div className="engine-alert">
            <strong>NER 未启用：</strong>当前将以 regex-only 运行，姓名/机构/地址识别能力会下降。
          </div>
        )}
        {loading ? (
          <div className="engine-status-loading">正在加载诊断信息…</div>
        ) : (
          <div className="engine-status-grid">
            {rows.map((row) => (
              <div key={row.label} className={`engine-status-row${row.alert ? ' alert' : ''}`}>
                <span className="engine-status-label">{row.label}</span>
                <span className="engine-status-value" title={String(row.value)}>
                  {String(row.value || 'unknown')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>脱敏配置</h2>
        <label className="settings-row">
          <span><strong>默认掩码样式</strong><small>用于文本预览中的统一脱敏标记</small></span>
          <select value={settings.maskChar} onChange={(e) => onSettingsChange({ ...settings, maskChar: e.target.value })}>
            <option value="*">星号（王*锤 / 138****5678）</option>
            <option value="●">圆点（王●锤 / 138●●●●5678）</option>
            <option value="_">下划线（王_锤 / 138____5678）</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h2>导出</h2>
        <div className="settings-row">
          <span><strong>保持原文件格式</strong><small>DOCX、PDF、Markdown 与 TXT 均生成同格式副本</small></span>
          <input type="checkbox" checked={settings.preserveFormat} onChange={(e) => onSettingsChange({ ...settings, preserveFormat: e.target.checked })} />
        </div>
        <div className="settings-row">
          <span><strong>导出前再次检查敏感信息</strong><small>复检失败时阻止下载</small></span>
          <input type="checkbox" checked={settings.verifyBeforeExport} onChange={(e) => onSettingsChange({ ...settings, verifyBeforeExport: e.target.checked })} />
        </div>
      </section>

      <section className="settings-section disclosure-section">
        <button className="disclosure" onClick={() => setAdvancedOpen(!advancedOpen)} aria-expanded={advancedOpen}>
          <span><strong>高级脱敏规则</strong><small>类型只影响识别与审计，文档中始终统一显示</small></span>
          <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
        </button>
        {advancedOpen && (
          <div className="rules-grid">
            {Object.entries(settings.rulesConfig || {}).map(([key, enabled]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(enabled)}
                  onChange={(e) => onSettingsChange({
                    ...settings,
                    rulesConfig: { ...settings.rulesConfig, [key]: e.target.checked },
                  })}
                />
                {key}
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>数据管理</h2>
        <div className="settings-row">
          <span><strong>数据目录</strong><small>所有材料和脱敏产物保存在本机 uploads/ 目录</small></span>
          <span className="engine-status-value">uploads/</span>
        </div>
      </section>
    </div>
  );
}
