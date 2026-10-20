// Exercise connection lifecycle and authentication failures without a real radio.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const P=require('../web/protocol.js');
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,textContent:'',classList:{toggle(){},add(){},remove(){}},addEventListener(){},scrollTop:0,scrollHeight:0});return elements.get(id)}
const controls=['immediate','start','stop','lightOn','lightOff','setVolume','reserve','cancelReserve'].map(el);
const ctx=vm.createContext({PileProtocol:P,document:{getElementById:el,querySelectorAll:s=>s==='[data-control]'?controls:[el('read'),el('sync')]},navigator:{},isSecureContext:true,window:{addEventListener(){}},TextEncoder,Uint8Array,Date,Promise,Error,Math,Number,Object,setTimeout,clearTimeout,setInterval,clearInterval});
const app=fs.readFileSync('web/app.js','utf8');
vm.runInContext('let demo=false,mock={status:0,light:false,volume:30,mode:0,schedule:[0,0,0,0]};'+app.replace("  const c=chars[code];", "  if(demo){setTimeout(()=>{if(epoch===current)mockReceive(code,bytes)},70);return} const c=chars[code];")+fs.readFileSync('tests/mock-pile.js','utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
const payload=new Uint8Array(59);payload.set(new TextEncoder().encode('OWN-PILE'));payload[58]=6;ctx.reply=P.frame(0xb1,payload,0xaa);
(async()=>{
 assert(controls.every(x=>x.disabled));
 run('connected=true;refresh()');assert(controls.every(x=>x.disabled));
 run("receive('fff4',reply)");assert.equal(el('status').textContent,'充电中');assert(controls.every(x=>!x.disabled));
 run("receive('fff5',new Uint8Array([0x55]))");assert(controls.every(x=>x.disabled));assert.equal(el('auth').textContent,'VIN 不匹配');
 run("receive('fff4',reply)");assert(controls.every(x=>x.disabled),'later state notification must not undo failed VIN');
 run("receive('fff5',new Uint8Array([0x0a]))");assert(controls.every(x=>x.disabled),'a repeated request must not clear failure');
 run('drop();connected=true');el('pile').value='OTHER-PILE';run("receive('fff4',reply)");assert(controls.every(x=>x.disabled));assert.match(el('message').textContent,/桩号不匹配/);
 run('drop();connected=true');el('pile').value='';el('consent').checked=false;
 run("receive('fff5',new Uint8Array([0x0a]))");assert(controls.every(x=>x.disabled));assert.match(el('message').textContent,/VIN/);
 run('drop();demo=true;connected=true');
 const syncResponse=run('request(P.commands.sync())');ctx.syncReply=P.frame(0xb0,[14,1,2,3],0xaa);run("receive('fff4',syncReply)");assert.equal((await syncResponse).payload[0],14,'B0 response payload is not a generic result code');
 const emptySync=run('request(P.commands.sync())');ctx.syncReply=P.frame(0xb0,[],0xaa);run("receive('fff4',syncReply)");await emptySync;
 // Prevent already scheduled mock B0 responses from interfering with later requests.
 await new Promise(r=>setTimeout(r,300));
 await run('request(P.commands.info())');assert.equal(el('deviceName').textContent,'已读取桩号：DEMO-OWN-PILE');
 await run('control(P.commands.start())');assert.equal(el('status').textContent,'充电中');
 await run('control(P.commands.stop())');assert.equal(el('status').textContent,'充电完成');
 run('mock.mode=1;mock.status=0');
 await run('immediateCharge()');assert.equal(run('mock.mode'),0);assert.equal(run('mock.status'),6);assert.match(el('message').textContent,/充电中/);
 run('drop();demo=true;connected=true;ready=true;lastInfo={mode:1,status:0};globalThis.sent=[];globalThis.originalRequest=request;request=async bytes=>{sent.push(bytes[1]);lastInfo={mode:1,status:0};return {payload:new Uint8Array([0])}}');
 await assert.rejects(run('immediateCharge()'),/未确认/);assert.deepEqual(Array.from(run('sent')),[0xb1,0xb3,0xb1]);
 run('sent=[];request=async bytes=>{sent.push(bytes[1]);drop();return {payload:new Uint8Array([0])}};connected=true;ready=true');
 await assert.rejects(run('immediateCharge()'),/失效/);assert.deepEqual(Array.from(run('sent')),[0xb1]);
 run('request=originalRequest;demo=true;connected=true');
 const wait=run('request(P.commands.info())');run('drop()');await assert.rejects(wait,/断开|失效/);
 assert(controls.every(x=>x.disabled));
 const characteristics=['fff3','fff4'].map(code=>({uuid:'0000'+code+'-0000-1000-8000-00805f9b34fb',properties:{notify:code==='fff4',write:code==='fff3'},addEventListener(){},async startNotifications(){}}));
 const server={async getPrimaryService(){return {async getCharacteristics(){return characteristics}}},disconnect(){}};
 ctx.navigator.bluetooth={async requestDevice(){return {name:'OWN-PILE',addEventListener(){},gatt:{async connect(){return server},disconnect(){}}}}};
 run("drop();globalThis.autoReads=0;request=async bytes=>{autoReads++;receive('fff4',reply);return {payload:new Uint8Array([0])}}");
 await run('connect()');assert.equal(run('autoReads'),1);assert(controls.every(x=>!x.disabled));assert.match(el('message').textContent,/可以操作/);
 run("disconnect();request=async()=>{throw Error('read timeout')}");
 await run('connect()');assert.equal(run('connected'),true);assert(controls.every(x=>x.disabled));assert.match(el('message').textContent,/自动读取失败/);
 run('disconnect()');
 console.log('App tests passed: B0 payload 14/empty ack, controls gated until response, VIN failure remains blocked, identity mismatch, missing consent, demo start/stop, disconnect cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1});
