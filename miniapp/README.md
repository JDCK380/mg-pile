# SAIC私桩控制 · 微信小程序

> 正在等待微信审核，上线后可直接在微信搜索「SAIC私桩控制」使用。

由本仓库的网页版 / 安卓版移植。功能、安全门禁与安卓版一致：

- 搜索并选择（默认只显示 `AYXXARM269XXXXX`，可搜索全部）、按编号连接（15 秒未找到即提示）。
- 连接后请求 MTU 100（仅安卓），订阅 FFF4/FFF5/FFF9，自动读取系统信息并核对桩号。
- 桩端 FFF5 请求 VIN（0A）且已勾选授权时，经 FFF6 发送 VIN；55/54 后禁用控制直到重连。日志不记录 VIN。
- 开始/停止充电、立即充电（关闭预约→确认→启动→最多 5 次确认）、灯光、音量、预约、校时、5 秒轮询。
- 单指令等待响应、写入串行且间隔 ≥120ms、30 秒超时、不自动重发控制指令。
- 小程序进入后台时断开蓝牙（与安卓版一致）；断开蓝牙不等于停止充电。
- 通信日志页：复制、导出（聊天文件）、清空。不访问网络，不登录账号。

## 结构

| 文件 | 来源 |
|---|---|
| `utils/protocol.js` | `web/protocol.js`（ASCII 编解码替代 TextEncoder）+ `ScanRules.java` |
| `utils/ble.js` | 取代 `navigator.bluetooth` / `native-ble.js` / `MainActivity` GATT，基于 `wx.*BLE*` |
| `utils/controller.js` | `web/app.js` 的完整逻辑，与界面解耦 |
| `utils/mock-ble.js` | 仅在微信开发者工具中出现的模拟桩开关（`tests/mock-pile.js` 行为） |
| `pages/index` | 主界面（`web/template.html` 视觉） |
| `pages/logs` | 通信日志 |

## 调试

1. 微信开发者工具导入仓库的 `miniapp` 目录；`project.config.json` 中的 AppID 为 `touristappid`（游客模式，不能真机调试），请换成你自己的小程序 AppID。开发者工具无法连真实 BLE；页面顶部的“开发者工具模拟充电桩”开关可走完整流程（仅 devtools 显示，结果不代表实桩）。
2. 真机：工具栏“真机调试 / 预览”，用手机微信扫码。手机需开启蓝牙并允许微信使用蓝牙；安卓需位置权限与系统定位开关。
3. 发布前在小程序后台“用户隐私保护指引”中声明使用蓝牙，否则线上版本调用蓝牙会被拦截。
4. 单元测试（在仓库根目录）：
   `node tests/miniapp-protocol.test.cjs`、`node tests/miniapp-controller.test.cjs`、`node tests/miniapp-wx.test.cjs`

未实桩验证：iOS 上 deviceId 为系统 UUID 而非 MAC；广播名在部分手机上只出现在 localName 中，已兼容两者。
