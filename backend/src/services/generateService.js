/**
 * 描述: 法律意见书生成服务
 * 主要功能:
 *     - 提供标准的劳动争议法律意见书模板
 *     - 将经律师确认的案件要素（时间、薪资、计算结果）动态渲染为 Markdown 格式意见书
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// #region 模板定义

const LABOR_TEMPLATE = `
# 关于 \${employeeName} 与 \${companyName} 劳动争议案之
# 专 业 法 律 意 见 书

**文号**：【律见字（2026）第 061801 号】  
**致**：\${employeeName} 阁下  
**出具人**：智能法律辅助系统 / 承办律师  
**日期**：\${currentDate}  

---

## 一、 案件基础事实梳理

经对阁下提交的案件材料（包含劳动合同意向、银行工资流水、解除通知、聊天记录等）进行解析，梳理出以下关键案件事实要素：

* **用人单位（被申请人）**：\${companyName}
* **劳动者（申请人）**：\${employeeName}
* **入职日期**：\${entryDate}
* **解除/终止日期**：\${leaveDate}
* **工作岗位**：\${jobTitle}
* **月平均工资**：\${monthlySalary} 元
* **劳动合同签订情况**：\${contractStatusText}
* **解除/终止劳动关系原因**：\${leaveReason}
* **工作时间折算**：累计工作约 \${workingMonths} 个月

---

## 二、 核心法律争议焦点与论证分析

基于《中华人民共和国劳动合同法》及相关司法解释，本案焦点主要集中于以下两项：

### 焦点一：关于未签订书面劳动合同的“双倍工资”惩罚性赔偿
根据**《中华人民共和国劳动合同法》第八十二条第一款**之规定：“用人单位自用工之日起超过一个月不满一年未与劳动者订立书面劳动合同的，应当向劳动者每月支付双倍的工资。”
在本案中，阁下于 \${entryDate} 入职，截至 \${leaveDate} 期间，用人单位\${contractStatusVerdict}。因此，用人单位应当自入职满一个月的次日起向阁下支付加付一倍工资的差额，最长计算期限为11个月。
* **计算逻辑**：月平均工资 \${monthlySalary} 元 × 差额月份 = \${doubleSalaryCompensation} 元。

### 焦点二：关于用人单位解除劳动合同的行为性质及经济补偿/赔偿金
根据阁下所述事实，本案中用人单位属于「\${leaveReason}」。
1. **若认定为用人单位违法解除**：
   根据**《中华人民共和国劳动合同法》第八十七条**，用人单位违反本法规定解除或者终止劳动合同的，应当依照本法第四十七条规定的经济补偿标准的二倍向劳动者支付赔偿金。
   * **计算逻辑**：经济补偿金（\${economicCompensation} 元） × 2 = **\${illegalDismissalDamages} 元**。
2. **若认定为符合合法解除但需支付补偿**：
   根据**《中华人民共和国劳动合同法》第四十七条**，经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资的标准向劳动者支付。六个月以上不满一年的，按一年计算；不满六个月的，向劳动者支付半个月工资的经济补偿。
   * **计算逻辑**：工作折算系数 × 月均工资 = **\${economicCompensation} 元**。

---

## 三、 索赔金额测算汇总表

根据以上事实及法律论证，预估阁下可依法主张的维权索赔金额如下表所示：

| 序号 | 索赔项目 | 计算依据 / 法条 | 测算金额 (人民币) | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **未签劳动合同双倍工资差额** | 《劳动合同法》第82条 | \${doubleSalaryCompensation} 元 | 最多计11个月差额 |
| 2 | **违法解除劳动合同赔偿金** | 《劳动合同法》第87条 | \${illegalDismissalDamages} 元 | 经济补偿金的双倍 |
| 3 | **经济补偿金 (备选主张)** | 《劳动合同法》第47条 | \${economicCompensation} 元 | 若违法解除无法认定 |
| **总计** | **依法推荐维权主张总额** | **项目 1 + 项目 2** | **\${totalClaimAmount} 元** | **最终索赔总额以仲裁委裁决为准** |

---

## 四、 律师策略与行动建议

为了最大化维护阁下的合法权益，建议采取以下维权步骤：

1. **证据保全**：请妥善留存并备份银行工资流水账单、社保缴纳记录、工作服/工作证、微信聊天记录（尤其是涉及工作安排和辞退通知的部分）以及任何能够证明用工关系的物证。
2. **协商调解**：在提起劳动仲裁前，可委托专业人士或工会向用人单位发出《律师函》或进行庭前调解，争取以最快效率达成调解协议。
3. **劳动仲裁**：如调解无果，应在解除劳动关系之日起一年内，向劳动合同履行地或用人单位所在地的劳动人事争议仲裁委员会申请**劳动仲裁**。

---
*声明：本法律意见书系基于阁下提供的陈述材料由智能辅助系统初拟，仅供维权决策参考，正式法律文书应以执业律师最终出具为准。*
`;

// #endregion

// #region 核心生成逻辑

/**
 * 法律意见书生成
 * @param {Object} elements 经律师确认修改的案件要素对象
 * @param {string} templateType 模板类型
 * @returns {Promise<Object>} 生成的 Markdown 文本内容
 */
export async function generateOpinionDocument(elements, templateType) {
  const currentDate = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const contractStatusText = elements.hasContract ? '已订立书面劳动合同' : '未订立书面劳动合同';
  const contractStatusVerdict = elements.hasContract
    ? '已依法履行合同签订义务'
    : '未履行订立书面劳动合同的法定义务';

  const calc = elements.calculationResult || {
    doubleSalaryCompensation: 0,
    economicCompensation: 0,
    illegalDismissalDamages: 0,
    totalClaimAmount: 0
  };

  // 变量替换
  let opinionText = LABOR_TEMPLATE;
  opinionText = opinionText.replace(/\${employeeName}/g, elements.employeeName);
  opinionText = opinionText.replace(/\${companyName}/g, elements.companyName);
  opinionText = opinionText.replace(/\${currentDate}/g, currentDate);
  opinionText = opinionText.replace(/\${entryDate}/g, elements.entryDate);
  opinionText = opinionText.replace(/\${leaveDate}/g, elements.leaveDate);
  opinionText = opinionText.replace(/\${jobTitle}/g, elements.jobTitle);
  opinionText = opinionText.replace(/\${monthlySalary}/g, elements.monthlySalary);
  opinionText = opinionText.replace(/\${contractStatusText}/g, contractStatusText);
  opinionText = opinionText.replace(/\${contractStatusVerdict}/g, contractStatusVerdict);
  opinionText = opinionText.replace(/\${leaveReason}/g, elements.leaveReason);
  opinionText = opinionText.replace(/\${workingMonths}/g, elements.workingMonths);
  
  opinionText = opinionText.replace(/\${doubleSalaryCompensation}/g, calc.doubleSalaryCompensation);
  opinionText = opinionText.replace(/\${economicCompensation}/g, calc.economicCompensation);
  opinionText = opinionText.replace(/\${illegalDismissalDamages}/g, calc.illegalDismissalDamages);
  opinionText = opinionText.replace(/\${totalClaimAmount}/g, calc.totalClaimAmount);

  // 写入临时文件，供下载 (Markdown 格式)
  const filename = `legal-opinion-${Date.now()}.md`;
  const uploadDir = path.join(__dirname, '../../uploads');
  const filePath = path.join(uploadDir, filename);

  await fs.writeFile(filePath, opinionText, 'utf-8');

  return {
    opinionText,
    downloadUrl: `/uploads/${filename}`
  };
}

// #endregion
