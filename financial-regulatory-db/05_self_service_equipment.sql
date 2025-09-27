-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表1.5 自助机具 (Self-service Equipment)
-- =====================================================

CREATE TABLE self_service_equipment (
    -- A050001 机具ID
    equipment_id VARCHAR(32) NOT NULL COMMENT 'A050001-机具ID',

    -- A050002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'A050002-机构ID',

    -- A050003 机具类型
    equipment_type CHAR(2) NOT NULL COMMENT 'A050003-机具类型',

    -- A050004 设备供应商
    equipment_supplier TEXT COMMENT 'A050004-设备供应商',

    -- A050005 设备维护商
    equipment_maintainer TEXT COMMENT 'A050005-设备维护商',

    -- A050006 机具型号
    equipment_model VARCHAR(100) COMMENT 'A050006-机具型号',

    -- A050007 设备地址
    equipment_address TEXT COMMENT 'A050007-设备地址',

    -- A050008 虚拟柜员ID
    virtual_teller_id VARCHAR(32) COMMENT 'A050008-虚拟柜员ID',

    -- A050009 设备启用日期
    equipment_activation_date DATE COMMENT 'A050009-设备启用日期',

    -- A050010 设备停用日期
    equipment_deactivation_date DATE COMMENT 'A050010-设备停用日期',

    -- A050011 运营状态
    operation_status CHAR(2) NOT NULL COMMENT 'A050011-运营状态',

    -- A050012 采集日期
    collection_date DATE NOT NULL COMMENT 'A050012-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (equipment_id),
    KEY idx_organization_id (organization_id),
    KEY idx_equipment_type (equipment_type),
    KEY idx_operation_status (operation_status),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),

    FOREIGN KEY (organization_id) REFERENCES organization_info(organization_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='A05-自助机具表';