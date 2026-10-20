'use strict';
const P=PileProtocol,$=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let device=null,chars={},connected=false,busy=false,ready=false,authFailed=false,epoch=0,chain=Promise.resolve(),pending=null,pollTimer=null;
let parsers={},logs=[],lastWrite=0;
let lastInfo=null;
function log(s){const line=`${new Date().toLocaleTimeString()} ${s}`;logs.push(line);if(logs.length>1500)logs.shift();$('log').textContent=logs.join('\n');$('log').scrollTop=$('log').scrollHeight}
function message(s){$('message').textContent=s}
function refresh(){
 $('connection').textContent=connected?'蓝牙已连接':'未连接';
 $('connect').disabled=connected||busy;$('disconnect').disabled=!connected;
 $('directConnect').disabled=connected||busy;$('allDevices').disabled=connected||busy;
 document.querySelectorAll('[data-connected]').forEach(b=>b.disabled=!connected||busy||authFailed);
 document.querySelectorAll('[data-control]').forEach(b=>b.disabled=!connected||busy||!ready||authFailed);
 $('vin').disabled=connected;$('pile').disabled=connected;$('consent').disabled=connected;
}
function drop(){epoch++;connected=false;chars={};parsers={};ready=false;authFailed=false;busy=false;clearInterval(pollTimer);pollTimer=null;$('poll').checked=false;
 if(pending){clearTimeout(pending.timer);pending.reject(Error('连接已断开'));pending=null}
 chain=Promise.resolve();lastWrite=0;lastInfo=null;$('status').textContent='尚未读取';$('auth').textContent='未请求';$('extras').textContent='—';$('schedule').textContent='预约：尚未读取';$('lastRead').textContent='状态仅依据实际响应显示。';$('immediateSheet').classList.add('hidden');refresh();
}
function disconnect(){const old=device;device=null;drop();if(old?.gatt?.connected)old.gatt.disconnect();message('连接已断开');log('断开连接')}
function receive(code,bytes){
 log(`RX ${code.toUpperCase()} ${P.hex(bytes)}`);
 if(code==='fff5'){
  if(bytes[0]===0x0a){$('auth').textContent='桩请求 VIN';ready=false;refresh();
   if(authFailed){message('认证失败后请核对 VIN 并重新连接');return}
   if(!$('consent').checked){blockAuth(Error('桩请求 VIN 认证；请断开，填写自己车辆 VIN 并勾选授权后重连'));return}
   try{const vin=P.vinBytes($('vin').value),current=epoch;$('auth').textContent='VIN 已提交，待验证';write('fff6',vin,true).catch(e=>{if(current===epoch)blockAuth(e)})}catch(e){blockAuth(e)}
  }else if(bytes[0]===0x55||bytes[0]===0x54){authFailed=true;ready=false;$('auth').textContent=bytes[0]===0x55?'VIN 不匹配':'认证超时';refresh();message('桩端拒绝认证，请核对绑定车辆的 VIN 后重连');if(pending){clearTimeout(pending.timer);pending.reject(Error('桩端认证失败'));pending=null}}
  return;
 }
 const parser=parsers[code]||(parsers[code]=new P.Parser());const result=parser.push(bytes);result.errors.forEach(log);
 for(const f of result.frames){
  if(f.cmd===0xb1){try{
   const info=P.sysInfo(f.payload),expected=$('pile').value.trim();
   if(expected&&info.pile.toUpperCase()!==expected.toUpperCase()){ready=false;authFailed=true;refresh();throw Error(`桩号不匹配：返回 ${info.pile}，已禁用控制`)}
   lastInfo=info;ready=!authFailed;$('deviceName').textContent=`已读取桩号：${info.pile}`;$('status').textContent=P.statusText(info.status);$('extras').textContent=`${info.light?'开':'关'} / ${info.volume}`;
   const t=n=>String(n).padStart(2,'0');$('schedule').textContent=`预约：${info.mode===1?'已开启':'未开启'} ${t(info.schedule[0])}:${t(info.schedule[1])}–${t(info.schedule[2])}:${t(info.schedule[3])}`;
   $('lastRead').textContent=`桩端响应更新时间：${new Date().toLocaleTimeString()}`;refresh();
  }catch(e){fail(e);if(pending?.cmd===f.cmd){const req=pending;pending=null;clearTimeout(req.timer);req.reject(e)}continue}}
  if(pending?.cmd===f.cmd){const req=pending;pending=null;clearTimeout(req.timer);
   // The original SyncTimeResponseMessage does not define a result byte.
   // A B0 payload may contain data; interpreting its first byte as an error is invalid.
   if([0xa0,0xb2,0xb3,0xb4].includes(f.cmd)&&(f.payload.length===0||f.payload[0]!==0))req.reject(Error(`桩端${P.codes[f.cmd]}失败，返回 ${f.payload.length?f.payload[0]:'空响应'}`));else req.resolve(f)
  }
 }
}
function fail(e){message(e.message||String(e));log(`ERROR ${e.message||e}`)}
function blockAuth(e){authFailed=true;ready=false;refresh();fail(e);if(pending){const req=pending;pending=null;clearTimeout(req.timer);req.reject(e)}}
function write(code,bytes,secret=false){
 const current=epoch;
 const task=async()=>{
  if(current!==epoch||!connected)throw Error('连接已失效');if(authFailed)throw Error('桩端认证未通过');
  await sleep(Math.max(0,120-(Date.now()-lastWrite)));if(current!==epoch||!connected)throw Error('连接已失效');
  const c=chars[code];if(!c)throw Error(`设备缺少 ${code.toUpperCase()} 特征，无法操作`);
  log(secret?'TX REQUEST FFF6 <VIN 已隐藏>':`TX REQUEST ${code.toUpperCase()} ${P.hex(bytes)}`);
  if(c.properties.write)await c.writeValueWithResponse(bytes);else if(c.properties.writeWithoutResponse)await c.writeValueWithoutResponse(bytes);else throw Error(`${code} 不支持写入`);
  lastWrite=Date.now();log(secret?'TX FFF6 <VIN 已隐藏>':`TX ${code.toUpperCase()} ${P.hex(bytes)}`);
 };
 const work=chain.then(task);chain=work.catch(()=>{});return work;
}
function request(bytes){
 if(pending)return Promise.reject(Error('已有指令等待桩端响应'));
 return new Promise((resolve,reject)=>{
  const req={cmd:bytes[1],resolve,reject,timer:setTimeout(()=>{if(pending===req)pending=null;reject(Error(`${P.codes[bytes[1]]||'指令'} 30 秒未响应；请读取状态确认，不自动重发控制指令`))},30000)};pending=req;
  write('fff3',bytes).catch(e=>{if(pending===req)pending=null;clearTimeout(req.timer);reject(e)});
 });
}
async function run(fn){if(busy)return;busy=true;refresh();try{await fn()}catch(e){fail(e)}finally{busy=false;refresh()}}
async function control(bytes){
 if(!ready||authFailed)throw Error('请先读取并核对桩端信息');
 await request(bytes);message(`${P.codes[bytes[1]]}响应已收到，正在重新读取状态`);await request(P.commands.info());message(`${P.codes[bytes[1]]}响应已收到，请以上方最新桩端状态为准`);
}
async function immediateCharge(){
 if(!ready||authFailed)throw Error('请先读取并核对桩端信息');
 const session=epoch;
 const ensure=()=>{if(session!==epoch||!connected||authFailed)throw Error('连接或认证已失效，立即充电已停止')};
 message('正在读取当前桩端预约状态');await request(P.commands.info());ensure();
 if(lastInfo.status===6){message('桩端已报告充电中');return}
 if(lastInfo.mode===1){
  message('正在关闭桩端预约');await request(P.commands.reserve(false));ensure();await request(P.commands.info());ensure();
  if(lastInfo.mode!==0)throw Error('未确认桩端预约已关闭，未发送启动指令；请读取状态后重试');
 }else if(lastInfo.mode!==0&&lastInfo.mode!==9){throw Error('桩端预约模式未知，未发送启动指令')}
 message('正在向充电桩发送立即启动指令');await request(P.commands.start());ensure();
 for(let i=0;i<5;i++){await sleep(1000);ensure();await request(P.commands.info());ensure();if(lastInfo.status===6){message('桩端已报告充电中；本次关闭的桩端预约不会自动恢复');return}}
 message('启动响应已收到，但桩尚未报告充电中。请检查车辆预约、充电枪连接；部分桩可能需要重新插枪。桩端预约不会自动恢复。');
}
async function connect(direct=false){
 if(!navigator.bluetooth)throw Error('当前浏览器不支持 Web Bluetooth，请用 Windows / Android Chrome');if(!isSecureContext)throw Error('请从 HTTPS 或 localhost 打开页面');
 if($('consent').checked)P.vinBytes($('vin').value);
 const serial=epoch,name=$('pile').value.trim();
 if(direct&&!name)throw Error('请先输入完整设备编号');
 try{
  const all=$('allDevices').checked;
  const options=direct?{filters:[{name}],optionalServices:[0xfff0]}:all?{acceptAllDevices:true,optionalServices:[0xfff0]}:{filters:[{namePrefix:'AY'}],optionalServices:[0xfff0]};
  if(window.AndroidBLE){options.scanAll=all;options.targetName=direct?name:'';options.direct=direct;}
  device=await navigator.bluetooth.requestDevice(options);
  const chosen=device;chosen.addEventListener('gattserverdisconnected',()=>{if(device===chosen){drop();message('设备蓝牙已断开');log('设备蓝牙已断开')}});
  const server=await chosen.gatt.connect();if(serial!==epoch){server.disconnect();return}
  const service=await server.getPrimaryService(0xfff0);const found=await service.getCharacteristics();if(serial!==epoch){server.disconnect();return}
  for(const c of found){const code=c.uuid.slice(4,8).toLowerCase();chars[code]=c;log(`GATT ${code.toUpperCase()} notify=${c.properties.notify} write=${c.properties.write}`)}
  if(!chars.fff3||!chars.fff4)throw Error('缺少 FFF3 / FFF4，本工具不支持此桩协议');
  connected=true;refresh();$('deviceName').textContent=`已选择：${chosen.name||'未命名设备'}（尚未核对桩号）`;
  for(const code of ['fff4','fff5','fff9']){const c=chars[code];if(!c)continue;if(!c.properties.notify&&!c.properties.indicate){log(`${code} 不支持通知`);continue}
   c.addEventListener('characteristicvaluechanged',e=>{if(serial===epoch){const v=e.target.value;receive(code,new Uint8Array(v.buffer,v.byteOffset,v.byteLength))}});await c.startNotifications();if(serial!==epoch){server.disconnect();return}
  }
  log('通知订阅完成');message('蓝牙已连接，正在自动读取系统信息');
  try{await request(P.commands.info());if(serial===epoch&&!authFailed&&ready)message('系统信息已获取，可以操作充电桩');}
  catch(e){if(serial===epoch){ready=false;refresh();fail(Error(`自动读取失败：${e.message}。请点击读取系统信息重试`))}}
 }catch(e){if(serial===epoch)disconnect();throw e}
}
const bind=(id,fn)=>$(id).addEventListener('click',()=>run(fn));
bind('connect',()=>connect(false));bind('directConnect',()=>connect(true));$('disconnect').onclick=disconnect;
$('immediate').onclick=()=>{if(connected&&ready&&!busy&&!authFailed)$('immediateSheet').classList.remove('hidden')};
$('cancelImmediate').onclick=()=>$('immediateSheet').classList.add('hidden');
bind('confirmImmediate',async()=>{$('immediateSheet').classList.add('hidden');await immediateCharge()});
bind('read',async()=>{await request(P.commands.info());message('系统信息响应已收到')});
bind('sync',async()=>{const response=await request(P.commands.sync());log(`B0 校时响应负载 ${P.hex(response.payload)||'<空>'}；原协议未定义结果码`);await request(P.commands.info());message('校时响应已收到，系统信息已刷新；当前协议无法读回桩时钟，尚未确认校时结果')});
for(const [id,fn] of Object.entries({start:P.commands.start,stop:P.commands.stop,lightOn:()=>P.commands.light(true),lightOff:()=>P.commands.light(false),setVolume:()=>P.commands.volume(Number($('volume').value)),reserve:()=>P.commands.reserve(true,$('begin').value,$('end').value),cancelReserve:()=>P.commands.reserve(false)}))bind(id,()=>control(fn()));
$('poll').onchange=()=>{clearInterval(pollTimer);pollTimer=null;if($('poll').checked)pollTimer=setInterval(()=>{if(connected&&!busy&&!pending&&!authFailed)run(()=>request(P.commands.info()))},5000)};
$('clear').onclick=()=>{logs=[];$('log').textContent=''};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([logs.join('\n')],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='mg-pile-debug.log';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('capability').textContent=`Web Bluetooth：${navigator.bluetooth?'可用':'此浏览器不支持'} · 安全上下文：${isSecureContext?'是':'否（需要 HTTPS / localhost）'}`;
window.addEventListener('beforeunload',()=>{if(device?.gatt?.connected)device.gatt.disconnect()});refresh();
