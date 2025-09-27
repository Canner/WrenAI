#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具（传统方案）
使用PyMuPDF (fitz) 进行基础PDF文本提取和转换
"""

import fitz  # PyMuPDF
import os
import sys
import re
from pathlib import Path
import logging

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)


def extract_text_with_pymupdf(pdf_path: str, output_path: str) -> bool:
    """使用PyMuPDF提取PDF文本并转换为Markdown"""
    try:
        logger.info(f"开始处理PDF文件: {pdf_path}")
        
        # 打开PDF文件
        doc = fitz.open(pdf_path)
        
        markdown_content = []
        markdown_content.append("# 银行一表通监管数据采集接口标准（2.0正式版）\n\n")
        
        total_pages = len(doc)
        logger.info(f"PDF总页数: {total_pages}")
        
        for page_num in range(total_pages):
            logger.info(f"处理第 {page_num + 1}/{total_pages} 页")
            
            page = doc[page_num]
            
            # 添加页面分隔符
            if page_num > 0:
                markdown_content.append(f"\n\n---\n**第 {page_num + 1} 页**\n\n")
            
            # 提取文本
            text = page.get_text()
            
            if text.strip():
                # 基本的文本清理和格式化
                cleaned_text = clean_and_format_text(text)
                markdown_content.append(cleaned_text)
            else:
                # 如果没有文本，尝试OCR或者标记为图片页面
                markdown_content.append("*[此页面主要包含图片或表格内容]*\n\n")
            
            # 提取图片
            images = page.get_images()
            if images:
                markdown_content.append(f"*此页面包含 {len(images)} 张图片*\n\n")
        
        # 合并所有内容
        final_content = "".join(markdown_content)
        
        # 保存到文件
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        doc.close()
        
        # 显示统计信息
        lines_count = len(final_content.split('\n'))
        chars_count = len(final_content)
        logger.info(f"转换完成!")
        logger.info(f"输出文件: {output_path}")
        logger.info(f"统计信息: {lines_count} 行, {chars_count} 字符")
        
        return True
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        return False


def clean_and_format_text(text: str) -> str:
    """清理和格式化文本"""
    # 移除多余的空白字符
    text = re.sub(r'\n\s*\n\s*\n', '\n\n', text)
    
    # 检测标题（通常是短行且可能包含数字）
    lines = text.split('\n')
    formatted_lines = []
    
    for line in lines:
        line = line.strip()
        if not line:
            formatted_lines.append('')
            continue
            
        # 检测可能的标题（短行，包含数字或特殊格式）
        if (len(line) < 50 and 
            (re.match(r'^\d+[\.\s]', line) or  # 数字开头
             re.match(r'^[一二三四五六七八九十]+[\.\s]', line) or  # 中文数字开头
             line.isupper() or  # 全大写
             re.match(r'^第[一二三四五六七八九十\d]+[章节条]', line))):  # 章节标题
            formatted_lines.append(f"## {line}\n")
        else:
            formatted_lines.append(line)
    
    # 重新组合文本
    formatted_text = '\n'.join(formatted_lines)
    
    # 处理表格格式（简单检测）
    formatted_text = format_simple_tables(formatted_text)
    
    return formatted_text + '\n\n'


def format_simple_tables(text: str) -> str:
    """简单的表格格式化"""
    lines = text.split('\n')
    formatted_lines = []
    
    for line in lines:
        # 检测可能的表格行（包含多个制表符或空格分隔的内容）
        if '\t' in line or (len(line.split()) > 3 and '  ' in line):
            # 将制表符和多个空格替换为 | 分隔符
            table_line = re.sub(r'\s{2,}|\t+', ' | ', line.strip())
            if not table_line.startswith('|'):
                table_line = '| ' + table_line
            if not table_line.endswith('|'):
                table_line = table_line + ' |'
            formatted_lines.append(table_line)
        else:
            formatted_lines.append(line)
    
    return '\n'.join(formatted_lines)


def main():
    """主函数"""
    logger.info("银行一表通监管数据采集接口标准PDF转Markdown转换工具（传统方案）")
    logger.info("=" * 70)
    
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_traditional.md"
    
    # 检查PDF文件是否存在
    if not os.path.exists(pdf_path):
        logger.error(f"PDF文件不存在: {pdf_path}")
        return 1
    
    # 执行转换
    if extract_text_with_pymupdf(pdf_path, output_path):
        logger.info("转换成功完成!")
        
        # 显示文件预览
        try:
            with open(output_path, 'r', encoding='utf-8') as f:
                content = f.read()
                preview = content[:1000] + "..." if len(content) > 1000 else content
                logger.info("文件预览:")
                logger.info("-" * 50)
                print(preview)
        except Exception as e:
            logger.warning(f"无法显示预览: {e}")
            
        return 0
    else:
        logger.error("转换失败!")
        return 1


if __name__ == "__main__":
    sys.exit(main())