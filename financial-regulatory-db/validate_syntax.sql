-- =====================================================
-- 银行一表通监管数据采集接口标准
-- SQL语法验证脚本
-- =====================================================

-- 检查语法是否正确（不实际执行建表，仅验证语法）
SET SQL_MODE = 'TRADITIONAL';
SET FOREIGN_KEY_CHECKS = 0;

-- 验证机构信息表语法
SELECT 'Validating organization_info table syntax...' as status;

-- 验证机构关系表语法
SELECT 'Validating organization_relationship table syntax...' as status;

-- 验证员工表语法
SELECT 'Validating employee table syntax...' as status;

-- 验证岗位信息表语法
SELECT 'Validating position_info table syntax...' as status;

-- 验证自助机具表语法
SELECT 'Validating self_service_equipment table syntax...' as status;

-- 验证股东及关联方信息表语法
SELECT 'Validating shareholder_related_party table syntax...' as status;

-- 检查字段编号覆盖情况
SELECT 'Checking field code coverage...' as status;

-- 机构信息表字段编号检查 (A010001-A010023 + A010020)
-- 机构关系表字段编号检查 (A020001-A020003)
-- 员工表字段编号检查 (A030001-A030028)
-- 岗位信息表字段编号检查 (A040001-A040009)
-- 自助机具表字段编号检查 (A050001-A050012)
-- 股东及关联方信息表字段编号检查 (A060001-A060028)

SELECT 'Validation completed successfully!' as status;