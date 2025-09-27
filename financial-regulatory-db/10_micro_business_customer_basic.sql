-- 表2.4 个体工商户及小微企业主基本情况表
-- Micro Business Customer Basic Information Table
CREATE TABLE micro_business_customer_basic (
    -- 监管字段 (Regulatory Fields)
    customer_id VARCHAR(60) NOT NULL COMMENT 'B040001-客户ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B040002-机构ID',
    business_owner_person_id VARCHAR(60) COMMENT 'B040034-经营户个人ID',
    business_owner_name VARCHAR(200) COMMENT 'B040003-经营者姓名',
    business_owner_id_type VARCHAR(4) COMMENT 'B040004-经营者证件类型',
    business_owner_id_number VARCHAR(100) COMMENT 'B040005-经营者证件号码',
    business_owner_years_experience INT COMMENT 'B040006-经营者从业年限',
    business_entity_name TEXT COMMENT 'B040033-经营主体名称',
    business_scope TEXT COMMENT 'B040019-经营范围',
    industry_type VARCHAR(5) COMMENT 'B040020-行业类型',
    business_customer_type VARCHAR(2) COMMENT 'B040021-经营户客户类型',
    business_address VARCHAR(600) COMMENT 'B040022-经营地址',
    business_address_admin_division VARCHAR(6) COMMENT 'B040023-经营地所在行政区划',
    contact_phone VARCHAR(128) COMMENT 'B040032-联系电话',
    total_assets DECIMAL(20,2) COMMENT 'B040024-资产总额',
    total_liabilities DECIMAL(20,2) COMMENT 'B040025-负债总额',
    profit_before_tax DECIMAL(20,2) COMMENT 'B040026-税前利润',
    main_business_income DECIMAL(20,2) COMMENT 'B040027-主营业务收入',
    financial_statement_date DATE COMMENT 'B040028-财务报表日期',
    credit_rating_result VARCHAR(50) COMMENT 'B040029-信用评级结果',
    first_credit_relation_month VARCHAR(7) COMMENT 'B040030-首次建立信贷关系年月',
    collection_date DATE NOT NULL COMMENT 'B040031-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (customer_id, institution_id),

    -- 索引
    INDEX idx_business_owner_person_id (business_owner_person_id),
    INDEX idx_business_owner_name (business_owner_name),
    INDEX idx_business_owner_id_number (business_owner_id_number),
    INDEX idx_business_entity_name (business_entity_name(100)),
    INDEX idx_industry_type (industry_type),
    INDEX idx_business_customer_type (business_customer_type),
    INDEX idx_financial_statement_date (financial_statement_date),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='个体工商户及小微企业主基本情况表';