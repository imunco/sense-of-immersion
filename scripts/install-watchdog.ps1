# 注册 / 卸载「本地守夜人」计划任务。
#   安装： powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1
#   卸载： powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1 -Remove
#   查看： Get-ScheduledTask -TaskName yixian-archive-watchdog
#   日志： Get-Content .dsh-watchdog.log -Tail 20
param([switch]$Remove, [int]$Minutes = 15)

$ErrorActionPreference = 'Stop'
$TaskName = 'yixian-archive-watchdog'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已卸载计划任务 $TaskName" -ForegroundColor Green
  } else {
    Write-Host "没有找到计划任务 $TaskName" -ForegroundColor Yellow
  }
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'PATH 里找不到 node.exe'; exit 1 }

$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $Repo 'scripts\watchdog.mjs') + '"') -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "已注册计划任务 $TaskName：每 $Minutes 分钟跑一次 scripts\watchdog.mjs" -ForegroundColor Green
Write-Host "  仓库：$Repo"
Write-Host "  口令：读取 .dsh-passphrase.local（该文件已在 .gitignore 里）"
Write-Host "  卸载：powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1 -Remove"
