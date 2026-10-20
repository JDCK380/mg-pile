/*
 * 微信小程序 BLE 适配层。
 * 取代 Web 版的 navigator.bluetooth 与安卓版 native-ble.js / MainActivity 中的 GATT 代码：
 * 扫描、连接、MTU、服务/特征发现、通知订阅、写入，全部串行化。
 */
'use strict'

const SERVICE = '0000FFF0-0000-1000-8000-00805F9B34FB'

const ERRORS = {
  10000: '蓝牙适配器未初始化',
  10001: '手机蓝牙未开启，请打开蓝牙后重试',
  10002: '没有找到指定设备',
  10003: '连接失败，请靠近充电桩重试',
  10004: '设备没有 FFF0 服务，本工具不支持此桩协议',
  10005: '没有找到指定特征',
  10006: '蓝牙连接已断开',
  10007: '当前特征不支持此操作',
  10008: '系统蓝牙异常',
  10009: '系统版本过低，不支持 BLE',
  10012: '连接超时，请靠近充电桩重试',
  10013: '设备 ID 无效'
}

function wxError(op, res) {
  const code = res && (res.errCode !== undefined ? res.errCode : res.errno)
  const raw = (res && res.errMsg) || String(res)
  let text = ERRORS[code]
  if (!text && /location|定位/i.test(raw)) text = '扫描蓝牙需要位置权限并打开系统定位开关（安卓平台要求）'
  if (!text && /auth|permission|deny/i.test(raw)) text = '未获得蓝牙权限，请在微信设置与小程序设置中允许蓝牙'
  const e = Error(`${op}失败：${text || raw}${code !== undefined ? `（${code}）` : ''}`)
  e.errCode = code
  return e
}

function call(api, op, args = {}) {
  return new Promise((resolve, reject) => {
    if (typeof wx[api] !== 'function') { reject(Error(`当前微信版本不支持 ${api}`)); return }
    wx[api](Object.assign({}, args, { success: resolve, fail: res => reject(wxError(op, res)) }))
  })
}

const codeOf = uuid => String(uuid).slice(4, 8).toLowerCase()
const toBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const sleep = ms => new Promise(r => setTimeout(r, ms))

let valueListener = null, disconnectListener = null, foundListener = null, hooked = false, adapterOpen = false
let platform = ''

function hook() {
  if (hooked) return
  hooked = true
  try { platform = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform || '' } catch (e) { platform = '' }
  wx.onBLECharacteristicValueChange(res => {
    if (valueListener) valueListener(res.deviceId, codeOf(res.characteristicId), new Uint8Array(res.value))
  })
  wx.onBLEConnectionStateChange(res => {
    if (!res.connected && disconnectListener) disconnectListener(res.deviceId)
  })
  if (typeof wx.onBluetoothAdapterStateChange === 'function') {
    wx.onBluetoothAdapterStateChange(res => { if (!res.available) adapterOpen = false })
  }
  wx.onBluetoothDeviceFound(res => {
    if (foundListener) (res.devices || []).forEach(d => foundListener(d))
  })
}

async function open() {
  hook()
  if (adapterOpen) return
  // 10001（蓝牙未开启）时直接抛出；用户打开蓝牙后再次调用即可
  await call('openBluetoothAdapter', '打开蓝牙', { mode: 'central' })
  adapterOpen = true
}

/**
 * 扫描设备。onFound(device) 每次发现或名称更新都会回调。
 * 返回 stop()。
 */
async function scan(onFound) {
  await open()
  const seen = new Map()
  foundListener = d => {
    const name = d.localName || d.name || ''
    const prev = seen.get(d.deviceId)
    // 优先使用广播名称，后续广播提供名称时更新
    const item = { deviceId: d.deviceId, name: name || (prev && prev.name) || '', rssi: d.RSSI }
    seen.set(d.deviceId, item)
    onFound(item)
  }
  await call('startBluetoothDevicesDiscovery', '扫描蓝牙', { allowDuplicatesKey: true, interval: 0, powerLevel: 'high' })
  return function stop() {
    foundListener = null
    if (typeof wx.stopBluetoothDevicesDiscovery === 'function') wx.stopBluetoothDevicesDiscovery({ fail() {} })
  }
}

/** 连接并发现 FFF0 下的特征，返回 { code: {uuid, serviceId, properties} } */
async function connect(deviceId) {
  await open()
  await call('createBLEConnection', '连接蓝牙', { deviceId, timeout: 30000 })
  if (platform === 'android') {
    // 原 App 请求 MTU 100；失败不影响 ≤20 字节的指令
    try { await call('setBLEMTU', '设置 MTU', { deviceId, mtu: 100 }) } catch (e) { /* ignore */ }
  }
  const { services = [] } = await call('getBLEDeviceServices', '读取服务', { deviceId })
  const service = services.find(s => String(s.uuid).toUpperCase() === SERVICE)
  if (!service) throw Error('设备没有 FFF0 服务，本工具不支持此桩协议')
  const { characteristics = [] } = await call('getBLEDeviceCharacteristics', '读取特征', { deviceId, serviceId: service.uuid })
  const chars = {}
  for (const c of characteristics) {
    const p = c.properties || {}
    chars[codeOf(c.uuid)] = { uuid: c.uuid, serviceId: service.uuid, properties: { write: !!p.write, writeWithoutResponse: !!p.writeNoResponse, notify: !!p.notify, indicate: !!p.indicate } }
  }
  return chars
}

function subscribe(deviceId, c) {
  return call('notifyBLECharacteristicValueChange', `订阅 ${codeOf(c.uuid).toUpperCase()}`, {
    deviceId, serviceId: c.serviceId, characteristicId: c.uuid, state: true,
    type: c.properties.notify ? 'notification' : 'indication'
  })
}

function write(deviceId, c, bytes, response) {
  return call('writeBLECharacteristicValue', `写入 ${codeOf(c.uuid).toUpperCase()}`, {
    deviceId, serviceId: c.serviceId, characteristicId: c.uuid, value: toBuffer(bytes),
    writeType: response ? 'write' : 'writeNoResponse'
  })
}

function disconnect(deviceId) {
  if (deviceId && typeof wx.closeBLEConnection === 'function') wx.closeBLEConnection({ deviceId, fail() {} })
}

module.exports = {
  open, scan, connect, subscribe, write, disconnect, codeOf,
  onValue(fn) { hook(); valueListener = fn },
  onDisconnect(fn) { hook(); disconnectListener = fn },
  get platform() { hook(); return platform }
}
