-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表4.3 分户账信息 (Sub-account Information)
-- =====================================================

CREATE TABLE sub_account_info (
    -- D030001 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'D030001-机构ID',

    -- D030002 分户账号
    sub_account_no TEXT NOT NULL COMMENT 'D030002-分户账号',

    -- D030003 客户ID
    customer_id VARCHAR(60) COMMENT 'D030003-客户ID',

    -- D030004 分户账名称
    sub_account_name TEXT COMMENT 'D030004-分户账名称',

    -- D030005 分户账类型
    sub_account_type CHAR(2) NOT NULL COMMENT 'D030005-分户账类型',

    -- D030006 计息标识
    interest_calculation_flag CHAR(1) NOT NULL COMMENT 'D030006-计息标识',

    -- D030007 计息方式
    interest_calculation_method CHAR(2) COMMENT 'D030007-计息方式',

    -- D030008 科目ID
    account_id VARCHAR(32) NOT NULL COMMENT 'D030008-科目ID',

    -- D030009 币种
    currency_code CHAR(3) NOT NULL COMMENT 'D030009-币种',

    -- D030010 借贷标识
    debit_credit_flag CHAR(2) NOT NULL COMMENT 'D030010-借贷标识',

    -- D030016 钞汇类别 (2.0版新增字段)
    cash_transfer_type CHAR(2) COMMENT 'D030016-钞汇类别',

    -- D030017 内部账利率 (2.0版新增字段)
    internal_account_rate DECIMAL(20,6) COMMENT 'D030017-内部账利率',

    -- D030018 借方余额 (2.0版新增字段)
    debit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D030018-借方余额',

    -- D030019 贷方余额 (2.0版新增字段)
    credit_balance DECIMAL(20,2) DEFAULT 0 COMMENT 'D030019-贷方余额',

    -- D030011 开户日期
    opening_date DATE COMMENT 'D030011-开户日期',

    -- D030012 销户日期
    closing_date DATE COMMENT 'D030012-销户日期',

    -- D030013 账户状态
    account_status CHAR(2) NOT NULL COMMENT 'D030013-账户状态',

    -- D030014 备注
    remarks TEXT COMMENT 'D030014-备注',

    -- D030015 采集日期
    collection_date DATE NOT NULL COMMENT 'D030015-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 使用机构ID和分户账号的哈希值作为主键，解决分户账号过长问题
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',

    -- 唯一索引确保分户账号唯一性
    UNIQUE KEY uk_org_sub_account (organization_id, sub_account_no(100)),

    -- 索引设计
    KEY idx_organization_id (organization_id),
    KEY idx_customer_id (customer_id),
    KEY idx_account_id (account_id),
    KEY idx_currency_code (currency_code),
    KEY idx_sub_account_type (sub_account_type),
    KEY idx_debit_credit_flag (debit_credit_flag),
    KEY idx_account_status (account_status),
    KEY idx_opening_date (opening_date),
    KEY idx_closing_date (closing_date),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_created_at (created_at),

    -- 复合索引优化查询性能
    KEY idx_org_customer (organization_id, customer_id),
    KEY idx_org_account (organization_id, account_id),
    KEY idx_org_currency (organization_id, currency_code),
    KEY idx_customer_account (customer_id, account_id),
    KEY idx_account_currency (account_id, currency_code),
    KEY idx_type_status (sub_account_type, account_status),
    KEY idx_opening_closing (opening_date, closing_date)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='D03-分户账信息表';