
/**
 * 描述: 脱敏实体高亮 Badge 徽章组件
 * 主要功能:
 *     - 渲染不同敏感实体类型（姓名、企业、电话、证件、住址）的高亮色彩
 *     - 提供内置的掩码生成算法，根据敏感类型生成脱敏掩码（如 王*锤, 138****5678）
 *     - 响应左键单击（切换明暗文）、右键点击（取消该脱敏项还原明文）
 *     - 响应双击交互（若有关联输入框则自动聚焦，实现双向映射定位）
 */

// #region 辅助算法：动态生成掩码

/**
 * 依据实体敏感类型和原始字串动态计算脱敏掩码
 * @param {string} text 原始文本内容
 * @param {string} type 实体敏感类型 (NAME/PHONE/COMPANY/ID_CARD/EMAIL/ADDR)
 * @returns {string} 脱敏掩码字串
 */
const getMaskedText = (text, type) => {
  if (!text) return '';
  switch (type) {
    case 'PERSON':
    case 'NAME':
      // 姓名脱敏：保留姓，后面替换为星号
      return text[0] + '*'.repeat(Math.max(1, text.length - 1));
    case 'PHONE':
    case 'LANDLINE':
      // 电话脱敏：前三后四，中间四个星号
      return text.length >= 11
        ? text.substring(0, 3) + '****' + text.substring(7)
        : text.substring(0, 2) + '***' + text.substring(Math.max(2, text.length - 2));
    case 'ORG':
    case 'COMPANY':
      // 机构脱敏：前四后四，中间四个星号
      return text.length > 8
        ? text.substring(0, 4) + '****' + text.substring(text.length - 4)
        : text.substring(0, 2) + '***' + text.substring(Math.max(2, text.length - 2));
    case 'ID_CARD':
      // 身份证脱敏：前四后四，中间十个星号
      return text.length >= 15
        ? text.substring(0, 4) + '**********' + text.substring(text.length - 4)
        : text.substring(0, 3) + '******' + text.substring(Math.max(3, text.length - 3));
    case 'EMAIL': {
      // 邮箱脱敏：保留前两位，中间三位加域名
      const parts = text.split('@');
      if (parts.length === 2) {
        const namePart = parts[0];
        const domain = parts[1];
        return namePart.substring(0, Math.min(2, namePart.length)) + '***@' + domain;
      }
      return text.substring(0, 3) + '***';
    }
    case 'ADDRESS':
    case 'ADDR':
      // 住址脱敏：前三后三，中间三个星号
      return text.length > 6
        ? text.substring(0, 3) + '***' + text.substring(text.length - 3)
        : text.substring(0, 2) + '***';
    case 'BANK_CARD':
      // 银行卡脱敏：前四后四
      return text.length > 8
        ? text.substring(0, 4) + '********' + text.substring(text.length - 4)
        : '****' + text.substring(Math.max(0, text.length - 4));
    case 'MONEY':
      // 金额脱敏：显示为 ¥***
      return '¥***';
    case 'DATE':
    case 'TIME':
      // 时间脱敏：显示为 ****年**月**日
      return '****年**月';
    case 'CASE_NO':
      // 案号脱敏
      return '(****)***号';
    case 'ORG_CODE':
      // 统一社会信用代码脱敏
      return text.length > 6
        ? text.substring(0, 3) + '**********' + text.substring(text.length - 3)
        : '***';
    case 'BANK_BRANCH':
      // 银行信息脱敏
      return text.length > 6
        ? text.substring(0, 3) + '****' + text.substring(text.length - 3)
        : '***';
    default:
      return '***';
  }
};

const TYPE_LABEL_MAP = {
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
  DATE: '日期',
  CASE_NO: '案号',
  ORG_CODE: '信用代码',
};

// #endregion

// #region 实体徽章组件实现

/**
 * 实体高亮徽章组件
 * @param {Object} props 组件属性
 * @param {number} props.chunkIndex 在 Chunks 列表中的索引
 * @param {string} props.type 实体敏感类型
 * @param {string} props.text 原始明文文本
 * @param {boolean} props.revealed 是否显式展示明文
 * @param {boolean} props.isDim 是否处于筛选淡出置灰状态
 * @param {string} [props.dataField] 双击联动聚焦的右栏输入框 id
 * @param {Function} props.onClick 点击切换明暗文的回调
 * @param {Function} props.onCancelMask 右键点击取消脱敏的回调
 */
export default function EntityTag({
  chunkIndex,
  type,
  text,
  revealed,
  isDim,
  dataField,
  onClick,
  onCancelMask,
}) {
  // 阻止右键默认菜单并执行取消脱敏回调
  const handleContextMenu = (e) => {
    e.preventDefault();
    onCancelMask();
  };

  // 双击实现双向聚焦关联字段
  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (dataField) {
      const inputEl = document.getElementById(dataField);
      if (inputEl) {
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inputEl.focus();
        // 尝试选中输入框内容
        if (typeof inputEl.select === 'function') {
          inputEl.select();
        }
      }
    }
  };

  // 映射高亮的 CSS 类名
  const getTypeClass = (t) => {
    switch (t) {
      case 'PERSON':
      case 'NAME':
        return 't-name';
      case 'PHONE':
      case 'LANDLINE':
        return 't-phone';
      case 'ORG':
      case 'COMPANY':
        return 't-company';
      case 'ID_CARD':
      case 'ORG_CODE':
      case 'EMAIL':
        return 't-id';
      case 'ADDRESS':
      case 'ADDR':
        return 't-addr';
      case 'MONEY':
        return 't-money';
      case 'DATE':
      case 'TIME':
        return 't-time';
      case 'CASE_NO':
        return 't-case';
      case 'BANK_CARD':
      case 'BANK_BRANCH':
        return 't-bank';
      default:
        return '';
    }
  };

  const entityClass = `ent ${getTypeClass(type)} ${revealed ? 'revealed' : ''} ${isDim ? 'dim' : ''}`;
  const displayText = revealed ? text : getMaskedText(text, type);

  return (
    <span
      className={entityClass}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      data-field={dataField}
      data-chunk-index={chunkIndex}
      title="单击：临时查看明文 / 还原掩码　右键：取消该处脱敏"
    >
      {displayText} <span className="tag-label">{TYPE_LABEL_MAP[type] || '敏感'}</span>
    </span>
  );
}

// #endregion
