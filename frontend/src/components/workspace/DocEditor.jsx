import { useState, useEffect } from 'react';
import { useSelection } from '../../hooks/useSelection';
import EntityTag from './EntityTag';

/**
 * 描述: 办案区中栏正文脱敏编辑器组件
 * 主要功能:
 *     - 将 Token/Chunk 文本数组渲染到编辑器正文区
 *     - 支持右键取消脱敏和左键点击明暗码切换
 *     - 结合使用 useSelection Hook，在鼠标选区上实时浮现脱敏实体分类气泡 Popover
 *     - 提供实体按类型高亮过滤显示，以及一键展开/隐匿全部明文的功能
 *     - 结合 highlightFieldId 接口，实现与右侧要素表单的双向聚焦滚动定位
 */

// #region 类型映射和辅助序列化

const TYPE_MAP = {
  PERSON: '姓名',
  NAME: '姓名',
  PHONE: '手机',
  LANDLINE: '座机',
  ORG: '机构',
  COMPANY: '企业',
  ID_CARD: '证件',
  EMAIL: '邮箱',
  ADDRESS: '住址',
  ADDR: '住址',
  BANK_CARD: '银行卡',
  BANK_BRANCH: '银行',
  MONEY: '金额',
  TIME: '时间',
  DATE: '日期', // 新增 DATE 映射
  CASE_NO: '案号',
  ORG_CODE: '信用代码',
};

/**
 * 将 Chunk 列表拼装还原为后端识别的 markedText 格式
 * @param {Array} chunks 数据片段数组
 * @returns {string} 拼装后的标记字符串
 */
const serializeChunksToMarkedText = (chunks) => {
  return chunks
    .map((chunk) => {
      if (chunk.isEntity) {
        return `[${chunk.type}:${chunk.text}]`;
      }
      return chunk.text;
    })
    .join('');
};

/**
 * 合并相邻的非实体普通文本 chunk
 * @param {Array} chunks 数据片段数组
 * @returns {Array} 净化后的 Chunk 数组
 */
const mergeAdjacentChunks = (chunks) => {
  const result = [];
  for (const chunk of chunks) {
    if (result.length > 0 && !result[result.length - 1].isEntity && !chunk.isEntity) {
      result[result.length - 1].text += chunk.text;
    } else {
      result.push({ ...chunk });
    }
  }
  return result;
};

/**
 * 判断实体类型是否匹配当前筛选分类
 * @param {string} entityType 实体类型（如 PERSON, ORG, PHONE, LANDLINE 等）
 * @param {string} filter 筛选分类标识
 * @returns {boolean} 是否匹配
 */
const matchesFilter = (entityType, filter) => {
  const FILTER_MAP = {
    person: ['PERSON', 'NAME'],
    org: ['ORG', 'COMPANY'],
    phone: ['PHONE', 'LANDLINE'],
    id_card: ['ID_CARD', 'ORG_CODE', 'EMAIL'],
    address: ['ADDRESS', 'ADDR'],
  };
  const types = FILTER_MAP[filter];
  return types ? types.includes(entityType) : false;
};

// #endregion

// #region 中栏编辑器组件实现

/**
 * 正文编辑器组件
 * @param {Object} props 组件属性
 * @param {Object} props.material 当前加载的材料文件对象
 * @param {number} props.materialIndex 当前材料在数组中的索引
 * @param {Function} props.onUpdateMaterialChunks 更新材料 Chunk 数据的方法
 * @param {Function} props.onTriggerToast 轻提示回调
 * @param {string} props.highlightFieldId 右侧表单触发的出处定位字段 id
 * @param {Function} props.onClearHighlight 完毕后清除高亮字段 id 的回调
 */
