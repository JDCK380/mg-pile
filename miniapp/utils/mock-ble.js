/*
 * 模拟充电桩，仅供微信开发者工具调试界面流程使用（开发者工具无法连接真实 BLE）。
 * 行为移植自 tests/mock-pile.js：响应分两段返回以覆盖分包重组。
 * 模拟结果不代表真实充电桩行为；不会伪造“认证成功”字节。
 */
'use strict'
const P = require('./protocol.js')

const NAME = 'AY12ARM269DEMO1'
const ID = 'MOCK-DEVICE'
let valueListener = null, disconnectListener = null, connected = false
const mock = { status: 0, light: false, volume: 30, mode: 0, schedule: [0, 0, 0, 0] }

const emit = (code, bytes) => setTimeout(() => { if (connected && valueListener) valueListener(ID, code, bytes) }, 60)

function reply(cmd, p) {
  if (cmd === 0xb4) mock.status = 6
  if (cmd === 0xb6) mock.status = 8
  if (cmd === 0xa0) mock.light = p[0] === 1
  if (cmd === 0xb2) mock.volume = p[0]
  if (cmd === 0xb3) { mock.mode = p[0]; mock.schedule = Array.from(p.slice(1)) }
  let payload = [0]
  if (cmd === 0xb1) {
    payload = new Uint8Array(59)
    payload.set(P.asciiEncode(NAME))
    payload[41] = mock.light ? 1 : 0; payload[46] = mock.mode; payload.set(mock.schedule, 47); payload[51] = mock.volume; payload[58] = mock.status
  }
  const f = P.frame(cmd, payload, 0xaa)
  emit('fff4', f.slice(0, 5)); emit('fff4', f.slice(5))
}

const char = (code, props) => ({ uuid: `0000${code.toUpperCase()}-0000-1000-8000-00805F9B34FB`, serviceId: 'MOCK', properties: props })

module.exports = {
  mock, NAME,
  async open() {},
  async scan(onFound) {
    const t1 = setTimeout(() => onFound({ deviceId: ID, name: NAME, rssi: -48 }), 400)
    const t2 = setTimeout(() => onFound({ deviceId: 'MOCK-OTHER', name: 'Mi Band', rssi: -70 }), 700)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  },
  async connect(deviceId) {
    if (deviceId !== ID) throw Error('模拟：只能连接模拟充电桩')
    await new Promise(r => setTimeout(r, 300))
    connected = true
    return {
      fff3: char('fff3', { write: true }), fff4: char('fff4', { notify: true }),
      fff5: char('fff5', { notify: true }), fff6: char('fff6', { write: true }), fff9: char('fff9', { notify: true })
    }
  },
  async subscribe(deviceId, c) {
    // 模拟桩在订阅认证通道后请求 VIN
    if (c.uuid.slice(4, 8).toLowerCase() === 'fff5') emit('fff5', new Uint8Array([0x0a]))
  },
  async write(deviceId, c, bytes) {
    const code = c.uuid.slice(4, 8).toLowerCase()
    if (code === 'fff6') return // 原协议没有认证成功字节，模拟桩接受任何格式正确的 VIN 且不回复
    if (code === 'fff3') reply(bytes[1], bytes.slice(8))
  },
  disconnect() { if (connected) { connected = false; setTimeout(() => disconnectListener && disconnectListener(ID), 50) } },
  onValue(fn) { valueListener = fn },
  onDisconnect(fn) { disconnectListener = fn },
  platform: 'devtools'
}
