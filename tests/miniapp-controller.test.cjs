// 移植自 tests/app.test.cjs：连接门禁、认证失败、桩号不匹配、授权缺失、立即充电、断线取消，并覆盖小程序扫描/连接流程
const assert=require('node:assert/strict'),path=require('node:path');
const U=p=>path.join(__dirname,'../miniapp/utils',p);
const P=require(U('protocol.js')),C=require(U('controller.js')),mockBle=require(U('mock-ble.js'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const VIN='LSJA24U60NS123456';
function fake(){ // 可控的假 BLE
 const f={writes:[],subs:[],value:null,disc:null,scanCb:null,devices:[],connectImpl:null,
  async open(){},async scan(cb){f.scanCb=cb;f.devices.forEach(d=>setTimeout(()=>cb(d),10));return()=>{f.scanCb=null}},
  async connect(id){if(f.connectImpl)return f.connectImpl(id);const ch=(c,p)=>({uuid:`0000${c.toUpperCase()}-0000-1000-8000-00805F9B34FB`,serviceId:'S',properties:p});return{fff3:ch('fff3',{write:true}),fff4:ch('fff4',{notify:true}),fff5:ch('fff5',{notify:true}),fff6:ch('fff6',{write:true})}},
  async subscribe(id,c){f.subs.push(c.uuid.slice(4,8).toLowerCase())},
  async write(id,c,bytes,resp){f.writes.push({code:c.uuid.slice(4,8).toLowerCase(),bytes:Array.from(bytes),resp});if(f.onWrite)f.onWrite(c.uuid.slice(4,8).toLowerCase(),bytes)},
  disconnect(){f.disconnected=(f.disconnected||0)+1},onValue(fn){f.value=fn},onDisconnect(fn){f.disc=fn}};return f}
const payloadFor=(name,status=0,mode=0)=>{const p=new Uint8Array(59);p.set(P.asciiEncode(name));p[46]=mode;p[58]=status;return p};
const reply=(name,status)=>P.frame(0xb1,payloadFor(name,status),0xaa);
(async()=>{
 // 1. 门禁与认证（直接驱动 receive）
 let f=fake(),c=new C({ble:f});
 assert.equal(c.state().canControl,false);
 c.connected=true;c.device={deviceId:'D'};c.refresh();assert.equal(c.state().canControl,false,'首次响应前禁用');
 c.receive('fff4',reply('OWN-PILE',6));assert.equal(c.state().statusText,'充电中');assert.equal(c.state().canControl,true);
 c.receive('fff5',new Uint8Array([0x55]));assert.equal(c.state().canControl,false);assert.equal(c.state().authText,'VIN 不匹配');
 c.receive('fff4',reply('OWN-PILE',6));assert.equal(c.state().canControl,false,'后续通知不能解除 VIN 失败');
 c.receive('fff5',new Uint8Array([0x0a]));assert.equal(c.state().canControl,false,'重复请求不能解除失败');
 c.drop();c.connected=true;c.form.pile='OTHER-PILE';c.receive('fff4',reply('OWN-PILE',0));assert.equal(c.state().canControl,false);assert.match(c.state().message,/桩号不匹配/);
 c.drop();c.connected=true;c.form.pile='';c.form.consent=false;c.receive('fff5',new Uint8Array([0x0a]));assert.equal(c.state().canControl,false);assert.match(c.state().message,/VIN/);
 // 2. 同意后 VIN 写入 FFF6，日志隐藏
 c.drop();c.connected=true;c.chars=await f.connect();c.form.consent=true;c.form.vin=VIN;c.receive('fff5',new Uint8Array([0x0a]));await sleep(200);
 const vinWrite=f.writes.find(w=>w.code==='fff6');assert.deepEqual(vinWrite.bytes,Array.from(P.vinBytes(VIN)));assert(!c.logs.join('\n').includes(VIN),'日志不得含 VIN');
 // 3. B0 负载首字节不是结果码
 f.onWrite=(code,b)=>{if(code==='fff3'&&b[1]===0xb0)setTimeout(()=>c.receive('fff4',P.frame(0xb0,[14,1,2,3],0xaa)),20)};
 assert.equal((await c.request(P.commands.sync())).payload[0],14);
 // A0 返回非 0 视为失败
 f.onWrite=(code,b)=>{if(code==='fff3'&&b[1]===0xa0)setTimeout(()=>c.receive('fff4',P.frame(0xa0,[3],0xaa)),20)};
 await assert.rejects(c.request(P.commands.light(true)),/灯光失败/);
 // 并发请求拒绝
 f.onWrite=null;const p1=c.request(P.commands.info());await assert.rejects(c.request(P.commands.info()),/已有指令/);
 c.drop();await assert.rejects(p1,/断开|失效/);assert.equal(c.state().canControl,false);
 // 4. 写入间隔 ≥120ms
 f=fake();c=new C({ble:f});c.connected=true;c.device={deviceId:'D'};c.chars=await f.connect();
 const t=[];f.onWrite=()=>t.push(Date.now());await Promise.all([c.write('fff3',P.commands.info()),c.write('fff3',P.commands.info())]);assert(t[1]-t[0]>=115,`间隔 ${t[1]-t[0]}`);
 // 5. 连接后自动读取（成功 / 失败保留连接）
 f=fake();c=new C({ble:f});f.onWrite=(code,b)=>{if(b[1]===0xb1)setTimeout(()=>f.value('D','fff4',reply('OWN-PILE',0)),20)};
 await c.run(()=>c.connectDevice({deviceId:'D',name:'OWN-PILE'}));assert.deepEqual(f.subs,['fff4','fff5']);assert.equal(c.state().canControl,true);assert.match(c.state().message,/可以操作/);
 c.disconnect();assert.equal(f.disconnected,1);
 f.onWrite=null;const realReq=c.request.bind(c);c.request=async()=>{throw Error('read timeout')};
 await c.run(()=>c.connectDevice({deviceId:'D',name:'OWN-PILE'}));assert.equal(c.connected,true);assert.equal(c.state().canControl,false);assert.match(c.state().message,/自动读取失败/);
 c.request=realReq;c.disconnect();
 // 缺少 FFF3 时断开并报错
 f.connectImpl=async()=>({fff4:{uuid:'0000FFF4-0000',serviceId:'S',properties:{notify:true}}});
 await c.run(()=>c.connectDevice({deviceId:'D',name:'X'}));assert.equal(c.connected,false);assert.match(c.state().message,/FFF3/);f.connectImpl=null;
 // 设备断开事件
 f.onWrite=(code,b)=>{if(b[1]===0xb1)setTimeout(()=>f.value('D','fff4',reply('OWN-PILE',0)),20)};
 await c.run(()=>c.connectDevice({deviceId:'D',name:'OWN-PILE'}));assert.equal(c.connected,true);f.disc('D');assert.equal(c.connected,false);assert.match(c.state().message,/断开/);
 // 6. 扫描：默认过滤 / 搜索全部 / 按编号连接 / 超时
 f=fake();c=new C({ble:f});f.devices=[{deviceId:'A',name:'AY12ARM269A1B2C',rssi:-50},{deviceId:'B',name:'Mi Band',rssi:-40},{deviceId:'E',name:'',rssi:-60}];
 await c.startPick();await sleep(50);assert.deepEqual(c.state().scanList.map(d=>d.deviceId),['A']);assert.equal(c.state().canConnect,false,'扫描时禁用连接按钮');c.cancelScan();assert.equal(c.state().canConnect,true);
 c.form.allDevices=true;await c.startPick();await sleep(50);assert.deepEqual(c.state().scanList.map(d=>d.deviceId),['B','A','E']);c.cancelScan();
 c.form.allDevices=false;c.form.consent=true;c.form.vin='BAD';await c.startPick();assert.equal(c.scanning,false);assert.match(c.state().message,/VIN/);c.form.consent=false;
 f.onWrite=(code,b)=>{if(b[1]===0xb1)setTimeout(()=>f.value('A','fff4',reply('AY12ARM269A1B2C',0)),20)};
 c.form.pile='ay12arm269a1b2c';await c.directConnect();assert.equal(c.connected,true);assert.equal(c.device.deviceId,'A');assert.equal(c.state().canControl,true);c.disconnect();
 c.form.pile='';await c.directConnect();assert.match(c.state().message,/完整设备编号/);
 // pick → connect
 await c.startPick();await sleep(50);await c.pick('A');assert.equal(c.connected,true);assert.equal(c.scanning,false);c.disconnect();
 // 7. 使用模拟桩完成启停、立即充电流程
 c=new C({ble:mockBle});Object.assign(mockBle.mock,{status:0,light:false,volume:30,mode:0,schedule:[0,0,0,0]});
 c.form.consent=true;c.form.vin=VIN;
 await c.startPick();await sleep(500);assert(c.scanList.some(d=>d.name===mockBle.NAME));await c.pick('MOCK-DEVICE');
 assert.equal(c.connected,true);await sleep(300);assert.equal(c.state().authText,'VIN 已提交，待验证');
 await c.read();assert.equal(c.state().deviceNameText,`已读取桩号：${mockBle.NAME}`);assert.equal(c.state().canControl,true);
 await c.action('start');assert.equal(c.state().statusText,'充电中');
 await c.action('stop');assert.equal(c.state().statusText,'充电完成');
 c.form.volume=80;await c.action('setVolume');assert.equal(c.state().extrasText,'关 / 80');
 c.form.begin='23:00';c.form.end='07:00';await c.action('reserve');assert.match(c.state().scheduleText,/已开启 23:00–07:00/);
 mockBle.mock.status=0;await c.confirmImmediate();assert.equal(mockBle.mock.mode,0);assert.equal(mockBle.mock.status,6);assert.match(c.state().message,/充电中/);
 c.setPolling(true);assert.equal(c.state().polling,true);c.disconnect();assert.equal(c.state().polling,false);
 // 8. 预约关闭未确认时不启动；流程中断线不启动
 f=fake();c=new C({ble:f});c.connected=true;c.ready=true;c.lastInfo={mode:1,status:0};const sent=[];
 c.request=async b=>{sent.push(b[1]);c.lastInfo={mode:1,status:0};return{payload:new Uint8Array([0])}};
 await assert.rejects(c.immediateCharge(),/未确认/);assert.deepEqual(sent,[0xb1,0xb3,0xb1]);
 sent.length=0;c.request=async b=>{sent.push(b[1]);c.drop();return{payload:new Uint8Array([0])}};c.connected=true;c.ready=true;
 await assert.rejects(c.immediateCharge(),/失效/);assert.deepEqual(sent,[0xb1]);
 console.log('Miniapp controller tests passed: gating, VIN flow & hiding, B0/A0 results, serial writes, auto read, scan filters, direct connect, mock start/stop/immediate, reservation guard, disconnect.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
