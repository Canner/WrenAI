-- 表5.5 代销保险产品业务表
-- Insurance Product Business Table
CREATE TABLE insurance_product_business (
    -- 监管字段 (Regulatory Fields)
    product_id VARCHAR(32) NOT NULL COMMENT 'E050001-产品ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'E050002-机构ID',
    product_name TEXT COMMENT 'E050003-产品名称',
    product_code VARCHAR(255) COMMENT 'E050004-产品编号',
    insurance_company_name TEXT COMMENT 'E050005-保险公司名称',
    insurance_subtype_code VARCHAR(4) COMMENT 'E050006-险种子类型代码',
    additional_insurance_product_code VARCHAR(255) COMMENT 'E050007-附加险产品编号',
    additional_insurance_name TEXT COMMENT 'E050008-附加险名称',
    remarks TEXT COMMENT 'E050009-备注',
    collection_date DATE NOT NULL COMMENT 'E050010-采集日期',

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
    INDEX idx_insurance_company_name (insurance_company_name(255)),
    INDEX idx_insurance_subtype_code (insurance_subtype_code),
    INDEX idx_additional_insurance_product_code (additional_insurance_product_code),
    INDEX idx_additional_insurance_name (additional_insurance_name(255)),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='代销保险产品业务表';