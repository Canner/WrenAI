#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具（命令行版）
使用marker-pdf的命令行接口进行转换
"""

import os
import sys
import subprocess
from pathlib import Path
import logging

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)


def run_marker_cli():
    """使用marker命令行工具进行转换"""
    try:
        pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
        output_path = "银行一表通监管数据采集接口标准_2.0.md"
        
        # 检查PDF文件是否存在
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return False
        
        # 检查是否在虚拟环境中
        if os.path.exists(".venv/Scripts/marker_single.exe"):
            marker_cmd = ".venv/Scripts/marker_single.exe"
        else:
            marker_cmd = "marker_single"
        
        # 构建命令
        cmd = [
            marker_cmd,
            pdf_path,
            output_path,
            "--renderer", "markdown"
        ]
        
        logger.info(f"开始转换: {pdf_path}")
        logger.info(f"使用命令: {' '.join(cmd)}")
        
        # 执行转换
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8'
        )
        
        if process.returncode == 0:
            logger.info(f"转换成功! 输出文件: {output_path}")
            
            # 检查输出文件是否存在
            if os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                logger.info(f"输出文件大小: {file_size} 字节")
                
                # 显示前几行内容作为预览
                try:
                    with open(output_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        lines = content.split('\n')
                        logger.info(f"转换完成，共 {len(lines)} 行")
                        
                        # 显示前几行作为预览
                        preview_lines = min(10, len(lines))
                        logger.info("文件预览（前10行）：")
                        for i, line in enumerate(lines[:preview_lines], 1):
                            logger.info(f"{i:2d}: {line[:100]}...")
                            
                except Exception as e:
                    logger.warning(f"无法读取输出文件预览: {e}")
            
            return True
        else:
            logger.error(f"转换失败，返回代码: {process.returncode}")
            if process.stderr:
                logger.error(f"错误输出: {process.stderr}")
            if process.stdout:
                logger.info(f"标准输出: {process.stdout}")
            return False
            
    except FileNotFoundError:
        logger.error("marker_single命令未找到，请确保marker-pdf已正确安装")
        return False
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        return False


if __name__ == "__main__":
    logger.info("银行一表通监管数据采集接口标准PDF转Markdown转换工具（命令行版）")
    logger.info("=" * 60)
    
    if run_marker_cli():
        logger.info("转换完成!")
        sys.exit(0)
    else:
        logger.error("转换失败!")
        sys.exit(1)