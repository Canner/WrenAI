@echo off
echo 银行一表通监管数据采集接口标准PDF转Markdown转换工具
echo ================================================

REM 切换到脚本所在目录
cd /d "%~dp0"

REM 检查Python环境
if exist ".venv\Scripts\python.exe" (
    echo 使用虚拟环境Python...
    set PYTHON_CMD=.venv\Scripts\python.exe
) else (
    echo 使用系统Python...
    set PYTHON_CMD=python
)

REM 检查PDF文件是否存在
if not exist "银行一表通监管数据采集接口标准（2.0正式版）.pdf" (
    echo 错误: 找不到PDF文件 "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    pause
    exit /b 1
)

REM 尝试运行完整版本
echo 尝试运行完整版转换程序...
%PYTHON_CMD% pdf_to_markdown.py

REM 如果失败，尝试简化版本
if %errorlevel% neq 0 (
    echo.
    echo 完整版本失败，尝试简化版本...
    %PYTHON_CMD% simple_pdf_converter.py
)

echo.
echo 转换完成，请查看输出文件。
pause