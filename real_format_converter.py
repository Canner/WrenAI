#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具 - 真实格式还原版
完全按照PDF原始文本顺序重新组织为正确的表格格式

作者: Claude AI Assistant
版本: 4.0 (真实格式还原版)
日期: 2024-09-27
"""

import fitz  # PyMuPDF
import os
import sys
import re
from pathlib import Path
import logging
from datetime import datetime
from typing import List, Dict, Any


def setup_logging(output_dir: str = ".") -> logging.Logger:
    """设置日志配置"""
    log_filename = os.path.join(output_dir, "real_format_conversion.log")
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_filename, encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    return logging.getLogger(__name__)


def real_format_pdf_to_markdown(pdf_path: str, output_path: str = None, logger: logging.Logger = None) -> bool:
    """
    真实格式PDF转Markdown转换 - 保持原始文本顺序
    
    Args:
        pdf_path (str): PDF文件路径
        output_path (str): 输出Markdown文件路径
        logger (logging.Logger): 日志记录器
    
    Returns:
        bool: 转换是否成功
    """
    if logger is None:
        logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"开始真实格式转换PDF文件: {pdf_path}")
        
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return False
        
        if output_path is None:
            pdf_name = Path(pdf_path).stem
            output_path = f"{pdf_name}_真实格式.md"
        
        doc = fitz.open(pdf_path)
        
        markdown_content = []
        markdown_content.append("# 银行一表通监管数据采集接口标准（2.0正式版）\n\n")
        markdown_content.append(f"*本文档由真实格式转换器生成 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
        markdown_content.append("*✨ 此版本完全按照PDF原始文本顺序组织为正确的表格格式*\n\n")
        markdown_content.append("---\n\n")
        
        total_pages = len(doc)
        logger.info(f"PDF总页数: {total_pages}")
        
        # 处理每一页
        for page_num in range(total_pages):
            if page_num % 30 == 0:
                progress = (page_num / total_pages) * 100
                logger.info(f"真实格式处理进度: {page_num + 1}/{total_pages} 页 ({progress:.1f}%)")
            
            page = doc[page_num]
            
            # 添加页面标题
            markdown_content.append(f"\n## 第 {page_num + 1} 页\n\n")
            
            # 提取页面原始文本
            page_content = extract_page_real_format(page, page_num + 1, logger)
            markdown_content.append(page_content)
        
        # 合并所有内容
        final_content = "".join(markdown_content)
        
        # 保存到文件
        logger.info("正在保存真实格式文件...")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        doc.close()
        
        # 显示统计信息
        lines_count = len(final_content.split('\n'))
        chars_count = len(final_content)
        file_size = os.path.getsize(output_path)
        
        logger.info(f"🎉 真实格式转换完成!")
        logger.info(f"输出文件: {output_path}")
        logger.info(f"文件大小: {file_size:,} 字节")
        logger.info(f"统计信息: {lines_count:,} 行, {chars_count:,} 字符")
        
        return True
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False


def extract_page_real_format(page, page_num: int, logger: logging.Logger) -> str:
    """
    提取页面真实格式内容 - 按原始文本顺序处理
    
    Args:
        page: PDF页面对象
        page_num (int): 页面编号
        logger (logging.Logger): 日志记录器
    
    Returns:
        str: 真实格式的页面内容
    """
    try:
        # 获取原始文本
        raw_text = page.get_text()
        
        if not raw_text.strip():
            return "*[此页面主要包含图片、图表或扫描内容]*\n\n"
        
        # 处理原始文本为正确格式
        formatted_content = process_raw_text_to_table(raw_text, page_num)
        
        return formatted_content
        
    except Exception as e:
        logger.warning(f"第{page_num}页处理出错: {str(e)}")
        return "*[此页面处理失败]*\n\n"


def process_raw_text_to_table(raw_text: str, page_num: int) -> str:
    """
    将原始文本处理为表格格式
    
    Args:
        raw_text (str): 原始文本
        page_num (int): 页面编号
    
    Returns:
        str: 格式化的内容
    """
    lines = raw_text.strip().split('\n')
    content = []
    
    # 去掉空行
    lines = [line.strip() for line in lines if line.strip()]
    
    if not lines:
        return "*[空页面]*\n\n"
    
    # 检测是否是表格页面
    table_content = detect_and_format_table_page(lines)
    if table_content:
        return table_content
    
    # 非表格页面，按原文格式显示
    content.append("```\n")
    for line in lines:
        content.append(line + "\n")
    content.append("```\n\n")
    
    return "".join(content)


def detect_and_format_table_page(lines: List[str]) -> str:
    """
    检测并格式化表格页面
    
    Args:
        lines (List[str]): 文本行列表
    
    Returns:
        str: 格式化的表格内容，如果不是表格则返回空字符串
    """
    # 检查是否包含表格标题行
    header_indicators = ["表号", "表名", "数据项编码", "数据项名称", "数据类别", "数据格式", "版本说明"]
    
    # 寻找标题行
    header_line_idx = -1
    for i, line in enumerate(lines):
        if any(indicator in line for indicator in header_indicators[:3]):  # 至少包含前3个指标
            header_line_idx = i
            break
    
    if header_line_idx == -1:
        # 不是标准表格页面，检查是否是数据行页面
        return format_data_lines_as_table(lines)
    
    content = []
    
    # 添加页面标题（如果有）
    for i in range(header_line_idx):
        line = lines[i]
        if is_page_title(line):
            content.append(format_title(line) + "\n\n")
        else:
            content.append(line + "\n\n")
    
    # 添加表格标题
    content.append("| 表号 | 表名 | 数据项编码 | 数据项名称 | 数据类别 | 数据格式 | 版本说明 |\n")
    content.append("|------|------|-----------|-----------|----------|----------|---------|\n")
    
    # 处理数据行
    table_data = format_table_data_lines(lines[header_line_idx + 1:])
    content.append(table_data)
    
    return "".join(content)


def format_data_lines_as_table(lines: List[str]) -> str:
    """
    将数据行格式化为表格（用于没有标题的页面）
    
    Args:
        lines (List[str]): 文本行列表
    
    Returns:
        str: 格式化的表格，如果不是数据行则返回空字符串
    """
    # 检测是否是数据行格式 - 查找典型的数据项编码模式
    data_line_pattern = r'^(\d+\.\d+|[AB]\d{6})'
    
    has_data_lines = False
    for line in lines:
        if re.match(data_line_pattern, line):
            has_data_lines = True
            break
    
    if not has_data_lines:
        return ""  # 不是数据行格式
    
    content = []
    content.append("| 表号 | 表名 | 数据项编码 | 数据项名称 | 数据类别 | 数据格式 | 版本说明 |\n")
    content.append("|------|------|-----------|-----------|----------|----------|---------|\n")
    
    # 处理数据行
    table_data = format_table_data_lines(lines)
    content.append(table_data)
    
    return "".join(content)


def format_table_data_lines(lines: List[str]) -> str:
    """
    格式化表格数据行
    
    Args:
        lines (List[str]): 数据行列表
    
    Returns:
        str: 格式化的表格数据行
    """
    if not lines:
        return ""
    
    content = []
    i = 0
    
    while i < len(lines):
        # 尝试组装一行表格数据
        table_row = parse_table_row(lines, i)
        if table_row:
            row_text, consumed_lines = table_row
            content.append(row_text)
            i += consumed_lines
        else:
            # 无法解析为表格行，跳过
            i += 1
    
    return "".join(content)


def parse_table_row(lines: List[str], start_idx: int) -> tuple:
    """
    解析表格行数据
    
    Args:
        lines (List[str]): 所有行
        start_idx (int): 开始索引
    
    Returns:
        tuple: (表格行文本, 消耗的行数) 或 None
    """
    if start_idx >= len(lines):
        return None
    
    # 表格的7个字段
    fields = ["", "", "", "", "", "", ""]
    consumed = 0
    current_line = start_idx
    
    # 尝试解析表格行的模式
    # 模式: 表号 -> 表名 -> 数据项编码 -> 数据项名称 -> 数据类别 -> 数据格式 -> 版本说明
    
    field_patterns = [
        r'^(\d+\.\d+)$',           # 表号: 1.1, 1.2 等
        r'^([^A-Z\d].{0,20})$',    # 表名: 机构信息, 员工 等
        r'^([AB]\d{6})$',          # 数据项编码: A010001 等
        r'^(.{1,50})$',            # 数据项名称
        r'^(代码类|文本类|编码类|数值类|金额类|日期类|指示器类)$',  # 数据类别
        r'^([\w!.:-]{1,20})$',     # 数据格式: anc..24, 1!n 等
        r'^(\d+\.\d+\s*版.*?)$'    # 版本说明: 1.0 版, 2.0 版新增字段 等
    ]
    
    field_idx = 0
    
    while current_line < len(lines) and field_idx < 7:
        line = lines[current_line].strip()
        
        if not line:
            current_line += 1
            continue
        
        # 尝试匹配当前字段
        if field_idx < len(field_patterns):
            if re.match(field_patterns[field_idx], line):
                fields[field_idx] = line
                field_idx += 1
                current_line += 1
                consumed += 1
            else:
                # 如果不匹配，尝试是否是组合字段
                if field_idx == 3:  # 数据项名称可能是多行
                    fields[field_idx] = line
                    field_idx += 1
                    current_line += 1
                    consumed += 1
                else:
                    # 跳过这行，可能是无关内容
                    current_line += 1
                    consumed += 1
        else:
            break
    
    # 如果至少解析到了前3个字段，认为是有效的表格行
    if field_idx >= 3 or any(fields[:3]):
        row_text = "| " + " | ".join(field.strip() for field in fields) + " |\n"
        return (row_text, consumed if consumed > 0 else 1)
    
    return None


def is_page_title(line: str) -> bool:
    """判断是否是页面标题"""
    title_indicators = [
        "数据项目录", "机构类数据", "客户类数据", "关系类数据", 
        "财务类数据", "产品类数据", "协议类数据", "交易类数据",
        "状态类数据", "资源类数据", "参数类数据", "监管指标类数据"
    ]
    return any(indicator in line for indicator in title_indicators)


def format_title(line: str) -> str:
    """格式化标题"""
    if "数据项目录" in line:
        return f"### {line}"
    elif any(indicator in line for indicator in ["类数据"]):
        return f"#### {line}"
    else:
        return f"**{line}**"


def main():
    """主函数"""
    print("银行一表通监管数据采集接口标准PDF转Markdown工具")
    print("=" * 70)
    print("🎯 真实格式还原版 - 完全按照PDF原始文本顺序组织")
    print("=" * 70)
    
    # 设置日志
    logger = setup_logging()
    
    # 配置文件路径
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_真实格式.md"
    
    # 检查PDF文件是否存在
    if not os.path.exists(pdf_path):
        logger.error(f"PDF文件不存在: {pdf_path}")
        logger.info("请将PDF文件放在与程序相同的目录中")
        return 1
    
    logger.info(f"输入文件: {pdf_path}")
    logger.info(f"输出文件: {output_path}")
    
    # 执行转换
    try:
        if real_format_pdf_to_markdown(pdf_path, output_path, logger):
            logger.info("🎉 真实格式转换成功完成!")
            
            # 显示预览
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    preview_length = min(2500, len(content))
                    preview = content[:preview_length]
                    if len(content) > preview_length:
                        preview += "\n\n... (显示前2500字符)"
                    
                    print("\n" + "="*70)
                    print("📄 真实格式文件预览:")
                    print("="*70)
                    print(preview)
                    
            except Exception as e:
                logger.warning(f"无法显示预览: {e}")
            
            return 0
        else:
            logger.error("❌ 真实格式转换失败!")
            return 1
            
    except KeyboardInterrupt:
        logger.info("⏹️ 用户中断转换")
        return 1
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())