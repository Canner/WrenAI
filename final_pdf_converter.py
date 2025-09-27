#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具 - 最终完整版
使用PyMuPDF (fitz) 进行PDF文本提取和格式化转换

作者: Claude AI Assistant
版本: 1.0
日期: 2024-09-27
"""

import fitz  # PyMuPDF
import os
import sys
import re
from pathlib import Path
import logging
from datetime import datetime


def setup_logging(output_dir: str = ".") -> logging.Logger:
    """设置日志配置"""
    log_filename = os.path.join(output_dir, "pdf_conversion.log")
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_filename, encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    return logging.getLogger(__name__)


def complete_pdf_to_markdown(pdf_path: str, output_path: str = None, logger: logging.Logger = None) -> bool:
    """
    完整的PDF转Markdown转换功能
    
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
        logger.info(f"开始处理PDF文件: {pdf_path}")
        
        # 检查PDF文件是否存在
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return False
        
        # 确定输出文件路径
        if output_path is None:
            pdf_name = Path(pdf_path).stem
            output_path = f"{pdf_name}_converted.md"
        
        # 打开PDF文件
        doc = fitz.open(pdf_path)
        
        # 准备Markdown内容
        markdown_content = []
        markdown_content.append("# 银行一表通监管数据采集接口标准（2.0正式版）\n\n")
        markdown_content.append(f"*本文档由 PyMuPDF 自动转换生成 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
        markdown_content.append("---\n\n")
        
        total_pages = len(doc)
        logger.info(f"PDF总页数: {total_pages}")
        
        # 处理每一页
        for page_num in range(total_pages):
            if page_num % 50 == 0:  # 每50页打印一次进度
                progress = (page_num / total_pages) * 100
                logger.info(f"处理进度: {page_num + 1}/{total_pages} 页 ({progress:.1f}%)")
            
            page = doc[page_num]
            
            # 添加页面标题
            markdown_content.append(f"\n## 第 {page_num + 1} 页\n\n")
            
            # 提取文本
            text = page.get_text()
            
            if text.strip():
                # 格式化文本
                formatted_text = format_text_for_markdown(text)
                markdown_content.append(formatted_text)
            else:
                # 如果没有文本，可能是图片页面
                markdown_content.append("*[此页面主要包含图片、图表或扫描内容]*\n\n")
            
            # 检查是否有图片
            images = page.get_images()
            if images:
                markdown_content.append(f"*注: 此页面包含 {len(images)} 张图片*\n\n")
        
        # 合并所有内容
        final_content = "".join(markdown_content)
        
        # 保存到文件
        logger.info("正在保存文件...")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)
        
        doc.close()
        
        # 显示统计信息
        lines_count = len(final_content.split('\n'))
        chars_count = len(final_content)
        words_count = len(final_content.split())
        file_size = os.path.getsize(output_path)
        
        logger.info(f"转换完成!")
        logger.info(f"输出文件: {output_path}")
        logger.info(f"文件大小: {file_size:,} 字节")
        logger.info(f"统计信息: {lines_count:,} 行, {chars_count:,} 字符, {words_count:,} 单词")
        
        return True
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False


