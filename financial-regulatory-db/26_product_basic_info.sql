-- 表5.1 产品业务基本信息表
-- Product Business Basic Information Table
CREATE TABLE product_basic_info (
    -- 监管字段 (Regulatory Fields)
    product_id VARCHAR(32) NOT NULL COMMENT 'E010001-产品ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'E010002-机构ID',
    product_name TEXT COMMENT 'E010003-产品名称',
    product_code VARCHAR(255) COMMENT 'E010004-产品编号',
    account_type VARCHAR(2) COMMENT 'E010005-科目类型',
    product_category VARCHAR(200) COMMENT 'E010007-产品类别',
    self_operated_flag VARCHAR(2) COMMENT 'E010008-自营标识',
    product_currency TEXT COMMENT 'E010009-产品币种',
    product_term TEXT COMMENT 'E010010-产品期限',
    product_establish_date DATE COMMENT 'E010011-产品成立日期',
    product_maturity_date DATE COMMENT 'E010012-产品到期日期',
    product_period INT COMMENT 'E010013-产品期次',
    interest_rate_type VARCHAR(2) COMMENT 'E010014-利率类型',
    product_status_code VARCHAR(2) COMMENT 'E010015-产品状态代码',
    client_product_institution_name TEXT COMMENT 'E010018-代客产品所属机构名称',
    remarks TEXT COMMENT 'E010016-备注',
    collection_date DATE NOT NULL COMMENT 'E010017-采集日期',

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
    INDEX idx_account_type (account_type),
    INDEX idx_product_category (product_category),
    INDEX idx_self_operated_flag (self_operated_flag),
    INDEX idx_product_establish_date (product_establish_date),
    INDEX idx_product_maturity_date (product_maturity_date),
    INDEX idx_interest_rate_type (interest_rate_type),
    INDEX idx_product_status_code (product_status_code),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='产品业务基本信息表';