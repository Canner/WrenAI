#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简洁的PDF转Markdown转换器
专注于准确提取和格式化，避免重复处理
作者: SOLO Coding
版本: 3.0 (简洁版)
"""

import fitz  # PyMuPDF
import re
import os
from typing import List, Dict, Optional
from tabulate import tabulate
import logging

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class SimplePDFConverter:
    """
    简洁的PDF转Markdown转换器
    
    设计原则:
    1. 简单直接的文本提取
    2. 清晰的表格识别
    3. 最小化重复处理
    4. 保持内容完整性
    """
    
    def __init__(self, pdf_path: str):
        """初始化转换器"""
        self.pdf_path = pdf_path
        self.doc = None
        
    def __enter__(self):
        """上下文管理器入口"""
        self._load_pdf()
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        if self.doc:
            self.doc.close()
    
    def _load_pdf(self) -> None:
        """加载PDF文件"""
        if not os.path.exists(self.pdf_path):
            raise FileNotFoundError(f"PDF文件不存在: {self.pdf_path}")
            
        try:
            self.doc = fitz.open(self.pdf_path)
            logger.info(f"成功加载PDF文件: {self.pdf_path}, 总页数: {len(self.doc)}")
        except Exception as e:
            raise Exception(f"加载PDF文件失败: {e}")
    
    def _extract_page_text(self, page) -> str:
        """提取页面文本"""
        try:
            return page.get_text()
        except Exception as e:
            logger.error(f"提取页面文本失败: {e}")
            return ""
    
    def _extract_page_tables(self, page) -> List[List[List[str]]]:
        """提取页面表格"""
        tables = []
        try:
            # 使用PyMuPDF的表格提取功能
            found_tables = page.find_tables()
            for table in found_tables:
                try:
                    table_data = table.extract()
                    if self._is_valid_table(table_data):
                        cleaned_table = self._clean_table(table_data)
                        tables.append(cleaned_table)
                except Exception as e:
                    logger.warning(f"提取表格失败: {e}")
                    continue
        except Exception as e:
            logger.error(f"页面表格提取失败: {e}")
        
        return tables
    
    def _is_valid_table(self, table_data) -> bool:
        """检查表格是否有效"""
        if not table_data or len(table_data) < 2:
            return False
        
        # 检查是否有足够的非空单元格
        non_empty_cells = 0
        total_cells = 0
        
        for row in table_data:
            for cell in row:
                total_cells += 1
                if cell and str(cell).strip():
                    non_empty_cells += 1
        
        # 至少30%的单元格有内容
        return non_empty_cells > total_cells * 0.3
    
    def _clean_table(self, table_data) -> List[List[str]]:
        """清理表格数据"""
        cleaned = []
        for row in table_data:
            cleaned_row = []
            for cell in row:
                if cell is None:
                    cleaned_row.append("")
                else:
                    # 清理单元格内容
                    cleaned_cell = str(cell).strip().replace('\n', ' ')
                    cleaned_row.append(cleaned_cell)
            cleaned.append(cleaned_row)
        return cleaned
    
    def _format_table_as_markdown(self, table_data: List[List[str]]) -> str:
        """将表格格式化为Markdown"""
        if not table_data:
            return ""
        
        try:
            # 确保所有行有相同的列数
            max_cols = max(len(row) for row in table_data)
            normalized_table = []
            
            for row in table_data:
                normalized_row = row + [""] * (max_cols - len(row))
                normalized_table.append(normalized_row)
            
            # 使用tabulate生成Markdown表格
            if len(normalized_table) > 1:
                return tabulate(normalized_table[1:], headers=normalized_table[0], tablefmt="pipe")
            else:
                return tabulate(normalized_table, tablefmt="pipe")
                
        except Exception as e:
            logger.warning(f"表格格式化失败: {e}")
            return self._manual_format_table(table_data)
    
    def _manual_format_table(self, table_data: List[List[str]]) -> str:
        """手动格式化表格"""
        if not table_data:
            return ""
        
        lines = []
        
        # 表头
        if table_data:
            header = "| " + " | ".join(table_data[0]) + " |"
            lines.append(header)
            
            # 分隔线
            separator = "| " + " | ".join(["---"] * len(table_data[0])) + " |"
            lines.append(separator)
            
            # 数据行
            for row in table_data[1:]:
                data_row = "| " + " | ".join(row) + " |"
                lines.append(data_row)
        
        return "\n".join(lines)
    
    def _identify_headings(self, text: str) -> str:
        """识别并格式化标题"""
        lines = text.split('\n')
        formatted_lines = []
        
        for line in lines:
            line = line.strip()
            if not line:
                formatted_lines.append("")
                continue
            
            # 检查是否是标题
            if self._is_title(line):
                formatted_lines.append(f"# {line}")
            elif self._is_heading(line):
                formatted_lines.append(f"## {line}")
            elif self._is_subheading(line):
                formatted_lines.append(f"### {line}")
            else:
                formatted_lines.append(line)
        
        return "\n".join(formatted_lines)
    
    def _is_title(self, text: str) -> bool:
        """判断是否是主标题"""
        title_patterns = [
            r'^银行一表通.*标准.*$',
            r'^.*接口标准.*$',
        ]
        
        for pattern in title_patterns:
            if re.match(pattern, text, re.IGNORECASE):
                return True
        return False
    
    def _is_heading(self, text: str) -> bool:
        """判断是否是二级标题"""
        heading_patterns = [
            r'^\d+\s+.*$',  # 数字开头
            r'^第.*章.*$',   # 章节
            r'^附件.*$',     # 附件
        ]
        
        for pattern in heading_patterns:
            if re.match(pattern, text):
                return True
        return False
    
    def _is_subheading(self, text: str) -> bool:
        """判断是否是三级标题"""
        subheading_patterns = [
            r'^\d+\.\d+.*$',  # 1.1 格式
            r'^\(\d+\).*$',   # (1) 格式
        ]
        
        for pattern in subheading_patterns:
            if re.match(pattern, text):
                return True
        return False
    
    def _clean_text(self, text: str) -> str:
        """清理文本内容"""
        # 移除页码和页眉页脚
        lines = text.split('\n')
        cleaned_lines = []
        
        for line in lines:
            line = line.strip()
            
            # 跳过页码
            if re.match(r'^\s*\d+\s*$', line):
                continue
            
            # 跳过页眉页脚模式
            if re.match(r'^\s*第\s*\d+\s*页\s*$', line):
                continue
            
            # 跳过空行和分隔线
            if not line or re.match(r'^[-=_\s]+$', line):
                if cleaned_lines and cleaned_lines[-1] != "":
                    cleaned_lines.append("")
                continue
            
            cleaned_lines.append(line)
        
        # 移除末尾的空行
        while cleaned_lines and cleaned_lines[-1] == "":
            cleaned_lines.pop()
        
        return "\n".join(cleaned_lines)
    
    def _process_page(self, page_num: int) -> Dict:
        """处理单个页面"""
        try:
            page = self.doc[page_num]
            logger.info(f"处理第 {page_num + 1}/{len(self.doc)} 页")
            
            # 提取文本和表格
            text = self._extract_page_text(page)
            tables = self._extract_page_tables(page)
            
            return {
                'page_num': page_num + 1,
                'text': text,
                'tables': tables
            }
            
        except Exception as e:
            logger.error(f"处理第 {page_num + 1} 页失败: {e}")
            return {
                'page_num': page_num + 1,
                'text': f"<!-- 第 {page_num + 1} 页处理失败 -->",
                'tables': []
            }
    
    def convert_to_markdown(self, output_path: Optional[str] = None) -> str:
        """转换PDF为Markdown"""
        if not self.doc:
            raise ValueError("PDF文档未加载")
        
        logger.info("开始转换PDF到Markdown...")
        
        markdown_parts = []
        
        # 处理所有页面
        for page_num in range(len(self.doc)):
            page_data = self._process_page(page_num)
            
            # 处理文本
            if page_data['text']:
                cleaned_text = self._clean_text(page_data['text'])
                if cleaned_text:
                    formatted_text = self._identify_headings(cleaned_text)
                    markdown_parts.append(formatted_text)
            
            # 处理表格
            for table in page_data['tables']:
                table_markdown = self._format_table_as_markdown(table)
                if table_markdown:
                    markdown_parts.append("\n" + table_markdown + "\n")
        
        # 合并所有内容
        full_markdown = "\n\n".join(part for part in markdown_parts if part.strip())
        
        # 最终清理
        full_markdown = self._final_cleanup(full_markdown)
        
        # 保存文件
        if output_path:
            try:
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(full_markdown)
                logger.info(f"Markdown文件已保存到: {output_path}")
            except Exception as e:
                logger.error(f"保存文件失败: {e}")
        
        return full_markdown
    
    def _final_cleanup(self, markdown: str) -> str:
        """最终清理Markdown内容"""
        # 规范化换行符
        markdown = re.sub(r'\n{3,}', '\n\n', markdown)
        
        # 移除行首行尾空白
        lines = [line.rstrip() for line in markdown.split('\n')]
        
        # 移除重复的空行
        cleaned_lines = []
        prev_empty = False
        
        for line in lines:
            is_empty = line.strip() == ""
            
            if is_empty:
                if not prev_empty:
                    cleaned_lines.append(line)
            else:
                cleaned_lines.append(line)
            
            prev_empty = is_empty
        
        return '\n'.join(cleaned_lines)

def main():
    """主函数"""
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    output_path = "银行一表通监管数据采集接口标准_2.0_简洁版.md"
    
    try:
        with SimplePDFConverter(pdf_path) as converter:
            markdown_content = converter.convert_to_markdown(output_path)
            
            logger.info("\n=== 转换完成 ===")
            logger.info(f"输出文件: {output_path}")
            logger.info(f"总字符数: {len(markdown_content)}")
            
    except Exception as e:
        logger.error(f"转换失败: {e}")
        return False
    
    return True

if __name__ == "__main__":
    main()