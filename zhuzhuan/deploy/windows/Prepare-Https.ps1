$ErrorActionPreference='Stop'
$siteRoot='C:\Zhuzhuan'
if(-not(Test-Path -LiteralPath "$siteRoot\app\server\main.mjs")){throw 'Install and test the website first.'}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$headers=@{'User-Agent'='Zhuzhuan-HTTPS-Setup';'Accept'='application/vnd.github+json'}
Write-Host '[1/3] Reading official Caddy release...'
$release=Invoke-RestMethod 'https://api.github.com/repos/caddyserver/caddy/releases/latest' -Headers $headers
$asset=$release.assets | Where-Object {$_.name -match '^caddy_.*_windows_amd64\.zip$'} | Select-Object -First 1
$checksumAsset=$release.assets | Where-Object {$_.name -match 'checksums\.txt$'} | Select-Object -First 1
if(-not $asset -or -not $checksumAsset){throw 'Official download/checksum not found'}
foreach($url in @($asset.browser_download_url,$checksumAsset.browser_download_url)){if(-not $url.StartsWith('https://github.com/caddyserver/caddy/releases/download/')){throw 'Unexpected download source'}}
New-Item -ItemType Directory -Path "$siteRoot\tools\caddy" -Force | Out-Null
$archivePath="$siteRoot\tools\caddy\$($asset.name)"
Write-Host '[2/3] Downloading and verifying Caddy...'
Invoke-WebRequest $asset.browser_download_url -OutFile $archivePath -UseBasicParsing
$checksums=(Invoke-WebRequest $checksumAsset.browser_download_url -UseBasicParsing).Content
$line=$checksums -split "`n" | Where-Object {$_ -match ('\s'+[regex]::Escape($asset.name)+'\s*$')} | Select-Object -First 1
if(-not $line){throw 'Checksum entry missing'}
if((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne ($line.Trim() -split '\s+')[0]){throw 'Checksum mismatch'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archivePath)
try{$entry=$zip.Entries | Where-Object {$_.FullName -eq 'caddy.exe'} | Select-Object -First 1;if(-not $entry){throw 'caddy.exe missing'};[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,"$siteRoot\tools\caddy\caddy.exe",$true)}finally{$zip.Dispose()}
Write-Host '[3/3] Checking HTTPS configuration...'
& "$siteRoot\tools\caddy\caddy.exe" version
& "$siteRoot\tools\caddy\caddy.exe" validate --config "$siteRoot\app\deploy\windows\Caddyfile" --adapter caddyfile
if($LASTEXITCODE -ne 0){throw 'HTTPS configuration validation failed'}
Write-Host 'HTTPS tools ready. No service or public port has been enabled. Finish ICP filing and DNS before Enable-Https.ps1.'
