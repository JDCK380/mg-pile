# 验证记录 · 2026-10-05

- 浏览器本地页面运行成功；页面报告 Web Bluetooth 可用、安全上下文为是。
- 通过离线模拟操作验证：读取、开始、停止、灯光开启、音量 80、设置预约 23:00–07:00、关闭预约。模拟响应明确标识，未连接真实桩。
- `node tests/protocol.test.cjs` 通过：已知指令字节、所有分包边界、粘包、错误校验、噪声重同步、异常帧长度、响应长度、VIN 字符格式。
- `node tests/app.test.cjs` 通过：首次响应前禁用控制、VIN 不匹配之后继续禁用、后续通知不能清除失败、桩号不匹配、缺少 VIN 发送授权、模拟启停、断线取消。
- 未实桩验证，未验证任何副账号实际控制结果。
- 已尝试 Android Emulator 37.2.12，现有 AVD `Medium_Phone_API_37.0`。正常启动失败，原因是 `Android Emulator hypervisor driver is not installed on this machine`。软件模拟参数 `-accel off` 尝试后仍是 ADB offline，未能完成安卓浏览器验证。没有安装驱动或修改 Windows 虚拟化设置。

截图 `preview.png` 为离线模拟；“充电中”是模拟响应产生，不能作为实际充电证据。
