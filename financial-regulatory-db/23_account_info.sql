-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表4.2 科目信息 (Account Information)
-- =====================================================

CREATE TABLE account_info (
    -- D020001 科目ID
    account_id VARCHAR(32) NOT NULL COMMENT 'D020001-科目ID',

    -- D020002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'D020002-机构ID',

    -- D020003 科目名称
    account_name TEXT COMMENT 'D020003-科目名称',

    -- D020004 科目级次
    account_level CHAR(2) NOT NULL COMMENT 'D020004-科目级次',

    -- D020005 科目类型
    account_type CHAR(2) NOT NULL COMMENT 'D020005-科目类型',

    -- D020006 借贷标识
    debit_credit_flag CHAR(2) NOT NULL COMMENT 'D020006-借贷标识',

    -- D020007 归属业务子类
    business_subcategory VARCHAR(300) COMMENT 'D020007-归属业务子类',

    -- D020008 上级科目ID
    parent_account_id VARCHAR(32) COMMENT 'D020008-上级科目ID',

    -- D020009 分户账标识
    sub_account_flag CHAR(1) NOT NULL COMMENT 'D020009-分户账标识',

    -- D020010 备注
    remarks TEXT COMMENT 'D020010-备注',

    -- D020011 采集日期
    collection_date DATE NOT NULL COMMENT 'D020011-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 联合主键：科目ID + 机构ID
    PRIMARY KEY (account_id, organization_id),

    -- 索引设计
    KEY idx_organization_id (organization_id),
    KEY idx_account_level (account_level),
    KEY idx_account_type (account_type),
    KEY idx_debit_credit_flag (debit_credit_flag),
    KEY idx_parent_account_id (parent_account_id),
    KEY idx_sub_account_flag (sub_account_flag),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_created_at (created_at),

    -- 复合索引优化查询性能
    KEY idx_org_level (organization_id, account_level),
    KEY idx_org_type (organization_id, account_type),
    KEY idx_type_level (account_type, account_level),
    KEY idx_parent_level (parent_account_id, account_level),

    -- 外键约束（如果需要与其他表关联）
    -- FOREIGN KEY (organization_id) REFERENCES organization_info(organization_id),
    -- FOREIGN KEY (parent_account_id, organization_id) REFERENCES account_info(account_id, organization_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='D02-科目信息表';