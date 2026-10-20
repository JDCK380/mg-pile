# Android 版

系统 WebView 显示 `web/` 的界面，蓝牙走 Android 原生 GATT（`MainActivity.java`），由 `native-ble.js` 把原生桥接成网页版使用的 Web Bluetooth 接口。最低 Android 8.0，无 INTERNET 权限。

## 构建

标准 Gradle 工程（AGP 8.12，纯 Java，无第三方依赖），用 Android Studio 打开**仓库根目录**即可，模块名 `app`，源码在 `android/`。

- Android Studio：打开仓库根目录 → 等待 Gradle 同步（首次会下载 Gradle 和 Android Gradle Plugin，缺少 SDK 平台时按提示安装）→ 右侧 Gradle 面板 `app › Tasks › build › assembleRelease`。
- 命令行：`./gradlew assembleRelease`（Windows：`gradlew.bat assembleRelease`），需要 JDK 17+ 和 Android SDK（`ANDROID_HOME` 或 `local.properties` 中的 `sdk.dir`）。

输出：`android/build/outputs/apk/release/MG-Pile-<版本>.apk`。

构建时 `web-assets.gradle` 会把 `web/` 的界面渲染成 APK 内的 `assets/index.html`，并注入 `native-ble.js`。改界面只需要改 `web/`。

## 签名

Android 只允许用同一证书签名的 APK 互相覆盖安装。

- 复制 `keystore.properties.example` 为 `keystore.properties`（已被 `.gitignore` 忽略）并填写自己的证书；也可以用环境变量 `MGPILE_KEYSTORE`、`MGPILE_STORE_PASS`、`MGPILE_KEY_ALIAS`、`MGPILE_KEY_PASS`。配置后 debug 和 release 都用这把证书签名。
- 两者都没有时，release 使用本机的 Android 调试证书，只适合测试。
- 证书文件**不要提交到仓库**：拿到它的人可以签出能覆盖安装你应用的 APK。
- GitHub Actions 发布版本使用仓库 Secrets 中的证书，配置方法见根目录 README。

## 行为说明

- 默认扫描列表只显示 `AYXXARM269XXXXX`（X 为数字或字母），可切换“搜索全部蓝牙设备”；“按编号连接”会扫描完整名称并自动连接，15 秒未找到即提示。
- 连接后请求 MTU 100，串行处理 CCCD 订阅和写入，等待 GATT 回调；订阅完成后自动读取系统信息。
- 应用切到后台时自动断开蓝牙；**断开蓝牙不等于停止充电**。
- Android 11 及以下扫描 BLE 需要位置权限和系统定位开关（平台要求）。
- 日志通过系统文件保存器导出；VIN 发送内容不写入日志。
