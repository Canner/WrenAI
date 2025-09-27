#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具 - 格式保持增强版
专注于保持原PDF的表格格式和布局结构

作者: Claude AI Assistant  
版本: 2.1 (稳定版)
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
    log_filename = os.path.join(output_dir, "enhanced_conversion.log")
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_filename, encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    return logging.getLogger(__name__)


def format_preserving_pdf_to_markdown(pdf_path: str, output_path: str = None, logger: logging.Logger = None) -> bool:
    """
    格式保持版PDF转Markdown转换
    
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
        logger.info(f"开始格式保持转换PDF文件: {pdf_path}")
        
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return False
        
        if output_path is None:
            pdf_name = Path(pdf_path).stem
            output_path = f"{pdf_name}_format_enhanced.md"
        
        doc = fitz.open(pdf_path)
        
        markdown_content = []
        markdown_content.append("# 银行一表通监管数据采集接口标准（2.0正式版）\n\n")
        markdown_content.append(f"*本文档由格式增强版转换器生成 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
        markdown_content.append("*✨ 此版本专注于保持原PDF的表格格式和布局结构*\n\n")
        markdown_content.append("---\n\n")
        
        total_pages = len(doc)
        logger.info(f"PDF总页数: {total_pages}")
        
        # 处理每一页
        for page_num in range(total_pages):
            if page_num % 25 == 0:
                progress = (page_num / total_pages) * 100
                logger.info(f"处理进度: {page_num + 1}/{total_pages} 页 ({progress:.1f}%)")
            
            page = doc[page_num]
            
            # 添加页面标题
            markdown_content.append(f"\n## 第 {page_num + 1} 页\n\n")
            
            # 获取页面文本，保持格式
            page_content = extract_page_with_format(page, page_num + 1, logger)
            markdown_content.append(page_content)
        
        # 合并所有内容
        final_content = "".join(markdown_content)
        
        # 保存到文件
        logger.info("正在保存格式增强文件...")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        doc.close()
        
        # 显示统计信息
        lines_count = len(final_content.split('\n'))
        chars_count = len(final_content)
        file_size = os.path.getsize(output_path)
        
        logger.info(f"格式增强转换完成!")
        logger.info(f"输出文件: {output_path}")
        logger.info(f"文件大小: {file_size:,} 字节")
        logger.info(f"统计信息: {lines_count:,} 行, {chars_count:,} 字符")
        
        return True
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False


def extract_page_with_format(page, page_num: int, logger: logging.Logger) -> str:
    """
    提取页面内容并保持格式
    
    Args:
        page: PDF页面对象
        page_num (int): 页面编号
        logger (logging.Logger): 日志记录器
    
    Returns:
        str: 格式化的页面内容
    """
    content = []
    
    try:
        # 尝试使用文本块方式提取
        text_dict = page.get_text("dict")
        blocks = text_dict.get("blocks", [])
        
        if blocks:
            formatted_blocks = process_text_blocks(blocks)
            content.append(formatted_blocks)
        else:
            # 回退到简单文本提取
            simple_text = page.get_text()
            if simple_text.strip():
                formatted_text = format_text_with_structure(simple_text)
                content.append(formatted_text)
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
        logger.warning(f"第{page_num}页处理出错，使用简单模式: {str(e)}")
        # 最简单的文本提取
        try:
            simple_text = page.get_text()
            if simple_text.strip():
                content.append(format_text_with_structure(simple_text))
            else:
                content.append("*[此页面处理失败]*\n\n")
        except:
            content.append("*[此页面无法读取]*\n\n")
    
    return "".join(content)


def process_text_blocks(blocks: List[Dict]) -> str:
    """
    处理文本块，保持布局结构
    
    Args:
        blocks (List[Dict]): 文本块列表
    
    Returns:
        str: 处理后的内容
    """
    content = []
    
    for block in blocks:
        if block.get("type") == 0:  # 文本块
            block_content = extract_block_content(block)
            if block_content:
                content.append(block_content)
    
    return "".join(content)


def extract_block_content(block: Dict) -> str:
    """
    提取单个文本块的内容
    
    Args:
        block (Dict): 文本块
    
    Returns:
        str: 提取的内容
    """
    lines_data = []
    
    for line in block.get("lines", []):
        line_text = ""
        spans = line.get("spans", [])
        
        for span in spans:
            text = span.get("text", "").strip()
            if text:
                # 检查字体属性
                font_size = span.get("size", 12)
                font_flags = span.get("flags", 0)
                
                # 根据字体属性添加格式
                if font_flags & (1 << 4):  # 粗体
                    text = f"**{text}**"
                if font_flags & (1 << 1):  # 斜体
                    text = f"*{text}*"
                
                line_text += text + " "
        
        line_text = line_text.strip()
        if line_text:
            # 保存行的位置信息
            bbox = line.get("bbox", [0, 0, 0, 0])
            lines_data.append({
                'text': line_text,
                'x': bbox[0],
                'y': bbox[1],
                'width': bbox[2] - bbox[0],
                'height': bbox[3] - bbox[1]
            })
    
    if not lines_data:
        return ""
    
    # 按y坐标排序，保持阅读顺序
    lines_data.sort(key=lambda x: x['y'])
    
    # 检测是否为表格结构
    if is_tabular_structure(lines_data):
        return format_as_table_structure(lines_data)
    else:
        return format_as_regular_text(lines_data)


def is_tabular_structure(lines_data: List[Dict]) -> bool:
    """
    检测是否为表格结构
    
    Args:
        lines_data (List[Dict]): 行数据列表
    
    Returns:
        bool: 是否为表格结构
    """
    if len(lines_data) < 3:
        return False
    
    # 收集x坐标位置
    x_positions = []
    for line in lines_data:
        text = line['text']
        # 检查是否包含多个由空格分隔的字段
        fields = re.split(r'\s{2,}', text.strip())
        if len(fields) >= 3:  # 至少3列
            x_positions.append(line['x'])
    
    # 如果多行都有相似的x坐标起始位置，可能是表格
    return len(x_positions) >= len(lines_data) * 0.6


def format_as_table_structure(lines_data: List[Dict]) -> str:
    """
    格式化为表格结构
    
    Args:
        lines_data (List[Dict]): 行数据列表
    
    Returns:
        str: 表格格式的内容
    """
    content = ["\n"]
    
    # 按行处理
    for i, line in enumerate(lines_data):
        text = line['text']
        
        # 尝试分割为列
        fields = re.split(r'\s{2,}', text.strip())
        
        if len(fields) >= 3:
            # 构建表格行
            row = "| " + " | ".join(fields) + " |"
            content.append(row + "\n")
            
            # 在第一行后添加分隔符
            if i == 0:
                separator = "|" + "|".join([" --- " for _ in fields]) + "|"
                content.append(separator + "\n")
        else:
            # 不是标准表格行，作为普通文本处理
            formatted_line = format_text_line(text)
            content.append(formatted_line + "\n")
    
    content.append("\n")
    return "".join(content)


def format_as_regular_text(lines_data: List[Dict]) -> str:
    """
    格式化为常规文本
    
    Args:
        lines_data (List[Dict]): 行数据列表
    
    Returns:
        str: 格式化的文本
    """
    content = []
    
    for line in lines_data:
        text = line['text']
        formatted_line = format_text_line(text)
        content.append(formatted_line + "\n")
    
    content.append("\n")
    return "".join(content)


def format_text_line(text: str) -> str:
    """
    格式化单行文本
    
    Args:
        text (str): 原始文本
    
    Returns:
        str: 格式化后的文本
    """
    # 检测各种文本模式
    if is_title_line(text):
        return format_title(text)
    elif is_table_header(text):
        return f"#### {text}"
    elif is_numbered_item(text):
        return f"- {text}"
    else:
        return text


def is_title_line(text: str) -> bool:
    """检测是否为标题行"""
    title_patterns = [
        r'^第[一二三四五六七八九十\d]+[章节条部分]',
        r'^[一二三四五六七八九十]+[、．]',
        r'^\([一二三四五六七八九十]+\)',
        r'^表\d+[\.\s]',
        r'^附件',
        r'^说明',
        r'^备注',
        r'^注[：:]',
    ]
    
    return any(re.match(pattern, text.strip()) for pattern in title_patterns)


def format_title(text: str) -> str:
    """格式化标题"""
    text = text.strip()
    if re.match(r'^第[一二三四五六七八九十\d]+[章节条部分]', text):
        return f"## {text}"
    elif re.match(r'^[一二三四五六七八九十]+[、．]', text):
        return f"### {text}"
    elif re.match(r'^\([一二三四五六七八九十]+\)', text):
        return f"#### {text}"
    elif re.match(r'^表\d+', text):
        return f"#### {text}"
    else:
        return f"**{text}**"


def is_table_header(text: str) -> bool:
    """检测是否为表格标题"""
    return bool(re.match(r'^表\d+', text.strip()))


def is_numbered_item(text: str) -> bool:
    """检测是否为编号项"""
    return bool(re.match(r'^\d+[\.\)]', text.strip()))


def format_text_with_structure(text: str) -> str:
    """
    使用结构化方法格式化文本
    
    Args:
        text (str): 原始文本
    
    Returns:
        str: 格式化后的文本
    """
    lines = text.split('\n')
    formatted_lines = []
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            formatted_lines.append('')
            i += 1
            continue
        
        # 检测表格区域
        table_region = detect_table_region(lines, i)
        if len(table_region) >= 3:  # 至少3行才认为是表格
            # 格式化表格
            table_content = format_table_region(table_region)
            formatted_lines.extend(table_content)
            i += len(table_region)
        else:
            # 格式化单行
            formatted_line = format_text_line(line)
            formatted_lines.append(formatted_line)
            i += 1
    
    return '\n'.join(formatted_lines) + '\n\n'


def detect_table_region(lines: List[str], start_idx: int) -> List[str]:
    """
    检测表格区域
    
    Args:
        lines (List[str]): 所有行
        start_idx (int): 开始索引
    
    Returns:
        List[str]: 表格行列表
    """
    table_lines = []
    i = start_idx
    
    while i < len(lines) and i < start_idx + 15:  # 最多检查15行
        line = lines[i].strip()
        
        if not line:
            if len(table_lines) >= 2:  # 如果已有足够表格行，空行结束表格
                break
            i += 1
            continue
        
        # 检查是否为表格行
        fields = re.split(r'\s{2,}', line)
        if len(fields) >= 3:  # 至少3个字段
            table_lines.append(line)
        elif len(table_lines) > 0:  # 如果已经在表格中，遇到非表格行就结束
            break
        else:  # 还没开始表格，继续查找
            break
        
        i += 1
    
    return table_lines


def format_table_region(table_lines: List[str]) -> List[str]:
    """
    格式化表格区域
    
    Args:
        table_lines (List[str]): 表格行
    
    Returns:
        List[str]: 格式化的Markdown表格
    """
    if not table_lines:
        return []
    
    formatted_table = ['']  # 开始时的空行
    
    for i, line in enumerate(table_lines):
        fields = re.split(r'\s{2,}', line.strip())
        
        # 构建表格行
        row = '| ' + ' | '.join(field.strip() for field in fields) + ' |'
        formatted_table.append(row)
        
        # 在第一行后添加分隔符
        if i == 0 and len(fields) > 1:
            separator = '|' + '|'.join([' --- ' for _ in fields]) + '|'
            formatted_table.append(separator)
    
    formatted_table.append('')  # 结束时的空行
    return formatted_table


def main():
    """主函数"""
    print("银行一表通监管数据采集接口标准PDF转Markdown工具")
    print("=" * 60)
    print("🎯 格式保持增强版 - 专注于保持表格和布局格式")
    print("=" * 60)
    
    # 设置日志
    logger = setup_logging()
    
    # 配置文件路径
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_format_enhanced.md"
    
    # 检查PDF文件是否存在
    if not os.path.exists(pdf_path):
        logger.error(f"PDF文件不存在: {pdf_path}")
        logger.info("请将PDF文件放在与程序相同的目录中")
        return 1
    
    logger.info(f"输入文件: {pdf_path}")
    logger.info(f"输出文件: {output_path}")
    
    # 执行转换
    try:
        if format_preserving_pdf_to_markdown(pdf_path, output_path, logger):
            logger.info("🎉 格式增强转换成功完成!")
            
            # 显示预览
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    preview_length = min(2000, len(content))
                    preview = content[:preview_length]
                    if len(content) > preview_length:
                        preview += "\n\n... (显示前2000字符)"
                    
                    print("\n" + "="*60)
                    print("📄 格式增强版文件预览:")
                    print("="*60)
                    print(preview)
                    
            except Exception as e:
                logger.warning(f"无法显示预览: {e}")
            
            return 0
        else:
            logger.error("❌ 格式增强转换失败!")
            return 1
            
    except KeyboardInterrupt:
        logger.info("⏹️ 用户中断转换")
        return 1
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())