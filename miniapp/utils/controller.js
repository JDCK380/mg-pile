/*
 * 充电桩控制逻辑，移植自 web/app.js（1.0.0）。
 * 与界面无关：页面通过 form 提供输入，通过 onChange(state) 接收状态。
 * 保留原有安全门禁：
 *  - 首次 B1 响应前禁用控制；桩号填写时必须匹配；
 *  - 仅在 FFF5 请求 0A 且已授权时发送 VIN；55/54 后持续禁用直到重连；
 *  - 单指令等待响应、写入串行且间隔 ≥120ms、30 秒超时、不自动重发控制指令；
 *  - 立即充电：关闭预约并确认后才启动，启动只发一次。
 */
'use strict'
const P = require('./protocol.js')
const realBle = require('./ble.js')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const pad = n => String(n).padStart(2, '0')
const timeStr = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }

const INITIAL_VIEW = {
  statusText: '尚未读取', authText: '未请求', extrasText: '—',
  deviceNameText: '未选择设备', scheduleText: '预约：尚未读取', lastReadText: '状态仅依据实际响应显示。'
}

class PileController {
  constructor(options = {}) {
    this.ble = options.ble || realBle
    this.form = { vin: '', pile: '', consent: false, allDevices: false, volume: 30, begin: '23:00', end: '07:00' }
    this.listeners = new Set()
    this.logs = []
    this.device = null; this.chars = {}; this.connected = false; this.busy = false; this.ready = false; this.authFailed = false
    this.epoch = 0; this.chain = Promise.resolve(); this.pending = null; this.pollTimer = null; this.polling = false
    this.parsers = {}; this.lastWrite = 0; this.lastInfo = null
    this.view = Object.assign({}, INITIAL_VIEW)
    this.messageText = ''
    this.scanning = false; this.scanList = []; this.scanTitle = ''; this.stopScan = null; this.scanTimer = null; this.scanMode = ''
    this.attach()
  }

  attach() {
    this.ble.onValue((deviceId, code, bytes) => {
      if (this.device && this.connected && deviceId === this.device.deviceId) this.receive(code, bytes)
    })
    this.ble.onDisconnect(deviceId => {
      if (this.device && deviceId === this.device.deviceId) { this.drop(); this.message('设备蓝牙已断开'); this.log('设备蓝牙已断开') }
    })
  }

  /** 切换蓝牙实现（开发者工具中的模拟桩）。仅在未连接时允许。 */
  setBle(ble) {
    if (this.connected || this.busy || this.scanning) throw Error('请先断开连接')
    this.ble.onValue(() => {}); this.ble.onDisconnect(() => {})
    this.ble = ble; this.attach(); this.refresh()
  }

  /* ---------- 状态输出 ---------- */
  subscribe(fn) { this.listeners.add(fn); fn(this.state()); return () => this.listeners.delete(fn) }
  state() {
    const c = this.connected, b = this.busy || this.scanning
    return Object.assign({}, this.view, {
      connected: c, busy: b, ready: this.ready, authFailed: this.authFailed, polling: this.polling,
      message: this.messageText, connectionText: c ? '蓝牙已连接' : '未连接',
      canConnect: !c && !b, canDisconnect: c,
      canQuery: c && !b && !this.authFailed,
      canControl: c && !b && this.ready && !this.authFailed,
      formLocked: c,
      scanning: this.scanning, scanList: this.scanList, scanTitle: this.scanTitle, scanMode: this.scanMode,
      logCount: this.logs.length
    })
  }
  refresh() { const s = this.state(); this.listeners.forEach(fn => fn(s)) }
  setView(patch) { Object.assign(this.view, patch); this.refresh() }
  log(s) { this.logs.push(`${timeStr()} ${s}`); if (this.logs.length > 1500) this.logs.shift(); this.refresh() }
  message(s) { this.messageText = s; this.refresh() }
  fail(e) { this.message((e && e.message) || String(e)); this.log(`ERROR ${(e && e.message) || e}`) }
  clearLogs() { this.logs = []; this.refresh() }

