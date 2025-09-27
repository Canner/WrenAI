#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析mapping.xlsx文件结构的脚本
"""

import pandas as pd
import os

def analyze_excel_file(file_path):
    """分析Excel文件的结构"""
    if not os.path.exists(file_path):
        print(f"文件不存在: {file_path}")
        return
    
    try:
        # 读取Excel文件的所有sheet名称
        xl_file = pd.ExcelFile(file_path)
        sheet_names = xl_file.sheet_names
        
        print(f"Excel文件: {file_path}")
        print(f"文件大小: {os.path.getsize(file_path) / 1024 / 1024:.2f} MB")
        print(f"Sheet总数: {len(sheet_names)}")
        print("\n" + "="*50)
        
        # 分析每个sheet
        for i, sheet_name in enumerate(sheet_names, 1):
            print(f"\n{i}. Sheet名称: '{sheet_name}'")
            
            try:
                # 读取sheet数据
                df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=5)  # 只读前5行来分析结构
                
                print(f"   行数(预览): {len(df)} (仅显示前5行)")
                print(f"   列数: {len(df.columns)}")
                print(f"   列名: {list(df.columns)}")
                
                # 显示前几行数据
                if len(df) > 0:
                    print("   前几行数据:")
                    for idx, row in df.head(3).iterrows():
                        print(f"     行{idx + 1}: {dict(row)}")
                
            except Exception as e:
                print(f"   读取sheet时出错: {str(e)}")
        
        print("\n" + "="*50)
        
    except Exception as e:
        print(f"读取Excel文件时出错: {str(e)}")

if __name__ == "__main__":
    analyze_excel_file("mapping.xlsx")