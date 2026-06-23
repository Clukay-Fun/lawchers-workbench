import { useState } from 'react';

/**
 * 描述: 工作台仪表盘主页组件
 * 主要功能:
 *     - 展示承办律师的案件统计摘要（进行中、待出具意见书等）
 *     - 提供现有案件的卡片列表，支持点击直接进入该案件的办案区
 *     - 维护新建案件的表单弹窗，快速初始化新案件要素与材料
 */

// #region 仪表盘首页组件

/**
 * 工作台首页组件
 * @param {Object} props 组件属性
 * @param {Array} props.cases 案件列表数据
 * @param {Function} props.onSelectCase 选中案件的回调函数
 * @param {Function} props.onCreateCase 创建新案件的回调函数
 * @param {Object} props.sysSettings 系统设置参数，用于默认落款
 * 
 * 功能:
 *     - 提供仪表盘的核心布局和“新建案件”模态交互，支持加载预设的 MOCK 数据
 */
export default function Home({ cases, onSelectCase, onCreateCase, sysSettings }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCaseData, setNewCaseData] = useState({
    reason: '劳动争议',
    employeeName: '',
    companyName: '',
    lawyerName: sysSettings.lawyerName || 'Sarah J.',
    notes: '',
  });

  // 处理输入框修改
  const handleInputChange = (field, val) => {
    setNewCaseData((prev) => ({
      ...prev,
      [field]: val,
    }));
  };

  // 提交创建新案件表单
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newCaseData.employeeName || !newCaseData.companyName) {
      alert('请填写当事人和被申请人名称');
      return;
    }
    onCreateCase(newCaseData);
    setIsModalOpen(false);
    // 重置表单
    setNewCaseData({
      reason: '劳动争议',
      employeeName: '',
      companyName: '',
      lawyerName: sysSettings.lawyerName || 'Sarah J.',
      notes: '',
    });
  };

  // 计算测算总额度
  const formatTotalClaim = (c) => {
    if (c.totalAmount && c.totalAmount > 0) {
      return c.totalAmount.toLocaleString();
    }
    return '0';
  };

  // 累计计算所有案件的测算标的（元转万元）
  const totalAmountSum = cases.reduce((sum, c) => sum + (c.totalAmount || 0), 0);
  const totalAmountInWan = (totalAmountSum / 10000).toFixed(1);

  return (
    <div className="home-container">
      {/* 欢迎头部区 */}
      <div className="home-hero">
        <div>
          <h1>下午好，{sysSettings.lawyerName || 'Sarah J.'}</h1>
          <p>
            当前有 {cases.filter((c) => c.status !== 'done').length} 件案件进行中，
            {cases.filter((c) => c.status === 'todo').length} 份意见书待出具。今天是 {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}。
          </p>
        </div>
        <button className="btn-new" onClick={() => setIsModalOpen(true)}>
          <span style={{ fontSize: '1.1rem' }}>＋</span> 新建案件
        </button>
      </div>

      {/* 数据看板卡片 */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">进行中案件</div>
          <div className="num">
            {cases.filter((c) => c.status !== 'done').length} <small>件</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">待出意见书</div>
          <div className="num" style={{ color: 'var(--danger)' }}>
            {cases.filter((c) => c.status === 'todo').length} <small>件</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">本月已归档</div>
          <div className="num" style={{ color: 'var(--success)' }}>
            {cases.filter((c) => c.status === 'done').length} <small>件</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">本月测算标的</div>
          <div className="num">
            ¥ {totalAmountInWan} <small>万</small>
          </div>
        </div>
      </div>

      {/* 案件管理板块 */}
      <div className="section-head">
        <h3>我的案件</h3>
      </div>

      <div className="case-grid">
        {cases.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '3rem',
              textAlign: 'center',
              backgroundColor: 'var(--bg-card)',
              border: '1px dashed var(--border-color)',
              borderRadius: '14px',
              color: 'var(--text-muted)',
            }}
          >
            暂无案件记录。请点击右上角「新建案件」开启您的第一个争议办案流程。
          </div>
        ) : (
          cases.map((c) => {
            // 根据阶段设定样式标签
            let stageClass = 'stage-todo';
            let stageLabel = '待出意见书';
            if (c.status === 'doing') {
              stageClass = 'stage-doing';
              stageLabel = '要素已核对';
            } else if (c.status === 'done') {
              stageClass = 'stage-done';
              stageLabel = '意见书已发';
            }

            return (
              <div key={c.caseNo} className="case-card" onClick={() => onSelectCase(c)}>
                <div className="case-no">{c.caseNo} · {c.reason}</div>
                <div className="case-title">{c.employeeName} 诉 {c.companyName}</div>
                <div className="case-party">{c.notes || '劳动纠纷案件测算'}</div>
                <div className="case-amount">
                  ¥ {formatTotalClaim(c)} <small>测算索赔</small>
                </div>
                <div className="progress">
                  <i
                    style={{
                      width: c.status === 'done' ? '100%' : c.status === 'doing' ? '45%' : '70%',
                      backgroundColor: c.status === 'done' ? 'var(--success)' : 'var(--primary)',
                    }}
                  ></i>
                </div>
                <div className="progress-text">
                  进度：{c.status === 'done' ? '意见书已出具并交付' : c.status === 'doing' ? '材料已脱敏，要素核对中' : '要素已核对，待生成意见书'}
                </div>
                <div className="case-foot">
                  <span className={`badge-stage ${stageClass}`}>{stageLabel}</span>
                  <span className="case-date">更新于 {c.updated_at ? new Date(c.updated_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '刚刚'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 新建案件模态弹窗 */}
      <div className={`modal-backdrop ${isModalOpen ? 'open' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) setIsModalOpen(false); }}>
        <div className="modal">
          <div className="modal-head">
            <h3>新建案件</h3>
            <button className="x" onClick={() => setIsModalOpen(false)}>&times;</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <div className="form-group">
                <label>案由</label>
                <select value={newCaseData.reason} onChange={(e) => handleInputChange('reason', e.target.value)}>
                  <option value="劳动争议">劳动争议</option>
                </select>
              </div>
              <div className="form-group">
                <label>当事人（劳动者）姓名</label>
                <input
                  type="text"
                  placeholder="请输入当事人姓名"
                  value={newCaseData.employeeName}
                  onChange={(e) => handleInputChange('employeeName', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>被申请人（用人单位）名称</label>
                <input
                  type="text"
                  placeholder="请输入用人单位名称"
                  value={newCaseData.companyName}
                  onChange={(e) => handleInputChange('companyName', e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>案件备注（可选）</label>
                <input
                  type="text"
                  placeholder="简要描述争议焦点"
                  value={newCaseData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>取消</button>
              <button type="submit" className="btn btn-primary">创建并进入办案区</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// #endregion
