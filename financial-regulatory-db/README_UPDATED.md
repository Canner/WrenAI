# 银行一表通监管数据采集接口标准数据库脚本（更新版）

## 项目说明

本项目根据国家金融监管总局发布的《银行一表通监管数据采集接口标准（2.0版）》生成MySQL数据库建表脚本。**已增加数据治理字段**，包括数据归属部门和数据来源系统。

## 版本更新说明

### 🆕 v2.0 更新内容

- **新增数据治理字段**：
  - `data_owner_dept` - 数据归属部门（标识数据确权后负责的业务部门）
  - `data_source_system` - 数据来源系统（标识数据来自哪个业务系统）
- **优化索引设计**：为数据治理字段创建独立索引，支持按部门和系统查询
- **增强数据追溯能力**：支持数据血缘分析和责任归属管理

## 数据库环境

- **数据库类型**: MySQL 5.7+
- **字符集**: UTF8MB4
- **排序规则**: utf8mb4_unicode_ci
- **引擎**: InnoDB

## 目录结构

```
financial-regulatory-db/
├── README_UPDATED.md                       # 项目说明文档（更新版）
├── 00_organization_theme_tables_updated.sql # 机构主题表汇总脚本（更新版）
├── 01_organization_info.sql                # 表1.1 机构信息（已更新）
├── 02_organization_relationship.sql        # 表1.2 机构关系（已更新）
├── 03_employee.sql                         # 表1.3 员工（已更新）
├── 04_position_info.sql                    # 表1.4 岗位信息（已更新）
├── 05_self_service_equipment.sql           # 表1.5 自助机具（已更新）
├── 06_shareholder_related_party.sql        # 表1.6 股东及关联方信息（已更新）
├── validate_syntax.sql                     # 语法验证脚本
└── 00_organization_theme_tables.sql        # 原版汇总脚本（保留备份）
```

## 数据表说明

### 机构主题 (Organization Theme) - 已更新

| 序号 | 表名 | 英文表名 | 监管字段 | 治理字段 | 总字段数 | 主要用途 |
|------|------|----------|---------|---------|---------|----------|
| 1.1 | 机构信息 | organization_info | 24 | 2 | 28 | 银行机构基本信息 |
| 1.2 | 机构关系 | organization_relationship | 3 | 2 | 7 | 机构层级关系 |
| 1.3 | 员工 | employee | 28 | 2 | 32 | 员工基本信息及岗位信息 |
| 1.4 | 岗位信息 | position_info | 9 | 2 | 13 | 岗位设置及说明 |
| 1.5 | 自助机具 | self_service_equipment | 12 | 2 | 16 | ATM等自助设备管理 |
| 1.6 | 股东及关联方信息 | shareholder_related_party | 28 | 2 | 32 | 股东及关联方详细信息 |

## 数据治理字段详细说明

### 新增字段规范

#### 1. data_owner_dept（数据归属部门）
- **类型**: `VARCHAR(100) NOT NULL`
- **说明**: 标识数据确权后负责的业务部门
- **用途**: 明确数据责任归属，便于数据治理和问题追溯
- **示例值**:
  - `'零售银行部'` - 个人客户相关数据
  - `'公司业务部'` - 企业客户相关数据
  - `'风险管理部'` - 风险评估相关数据
  - `'人力资源部'` - 员工信息相关数据
  - `'运营管理部'` - 设备和基础设施数据

#### 2. data_source_system（数据来源系统）
- **类型**: `VARCHAR(100) NOT NULL`
- **说明**: 标识数据来自哪个业务系统
- **用途**: 追溯数据来源，支持数据血缘分析
- **示例值**:
  - `'核心银行系统'` - 核心业务数据
  - `'人力资源系统'` - 员工管理数据
  - `'客户关系管理系统'` - 客户信息数据
  - `'设备管理系统'` - 自助设备数据
  - `'股权管理系统'` - 股东信息数据

### 索引设计优化

```sql
-- 每个表都增加了数据治理字段的索引
KEY idx_data_owner_dept (data_owner_dept),
KEY idx_data_source_system (data_source_system)
```

**索引优势**：
- 支持按部门快速查询数据责任范围
- 支持按系统查询数据来源分布
- 便于生成数据治理相关统计报表

## 字段命名规范

### 英文命名规范
- 采用金融行业专业英文术语
- 使用snake_case命名风格
- 字段名具有明确的业务含义

### 注释规范
- **监管字段格式**: `{字段编号}-{中文名称}`
- **治理字段格式**: `{中文名称}-{详细说明}`
- **示例**:
  - `'A010001-机构ID'` (监管字段)
  - `'数据归属部门-标识数据确权后负责的业务部门'` (治理字段)

## 数据类型映射

