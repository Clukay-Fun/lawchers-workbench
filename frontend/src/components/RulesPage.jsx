import { useState, useEffect } from 'react';
import { getRules, createRule, updateRule, deleteRule, testRegex } from '../api';
import { Button } from '@/components/ui/button';

const TABS = [
  { key: 'system', label: '系统规则' },
  { key: 'custom', label: '自定义正则' },
  { key: 'blacklist', label: '黑名单（一定脱）' },
  { key: 'whitelist', label: '白名单（一定不脱）' },
];

export default function RulesPage() {
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

  const handleToggle = async (id, isActive) => {
    try {
      await updateRule(id, { is_active: isActive ? 0 : 1 });
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
    } catch (err) {
      setTestResult([]);
      showToast(err.message || '测试失败');
    }
  };

  if (loading) return <div className="tool-loading">加载中…</div>;

  return (
    <div className="tool-page">
      <div className="tool-card">
        <h2>脱敏规则</h2>
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
              <label><span>关键词（必脱）</span><input value={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.value })} placeholder="例: 某公司名称" /></label>
            )}
            {tab === 'whitelist' && (
              <label><span>关键词（一定不脱）</span><input value={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.value })} placeholder="例: 泛指名称" /></label>
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
          {tab === 'system' && (
            <div className="tool-note">
              系统规则来自 legal-desens 引擎（只读）。运行时通过 entity-policy 控制开关，不修改引擎规则文件。
            </div>
          )}
          {currentRules.map((rule) => (
            <div key={rule.id} className="rule-row">
              <div className="rule-info">
                <strong>{rule.name}</strong>
                {rule.regex && <code className="rule-regex">{rule.regex}</code>}
                {rule.description && <span className="rule-desc">{rule.description}</span>}
              </div>
              <div className="rule-actions">
                {tab !== 'system' && (
                  <>
                    <button
                      className={`toggle-btn ${rule.is_active ? 'on' : 'off'}`}
                      onClick={() => handleToggle(rule.id, rule.is_active)}
                      title={rule.is_active ? '点击停用' : '点击启用'}
                    >
                      {rule.is_active ? '启用' : '停用'}
                    </button>
                    <Button variant="ghost" size="icon" aria-label="删除" onClick={() => handleDelete(rule.id)}>×</Button>
                  </>
                )}
                {tab === 'system' && (
                  <span className={`toggle-btn ${rule.is_active ? 'on' : 'off'}`}>
                    {rule.is_active ? '启用' : '停用'}
                  </span>
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
