-- 表2.2 集团基本情况表
-- Group Customer Basic Information Table
CREATE TABLE group_customer_basic (
    -- 监管字段 (Regulatory Fields)
    group_id VARCHAR(60) NOT NULL COMMENT 'B020001-集团ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'B020002-机构ID',
    parent_company_unified_credit_code VARCHAR(18) COMMENT 'B020003-母公司统一社会信用代码',
    business_registration_number VARCHAR(100) COMMENT 'B020004-工商注册编号',
    parent_company_customer_id VARCHAR(60) COMMENT 'B020020-母公司客户ID',
    parent_company_name TEXT COMMENT 'B020005-母公司名称',
    credit_type VARCHAR(2) COMMENT 'B020006-授信类型',
    group_name TEXT COMMENT 'B020007-集团名称',
    group_member_count INT COMMENT 'B020008-集团成员数',
    registration_address VARCHAR(255) COMMENT 'B020009-注册地址',
    registration_country_region VARCHAR(3) COMMENT 'B020010-注册地国家地区',
    registration_admin_division VARCHAR(6) COMMENT 'B020011-注册地行政区划',
    update_registration_info_date DATE COMMENT 'B020012-更新注册信息日期',
    office_address VARCHAR(255) COMMENT 'B020013-办公地址',
    office_address_admin_division TEXT COMMENT 'B020014-办公地址行政区划',
    update_office_address_date DATE COMMENT 'B020015-更新办公地址日期',
    risk_warning_signal VARCHAR(30) COMMENT 'B020016-风险预警信号',
    concern_event_code VARCHAR(30) COMMENT 'B020017-关注事件代码',
    internal_rating_result VARCHAR(50) COMMENT 'B020018-内部评级结果',
    collection_date DATE NOT NULL COMMENT 'B020019-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (group_id, institution_id),

    -- 索引
    INDEX idx_parent_company_unified_credit_code (parent_company_unified_credit_code),
    INDEX idx_parent_company_customer_id (parent_company_customer_id),
    INDEX idx_group_name (group_name(100)),
    INDEX idx_parent_company_name (parent_company_name(100)),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at),

    -- 外键约束
    FOREIGN KEY (parent_company_customer_id, institution_id)
        REFERENCES corporate_customer_basic(customer_id, institution_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='集团基本情况表';