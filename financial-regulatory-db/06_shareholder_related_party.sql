-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
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