/**
 * 描述: 劳动案件关键要素分析与自动算费服务
 * 主要功能:
 *     - 从案卷文本中提取入职时间、离职时间、月薪、合同签署情况等要素
 *     - 根据中华人民共和国劳动合同法计算各项争议补偿金额
 */

// #region 辅助提取工具函数

/**
 * 匹配文本中的日期
 */
function extractDate(text, keywords) {
  for (const kw of keywords) {
    const regex = new RegExp(`${kw}[^\n，。]{0,15}(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日`, 'i');
    const match = regex.exec(text);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return '';
}

/**
 * 匹配文本中的薪资金额
 */
function extractSalary(text) {
  const salaryRegex = /(?:工资|薪资|月薪|待遇|基本工资)(?:为|是|：|:)?\s*(\d+(?:\.\d+)?)\s*(?:元|kbd)/i;
  const match = salaryRegex.exec(text);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * 判断是否签订劳动合同
 */
function checkContractStatus(text) {
  if (/未(?:签订|签署)书面劳动合同|没有签(?:订)?合同/g.test(text)) {
    return false;
  }
  if (/(?:签订|签署)了?劳动合同/g.test(text)) {
    return true;
  }
  return null; // 未提及
}

// #endregion

// #region 核心要素解析与法条算费

/**
 * 提取劳动争议案件要素并进行法条测算
 * @param {string} text 经过脱敏/处理后的文本
 * @returns {Promise<Object>} 要素结构与计算金额
 */
export async function analyzeCaseElements(text) {
  // 1. 基础要素模式匹配（Stage 5: 去掉硬编码默认值，使用真实解析结果）
  const entryDate = extractDate(text, ['入职时间', '入职日期', '进入公司时间', '开始工作时间', '于']) || '';
  const leaveDate = extractDate(text, ['离职时间', '离职日期', '解约日期', '解除合同时间', '最后工作日', '工作至']) || '';
  const monthlySalary = extractSalary(text) || 0;
  
  let hasContract = checkContractStatus(text);
  if (hasContract === null) {
    hasContract = false; // 默认为未签订，契合典型争议
  }

  // 职位解析
  const jobRegex = /(?:职务|岗位|岗位是|担任|任职为)\s*([\u4e00-\u9fa5a-zA-Z]{2,10})/;
  const jobMatch = jobRegex.exec(text);
  const jobTitle = jobMatch ? jobMatch[1] : '';

  // 解除原因解析
  let leaveReason = '公司单方辞退/口头解除';
  if (/主动辞职|个人原因辞职|员工辞职/g.test(text)) {
    leaveReason = '劳动者主动辞职';
  } else if (/合同到期|合同届满/g.test(text)) {
    leaveReason = '劳动合同期满不续签';
  } else if (/违法解除|非法辞退/g.test(text)) {
    leaveReason = '用人单位违法解除劳动合同';
  }

  // 2. 算费模型 (核心劳动法算法)
  let workingMonths = 0;
  let doubleSalaryCompensation = 0; // 未签劳动合同双倍工资差额
  let economicCompensation = 0;      // 经济补偿金
  let illegalDismissalDamages = 0;   // 违法解除赔偿金

  if (entryDate && leaveDate) {
    const start = new Date(entryDate);
    const end = new Date(leaveDate);
    // 计算相差的月份
    workingMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    // 加上不满整月的天数折算
    if (end.getDate() - start.getDate() > 15) {
      workingMonths += 1;
    } else if (end.getDate() - start.getDate() > 0) {
      workingMonths += 0.5;
    }

    // A. 未签劳动合同双倍工资计算 (劳动合同法第82条)
    // 自入职满1个月的次日起，最长计算11个月的双倍工资差额
    if (!hasContract && workingMonths > 1) {
      const unpaidMonths = Math.min(11, workingMonths - 1);
      doubleSalaryCompensation = unpaidMonths * monthlySalary;
    }

    // B. 经济补偿金计算 (劳动合同法第47条)
    // 按工作年限计算：满1年支付1个月；6个月以上不满1年算1个月；不满6个月支付半个月
    const years = Math.floor(workingMonths / 12);
    const remainingMonths = workingMonths % 12;
    let compensationMultiplier = years;
    if (remainingMonths >= 6) {
      compensationMultiplier += 1;
    } else if (remainingMonths > 0) {
      compensationMultiplier += 0.5;
    }
    economicCompensation = compensationMultiplier * monthlySalary;

    // C. 违法解除赔偿金 (劳动合同法第87条)
    // 赔偿金为经济补偿金的2倍
    if (leaveReason.includes('违法解除') || leaveReason.includes('公司单方辞退')) {
      illegalDismissalDamages = economicCompensation * 2;
    }
  }

  return {
    employeeName: '',
    companyName: '',
    entryDate,
    leaveDate,
    jobTitle,
    monthlySalary,
    hasContract,
    leaveReason,
    workingMonths: Math.round(workingMonths * 10) / 10,
    calculationResult: {
      doubleSalaryCompensation,
      economicCompensation,
      illegalDismissalDamages,
      totalClaimAmount: doubleSalaryCompensation + (illegalDismissalDamages || economicCompensation)
    }
  };
}

// #endregion
