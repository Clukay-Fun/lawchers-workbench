/**
 * 描述: 数据库仓储层集成验证测试脚本
 * 主要功能:
 *     - 自动化验证案件创建、案号按年生成与跨年重置算法
 *     - 验证材料、争议要素、意见书及操作审计日志的 CRUD 功能
 *     - 验证日期实体归一化（TIME -> DATE）的自动转换与“明文不入库”红线
 *     - 验证 ON DELETE CASCADE 级联物理删除的有效性
 */

import db from './index.js';
import * as caseRepo from './caseRepo.js';
import * as materialRepo from './materialRepo.js';
import * as elementRepo from './elementRepo.js';
import * as opinionRepo from './opinionRepo.js';
import * as auditRepo from './auditRepo.js';

//region 断言与控制台输出工具

/**
 * 简单断言工具
 * @param {boolean} condition 判断条件
 * @param {string} message 错误描述
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERT FAIL] ${message}`);
  }
}

//endregion

//region 核心测试用例

/**
 * 运行全套仓储层测试用例
 * 
 * 功能:
 *     - 采用独立事务或在测试结束后执行回滚/清理，保持测试环境干净
 */
async function runTests() {
  console.log('\n==================================================');
  console.log('[TEST] 开始数据库仓储层 (Repository) 集成测试...');
  console.log('==================================================');

  // 清空以往测试可能留下的残留脏数据以实现测试幂等
  db.prepare('DELETE FROM "case"').run();

  try {
    // ----------------------------------------------------
    // 测试 1. 案件创建与常规案号自增自检
    // ----------------------------------------------------
    console.log('[TEST 1] 测试案件创建与案号递增...');
    const currentYear = new Date().getFullYear();
    
    const case1 = caseRepo.createCase({
      employee: '张三',
      company: '未来科技公司',
      stage: 'todo',
      claim_amount: 12000.50
    });
    console.log(`- 案件 1 创建成功，分配案号: ${case1.caseNo}`);
    assert(case1.caseNo.startsWith(`LC-${currentYear}-`), `案号前缀应为 LC-${currentYear}-`);

    const case2 = caseRepo.createCase({
      employee: '李四',
      company: '宇宙物流公司',
      stage: 'todo',
      claim_amount: 8500.00
    });
    console.log(`- 案件 2 创建成功，分配案号: ${case2.caseNo}`);

    // 解析出序号，断言 case2 比 case1 的序号多 1
    const num1 = parseInt(case1.caseNo.split('-')[2], 10);
    const num2 = parseInt(case2.caseNo.split('-')[2], 10);
    assert(num2 === num1 + 1, '第二个案号应该自增 1');

    // ----------------------------------------------------
    // 测试 2. 案号跨年重置算法校验 (使用 Mock)
    // ----------------------------------------------------
    console.log('[TEST 2] 测试跨年案号重置算法...');
    const origGetFullYear = Date.prototype.getFullYear;
    
    // 强制模拟时间跳转到明年的年份
    const mockYear = currentYear + 1;
    Date.prototype.getFullYear = function() { return mockYear; };

    try {
      const caseMock = caseRepo.createCase({
        employee: '王五',
        company: '测试重置公司',
        stage: 'todo',
        claim_amount: 0
      });
      console.log(`- 跨年 Mock (年份: ${mockYear}) 创建成功，案号: ${caseMock.caseNo}`);
      assert(caseMock.caseNo === `LC-${mockYear}-0001`, `跨年后首单案号应重置为 LC-${mockYear}-0001`);
    } finally {
      // 还原系统方法，避免环境污染
      Date.prototype.getFullYear = origGetFullYear;
    }

    // ----------------------------------------------------
    // 测试 3. 材料添加与 DATE/TIME 实体归一化存盘
    // ----------------------------------------------------
    console.log('[TEST 3] 测试材料添加与日期实体 (TIME -> DATE) 归一化存盘...');
    const targetCaseId = case1.id;
    
    const mat1 = materialRepo.addMaterial({
      case_id: targetCaseId,
      filename: '劳动合同书.docx',
      ext: '.docx',
      stored_path: `case_${targetCaseId}/contract.docx`,
      display_mode: 'text',
      redact_status: 'todo'
    });
    console.log(`- 材料记录插入成功，ID: ${mat1.id}`);

    // 构造包含 TIME 实体的列表，模拟 legal-desens 原生匹配产物
    const rawEntities = [
      {
        entity_id: 'TIME_1',
        entity_type: 'TIME',
        masked: '【时间】', // 会被归一化为【日期】
        start: 15,
        end: 25,
        original: '2026-06-20' // 必须在落库时被自动排除，严格遵守明文不入库
      },
      {
        entity_id: 'PERSON_1',
        entity_type: 'PERSON',
        masked: '张*',
        start: 2,
        end: 4,
        original: '张三'
      }
    ];

    materialRepo.bulkInsertEntities(mat1.id, rawEntities);
    console.log(`- 批量实体存盘成功（已触发归一化校验与明文剔除）`);

    // 从数据库读取出来，进行属性断言
    const dbEntities = db.prepare('SELECT * FROM "entity" WHERE material_id = ?').all(mat1.id);
    assert(dbEntities.length === 2, '应成功写入 2 个脱敏实体位置记录');

    // 校验归一化与明文排除
    const timeEntity = dbEntities.find(e => e.entity_id === 'TIME_1');
    assert(timeEntity !== undefined, '必须能查到 TIME_1 的记录');
    assert(timeEntity.entity_type === 'DATE', 'TIME 实体类型应已在存盘时归一化为 DATE');
    assert(timeEntity.masked === '【日期】', 'TIME 实体的掩码应由【时间】更正为【日期】');
    assert(timeEntity.original === undefined, '实体表绝对不存有 original 原文列（明文不入库）');

    // ----------------------------------------------------
    // 测试 4. 争议事实要素的读取与动态修改
    // ----------------------------------------------------
    console.log('[TEST 4] 测试争议要素读取与更新...');
    const elementBefore = elementRepo.getCaseElement(targetCaseId);
    assert(elementBefore !== undefined, '在创建案件时，应已配套初始化了要素记录');
    
    // 修改部分字段并更新
    elementRepo.updateCaseElement(targetCaseId, {
      entry_date: '2025-01-01',
      leave_date: '2026-05-30',
      salary: 15000.00,
      has_contract: 0,
      leave_reason: 'dismiss'
    });

    const elementAfter = elementRepo.getCaseElement(targetCaseId);
    assert(elementAfter.salary === 15000.00, '平均均薪字段应已被更新');
    assert(elementAfter.has_contract === 0, '有无合同状态应已被修改');
    assert(elementAfter.entry_date === '2025-01-01', '入职日期字段更新有效');
    console.log(`- 要素更新断言通过。均薪: ${elementAfter.salary}, 日期: ${elementAfter.entry_date}`);

    // ----------------------------------------------------
    // 测试 5. 意见书文书生成与状态流转（草稿 -> 律师人工确认）
    // ----------------------------------------------------
    console.log('[TEST 5] 测试意见书草稿创建与状态升级...');
    const op = opinionRepo.createOpinion({
      case_id: targetCaseId,
      template_type: 'labor_standard',
      content_md: '# 敬法律师事务所劳动争议法律意见书\n\n依据调查事实...'
    });
    
    let dbOp = db.prepare('SELECT * FROM "opinion" WHERE id = ?').get(op.id);
    assert(dbOp.status === 'draft', '新建法律意见书默认状态必须为 draft');

    // 模拟人工核对动作，更新状态
    opinionRepo.confirmOpinion(op.id);
    dbOp = db.prepare('SELECT * FROM "opinion" WHERE id = ?').get(op.id);
    assert(dbOp.status === 'confirmed', '人工确认操作后，意见书状态必须转为 confirmed');
    console.log(`- 意见书状态正常流转: draft -> confirmed`);

    // ----------------------------------------------------
    // 测试 6. 操作日志审计写入与 JSON 序列化还原
    // ----------------------------------------------------
    console.log('[TEST 6] 测试审计操作日志写入与模型参数还原...');
    auditRepo.writeAuditLog({
      case_id: targetCaseId,
      action: 'redact',
      source: 'legal-desens',
      model_config: { engine: 'rapidocr', isNerEnabled: true },
      human_confirmed: 1
    });

    const logs = auditRepo.getAuditLogsByCaseId(targetCaseId);
    assert(logs.length === 1, '应正常写入 1 条审计日志');
    assert(logs[0].action === 'redact', '操作类型应为 redact');
    assert(logs[0].model_config.isNerEnabled === true, 'model_config 字段应已被自动还原为 JSON 对象');
    console.log(`- 审计日志解析还原成功，调用引擎为: ${logs[0].model_config.engine}`);

    // ----------------------------------------------------
    // 测试 7. 案件明细综合视图聚合校验
    // ----------------------------------------------------
    console.log('[TEST 7] 测试案件明细全景视图接口...');
    const detail = caseRepo.getCaseDetail(targetCaseId);
    assert(detail.employee === '张三', '张三基础案件字段正确');
    assert(detail.materials.length === 1, '应聚合并关联出 1 份材料');
    assert(detail.materials[0].entities.length === 2, '该材料下应附带 2 个实体');
    assert(detail.opinions.length === 1, '应关联出该案下的意见书');
    assert(detail.calculatorInput.salary === 15000.00, '要素大对象已正确反填');
    console.log(`- 案件明细综合视图验证成功，材料数: ${detail.materials.length}`);

    // ----------------------------------------------------
    // 测试 8. 物理级联删除校验 (ON DELETE CASCADE)
    // ----------------------------------------------------
    console.log('[TEST 8] 测试级联物理删除...');
    
    // 执行案件物理删除
    caseRepo.deleteCase(targetCaseId);

    // 核对关联子表是否已被彻底级联清空
    const elementCount = db.prepare('SELECT count(*) as count FROM "case_element" WHERE case_id = ?').get(targetCaseId).count;
    const materialCount = db.prepare('SELECT count(*) as count FROM "material" WHERE case_id = ?').get(targetCaseId).count;
    const entityCount = db.prepare('SELECT count(*) as count FROM "entity" WHERE material_id = ?').get(mat1.id).count;
    const opinionCount = db.prepare('SELECT count(*) as count FROM "opinion" WHERE case_id = ?').get(targetCaseId).count;
    const auditCount = db.prepare('SELECT count(*) as count FROM "audit" WHERE case_id = ?').get(targetCaseId).count;

    assert(elementCount === 0, '争议要素行应被级联删除');
    assert(materialCount === 0, '文档材料行应被级联删除');
    assert(entityCount === 0, '脱敏实体坐标行应被级联删除');
    assert(opinionCount === 0, '文书意见书应被级联删除');
    assert(auditCount === 0, '追溯审计日志应被级联删除');

    console.log('- 所有关联表的数据已全部随案件被级联删除成功！');

    console.log('\n==================================================');
    console.log('[OK] 恭喜！所有 Repository 测试用例全部通过！');
    console.log('==================================================\n');
  } catch (error) {
    console.error('\n==================================================');
    console.error('[FAIL] 数据库仓储层集成验证失败！');
    console.error(error.stack);
    console.error('==================================================\n');
    process.exit(1);
  }
}

// 执行测试运行
runTests();
