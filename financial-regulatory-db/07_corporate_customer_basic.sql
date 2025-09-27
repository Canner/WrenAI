-- 表2.1 单一法人基本情况表
-- Corporate Customer Basic Information Table
CREATE TABLE corporate_customer_basic (
    -- 监管字段 (Regulatory Fields)
    customer_id VARCHAR(60) NOT NULL COMMENT 'B010001-客户ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B010002-机构ID',
    corporate_customer_name VARCHAR(200) NOT NULL COMMENT 'B010003-对公客户名称',
    unified_social_credit_code VARCHAR(18) COMMENT 'B010004-统一社会信用代码',
    org_registration_date DATE COMMENT 'B010005-组织机构登记/年检/更新日期',
    registration_code VARCHAR(100) COMMENT 'B010006-登记注册代码',
    registration_update_date DATE COMMENT 'B010007-登记注册/年检/更新日期',
    global_legal_entity_id VARCHAR(20) COMMENT 'B010008-全球法人识别编码',
    registered_capital DECIMAL(20,2) COMMENT 'B010019-注册资本',
    registered_capital_currency VARCHAR(3) COMMENT 'B010020-注册资本币种',
    paid_capital DECIMAL(20,2) COMMENT 'B010021-实收资本',
    paid_capital_currency VARCHAR(3) COMMENT 'B010022-实收资本币种',
    establishment_date DATE COMMENT 'B010023-成立日期',
    business_scope TEXT COMMENT 'B010024-经营范围',
    industry_type VARCHAR(5) COMMENT 'B010025-行业类型',
    corporate_customer_type VARCHAR(2) COMMENT 'B010026-对公客户类型',
    shareholding_type VARCHAR(2) COMMENT 'B010027-控股类型',
    registration_country_region VARCHAR(3) COMMENT 'B010028-注册地国家地区',
    registration_address VARCHAR(255) COMMENT 'B010029-注册地址',
    registration_admin_division VARCHAR(6) COMMENT 'B010030-注册地行政区划',
    phone_number VARCHAR(128) COMMENT 'B010031-电话号码',
    legal_representative_name VARCHAR(200) COMMENT 'B010032-法定代表人姓名',
    legal_representative_id_type VARCHAR(4) COMMENT 'B010033-法定代表人证件类型',
    legal_representative_id_number VARCHAR(100) COMMENT 'B010034-法定代表人证件号码',
    financial_staff_name VARCHAR(200) COMMENT 'B010035-财务人员姓名',
    financial_staff_id_type VARCHAR(4) COMMENT 'B010036-财务人员证件类型',
    financial_staff_id_number VARCHAR(100) COMMENT 'B010037-财务人员证件号码',
    basic_deposit_account VARCHAR(50) COMMENT 'B010038-基本存款账号',
    basic_deposit_bank_code VARCHAR(12) COMMENT 'B010039-基本存款账户开户行行号',
    basic_deposit_bank_name TEXT COMMENT 'B010040-基本存款账户开户行名称',
    employee_count INT COMMENT 'B010041-员工人数',
    listing_status TEXT COMMENT 'B010042-上市情况',
    new_agri_entity_flag TINYINT(1) COMMENT 'B010043-新型农业经营主体标识',
    external_rating_result VARCHAR(50) COMMENT 'B010044-外部评级结果',
    credit_rating_agency TEXT COMMENT 'B010045-信用评级机构',
    internal_rating_result VARCHAR(50) COMMENT 'B010046-内部评级结果',
    env_social_risk_category VARCHAR(10) COMMENT 'B010047-环境和社会风险分类',
    first_credit_relation_month VARCHAR(7) COMMENT 'B010048-首次建立信贷关系年月',
    risk_warning_signal VARCHAR(30) COMMENT 'B010049-风险预警信号',
    concern_event_code VARCHAR(30) COMMENT 'B010050-关注事件代码',
    closure_enterprise_flag TINYINT(1) COMMENT 'B010053-关停企业标识',
    parent_company_name TEXT COMMENT 'B010057-母公司名称',
    default_probability DECIMAL(20,6) COMMENT 'B010058-违约概率',
    tech_enterprise_type VARCHAR(6) COMMENT 'B010061-科技企业类型',
    collection_date DATE NOT NULL COMMENT 'B010060-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (customer_id, institution_id),

    -- 索引
    INDEX idx_unified_social_credit_code (unified_social_credit_code),
    INDEX idx_corporate_customer_name (corporate_customer_name),
    INDEX idx_industry_type (industry_type),
    INDEX idx_establishment_date (establishment_date),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='单一法人基本情况表';