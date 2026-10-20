// MG 私桩小程序：本地 BLE 直连安悦私桩，不登录账号、不访问网络。
const PileController = require('./utils/controller.js')

App({
  onHide() {
    // 与安卓版一致：进入后台时断开蓝牙；断开蓝牙不等于停止充电
    const ctl = PileController.shared()
    if (ctl.scanning) ctl.cancelScan()
    if (ctl.connected || ctl.device) { ctl.disconnect(); ctl.message('小程序进入后台，蓝牙连接已关闭；回到前台后请重新连接') }
  }
})
