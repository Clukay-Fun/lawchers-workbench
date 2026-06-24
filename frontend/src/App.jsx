import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import Home from './components/Home';
import Workspace from './components/Workspace';
import {
  createCase as apiCreateCase,
  deleteCase as apiDeleteCase,
  getCaseDetail,
  getCases,
} from './api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const availableRules = [
  { key: 'PERSON', label: '姓名' },
  { key: 'PHONE', label: '手机号' },
  { key: 'LANDLINE', label: '固定电话' },
  { key: 'ID_CARD', label: '身份证号' },
  { key: 'PASSPORT', label: '护照' },
  { key: 'EMAIL', label: '电子邮箱' },
  { key: 'CASE_NO', label: '案号 / 合同编号' },
  { key: 'ORG_CODE', label: '统一社会信用代码' },
  { key: 'BANK_CARD', label: '银行卡号' },
  { key: 'BANK_BRANCH', label: '银行网点' },
  { key: 'MONEY', label: '金额' },
  { key: 'API_TOKEN', label: 'API Token / 密钥' },
  { key: 'ORG', label: '机构' },
  { key: 'LOC', label: '地点 / 地址' },
  { key: 'DATE', label: '日期' },
];

const defaultRules = Object.fromEntries(availableRules.map((rule) => [rule.key, true]));
defaultRules.DATE = false;

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function buildTextChunks(redactedText, entities, occurrences) {
  if (!redactedText) return [];
  const entityMap = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
  const positional = occurrences
    .filter((item) => Number.isFinite(item.redacted_start) && Number.isFinite(item.redacted_end))
    .sort((a, b) => a.redacted_start - b.redacted_start);
  if (!positional.length) return [{ text: redactedText, isEntity: false }];

  const chunks = [];
  let cursor = 0;
  for (const occurrence of positional) {
    if (occurrence.redacted_start < cursor) continue;
    const entity = entityMap[occurrence.entity_id];
    if (!entity) continue;
    if (occurrence.redacted_start > cursor) {
      chunks.push({ text: redactedText.slice(cursor, occurrence.redacted_start), isEntity: false });
    }
    chunks.push({
      text: entity.original || occurrence.original_text || '',
      replacement: entity.replacement || '***',
      isEntity: true,
      type: entity.entity_type || 'SENSITIVE',
      entityId: entity.id,
      revealed: false,
    });
    cursor = occurrence.redacted_end;
  }
  if (cursor < redactedText.length) chunks.push({ text: redactedText.slice(cursor), isEntity: false });
  return chunks;
}

