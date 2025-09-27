-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
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