$ErrorActionPreference='Stop'
$siteRoot='C:\Zhuzhuan'
foreach($line in Get-Content -LiteralPath "$siteRoot\config\server.env"){
 if($line -match '^([A-Z_0-9]+)=(.*)$'){[Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process')}
}
if($env:AMAP_REST_KEY -eq 'replace-locally'){throw 'Fill the map credentials in the private server.env first'}
Set-Location -LiteralPath "$siteRoot\app"
$logPath="$siteRoot\logs\website-$(Get-Date -Format yyyy-MM-dd).log"
& "$siteRoot\tools\node.exe" 'server/main.mjs' 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
exit $LASTEXITCODE
