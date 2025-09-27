-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.6 共同债务人 (Joint Debtors)
-- =====================================================

CREATE TABLE joint_debtors (
    -- C060001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C060001-关系ID',

    -- C060002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C060002-机构ID',

    -- C060003 共同债务人名称
    joint_debtor_name VARCHAR(200) COMMENT 'C060003-共同债务人名称',

    -- C060004 共同债务人证件类型
    joint_debtor_cert_type CHAR(4) COMMENT 'C060004-共同债务人证件类型',

    -- C060005 共同债务人证件号码
    joint_debtor_cert_no VARCHAR(100) COMMENT 'C060005-共同债务人证件号码',

    -- C060006 借款人ID
    borrower_id VARCHAR(60) COMMENT 'C060006-借款人ID',

    -- C060007 借据ID
    loan_voucher_id VARCHAR(60) COMMENT 'C060007-借据ID',

    -- C060008 关系状态
    relationship_status VARCHAR(50) COMMENT 'C060008-关系状态',

    -- C060009 采集日期
    collection_date DATE NOT NULL COMMENT 'C060009-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_organization_id (organization_id),
    KEY idx_joint_debtor_cert_no (joint_debtor_cert_no),
    KEY idx_borrower_id (borrower_id),
    KEY idx_loan_voucher_id (loan_voucher_id),
    KEY idx_joint_debtor_name (joint_debtor_name),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_relationship_status (relationship_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C06-共同债务人表';