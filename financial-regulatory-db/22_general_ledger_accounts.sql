-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表4.1 总账会计全科目 (General Ledger Accounts)
-- =====================================================

CREATE TABLE general_ledger_accounts (
    -- D010001 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'D010001-机构ID',

    -- D010002 科目ID
    account_id VARCHAR(32) NOT NULL COMMENT 'D010002-科目ID',

    -- D010003 期初借方余额
    opening_debit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D010003-期初借方余额',

    -- D010004 期初贷方余额
    opening_credit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D010004-期初贷方余额',

    -- D010005 本期借方发生额
    current_debit_amount DECIMAL(20,2) DEFAULT 0 COMMENT 'D010005-本期借方发生额',

    -- D010006 本期贷方发生额
    current_credit_amount DECIMAL(20,2) DEFAULT 0 COMMENT 'D010006-本期贷方发生额',

    -- D010007 期末借方余额
    closing_debit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D010007-期末借方余额',

    -- D010008 期末贷方余额
    closing_credit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D010008-期末贷方余额',

    -- D010009 币种
    currency_code CHAR(3) NOT NULL COMMENT 'D010009-币种',

    -- D010010 会计日期
    accounting_date DATE NOT NULL COMMENT 'D010010-会计日期',

    -- D010011 报表周期
    report_period CHAR(2) NOT NULL COMMENT 'D010011-报表周期',

    -- D010012 采集日期
    collection_date DATE NOT NULL COMMENT 'D010012-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 联合主键：机构ID + 科目ID + 币种 + 会计日期
    PRIMARY KEY (organization_id, account_id, currency_code, accounting_date),

    -- 索引设计
    KEY idx_account_id (account_id),
    KEY idx_accounting_date (accounting_date),
    KEY idx_currency_code (currency_code),
    KEY idx_report_period (report_period),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_created_at (created_at),

    -- 复合索引优化查询性能
    KEY idx_org_account (organization_id, account_id),
    KEY idx_org_date (organization_id, accounting_date),
    KEY idx_account_date (account_id, accounting_date),
    KEY idx_currency_date (currency_code, accounting_date)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='D01-总账会计全科目表';