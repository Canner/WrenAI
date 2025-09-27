-- 表2.5 个人客户基本情况表
-- Individual Customer Basic Information Table
CREATE TABLE individual_customer_basic (
    -- 监管字段 (Regulatory Fields)
    customer_id VARCHAR(60) NOT NULL COMMENT 'B050001-客户ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B050002-机构ID',
    individual_customer_name VARCHAR(200) NOT NULL COMMENT 'B050003-个人客户名称',
    individual_customer_type VARCHAR(2) COMMENT 'B050004-个人客户类型',
    customer_id_card VARCHAR(100) COMMENT 'B050005-客户身份证',
    customer_passport_number VARCHAR(100) COMMENT 'B050006-客户护照号',
    customer_other_id_type VARCHAR(4) COMMENT 'B050007-客户其他证件类型',
    customer_other_id_number VARCHAR(100) COMMENT 'B050008-客户其他证件号码',
    ethnicity TEXT COMMENT 'B050009-民族',
    gender VARCHAR(2) COMMENT 'B050010-性别',
    education_level VARCHAR(2) COMMENT 'B050011-学历',
    birth_date DATE COMMENT 'B050012-出生日期',
    married_flag TINYINT(1) COMMENT 'B050013-已婚标识',
    phone1 VARCHAR(128) COMMENT 'B050014-电话1',
    phone2 VARCHAR(128) COMMENT 'B050015-电话2',
    employer_name TEXT COMMENT 'B050016-工作单位名称',
    employer_phone VARCHAR(128) COMMENT 'B050017-工作单位电话',
    employer_address VARCHAR(255) COMMENT 'B050018-工作单位地址',
    employer_type VARCHAR(2) COMMENT 'B050019-单位性质',
    occupation VARCHAR(200) COMMENT 'B050020-职业',
    position VARCHAR(200) COMMENT 'B050021-职务',
    annual_income DECIMAL(20,2) COMMENT 'B050022-个人年收入',
    family_income DECIMAL(20,2) COMMENT 'B050023-家庭收入',
    communication_address VARCHAR(600) COMMENT 'B050024-通讯地址',
    individual_customer_admin_division VARCHAR(6) COMMENT 'B050037-个人客户行政区划',
    bank_employee_flag TINYINT(1) COMMENT 'B050026-本行员工标识',
    first_credit_relation_month VARCHAR(7) COMMENT 'B050027-首次建立信贷关系年月',
    blacklist_flag TINYINT(1) COMMENT 'B050028-上本行黑名单标识',
    blacklist_date DATE COMMENT 'B050029-上黑名单日期',
    blacklist_reason TEXT COMMENT 'B050030-上黑名单原因',
    resident_flag TINYINT(1) COMMENT 'B050031-居民标识',
    country_region VARCHAR(3) COMMENT 'B050032-国家地区',
    farmer_agri_entity_flag TINYINT(1) COMMENT 'B050033-农户及新型农业经营主体标识',
    poverty_alleviation_flag TINYINT(1) COMMENT 'B050034-已脱贫人口标识',
    poverty_edge_flag TINYINT(1) COMMENT 'B050035-边缘易致贫人口标识',
    collection_date DATE NOT NULL COMMENT 'B050036-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (customer_id, institution_id),

    -- 索引
    INDEX idx_individual_customer_name (individual_customer_name),
    INDEX idx_customer_id_card (customer_id_card),
    INDEX idx_customer_passport_number (customer_passport_number),
    INDEX idx_customer_other_id_number (customer_other_id_number),
    INDEX idx_phone1 (phone1),
    INDEX idx_birth_date (birth_date),
    INDEX idx_employer_name (employer_name(100)),
    INDEX idx_individual_customer_type (individual_customer_type),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='个人客户基本情况表';