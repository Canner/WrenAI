#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
银行一表通监管数据采集接口标准PDF转Markdown工具
使用marker-pdf包进行转换
"""

import os
import sys
from pathlib import Path
import logging
from marker import convert_single_pdf
from marker.models import load_all_models

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('pdf_conversion.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


def convert_pdf_to_markdown(pdf_path: str, output_path: str = None) -> str:
    """
    将PDF文件转换为Markdown格式
    
    Args:
        pdf_path (str): PDF文件路径
        output_path (str): 输出Markdown文件路径，如果为None则自动生成
    
    Returns:
        str: 转换后的Markdown内容
    """
    try:
        # 检查PDF文件是否存在
        pdf_file = Path(pdf_path)
        if not pdf_file.exists():
            raise FileNotFoundError(f"PDF文件不存在: {pdf_path}")
        
        logger.info(f"开始转换PDF文件: {pdf_path}")
        
        # 加载模型
        logger.info("正在加载marker-pdf模型...")
        model_lst = load_all_models()
        
        # 转换PDF
        logger.info("正在转换PDF为Markdown...")
        full_text, images, out_meta = convert_single_pdf(
            pdf_path,
            model_lst,
            max_pages=None,  # 转换所有页面
            langs=["Chinese", "English"],  # 支持中英文
            batch_multiplier=2
        )
        
        # 确定输出文件路径
        if output_path is None:
            output_path = pdf_file.stem + ".md"
        
        output_file = Path(output_path)
        
        # 保存Markdown文件
        logger.info(f"正在保存Markdown文件: {output_file}")
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(full_text)
        
        # 保存图片（如果有）
        if images:
            images_dir = output_file.parent / f"{output_file.stem}_images"
            images_dir.mkdir(exist_ok=True)
            
            for i, (image_filename, image_data) in enumerate(images.items()):
                image_path = images_dir / f"image_{i+1}.png"
                with open(image_path, 'wb') as img_file:
                    img_file.write(image_data)
                logger.info(f"保存图片: {image_path}")
        
        # 保存元数据
        metadata_file = output_file.parent / f"{output_file.stem}_metadata.json"
        import json
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(out_meta, f, ensure_ascii=False, indent=2)
        
        logger.info(f"转换完成! 输出文件: {output_file}")
        logger.info(f"元数据文件: {metadata_file}")
        if images:
            logger.info(f"图片保存在: {images_dir}")
        
        return full_text
        
    except Exception as e:
        logger.error(f"转换过程中发生错误: {str(e)}")
        raise


def main():
    """主函数"""
    # PDF文件路径
    pdf_path = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    
    # 输出文件路径
    output_path = "银行一表通监管数据采集接口标准_2.0.md"
    
    try:
        # 检查文件是否存在
        if not os.path.exists(pdf_path):
            logger.error(f"PDF文件不存在: {pdf_path}")
            return 1
        
        logger.info("开始PDF转Markdown转换...")
        logger.info(f"输入文件: {pdf_path}")
        logger.info(f"输出文件: {output_path}")
        
        # 执行转换
        markdown_content = convert_pdf_to_markdown(pdf_path, output_path)
        
        # 显示转换统计信息
        lines_count = len(markdown_content.split('\n'))
        chars_count = len(markdown_content)
        logger.info(f"转换统计: {lines_count} 行, {chars_count} 字符")
        
        logger.info("转换完成!")
        return 0
        
    except KeyboardInterrupt:
        logger.info("用户中断转换")
        return 1
    except Exception as e:
        logger.error(f"程序执行失败: {str(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())