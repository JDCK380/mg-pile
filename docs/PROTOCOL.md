# MG Live 2.2.6 安悦私桩协议提取记录

为实现互通，从 MG Live 2.2.6 安卓客户端分析得到的协议说明；表中“源码”列指向该客户端混淆后的类名（`com.saicmotor.vehicle.charge.*`），仅作出处记录，本仓库不包含任何官方客户端代码或资源。适配范围未全部实桩确认。

| GATT UUID 后四位 | 原 App 行为 |
|---|---|
| FFF0 | 主服务 |
| FFF3 | 发送普通命令 |
| FFF4 | 订阅通知 |
| FFF5 | 订阅 VIN 认证通知 |
| FFF6 | 发送所选车辆 VIN 原始字节，无普通帧头 |
| FFF9 | 订阅通知 |

UUID 标准形式 `0000fff0-0000-1000-8000-00805f9b34fb`；其余替换 fff0。

普通帧：`68 CMD 00 00 LEN_LO LEN_HI 00 XOR PAYLOAD`。响应帧头 `AA`。有效帧各字节 XOR 总和为 0。长度小端，不含 8 字节头。

| 命令 | 负载 | 源码 |
|---|---|---|
| B0 校时 | uint32 Unix 秒，小端 | charge/b/a.java c() |
| B1 读系统信息 | 无 | charge/b/a.java a() |
| B2 音量 | 0–100 单字节 | charge/b/a.java a(int) |
| B3 预约 | 开关、开始时、开始分、结束时、结束分；关闭时全 0 | charge/b/a.java a(byte,int,int,int,int) |
| B4 开始 | 01 00 | charge/b/a.java a(byte), ChargeActivity.java:163 |
| B6 停止 | 00 | charge/b/a.java b() |
| A0 灯光 | 开=01 / 关=00，01，00 00 00 00 00 | charge/b/a.java a(byte,byte), ChargeActivity.java:339/347 |

部分已知完整请求：

```
系统信息 68 B1 00 00 00 00 00 D9
开始充电 68 B4 00 00 02 00 00 DF 01 00
停止充电 68 B6 00 00 01 00 00 DF 00
开启灯光 68 A0 00 00 07 00 00 CF 01 01 00 00 00 00 00
```

B1 响应字段，以负载首字节为偏移 0（对应整帧偏移需加 8）：

| 偏移 | 内容 | 来源 |
|---|---|---|
| 0–19 | 桩号字节数组 | charge/f/e.java |
| 41 | 灯光是否开启，01=开启 | charge/f/e.java g() |
| 46 | 预约模式，01=开启，00=关闭，09=未知/默认 | charge/f/e.java c(), ChargeActivity.java:779 |
| 47–50 | 开始时分、结束时分 | charge/f/e.java e() |
| 51 | 音量 | charge/f/e.java f() |
| 58 | 桩状态 | charge/f/e.java d() |

桩状态解释来源 ChargeActivity.java:814：06 充电中、00/02 未充电、08 充电完成、09 离线。其他状态保留数字，不猜测。

通用响应首个负载字节在原 App 里作为结果码；B4 的 0 仅表示开始指令已受理，原 App 还等待状态确认。调试页会再次读取 B1，并且不把 BLE 写入成功显示成充电成功。B6 原 App 未解析结果码，仅处理响应类型，本页同样以响应与随后 B1 为依据。

VIN 请求/失败处理来源：`charge/b/d/b.java:257` 与 `charge/g/e/c.java:461`。桩请求 `0A` 时，原 App 调用 `getSelectedVin().getBytes()` 写入 FFF6；`55` 不匹配，`54` 超时。没有修改 VIN、伪造认证响应或替换成其他车辆 VIN 的流程。

账号相关证据：`VehicleChargeService.java:271` 的入口要求 token；`PrivateChargeService.java` 查询功能码（添加桩 2-9-3-3-0、灯光 2-9-3-1-1、预约 2-9-3-1-2、音量 2-9-3-1-3、开始 2-9-3-1-4）。这不是对服务端权限实现的完整还原。

JADX 的原消息解析器出现变量还原不完整、分支不自然等情况，网页采用独立且有测试的长度/校验/重组实现，没有照抄反编译错误。
