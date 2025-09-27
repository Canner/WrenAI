-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表1.4 岗位信息 (Position Information)
-- =====================================================

CREATE TABLE position_info (
    -- A040001 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'A040001-机构ID',

    -- A040002 岗位编号
    position_code VARCHAR(100) NOT NULL COMMENT 'A040002-岗位编号',

    -- A040003 岗位种类
    position_category TEXT COMMENT 'A040003-岗位种类',

    -- A040004 岗位名称
    position_name VARCHAR(100) COMMENT 'A040004-岗位名称',

    -- A040005 岗位说明
    position_description TEXT COMMENT 'A040005-岗位说明',

    -- A040006 岗位状态
    position_status TEXT COMMENT 'A040006-岗位状态',

    -- A040009 是否柜员标识 (2.0试用版新增字段)
    is_teller_flag CHAR(2) COMMENT 'A040009-是否柜员标识',

    -- A040007 备注
    remarks TEXT COMMENT 'A040007-备注',

    -- A040008 采集日期
    collection_date DATE NOT NULL COMMENT 'A040008-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (organization_id, position_code),
    KEY idx_position_name (position_name),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),

    FOREIGN KEY (organization_id) REFERENCES organization_info(organization_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='A04-岗位信息表';