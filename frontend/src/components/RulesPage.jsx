import { useState, useEffect, useCallback } from 'react';
import { getRules, createRule, updateRule, deleteRule, testRegex } from '../api';
import { Button } from '@/components/ui/button';

const TABS = [
  { key: 'system', label: '系统规则' },
  { key: 'custom', label: '自定义正则' },
  { key: 'blacklist', label: '强制脱敏词' },
  { key: 'whitelist', label: '保留词库' },
];

const RULE_TO_CONFIG_KEY = {
  phone_cn: 'PHONE', landline_cn: 'LANDLINE', id_card_cn: 'ID_CARD',
  passport_cn: 'PASSPORT', email: 'EMAIL', case_no: 'CASE_NO',
  case_no_contract: 'CASE_NO', execution_no: 'CASE_NO',
  org_code: 'ORG_CODE', bank_account_cn: 'BANK_CARD', bank_card_cn: 'BANK_CARD',
  bank_branch_cn: 'BANK_BRANCH', money_cn: 'MONEY', date_cn: 'DATE',
  plate_cn: 'PLATE', property_cert: 'PROPERTY', api_token: 'API_TOKEN',
};

export default function RulesPage({ settings, onSettingsChange }) {
  const [tab, setTab] = useState('system');
  const [rules, setRules] = useState({ system: [], custom: [] });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', regex: '', token_prefix: '', description: '', sample: '' });
  const [testResult, setTestResult] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const load = async () => {
    try {
      setRules(await getRules());
    } catch (err) {
      showToast(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const currentRules = tab === 'system' ? rules.system : rules.custom.filter((r) => r.category === tab);

  const handleSystemToggle = useCallback((ruleId) => {
    if (!settings || !onSettingsChange) return;
    const configKey = RULE_TO_CONFIG_KEY[ruleId];
    if (!configKey) { showToast('此规则无法单独控制'); return; }
    const current = settings.rulesConfig?.[configKey] !== false;
    onSettingsChange({
      ...settings,
      rulesConfig: { ...settings.rulesConfig, [configKey]: !current },
    });
  }, [settings, onSettingsChange, showToast]);

  const handleCreate = async () => {
    if (!form.name.trim()) { showToast('名称不能为空'); return; }
    if (form.regex) {
      try { new RegExp(form.regex); } catch { showToast('正则表达式不合法'); return; }
    }
    try {
      await createRule({ ...form, category: tab });
      setShowForm(false);
      setForm({ name: '', regex: '', token_prefix: '', description: '', sample: '' });
      setTestResult(null);
      await load();
      showToast('规则已添加');
    } catch (err) {
      showToast(err.message || '创建失败');
    }
  };

  const handleToggle = async (id, currentActive) => {
    try {
      await updateRule(id, { is_active: currentActive ? 0 : 1 });
      await load();
    } catch (err) { showToast(err.message || '更新失败'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确认删除此规则？')) return;
    try { await deleteRule(id); await load(); } catch (err) { showToast(err.message || '删除失败'); }
  };

  const handleTest = async () => {
    if (!form.regex || !form.sample) { setTestResult(null); return; }
    try {
      const result = await testRegex(form.regex, form.sample);
      setTestResult(result.data?.matches || []);
      if (result.data?.warning) showToast(result.data.warning);
    } catch (err) {
      setTestResult([]);
      showToast(err.message || '测试失败');
    }
  };

  if (loading) return <div className="tool-loading">加载中…</div>;

  return (
    <div className="tool-page">
      <div className="tool-card">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setShowForm(false); }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'system' && (
          <div className="rules-actions">
            <Button variant="outline" onClick={() => setShowForm(!showForm)}>
              {showForm ? '取消' : `新增${TABS.find((t) => t.key === tab)?.label || '规则'}`}
            </Button>
          </div>
        )}

        {showForm && (
          <div className="rule-form">
            <label><span>名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            {tab === 'custom' && (
              <>
                <label><span>正则</span><input value={form.regex} onChange={(e) => { setForm({ ...form, regex: e.target.value }); setTestResult(null); }} placeholder="例: \d{18}[0-9Xx]" /></label>
                <label><span>替换前缀</span><input value={form.token_prefix} onChange={(e) => setForm({ ...form, token_prefix: e.target.value })} placeholder="例: 【证件号】" /></label>
              </>
            )}
            {tab === 'blacklist' && (
              <label><span>强制脱敏词</span><input value={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.value })} placeholder="例: 某公司名称" /></label>
            )}
            {tab === 'whitelist' && (
              <label><span>保留词</span><input value={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.value })} placeholder="例: 泛指名称" /></label>
            )}
            <label><span>说明</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            {tab === 'custom' && (
              <>
                <label><span>测试样例</span><input value={form.sample} onChange={(e) => { setForm({ ...form, sample: e.target.value }); setTestResult(null); }} placeholder="输入包含敏感信息的文本" /></label>
                <Button variant="ghost" onClick={handleTest}>测试匹配</Button>
                {testResult !== null && (
                  <div className="test-result">
                    {testResult.length === 0 ? '无匹配' : `${testResult.length} 处匹配：${testResult.map((m) => `"${m.text}"`).join('、')}`}
                  </div>
                )}
              </>
            )}
            <Button variant="default" onClick={handleCreate}>添加</Button>
          </div>
        )}

        <div className="rules-list">
          {currentRules.length === 0 && tab !== 'system' && (
            <div className="tool-empty-inline">暂无规则。点击上方按钮添加。</div>
          )}
          {currentRules.map((rule) => (
            <div key={rule.id} className="rule-row">
              <div className="rule-info">
                <strong>{rule.name}</strong>
                {rule.description && rule.description !== rule.name && <span className="rule-desc">{rule.description}</span>}
                {rule.regex && <code className="rule-regex">{rule.regex}</code>}
              </div>
              <div className="rule-actions">
                {tab === 'system' ? (
                  <button
                    className={`toggle-btn ${settings?.rulesConfig?.[RULE_TO_CONFIG_KEY[rule.id]] !== false ? 'on' : 'off'}`}
                    onClick={() => handleSystemToggle(rule.id)}
                    title="点击切换"
                  >
                    {settings?.rulesConfig?.[RULE_TO_CONFIG_KEY[rule.id]] !== false ? '已启用' : '已停用'}
                  </button>
                ) : (
                  <>
                    <button
                      className={`toggle-btn ${rule.is_active ? 'on' : 'off'}`}
                      onClick={() => handleToggle(rule.id, rule.is_active)}
                      title={rule.is_active ? '点击停用' : '点击启用'}
                    >
                      {rule.is_active ? '已启用' : '已停用'}
                    </button>
                    <Button variant="ghost" size="icon" aria-label="删除" onClick={() => handleDelete(rule.id)}>×</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
