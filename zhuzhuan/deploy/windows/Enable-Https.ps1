param([switch]$IcpConfirmed)
$ErrorActionPreference='Stop'
if(-not $IcpConfirmed){throw 'Finish ICP filing first; run with -IcpConfirmed only after approval.'}
$siteRoot='C:\Zhuzhuan';$domain='zhuzhuan.com.cn';$expectedIp='115.29.231.19'
$ips=@(Resolve-DnsName $domain -Type A -ErrorAction Stop | Where-Object {$_.Type -eq 'A'} | Select-Object -ExpandProperty IPAddress)
if($ips.Count -ne 1 -or $ips[0] -ne $expectedIp){throw 'Domain A record must resolve only to 115.29.231.19'}
$ipv6=@(Resolve-DnsName $domain -Type AAAA -ErrorAction SilentlyContinue | Where-Object {$_.Type -eq 'AAAA'})
if($ipv6.Count){throw 'IPv6 DNS is present. Verify/remove the website AAAA record before continuing; this server uses IPv4.'}
if(-not(Test-Path -LiteralPath "$siteRoot\tools\caddy\caddy.exe")){throw 'Run Prepare-Https.ps1 first'}
foreach($port in @(80,443)){if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw "Port $port is occupied. Inspect the existing service before proceeding."}}
if(Get-Service -Name ZhuzhuanHttps -ErrorAction SilentlyContinue){throw 'HTTPS service already exists; inspect it rather than replacing it.'}
$configPath="$siteRoot\config\server.env"
$settings=@{};foreach($line in Get-Content -LiteralPath $configPath){if($line -match '^([A-Z_0-9]+)=(.*)$'){$settings[$Matches[1]]=$Matches[2]}}
if($settings['NODE_ENV'] -ne 'production' -or $settings['APP_ORIGIN'] -ne 'https://zhuzhuan.com.cn' -or $settings['TRUST_PROXY'] -ne 'true'){throw 'Set production origin and trusted local proxy in private server.env, then restart the website task.'}
if(-not(Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue)){throw 'Start the website task first'}
& "$siteRoot\tools\caddy\caddy.exe" validate --config "$siteRoot\app\deploy\windows\Caddyfile" --adapter caddyfile
if($LASTEXITCODE -ne 0){throw 'Invalid Caddy configuration'}
foreach($port in @(80,443)){
 $name="Zhuzhuan-Web-$port"
 if(-not(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)){New-NetFirewallRule -Name $name -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null}
}
$binary='"C:\Zhuzhuan\tools\caddy\caddy.exe" run --config "C:\Zhuzhuan\app\deploy\windows\Caddyfile" --adapter caddyfile'
& sc.exe create ZhuzhuanHttps start= auto binPath= $binary
if($LASTEXITCODE -ne 0){throw 'HTTPS service creation failed'}
Start-Service -Name ZhuzhuanHttps
Write-Host 'HTTPS service started. Caddy will request the certificate. ECS security group must allow TCP 80/443; never open 8788.'
Write-Host 'Verify https://zhuzhuan.com.cn from another device; certificate readiness is not yet confirmed.'
