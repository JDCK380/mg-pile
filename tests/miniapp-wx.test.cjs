// 用假 wx 对象检验 utils/ble.js 的 API 调用方式，以及页面能加载并驱动控制器
const assert=require('node:assert/strict'),path=require('node:path');
const calls=[],h={};let platform='android';
const ok=(name,res={})=>o=>{calls.push([name,o]);setTimeout(()=>o.success&&o.success(res),1)};
global.wx={
 getDeviceInfo:()=>({platform}),getSystemInfoSync:()=>({platform}),
 openBluetoothAdapter:ok('open'),startBluetoothDevicesDiscovery:ok('startScan'),stopBluetoothDevicesDiscovery:ok('stopScan'),
 createBLEConnection:ok('connect'),setBLEMTU:o=>{calls.push(['mtu',o]);o.fail({errCode:10008,errMsg:'setBLEMTU:fail'})},
 getBLEDeviceServices:ok('services',{services:[{uuid:'00001800-0000-1000-8000-00805F9B34FB'},{uuid:'0000FFF0-0000-1000-8000-00805F9B34FB'}]}),
 getBLEDeviceCharacteristics:ok('chars',{characteristics:[{uuid:'0000FFF3-0000-1000-8000-00805F9B34FB',properties:{write:true}},{uuid:'0000FFF4-0000-1000-8000-00805F9B34FB',properties:{notify:true}},{uuid:'0000FFF6-0000-1000-8000-00805F9B34FB',properties:{writeNoResponse:true}}]}),
 notifyBLECharacteristicValueChange:ok('notify'),writeBLECharacteristicValue:ok('write'),closeBLEConnection:ok('close'),
 onBLECharacteristicValueChange:f=>h.value=f,onBLEConnectionStateChange:f=>h.state=f,onBluetoothDeviceFound:f=>h.found=f,onBluetoothAdapterStateChange:f=>h.adapter=f,
 navigateTo(){},showToast(){},setClipboardData(){},env:{USER_DATA_PATH:'/tmp'}
};
const U=p=>path.join(__dirname,'../miniapp',p);
(async()=>{
 const ble=require(U('utils/ble.js'));
 const seen=[];const stop=await ble.scan(d=>seen.push(d));
 assert.equal(calls[0][0],'open');assert.equal(calls[1][1].allowDuplicatesKey,true);
 h.found({devices:[{deviceId:'X',name:'',localName:'',RSSI:-60}]});h.found({devices:[{deviceId:'X',localName:'AY12ARM269A1B2C',RSSI:-55}]});h.found({devices:[{deviceId:'X',name:'',RSSI:-50}]});
 assert.deepEqual(seen.map(d=>d.name),['','AY12ARM269A1B2C','AY12ARM269A1B2C'],'名称后续更新且不被空名覆盖');
 stop();assert(calls.some(c=>c[0]==='stopScan'));
 const chars=await ble.connect('X');
 assert(calls.some(c=>c[0]==='mtu'&&c[1].mtu===100),'安卓请求 MTU 100');
 assert.equal(calls.find(c=>c[0]==='chars')[1].serviceId,'0000FFF0-0000-1000-8000-00805F9B34FB');
 assert.deepEqual(Object.keys(chars),['fff3','fff4','fff6']);assert.equal(chars.fff6.properties.writeWithoutResponse,true);
 await ble.subscribe('X',chars.fff4);assert.equal(calls.at(-1)[1].state,true);assert.equal(calls.at(-1)[1].characteristicId,chars.fff4.uuid);
 const sub=new Uint8Array([9,1,2,3,9]).subarray(1,4);await ble.write('X',chars.fff3,sub,true);
 const w=calls.at(-1)[1];assert.equal(w.writeType,'write');assert(w.value instanceof ArrayBuffer);assert.deepEqual(Array.from(new Uint8Array(w.value)),[1,2,3]);
 await ble.write('X',chars.fff6,new Uint8Array([1]),false);assert.equal(calls.at(-1)[1].writeType,'writeNoResponse');
 let got;ble.onValue((id,code,b)=>got=[id,code,Array.from(b)]);h.value({deviceId:'X',characteristicId:'0000FFF4-0000-1000-8000-00805F9B34FB',value:new Uint8Array([0xaa,1]).buffer});assert.deepEqual(got,['X','fff4',[0xaa,1]]);
 let dropped;ble.onDisconnect(id=>dropped=id);h.state({deviceId:'X',connected:false});assert.equal(dropped,'X');
 // 失败信息
 wx.createBLEConnection=o=>o.fail({errCode:10012,errMsg:'createBLEConnection:fail timeout'});await assert.rejects(ble.connect('X'),/连接超时.*10012/);
 wx.startBluetoothDevicesDiscovery=o=>o.fail({errCode:-1,errMsg:'startBluetoothDevicesDiscovery:fail location permission is denied'});await assert.rejects(ble.scan(()=>{}),/位置权限/);
 h.adapter({available:false});wx.openBluetoothAdapter=o=>o.fail({errCode:10001,errMsg:'openBluetoothAdapter:fail not available'});await assert.rejects(ble.open(),/蓝牙未开启/);
 // 页面加载
 let pageDef,appDef;global.Page=d=>pageDef=d;global.App=d=>appDef=d;global.getApp=()=>appDef;
 require(U('app.js'));require(U('pages/index/index.js'));
 const page=Object.assign({},pageDef,{data:JSON.parse(JSON.stringify(pageDef.data)),setData(p){for(const[k,v]of Object.entries(p)){if(k.includes('.')){const[a,b]=k.split('.');this.data[a][b]=v}else this.data[k]=v}}});
 page.onLoad();assert.equal(page.data.connectionText,'未连接');assert.equal(page.data.canControl,false);assert.equal(page.data.isDevtools,false);
 assert.equal(page.onVin({detail:{value:'lsja'}}),'LSJA');page.onConsent({detail:{value:true}});assert.equal(page.data.form.consent,true);
 page.onVolume({detail:{value:55}});assert.equal(page.data.form.volume,55);
 page.onDirect();await new Promise(r=>setTimeout(r,20));assert.match(page.data.message,/VIN/,'无效 VIN 时不扫描');
 page.onImmediate();assert.equal(page.data.showImmediate,false,'未连接时不显示立即充电面板');
 // 页面切换到模拟桩并走一遍
 const mock=require(U('utils/mock-ble.js'));page.onDemo({detail:{value:true}});assert.equal(page.data.demo,true);
 page.onVin({detail:{value:'LSJA24U60NS123456'}});page.onPick();await new Promise(r=>setTimeout(r,500));
 page.onChoose({currentTarget:{dataset:{id:'MOCK-DEVICE'}}});await new Promise(r=>setTimeout(r,1200));
 assert.equal(page.data.connected,true);assert.equal(page.data.canControl,true);assert.equal(page.data.statusText,'未充电');
 page.onAction({currentTarget:{dataset:{name:'start'}}});await new Promise(r=>setTimeout(r,800));assert.equal(page.data.statusText,'充电中');
 appDef.onHide();assert.equal(page.data.connected,false);assert.match(page.data.message,/后台/);
 // 日志页
 require(U('pages/logs/logs.js'));const logs=Object.assign({},pageDef,{data:{...pageDef.data},setData(p){Object.assign(this.data,p)}});logs.onLoad();assert(logs.data.count>5);assert(!logs.data.text.includes('LSJA24U60NS123456'));logs.onClear();assert.equal(logs.data.count,0);
 console.log('Miniapp wx tests passed: wx BLE call shapes, MTU, ArrayBuffer slicing, notifications, errors, page/app/logs wiring with mock pile.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
