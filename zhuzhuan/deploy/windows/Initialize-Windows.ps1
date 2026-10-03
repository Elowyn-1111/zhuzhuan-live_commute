param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$siteRoot='C:\Zhuzhuan'
$resolvedPackage=(Resolve-Path -LiteralPath $PackagePath).Path
Write-Host '[1/5] Checking package and preparing folders...'
if(Test-Path -LiteralPath "$siteRoot\app\server\main.mjs"){Write-Host 'Existing app detected. It will be backed up before updating; data and config are preserved.'}
foreach($dir in @('app','tools','data','config','logs')){New-Item -ItemType Directory -Path "$siteRoot\$dir" -Force | Out-Null}
# Validate every archive entry before extracting to the explicitly named site directory.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($resolvedPackage)
try{foreach($entry in $archive.Entries){$target=[IO.Path]::GetFullPath([IO.Path]::Combine("$siteRoot\app",$entry.FullName));if(-not $target.StartsWith("$siteRoot\app\",[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe archive entry'}}}finally{$archive.Dispose()}
if(Test-Path -LiteralPath "$siteRoot\app\server\main.mjs"){
 New-Item -ItemType Directory -Path "$siteRoot\backups" -Force | Out-Null
 Compress-Archive -Path "$siteRoot\app\*" -DestinationPath "$siteRoot\backups\app-$(Get-Date -Format yyyyMMdd-HHmmss).zip"
}
Write-Host '[2/5] Extracting website package...'
Expand-Archive -LiteralPath $resolvedPackage -DestinationPath "$siteRoot\app" -Force
Write-Host '[3/5] Downloading official Node.js release (may take several minutes)...' 
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$releases=Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$release=$releases | Where-Object { $_.version -match '^v24\.' -and $_.lts } | Select-Object -First 1
if(-not $release){throw 'No Node.js 24 LTS release found'}
$nodeArchive="node-$($release.version)-win-x64.zip"
$download="$siteRoot\tools\$nodeArchive"
Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/$nodeArchive" -OutFile $download -UseBasicParsing
Write-Host '[4/5] Verifying download checksum...'
$sums=(Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt" -UseBasicParsing).Content
$line=$sums -split "`n" | Where-Object { $_ -match ('\s'+[regex]::Escape($nodeArchive)+'\s*$') } | Select-Object -First 1
if(-not $line){throw 'Official checksum missing'}
$expected=($line.Trim() -split '\s+')[0]
if((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $expected){throw 'Node.js checksum mismatch'}
Expand-Archive -LiteralPath $download -DestinationPath "$siteRoot\tools" -Force
Copy-Item -LiteralPath "$siteRoot\tools\node-$($release.version)-win-x64\node.exe" -Destination "$siteRoot\tools\node.exe"
Write-Host '[5/5] Preparing private configuration...'
if(-not(Test-Path -LiteralPath "$siteRoot\config\server.env")){Copy-Item -LiteralPath "$siteRoot\app\deploy\windows\environment.example" -Destination "$siteRoot\config\server.env"}
& "$siteRoot\tools\node.exe" --version
Write-Host 'Prepared C:\Zhuzhuan. Edit config\server.env locally; do not share its contents.'
Write-Host 'No public port, paid resource, remote access or DNS setting has been changed.'
