-- 表2.7 收单商户信息表
-- Acquiring Merchant Information Table
CREATE TABLE acquiring_merchant_info (
    -- 监管字段 (Regulatory Fields)
    merchant_id VARCHAR(24) NOT NULL COMMENT 'B070001-商户ID',
    customer_id VARCHAR(60) COMMENT 'B070002-客户ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B070003-机构ID',
    merchant_name VARCHAR(450) NOT NULL COMMENT 'B070004-商户名称',
    is_pos_special_merchant TINYINT(1) COMMENT 'B070005-是否为POS机特约商户',
    terminal_number TEXT COMMENT 'B070006-终端号',
    merchant_category_code VARCHAR(4) COMMENT 'B070007-商户类别码',
    merchant_category_name TEXT COMMENT 'B070008-商户类别码名称',
    settlement_card_or_account VARCHAR(50) COMMENT 'B070009-清算卡号或账号',
    settlement_account_type VARCHAR(2) COMMENT 'B070010-清算账号类型',
    settlement_account_name TEXT COMMENT 'B070011-清算账户名称',
    settlement_bank_name TEXT COMMENT 'B070012-清算账号开户行名称',
    merchant_effective_date DATE COMMENT 'B070013-商户起效日期',
    merchant_expiry_date DATE COMMENT 'B070014-商户失效日期',
    merchant_region VARCHAR(6) COMMENT 'B070015-商户地区',
    merchant_status TEXT COMMENT 'B070016-商户状态',
    collection_date DATE NOT NULL COMMENT 'B070017-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (merchant_id, institution_id),

    -- 索引
    INDEX idx_customer_id (customer_id),
    INDEX idx_merchant_name (merchant_name),
    INDEX idx_merchant_category_code (merchant_category_code),
    INDEX idx_settlement_card_or_account (settlement_card_or_account),
    INDEX idx_merchant_region (merchant_region),
    INDEX idx_merchant_status (merchant_status(100)),
    INDEX idx_merchant_effective_date (merchant_effective_date),
    INDEX idx_merchant_expiry_date (merchant_expiry_date),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at),

    -- 外键约束 (可选，因为客户ID可能为空)
    FOREIGN KEY (customer_id, institution_id)
        REFERENCES corporate_customer_basic(customer_id, institution_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='收单商户信息表';