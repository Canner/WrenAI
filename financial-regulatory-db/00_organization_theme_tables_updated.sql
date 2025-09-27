-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 机构主题表结构汇总 (Organization Theme Tables)
-- 生成日期: 2025-09-27
-- 数据库类型: MySQL 5.7+
-- 字符集: UTF8MB4
-- 更新说明: 增加数据归属部门和数据来源字段
-- =====================================================

-- 设置数据库字符集和排序规则
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================
-- 表1.1 机构信息 (Organization Information)
-- =====================================================

CREATE TABLE organization_info (
    -- A010001 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'A010001-机构ID',

    -- A010002 内部机构号
    internal_org_code VARCHAR(50) COMMENT 'A010002-内部机构号',

    -- A010003 金融许可证号
    financial_license_no CHAR(15) COMMENT 'A010003-金融许可证号',

    -- A010004 统一社会信用代码
    unified_social_credit_code VARCHAR(18) COMMENT 'A010004-统一社会信用代码',

    -- A010005 银行机构名称
    bank_institution_name VARCHAR(200) COMMENT 'A010005-银行机构名称',

    -- A010006 支付行号
    payment_bank_code VARCHAR(12) COMMENT 'A010006-支付行号',

    -- A010007 机构类型
    institution_type CHAR(2) NOT NULL COMMENT 'A010007-机构类型',

    -- A010008 机构类别
    institution_category CHAR(4) NOT NULL COMMENT 'A010008-机构类别',

    -- A010009 县域机构标识
    county_institution_flag CHAR(1) NOT NULL COMMENT 'A010009-县域机构标识',

    -- A010010 科技支行标识
    tech_branch_flag CHAR(1) NOT NULL COMMENT 'A010010-科技支行标识',

    -- A010011 科技特色支行标识
    tech_featured_branch_flag CHAR(1) NOT NULL COMMENT 'A010011-科技特色支行标识',

    -- A010012 科技金融专营机构标识
    tech_finance_specialized_flag CHAR(1) NOT NULL COMMENT 'A010012-科技金融专营机构标识',

    -- A010013 行政区划
    administrative_division CHAR(6) NOT NULL COMMENT 'A010013-行政区划',

    -- A010014 运营状态
    operation_status CHAR(2) NOT NULL COMMENT 'A010014-运营状态',

    -- A010015 成立日期
    establishment_date DATE COMMENT 'A010015-成立日期',

    -- A010016 机构地址
    institution_address VARCHAR(255) COMMENT 'A010016-机构地址',

    -- A010017 负责人姓名
    responsible_person_name VARCHAR(200) COMMENT 'A010017-负责人姓名',

    -- A010018 负责人工号
    responsible_person_emp_no VARCHAR(32) COMMENT 'A010018-负责人工号',

    -- A010019 负责人联系电话
    responsible_person_phone VARCHAR(128) COMMENT 'A010019-负责人联系电话',

    -- A010021 自贸区网点标识 (2.0版新增字段)
    free_trade_zone_flag CHAR(1) COMMENT 'A010021-自贸区网点标识',

    -- A010022 承办行机构代码 (2.0版新增字段)
    handling_bank_code VARCHAR(24) COMMENT 'A010022-承办行机构代码',

    -- A010023 机构层级 (2.0版新增字段)
    institution_level CHAR(2) COMMENT 'A010023-机构层级',

    -- A010020 采集日期
    collection_date DATE NOT NULL COMMENT 'A010020-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (organization_id),
    KEY idx_unified_social_credit_code (unified_social_credit_code),
    KEY idx_financial_license_no (financial_license_no),
    KEY idx_payment_bank_code (payment_bank_code),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='A01-机构信息表';

-- =====================================================
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

-- =====================================================
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

-- =====================================================
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

-- =====================================================
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

-- =====================================================
-- 表1.6 股东及关联方信息 (Shareholder and Related Party Information)
-- =====================================================

CREATE TABLE shareholder_related_party (
    -- A060001 股东或关联方ID
    shareholder_party_id VARCHAR(60) NOT NULL COMMENT 'A060001-股东或关联方ID',

    -- A060002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'A060002-机构ID',

    -- A060003 股东或关联方名称
    shareholder_party_name VARCHAR(200) COMMENT 'A060003-股东或关联方名称',

    -- A060004 股东或关联方类型
    shareholder_party_type CHAR(2) COMMENT 'A060004-股东或关联方类型',

    -- A060005 股东或关联方证件类型
    id_type CHAR(4) COMMENT 'A060005-股东或关联方证件类型',

    -- A060006 股东或关联方证件号码
    id_number VARCHAR(100) COMMENT 'A060006-股东或关联方证件号码',

    -- A060007 股东或关联方行业类型
    industry_type VARCHAR(5) COMMENT 'A060007-股东或关联方行业类型',

    -- A060008 股东或关联方注册地址
    registered_address VARCHAR(255) COMMENT 'A060008-股东或关联方注册地址',

    -- A060009 机构关系类型
    institution_relationship_type VARCHAR(100) COMMENT 'A060009-机构关系类型',

    -- A060010 实际控制人名称
    actual_controller_name VARCHAR(200) COMMENT 'A060010-实际控制人名称',

    -- A060011 参股商业银行的数量
    participating_bank_count INT COMMENT 'A060011-参股商业银行的数量',

    -- A060012 控股商业银行的数量
    controlling_bank_count INT COMMENT 'A060012-控股商业银行的数量',

    -- A060013 不良信息
    adverse_info CHAR(2) COMMENT 'A060013-不良信息',

    -- A060014 是否限权
    is_rights_restricted CHAR(1) COMMENT 'A060014-是否限权',

    -- A060015 入股资金来源
    capital_source CHAR(2) COMMENT 'A060015-入股资金来源',

    -- A060016 入股资金账号
    capital_account VARCHAR(100) COMMENT 'A060016-入股资金账号',

    -- A060017 股东或关联方状态
    shareholder_party_status CHAR(2) COMMENT 'A060017-股东或关联方状态',

    -- A060018 股东持股数量
    shareholding_quantity BIGINT COMMENT 'A060018-股东持股数量',

    -- A060019 股东持股比例
    shareholding_ratio DECIMAL(20,6) COMMENT 'A060019-股东持股比例',

    -- A060020 入股日期
    investment_date DATE COMMENT 'A060020-入股日期',

    -- A060021 股东股权质押比例
    equity_pledge_ratio DECIMAL(20,6) COMMENT 'A060021-股东股权质押比例',

    -- A060022 是否驻派董监事
    is_board_member_dispatched CHAR(1) COMMENT 'A060022-是否驻派董监事',

    -- A060023 最近一次变动日期
    last_change_date DATE COMMENT 'A060023-最近一次变动日期',

    -- A060025 股东股权最终受益人 (2.0版新增字段)
    ultimate_beneficiary VARCHAR(255) COMMENT 'A060025-股东股权最终受益人',

    -- A060026 控股股东标识 (2.0版新增字段)
    controlling_shareholder_flag CHAR(2) COMMENT 'A060026-控股股东标识',

    -- A060027 资产负债率 (2.0版新增字段)
    asset_liability_ratio DECIMAL(20,6) COMMENT 'A060027-资产负债率',

    -- A060028 净利润 (2.0版新增字段)
    net_profit DECIMAL(20,2) COMMENT 'A060028-净利润',

    -- A060024 采集日期
    collection_date DATE NOT NULL COMMENT 'A060024-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (shareholder_party_id),
    KEY idx_organization_id (organization_id),
    KEY idx_shareholder_party_name (shareholder_party_name),
    KEY idx_id_number (id_number),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),

    FOREIGN KEY (organization_id) REFERENCES organization_info(organization_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='A06-股东及关联方信息表';

-- 恢复外键检查
SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- 数据治理字段说明
-- =====================================================
/*
数据治理新增字段说明：

1. data_owner_dept (数据归属部门)
   - 类型: VARCHAR(100) NOT NULL
   - 说明: 标识数据确权后负责的业务部门
   - 用途: 明确数据责任归属，便于数据治理和问题追溯
   - 示例值: '零售银行部', '公司业务部', '风险管理部', '人力资源部'

2. data_source_system (数据来源系统)
   - 类型: VARCHAR(100) NOT NULL
   - 说明: 标识数据来自哪个业务系统
   - 用途: 追溯数据来源，支持数据血缘分析
   - 示例值: '核心银行系统', '人力资源系统', '客户关系管理系统', '设备管理系统'

索引设计：
- 为两个数据治理字段创建了独立索引
- 支持按部门和系统进行数据查询和统计
- 便于数据治理相关报表的生成

使用建议：
- 在数据插入时必须指定这两个字段的值
- 建议建立标准的部门编码和系统编码对照表
- 定期对数据归属进行审核和更新
*/

-- =====================================================
-- 脚本执行完成
-- =====================================================