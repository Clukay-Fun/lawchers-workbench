import { useState } from 'react';
import { uploadFile, redactFile, redactScanFile, analyzeCase, confirmMaterial } from '../../api';

/**
 * 描述: 办案区左栏材料列表与上传组件
 * 主要功能:
 *     - 展示当前案件关联的材料卡片列表，支持点击切换
 *     - 提供追加案件材料的上传弹窗，集成上传→脱敏→要素分析→持久化链路
 *     - 使用 legal-desensitizer 高保真脱敏
 */

// #region 材料解析辅助算法

const ENTITY_TYPE_MAP = {
  PERSON: 'PERSON',
  ORG: 'ORG',
  ADDRESS: 'ADDRESS',
  PHONE: 'PHONE',
  LANDLINE: 'PHONE',
  EMAIL: 'EMAIL',
  ID_CARD: 'ID_CARD',
  BANK_CARD: 'BANK_CARD',
  BANK_BRANCH: 'BANK_BRANCH',
  MONEY: 'MONEY',
  TIME: 'DATE',
  DATE: 'DATE',
  CASE_NO: 'CASE_NO',
  ORG_CODE: 'ORG_CODE',
};

export const buildChunksFromOccurrences = (redactedText, entities, occurrences) => {
  const entityMap = {};
  for (const ent of entities) {
    entityMap[ent.id] = ent;
  }

  const sorted = [...occurrences].sort((a, b) => a.redacted_start - b.redacted_start);
  const chunks = [];
  let cursor = 0;

  for (const occ of sorted) {
    if (occ.redacted_start < cursor) continue;
    const entity = entityMap[occ.entity_id];
    if (!entity) continue;

    if (occ.redacted_start > cursor) {
      chunks.push({
        text: redactedText.substring(cursor, occ.redacted_start),
        isEntity: false,
      });
    }

    chunks.push({
      text: entity.original,
      isEntity: true,
      type: ENTITY_TYPE_MAP[entity.entity_type] || entity.entity_type,
      entityId: entity.id,
      entityType: entity.entity_type,
      replacement: entity.replacement,
      revealed: false,
    });

    cursor = occ.redacted_end;
  }

  if (cursor < redactedText.length) {
    chunks.push({
      text: redactedText.substring(cursor),
      isEntity: false,
    });
  }

  return chunks;
};

// #endregion

// #region 左栏组件实现

