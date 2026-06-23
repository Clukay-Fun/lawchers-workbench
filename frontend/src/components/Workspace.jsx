import { useState, useMemo, useCallback } from 'react';
import MaterialList, { buildChunksFromOccurrences } from './workspace/MaterialList';
import DocEditor from './workspace/DocEditor';
import CalcPanel from './workspace/CalcPanel';
import { generateOpinion, redactFile, redactScanFile, confirmMaterial, confirmOpinion, exportRedactedDocx, exportOpinionDocx, deleteMaterial } from '../api';

/**
 * 描述: 智能办案工作台 Workspace 容器组件
 * 主要功能:
 *     - 左栏材料管理、中栏脱敏编辑、右栏要素算费的网格容器
 *     - 统一调用后端 /analyze 进行要素提取与持久化 (Stage 5)
 *     - 意见书生成→草稿→人工确认→导出链路 (Stage 6/7)
 */

export default function Workspace({ currentCase, onUpdateCase, onBackHome, sysSettings, caseId, onRefreshCase }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [opinionDoc, setOpinionDoc] = useState('');
  const [opinionId, setOpinionId] = useState(null);
  const [opinionStatus, setOpinionStatus] = useState('draft');
  const [generating, setGenerating] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastTimer, setToastTimer] = useState(null);
  const [highlightFieldId, setHighlightFieldId] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 1. 全局轻提示
  const triggerToast = useCallback((msg) => {
    setToastMsg(msg);
    setShowToast(true);
    if (toastTimer) clearTimeout(toastTimer);
    const timer = setTimeout(() => setShowToast(false), 2200);
    setToastTimer(timer);
  }, [toastTimer]);

  // 2. 本地实时算费（前端实时渲染，后端 /analyze 为持久化权威来源）
  const calculationResult = useMemo(() => {
    const { entryDate, leaveDate, salary, hasContract, leaveReason } = currentCase.calculatorInput || {};
    const monthlySalary = parseFloat(salary) || 0;

    if (!entryDate || !leaveDate) {
      return { workingMonths: 0, doubleSalary: 0, damages: 0, total: 0 };
    }

    const s = new Date(entryDate);
    const e = new Date(leaveDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) {
      return { workingMonths: 0, doubleSalary: 0, damages: 0, total: 0 };
    }

    let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    const d = e.getDate() - s.getDate();
    if (d > 15) months += 1;
    else if (d > 0) months += 0.5;
    months = Math.max(0, Math.round(months * 10) / 10);

    let doubleSalary = 0;
    if (hasContract === false && months > 1) {
      doubleSalary = Math.min(11, months - 1) * monthlySalary;
    }

    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    let multiplier = years;
    if (remainingMonths >= 6) multiplier += 1;
    else if (remainingMonths > 0) multiplier += 0.5;
    const economicComp = multiplier * monthlySalary;

    let damages = 0;
    if (leaveReason === 'dismiss') damages = economicComp * 2;
    else if (leaveReason === 'expire') damages = economicComp;

    return { workingMonths: months, doubleSalary, damages, total: doubleSalary + damages };
  }, [currentCase.calculatorInput]);

  // 3. 处理要素字段更新
  const handleElementChange = (field, val) => {
    onUpdateCase({
      ...currentCase,
      calculatorInput: { ...currentCase.calculatorInput, [field]: val },
    });
  };

  // 4. 更新材料 Chunks
  const handleUpdateMaterialChunks = (materialIndex, updatedChunks, updatedMarkedText) => {
    const updatedMaterials = [...(currentCase.materials || [])];
    updatedMaterials[materialIndex] = {
      ...updatedMaterials[materialIndex],
      chunks: updatedChunks,
      markedText: updatedMarkedText,
    };
    onUpdateCase({ ...currentCase, materials: updatedMaterials });
  };

  // 5. 一键重新脱敏
  const handleReRedactMaterial = async (filePath, index, displayMode) => {
    const rulesConfig = sysSettings?.rulesConfig || {};
    const mat = currentCase.materials?.[index];
    const matId = mat?.id;

    let redactResult;
    if (displayMode === 'text') {
      redactResult = await redactFile(filePath, 'strict', rulesConfig, matId);
    } else {
      redactResult = await redactScanFile(filePath, 'strict', rulesConfig, matId);
    }

    const nextChunks = buildChunksFromOccurrences(
      redactResult.redactedText,
      redactResult.entities,
      redactResult.occurrences
    );

    const updatedMaterials = [...(currentCase.materials || [])];
    updatedMaterials[index] = {
      ...updatedMaterials[index],
      status: 'todo',
      redactedText: redactResult.redactedText,
      chunks: nextChunks,
      entities: redactResult.entities,
      occurrences: redactResult.occurrences,
      entitiesCount: redactResult.audit.totalEntities,
      audit: redactResult.audit,
      redactedImageUrl: redactResult.redactedImageUrl || null,
    };

    onUpdateCase({ ...currentCase, materials: updatedMaterials });
    triggerToast('重新脱敏成功');
  };

  // 6. 切换材料脱敏状态（调后端 API 持久化）
  const handleToggleMaterialStatus = async (materialIndex) => {
    const updatedMaterials = [...(currentCase.materials || [])];
    const mat = updatedMaterials[materialIndex];
    if (!mat) return;

    const newStatus = mat.status === 'done' ? 'todo' : 'done';
    updatedMaterials[materialIndex] = { ...mat, status: newStatus };

    // 调后端 API 持久化状态
    if (mat.id) {
      try {
        if (newStatus === 'done') {
          await confirmMaterial(mat.id);
        } else {
          // 回退到 todo 状态（可选实现）
        }
      } catch (err) {
        console.error('更新材料状态失败:', err);
      }
    }

    onUpdateCase({ ...currentCase, materials: updatedMaterials });
    triggerToast(newStatus === 'done' ? `材料「${mat.name}」已确认为脱敏完成` : `材料「${mat.name}」已变更为待脱敏状态`);
  };

  // 7. 追加材料
  const handleAddMaterial = (newMat) => {
    const updatedMaterials = [...(currentCase.materials || []), newMat];
    // 自动选中刚上传的材料，便于立即查看其脱敏校对内容
    onUpdateCase({ ...currentCase, materials: updatedMaterials, selectedMaterialIndex: updatedMaterials.length - 1 });
    triggerToast(`材料「${newMat.name}」已成功解析并追加至本案`);
  };

  // 8. 切换材料
  const handleSelectMaterial = (idx) => {
    onUpdateCase({ ...currentCase, selectedMaterialIndex: idx });
  };

  // 8.5 删除材料（调后端 DELETE 并更新本地状态与选中索引）
  const handleDeleteMaterial = async (index, materialId) => {
    const mats = currentCase.materials || [];
    const target = mats[index];
    try {
      if (materialId) await deleteMaterial(materialId);
    } catch (err) {
      console.error('删除材料失败:', err);
      triggerToast(err.message || '删除材料失败');
      return;
    }
    const updated = mats.filter((_, i) => i !== index);
    const prevIdx = currentCase.selectedMaterialIndex || 0;
    let nextIdx = prevIdx;
    if (index < prevIdx) nextIdx = prevIdx - 1;
    else if (index === prevIdx) nextIdx = Math.max(0, Math.min(prevIdx, updated.length - 1));
    onUpdateCase({ ...currentCase, materials: updated, selectedMaterialIndex: nextIdx });
    triggerToast(`材料「${target?.name || ''}」已删除`);
  };

  // 9. 出处定位
  const handleLocateEntity = (fieldId) => {
    setHighlightFieldId(fieldId);
    triggerToast('已在正文区高亮定位该要素出处');
  };

  // 10. 生成意见书（Stage 6: 存入 opinion 表 + exports/）
  const handleGenerateDocument = async () => {
    const hasTodo = (currentCase.materials || []).some((m) => m.status !== 'done');
    if (hasTodo) {
      triggerToast('尚有材料未完成脱敏，无法生成意见书');
      return;
    }

    setGenerating(true);
    try {
      const elements = {
        employeeName: currentCase.employeeName,
        companyName: currentCase.companyName,
        entryDate: currentCase.calculatorInput.entryDate,
        leaveDate: currentCase.calculatorInput.leaveDate,
        jobTitle: currentCase.calculatorInput.jobTitle || '技术开发岗',
        monthlySalary: parseFloat(currentCase.calculatorInput.salary) || 0,
        hasContract: currentCase.calculatorInput.hasContract,
        leaveReason: currentCase.calculatorInput.leaveReason === 'dismiss'
          ? '用人单位单方违法解除/辞退'
          : (currentCase.calculatorInput.leaveReason === 'expire' ? '劳动合同期满不续签' : '劳动者主动辞职'),
        workingMonths: calculationResult.workingMonths,
        calculationResult: {
          doubleSalaryCompensation: calculationResult.doubleSalary,
          economicCompensation: calculationResult.damages / (currentCase.calculatorInput.leaveReason === 'dismiss' ? 2 : 1),
          illegalDismissalDamages: calculationResult.damages,
          totalClaimAmount: calculationResult.total,
        },
      };

      // 传入 caseId 以持久化到 opinion 表
      const result = await generateOpinion(elements, 'labor_standard', caseId);
      setOpinionDoc(result.opinionText || '无法加载意见书文本');
      setOpinionId(result.opinionId || null);
      setOpinionStatus(result.status || 'draft');
      setDrawerOpen(true);
    } catch (err) {
      console.error(err);
      triggerToast(err.message || '法律意见书生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  // 11. 确认并保存意见书（Stage 6: 人工确认 → confirmed）
  const handleSaveOpinion = async () => {
    if (opinionId) {
      try {
        await confirmOpinion(opinionId);
        setOpinionStatus('confirmed');
        triggerToast('意见书已确认并归档保存');
      } catch (err) {
        console.error('确认意见书失败:', err);
        triggerToast('确认意见书失败: ' + (err.message || '未知错误'));
        return;
      }
    }

    onUpdateCase({
      ...currentCase,
      status: 'done',
      opinionText: opinionDoc,
      totalAmount: calculationResult.total,
    });
    setDrawerOpen(false);
    onBackHome();
  };

  // 12. 导出脱敏材料为 .docx (Stage 7)
  const handleExportRedacted = async (materialId) => {
    setExporting(true);
    try {
      await exportRedactedDocx(materialId);
      triggerToast('脱敏文档导出成功');
    } catch (err) {
      triggerToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // 13. 导出意见书为 .docx (Stage 7, 仅限已确认)
  const handleExportOpinion = async () => {
    if (!opinionId) {
      triggerToast('暂无可导出的意见书');
      return;
    }
    if (opinionStatus !== 'confirmed') {
      triggerToast('意见书尚未人工确认，不得对外导出');
      return;
    }
    setExporting(true);
    try {
      await exportOpinionDocx(opinionId);
      triggerToast('意见书导出成功');
    } catch (err) {
      triggerToast(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const currentMaterial = currentCase.materials?.[currentCase.selectedMaterialIndex || 0];

  return (
    <div className="workspace-grid">
      {/* 左栏：材料列表 */}
      <MaterialList
        materials={currentCase.materials || []}
        activeIndex={currentCase.selectedMaterialIndex || 0}
        onSelect={handleSelectMaterial}
        onDeleteMaterial={handleDeleteMaterial}
        onAddMaterial={handleAddMaterial}
        onTriggerToast={triggerToast}
        isModalOpen={uploadOpen}
        setModalOpen={setUploadOpen}
        rulesConfig={sysSettings?.rulesConfig || {}}
        caseId={caseId}
        onUpdateCalculator={(inputs) => {
          onUpdateCase({
            ...currentCase,
            calculatorInput: { ...currentCase.calculatorInput, ...inputs },
          });
        }}
      />

      {/* 中栏：脱敏编辑器 */}
      <DocEditor
        material={currentMaterial}
        materialIndex={currentCase.selectedMaterialIndex || 0}
        onUpdateMaterialChunks={handleUpdateMaterialChunks}
        onTriggerToast={triggerToast}
        highlightFieldId={highlightFieldId}
        onClearHighlight={() => setHighlightFieldId('')}
        onRequestUpload={() => setUploadOpen(true)}
        onReRedact={handleReRedactMaterial}
        onExportRedacted={handleExportRedacted}
        exporting={exporting}
      />

      {/* 右栏：要素计算器 */}
      <CalcPanel
        materials={currentCase.materials || []}
        calculatorInput={currentCase.calculatorInput}
        calculationResult={calculationResult}
        onToggleMaterialStatus={handleToggleMaterialStatus}
        onElementChange={handleElementChange}
        onLocateEntity={handleLocateEntity}
        onGenerate={handleGenerateDocument}
        generating={generating}
      />

      {/* 意见书抽屉 */}
      <div className={`drawer-backdrop ${drawerOpen ? 'open' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawerOpen(false); }}>
        <div className="drawer-content">
          <div className="drawer-header">
            <h3>法律意见书预览 {opinionStatus === 'draft' ? '(草稿)' : '(已确认)'}</h3>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {opinionStatus === 'confirmed' && opinionId && (
                <button
                  className="btn btn-ghost"
                  style={{ width: 'auto', padding: '4px 12px', fontSize: '0.8rem', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                  onClick={handleExportOpinion}
                  disabled={exporting}
                >
                  {exporting ? '导出中...' : '导出 .docx'}
                </button>
              )}
              <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
            </div>
          </div>
          <div className="drawer-body">
            <div className="preview-paper">
              <h1>
                关于 <span>{currentCase.employeeName}</span> 与 <span>{currentCase.companyName}</span>
                <br />
                劳动争议案之专业法律意见书
              </h1>
              <p style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>日期：2026 年 6 月 23 日</p>
              <p>致：<span>{currentCase.employeeName}</span> 阁下</p>
              <hr style={{ border: 0, borderTop: '1px solid var(--border-color)', margin: '1rem 0' }} />

              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '0.9rem', color: '#334155', marginBottom: '1.6rem' }}>
                {opinionDoc}
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {opinionStatus === 'draft' ? (
                  <>
                    <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleSaveOpinion}>确认并保存</button>
                    <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setDrawerOpen(false)}>取消</button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      * 意见书需人工确认后方可正式归档和导出
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600 }}>意见书已确认归档</span>
                    <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setDrawerOpen(false)}>关闭</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div className={`toast ${showToast ? 'show' : ''}`}>{toastMsg}</div>
    </div>
  );
}
