@echo off
echo =====================================================
echo 银行一表通监管数据采集接口标准PDF转Markdown工具
echo =====================================================
echo.

REM 检查Python环境
if exist ".venv\Scripts\python.exe" (
    echo [信息] 使用虚拟环境Python...
    set PYTHON_CMD=.venv\Scripts\python.exe
) else (
    echo [信息] 使用系统Python...
    set PYTHON_CMD=python
)

REM 检查PDF文件是否存在
if not exist "银行一表通监管数据采集接口标准（2.0正式版）.pdf" (
    echo [错误] 找不到PDF文件 "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
    echo [提示] 请将PDF文件放在与程序相同的目录中
    pause
    exit /b 1
)

echo [信息] 发现PDF文件，准备开始转换...
echo.

REM 检查是否已有转换结果
if exist "银行一表通监管数据采集接口标准_2.0_complete.md" (
    echo [提示] 发现已有转换结果文件: 银行一表通监管数据采集接口标准_2.0_complete.md
    choice /C YN /M "是否重新转换 (Y=是, N=打开已有文件)"
    if errorlevel 2 (
        echo [信息] 打开已有的转换结果...
        start notepad "银行一表通监管数据采集接口标准_2.0_complete.md"
        goto :end
    )
    echo [信息] 将重新进行转换...
    echo.
)

echo [信息] 使用最终完整版程序进行转换...
echo [信息] 这可能需要几分钟时间，请耐心等待...
echo.

%PYTHON_CMD% final_pdf_converter.py

if %errorlevel% equ 0 (
    echo.
    echo [成功] 转换完成!
    echo [信息] 输出文件: 银行一表通监管数据采集接口标准_2.0_final.md
    echo.
    choice /C YN /M "是否打开转换结果文件 (Y=是, N=否)"
    if errorlevel 2 goto :end
    start notepad "银行一表通监管数据采集接口标准_2.0_final.md"
) else (
    echo.
    echo [错误] 转换失败，请查看日志文件或手动运行程序
    echo [提示] 如果已有转换结果，可以直接使用: 银行一表通监管数据采集接口标准_2.0_complete.md
)

:end
echo.
echo 按任意键退出...
pause > nul