#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具 - 格式增强版
专注于保持原PDF的格式和布局结构

作者: Claude AI Assistant
版本: 2.0 (格式增强版)
日期: 2024-09-27
"""

import fitz  # PyMuPDF
import os
import sys
import re
from pathlib import Path
import logging
from datetime import datetime
from typing import List, Tuple, Dict, Any


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


def enhanced_pdf_to_markdown(pdf_path: str, output_path: str = None, logger: logging.Logger = None) -> bool:
    """
    增强版PDF转Markdown转换，专注于格式保持
    
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
        logger.info(f"开始增强格式转换PDF文件: {pdf_path}")
        
        # 检查PDF文件是否存在
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return False
        
        # 确定输出文件路径
        if output_path is None:
            pdf_name = Path(pdf_path).stem
            output_path = f"{pdf_name}_enhanced.md"
        
        # 打开PDF文件
        doc = fitz.open(pdf_path)
        
        # 准备Markdown内容
        markdown_content = []
        markdown_content.append("# 银行一表通监管数据采集接口标准（2.0正式版）\n\n")
        markdown_content.append(f"*本文档由 PyMuPDF 增强格式转换生成 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
        markdown_content.append("*注意：本版本专注于保持原PDF的格式和布局结构*\n\n")
        markdown_content.append("---\n\n")
        
        total_pages = len(doc)
        logger.info(f"PDF总页数: {total_pages}")
        
        # 处理每一页
        for page_num in range(total_pages):
            if page_num % 25 == 0:  # 每25页打印一次进度
                progress = (page_num / total_pages) * 100
                logger.info(f"处理进度: {page_num + 1}/{total_pages} 页 ({progress:.1f}%)")
            
            page = doc[page_num]
            
            # 添加页面标题
            markdown_content.append(f"\n## 第 {page_num + 1} 页\n\n")
            
            # 获取页面的块结构（更好的布局保持）
            blocks = get_page_blocks(page)
            
            if blocks:
                formatted_content = format_blocks_to_markdown(blocks, page_num + 1)
                markdown_content.append(formatted_content)
            else:
                # 如果无法获取块结构，回退到文本提取
                text = page.get_text()
                if text.strip():
                    formatted_text = enhanced_format_text(text)
                    markdown_content.append(formatted_text)
                else:
                    markdown_content.append("*[此页面主要包含图片、图表或扫描内容]*\n\n")
            
            # 检查图片和表格
            images = page.get_images()
            tables = page.find_tables()
            
            if images:
                markdown_content.append(f"*📷 此页面包含 {len(images)} 张图片*\n\n")
            
            if tables:
                markdown_content.append(f"*📊 此页面包含 {len(tables)} 个表格*\n\n")
                # 尝试提取表格内容
                table_content = extract_tables(tables)
                if table_content:
                    markdown_content.append(table_content)
        
        # 合并所有内容
        final_content = "".join(markdown_content)
        
        # 保存到文件
        logger.info("正在保存增强格式文件...")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        doc.close()
        
        # 显示统计信息
        lines_count = len(final_content.split('\n'))
        chars_count = len(final_content)
        file_size = os.path.getsize(output_path)
        
        logger.info(f"增强格式转换完成!")
        logger.info(f"输出文件: {output_path}")
        logger.info(f"文件大小: {file_size:,} 字节")
        logger.info(f"统计信息: {lines_count:,} 行, {chars_count:,} 字符")
        
        return True
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False


def get_page_blocks(page) -> List[Dict]:
    """
    获取页面的文本块，保持更好的布局结构
    
    Args:
        page: PDF页面对象
    
    Returns:
        List[Dict]: 文本块列表
    """
    try:
        # 使用字典格式获取文本块，包含位置信息
        blocks = page.get_text("dict")
        return blocks.get("blocks", [])
    except:
        return []


def extract_tables(tables) -> str:
    """
    提取表格内容为Markdown格式
    
    Args:
        tables: 表格列表
    
    Returns:
        str: Markdown格式的表格内容
    """
    table_content = []
    
    for i, table in enumerate(tables):
        try:
            table_content.append(f"\n### 表格 {i + 1}\n\n")
            
            # 提取表格数据
            df = table.to_pandas()
            
            if not df.empty:
                # 转换为Markdown表格格式
                markdown_table = df.to_markdown(index=False)
                table_content.append(markdown_table + "\n\n")
            else:
                table_content.append("*[表格内容无法提取]*\n\n")
                
        except Exception as e:
            table_content.append(f"*[表格 {i + 1} 处理错误: {str(e)}]*\n\n")
    
    return "".join(table_content) if table_content else ""


def format_blocks_to_markdown(blocks: List[Dict], page_num: int) -> str:
    """
    将文本块格式化为Markdown，保持原有布局
    
    Args:
        blocks (List[Dict]): 文本块列表
        page_num (int): 页面编号
    
    Returns:
        str: 格式化后的Markdown内容
    """
    content = []
    table_rows = []  # 收集可能的表格行
    current_table = []
    
    for block in blocks:
        if block.get("type") == 0:  # 文本块
            lines = []
            
            for line in block.get("lines", []):
                line_text = ""
                line_bbox = line.get("bbox", [0, 0, 0, 0])
                
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if text:
                        # 检查字体信息来判断格式
                        font_size = span.get("size", 12)
                        font_flags = span.get("flags", 0)
                        
                        # 根据字体属性添加格式
                        if font_flags & 2**4:  # 粗体
                            text = f"**{text}**"
                        if font_flags & 2**1:  # 斜体
                            text = f"*{text}*"
                        
                        line_text += text + " "
                
                line_text = line_text.strip()
                if line_text:
                    lines.append({
                        'text': line_text,
                        'bbox': line_bbox,
                        'y': line_bbox[1]  # y坐标，用于排序
                    })
            
            # 按y坐标排序保持阅读顺序
            lines.sort(key=lambda x: x['y'])
            
            # 检查是否为表格内容
            if is_table_content(lines):
                current_table.extend(lines)
            else:
                # 如果之前在收集表格，现在结束表格
                if current_table:
                    table_md = format_table_lines(current_table)
                    content.append(table_md)
                    current_table = []
                
                # 处理普通文本
                for line in lines:
                    text = line['text']
                    formatted_text = format_single_line(text)
                    content.append(formatted_text + "\n")
    
    # 处理剩余的表格内容
    if current_table:
        table_md = format_table_lines(current_table)
        content.append(table_md)
    
    return "".join(content) + "\n"


def is_table_content(lines: List[Dict]) -> bool:
    """
    判断文本行是否为表格内容
    
    Args:
        lines (List[Dict]): 文本行列表
    
    Returns:
        bool: 是否为表格内容
    """
    if len(lines) < 2:
        return False
    
    # 检查是否有规律的列结构
    tab_positions = set()
    for line in lines:
        bbox = line['bbox']
        tab_positions.add(round(bbox[0], 0))  # x坐标
    
    # 如果有3个或更多固定的列位置，可能是表格
    return len(tab_positions) >= 3


def format_table_lines(lines: List[Dict]) -> str:
    """
    将表格行格式化为Markdown表格
    
    Args:
        lines (List[Dict]): 表格行列表
    
    Returns:
        str: Markdown表格
    """
    if not lines:
        return ""
    
    # 按y坐标分组为行
    y_groups = {}
    for line in lines:
        y = round(line['y'], 1)
        if y not in y_groups:
            y_groups[y] = []
        y_groups[y].append(line)
    
    # 按y坐标排序
    sorted_rows = sorted(y_groups.items())
    
    table_content = ["\n"]
    
    for i, (y, row_lines) in enumerate(sorted_rows):
        # 按x坐标排序同一行的文本
        row_lines.sort(key=lambda x: x['bbox'][0])
        
        # 构建表格行
        row_text = "| " + " | ".join([line['text'] for line in row_lines]) + " |"
        table_content.append(row_text + "\n")
        
        # 在第一行后添加分隔符
        if i == 0:
            separator = "|" + "|".join([" --- " for _ in row_lines]) + "|"
            table_content.append(separator + "\n")
    
    table_content.append("\n")
    return "".join(table_content)


def format_single_line(text: str) -> str:
    """
    格式化单行文本
    
    Args:
        text (str): 原始文本
    
    Returns:
        str: 格式化后的文本
    """
    # 检测标题
    if is_header_line(text):
        return format_as_header(text)
    
    # 检测列表项
    if is_list_item(text):
        return format_as_list(text)
    
    return text


def is_header_line(text: str) -> bool:
    """检测是否为标题行"""
    patterns = [
        r'^第[一二三四五六七八九十\d]+[章节条部分]',
        r'^[一二三四五六七八九十]+[、．]',
        r'^\([一二三四五六七八九十]+\)',
        r'^表\d+[\.\s]',
        r'^附件',
        r'^说明',
        r'^备注',
    ]
    
    for pattern in patterns:
        if re.match(pattern, text):
            return True
    
    return False


def format_as_header(text: str) -> str:
    """将文本格式化为标题"""
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


def is_list_item(text: str) -> bool:
    """检测是否为列表项"""
    return bool(re.match(r'^\d+[\.\)]', text) or text.strip().startswith('•'))


def format_as_list(text: str) -> str:
    """将文本格式化为列表"""
    if re.match(r'^\d+[\.\)]', text):
        return f"- {text}"
    return f"- {text}"


def enhanced_format_text(text: str) -> str:
    """
    增强版文本格式化
    
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
        
        # 尝试检测表格区域
        table_lines = detect_table_region(lines, i)
        if table_lines:
            # 格式化表格
            table_md = format_detected_table(table_lines)
            formatted_lines.extend(table_md)
            i += len(table_lines)
        else:
            # 格式化单行
            formatted_line = format_single_line(line)
            formatted_lines.append(formatted_line)
            i += 1
    
    return '\n'.join(formatted_lines) + '\n\n'


def detect_table_region(lines: List[str], start_idx: int) -> List[str]:
    """
    检测从指定位置开始的表格区域
    
    Args:
        lines (List[str]): 所有行
        start_idx (int): 开始检测的索引
    
    Returns:
        List[str]: 表格行列表，如果不是表格则返回空列表
    """
    table_lines = []
    i = start_idx
    
    while i < len(lines) and i < start_idx + 20:  # 最多检查20行
        line = lines[i].strip()
        
        if not line:
            if table_lines:  # 如果已经有表格内容，空行可能是表格结束
                break
            i += 1
            continue
        
        # 检查是否看起来像表格行（多个字段用空格分隔）
        fields = re.split(r'\s{2,}', line)  # 两个或更多空格作为分隔符
        
        if len(fields) >= 3:  # 至少3个字段
            table_lines.append(line)
        else:
            break
        
        i += 1
    
    # 如果找到的表格行少于2行，不认为是表格
    return table_lines if len(table_lines) >= 2 else []


def format_detected_table(table_lines: List[str]) -> List[str]:
    """
    格式化检测到的表格行
    
    Args:
        table_lines (List[str]): 表格行列表
    
    Returns:
        List[str]: 格式化后的Markdown表格行
    """
    formatted_table = ['\n']
    
    for i, line in enumerate(table_lines):
        # 分割字段（使用2个或更多空格作为分隔符）
        fields = re.split(r'\s{2,}', line.strip())
        
        # 构建表格行
        row = '| ' + ' | '.join(fields) + ' |'
        formatted_table.append(row)
        
        # 在第一行后添加分隔符
        if i == 0:
            separator = '|' + '|'.join([' --- ' for _ in fields]) + '|'
            formatted_table.append(separator)
    
    formatted_table.append('\n')
    return formatted_table


def main():
    """主函数"""
    print("银行一表通监管数据采集接口标准PDF转Markdown工具 - 格式增强版")
    print("=" * 70)
    print("专注于保持原PDF的格式和布局结构")
    print("=" * 70)
    
    # 设置日志
    logger = setup_logging()
    
    # 配置文件路径
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_enhanced.md"
    
    # 检查PDF文件是否存在
    if not os.path.exists(pdf_path):
        logger.error(f"PDF文件不存在: {pdf_path}")
        logger.info("请将PDF文件放在与程序相同的目录中")
        return 1
    
    logger.info(f"输入文件: {pdf_path}")
    logger.info(f"输出文件: {output_path}")
    
    # 执行转换
    try:
        if enhanced_pdf_to_markdown(pdf_path, output_path, logger):
            logger.info("格式增强转换成功完成!")
            
            # 显示简单预览
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    preview_length = min(1500, len(content))
                    preview = content[:preview_length]
                    if len(content) > preview_length:
                        preview += "\n\n... (文件太大，只显示前1500字符)"
                    
                    print("\n" + "="*60)
                    print("增强格式文件预览:")
                    print("="*60)
                    print(preview)
                    
            except Exception as e:
                logger.warning(f"无法显示预览: {e}")
            
            return 0
        else:
            logger.error("格式增强转换失败!")
            return 1
            
    except KeyboardInterrupt:
        logger.info("用户中断转换")
        return 1
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())