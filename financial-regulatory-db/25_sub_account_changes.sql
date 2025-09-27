-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表4.4 分户账变动情况 (Sub-account Changes)
-- =====================================================

CREATE TABLE sub_account_changes (
    -- D040001 分户账号
    sub_account_no TEXT NOT NULL COMMENT 'D040001-分户账号',

    -- D040002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'D040002-机构ID',

    -- D040003 会计日期
    accounting_date DATE NOT NULL COMMENT 'D040003-会计日期',

    -- D040004 币种
    currency_code CHAR(3) NOT NULL COMMENT 'D040004-币种',

    -- D040005 期初借方余额
    opening_debit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D040005-期初借方余额',

    -- D040006 期初贷方余额
    opening_credit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D040006-期初贷方余额',

    -- D040007 本期借方发生额
    current_debit_amount DECIMAL(20,2) DEFAULT 0 COMMENT 'D040007-本期借方发生额',

    -- D040008 本期贷方发生额
    current_credit_amount DECIMAL(20,2) DEFAULT 0 COMMENT 'D040008-本期贷方发生额',

    -- D040009 期末借方余额
    closing_debit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D040009-期末借方余额',

    -- D040010 期末贷方余额
    closing_credit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D040010-期末贷方余额',

    -- D040011 应收利息
    accrued_interest_receivable DECIMAL(20,2) DEFAULT 0 COMMENT 'D040011-应收利息',

    -- D040012 应付利息
    accrued_interest_payable DECIMAL(20,2) DEFAULT 0 COMMENT 'D040012-应付利息',

    -- D040014 钞汇类别 (2.0版新增字段)
    cash_transfer_type CHAR(2) COMMENT 'D040014-钞汇类别',

    -- D040013 采集日期
    collection_date DATE NOT NULL COMMENT 'D040013-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 使用自增主键，处理分户账号过长的情况
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',

    -- 唯一索引确保同一分户账号在同一会计日期、同一币种下唯一
    UNIQUE KEY uk_account_date_currency (organization_id, sub_account_no(100), accounting_date, currency_code),

    -- 索引设计
    KEY idx_organization_id (organization_id),
    KEY idx_accounting_date (accounting_date),
    KEY idx_currency_code (currency_code),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_created_at (created_at),

    -- 复合索引优化查询性能
    KEY idx_org_date (organization_id, accounting_date),
    KEY idx_org_currency (organization_id, currency_code),
    KEY idx_date_currency (accounting_date, currency_code),
    KEY idx_org_date_currency (organization_id, accounting_date, currency_code),

    -- 金额相关索引（用于余额查询）
    KEY idx_closing_debit (closing_debit_balance),
    KEY idx_closing_credit (closing_credit_balance),
    KEY idx_current_debit (current_debit_amount),
    KEY idx_current_credit (current_credit_amount),

    -- 利息相关索引
    KEY idx_interest_receivable (accrued_interest_receivable),
    KEY idx_interest_payable (accrued_interest_payable),

    -- 钞汇类别索引
    KEY idx_cash_transfer_type (cash_transfer_type)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='D04-分户账变动情况表';