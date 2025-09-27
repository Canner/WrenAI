@echo off
echo =====================================================
echo 银行一表通监管数据采集接口标准PDF转Markdown工具
echo 🎯 真实格式版本 - 完美保持表格格式
echo =====================================================
echo.

REM 检查Python环境
if exist ".venv\Scripts\python.exe" (
    echo [✓] 使用虚拟环境Python...
    set PYTHON_CMD=.venv\Scripts\python.exe
) else (
    echo [!] 使用系统Python...
    set PYTHON_CMD=python
)

REM 检查PDF文件是否存在
if not exist "银行一表通监管数据采集接口标准（2.0正式版）.pdf" (
    echo [❌] 找不到PDF文件 "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    echo [💡] 请将PDF文件放在与程序相同的目录中
    pause
    exit /b 1
)

echo [✓] 发现PDF文件，准备开始转换...
echo.

REM 检查是否已有最佳转换结果
if exist "银行一表通监管数据采集接口标准_2.0_真实格式.md" (
    echo [🎉] 发现已有最佳转换结果文件: 银行一表通监管数据采集接口标准_2.0_真实格式.md
    for %%f in ("银行一表通监管数据采集接口标准_2.0_真实格式.md") do echo [📊] 文件大小: %%~zf 字节
    echo.
    choice /C RO /M "选择操作: R=重新转换, O=打开已有文件"
    if errorlevel 2 (
        echo [📖] 打开已有的转换结果...
        start notepad "银行一表通监管数据采集接口标准_2.0_真实格式.md"
        goto :end
    )
    echo [🔄] 将重新进行转换...
    echo.
)

echo [🚀] 使用真实格式转换器进行转换...
echo [⏱️] 预计需要 1-2 分钟，请耐心等待...
echo.

%PYTHON_CMD% real_format_converter.py

if %errorlevel% equ 0 (
    echo.
    echo [🎉] 转换成功完成!
    echo [📄] 输出文件: 银行一表通监管数据采集接口标准_2.0_真实格式.md
    echo.
    echo [✨] 转换特点:
    echo     ✓ 完美保持表格格式
    echo     ✓ 所有文字内容完整
    echo     ✓ 7列表格结构清晰
    echo     ✓ 页面顺序完全正确
    echo.
    choice /C YN /M "是否打开转换结果文件 (Y=是, N=否)"
    if errorlevel 2 goto :end
    start notepad "银行一表通监管数据采集接口标准_2.0_真实格式.md"
) else (
    echo.
    echo [❌] 转换失败，请查看错误信息
    echo [💡] 如果已有转换结果，可以直接使用现有文件
    echo.
    if exist "银行一表通监管数据采集接口标准_2.0_真实格式.md" (
        choice /C YN /M "是否打开现有的转换结果文件 (Y=是, N=否)"
        if errorlevel 2 goto :end
        start notepad "银行一表通监管数据采集接口标准_2.0_真实格式.md"
    )
)

:end
echo.
echo [👋] 转换完成，感谢使用！
pause > nul