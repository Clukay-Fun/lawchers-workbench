import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Home from './components/Home';
import Workspace from './components/Workspace';
import { getNerStatus, getCases, getCaseDetail, createCase as apiCreateCase } from './api';

// 内置可供开关的脱敏实体规则定义
const availableRules = [
  { key: 'PERSON', label: '姓名（NER）' },
  { key: 'PHONE', label: '手机号' },
  { key: 'LANDLINE', label: '固定电话' },
  { key: 'ID_CARD', label: '身份证号' },
  { key: 'PASSPORT', label: '护照' },
  { key: 'EMAIL', label: '电子邮箱' },
  { key: 'CASE_NO', label: '案号 / 合同编号' },
  { key: 'ORG_CODE', label: '统一社会信用代码' },
  { key: 'BANK_CARD', label: '银行卡号' },
  { key: 'BANK_BRANCH', label: '银行网点' },
  { key: 'MONEY', label: '中文金额' },
  { key: 'PLATE', label: '车牌号' },
  { key: 'PROPERTY_CERT', label: '不动产权证号' },
  { key: 'API_TOKEN', label: 'API Token/密钥' },
  { key: 'ORG', label: '机构（NER）' },
  { key: 'LOC', label: '地点/地址（NER）' },
  { key: 'TIME', label: '时间（NER）' },
  { key: 'DATE', label: '中文日期' },
  { key: 'BANK_ACCOUNT', label: '银行账号' }
];

/**
 * 描述: 敬法智能办案工作台主应用顶层入口组件
 */

// #region App 主组件实现

