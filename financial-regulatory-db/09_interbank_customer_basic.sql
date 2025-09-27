-- 表2.3 同业客户基本情况表
-- Interbank Customer Basic Information Table
CREATE TABLE interbank_customer_basic (
    -- 监管字段 (Regulatory Fields)
    interbank_id VARCHAR(60) NOT NULL COMMENT 'B030001-同业ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B030002-机构ID',
    customer_name VARCHAR(450) NOT NULL COMMENT 'B030003-客户名称',
    institution_type VARCHAR(2) COMMENT 'B030004-机构类型',
    corporate_customer_type VARCHAR(2) COMMENT 'B030037-对公客户类型',
    enterprise_shareholding_type VARCHAR(2) COMMENT 'B030038-企业控股类型',
    financial_license_number VARCHAR(15) COMMENT 'B030005-金融许可证件号码',
    swift_code VARCHAR(11) COMMENT 'B030006-SWIFT编码',
    unified_social_credit_code VARCHAR(18) COMMENT 'B030007-统一社会信用代码',
    business_scope TEXT COMMENT 'B030008-经营范围',
    establishment_date DATE COMMENT 'B030009-成立日期',
    registration_address VARCHAR(255) COMMENT 'B030010-注册地址',
    registration_country_region VARCHAR(3) COMMENT 'B030011-注册地国家地区',
    registration_admin_division VARCHAR(6) COMMENT 'B030012-注册地行政区划',
    legal_representative_name VARCHAR(200) COMMENT 'B030013-法定代表人姓名',
    legal_representative_id_type VARCHAR(4) COMMENT 'B030014-法定代表人证件类型',
    legal_representative_id_number VARCHAR(100) COMMENT 'B030015-法定代表人证件号码',
    financial_staff_name VARCHAR(200) COMMENT 'B030016-财务人员姓名',
    financial_staff_id_type VARCHAR(4) COMMENT 'B030017-财务人员证件类型',
    financial_staff_id_number VARCHAR(100) COMMENT 'B030018-财务人员证件号码',
    basic_deposit_account VARCHAR(50) COMMENT 'B030019-基本存款账号',
    basic_deposit_bank_code VARCHAR(12) COMMENT 'B030020-基本存款账户开户行行号',
    basic_deposit_bank_name TEXT COMMENT 'B030021-基本存款账户开户行名称',
    registered_capital DECIMAL(20,2) COMMENT 'B030022-注册资本',
    registered_capital_currency VARCHAR(3) COMMENT 'B030023-注册资本币种',
    paid_capital DECIMAL(20,2) COMMENT 'B030024-实收资本',
    paid_capital_currency VARCHAR(3) COMMENT 'B030025-实收资本币种',
    listed_enterprise_flag TINYINT(1) COMMENT 'B030026-上市企业标识',
    employee_count INT COMMENT 'B030027-员工人数',
    responsible_person_name VARCHAR(200) COMMENT 'B030028-负责人姓名',
    institution_contact_phone VARCHAR(128) COMMENT 'B030029-机构联系电话',
    external_rating_result VARCHAR(50) COMMENT 'B030030-外部评级结果',
    credit_rating_agency TEXT COMMENT 'B030031-信用评级机构',
    internal_rating_result VARCHAR(50) COMMENT 'B030032-内部评级结果',
    first_credit_date DATE COMMENT 'B030033-首次授信日期',
    risk_warning_signal VARCHAR(30) COMMENT 'B030034-风险预警信号',
    concern_event_code VARCHAR(30) COMMENT 'B030035-关注事件代码',
    collection_date DATE NOT NULL COMMENT 'B030036-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (interbank_id, institution_id),

    -- 索引
    INDEX idx_customer_name (customer_name),
    INDEX idx_unified_social_credit_code (unified_social_credit_code),
    INDEX idx_financial_license_number (financial_license_number),
    INDEX idx_swift_code (swift_code),
    INDEX idx_institution_type (institution_type),
    INDEX idx_establishment_date (establishment_date),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='同业客户基本情况表';