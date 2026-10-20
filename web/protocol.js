/* Ported from MG Live 2.2.6 com.saicmotor.vehicle.charge.b.a and charge.f.e. */
(function(root){
 'use strict';
 const codes={0xA0:'灯光',0xB0:'校时',0xB1:'系统信息',0xB2:'音量',0xB3:'预约',0xB4:'开始充电',0xB5:'状态推送',0xB6:'停止充电',0xB8:'累计充电'};
 const hex=a=>Array.from(a,b=>b.toString(16).padStart(2,'0')).join(' ').toUpperCase();
 function frame(cmd,payload=[],head=0x68){
  if(!Number.isInteger(cmd)||cmd<0||cmd>255||payload.length>1024)throw Error('非法帧参数');
  const a=new Uint8Array(8+payload.length); a[0]=head;a[1]=cmd;a[4]=payload.length&255;a[5]=payload.length>>8;a.set(payload,8);
  a[7]=a.reduce((x,y)=>x^y,0);return a;
 }
 const commands={
  info:()=>frame(0xB1),
  sync:(seconds=Math.floor(Date.now()/1000))=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,seconds,true);return frame(0xB0,b)},
  start:()=>frame(0xB4,[1,0]),stop:()=>frame(0xB6,[0]),
  light:on=>frame(0xA0,[on?1:0,1,0,0,0,0,0]),
  volume:n=>{if(!Number.isInteger(n)||n<0||n>100)throw Error('音量应为 0–100');return frame(0xB2,[n])},
  reserve:(on,start='00:00',end='00:00')=>{
   const time=s=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw Error('时间格式应为 HH:mm');return s.split(':').map(Number)};
   return frame(0xB3,on?[1,...time(start),...time(end)]:[0,0,0,0,0]);
  }
 };
 class Parser{
  constructor(){this.buffer=new Uint8Array()}
  push(chunk){
   let b=new Uint8Array(this.buffer.length+chunk.length);b.set(this.buffer);b.set(chunk,this.buffer.length);
   const frames=[],errors=[];
   while(b.length){
    if(b[0]!==0xAA){const next=b.indexOf(0xAA);errors.push('丢弃非 AA 帧头数据');b=next<0?new Uint8Array():b.slice(next);continue}
    if(b.length<8)break;
    const len=b[4]+256*b[5];if(len>1024){errors.push('异常帧长度');b=b.slice(1);continue}
    if(b.length<8+len)break;
    const a=b.slice(0,8+len);b=b.slice(8+len);
    if(a.reduce((x,y)=>x^y,0)!==0){errors.push('XOR 校验失败，已丢弃');continue}
    frames.push({cmd:a[1],payload:a.slice(8),bytes:a});
   }
   this.buffer=b;return {frames,errors};
  }
 }
 function sysInfo(p){
  if(p.length<59)throw Error('系统信息响应不足 59 字节');
  return {pile:new TextDecoder().decode(p.slice(0,20)).replace(/\0/g,'').trim(),light:p[41]===1,mode:p[46],schedule:Array.from(p.slice(47,51)),volume:p[51],status:p[58]};
 }
 const statusText=n=>({0:'未充电',2:'未充电',6:'充电中',8:'充电完成',9:'离线'}[n]||`未知状态 0x${n.toString(16)}`);
 function vinBytes(s){s=s.trim().toUpperCase();if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(s))throw Error('请输入自己车辆的 17 位 VIN（不含 I/O/Q）');return new TextEncoder().encode(s)}
 const api={frame,commands,Parser,sysInfo,statusText,vinBytes,codes,hex};
 root.PileProtocol=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
