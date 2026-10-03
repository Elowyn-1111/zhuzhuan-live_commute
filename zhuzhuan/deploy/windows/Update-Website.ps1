param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$siteRoot='C:\Zhuzhuan'
$package=(Resolve-Path -LiteralPath $PackagePath).Path
if(-not(Test-Path -LiteralPath "$siteRoot\app\server\main.mjs")){throw 'Initialize the website first'}
$task=Get-ScheduledTask -TaskName ZhuzhuanWebsite -ErrorAction SilentlyContinue
$wasRunning=$task -and $task.State -eq 'Running'
if($wasRunning){Stop-ScheduledTask -TaskName ZhuzhuanWebsite;Start-Sleep -Seconds 2}
if(Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue){throw 'Stop the foreground website with Ctrl+C, then run this updater again.'}
New-Item -ItemType Directory -Path "$siteRoot\backups" -Force | Out-Null
$stamp=Get-Date -Format yyyyMMdd-HHmmss
Compress-Archive -Path "$siteRoot\app\*" -DestinationPath "$siteRoot\backups\app-$stamp.zip"
if(Get-ChildItem -LiteralPath "$siteRoot\data" -ErrorAction SilentlyContinue){Compress-Archive -Path "$siteRoot\data\*" -DestinationPath "$siteRoot\backups\data-$stamp.zip"}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($package)
try{foreach($entry in $zip.Entries){$target=[IO.Path]::GetFullPath([IO.Path]::Combine("$siteRoot\app",$entry.FullName));if(-not $target.StartsWith("$siteRoot\app\",[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe archive entry'}}}finally{$zip.Dispose()}
Expand-Archive -LiteralPath $package -DestinationPath "$siteRoot\app" -Force
Write-Host 'Website updated. Existing data, tools and private config were preserved; backups are in C:\Zhuzhuan\backups.'
if($wasRunning){Start-ScheduledTask -TaskName ZhuzhuanWebsite;Write-Host 'Website task restarted.'}else{Write-Host 'Run Start-Website.ps1 to resume foreground testing.'}
