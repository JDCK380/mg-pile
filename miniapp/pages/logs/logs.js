// 通信日志：查看、复制、导出、清空。VIN 发送内容在记录时已隐藏。
const PileController = require('../../utils/controller.js')
const ctl = PileController.shared()

Page({
  data: { text: '', count: 0, top: 0 },
  onLoad() {
    this.unsub = ctl.subscribe(() => {
      const text = ctl.logs.join('\n')
      if (text !== this.data.text) this.setData({ text, count: ctl.logs.length, top: ctl.logs.length * 40 + 100000 })
    })
  },
  onUnload() { if (this.unsub) this.unsub() },
  onCopy() {
    if (!ctl.logs.length) { wx.showToast({ title: '暂无日志', icon: 'none' }); return }
    wx.setClipboardData({ data: ctl.logs.join('\n') })
  },
  onExport() {
    if (!ctl.logs.length) { wx.showToast({ title: '暂无日志', icon: 'none' }); return }
    const path = `${wx.env.USER_DATA_PATH}/mg-pile-debug.log`
    try {
      wx.getFileSystemManager().writeFileSync(path, ctl.logs.join('\n'), 'utf8')
    } catch (e) { wx.showToast({ title: '写入失败', icon: 'none' }); return }
    if (typeof wx.shareFileMessage === 'function') {
      wx.shareFileMessage({ filePath: path, fileName: 'mg-pile-debug.log', fail: () => this.onCopy() })
    } else this.onCopy()
  },
  onClear() { ctl.clearLogs() }
})
