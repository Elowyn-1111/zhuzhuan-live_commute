# Run as an administrator on the ECS server after foreground verification succeeds.
$ErrorActionPreference='Stop'
$siteRoot='C:\Zhuzhuan'
if(Get-ScheduledTask -TaskName 'ZhuzhuanWebsite' -ErrorAction SilentlyContinue){throw 'Task already exists; use task scheduler to inspect it before changing it.'}
if(-not(Test-Path -LiteralPath "$siteRoot\tools\node.exe")){throw 'Initialize the website first'}
& icacls.exe "$siteRoot\app" /grant '*S-1-5-19:(OI)(CI)RX' /T | Out-Null
& icacls.exe "$siteRoot\tools" /grant '*S-1-5-19:(OI)(CI)RX' /T | Out-Null
& icacls.exe "$siteRoot\data" /grant '*S-1-5-19:(OI)(CI)M' /T | Out-Null
& icacls.exe "$siteRoot\logs" /grant '*S-1-5-19:(OI)(CI)M' /T | Out-Null
& icacls.exe "$siteRoot\config" /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)R' /T | Out-Null
$action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument '-NoProfile -NonInteractive -File C:\Zhuzhuan\app\deploy\windows\Start-Website.ps1'
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'ZhuzhuanWebsite' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName 'ZhuzhuanWebsite'
Write-Host 'Website task started, listening only on localhost. Check logs and http://localhost:8788 on this server.'
