# HTTPS准备与正式上线

当前用户已在Windows ECS完成内测。域名尚未备案、解析，因此还没有公开网址。杭州实例的网站须先完成ICP备案；HTTPS不是备案替代方案。免费ECS试用不满足备案资源要求，先在阿里云备案流程核验该实例或转换方案价格，未确认预算不购买。

## 更新页面
把最新版zip复制到服务器C:\Deploy\zhuzhuan-aliyun.zip。可以使用包内deploy/windows/Update-Website.ps1（单独解压到C:\Deploy，然后在管理员PowerShell运行 `& 'C:\Deploy\Update-Website.ps1' -PackagePath 'C:\Deploy\zhuzhuan-aliyun.zip'`），它会备份应用和已停机数据，再更新应用并保留配置。前台网站仍在运行时，先按Ctrl+C。也可以手动更新：停止当前网站（前台启动按Ctrl+C；自动任务则在管理员PowerShell运行Stop-ScheduledTask -TaskName ZhuzhuanWebsite）。确认8788不再监听后，备份C:\Zhuzhuan\app和data。解压新包到临时目录，将public、functions、server、deploy、scripts、tests及schema.sql、seed.sql、package.json覆盖到app。保留config、data、tools。重新启动原网站即可，Node和私有配置不必重装。

## 可以现在做：准备工具
管理员PowerShell：
```powershell
& 'C:\Zhuzhuan\app\deploy\windows\Prepare-Https.ps1'
```
下载Caddy官方发布包、核验SHA256、检查配置，不启动公网服务，也不改变防火墙。网络下载失败会显示错误，勿关闭窗口。

## 备案与DNS
进入 https://beian.aliyun.com/ 登录本人的阿里云账号，选择网站备案，核验域名实名与服务器资源资格，按本人实际情况提交材料。不要在聊天发送证件或付款信息。获取审批结果后再公开。
在阿里云域名DNS控制台为主机记录@添加A记录，值115.29.231.19。不修改邮箱MX或其他已有记录；本方案暂不配置www，也不添加AAAA。
在ECS安全组仅为网页开放TCP80/443，远程桌面来源仍限制，8788保持不公开。实际Windows防火墙规则由下面启用脚本添加。

## 备案和解析完成后
服务器记事本中编辑私有config/server.env，仅修改：
```
NODE_ENV=production
APP_ORIGIN=https://zhuzhuan.com.cn
TRUST_PROXY=true
HOST=127.0.0.1
```
高德平台正式JS Key白名单添加域名（当前地铁线图主要用Web服务Key），其他凭据不发聊天。
停止前台进程；若还未安装自动启动任务，运行Register-Task.ps1。已安装则Stop-ScheduledTask、Start-ScheduledTask重启ZhuzhuanWebsite。检查8788只监听127.0.0.1。
```powershell
& 'C:\Zhuzhuan\app\deploy\windows\Enable-Https.ps1' -IcpConfirmed
```
该参数仅在真实备案审批完成后使用。脚本检查DNS、生产配置和端口，创建Caddy自动启动服务及Windows80/443规则；证书由Caddy自动申请、续期。不会购买付费证书或开通其他收费服务。

## 验证与恢复
在另一台设备访问https://zhuzhuan.com.cn，确认无证书警告，HTTP跳转HTTPS，城市/站点/地标查询、免注册发布、收藏和刷新持久化正常。再用两种独立大陆网络测试，图片仍默认关闭。
安装失败时查看Get-Service ZhuzhuanHttps，以及C:\Zhuzhuan\logs中的Caddy日志。不要忽略证书警告。
需要退回内测时：Stop-Service ZhuzhuanHttps，停止网站任务，把私有配置恢复development、http://localhost:8788、TRUST_PROXY=false，重启网站任务。保留数据目录。HTTPS配置更新用caddy reload，不重复创建服务。

目前脚本仅本机语法验证，尚未在服务器运行；备案、DNS、证书和公网验收均未完成。