  /* ---------- 连接生命周期 ---------- */
  drop() {
    this.epoch++; this.connected = false; this.chars = {}; this.parsers = {}; this.ready = false; this.authFailed = false; this.busy = false
    clearInterval(this.pollTimer); this.pollTimer = null; this.polling = false
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(Error('连接已断开')); this.pending = null }
    this.chain = Promise.resolve(); this.lastWrite = 0; this.lastInfo = null
    this.view = Object.assign({}, INITIAL_VIEW)
    this.refresh()
  }
  disconnect() {
    const old = this.device; this.device = null; this.drop()
    if (old) this.ble.disconnect(old.deviceId)
    this.message('连接已断开'); this.log('断开连接')
  }

  receive(code, bytes) {
    this.log(`RX ${code.toUpperCase()} ${P.hex(bytes)}`)
    if (code === 'fff5') {
      if (bytes[0] === 0x0a) {
        this.ready = false; this.setView({ authText: '桩请求 VIN' })
        if (this.authFailed) { this.message('认证失败后请核对 VIN 并重新连接'); return }
        if (!this.form.consent) { this.blockAuth(Error('桩请求 VIN 认证；请断开，填写自己车辆 VIN 并勾选授权后重连')); return }
        try {
          const vin = P.vinBytes(this.form.vin), current = this.epoch
          this.setView({ authText: 'VIN 已提交，待验证' })
          this.write('fff6', vin, true).catch(e => { if (current === this.epoch) this.blockAuth(e) })
        } catch (e) { this.blockAuth(e) }
      } else if (bytes[0] === 0x55 || bytes[0] === 0x54) {
        this.authFailed = true; this.ready = false
        this.setView({ authText: bytes[0] === 0x55 ? 'VIN 不匹配' : '认证超时' })
        this.message('桩端拒绝认证，请核对绑定车辆的 VIN 后重连')
        if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(Error('桩端认证失败')); this.pending = null }
      }
      return
    }
    const parser = this.parsers[code] || (this.parsers[code] = new P.Parser())
    const result = parser.push(bytes)
    result.errors.forEach(e => this.log(e))
    for (const f of result.frames) {
      if (f.cmd === 0xb1) {
        try {
          const info = P.sysInfo(f.payload), expected = String(this.form.pile || '').trim()
          if (expected && info.pile.toUpperCase() !== expected.toUpperCase()) {
            this.ready = false; this.authFailed = true; this.refresh()
            throw Error(`桩号不匹配：返回 ${info.pile}，已禁用控制`)
          }
          this.lastInfo = info; this.ready = !this.authFailed
          const s = info.schedule
          this.setView({
            deviceNameText: `已读取桩号：${info.pile}`,
            statusText: P.statusText(info.status),
            extrasText: `${info.light ? '开' : '关'} / ${info.volume}`,
            scheduleText: `预约：${info.mode === 1 ? '已开启' : '未开启'} ${pad(s[0])}:${pad(s[1])}–${pad(s[2])}:${pad(s[3])}`,
            lastReadText: `桩端响应更新时间：${timeStr()}`
          })
        } catch (e) {
          this.fail(e)
          if (this.pending && this.pending.cmd === f.cmd) { const req = this.pending; this.pending = null; clearTimeout(req.timer); req.reject(e) }
          continue
        }
      }
      if (this.pending && this.pending.cmd === f.cmd) {
        const req = this.pending; this.pending = null; clearTimeout(req.timer)
        // 原 SyncTimeResponseMessage 不定义结果码；B0 负载首字节不能当作错误码
        if ([0xa0, 0xb2, 0xb3, 0xb4].includes(f.cmd) && (f.payload.length === 0 || f.payload[0] !== 0)) {
          req.reject(Error(`桩端${P.codes[f.cmd]}失败，返回 ${f.payload.length ? f.payload[0] : '空响应'}`))
        } else req.resolve(f)
      }
    }
  }

  blockAuth(e) {
    this.authFailed = true; this.ready = false; this.refresh(); this.fail(e)
    if (this.pending) { const req = this.pending; this.pending = null; clearTimeout(req.timer); req.reject(e) }
  }

  write(code, bytes, secret = false) {
    const current = this.epoch
    const task = async () => {
      if (current !== this.epoch || !this.connected) throw Error('连接已失效')
      if (this.authFailed) throw Error('桩端认证未通过')
      await sleep(Math.max(0, 120 - (Date.now() - this.lastWrite)))
      if (current !== this.epoch || !this.connected) throw Error('连接已失效')
      const c = this.chars[code]
      if (!c) throw Error(`设备缺少 ${code.toUpperCase()} 特征，无法操作`)
      this.log(secret ? 'TX REQUEST FFF6 <VIN 已隐藏>' : `TX REQUEST ${code.toUpperCase()} ${P.hex(bytes)}`)
      if (c.properties.write) await this.ble.write(this.device.deviceId, c, bytes, true)
      else if (c.properties.writeWithoutResponse) await this.ble.write(this.device.deviceId, c, bytes, false)
      else throw Error(`${code} 不支持写入`)
      this.lastWrite = Date.now()
      this.log(secret ? 'TX FFF6 <VIN 已隐藏>' : `TX ${code.toUpperCase()} ${P.hex(bytes)}`)
    }
    const work = this.chain.then(task)
    this.chain = work.catch(() => {})
    return work
  }

  request(bytes) {
    if (this.pending) return Promise.reject(Error('已有指令等待桩端响应'))
    return new Promise((resolve, reject) => {
      const req = {
        cmd: bytes[1], resolve, reject,
        timer: setTimeout(() => { if (this.pending === req) this.pending = null; reject(Error(`${P.codes[bytes[1]] || '指令'} 30 秒未响应；请读取状态确认，不自动重发控制指令`)) }, 30000)
      }
      this.pending = req
      this.write('fff3', bytes).catch(e => { if (this.pending === req) this.pending = null; clearTimeout(req.timer); reject(e) })
    })
  }

  async run(fn) {
    if (this.busy) return
    this.busy = true; this.refresh()
    try { await fn() } catch (e) { this.fail(e) } finally { this.busy = false; this.refresh() }
  }

  async control(bytes) {
    if (!this.ready || this.authFailed) throw Error('请先读取并核对桩端信息')
    await this.request(bytes)
    this.message(`${P.codes[bytes[1]]}响应已收到，正在重新读取状态`)
    await this.request(P.commands.info())
    this.message(`${P.codes[bytes[1]]}响应已收到，请以上方最新桩端状态为准`)
  }

  async immediateCharge() {
    if (!this.ready || this.authFailed) throw Error('请先读取并核对桩端信息')
    const session = this.epoch
    const ensure = () => { if (session !== this.epoch || !this.connected || this.authFailed) throw Error('连接或认证已失效，立即充电已停止') }
    this.message('正在读取当前桩端预约状态'); await this.request(P.commands.info()); ensure()
    if (this.lastInfo.status === 6) { this.message('桩端已报告充电中'); return }
    if (this.lastInfo.mode === 1) {
      this.message('正在关闭桩端预约'); await this.request(P.commands.reserve(false)); ensure(); await this.request(P.commands.info()); ensure()
      if (this.lastInfo.mode !== 0) throw Error('未确认桩端预约已关闭，未发送启动指令；请读取状态后重试')
    } else if (this.lastInfo.mode !== 0 && this.lastInfo.mode !== 9) throw Error('桩端预约模式未知，未发送启动指令')
    this.message('正在向充电桩发送立即启动指令'); await this.request(P.commands.start()); ensure()
    for (let i = 0; i < 5; i++) {
      await sleep(1000); ensure(); await this.request(P.commands.info()); ensure()
      if (this.lastInfo.status === 6) { this.message('桩端已报告充电中；本次关闭的桩端预约不会自动恢复'); return }
    }
    this.message('启动响应已收到，但桩尚未报告充电中。请检查车辆预约、充电枪连接；部分桩可能需要重新插枪。桩端预约不会自动恢复。')
  }

  /* ---------- 扫描与连接 ---------- */
  preflight() {
    if (this.form.consent) P.vinBytes(this.form.vin)
  }

  /** 搜索并选择：打开设备列表，由用户点选 */
  async startPick() {
    if (this.connected || this.busy || this.scanning) return
    try {
      this.preflight()
      this.scanList = []; this.scanMode = 'pick'; this.scanTitle = '正在搜索附近的充电桩…'; this.scanning = true; this.refresh()
      const all = this.form.allDevices
      const list = new Map()
      this.stopScan = await this.ble.scan(d => {
        if (!P.visible('', all, d.name)) return
        list.set(d.deviceId, d)
        this.scanList = Array.from(list.values()).sort((a, b) => (b.rssi || -999) - (a.rssi || -999))
        this.refresh()
      })
      const id = this.epoch
      this.scanTimer = setTimeout(() => {
        if (!this.scanning || this.scanMode !== 'pick' || id !== this.epoch) return
        this.haltScan(true)
        this.scanTitle = this.scanList.length ? '扫描完成 · 请选择自己的桩' : '未发现匹配设备 · 可开启搜索全部'
        this.refresh()
      }, 15000)
    } catch (e) { this.cancelScan(); this.fail(e) }
  }

  haltScan(keepSheet) {
    clearTimeout(this.scanTimer); this.scanTimer = null
    if (this.stopScan) { try { this.stopScan() } catch (e) {} this.stopScan = null }
    if (!keepSheet) { this.scanning = false; this.scanMode = '' }
  }
  cancelScan() { this.haltScan(false); this.scanList = []; this.refresh() }

  async pick(deviceId) {
    const d = this.scanList.find(x => x.deviceId === deviceId)
    if (!d) return
    this.haltScan(false); this.scanList = []; this.refresh()
    await this.run(() => this.connectDevice(d))
  }

  /** 按编号连接：扫描完整名称匹配的设备并自动连接 */
  async directConnect() {
    if (this.connected || this.busy || this.scanning) return
    await this.run(async () => {
      this.preflight()
      const name = String(this.form.pile || '').trim()
      if (!name) throw Error('请先输入完整设备编号')
      this.message(`正在扫描 ${name}`)
      const found = await new Promise((resolve, reject) => {
        let done = false
        const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); if (stop) try { stop() } catch (e) {} ; fn(v) }
        let stop = null
        const timer = setTimeout(() => finish(reject, Error(`未找到编号 ${name}；请核对完整蓝牙名称，或使用搜索并选择`)), 15000)
        this.ble.scan(d => { if (P.matchesTarget(name, d.name)) finish(resolve, d) })
          .then(s => { stop = s; if (done) try { s() } catch (e) {} })
          .catch(e => finish(reject, e))
      })
      await this.connectDevice(found)
    })
  }

  async connectDevice(d) {
    const serial = this.epoch
    this.device = d
    try {
      this.message(`正在连接 ${d.name || '未命名设备'}`)
      const found = await this.ble.connect(d.deviceId)
      if (serial !== this.epoch) { this.ble.disconnect(d.deviceId); return }
      for (const code of Object.keys(found)) {
        const p = found[code].properties
        this.chars[code] = found[code]
        this.log(`GATT ${code.toUpperCase()} notify=${p.notify} write=${p.write}`)
      }
      if (!this.chars.fff3 || !this.chars.fff4) throw Error('缺少 FFF3 / FFF4，本工具不支持此桩协议')
      this.connected = true
      this.setView({ deviceNameText: `已选择：${d.name || '未命名设备'}（尚未核对桩号）` })
      for (const code of ['fff4', 'fff5', 'fff9']) {
        const c = this.chars[code]
        if (!c) continue
        if (!c.properties.notify && !c.properties.indicate) { this.log(`${code} 不支持通知`); continue }
        await this.ble.subscribe(d.deviceId, c)
        if (serial !== this.epoch) { this.ble.disconnect(d.deviceId); return }
      }
      this.log('通知订阅完成'); this.message('蓝牙已连接，正在自动读取系统信息')
      try {
        await this.request(P.commands.info())
        if (serial === this.epoch && !this.authFailed && this.ready) this.message('系统信息已获取，可以操作充电桩')
      } catch (e) {
        if (serial === this.epoch) { this.ready = false; this.refresh(); this.fail(Error(`自动读取失败：${e.message}。请点击读取系统信息重试`)) }
      }
    } catch (e) {
      if (serial === this.epoch) this.disconnect()
      throw e
    }
  }

  /* ---------- 页面动作 ---------- */
  read() { return this.run(async () => { await this.request(P.commands.info()); this.message('系统信息响应已收到') }) }
  sync() {
    return this.run(async () => {
      const response = await this.request(P.commands.sync())
      this.log(`B0 校时响应负载 ${P.hex(response.payload) || '<空>'}；原协议未定义结果码`)
      await this.request(P.commands.info())
      this.message('校时响应已收到，系统信息已刷新；当前协议无法读回桩时钟，尚未确认校时结果')
    })
  }
  action(name) {
    const f = this.form
    const map = {
      start: () => P.commands.start(), stop: () => P.commands.stop(),
      lightOn: () => P.commands.light(true), lightOff: () => P.commands.light(false),
      setVolume: () => P.commands.volume(Number(f.volume)),
      reserve: () => P.commands.reserve(true, f.begin, f.end),
      cancelReserve: () => P.commands.reserve(false)
    }
    if (!map[name]) return Promise.resolve()
    return this.run(() => this.control(map[name]()))
  }
  confirmImmediate() { return this.run(() => this.immediateCharge()) }
  setPolling(on) {
    clearInterval(this.pollTimer); this.pollTimer = null; this.polling = !!on
    if (on) this.pollTimer = setInterval(() => {
      if (this.connected && !this.busy && !this.pending && !this.authFailed) this.run(() => this.request(P.commands.info()))
    }, 5000)
    this.refresh()
  }
}

let shared = null
PileController.shared = () => shared || (shared = new PileController())
module.exports = PileController
