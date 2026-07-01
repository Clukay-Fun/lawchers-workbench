/**
 * 描述: SQLite 数据库连接及初始化模块
 * 主要功能:
 *     - 载入 better-sqlite3 建立本地 sqlite 持久化连接
 *     - 启动自检并自动创建 backend/data 目录
 *     - 开启 WAL 并行日志模式和 foreign_keys 级联约束
 *     - 检查并执行 schema.sql 初始化 6 张核心关系表
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 规划数据存储目录与文件路径
const dataDir = path.join(__dirname, '../../data');
const dbName = process.env.NODE_ENV === 'test' ? 'lawchers_test.sqlite' : 'lawchers.sqlite';
const dbPath = path.join(dataDir, dbName);
const schemaPath = path.join(__dirname, 'schema.sql');

// 1. 自检并自动创建 data/ 数据库物理目录
if (!fs.existsSync(dataDir)) {
  console.log(`[INFO] 数据库目录 ${dataDir} 不存在，正在自动创建...`);
  fs.mkdirSync(dataDir, { recursive: true });
}

// 2. 建立 better-sqlite3 本地连接
console.log(`[INFO] 正在连接 SQLite 数据库: ${dbPath}`);
const db = new Database(dbPath, {
  // 可以选择加上 verbose: console.log 方便调试 SQL，但正式版可不加
});

// 3. 启用 SQLite 实效命令以增强并发读写与外键删除能力
db.pragma('foreign_keys = ON');  // 必须开启外键关联，以保障级联删除生效
db.pragma('journal_mode = WAL'); // WAL 预写日志模式，大幅提升读写性能
db.pragma('synchronous = NORMAL');

// 4. 表结构自初始化自检
try {
  // 检查 case 表是否存在
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='case';").get();
  
  if (!tableCheck) {
    console.log('[INFO] 检测到数据库尚未初始化表结构，正在读取并执行 schema.sql...');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    console.log('[OK] 数据库表结构初始化成功！');
  } else {
    console.log('[OK] 数据库连接成功，表结构已就绪。');
  }

  // 5. 增量迁移：为 material 表添加 Stage 4 所需的新列
  try {
    const matCols = db.prepare("PRAGMA table_info('material')").all();
    const matColNames = matCols.map(c => c.name);

    if (!matColNames.includes('redacted_md')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"redacted_md\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 redacted_md 列');
    }
    if (!matColNames.includes('map_json')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"map_json\" TEXT DEFAULT '{}'");
      console.log('[MIGRATE] material 表已添加 map_json 列');
    }
    if (!matColNames.includes('occurrences_json')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"occurrences_json\" TEXT DEFAULT '[]'");
      console.log('[MIGRATE] material 表已添加 occurrences_json 列');
    }
    if (!matColNames.includes('manual_redactions_json')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"manual_redactions_json\" TEXT DEFAULT '[]'");
      console.log('[MIGRATE] material 表已添加 manual_redactions_json 列');
    }
    if (!matColNames.includes('redacted_path')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"redacted_path\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 redacted_path 列');
    }
    if (!matColNames.includes('audit_json')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"audit_json\" TEXT DEFAULT '{}'");
      console.log('[MIGRATE] material 表已添加 audit_json 列');
    }
    if (!matColNames.includes('working_text')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"working_text\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 working_text 列');
    }

    // entity 表：新增 original 列（明文存本地库，用于刷新后重新定位脱敏）
    const entColNames = db.prepare("PRAGMA table_info('entity')").all().map(c => c.name);
    if (!entColNames.includes('original')) {
      db.exec("ALTER TABLE \"entity\" ADD COLUMN \"original\" TEXT DEFAULT ''");
      console.log('[MIGRATE] entity 表已添加 original 列');
    }

    // 6. 增量迁移：Markdown 复核工作流所需的新字段
    if (!matColNames.includes('document_kind')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"document_kind\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 document_kind 列');
    }
    if (!matColNames.includes('preview_path')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"preview_path\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 preview_path 列');
    }
    if (!matColNames.includes('manifest_path')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"manifest_path\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 manifest_path 列');
    }
    if (!matColNames.includes('source_sha256')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"source_sha256\" TEXT DEFAULT ''");
      console.log('[MIGRATE] material 表已添加 source_sha256 列');
    }
    if (!matColNames.includes('processing_status')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"processing_status\" TEXT DEFAULT 'uploaded'");
      console.log('[MIGRATE] material 表已添加 processing_status 列');
    }
    if (!matColNames.includes('verification_status')) {
      db.exec("ALTER TABLE \"material\" ADD COLUMN \"verification_status\" TEXT DEFAULT 'pending'");
      console.log('[MIGRATE] material 表已添加 verification_status 列');
    }

    // 7. 创建 redaction_decision 表（如果不存在）
    const decisionTableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='redaction_decision';"
    ).get();
    if (!decisionTableCheck) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "redaction_decision" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "material_id" INTEGER NOT NULL,
          "candidate_id" TEXT,
          "block_id" TEXT NOT NULL,
          "start" INTEGER NOT NULL,
          "end" INTEGER NOT NULL,
          "action" TEXT NOT NULL DEFAULT 'redact',
          "origin" TEXT NOT NULL DEFAULT 'automatic',
          "entity_type" TEXT NOT NULL DEFAULT '',
          "source_locator" TEXT DEFAULT '{}',
          "confirmed" INTEGER DEFAULT 0,
          "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY("material_id") REFERENCES "material"("id") ON DELETE CASCADE
        )
      `);
      console.log('[MIGRATE] 已创建 redaction_decision 表');
    }

    // 8. 创建 tool-mode 新表（task + rule）
    const taskTableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='task';"
    ).get();
    if (!taskTableCheck) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "task" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "filename" TEXT NOT NULL,
          "ext" TEXT NOT NULL DEFAULT '',
          "document_kind" TEXT NOT NULL DEFAULT '',
          "entity_stats" TEXT,
          "export_path" TEXT,
          "map_path" TEXT,
          "audit_path" TEXT,
          "residual_passed" INTEGER DEFAULT 0,
          "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[MIGRATE] 已创建 task 表');
    }

    const ruleTableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='rule';"
    ).get();
    if (!ruleTableCheck) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "rule" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "name" TEXT NOT NULL,
          "category" TEXT NOT NULL DEFAULT 'custom',
          "regex" TEXT,
          "token_prefix" TEXT,
          "description" TEXT DEFAULT '',
          "is_active" INTEGER DEFAULT 1,
          "sample" TEXT,
          "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[MIGRATE] 已创建 rule 表');
    }

    // 10. 设置表（key-value 持久化）
    const settingTableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='setting';"
    ).get();
    if (!settingTableCheck) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "setting" (
          "key" TEXT PRIMARY KEY,
          "value" TEXT NOT NULL
        )
      `);
      console.log('[MIGRATE] 已创建 setting 表');
    }

    // 9. 为 task 表添加工具模式所需的新列
    try {
      const taskCols = db.prepare(`PRAGMA table_info("task")`).all().map(c => c.name);
      if (!taskCols.includes('source_path')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "source_path" TEXT`);
        console.log('[MIGRATE] task.source_path 已添加');
      }
      if (!taskCols.includes('work_dir')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "work_dir" TEXT`);
        console.log('[MIGRATE] task.work_dir 已添加');
      }
      if (!taskCols.includes('manifest_path')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "manifest_path" TEXT`);
        console.log('[MIGRATE] task.manifest_path 已添加');
      }
      if (!taskCols.includes('source_map_path')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "source_map_path" TEXT`);
        console.log('[MIGRATE] task.source_map_path 已添加');
      }
      if (!taskCols.includes('rules_config')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "rules_config" TEXT`);
        console.log('[MIGRATE] task.rules_config 已添加');
      }
      // S1 (docs/25): task lifecycle columns
      if (!taskCols.includes('status')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "status" TEXT DEFAULT 'uploaded'`);
        console.log('[MIGRATE] task.status 已添加');
      }
      if (!taskCols.includes('progress_step')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "progress_step" TEXT`);
        console.log('[MIGRATE] task.progress_step 已添加');
      }
      if (!taskCols.includes('error_message')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "error_message" TEXT`);
        console.log('[MIGRATE] task.error_message 已添加');
      }
      if (!taskCols.includes('file_size')) {
        db.exec(`ALTER TABLE "task" ADD COLUMN "file_size" INTEGER DEFAULT 0`);
        console.log('[MIGRATE] task.file_size 已添加');
      }
      if (!taskCols.includes('updated_at')) {
        // SQLite rejects ALTER TABLE ADD COLUMN with non-constant CURRENT_TIMESTAMP default.
        // Add without default, then backfill existing rows to created_at value.
        db.exec(`ALTER TABLE "task" ADD COLUMN "updated_at" DATETIME`);
        db.exec(`UPDATE "task" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL`);
        console.log('[MIGRATE] task.updated_at 已添加并回填');
      }
    } catch (colErr) {
      console.warn('[WARN] task 列增量迁移异常（可忽略若已存在）:', colErr.message);
    }

    // P1: Reset orphaned intermediate-status tasks on startup
    // (server crashed/restarted during analyze → task stuck in preparing/recognizing/rendering/detecting_seals)
    try {
      const INTERMEDIATE_STATUSES = ['preparing', 'recognizing', 'rendering', 'detecting_seals'];
      const placeholders = INTERMEDIATE_STATUSES.map(() => '?').join(',');
      const stuck = db.prepare(`SELECT id, progress_step FROM "task" WHERE status IN (${placeholders})`).all(...INTERMEDIATE_STATUSES);
      if (stuck.length > 0) {
        const resetStmt = db.prepare(`UPDATE "task" SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        for (const t of stuck) {
          resetStmt.run(`服务重启时识别中断（阶段: ${t.progress_step || '未知'}）`, t.id);
        }
        console.log(`[MIGRATE] ${stuck.length} 个中间状态任务已重置为 failed`);
      }
    } catch (resetErr) {
      console.warn('[WARN] 中间状态重置异常:', resetErr.message);
    }
  } catch (migErr) {
    console.warn('[WARN] material 表增量迁移检查异常（可忽略若已存在）:', migErr.message);
  }
} catch (err) {
  console.error('[FATAL ERROR] 数据库表自检初始化失败！', err.message);
  throw err;
}

export default db;
