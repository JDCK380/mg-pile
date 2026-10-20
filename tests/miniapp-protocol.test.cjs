// 小程序协议实现与 Web 版逐字节对照 + 原测试向量
const assert=require('node:assert/strict'),path=require('node:path');
const P=require(path.join(__dirname,'../miniapp/utils/protocol.js'));
const W=require(process.env.WEB_PROTOCOL||path.join(__dirname,'../web/protocol.js'));
assert.equal(P.hex(P.commands.info()),'68 B1 00 00 00 00 00 D9');
assert.equal(P.hex(P.commands.start()),'68 B4 00 00 02 00 00 DF 01 00');
assert.equal(P.hex(P.commands.stop()),'68 B6 00 00 01 00 00 DF 00');
assert.equal(P.hex(P.commands.light(true)),'68 A0 00 00 07 00 00 CF 01 01 00 00 00 00 00');
assert.equal(P.hex(P.commands.sync(0x12345678)),'68 B0 00 00 04 00 00 D4 78 56 34 12');
assert.throws(()=>P.commands.reserve(true,'25:00','07:00'));
assert.throws(()=>P.commands.volume(101));assert.throws(()=>P.vinBytes('WRONG'));assert.throws(()=>P.vinBytes('LSJA24U60NS12345O'));
assert.deepEqual(Array.from(P.vinBytes(' lsja24u60ns123456 ')),Array.from(W.vinBytes('LSJA24U60NS123456')));
// 与 Web 版逐字节一致
for(const v of [0,30,55,100])assert.deepEqual(P.commands.volume(v),W.commands.volume(v));
for(const t of [0,1,0x7fffffff,1760000000])assert.deepEqual(P.commands.sync(t),W.commands.sync(t));
for(const on of [true,false])assert.deepEqual(P.commands.light(on),W.commands.light(on));
assert.deepEqual(P.commands.reserve(true,'23:00','07:30'),W.commands.reserve(true,'23:00','07:30'));
assert.deepEqual(P.commands.reserve(false),W.commands.reserve(false));
const payload=new Uint8Array(59);payload.set(new TextEncoder().encode('MY-OWN-PILE'));payload[41]=1;payload[46]=1;payload.set([23,0,7,0],47);payload[51]=80;payload[58]=6;
const full=P.frame(0xb1,payload,0xaa);
for(let split=0;split<=full.length;split++){const p=new P.Parser();const a=p.push(full.slice(0,split)),b=p.push(full.slice(split));assert.equal(a.frames.length+b.frames.length,1)}
for(let i=0;i<full.length;i++){const p=new P.Parser();let n=0;for(const byte of full)n+=p.push(new Uint8Array([byte])).frames.length;assert.equal(n,1)}
const joined=new Uint8Array(full.length*2);joined.set(full);joined.set(full,full.length);assert.equal(new P.Parser().push(joined).frames.length,2);
const bad=full.slice();bad[7]^=1;assert.equal(new P.Parser().push(bad).frames.length,0);
const noise=new Uint8Array([1,2,3,...full]);assert.equal(new P.Parser().push(noise).frames.length,1);
assert.deepEqual(P.sysInfo(payload),{pile:'MY-OWN-PILE',light:true,mode:1,schedule:[23,0,7,0],volume:80,status:6});
assert.deepEqual(P.sysInfo(payload),W.sysInfo(payload));
assert.throws(()=>P.sysInfo(new Uint8Array(58)));
const abnormal=new Uint8Array([0xaa,0xb1,0,0,255,255,0,0,...full]);assert.equal(new P.Parser().push(abnormal).frames.length,1);
for(const n of [0,2,6,8,9,3])assert.equal(P.statusText(n),W.statusText(n));
// 扫描规则（ScanRules.java 对照）
assert(P.isPile('AY12ARM269A1B2C'));assert(P.isPile('ay12arm269a1b2c'));assert(!P.isPile('AY12ARM269A1B2'));assert(!P.isPile(''));assert(!P.isPile(null));
assert(P.matchesTarget(' AY12ARM269A1B2C ','ay12arm269a1b2c'));assert(!P.matchesTarget('','x'));
assert(P.visible('',true,''));assert(!P.visible('',false,'Mi Band'));assert(P.visible('',false,'AY12ARM269A1B2C'));assert(!P.visible('AY12ARM269A1B2C',true,'AY12ARM269A1B2D'));
console.log('Miniapp protocol tests passed: vectors, byte-equality with web/protocol.js, fragments, checksum, resync, scan rules.');