| 规范格式 | MySQL类型 | 说明 |
|----------|-----------|------|
| anc..24 | VARCHAR(24) | 字母数字中文，最大24位 |
| an..18 | VARCHAR(18) | 字母数字，最大18位 |
| 2!n | CHAR(2) | 固定2位数字 |
| 1!n | CHAR(1) | 固定1位数字 |
| YYYY-MM-DD | DATE | 日期格式 |
| 20n(6) | DECIMAL(20,6) | 精度20位，小数6位 |
| 20n(2) | DECIMAL(20,2) | 精度20位，小数2位 |
| 治理字段 | VARCHAR(100) | 数据治理专用字段 |

## 使用方法

### 1. 执行更新版汇总脚本（推荐）
```sql
-- 执行包含数据治理字段的完整建表脚本
source 00_organization_theme_tables_updated.sql;
```

### 2. 执行单个表脚本
```sql
-- 执行单个表的建表脚本（已包含治理字段）
source 01_organization_info.sql;
```

### 3. 验证表结构
```sql
-- 查看表结构（包含新增治理字段）
DESCRIBE organization_info;

-- 验证数据治理字段
SELECT COLUMN_NAME, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'organization_info'
AND COLUMN_NAME IN ('data_owner_dept', 'data_source_system');
```

### 4. 数据治理查询示例
```sql
-- 按部门查询数据分布
SELECT data_owner_dept, COUNT(*) as record_count
FROM organization_info
GROUP BY data_owner_dept;

-- 按系统查询数据来源
SELECT data_source_system, COUNT(*) as record_count
FROM employee
GROUP BY data_source_system;

-- 数据治理综合报表
SELECT
    data_owner_dept,
    data_source_system,
    COUNT(*) as record_count,
    MIN(collection_date) as earliest_date,
    MAX(collection_date) as latest_date
FROM organization_info
GROUP BY data_owner_dept, data_source_system;
```

## 外键关系（保持不变）

```
organization_info (主表)
    ├── organization_relationship (机构关系)
    ├── employee (员工信息)
    ├── position_info (岗位信息)
    ├── self_service_equipment (自助机具)
    └── shareholder_related_party (股东及关联方)
```

## 数据治理最佳实践

### 1. 数据插入规范
```sql
-- 插入数据时必须指定治理字段
INSERT INTO organization_info (
    organization_id,
    bank_institution_name,
    collection_date,
    data_owner_dept,           -- 必填：数据归属部门
    data_source_system,        -- 必填：数据来源系统
    -- 其他字段...
) VALUES (
    'ORG001',
    '某银行分行',
    '2025-09-27',
    '零售银行部',             -- 明确责任部门
    '核心银行系统',           -- 明确数据来源
    -- 其他值...
);
```

### 2. 建立标准编码表
```sql
-- 建议创建部门编码表
CREATE TABLE data_governance_dept_codes (
    dept_code VARCHAR(50) PRIMARY KEY,
    dept_name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 建议创建系统编码表
CREATE TABLE data_governance_system_codes (
    system_code VARCHAR(50) PRIMARY KEY,
    system_name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. 数据质量监控
```sql
-- 检查数据治理字段完整性
SELECT
    TABLE_NAME,
    COUNT(*) as total_records,
    SUM(CASE WHEN data_owner_dept IS NULL OR data_owner_dept = '' THEN 1 ELSE 0 END) as missing_dept,
    SUM(CASE WHEN data_source_system IS NULL OR data_source_system = '' THEN 1 ELSE 0 END) as missing_system
FROM information_schema.tables
WHERE table_schema = 'your_database_name';
```

## 注意事项

1. **向后兼容性**:
   - 原有脚本保留备份（不带后缀）
   - 新版脚本使用`_updated`后缀标识

2. **数据迁移**:
   - 如果从原版本升级，需要为现有数据补充治理字段值
   - 建议先在测试环境验证迁移脚本

3. **必填约束**:
   - 两个治理字段均设置为`NOT NULL`
   - 插入数据时必须提供有效值

4. **性能考虑**:
   - 新增索引可能影响写入性能
   - 建议在业务低峰期执行建表脚本

5. **治理流程**:
   - 建立定期数据治理审核机制
   - 制定部门和系统编码标准
   - 培训相关人员数据治理规范

## 配置信息

数据库连接配置位于项目根目录的 `db.config` 文件中：

```
dbtype=mysql
dbhost=49.232.35.230
dbport=3306
dbuser=root
dbpassword=Zyl@3f342bb206
dbname=urdr
```

## 下一步计划

完成机构主题表结构更新后，将继续为其余9个主题的表结构增加数据治理字段：
- 客户类数据 (7张表)
- 关系类数据 (8张表)
- 财务类数据 (4张表)
- 产品类数据 (5张表)
- 协议类数据 (25张表)
- 交易类数据 (12张表)
- 状态类数据 (16张表)
- 资源类数据 (5张表)
- 参数类数据 (2张表)
- 监管指标类数据 (1张表)

## 技术支持

如有问题，请联系开发团队或查阅相关监管文档。

---

**版本信息**：
- 原始版本：基于监管规范标准字段
- 当前版本：v2.0 - 增加数据治理字段
- 更新日期：2025-09-27