
/**
 * 描述: 要素提取与赔偿算费面板组件
 * 主要功能:
 *     - 展示材料脱敏校验的整体进度条门控，并提供材料状态的快捷切换卡
 *     - 提供包含当事人姓名、用人单位、入离职日期、月薪和解约原因在内的核心要素输入框
 *     - 实现“出处定位”功能，点击后可在段落中高亮对应敏感实体
 *     - 根据劳动合同法 47/82/87 条，实时运算二倍工资差额和补偿赔偿明细，展示索赔总额
 *     - 在全部材料脱敏合格后解锁意见书生成按钮
 */

// #region 要素测算面板组件实现

/**
 * 计算与要素配置面板
 * @param {Object} props 组件属性
 * @param {Array} props.materials 当前案件的关联材料列表
 * @param {Object} props.calculatorInput 计算器的输入值集合
 * @param {Object} props.calculationResult 计算器的运算结果明细
 * @param {Function} props.onToggleMaterialStatus 切换材料脱敏状态的回调
 * @param {Function} props.onElementChange 要素字段值改变的回调
 * @param {Function} props.onLocateEntity 定位并高亮敏感实体的回调
 * @param {Function} props.onGenerate 一键生成意见书的回调
 * @param {boolean} props.generating 是否正在向后端请求意见书的生成
 */
export default function CalcPanel({
  materials,
  calculatorInput,
  calculationResult,
  onToggleMaterialStatus,
  onElementChange,
  onLocateEntity,
  onGenerate,
  generating,
}) {
  const { entryDate, leaveDate, salary, hasContract, leaveReason, employeeName, companyName } = calculatorInput || {};
  const { workingMonths, doubleSalary, damages, total } = calculationResult || { workingMonths: 0, doubleSalary: 0, damages: 0, total: 0 };

  // 1. 计算当前脱敏完成比例
  const totalCount = materials.length;
  const doneCount = materials.filter((m) => m.status === 'done').length;
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const remainCount = totalCount - doneCount;

  // 2. 根据解约原因设定明细描述及色彩
  const getDamagesLabel = () => {
    if (leaveReason === 'dismiss') return '违法解除赔偿金';
    if (leaveReason === 'expire') return '期满终止补偿金';
    return '辞职经济补偿金';
  };

  const getDamagesColor = () => {
    if (leaveReason === 'dismiss') return 'var(--danger)';
    if (leaveReason === 'expire') return 'var(--text-main)';
    return 'var(--text-muted)';
  };

  return (
    <div className="col-right">
      {/* 顶部固定：材料脱敏进度门控 */}
      <div className="mat-gate">
        <div className="gate-top">
          <h4>材料脱敏进度</h4>
          <span className="gate-count">
            {doneCount}/{totalCount} 已完成
          </span>
        </div>
        <div className="gate-progress">
          <i style={{ width: `${progressPercent}%` }}></i>
        </div>
        {materials.map((mat, index) => (
          <div key={index} className="mat-row">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' }}>
              {mat.name}
            </span>
            {mat.status === 'done' ? (
              <span className="st done">已脱敏</span>
            ) : (
              <span className="st todo" onClick={() => onToggleMaterialStatus(index)} title="点击标记为脱敏完成">
                待脱敏
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 中段可滚动：赔偿测算计算器 */}
      <div className="right-scroll">
        <div className="solid-card pricing-card">
          <h5 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.8rem' }}>
            赔偿测算计算器
          </h5>

          {/* 当事人基本信息要素 */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>当事人姓名</label>
              <span className="field-src" onClick={() => onLocateEntity('inp-name')}>定位出处</span>
            </div>
            <input
              id="inp-name"
              type="text"
              value={employeeName || ''}
              onChange={(e) => onElementChange('employeeName', e.target.value)}
              placeholder="请输入当事人姓名"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>被申请人（单位）</label>
              <span className="field-src" onClick={() => onLocateEntity('inp-company')}>定位出处</span>
            </div>
            <input
              id="inp-company"
              type="text"
              value={companyName || ''}
              onChange={(e) => onElementChange('companyName', e.target.value)}
              placeholder="请输入用人单位名称"
            />
          </div>

          {/* 时间和薪资要素 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div className="form-group">
              <label>入职日期</label>
              <input
                type="date"
                value={entryDate || ''}
                onChange={(e) => onElementChange('entryDate', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>离职日期</label>
              <input
                type="date"
                value={leaveDate || ''}
                onChange={(e) => onElementChange('leaveDate', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>前 12 月均薪（元）</label>
            <input
              type="number"
              value={salary || ''}
              onChange={(e) => onElementChange('salary', e.target.value)}
              placeholder="如：15000"
            />
          </div>

          <div className="form-group">
            <label>是否签订书面合同</label>
            <select
              value={String(hasContract)}
              onChange={(e) => onElementChange('hasContract', e.target.value === 'true')}
            >
              <option value="false">未签订书面合同</option>
              <option value="true">已签订书面合同</option>
            </select>
          </div>

          <div className="form-group">
            <label>解除合同原因</label>
            <select
              value={leaveReason || 'dismiss'}
              onChange={(e) => onElementChange('leaveReason', e.target.value)}
            >
              <option value="dismiss">单位单方违法解除/辞退</option>
              <option value="expire">合同期满不续签</option>
              <option value="quit">劳动者主动辞职</option>
            </select>
          </div>

          {/* 分割线 */}
          <div style={{ borderTop: '1px dashed var(--border-color)', margin: '0.4rem 0 0.6rem' }}></div>

          {/* 法条计算明细展示 */}
          <div className="price-row">
            <span>
              二倍工资差额{' '}
              <span
                className="law"
                title="《劳动合同法》第82条：用人单位自用工之日起超过1个月不满1年未签书面合同，应每月支付二倍工资，最多11个月。"
              >
                第82条 ⓘ
              </span>
            </span>
            <strong>¥ {doubleSalary.toLocaleString()}</strong>
          </div>

          <div className="price-row">
            <span>
              {getDamagesLabel()}{' '}
              <span
                className="law"
                title="《劳动合同法》第87条：违法解除按经济补偿标准二倍支付（2N）。第47条：经济补偿按工作年限每满一年支付一个月工资。"
              >
                第87/47条 ⓘ
              </span>
            </span>
            <strong style={{ color: getDamagesColor() }}>
              ¥ {damages.toLocaleString()}
            </strong>
          </div>

          <div className="price-row">
            <span>在职月数折算</span>
            <strong>{workingMonths} 个月</strong>
          </div>

          <div className="price-row total">
            <span>索赔总额估算</span>
            <strong>¥ {total.toLocaleString()}</strong>
          </div>

          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            * 测算结果由法条算法模型实时渲染，仅供参考，最终以承办律师的专业判断为准。
          </p>
        </div>
      </div>

      {/* 底部固定：生成法律意见书 */}
      <div className="right-footer">
        {remainCount > 0 ? (
          <div className="gate-hint" style={{ color: 'var(--warning)' }}>
            还有 {remainCount} 份材料待脱敏，完成后方可生成
          </div>
        ) : (
          <div className="gate-hint" style={{ color: 'var(--success)' }}>
            全部材料已脱敏，可生成意见书
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={onGenerate}
          disabled={remainCount > 0 || generating}
        >
          {generating ? '生成意见书拉取中...' : '生成专业法律意见书'}
        </button>
      </div>
    </div>
  );
}

// #endregion
