-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.1 重要股东及主要关联企业 (Important Shareholders and Related Enterprises)
-- =====================================================

CREATE TABLE important_shareholders_related_enterprises (
    -- C010001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C010001-关系ID',

    -- C010002 客户ID
    customer_id VARCHAR(60) NOT NULL COMMENT 'C010002-客户ID',

    -- C010003 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C010003-机构ID',

    -- C010019 股东/关联企业客户ID (2.0版新增字段)
    shareholder_enterprise_customer_id VARCHAR(60) COMMENT 'C010019-股东/关联企业客户ID',

    -- C010004 公司客户名称
    company_customer_name TEXT COMMENT 'C010004-公司客户名称',

    -- C010005 股东/关联企业名称
    shareholder_enterprise_name VARCHAR(200) COMMENT 'C010005-股东/关联企业名称',

    -- C010006 实际控制人标识
    actual_controller_flag CHAR(1) COMMENT 'C010006-实际控制人标识',

    -- C010007 股东/关联企业证件类型
    shareholder_enterprise_cert_type CHAR(4) COMMENT 'C010007-股东/关联企业证件类型',

    -- C010008 股东/关联企业证件号码
    shareholder_enterprise_cert_no VARCHAR(100) COMMENT 'C010008-股东/关联企业证件号码',

    -- C010009 登记注册代码
    registration_code VARCHAR(100) COMMENT 'C010009-登记注册代码',

    -- C010010 股东/关联企业类别
    shareholder_enterprise_category CHAR(2) COMMENT 'C010010-股东/关联企业类别',

    -- C010011 股东/关联企业国家地区
    shareholder_enterprise_country_region CHAR(3) COMMENT 'C010011-股东/关联企业国家地区',

    -- C010012 企业股东持股比例
    enterprise_shareholding_ratio DECIMAL(20,6) COMMENT 'C010012-企业股东持股比例',

    -- C010013 更新信息日期
    update_info_date DATE COMMENT 'C010013-更新信息日期',

    -- C010014 股东结构对应日期
    shareholder_structure_date DATE COMMENT 'C010014-股东结构对应日期',

    -- C010015 关系类型
    relationship_type VARCHAR(100) COMMENT 'C010015-关系类型',

    -- C010016 关系状态
    relationship_status VARCHAR(50) COMMENT 'C010016-关系状态',

    -- C010018 关联人类别 (2.0试用版新增字段)
    related_person_category CHAR(2) COMMENT 'C010018-关联人类别',

    -- C010017 采集日期
    collection_date DATE NOT NULL COMMENT 'C010017-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_customer_id (customer_id),
    KEY idx_organization_id (organization_id),
    KEY idx_shareholder_enterprise_customer_id (shareholder_enterprise_customer_id),
    KEY idx_shareholder_enterprise_cert_no (shareholder_enterprise_cert_no),
    KEY idx_registration_code (registration_code),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_relationship_type (relationship_type),
    KEY idx_relationship_status (relationship_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C01-重要股东及主要关联企业表';