def format_text_for_markdown(text: str) -> str:
    """
    格式化文本为Markdown格式
    
    Args:
        text (str): 原始文本
    
    Returns:
        str: 格式化后的Markdown文本
    """
    # 分割成行
    lines = text.split('\n')
    formatted_lines = []
    
    in_table = False
    
    for line in lines:
        line = line.strip()
        if not line:
            formatted_lines.append('')
            continue
        
        # 检测标题模式
        if is_likely_header(line):
            # 根据内容确定标题级别
            if re.match(r'^[一二三四五六七八九十]+[、．.]', line):
                formatted_lines.append(f"### {line}\n")
                in_table = False
            elif re.match(r'^第[一二三四五六七八九十\d]+[章节条部分]', line):
                formatted_lines.append(f"### {line}\n")
                in_table = False
            elif re.match(r'^\d+[\.\s]', line) and len(line) < 50:
                formatted_lines.append(f"#### {line}\n")
                in_table = False
            elif line.isupper() and len(line) < 30:
                formatted_lines.append(f"### {line}\n")
                in_table = False
            elif re.match(r'^表\d+', line):
                formatted_lines.append(f"#### {line}\n")
                in_table = False
            else:
                formatted_lines.append(f"**{line}**\n")
        else:
            # 普通文本，检测是否为表格行
            if detect_table_line(line):
                if not in_table:
                    # 如果这是表格的开始，添加表格标记
                    formatted_lines.append("")  # 空行
                    in_table = True
                formatted_lines.append(format_table_line(line))
            else:
                if in_table:
                    formatted_lines.append("")  # 表格结束后添加空行
                    in_table = False
                formatted_lines.append(line)
    
    return '\n'.join(formatted_lines) + '\n\n'


def is_likely_header(line: str) -> bool:
    """
    判断是否可能是标题
    
    Args:
        line (str): 文本行
    
    Returns:
        bool: 是否为标题
    """
    if len(line) > 100:  # 太长不太可能是标题
        return False
    
    # 标题模式
    title_patterns = [
        r'^[一二三四五六七八九十]+[、．.]',  # 中文数字开头
        r'^第[一二三四五六七八九十\d]+[章节条部分]',  # 章节标题
        r'^\d+[\.\s].{1,50}$',  # 数字开头的短行
        r'^[A-Z\s]{3,30}$',  # 全大写字母
        r'^表\d+[\.\s]',  # 表格标题
        r'^附件',  # 附件
        r'^说明',  # 说明
        r'^备注',  # 备注
        r'^注[：:]',  # 注释
    ]
    
    for pattern in title_patterns:
        if re.match(pattern, line):
            return True
    
    return False


def detect_table_line(line: str) -> bool:
    """
    检测是否为表格行
    
    Args:
        line (str): 文本行
    
    Returns:
        bool: 是否为表格行
    """
    # 简单检测：包含多个空格分隔的字段
    fields = line.split()
    return len(fields) >= 3 and ('  ' in line or '\t' in line)


def format_table_line(line: str) -> str:
    """
    格式化表格行
    
    Args:
        line (str): 原始表格行
    
    Returns:
        str: 格式化后的表格行
    """
    # 将多个空格或制表符替换为 | 分隔符
    table_line = re.sub(r'\s{2,}|\t+', ' | ', line.strip())
    if not table_line.startswith('|'):
        table_line = '| ' + table_line
    if not table_line.endswith('|'):
        table_line = table_line + ' |'
    return table_line


def main():
    """主函数"""
    print("银行一表通监管数据采集接口标准PDF转Markdown转换工具")
    print("=" * 60)
    print("使用 PyMuPDF 进行PDF文本提取和格式化")
    print("=" * 60)
    
    # 设置日志
    logger = setup_logging()
    
    # 配置文件路径
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_final.md"
    
    # 检查PDF文件是否存在
    if not os.path.exists(pdf_path):
        logger.error(f"PDF文件不存在: {pdf_path}")
        logger.info("请将PDF文件放在与程序相同的目录中")
        return 1
    
    logger.info(f"输入文件: {pdf_path}")
    logger.info(f"输出文件: {output_path}")
    
    # 执行转换
    try:
        if complete_pdf_to_markdown(pdf_path, output_path, logger):
            logger.info("转换成功完成!")
            
            # 显示简单预览
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    preview_length = min(1000, len(content))
                    preview = content[:preview_length]
                    if len(content) > preview_length:
                        preview += "\n\n... (文件太大，只显示前1000字符)"
                    
                    print("\n" + "="*50)
                    print("文件预览:")
                    print("="*50)
                    print(preview)
                    
            except Exception as e:
                logger.warning(f"无法显示预览: {e}")
            
            return 0
        else:
            logger.error("转换失败!")
            return 1
            
    except KeyboardInterrupt:
        logger.info("用户中断转换")
        return 1
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())