export default function App() {
  const [currentView, setCurrentView] = useState('home');
  const [cases, setCases] = useState([]);
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [activeCaseDetail, setActiveCaseDetail] = useState(null);
  const [loadingCaseDetail, setLoadingCaseDetail] = useState(false);
  const [advancedRulesOpen, setAdvancedRulesOpen] = useState(false);
  const [settings, setSettings] = useState({
    maskChar: '*',
    defaultView: 'redacted',
    preserveFormat: true,
    verifyBeforeExport: true,
    rulesConfig: defaultRules,
  });

  const loadCases = async () => {
    try {
      setCases(await getCases() || []);
    } catch (error) {
      console.error('[ERROR] 加载案件列表失败:', error);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getCases()
      .then((items) => { if (!cancelled) setCases(items || []); })
      .catch((error) => console.error('[ERROR] 加载案件列表失败:', error));
    return () => { cancelled = true; };
  }, []);

  const mapCaseForWorkspace = (detail) => {
    if (!detail) return null;
    const backendOrigin = import.meta.env.VITE_BACKEND_ORIGIN || `${window.location.protocol}//${window.location.hostname}:3001`;
    const materials = (detail.materials || []).map((material) => {
      const mapData = parseJson(material.map_json, {});
      const entities = (mapData.entities || material.entities || []).map((entity) => ({
        ...entity,
        id: entity.id || entity.entity_id,
        entity_type: entity.entity_type,
        original: entity.original || '',
        replacement: entity.replacement || entity.masked || '***',
      }));
      const occurrences = mapData.occurrences || parseJson(material.occurrences_json, []);
      const storedPath = String(material.stored_path || '').split('\\').join('/');
      const redactedPath = String(material.redacted_path || '').split('\\').join('/');
      return {
        id: material.id,
        name: material.filename,
        ext: material.ext,
        status: material.redact_status || 'todo',
        displayMode: material.display_mode || 'text',
        filePath: storedPath ? `${backendOrigin}/${storedPath}` : '',
        redactedFileUrl: redactedPath ? `${backendOrigin}/${redactedPath}` : '',
        redactedText: material.redacted_md || '',
        workingText: material.working_text || '',
        rawText: '',
        entities,
        occurrences,
        chunks: buildTextChunks(material.redacted_md || '', entities, occurrences),
        entitiesCount: occurrences.length || entities.length,
        manualRedactions: parseJson(material.manual_redactions_json, []),
        audit: parseJson(material.audit_json, {}),
      };
    });

    return {
      id: detail.id,
      caseNo: detail.case_no,
      title: detail.title,
      reason: detail.cause || '劳动争议',
      employeeName: detail.employee,
      companyName: detail.company,
      status: detail.stage || 'todo',
      selectedMaterialIndex: 0,
      materials,
    };
  };

  const loadCaseDetail = async (caseId) => {
    setLoadingCaseDetail(true);
    try {
      setActiveCaseDetail(mapCaseForWorkspace(await getCaseDetail(caseId)));
    } catch (error) {
      console.error('[ERROR] 加载案件详情失败:', error);
      setActiveCaseDetail(null);
    } finally {
      setLoadingCaseDetail(false);
    }
  };

  const handleSelectCase = async (item) => {
    setActiveCaseId(item.id);
    setCurrentView('workspace');
    await loadCaseDetail(item.id);
  };

  const handleCreateCase = async (caseData) => {
    const result = await apiCreateCase({
      employee: caseData.employeeName,
      company: caseData.companyName,
      title: `${caseData.employeeName}诉${caseData.companyName}${caseData.reason || '劳动争议'}案`,
      cause: caseData.reason || '劳动争议',
    });
    await loadCases();
    setActiveCaseId(result.id);
    setCurrentView('workspace');
    await loadCaseDetail(result.id);
  };

  const handleDeleteCase = async (id) => {
    await apiDeleteCase(id);
    await loadCases();
  };

  const refreshCurrentCase = async () => {
    if (activeCaseId) await loadCaseDetail(activeCaseId);
  };

  const casesForHome = cases.map((item) => ({
    id: item.id,
    caseNo: item.case_no,
    title: item.title,
    employeeName: item.employee,
    companyName: item.company,
    reason: item.cause || '劳动争议',
    status: item.stage || 'todo',
    materialCount: item.material_count || 0,
    updatedAt: item.updated_at,
  }));

  const header = (() => {
    if (currentView === 'workspace' && activeCaseDetail) {
      return (
        <header className="top-header case-header">
          <div>
            <h1>{activeCaseDetail.employeeName} 诉 {activeCaseDetail.companyName}</h1>
            <p className="case-meta">{activeCaseDetail.caseNo} · {activeCaseDetail.reason}</p>
          </div>
        </header>
      );
    }
    return (
      <header className="top-header">
        <h1>{currentView === 'settings' ? '设置' : '案件'}</h1>
      </header>
    );
  })();

  return (
    <div className="app-shell">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="main-container">
        {header}
        <div className="page-wrapper">
          <section className={`page-view ${currentView === 'home' ? 'active' : ''}`}>
            <Home
              cases={casesForHome}
              onSelectCase={handleSelectCase}
              onCreateCase={handleCreateCase}
              onDeleteCase={handleDeleteCase}
            />
          </section>

          <section className={`page-view ${currentView === 'workspace' ? 'active' : ''}`}>
            {loadingCaseDetail ? (
              <div className="page-state">正在加载案件材料…</div>
            ) : activeCaseDetail ? (
              <Workspace
                currentCase={activeCaseDetail}
                onUpdateCase={setActiveCaseDetail}
                settings={settings}
                caseId={activeCaseId}
                onRefreshCase={refreshCurrentCase}
              />
            ) : (
              <div className="page-state">请先在案件列表中选择一个案件。</div>
            )}
          </section>

          <section className={`page-view ${currentView === 'settings' ? 'active' : ''}`}>
            <div className="settings-view">
              <section className="settings-section">
                <h2>脱敏配置</h2>
                <label className="settings-row">
                  <span><strong>默认掩码样式</strong><small>用于文本预览中的统一脱敏标记</small></span>
                  <Select value={settings.maskChar} onValueChange={(val) => setSettings({ ...settings, maskChar: val })}>
                    <SelectTrigger className="w-[440px] justify-self-end bg-card border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="*">星号（王*锤 / 138****5678）</SelectItem>
                      <SelectItem value="●">圆点（王●锤 / 138●●●●5678）</SelectItem>
                      <SelectItem value="_">下划线（王_锤 / 138____5678）</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <div className="settings-row">
                  <span><strong>默认显示模式</strong><small>进入材料时优先保护敏感内容</small></span>
                  <div className="segmented-control">
                    <button className={settings.defaultView === 'redacted' ? 'active' : ''} onClick={() => setSettings({ ...settings, defaultView: 'redacted' })}>脱敏预览</button>
                    <button className={settings.defaultView === 'original' ? 'active' : ''} onClick={() => setSettings({ ...settings, defaultView: 'original' })}>原文</button>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <h2>导出</h2>
                <div className="settings-row">
                  <span><strong>保持原文件格式</strong><small>DOCX、PDF、Markdown 与 TXT 均生成同格式副本</small></span>
                  <Switch checked={settings.preserveFormat} onCheckedChange={(val) => setSettings({ ...settings, preserveFormat: val })} className="justify-self-end" />
                </div>
                <div className="settings-row">
                  <span><strong>导出前再次检查敏感信息</strong><small>复检失败时阻止下载</small></span>
                  <Switch checked={settings.verifyBeforeExport} onCheckedChange={(val) => setSettings({ ...settings, verifyBeforeExport: val })} className="justify-self-end" />
                </div>
              </section>

              <section className="settings-section disclosure-section">
                <button className="disclosure" onClick={() => setAdvancedRulesOpen(!advancedRulesOpen)} aria-expanded={advancedRulesOpen}>
                  <span><strong>高级脱敏规则</strong><small>类型只影响识别与审计，文档中始终统一显示</small></span>
                  <span aria-hidden="true">{advancedRulesOpen ? '−' : '+'}</span>
                </button>
                {advancedRulesOpen && (
                  <div className="rules-grid">
                    {availableRules.map((rule) => (
                      <label key={rule.key}>
                        <input
                          type="checkbox"
                          checked={Boolean(settings.rulesConfig[rule.key])}
                          onChange={(event) => setSettings({
                            ...settings,
                            rulesConfig: { ...settings.rulesConfig, [rule.key]: event.target.checked },
                          })}
                        />
                        {rule.label}
                      </label>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
