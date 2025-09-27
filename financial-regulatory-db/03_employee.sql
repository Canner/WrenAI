-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表1.3 员工 (Employee)
-- =====================================================

CREATE TABLE employee (
    -- A030001 员工ID
    employee_id VARCHAR(32) NOT NULL COMMENT 'A030001-员工ID',

    -- A030002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'A030002-机构ID',

    -- A030003 姓名
    employee_name VARCHAR(200) NOT NULL COMMENT 'A030003-姓名',

    -- A030004 国家地区
    country_region CHAR(3) COMMENT 'A030004-国家地区',

    -- A030005 证件类型
    id_type CHAR(4) COMMENT 'A030005-证件类型',

    -- A030006 证件号码
    id_number VARCHAR(100) COMMENT 'A030006-证件号码',

    -- A030007 手机号码
    mobile_phone VARCHAR(128) COMMENT 'A030007-手机号码',

    -- A030008 办公电话
    office_phone VARCHAR(128) COMMENT 'A030008-办公电话',

    -- A030009 入职日期
    hire_date DATE COMMENT 'A030009-入职日期',

    -- A030010 所属部门
    department TEXT COMMENT 'A030010-所属部门',

    -- A030011 职务
    position VARCHAR(200) COMMENT 'A030011-职务',

    -- A030012 高管标识
    executive_flag CHAR(1) NOT NULL COMMENT 'A030012-高管标识',

    -- A030013 批复日期
    approval_date DATE COMMENT 'A030013-批复日期',

    -- A030014 任职日期
    appointment_date DATE COMMENT 'A030014-任职日期',

    -- A030015 员工类型
    employee_type CHAR(2) NOT NULL COMMENT 'A030015-员工类型',

    -- A030016 岗位编号
    position_code VARCHAR(100) COMMENT 'A030016-岗位编号',

    -- A030017 岗位名称
    position_name VARCHAR(100) COMMENT 'A030017-岗位名称',

    -- A030018 岗位标识
    position_id CHAR(5) COMMENT 'A030018-岗位标识',

    -- A030019 上岗日期
    position_start_date DATE COMMENT 'A030019-上岗日期',

    -- A030020 最近一次轮岗日期
    last_rotation_date DATE COMMENT 'A030020-最近一次轮岗日期',

    -- A030021 最近一次强制休假日期
    last_mandatory_leave_date DATE COMMENT 'A030021-最近一次强制休假日期',

    -- A030022 员工状态
    employee_status CHAR(2) NOT NULL COMMENT 'A030022-员工状态',

    -- A030023 柜员号
    teller_number VARCHAR(24) COMMENT 'A030023-柜员号',

    -- A030024 柜员类型
    teller_type CHAR(2) COMMENT 'A030024-柜员类型',

    -- A030025 柜员权限级别
    teller_authority_level CHAR(2) COMMENT 'A030025-柜员权限级别',

    -- A030026 柜员状态
    teller_status CHAR(2) COMMENT 'A030026-柜员状态',

    -- A030027 备注
    remarks TEXT COMMENT 'A030027-备注',

    -- A030028 采集日期
    collection_date DATE NOT NULL COMMENT 'A030028-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (employee_id),
    KEY idx_organization_id (organization_id),
    KEY idx_employee_name (employee_name),
    KEY idx_id_number (id_number),
    KEY idx_teller_number (teller_number),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),

    FOREIGN KEY (organization_id) REFERENCES organization_info(organization_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='A03-员工表';