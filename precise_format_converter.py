#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具 - 真正保持格式版
基于PDF原始坐标位置精确还原表格格式

作者: Claude AI Assistant
版本: 3.0 (格式精确还原版)
日期: 2024-09-27
"""

import fitz  # PyMuPDF
import os
import sys
import re
from pathlib import Path
import logging
from datetime import datetime
from typing import List, Dict, Any, Tuple


def setup_logging(output_dir: str = ".") -> logging.Logger:
    """设置日志配置"""
    log_filename = os.path.join(output_dir, "precise_conversion.log")
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_filename, encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    return logging.getLogger(__name__)


def precise_pdf_to_markdown(pdf_path: str, output_path: str = None, logger: logging.Logger = None) -> bool:
    """
    精确保持PDF格式的转换
    
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
        logger.info(f"开始精确格式转换PDF文件: {pdf_path}")
        
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return False
        
        if output_path is None:
            pdf_name = Path(pdf_path).stem
            output_path = f"{pdf_name}_精确格式.md"
        
        doc = fitz.open(pdf_path)
        
        markdown_content = []
        markdown_content.append("# 银行一表通监管数据采集接口标准（2.0正式版）\n\n")
        markdown_content.append(f"*本文档由精确格式转换器生成 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
        markdown_content.append("*🎯 此版本基于PDF原始坐标位置精确还原表格格式*\n\n")
        markdown_content.append("---\n\n")
        
        total_pages = len(doc)
        logger.info(f"PDF总页数: {total_pages}")
        
        # 处理每一页
        for page_num in range(total_pages):
            if page_num % 20 == 0:
                progress = (page_num / total_pages) * 100
                logger.info(f"精确处理进度: {page_num + 1}/{total_pages} 页 ({progress:.1f}%)")
            
            page = doc[page_num]
            
            # 添加页面标题
            markdown_content.append(f"\n## 第 {page_num + 1} 页\n\n")
            
            # 精确提取页面内容
            page_content = extract_page_precisely(page, page_num + 1, logger)
            markdown_content.append(page_content)
        
        # 合并所有内容
        final_content = "".join(markdown_content)
        
        # 保存到文件
        logger.info("正在保存精确格式文件...")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        doc.close()
        
        # 显示统计信息
        lines_count = len(final_content.split('\n'))
        chars_count = len(final_content)
        file_size = os.path.getsize(output_path)
        
        logger.info(f"🎉 精确格式转换完成!")
        logger.info(f"输出文件: {output_path}")
        logger.info(f"文件大小: {file_size:,} 字节")
        logger.info(f"统计信息: {lines_count:,} 行, {chars_count:,} 字符")
        
        return True
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False


def extract_page_precisely(page, page_num: int, logger: logging.Logger) -> str:
    """
    精确提取页面内容，基于坐标位置还原格式
    
    Args:
        page: PDF页面对象
        page_num (int): 页面编号
        logger (logging.Logger): 日志记录器
    
    Returns:
        str: 精确格式化的页面内容
    """
    content = []
    
    try:
        # 获取文本字典，包含精确坐标
        text_dict = page.get_text("dict")
        blocks = text_dict.get("blocks", [])
        
        if blocks:
            page_content = process_blocks_precisely(blocks, page_num)
            content.append(page_content)
        else:
            # 简单文本提取作为后备
            simple_text = page.get_text()
            if simple_text.strip():
                content.append(f"```\n{simple_text}\n```\n\n")
            else:
                content.append("*[此页面主要包含图片、图表或扫描内容]*\n\n")
        
        # 检查图片
        try:
            images = page.get_images()
            if images and len(images) > 0:
                content.append(f"*📷 此页面包含 {len(images)} 张图片*\n\n")
        except:
            pass
        
    except Exception as e:
        logger.warning(f"第{page_num}页精确处理出错: {str(e)}")
        try:
            # 最后的备用方案
            simple_text = page.get_text()
            if simple_text.strip():
                content.append(f"```\n{simple_text}\n```\n\n")
            else:
                content.append("*[此页面处理失败]*\n\n")
        except:
            content.append("*[此页面无法读取]*\n\n")
    
    return "".join(content)


def process_blocks_precisely(blocks: List[Dict], page_num: int) -> str:
    """
    精确处理文本块，基于坐标位置重建布局
    
    Args:
        blocks (List[Dict]): 文本块列表
        page_num (int): 页面编号
    
    Returns:
        str: 处理后的内容
    """
    all_text_elements = []
    
    # 提取所有文本元素及其坐标
    for block in blocks:
        if block.get("type") == 0:  # 文本块
            block_elements = extract_text_elements(block)
            all_text_elements.extend(block_elements)
    
    if not all_text_elements:
        return ""
    
    # 按y坐标排序，然后按x坐标排序
    all_text_elements.sort(key=lambda x: (round(x['y'], 1), x['x']))
    
    # 检测表格结构
    table_structure = detect_table_structure_precisely(all_text_elements)
    
    if table_structure:
        return format_as_precise_table(table_structure)
    else:
        return format_as_structured_text(all_text_elements)


def extract_text_elements(block: Dict) -> List[Dict]:
    """
    提取文本块中的所有文本元素及其坐标
    
    Args:
        block (Dict): 文本块
    
    Returns:
        List[Dict]: 文本元素列表
    """
    elements = []
    
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            text = span.get("text", "").strip()
            if text:
                bbox = span.get("bbox", [0, 0, 0, 0])
                elements.append({
                    'text': text,
                    'x': bbox[0],
                    'y': bbox[1],
                    'width': bbox[2] - bbox[0],
                    'height': bbox[3] - bbox[1],
                    'font_size': span.get("size", 12),
                    'font_flags': span.get("flags", 0)
                })
    
    return elements


def detect_table_structure_precisely(elements: List[Dict]) -> List[List[Dict]]:
    """
    基于坐标精确检测表格结构
    
    Args:
        elements (List[Dict]): 文本元素列表
    
    Returns:
        List[List[Dict]]: 表格行列表，每行包含多个单元格
    """
    if len(elements) < 10:  # 至少需要10个元素才可能是表格
        return []
    
    # 按行分组 - 基于y坐标
    rows = {}
    for element in elements:
        y_key = round(element['y'], 0)  # 四舍五入到整数
        if y_key not in rows:
            rows[y_key] = []
        rows[y_key].append(element)
    
    # 过滤掉只有1个元素的行（可能不是表格行）
    table_rows = []
    for y_key in sorted(rows.keys()):
        row_elements = rows[y_key]
        if len(row_elements) >= 3:  # 至少3列才认为是表格行
            # 按x坐标排序
            row_elements.sort(key=lambda x: x['x'])
            table_rows.append(row_elements)
    
    # 如果表格行数少于3行，不认为是表格
    if len(table_rows) < 3:
        return []
    
    # 检查列对齐 - 表格应该有相对固定的列位置
    column_positions = set()
    for row in table_rows[:5]:  # 检查前5行
        for element in row:
            column_positions.add(round(element['x'] / 10) * 10)  # 对齐到10的倍数
    
    if len(column_positions) >= 3:  # 至少3个固定列位置
        return table_rows
    else:
        return []


def format_as_precise_table(table_rows: List[List[Dict]]) -> str:
    """
    将检测到的表格格式化为精确的Markdown表格
    
    Args:
        table_rows (List[List[Dict]]): 表格行
    
    Returns:
        str: Markdown表格
    """
    if not table_rows:
        return ""
    
    content = ["\n"]
    
    # 分析列结构 - 基于x坐标确定列
    all_x_positions = []
    for row in table_rows[:10]:  # 分析前10行
        for element in row:
            all_x_positions.append(element['x'])
    
    # 找出主要的列位置
    x_positions = sorted(set([round(x / 15) * 15 for x in all_x_positions]))
    
    # 检查是否是标准的7列表格（表号、表名、数据项编码、数据项名称、数据类别、数据格式、版本说明）
    if len(x_positions) >= 6:
        is_standard_table = True
        # 标准列位置参考值
        standard_positions = [90, 120, 170, 230, 310, 370, 450]
        
        for i, row in enumerate(table_rows):
            if i == 0 and is_standard_table:
                # 检查是否是表头
                row_texts = [elem['text'] for elem in row]
                if any('表号' in text or '表名' in text or '数据项' in text for text in row_texts):
                    # 这是表头行
                    header_row = "| 表号 | 表名 | 数据项编码 | 数据项名称 | 数据类别 | 数据格式 | 版本说明 |"
                    separator = "|------|------|-----------|-----------|----------|----------|----------|"
                    content.append(header_row + "\n")
                    content.append(separator + "\n")
                    continue
            
            # 将元素按列位置分组
            row_cells = [""] * 7  # 7列
            
            for element in row:
                x = element['x']
                text = element['text']
                
                # 确定属于哪一列
                if x < 115:  # 表号
                    row_cells[0] = text
                elif x < 155:  # 表名
                    row_cells[1] = text
                elif x < 220:  # 数据项编码
                    row_cells[2] = text
                elif x < 290:  # 数据项名称
                    row_cells[3] = text
                elif x < 350:  # 数据类别
                    row_cells[4] = text
                elif x < 430:  # 数据格式
                    row_cells[5] = text
                else:  # 版本说明
                    row_cells[6] = text
            
            # 构建表格行
            table_row = "| " + " | ".join(cell.strip() for cell in row_cells) + " |"
            content.append(table_row + "\n")
    
    else:
        # 非标准表格，使用动态列数
        max_cols = max(len(row) for row in table_rows) if table_rows else 0
        
        for i, row in enumerate(table_rows):
            # 按x坐标排序
            row_elements = sorted(row, key=lambda x: x['x'])
            
            # 构建表格行
            row_texts = [elem['text'] for elem in row_elements]
            
            # 补齐到最大列数
            while len(row_texts) < max_cols:
                row_texts.append("")
            
            table_row = "| " + " | ".join(row_texts) + " |"
            content.append(table_row + "\n")
            
            # 在第一行后添加分隔符
            if i == 0:
                separator = "|" + "|".join([" --- " for _ in range(max_cols)]) + "|"
                content.append(separator + "\n")
    
    content.append("\n")
    return "".join(content)


def format_as_structured_text(elements: List[Dict]) -> str:
    """
    将非表格内容格式化为结构化文本
    
    Args:
        elements (List[Dict]): 文本元素列表
    
    Returns:
        str: 结构化文本
    """
    content = []
    
    # 按行分组
    rows = {}
    for element in elements:
        y_key = round(element['y'], 0)
        if y_key not in rows:
            rows[y_key] = []
        rows[y_key].append(element)
    
    # 按y坐标排序处理每行
    for y_key in sorted(rows.keys()):
        row_elements = sorted(rows[y_key], key=lambda x: x['x'])
        
        # 合并同一行的文本
        line_text = " ".join(elem['text'] for elem in row_elements)
        
        # 格式化处理
        if is_title_text(line_text):
            if re.match(r'^第[一二三四五六七八九十\d]+', line_text):
                content.append(f"## {line_text}\n\n")
            elif re.match(r'^[一二三四五六七八九十]+[、．]', line_text):
                content.append(f"### {line_text}\n\n")
            elif re.match(r'^\([一二三四五六七八九十]+\)', line_text):
                content.append(f"#### {line_text}\n\n")
            elif re.match(r'^表\d+', line_text):
                content.append(f"#### {line_text}\n\n")
            else:
                content.append(f"**{line_text}**\n\n")
        else:
            content.append(f"{line_text}\n\n")
    
    return "".join(content)


def is_title_text(text: str) -> bool:
    """检测是否为标题文本"""
    title_patterns = [
        r'^第[一二三四五六七八九十\d]+[章节条部分]',
        r'^[一二三四五六七八九十]+[、．]',
        r'^\([一二三四五六七八九十]+\)',
        r'^表\d+[\.\s]',
        r'^附件',
        r'^说明',
        r'^备注',
        r'^注[：:]',
        r'^目录',
        r'数据项目录'
    ]
    
    return any(re.match(pattern, text.strip()) for pattern in title_patterns)


def main():
    """主函数"""
    print("银行一表通监管数据采集接口标准PDF转Markdown工具")
    print("=" * 70)
    print("🎯 精确格式还原版 - 基于PDF坐标位置精确重建表格")
    print("=" * 70)
    
    # 设置日志
    logger = setup_logging()
    
    # 配置文件路径
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_精确格式.md"
    
    # 检查PDF文件是否存在
    if not os.path.exists(pdf_path):
        logger.error(f"PDF文件不存在: {pdf_path}")
        logger.info("请将PDF文件放在与程序相同的目录中")
        return 1
    
    logger.info(f"输入文件: {pdf_path}")
    logger.info(f"输出文件: {output_path}")
    
    # 执行转换
    try:
        if precise_pdf_to_markdown(pdf_path, output_path, logger):
            logger.info("🎉 精确格式转换成功完成!")
            
            # 显示预览
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    preview_length = min(3000, len(content))
                    preview = content[:preview_length]
                    if len(content) > preview_length:
                        preview += "\n\n... (显示前3000字符)"
                    
                    print("\n" + "="*70)
                    print("📄 精确格式文件预览:")
                    print("="*70)
                    print(preview)
                    
            except Exception as e:
                logger.warning(f"无法显示预览: {e}")
            
            return 0
        else:
            logger.error("❌ 精确格式转换失败!")
            return 1
            
    except KeyboardInterrupt:
        logger.info("⏹️ 用户中断转换")
        return 1
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())