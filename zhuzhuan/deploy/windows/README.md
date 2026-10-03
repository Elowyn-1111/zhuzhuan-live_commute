# 当前 ECS：Windows Server 2022

公网 IP：115.29.231.19；私网 IP：172.28.215.89；杭州。此部署分为服务器内测试和备案后公开两步，不使用 Ubuntu/systemd/Nginx 安装步骤。

## 服务器内测试
1. 在阿里云控制台使用远程连接进入服务器，或使用你自己的远程桌面。密码由你自己在官方登录界面输入，不发到聊天中。不要把3389开放给所有IP。
2. 将 zhuzhuan-aliyun.zip 复制到服务器桌面，打开管理员 PowerShell，将包内 deploy/windows 文件取出到临时工作目录，执行 `Initialize-Windows.ps1 -PackagePath 包的完整路径`。脚本下载官方 Node.js 24 LTS 并核验官方 SHA256，准备 C:\Zhuzhuan。不会修改防火墙、DNS、购买资源或清空旧站。
3. 在服务器本机编辑 C:\Zhuzhuan\config\server.env，填入高德凭据。测试使用 localhost 对应 JS Key，Web 服务 Key 在服务器读取。图片暂不开启。该文件不可传给其他人，也不放入 public。
4. 运行 C:\Zhuzhuan\app\deploy\windows\Start-Website.ps1；在服务器浏览器打开 http://localhost:8788。日志在 C:\Zhuzhuan\logs。验证城市、地铁、查询、发布、收藏及刷新。
5. 前台测试通过后停止该前台进程，再运行 Register-Task.ps1，使网站在系统启动时自动运行。任务以权限较低的 Local Service 运行，数据保存在 C:\Zhuzhuan\data，不删除数据即可保留内容。

## 正式 HTTPS 网站
杭州属中国内地，备案完成后再正式开放。官方说明当前免费ECS试用不满足备案要求，先核验转包年包月的费用和备案资格，未经确认不产生费用。
备案完成后，将 A 记录解析到115.29.231.19，仅开放80/443网页端口。安装官方 Caddy（https://caddyserver.com/download），依据官方 Windows 服务说明运行 deploy/windows/Caddyfile；Caddy自动申请、续期HTTPS证书。不要开放8788。
正式 server.env 改为 NODE_ENV=production、APP_ORIGIN=https://zhuzhuan.com.cn、TRUST_PROXY=true，更换为正式域名白名单的JS Key。重启网站任务后检查HTTPS及Cookie。
Windows Server防火墙与阿里云安全组均需核对，仅在准备好正式发布时调整80/443。远程桌面端口始终限制来源，不在脚本中自动扩大访问。

## 数据和维护
任务调度器停止 ZhuzhuanWebsite 后，备份整个 data 目录（SQLite、WAL及图片），然后重新启动任务。恢复时先停任务并保留旧数据，恢复完整目录及Local Service读写权限再启动。保管加密备份。关闭图片：server.env 将MEDIA_ENABLED=false后重启任务。检查试用余额、试用结束日期及流量，免费额度耗尽后可能产生按量费用。

目前脚本只在本机完成语法检查；尚未在115.29.231.19执行，不能视为已部署。公网验收和两种大陆网络验证仍待进行。