export default function DocEditor({
  material,
  materialIndex,
  onUpdateMaterialChunks,
  onTriggerToast,
  highlightFieldId,
  onClearHighlight,
  onRequestUpload,
  onReRedact,
  onExportRedacted,
  exporting,
}) {
  const { selectionInfo, handleMouseUp, clearSelection } = useSelection();
  const [activeFilter, setActiveFilter] = useState('all');
  const [reRedacting, setReRedacting] = useState(false);

  // 获取当前的 Chunk 数组
  const chunks = material?.chunks || [];

  /**
   * 触发一键重新脱敏
   */
  const handleReRedact = async () => {
    if (!material?.filePath) {
      onTriggerToast('未检测到该材料的本地原件存储路径，无法重新脱敏');
      return;
    }
    setReRedacting(true);
    try {
      await onReRedact(material.filePath, materialIndex, material.displayMode);
      onTriggerToast('重新脱敏成功！');
    } catch (err) {
      console.error(err);
      onTriggerToast(err.message || '重新脱敏失败，请重试');
    } finally {
      setReRedacting(false);
    }
  };

  // #region 1. 双向定位聚焦

  useEffect(() => {
    if (highlightFieldId) {
      // 延迟确保节点已生成
      setTimeout(() => {
        // 根据 data-field 属性寻找实体节点
        const entityDom = document.querySelector(`.ent[data-field="${highlightFieldId}"]`);
        if (entityDom) {
          entityDom.scrollIntoView({ behavior: 'smooth', block: 'center' });
          entityDom.classList.add('highlight');
          const timer = setTimeout(() => {
            entityDom.classList.remove('highlight');
            onClearHighlight();
          }, 1600);
          return () => clearTimeout(timer);
        } else {
          onTriggerToast('正文中未检测到该事实要素出处映射');
          onClearHighlight();
        }
      }, 50);
    }
  }, [highlightFieldId, onClearHighlight, onTriggerToast]);

  // #endregion

  // #region 2. 脱敏修剪核心逻辑

  /**
   * 应用脱敏标注
   * @param {string} type 选取的敏感实体类型
   */
  const applyMask = (type) => {
    if (!selectionInfo) return;

    const { chunkIndex, selectedText, startOffset } = selectionInfo;
    const chunk = chunks[chunkIndex];

    if (!chunk || chunk.isEntity) return;

    // 根据选区偏移划分前、中、后三段
    const preText = chunk.text.substring(0, startOffset);
    const postText = chunk.text.substring(startOffset + selectedText.length);

    const newEntity = {
      text: selectedText,
      isEntity: true,
      type: type.toUpperCase(),
      revealed: false,
    };

    const nextChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === chunkIndex) {
        if (preText) nextChunks.push({ text: preText, isEntity: false });
        nextChunks.push(newEntity);
        if (postText) nextChunks.push({ text: postText, isEntity: false });
      } else {
        nextChunks.push(chunks[i]);
      }
    }

    const merged = mergeAdjacentChunks(nextChunks);
    onUpdateMaterialChunks(materialIndex, merged, serializeChunksToMarkedText(merged));
    clearSelection();
    onTriggerToast(`已成功添加敏感标注：${TYPE_MAP[type.toUpperCase()]}`);
  };

  /**
   * 取消指定的敏感标注
   * @param {number} idx 待取消的 Chunk 索引
   */
  const cancelMask = (idx) => {
    const nextChunks = [...chunks];
    const chunk = nextChunks[idx];
    if (chunk && chunk.isEntity) {
      nextChunks[idx] = {
        text: chunk.text,
        isEntity: false,
      };
      const merged = mergeAdjacentChunks(nextChunks);
      onUpdateMaterialChunks(materialIndex, merged, serializeChunksToMarkedText(merged));
      clearSelection();
      onTriggerToast('已撤销该处脱敏并还原明文');
    }
  };

  /**
   * 点击实体微调：明暗码切换
   * @param {number} idx 当前 Chunk 索引
   */
  const toggleRevealEntity = (idx) => {
    const nextChunks = [...chunks];
    const chunk = nextChunks[idx];
    if (chunk && chunk.isEntity) {
      nextChunks[idx] = {
        ...chunk,
        revealed: !chunk.revealed,
      };
      onUpdateMaterialChunks(materialIndex, nextChunks, serializeChunksToMarkedText(nextChunks));
    }
  };

  /**
   * 批量切换明文与密文
   */
  const handleToggleAllReveal = () => {
    if (chunks.length === 0) return;
    const hasHidden = chunks.some((c) => c.isEntity && !c.revealed);
    const nextChunks = chunks.map((c) => {
      if (c.isEntity) {
        return { ...c, revealed: hasHidden };
      }
      return c;
    });
    onUpdateMaterialChunks(materialIndex, nextChunks, serializeChunksToMarkedText(nextChunks));
    onTriggerToast(hasHidden ? '已临时展示全部明文' : '已恢复全部脱敏掩码');
  };

  // #endregion

  if (!material) {
    return (
      <div className="col-center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="editor-empty">
          <div className="editor-empty-icon">📄</div>
          <div className="editor-empty-title">尚未上传案件材料</div>
          <div className="editor-empty-desc">
            上传后将自动解析文本并识别敏感信息，<br />在此进行脱敏校对。
          </div>
          <button className="btn btn-primary" style={{ width: 'auto' }} onClick={onRequestUpload}>
            ＋ 上传材料文件
          </button>
        </div>
      </div>
    );
  }

  // 绑定字段映射规则（根据类型匹配输入框 id）
  const getFieldMapping = (chunk) => {
    if (chunk.type === 'PERSON' || chunk.type === 'NAME') return 'inp-name';
    if (chunk.type === 'ORG' || chunk.type === 'COMPANY') return 'inp-company';
    return undefined;
  };

  const isImageMode = material.displayMode === 'image';
  const isPdf = material.redactedImageUrl && material.redactedImageUrl.toLowerCase().endsWith('.pdf');

  return (
    <div className="col-center">
      {/* 顶部筛选及操作栏 */}
      <div className="editor-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
            {material.name} · 脱敏校对
          </span>
          {isImageMode && (
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--t-id-b)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              ⚠️ 扫描件脱敏不可还原
            </span>
          )}
        </div>
        <div className="editor-toolbar">
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>按类型筛选：</span>
          <span
            className={`chip ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            全部
          </span>
          <span
            className={`chip ${activeFilter === 'person' ? 'active' : ''}`}
            onClick={() => setActiveFilter('person')}
          >
            <span className="dot" style={{ backgroundColor: 'var(--t-name-b)' }}></span>姓名
          </span>
          <span
            className={`chip ${activeFilter === 'org' ? 'active' : ''}`}
            onClick={() => setActiveFilter('org')}
          >
            <span className="dot" style={{ backgroundColor: 'var(--t-company-b)' }}></span>机构
          </span>
          <span
            className={`chip ${activeFilter === 'phone' ? 'active' : ''}`}
            onClick={() => setActiveFilter('phone')}
          >
            <span className="dot" style={{ backgroundColor: 'var(--t-phone-b)' }}></span>电话
          </span>
          <span
            className={`chip ${activeFilter === 'id_card' ? 'active' : ''}`}
            onClick={() => setActiveFilter('id_card')}
          >
            <span className="dot" style={{ backgroundColor: 'var(--t-id-b)' }}></span>证件
          </span>
          <span
            className={`chip ${activeFilter === 'address' ? 'active' : ''}`}
            onClick={() => setActiveFilter('address')}
          >
            <span className="dot" style={{ backgroundColor: 'var(--t-addr-b)' }}></span>住址
          </span>
        </div>
        <div className="editor-toolbar" style={{ marginTop: '0.4rem' }}>
          <span className="chip" onClick={handleToggleAllReveal}>全部明文/脱敏</span>
          <button
            className="chip"
            style={{
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              cursor: reRedacting ? 'not-allowed' : 'pointer',
              opacity: reRedacting ? 0.6 : 1,
              fontWeight: 500,
              padding: '2px 8px'
            }}
            onClick={handleReRedact}
            disabled={reRedacting}
          >
            {reRedacting ? '正在重新脱敏...' : '🔄 一键重新脱敏'}
          </button>
          <span className="chip" onClick={() => onTriggerToast('系统演示：已将校对后文本输出为纯脱敏 .txt 文件')}>导出脱敏版</span>
          {material?.id && onExportRedacted && (
            <button
              className="chip"
              style={{
                backgroundColor: '#f0fdf4',
                color: '#16a34a',
                border: '1px solid #bbf7d0',
                cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.6 : 1,
                fontWeight: 500,
                padding: '2px 8px'
              }}
              onClick={() => onExportRedacted(material.id)}
              disabled={exporting}
            >
              {exporting ? '导出中...' : '📄 导出 .docx'}
            </button>
          )}
        </div>
      </div>

      {isImageMode ? (
        /* 双栏对照编辑区（左边白框图，右边 OCR 文本） */
        <div className="editor-split-body" style={{ display: 'flex', flex: 1, gap: '1rem', width: '100%', minHeight: 0, overflow: 'hidden', padding: '0 1rem 1rem 1rem' }}>
          {/* 左侧：白框图预览 */}
          <div className="editor-scan-viewer" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius)', backgroundColor: '#fff', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            {isPdf ? (
              <iframe
                src={`http://localhost:3001${material.redactedImageUrl}`}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="脱敏扫描件预览"
              />
            ) : (
              <img
                src={`http://localhost:3001${material.redactedImageUrl}`}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                alt="脱敏扫描图片预览"
              />
            )}
          </div>

          {/* 右侧：OCR 文本校对 */}
          <div className="editor-body" style={{ flex: 1, margin: 0, height: '100%', overflowY: 'auto' }} onMouseUp={handleMouseUp}>
            {chunks.map((chunk, index) => {
              if (chunk.isEntity) {
                const isDim = activeFilter !== 'all' && !matchesFilter(chunk.type, activeFilter);
                return (
                  <EntityTag
                    key={index}
                    chunkIndex={index}
                    type={chunk.type}
                    text={chunk.text}
                    revealed={chunk.revealed}
                    isDim={isDim}
                    dataField={getFieldMapping(chunk)}
                    onClick={() => toggleRevealEntity(index)}
                    onCancelMask={() => cancelMask(index)}
                  />
                );
              }
              return (
                <span key={index} data-chunk-index={index}>
                  {chunk.text}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        /* 单栏文本校对编辑区 */
        <div className="editor-body" onMouseUp={handleMouseUp}>
          {chunks.length === 0 && (
            material?.rawText && material.rawText.trim() ? (
              /* 兜底：脱敏切片为空但有原始文本时，仍展示原文，避免中间空白 */
              <span style={{ whiteSpace: 'pre-wrap' }}>{material.rawText}</span>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>
                未解析到可显示的文本内容。若该文件为扫描件 PDF（无文字层），请改用图片/扫描脱敏方式处理。
              </div>
            )
          )}
          {chunks.map((chunk, index) => {
            if (chunk.isEntity) {
              // 类型匹配过滤
              const isDim = activeFilter !== 'all' && !matchesFilter(chunk.type, activeFilter);
              return (
                <EntityTag
                  key={index}
                  chunkIndex={index}
                  type={chunk.type}
                  text={chunk.text}
                  revealed={chunk.revealed}
                  isDim={isDim}
                  dataField={getFieldMapping(chunk)}
                  onClick={() => toggleRevealEntity(index)}
                  onCancelMask={() => cancelMask(index)}
                />
              );
            }
            return (
              <span key={index} data-chunk-index={index}>
                {chunk.text}
              </span>
            );
          })}
        </div>
      )}

      {/* 划词脱敏悬浮气泡 (Popover) */}
      {selectionInfo && (
        <div
          className="sel-popover"
          style={{
            top: `${selectionInfo.rect.top - 45}px`,
            left: `${selectionInfo.rect.left + selectionInfo.rect.width / 2}px`,
          }}
          onMouseDown={(e) => e.stopPropagation()} // 防止触发 document 的 mousedown 误关闭
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <span className="sp-label">脱敏为</span>
            <span className="sp-btn" onClick={() => applyMask('PERSON')}>
              <i className="dot" style={{ backgroundColor: 'var(--t-name-b)' }}></i>姓名
            </span>
            <span className="sp-btn" onClick={() => applyMask('ORG')}>
              <i className="dot" style={{ backgroundColor: 'var(--t-company-b)' }}></i>机构
            </span>
            <span className="sp-btn" onClick={() => applyMask('PHONE')}>
              <i className="dot" style={{ backgroundColor: 'var(--t-phone-b)' }}></i>电话
            </span>
            <span className="sp-btn" onClick={() => applyMask('ID_CARD')}>
              <i className="dot" style={{ backgroundColor: 'var(--t-id-b)' }}></i>证件
            </span>
            <span className="sp-btn" onClick={() => applyMask('ADDRESS')}>
              <i className="dot" style={{ backgroundColor: 'var(--t-addr-b)' }}></i>住址
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// #endregion
