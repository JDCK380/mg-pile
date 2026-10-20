/*
 * 安悦私桩 BLE 协议（移植自 web/protocol.js，源自 MG Live 2.2.6
 * com.saicmotor.vehicle.charge.b.a 与 charge.f.e）。
 * 小程序环境不保证提供 TextEncoder/TextDecoder，这里用 ASCII 编解码代替。
 */
'use strict'

const codes = { 0xA0: '灯光', 0xB0: '校时', 0xB1: '系统信息', 0xB2: '音量', 0xB3: '预约', 0xB4: '开始充电', 0xB5: '状态推送', 0xB6: '停止充电', 0xB8: '累计充电' }

const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase()

function asciiEncode(s) {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f
  return out
}

function asciiDecode(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a); out.set(b, a.length)
  return out
}

function frame(cmd, payload = [], head = 0x68) {
  if (!Number.isInteger(cmd) || cmd < 0 || cmd > 255 || payload.length > 1024) throw Error('非法帧参数')
  const a = new Uint8Array(8 + payload.length)
  a[0] = head; a[1] = cmd; a[4] = payload.length & 255; a[5] = payload.length >> 8
  a.set(payload, 8)
  a[7] = a.reduce((x, y) => x ^ y, 0)
  return a
}

const commands = {
  info: () => frame(0xB1),
  sync: (seconds = Math.floor(Date.now() / 1000)) => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, seconds, true)
    return frame(0xB0, b)
  },
  start: () => frame(0xB4, [1, 0]),
  stop: () => frame(0xB6, [0]),
  light: on => frame(0xA0, [on ? 1 : 0, 1, 0, 0, 0, 0, 0]),
  volume: n => {
    if (!Number.isInteger(n) || n < 0 || n > 100) throw Error('音量应为 0–100')
    return frame(0xB2, [n])
  },
  reserve: (on, start = '00:00', end = '00:00') => {
    const time = s => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw Error('时间格式应为 HH:mm')
      return s.split(':').map(Number)
    }
    return frame(0xB3, on ? [1, ...time(start), ...time(end)] : [0, 0, 0, 0, 0])
  }
}

/** 按通知特征分别重组分包，检查长度与 XOR，处理粘包和错误帧。 */
class Parser {
  constructor() { this.buffer = new Uint8Array() }
  push(chunk) {
    let b = concat(this.buffer, chunk)
    const frames = [], errors = []
    while (b.length) {
      if (b[0] !== 0xAA) {
        const next = b.indexOf(0xAA)
        errors.push('丢弃非 AA 帧头数据')
        b = next < 0 ? new Uint8Array() : b.slice(next)
        continue
      }
      if (b.length < 8) break
      const len = b[4] + 256 * b[5]
      if (len > 1024) { errors.push('异常帧长度'); b = b.slice(1); continue }
      if (b.length < 8 + len) break
      const a = b.slice(0, 8 + len)
      b = b.slice(8 + len)
      if (a.reduce((x, y) => x ^ y, 0) !== 0) { errors.push('XOR 校验失败，已丢弃'); continue }
      frames.push({ cmd: a[1], payload: a.slice(8), bytes: a })
    }
    this.buffer = b
    return { frames, errors }
  }
}

function sysInfo(p) {
  if (p.length < 59) throw Error('系统信息响应不足 59 字节')
  return {
    pile: asciiDecode(p.slice(0, 20)).replace(/\0/g, '').trim(),
    light: p[41] === 1,
    mode: p[46],
    schedule: Array.from(p.slice(47, 51)),
    volume: p[51],
    status: p[58]
  }
}

const statusText = n => ({ 0: '未充电', 2: '未充电', 6: '充电中', 8: '充电完成', 9: '离线' }[n] || `未知状态 0x${n.toString(16)}`)

function vinBytes(s) {
  s = String(s || '').trim().toUpperCase()
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) throw Error('请输入自己车辆的 17 位 VIN（不含 I/O/Q）')
  return asciiEncode(s)
}

/* 扫描规则，移植自 android ScanRules.java */
const isPile = name => !!name && /^AY[A-Z0-9]{2}ARM269[A-Z0-9]{5}$/.test(name.trim().toUpperCase())
const matchesTarget = (target, name) => !!target && !!target.trim() && !!name && target.trim().toUpperCase() === name.trim().toUpperCase()
const visible = (target, all, name) => (target && target.trim()) ? matchesTarget(target, name) : (all || isPile(name))

module.exports = { frame, commands, Parser, sysInfo, statusText, vinBytes, codes, hex, asciiEncode, asciiDecode, isPile, matchesTarget, visible }
