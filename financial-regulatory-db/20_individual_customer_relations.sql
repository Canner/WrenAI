-- =====================================================
-- 银行一表通监管数据采集接口标准（2.0版）
-- 表3.7 个人客户关系人 (Individual Customer Relations)
-- =====================================================

CREATE TABLE individual_customer_relations (
    -- C070001 关系ID
    relationship_id VARCHAR(64) NOT NULL COMMENT 'C070001-关系ID',

    -- C070002 机构ID
    organization_id VARCHAR(24) NOT NULL COMMENT 'C070002-机构ID',

    -- C070003 个人ID
    individual_id VARCHAR(60) NOT NULL COMMENT 'C070003-个人ID',

    -- C070004 社会关系
    social_relationship CHAR(2) COMMENT 'C070004-社会关系',

    -- C070005 关系人ID
    related_person_id VARCHAR(60) COMMENT 'C070005-关系人ID',

    -- C070006 关系人姓名
    related_person_name VARCHAR(200) COMMENT 'C070006-关系人姓名',

    -- C070007 关系人证件类型
    related_person_cert_type CHAR(4) COMMENT 'C070007-关系人证件类型',

    -- C070008 关系人证件号码
    related_person_cert_no VARCHAR(100) COMMENT 'C070008-关系人证件号码',

    -- C070009 建立关系日期
    establish_relationship_date DATE COMMENT 'C070009-建立关系日期',

    -- C070010 解除关系日期
    terminate_relationship_date DATE COMMENT 'C070010-解除关系日期',

    -- C070011 采集日期
    collection_date DATE NOT NULL COMMENT 'C070011-采集日期',

    -- 数据治理字段
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门-标识数据确权后负责的业务部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统-标识数据来自哪个业务系统',

    -- 创建时间和更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    PRIMARY KEY (relationship_id),
    KEY idx_organization_id (organization_id),
    KEY idx_individual_id (individual_id),
    KEY idx_related_person_id (related_person_id),
    KEY idx_related_person_cert_no (related_person_cert_no),
    KEY idx_related_person_name (related_person_name),
    KEY idx_social_relationship (social_relationship),
    KEY idx_collection_date (collection_date),
    KEY idx_data_owner_dept (data_owner_dept),
    KEY idx_data_source_system (data_source_system),
    KEY idx_establish_relationship_date (establish_relationship_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='C07-个人客户关系人表';