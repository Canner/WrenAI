-- 银行一表通监管数据采集接口标准 2.0 - 客户类数据表建表脚本
-- Bank Regulatory Data Collection Interface Standard 2.0 - Customer Data Tables Creation Script
--
-- 本脚本包含客户类数据的7张表：
-- 1. 表2.1 单一法人基本情况 (corporate_customer_basic)
-- 2. 表2.2 集团基本情况 (group_customer_basic)
-- 3. 表2.3 同业客户基本情况 (interbank_customer_basic)
-- 4. 表2.4 个体工商户及小微企业主基本情况 (micro_business_customer_basic)
-- 5. 表2.5 个人客户基本情况 (individual_customer_basic)
-- 6. 表2.6 客户财务信息 (customer_financial_info)
-- 7. 表2.7 收单商户信息表 (acquiring_merchant_info)
--
-- 执行顺序说明：
-- 1. 首先执行基础表（单一法人基本情况表）
-- 2. 然后执行有外键依赖的表（集团基本情况表、客户财务信息表、收单商户信息表）
-- 3. 最后执行独立表（同业客户、个体工商户、个人客户）

SET FOREIGN_KEY_CHECKS = 0;

-- 删除已存在的表（按依赖关系逆序删除）
DROP TABLE IF EXISTS acquiring_merchant_info;
DROP TABLE IF EXISTS customer_financial_info;
DROP TABLE IF EXISTS group_customer_basic;
DROP TABLE IF EXISTS individual_customer_basic;
DROP TABLE IF EXISTS micro_business_customer_basic;
DROP TABLE IF EXISTS interbank_customer_basic;
DROP TABLE IF EXISTS corporate_customer_basic;

SET FOREIGN_KEY_CHECKS = 1;

-- 执行各表的建表脚本
SOURCE 07_corporate_customer_basic.sql;
SOURCE 08_group_customer_basic.sql;
SOURCE 09_interbank_customer_basic.sql;
SOURCE 10_micro_business_customer_basic.sql;
SOURCE 11_individual_customer_basic.sql;
SOURCE 12_customer_financial_info.sql;
SOURCE 13_acquiring_merchant_info.sql;

-- 显示创建结果
SHOW TABLES LIKE '%customer%' OR LIKE '%merchant%';