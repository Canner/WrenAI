-- 表5.6 卡产品表
-- Card Product Table
CREATE TABLE card_product (
    -- 监管字段 (Regulatory Fields)
    product_id VARCHAR(32) NOT NULL COMMENT 'E060001-产品ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'E060002-机构ID',
    product_name TEXT COMMENT 'E060003-产品名称',
    product_code VARCHAR(255) COMMENT 'E060004-产品编号',
    card_organization_code VARCHAR(24) COMMENT 'E060005-卡组织代码',
    card_type VARCHAR(2) COMMENT 'E060006-卡类型',
    card_medium_type_code VARCHAR(2) COMMENT 'E060007-卡介质类型代码',
    allowed_cash_withdrawal_type VARCHAR(2) COMMENT 'E060008-允许取现类型',
    allowed_transfer_out_flag TINYINT(1) COMMENT 'E060009-允许转出标识',
    charge_fee_flag TINYINT(1) COMMENT 'E060010-收取费用标识',
    policy_function_flag TINYINT(1) COMMENT 'E060011-政策功能标识',
    card_form VARCHAR(2) COMMENT 'E060012-卡片形态',
    co_branded_card_flag TINYINT(1) COMMENT 'E060013-联名卡标识',
    co_branded_unit TEXT COMMENT 'E060014-联名单位',
    co_branded_unit_code VARCHAR(128) COMMENT 'E060015-联名单位代码',
    remarks TEXT COMMENT 'E060016-备注',
    collection_date DATE NOT NULL COMMENT 'E060017-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (product_id, institution_id),

    -- 索引
    INDEX idx_product_name (product_name(255)),
    INDEX idx_product_code (product_code),
    INDEX idx_card_organization_code (card_organization_code),
    INDEX idx_card_type (card_type),
    INDEX idx_card_medium_type_code (card_medium_type_code),
    INDEX idx_allowed_cash_withdrawal_type (allowed_cash_withdrawal_type),
    INDEX idx_card_form (card_form),
    INDEX idx_co_branded_card_flag (co_branded_card_flag),
    INDEX idx_co_branded_unit (co_branded_unit(255)),
    INDEX idx_co_branded_unit_code (co_branded_unit_code),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='卡产品表';