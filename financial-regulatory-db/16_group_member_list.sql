-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.3 集团成员名单 (Group Member List)
-- =====================================================

CREATE TABLE group_member_list (
    -- C030001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C030001-关系ID',

    -- C030002 成员ID
    member_id VARCHAR(60) NOT NULL COMMENT 'C030002-成员ID',

    -- C030003 成员企业名称
    member_enterprise_name TEXT COMMENT 'C030003-成员企业名称',

    -- C030004 成员统一社会信用代码
    member_unified_social_credit_code VARCHAR(18) COMMENT 'C030004-成员统一社会信用代码',

    -- C030005 成员类型
    member_type CHAR(2) COMMENT 'C030005-成员类型',

    -- C030006 登记注册代码
    registration_code VARCHAR(100) COMMENT 'C030006-登记注册代码',

    -- C030007 集团ID
    group_id VARCHAR(60) NOT NULL COMMENT 'C030007-集团ID',

    -- C030008 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C030008-机构ID',

    -- C030009 关系状态
    relationship_status VARCHAR(50) COMMENT 'C030009-关系状态',

    -- C030010 采集日期
    collection_date DATE NOT NULL COMMENT 'C030010-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_member_id (member_id),
    KEY idx_group_id (group_id),
    KEY idx_organization_id (organization_id),
    KEY idx_member_unified_social_credit_code (member_unified_social_credit_code),
    KEY idx_registration_code (registration_code),
    KEY idx_member_type (member_type),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_relationship_status (relationship_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C03-集团成员名单表';