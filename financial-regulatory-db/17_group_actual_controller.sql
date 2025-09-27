-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.4 集团实际控制人 (Group Actual Controller)
-- =====================================================

CREATE TABLE group_actual_controller (
    -- C040001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C040001-关系ID',

    -- C040002 集团ID
    group_id VARCHAR(60) NOT NULL COMMENT 'C040002-集团ID',

    -- C040003 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C040003-机构ID',

    -- C040004 实际控制人名称
    actual_controller_name VARCHAR(200) COMMENT 'C040004-实际控制人名称',

    -- C040005 实际控制人类别
    actual_controller_category CHAR(2) COMMENT 'C040005-实际控制人类别',

    -- C040006 实际控制人国家地区
    actual_controller_country_region CHAR(3) COMMENT 'C040006-实际控制人国家地区',

    -- C040007 实际控制人证件类型
    actual_controller_cert_type CHAR(4) COMMENT 'C040007-实际控制人证件类型',

    -- C040008 实际控制人证件号码
    actual_controller_cert_no VARCHAR(100) COMMENT 'C040008-实际控制人证件号码',

    -- C040009 登记注册代码
    registration_code VARCHAR(100) COMMENT 'C040009-登记注册代码',

    -- C040010 关系状态
    relationship_status VARCHAR(50) COMMENT 'C040010-关系状态',

    -- C040011 采集日期
    collection_date DATE NOT NULL COMMENT 'C040011-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_group_id (group_id),
    KEY idx_organization_id (organization_id),
    KEY idx_actual_controller_cert_no (actual_controller_cert_no),
    KEY idx_registration_code (registration_code),
    KEY idx_actual_controller_name (actual_controller_name),
    KEY idx_actual_controller_category (actual_controller_category),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_relationship_status (relationship_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C04-集团实际控制人表';