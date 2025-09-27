-- 表2.6 客户财务信息表
-- Customer Financial Information Table
CREATE TABLE customer_financial_info (
    -- 监管字段 (Regulatory Fields)
    customer_id VARCHAR(60) NOT NULL COMMENT 'B060001-客户ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B060002-机构ID',
    corporate_customer_name VARCHAR(200) COMMENT 'B060003-对公客户名称',
    financial_statement_date DATE NOT NULL COMMENT 'B060004-财务报表日期',
    is_audited TINYINT(1) COMMENT 'B060005-是否审计',
    audit_firm TEXT COMMENT 'B060006-审计机构',
    statement_scope VARCHAR(2) COMMENT 'B060007-报表口径',
    currency VARCHAR(3) COMMENT 'B060008-币种',
    total_assets DECIMAL(20,2) COMMENT 'B060009-资产总额',
    total_liabilities DECIMAL(20,2) COMMENT 'B060010-负债总额',
    income_tax DECIMAL(20,2) COMMENT 'B060011-所得税',
    net_profit DECIMAL(20,2) COMMENT 'B060012-净利润',
    main_business_income DECIMAL(20,2) COMMENT 'B060013-主营业务收入',
    inventory DECIMAL(20,2) COMMENT 'B060014-存货',
    net_cash_flow DECIMAL(20,2) COMMENT 'B060015-现金流量净额',
    accounts_receivable DECIMAL(20,2) COMMENT 'B060016-应收账款',
    other_receivables DECIMAL(20,2) COMMENT 'B060017-其他应收款',
    current_assets_total DECIMAL(20,2) COMMENT 'B060018-流动资产合计',
    current_liabilities_total DECIMAL(20,2) COMMENT 'B060019-流动负债合计',
    statement_period VARCHAR(2) COMMENT 'B060020-报表周期',
    financial_statement_number VARCHAR(40) COMMENT 'B060021-财务报表编号',
    collection_date DATE NOT NULL COMMENT 'B060022-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (customer_id, institution_id, financial_statement_date),

    -- 索引
    INDEX idx_corporate_customer_name (corporate_customer_name),
    INDEX idx_financial_statement_number (financial_statement_number),
    INDEX idx_statement_period (statement_period),
    INDEX idx_currency (currency),
    INDEX idx_total_assets (total_assets),
    INDEX idx_total_liabilities (total_liabilities),
    INDEX idx_net_profit (net_profit),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at),

    -- 外键约束
    FOREIGN KEY (customer_id, institution_id)
        REFERENCES corporate_customer_basic(customer_id, institution_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='客户财务信息表';