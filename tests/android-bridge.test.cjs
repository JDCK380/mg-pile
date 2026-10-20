const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const calls=[],win={},nav={};
const ctx=vm.createContext({window:win,navigator:nav,AndroidBLE:{call:(action,id,json)=>calls.push({action,id,input:JSON.parse(json)})},Promise,Map,Uint8Array,DataView,Error,Object,JSON,Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')});
vm.runInContext(fs.readFileSync('android/native-ble.js','utf8'),ctx);
function answer(value){const call=calls.shift();assert(call);win.NativeBLE.resolve(call.id,value);return call;}
(async()=>{
 const pick=nav.bluetooth.requestDevice();assert.equal(answer({name:'OWN',address:'AA:BB:CC:DD:EE:FF'}).action,'scan');const d=await pick;
 let dropped=false;d.addEventListener('gattserverdisconnected',()=>dropped=true);
 const conn=d.gatt.connect();assert.equal(answer([{code:'fff3',uuid:'0000fff3-0000-1000-8000-00805f9b34fb',properties:8},{code:'fff4',uuid:'0000fff4-0000-1000-8000-00805f9b34fb',properties:16}]).action,'connect');const server=await conn;
 const list=await(await server.getPrimaryService(0xfff0)).getCharacteristics();assert.equal(list.length,2);
 const write=list[0].writeValueWithResponse(new Uint8Array([0x68,0xb1]));const tx=answer(null);assert.equal(tx.action,'write');assert.equal(tx.input.data,'aLE=');await write;
 const subscribe=list[1].startNotifications();assert.equal(answer(null).action,'subscribe');await subscribe;
 let bytes;list[1].addEventListener('characteristicvaluechanged',e=>bytes=new Uint8Array(e.target.value.buffer));win.NativeBLE.notification('fff4','qrE=');assert.deepEqual(Array.from(bytes),[0xaa,0xb1]);
 win.NativeBLE.disconnected();assert(dropped);assert.equal(d.gatt.connected,false);
 const failure=nav.bluetooth.requestDevice({scanAll:true,direct:true,targetName:'AY12ARM269A1B2C'});const call=calls.shift();assert.deepEqual(call.input,{all:true,direct:true,target:'AY12ARM269A1B2C'});win.NativeBLE.reject(call.id,'权限拒绝');await assert.rejects(failure,/权限拒绝/);
 console.log('Android bridge tests passed: discovery, GATT properties, byte encoding, notification, disconnect and permission rejection.');
})().catch(e=>{console.error(e);process.exitCode=1});
