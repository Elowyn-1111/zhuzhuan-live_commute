# 阿里云部署交接

目标域名：zhuzhuan.com.cn。运行方式：Node.js 24、SQLite、服务器本地图片目录、Nginx HTTPS；不需要 Cloudflare、R2 或付费数据库。尚未购买服务器和执行公网部署。

## 购买
官方入口：https://www.aliyun.com/daily-act/ecs/activity_selection
选择轻量应用服务器，Linux Ubuntu 24.04，至少 2 核 2 GB、40 GB 磁盘，一年。优先上海或杭州。账号资格、库存、实际结算价及续费以购买页为准。不要自动续费或附加收费服务。域名已购买，年度预算要扣除域名费后再比较服务器价格。购买前核实该实例是否可用于备案；中国大陆服务器须备案完成后正式开放域名网站。

## 本地
Node.js 24 下运行 `npm run dev`，访问 http://localhost:8788。读取私有 .dev.vars，首次创建 .local-data/site.sqlite 并初始化上海示例数据。图片默认关闭。不要把本地测试数据库上传生产环境。

## 服务器准备与安装
在 Ubuntu 安装 Node.js 24、Nginx、Certbot，并核验 `node --version`。创建专用系统用户 zhuzhuan；网站包解压到 /opt/zhuzhuan/app，创建 /var/lib/zhuzhuan 并授予专用用户读写。根目录运行 `npm run check` 和 `npm test`（发布包不含测试时在上传前执行）。

复制 environment.example 为 /etc/zhuzhuan.env，只允许管理员读取（600），填入新的生产高德凭据。浏览器只收到 JS Key；安全密钥和 Web 服务 Key 留在服务器。不要把这个文件放进 public。高德 JS Key 域名白名单添加 zhuzhuan.com.cn；确认 Key 类型分别为 Web 端 JS API 和 Web 服务。

安装 zhuzhuan.service 到 /etc/systemd/system/，执行 systemctl daemon-reload 和 systemctl enable --now zhuzhuan。确认服务正常。只监听 127.0.0.1:8788，无需对公网开放此端口。防火墙仅放行网页 80/443 和限制来源的 SSH。

将域名 A 记录指向服务器公网 IPv4，不改动已有邮箱记录。备案完成后安装 nginx.conf，运行 nginx -t 并重载。运行 certbot --nginx -d zhuzhuan.com.cn 配置 HTTPS、检查续期。正式 APP_ORIGIN 必须为 HTTPS，最后验证安全 Cookie 和域名跳转。

## 管理、额度、备份
管理员需先正常注册，再由服务器管理员以 DATA_DIR=/var/lib/zhuzhuan 运行 `node server/admin.mjs 实际注册邮箱` 授权。邮箱注册本身不会授予管理员权限。
图片暂时关闭。开启时将 MEDIA_ENABLED=true 并重启服务。保留总量 1 GiB、上传和读取配额；接近磁盘额度或预算时设 false 并重启。管理员接口 /api/admin/media 列表、DELETE /api/admin/media/编码后的key 清理图片；通过已登录管理账号发起。
备份前停止服务，复制整个 /var/lib/zhuzhuan（SQLite、WAL、图片和元数据），加密保管后重新启动。恢复前停止服务，保存现状，再恢复完整目录和所有权，启动并检查账号、房源和图片。不要仅在运行时复制 SQLite 主文件。

## 待完成验收
服务器购买、实名与备案、SSH 接入、DNS、证书、公网双账号持久化和图片测试、大陆两种独立网络访问均未完成。不得把本地通过视为公网验收成功。示例租金和通勤时间不能当成已核验房源信息。


## 地铁版补充
普通用户免注册，访客Cookie绑定发布身份。服务器包须包含 server/metro-cities.json 与 metro-shanghai.json，其他城市首次读取高德线路并内存缓存。地铁时间、步行和骑行是距离估算。小区名称/地址/坐标来自高德，租金/户型/面积没有数据时为空。每站最多8页200条，不保证高德覆盖全部小区。杭州ECS试用可用于测试，但官方说明试用不满足备案资源要求，尚未正式公开部署。