export default function App() {
  const [currentView, setCurrentView] = useState('home');
  const [cases, setCases] = useState([]);
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [activeCaseDetail, setActiveCaseDetail] = useState(null);
  const [loadingCaseDetail, setLoadingCaseDetail] = useState(false);
  const [nerEnabled, setNerEnabled] = useState(false);

  // 初始化拉取 NER 状态和案件列表
  useEffect(() => {
    getNerStatus()
      .then((data) => setNerEnabled(data.nerEnabled))
      .catch(() => setNerEnabled(false));

    loadCases();
  }, []);

  // 从后端加载案件列表
  const loadCases = async () => {
    try {
      const data = await getCases();
      setCases(data || []);
    } catch (err) {
      console.error('[ERROR] 加载案件列表失败:', err);
    }
  };

  // 加载案件详情
  const loadCaseDetail = async (caseId) => {
    setLoadingCaseDetail(true);
    try {
      const detail = await getCaseDetail(caseId);
      setActiveCaseDetail(detail);
    } catch (err) {
      console.error('[ERROR] 加载案件详情失败:', err);
      setActiveCaseDetail(null);
    } finally {
      setLoadingCaseDetail(false);
    }
  };

  // 全局律师配置
  const [sysSettings, setSysSettings] = useState({
    lawyerName: 'Sarah J.',
    lawfirm: '敬法律师事务所',
    lawyerCard: '14403202110XXXXXX',
    maskChar: '*',
    rulesConfig: {
      PHONE: true,
      LANDLINE: true,
      ID_CARD: true,
      PASSPORT: true,
      EMAIL: true,
      CASE_NO: true,
      ORG_CODE: true,
      BANK_CARD: true,
      BANK_BRANCH: true,
      MONEY: true,
      PLATE: true,
      PROPERTY_CERT: true,
      API_TOKEN: true,
      PERSON: true,
      ORG: true,
      LOC: true,
      TIME: true,
      DATE: false,
      BANK_ACCOUNT: false
    }
  });

  const handleSettingsChange = (field, val) => {
    setSysSettings((prev) => ({ ...prev, [field]: val }));
  };

  // 1. 切换案件并跳转到 Workspace
  const handleSelectCase = async (c) => {
    setActiveCaseId(c.id);
    setCurrentView('workspace');
    await loadCaseDetail(c.id);
  };

  // 2. 新建案件（调后端 API）
  const handleCreateCase = async (newCaseData) => {
    try {
      const result = await apiCreateCase({
        employee: newCaseData.employeeName,
        company: newCaseData.companyName,
        title: `${newCaseData.employeeName}诉${newCaseData.companyName}劳动争议案`,
        cause: newCaseData.reason || '劳动争议',
      });

      // 刷新列表
      await loadCases();

      // 自动切入 Workspace
      setActiveCaseId(result.id);
      setCurrentView('workspace');
      await loadCaseDetail(result.id);
    } catch (err) {
      console.error('[ERROR] 创建案件失败:', err);
      alert('创建案件失败: ' + (err.message || '未知错误'));
    }
  };

  // 3. 更新案件（刷新详情）
  const handleUpdateCase = async (updatedCase) => {
    // 更新本地缓存的详情
    setActiveCaseDetail(updatedCase);
    // 刷新列表中的摘要信息
    await loadCases();
  };

  // 刷新当前案件详情（用于脱敏/确认后更新材料状态）
  const refreshCurrentCase = async () => {
    if (activeCaseId) {
      await loadCaseDetail(activeCaseId);
    }
  };

  // 将后端案件详情转换为 Workspace 所需的前端格式
  const mapCaseForWorkspace = (detail) => {
    if (!detail) return null;

    const materials = (detail.materials || []).map((mat, idx) => {
      // 从存储的 redacted_md + entities + occurrences_json 重建 chunks
      let chunks = [];
      let entities = (mat.entities || []).map(ent => ({
        id: ent.entity_id,
        entity_type: ent.entity_type,
        original: '', // 明文不入库
        replacement: ent.masked,
        redacted_start: ent.start,
        redacted_end: ent.end,
      }));

      let occurrences = [];
      try {
        occurrences = JSON.parse(mat.occurrences_json || '[]');
      } catch { occurrences = []; }

      // 如果有 redacted_md 和 occurrences，重建 chunks
      if (mat.redacted_md && occurrences.length > 0) {
        const entityMap = {};
        for (const ent of entities) {
          entityMap[ent.id] = ent;
        }

        const sorted = [...occurrences].sort((a, b) => a.redacted_start - b.redacted_start);
        let cursor = 0;
        for (const occ of sorted) {
          if (occ.redacted_start < cursor) continue;
          const entity = entityMap[occ.entity_id];
          if (!entity) continue;

          if (occ.redacted_start > cursor) {
            chunks.push({
              text: mat.redacted_md.substring(cursor, occ.redacted_start),
              isEntity: false,
            });
          }

          chunks.push({
            text: entity.original || '',
            isEntity: true,
            type: entity.entity_type,
            entityId: entity.id,
            entityType: entity.entity_type,
            replacement: entity.replacement,
            revealed: false,
          });

          cursor = occ.redacted_end;
        }

        if (cursor < mat.redacted_md.length) {
          chunks.push({
            text: mat.redacted_md.substring(cursor),
            isEntity: false,
          });
        }
      } else if (mat.redacted_md) {
        chunks = [{ text: mat.redacted_md, isEntity: false }];
      }

      return {
        id: mat.id,
        name: mat.filename,
        filePath: mat.stored_path ? `${window.location.protocol}//${window.location.hostname}:3001/${mat.stored_path}` : '',
        status: mat.redact_status || 'todo',
        rawText: '',
        redactedText: mat.redacted_md || '',
        chunks,
        entities,
        occurrences,
        entitiesCount: (mat.entities || []).length,
        audit: {},
        displayMode: mat.display_mode || 'text',
        redactedImageUrl: null,
      };
    });

    const calc = detail.calculatorInput || {};

    return {
      id: detail.id,
      caseNo: detail.case_no,
      employeeName: calc.employeeName || detail.employee,
      companyName: calc.companyName || detail.company,
      status: detail.stage === 'done' ? 'done' : detail.stage === 'archived' ? 'done' : 'todo',
      lawyerName: sysSettings.lawyerName,
      notes: detail.title,
      materials,
      selectedMaterialIndex: 0,
      calculatorInput: {
        employeeName: calc.employeeName || detail.employee,
        companyName: calc.companyName || detail.company,
        entryDate: calc.entryDate || '',
        leaveDate: calc.leaveDate || '',
        salary: calc.salary || 0,
        hasContract: calc.hasContract !== undefined ? calc.hasContract : true,
        leaveReason: calc.leaveReason || 'dismiss',
        workingMonths: calc.workingMonths || 0,
        jobTitle: calc.jobTitle || '技术开发岗',
      },
      totalAmount: detail.claim_amount || 0,
      opinions: detail.opinions || [],
      auditLogs: detail.auditLogs || [],
    };
  };

  // 渲染顶部 Header
  const renderHeader = () => {
    if (currentView === 'workspace') {
      const ws = activeCaseDetail ? mapCaseForWorkspace(activeCaseDetail) : null;
      return (
        <header className="top-header">
          <div>
            <h2>智能办案 Workspace</h2>
            <div className="breadcrumb" style={{ display: 'block' }}>
              劳动争议 · {ws?.caseNo} · {ws?.employeeName} 诉 {ws?.companyName}
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <span>承办律师：<strong style={{ color: 'var(--primary)' }}>{sysSettings.lawyerName} 执业律师</strong></span>
            {nerEnabled ? (
              <span className="ner-badge" style={{ backgroundColor: '#ecfdf5', color: '#10b981', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>NER 模型已就绪</span>
            ) : (
              <span className="ner-badge" style={{ backgroundColor: '#fef2f2', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>NER 降级仅正则</span>
            )}
          </div>
        </header>
      );
    }

    const titleMap = {
      home: '工作台首页',
      settings: '系统配置与隐私',
    };

    return (
      <header className="top-header">
        <div>
          <h2>{titleMap[currentView] || '工作台首页'}</h2>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span>承办律师：<strong style={{ color: 'var(--primary)' }}>{sysSettings.lawyerName} 执业律师</strong></span>
          {nerEnabled ? (
            <span className="ner-badge" style={{ backgroundColor: '#ecfdf5', color: '#10b981', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>NER 模型已就绪</span>
          ) : (
            <span className="ner-badge" style={{ backgroundColor: '#fef2f2', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>NER 降级仅正则</span>
          )}
        </div>
      </header>
    );
  };

  // 渲染设置页面
  const renderSettingsView = () => {
    return (
      <div className="settings-view">
        <h3 style={{ marginBottom: '1.4rem', color: 'var(--primary)' }}>系统配置与隐私设置</h3>
        <div className="solid-card">
          <h4 className="form-title">律师执业落款变量</h4>
          <div className="form-group">
            <label>承办律师姓名</label>
            <input type="text" value={sysSettings.lawyerName} onChange={(e) => handleSettingsChange('lawyerName', e.target.value)} />
          </div>
          <div className="form-group">
            <label>所属执业律所</label>
            <input type="text" value={sysSettings.lawfirm} onChange={(e) => handleSettingsChange('lawfirm', e.target.value)} />
          </div>
          <div className="form-group">
            <label>执业证号</label>
            <input type="text" value={sysSettings.lawyerCard} onChange={(e) => handleSettingsChange('lawyerCard', e.target.value)} />
          </div>
        </div>
        <div className="solid-card">
          <h4 className="form-title">脱敏规则</h4>
          <div className="form-group" style={{ marginBottom: '1.2rem' }}>
            <label>默认掩码符（实时应用到脱敏校对区）</label>
            <select value={sysSettings.maskChar} onChange={(e) => handleSettingsChange('maskChar', e.target.value)}>
              <option value="*">星号 王*锤 / 138*4678</option>
              <option value="●">方块 王●锤 / 138●4678</option>
              <option value="_">下划线 王_锤 / 138_4678</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.6rem' }}>实体类型细粒度脱敏开关（生效于脱敏及重脱敏流程）</label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.6rem 1rem',
              padding: '0.8rem',
              backgroundColor: '#f8fafc',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              maxHeight: '260px',
              overflowY: 'auto'
            }}>
              {availableRules.map((rule) => {
                const isChecked = !!sysSettings.rulesConfig?.[rule.key];
                return (
                  <label key={rule.key} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    fontSize: '0.85rem', color: '#334155', cursor: 'pointer', userSelect: 'none'
                  }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      style={{ cursor: 'pointer' }}
                      onChange={(e) => {
                        const newConfig = { ...sysSettings.rulesConfig, [rule.key]: e.target.checked };
                        handleSettingsChange('rulesConfig', newConfig);
                      }}
                    />
                    <span>{rule.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <button
          className="btn"
          style={{ backgroundColor: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', width: 'auto' }}
          onClick={() => alert('演示：已擦除本地缓存并退出登录')}
        >
          擦除本地缓存并退出登录
        </button>
      </div>
    );
  };

  // 映射案件列表为 Home 组件所需的格式
  const casesForHome = cases.map(c => ({
    id: c.id,
    caseNo: c.case_no,
    employeeName: c.employee,
    companyName: c.company,
    reason: c.cause || '劳动争议',
    status: c.stage === 'done' ? 'done' : c.stage === 'archived' ? 'done' : 'todo',
    notes: c.title,
    totalAmount: c.claim_amount || 0,
    selectedMaterialIndex: 0,
    materials: [],
    calculatorInput: {},
  }));

  const workspaceCase = activeCaseDetail ? mapCaseForWorkspace(activeCaseDetail) : null;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        sysSettings={sysSettings}
      />

      <div className="main-container">
        {renderHeader()}

        <div className="page-wrapper">
          <section className={`page-view ${currentView === 'home' ? 'active' : ''}`}>
            <Home
              cases={casesForHome}
              onSelectCase={handleSelectCase}
              onCreateCase={handleCreateCase}
              sysSettings={sysSettings}
            />
          </section>

          <section className={`page-view ${currentView === 'workspace' ? 'active' : ''}`}>
            {loadingCaseDetail ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                正在加载案件详情...
              </div>
            ) : workspaceCase ? (
              <Workspace
                currentCase={workspaceCase}
                onUpdateCase={handleUpdateCase}
                onBackHome={() => { setCurrentView('home'); loadCases(); }}
                sysSettings={sysSettings}
                caseId={activeCaseId}
                onRefreshCase={refreshCurrentCase}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                暂无进行中的案件。请先前往首页「新建案件」以开启智能办案工作区。
              </div>
            )}
          </section>

          <section className={`page-view ${currentView === 'settings' ? 'active' : ''}`}>
            {renderSettingsView()}
          </section>
        </div>
      </div>
    </div>
  );
}
