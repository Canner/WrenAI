# 银行一表通监管数据采集接口标准PDF转Markdown转换工具
# PowerShell版本

Write-Host "银行一表通监管数据采集接口标准PDF转Markdown转换工具" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green

# 设置错误处理
$ErrorActionPreference = "Continue"

# 切换到脚本目录
Set-Location $PSScriptRoot

# 检查Python环境
if (Test-Path ".venv\Scripts\python.exe") {
    Write-Host "使用虚拟环境Python..." -ForegroundColor Yellow
    $pythonCmd = ".venv\Scripts\python.exe"
} else {
    Write-Host "使用系统Python..." -ForegroundColor Yellow
    $pythonCmd = "python"
}

# 检查PDF文件是否存在
$pdfFile = "银行一表通监管数据采集接口标准（2.0正式版）.pdf"
if (!(Test-Path $pdfFile)) {
    Write-Host "错误: 找不到PDF文件 '$pdfFile'" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}

try {
    # 尝试运行完整版本
    Write-Host "尝试运行完整版转换程序..." -ForegroundColor Cyan
    & $pythonCmd "pdf_to_markdown.py"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "完整版本失败，尝试简化版本..." -ForegroundColor Yellow
        & $pythonCmd "simple_pdf_converter.py"
    }
    
    Write-Host "转换完成，请查看输出文件。" -ForegroundColor Green
    
} catch {
    Write-Host "执行过程中发生错误: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Read-Host "按任意键退出"
}