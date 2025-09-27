#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具（简化版）
使用marker-pdf包进行转换
"""

import os
import sys
from pathlib import Path
import logging

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)


def simple_convert():
    """简化的转换函数"""
    try:
        from marker import convert_single_pdf
        from marker.models import load_all_models
        
        pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
        output_path = "银行一表通监管数据采集接口标准_2.0.md"
        
        logger.info(f"开始转换: {pdf_path}")
        
        # 加载模型
        logger.info("加载模型中...")
        model_lst = load_all_models()
        
        # 转换
        logger.info("执行转换...")
        full_text, images, out_meta = convert_single_pdf(pdf_path, model_lst)
        
        # 保存结果
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(full_text)
        
        logger.info(f"转换完成，输出文件: {output_path}")
        return True
        
    except ImportError as e:
        logger.error(f"导入错误: {e}")
        logger.info("请确保已安装 marker-pdf: pip install marker-pdf")
        return False
    except Exception as e:
        logger.error(f"转换错误: {e}")
        return False


if __name__ == "__main__":
    if simple_convert():
        print("转换成功!")
    else:
        print("转换失败，请查看日志")
        sys.exit(1)