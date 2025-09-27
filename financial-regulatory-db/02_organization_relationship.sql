-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表1.2 机构关系 (Organization Relationship)
-- =====================================================

CREATE TABLE organization_relationship (
    -- A020001 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'A020001-机构ID',

    -- A020002 上级管理机构ID
    parent_organization_id VARCHAR(24) COMMENT 'A020002-上级管理机构ID',

    -- A020003 采集日期
    collection_date DATE NOT NULL COMMENT 'A020003-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (organization_id, collection_date),
    KEY idx_parent_organization_id (parent_organization_id),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),

    FOREIGN KEY (organization_id) REFERENCES organization_info(organization_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (parent_organization_id) REFERENCES organization_info(organization_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='A02-机构关系表';