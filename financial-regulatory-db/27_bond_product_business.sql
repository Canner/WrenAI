-- 表5.3 债券产品业务表
-- Bond Product Business Table
CREATE TABLE bond_product_business (
    -- 监管字段 (Regulatory Fields)
    product_id VARCHAR(32) NOT NULL COMMENT 'E030001-产品ID',
    institution_id VARCHAR(24) NOT NULL COMMENT 'E030002-机构ID',
    product_name TEXT COMMENT 'E030003-产品名称',
    product_code VARCHAR(255) COMMENT 'E030004-产品编号',
    bond_product_business_type VARCHAR(2) COMMENT 'E030005-债券产品业务类型',
    bond_type_code VARCHAR(2) COMMENT 'E030006-债券类型代码',
    bond_subtype_code VARCHAR(2) COMMENT 'E030007-债券子类型代码',
    face_value DECIMAL(20,2) COMMENT 'E030008-票面金额',
    bond_period INT COMMENT 'E030009-债券期次',
    issue_scale DECIMAL(20,2) COMMENT 'E030010-发行规模',
    bond_issuer_unified_social_credit_code VARCHAR(18) COMMENT 'E030011-债券发行人统一社会信用代码',
    bond_issuer_name VARCHAR(200) COMMENT 'E030012-债券发行人名称',
    regular_interest_payment_account VARCHAR(255) COMMENT 'E030013-定期付息账号',
    repurchase_flag TINYINT(1) COMMENT 'E030014-可回购标识',
    early_redemption_flag TINYINT(1) COMMENT 'E030015-可提前偿还标识',
    issue_price DECIMAL(20,6) COMMENT 'E030016-发行价格',
    redemption_price DECIMAL(20,2) COMMENT 'E030017-赎回价格',
    currency VARCHAR(3) COMMENT 'E030034-币种',
    issue_country_region VARCHAR(300) COMMENT 'E030018-发行国家地区',
    guarantee_institution_country_region VARCHAR(3) COMMENT 'E030019-担保机构国家地区',
    bond_issuer_institution_type VARCHAR(2) COMMENT 'E030020-债券发行机构类型',
    guarantee_institution_type VARCHAR(2) COMMENT 'E030021-担保机构类型',
    issue_method VARCHAR(2) COMMENT 'E030022-发行方式',
    issuer_location_admin_division VARCHAR(6) COMMENT 'E030023-发行人所在地行政区划',
    issue_fund_purpose VARCHAR(2) COMMENT 'E030024-发行资金用途',
    asset_risk_weight DECIMAL(20,6) COMMENT 'E030025-资产风险权重',
    asset_grade VARCHAR(2) COMMENT 'E030026-资产等级',
    sovereign_risk_weight VARCHAR(2) COMMENT 'E030027-主权风险权重',
    benchmark_treasury_yield DECIMAL(20,6) COMMENT 'E030028-基准国债收益率',
    trading_method_code VARCHAR(32) COMMENT 'E030029-交易方式代码',
    issue_date DATE COMMENT 'E030030-发行日期',
    maturity_payment_date DATE COMMENT 'E030031-到期兑付日期',
    remarks TEXT COMMENT 'E030032-备注',
    collection_date DATE NOT NULL COMMENT 'E030033-采集日期',

    -- 数据治理字段 (Data Governance Fields)
    data_owner_dept VARCHAR(100) NOT NULL COMMENT '数据归属部门',
    data_source_system VARCHAR(100) NOT NULL COMMENT '数据来源系统',

    -- 时间戳字段 (Timestamp Fields)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    -- 主键约束
    PRIMARY KEY (product_id, institution_id),

    -- 索引
    INDEX idx_product_name (product_name(255)),
    INDEX idx_product_code (product_code),
    INDEX idx_bond_product_business_type (bond_product_business_type),
    INDEX idx_bond_type_code (bond_type_code),
    INDEX idx_bond_subtype_code (bond_subtype_code),
    INDEX idx_bond_issuer_unified_social_credit_code (bond_issuer_unified_social_credit_code),
    INDEX idx_bond_issuer_name (bond_issuer_name),
    INDEX idx_currency (currency),
    INDEX idx_bond_issuer_institution_type (bond_issuer_institution_type),
    INDEX idx_issue_method (issue_method),
    INDEX idx_issuer_location_admin_division (issuer_location_admin_division),
    INDEX idx_issue_date (issue_date),
    INDEX idx_maturity_payment_date (maturity_payment_date),
    INDEX idx_collection_date (collection_date),
    INDEX idx_data_owner_dept (data_owner_dept),
    INDEX idx_data_source_system (data_source_system),
    INDEX idx_created_at (created_at),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_unicode_ci
COMMENT='债券产品业务表';