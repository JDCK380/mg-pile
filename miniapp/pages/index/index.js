// MG 私桩 · 主页。逻辑全部在 utils/controller.js，本页只负责输入与显示。
const PileController = require('../../utils/controller.js')
const realBle = require('../../utils/ble.js')
const mockBle = require('../../utils/mock-ble.js')

const ctl = PileController.shared()
let platform = ''
try { platform = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform } catch (e) {}

Page({
  data: Object.assign({
    form: Object.assign({}, ctl.form),
    isDevtools: platform === 'devtools',
    demo: false,
    showHelp: false,
    showImmediate: false
  }, ctl.state()),

  onLoad() {
    this.unsub = ctl.subscribe(s => {
      const patch = s
      // 断开或认证失效时关闭确认面板
      if (this.data.showImmediate && !s.canControl && !s.busy) patch.showImmediate = false
      this.setData(patch)
    })
  },
  onUnload() { if (this.unsub) this.unsub() },

  setForm(key, value) {
    ctl.form[key] = value
    this.setData({ [`form.${key}`]: value })
  },
  onPile(e) { ctl.form.pile = e.detail.value },
  onVin(e) {
    const v = e.detail.value.toUpperCase()
    ctl.form.vin = v
    return v
  },
  onConsent(e) { this.setForm('consent', e.detail.value) },
  onAll(e) { this.setForm('allDevices', e.detail.value) },
  onVolume(e) { this.setForm('volume', e.detail.value) },
  onBegin(e) { this.setForm('begin', e.detail.value) },
  onEnd(e) { this.setForm('end', e.detail.value) },
  onPoll(e) { ctl.setPolling(e.detail.value) },
  toggleHelp() { this.setData({ showHelp: !this.data.showHelp }) },

  onDemo(e) {
    try {
      ctl.setBle(e.detail.value ? mockBle : realBle)
      this.setData({ demo: e.detail.value })
      ctl.message(e.detail.value ? '已切换到模拟充电桩：结果仅用于检查界面流程' : '已切换回真实蓝牙')
    } catch (err) { ctl.fail(err); this.setData({ demo: !e.detail.value }) }
  },

  onDirect() { ctl.directConnect() },
  onPick() { ctl.startPick() },
  onChoose(e) { ctl.pick(e.currentTarget.dataset.id) },
  onCancelScan() { ctl.cancelScan() },
  onDisconnect() { ctl.disconnect() },

  onRead() { ctl.read() },
  onSync() { ctl.sync() },
  onAction(e) { ctl.action(e.currentTarget.dataset.name) },

  onImmediate() { if (this.data.canControl) this.setData({ showImmediate: true }) },
  onCancelImmediate() { this.setData({ showImmediate: false }) },
  onConfirmImmediate() { this.setData({ showImmediate: false }); ctl.confirmImmediate() },

  openLogs() { wx.navigateTo({ url: '/pages/logs/logs' }) },
  noop() {}
})
