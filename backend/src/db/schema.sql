-- 1. 案件表
CREATE TABLE IF NOT EXISTS "case" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "case_no" TEXT UNIQUE NOT NULL,
    "title" TEXT NOT NULL,
    "cause" TEXT DEFAULT '劳动争议',
    "employee" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "stage" TEXT DEFAULT 'todo', -- todo (待处理), done (已确认), archived (已归档)
    "claim_amount" REAL DEFAULT 0.0,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 材料表
CREATE TABLE IF NOT EXISTS "material" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "case_id" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "stored_path" TEXT NOT NULL,       -- 本地 uploads 原始文件物理相对路径
    "display_mode" TEXT NOT NULL,      -- text (文本类) / image (图像/扫描件)
    "redact_status" TEXT DEFAULT 'todo', -- todo (待核对) / done (已脱敏确认)
    "uploaded_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("case_id") REFERENCES "case"("id") ON DELETE CASCADE
);

-- 3. 脱敏实体表（不存明文，仅记录脱敏掩码与位置映射）
CREATE TABLE IF NOT EXISTS "entity" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "material_id" INTEGER NOT NULL,
    "entity_id" TEXT NOT NULL,      -- 对应 map.json 中的 "PERSON_1", "TIME_1" 等键
    "entity_type" TEXT NOT NULL,    -- 实体类别，例如 PERSON, ORG, DATE
    "masked" TEXT NOT NULL,         -- 打码掩码字符，如 "王*" 或 "【姓名】"
    "original" TEXT DEFAULT '',     -- 敏感原文（仅存本地库，用于刷新后重新定位脱敏）
    "start" INTEGER NOT NULL,       -- 脱敏文本中的 redacted_start 偏移量
    "end" INTEGER NOT NULL,         -- 脱敏文本中的 redacted_end 偏移量
    "revealed" INTEGER DEFAULT 0,   -- 是否临时放行显示明文 (0=密文, 1=明文)
    FOREIGN KEY("material_id") REFERENCES "material"("id") ON DELETE CASCADE
);

-- 4. 争议要素要素表（与 case 一对一关联）
CREATE TABLE IF NOT EXISTS "case_element" (
    "case_id" INTEGER PRIMARY KEY,
    "entry_date" TEXT,              -- YYYY-MM-DD
    "leave_date" TEXT,              -- YYYY-MM-DD
    "salary" REAL DEFAULT 0.0,
    "has_contract" INTEGER DEFAULT 1, -- 0=未签合同, 1=已签合同
    "leave_reason" TEXT,            -- dismiss (违法解除) / expire (到期终止) / quit (主动辞职)
    "working_months" REAL DEFAULT 0.0,
    "job_title" TEXT,               -- 工作岗位，如"技术开发岗"
    FOREIGN KEY("case_id") REFERENCES "case"("id") ON DELETE CASCADE
);

-- 5. 意见书文书表
CREATE TABLE IF NOT EXISTS "opinion" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "case_id" INTEGER NOT NULL,
    "template_type" TEXT DEFAULT 'labor_standard',
    "content_md" TEXT,              -- 生成的 Markdown 文本内容
    "status" TEXT DEFAULT 'draft',  -- draft (草稿) / confirmed (人工确认通过)
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("case_id") REFERENCES "case"("id") ON DELETE CASCADE
);

-- 6. 法律审计日志表（可追溯）
CREATE TABLE IF NOT EXISTS "audit" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "case_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,         -- redact (脱敏), element_extract (要素提取), opinion_generate (生成意见书), opinion_confirm (人工确认)
    "source" TEXT NOT NULL,         -- legal-desens, regex, ner, llm, human
    "model_config" TEXT,            -- 记录模型参数，如 {"engine": "rapidocr", "isNerEnabled": true}
    "human_confirmed" INTEGER DEFAULT 0, -- 人工确认标记 (0=否, 1=是)
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("case_id") REFERENCES "case"("id") ON DELETE CASCADE
);
