-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.5 关联集团信息 (Related Group Information)
-- =====================================================

CREATE TABLE related_group_info (
    -- C050001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C050001-关系ID',

    -- C050002 集团ID
    group_id VARCHAR(60) NOT NULL COMMENT 'C050002-集团ID',

    -- C050003 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C050003-机构ID',

    -- C050004 关联集团ID
    related_group_id VARCHAR(60) COMMENT 'C050004-关联集团ID',

    -- C050005 关联关系类型
    related_relationship_type CHAR(5) COMMENT 'C050005-关联关系类型',

    -- C050006 关系状态
    relationship_status VARCHAR(50) COMMENT 'C050006-关系状态',

    -- C050007 采集日期
    collection_date DATE NOT NULL COMMENT 'C050007-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_group_id (group_id),
    KEY idx_organization_id (organization_id),
    KEY idx_related_group_id (related_group_id),
    KEY idx_related_relationship_type (related_relationship_type),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_relationship_status (relationship_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C05-关联集团信息表';