export default function MaterialList({
  materials,
  activeIndex,
  onSelect,
  onAddMaterial,
  onTriggerToast,
  onUpdateCalculator,
  isModalOpen,
  setModalOpen,
  rulesConfig,
  caseId,
  onMaterialStatusChange,
}) {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState('');

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  // Stage 4: 上传→脱敏→分析→持久化的完整链路
  const handleStartUpload = async () => {
    if (!selectedFile) {
      onTriggerToast('请先选择需要上传的材料文件');
      return;
    }

    setUploading(true);
    try {
      // 1. 上传文件到 uploads/<case_id>/，写 material 表
      setUploadProgress('正在上传文件…');
      const uploadData = await uploadFile(selectedFile, caseId);
      const { materialId, rawText, filename, filePath, displayMode } = uploadData;

      // 2. 调用脱敏（传入 materialId 以持久化实体到 DB）
      setUploadProgress('正在进行智能脱敏处理…');
      let redactData;
      const fullFilePath = filePath; // 后端返回的是绝对路径
      if (displayMode === 'text') {
        redactData = await redactFile(fullFilePath, 'strict', rulesConfig || {}, materialId);
      } else {
        redactData = await redactScanFile(fullFilePath, 'strict', rulesConfig || {}, materialId);
      }

      // 3. 基于 occurrences 切片生成 chunks
      const chunks = buildChunksFromOccurrences(
        redactData.redactedText,
        redactData.entities,
        redactData.occurrences
      );

      // 4. 调用分析要素接口（传入 caseId 以持久化要素到 case_element）
      setUploadProgress('正在提取案件要素…');
      try {
        const textToAnalyze = displayMode === 'text' ? rawText : redactData.redactedText;
        const analysisData = await analyzeCase(textToAnalyze, caseId);
        if (analysisData) {
          const updates = {};
          if (analysisData.entryDate) updates.entryDate = analysisData.entryDate;
          if (analysisData.leaveDate) updates.leaveDate = analysisData.leaveDate;
          if (analysisData.monthlySalary) updates.salary = analysisData.monthlySalary;
          if (analysisData.hasContract !== undefined) updates.hasContract = analysisData.hasContract;
          if (analysisData.leaveReason) {
            if (analysisData.leaveReason.includes('违法解除') || analysisData.leaveReason.includes('辞退')) {
              updates.leaveReason = 'dismiss';
            } else if (analysisData.leaveReason.includes('期满不续签')) {
              updates.leaveReason = 'expire';
            } else {
              updates.leaveReason = 'quit';
            }
          }
          onUpdateCalculator(updates);
          onTriggerToast('已依据材料内容自动反填或重算右侧赔偿计算器');
        }
      } catch (err) {
        console.warn('要素自动识别失败，允许继续编辑：', err);
      }

      // 5. 组合构造材料对象并加入办案区
      const newMaterial = {
        id: materialId,
        name: filename,
        filePath: fullFilePath,
        status: 'todo',
        rawText: displayMode === 'text' ? rawText : (rawText || redactData.redactedText),
        redactedText: redactData.redactedText,
        chunks,
        entities: redactData.entities,
        occurrences: redactData.occurrences,
        entitiesCount: redactData.audit.totalEntities,
        audit: redactData.audit,
        displayMode,
        redactedImageUrl: redactData.redactedImageUrl || null,
      };

      onAddMaterial(newMaterial);
      setModalOpen(false);
      setSelectedFile(null);
      setUploadProgress('');
    } catch (err) {
      console.error(err);
      onTriggerToast(err.message || '材料解析上传失败，请稍后重试');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="col-left">
      <h4 className="form-title">本案材料</h4>

      {materials.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
          暂无关联案件材料
        </div>
      ) : (
        materials.map((mat, index) => (
          <div
            key={mat.id || index}
            className={`file-item ${index === activeIndex ? 'active' : ''}`}
            onClick={() => onSelect(index)}
          >
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mat.name}
              </div>
              <div className="meta">
                {mat.status === 'done' ? '已脱敏' : '待校对'} · {mat.entitiesCount || 0} 处实体
              </div>
            </div>
          </div>
        ))
      )}

      <div
        className="compact-upload"
        style={{ marginTop: '0.8rem' }}
        onClick={() => setModalOpen(true)}
      >
        ＋ 拖入或点击追加材料
      </div>

      <h4 className="form-title" style={{ marginTop: '1.4rem' }}>操作提示</h4>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.9 }}>
        选中正文文字可手动<strong style={{ color: 'var(--primary)', margin: '0 2px' }}>脱敏</strong>；对已脱敏的彩色徽章单击可切换明密文，点击<strong style={{ color: 'var(--primary)', margin: '0 2px' }}>右键</strong>可取消脱敏并还原。
      </div>

      {/* 追加材料弹窗 */}
      <div className={`modal-backdrop ${isModalOpen ? 'open' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}>
        <div className="modal">
          <div className="modal-head">
            <h3>追加案件材料</h3>
            <button className="x" onClick={() => setModalOpen(false)}>&times;</button>
          </div>
          <div className="modal-body">
            <div
              className="drop-zone"
              onClick={() => document.getElementById('file-upload-input').click()}
            >
              <div className="big">＋</div>
              <div style={{ fontWeight: 600, margin: '0.4rem 0' }}>
                {selectedFile ? `已选中: ${selectedFile.name}` : '点击选择文件，或拖拽到此处'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                支持 PDF / Word / TXT / 常见图片，单个 ≤ 10MB
              </div>
            </div>
            <input
              id="file-upload-input"
              type="file"
              accept=".txt,.pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.8rem', lineHeight: 1.8 }}>
              上传后将自动解析文本并标记敏感信息，需在脱敏校对区确认后方可计入「材料脱敏进度」。
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={uploading}>取消</button>
            <button
              className="btn btn-primary"
              onClick={handleStartUpload}
              disabled={uploading || !selectedFile}
            >
              {uploading ? (uploadProgress || '处理中...') : '开始上传'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// #endregion
