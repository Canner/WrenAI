-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.2 高管及重要关系人信息 (Executives and Important Relations Information)
-- =====================================================

CREATE TABLE executives_important_relations (
    -- C020001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C020001-关系ID',

    -- C020002 客户ID
    customer_id VARCHAR(60) NOT NULL COMMENT 'C020002-客户ID',

    -- C020003 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C020003-机构ID',

    -- C020016 关系人客户ID (2.0版新增字段)
    related_person_customer_id VARCHAR(60) COMMENT 'C020016-关系人客户ID',

    -- C020004 关系人姓名
    related_person_name VARCHAR(200) COMMENT 'C020004-关系人姓名',

    -- C020005 关系人证件类型
    related_person_cert_type CHAR(4) COMMENT 'C020005-关系人证件类型',

    -- C020006 关系人证件号码
    related_person_cert_no VARCHAR(100) COMMENT 'C020006-关系人证件号码',

    -- C020007 证件签发日期
    cert_issue_date DATE COMMENT 'C020007-证件签发日期',

    -- C020008 证件到期日期
    cert_expire_date DATE COMMENT 'C020008-证件到期日期',

    -- C020009 关系类型
    relationship_type VARCHAR(100) COMMENT 'C020009-关系类型',

    -- C020010 关系人类别
    related_person_category CHAR(4) COMMENT 'C020010-关系人类别',

    -- C020011 关系人国家地区
    related_person_country_region CHAR(3) COMMENT 'C020011-关系人国家地区',

    -- C020012 更新信息日期
    update_info_date DATE COMMENT 'C020012-更新信息日期',

    -- C020013 关系状态
    relationship_status VARCHAR(50) COMMENT 'C020013-关系状态',

    -- C020015 关联人类别 (2.0试用版新增字段)
    associated_person_category CHAR(2) COMMENT 'C020015-关联人类别',

    -- C020014 采集日期
    collection_date DATE NOT NULL COMMENT 'C020014-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_customer_id (customer_id),
    KEY idx_organization_id (organization_id),
    KEY idx_related_person_customer_id (related_person_customer_id),
    KEY idx_related_person_cert_no (related_person_cert_no),
    KEY idx_related_person_name (related_person_name),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_relationship_type (relationship_type),
    KEY idx_relationship_status (relationship_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C02-高管及重要关系人信息表';