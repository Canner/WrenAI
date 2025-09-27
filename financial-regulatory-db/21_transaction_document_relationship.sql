-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.8 交易与单据对应关系 (Transaction and Document Relationship)
-- =====================================================

CREATE TABLE transaction_document_relationship (
    -- 注意：此表没有C080001字段，C080002作为第一个字段
    -- C080002 协议ID
    agreement_id VARCHAR(60) NOT NULL COMMENT 'C080002-协议ID',

    -- C080003 单据ID
    document_id VARCHAR(200) NOT NULL COMMENT 'C080003-单据ID',

    -- C080004 交易机构ID
    transaction_organization_id VARCHAR(24) NOT NULL COMMENT 'C080004-交易机构ID',

    -- C080005 对应关系
    correspondence_relationship CHAR(2) COMMENT 'C080005-对应关系',

    -- C080008 业务种类 (2.0试用版新增字段)
    business_category CHAR(2) COMMENT 'C080008-业务种类',

    -- C080006 备注
    remarks TEXT COMMENT 'C080006-备注',

    -- C080007 采集日期
    collection_date DATE NOT NULL COMMENT 'C080007-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 使用复合主键，因为没有单独的ID字段
    PRIMARY KEY (agreement_id, document_id, transaction_organization_id),
    KEY idx_agreement_id (agreement_id),
    KEY idx_document_id (document_id),
    KEY idx_transaction_organization_id (transaction_organization_id),
    KEY idx_correspondence_relationship (correspondence_relationship),
    KEY idx_business_category (business_category),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C08-交易与单据对应关系表';