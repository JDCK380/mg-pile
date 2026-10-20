// Implements the Web Bluetooth subset used by the bundled page with Android GATT.
(function(){
 let counter=0,callbacks=new Map(),current=null;
 const encode=bytes=>btoa(String.fromCharCode(...bytes));
 const decode=data=>Uint8Array.from(atob(data),c=>c.charCodeAt(0));
 function call(action,input={}){return new Promise((resolve,reject)=>{const id=++counter;callbacks.set(id,{resolve,reject});AndroidBLE.call(action,id,JSON.stringify(input))})}
 window.NativeBLE={
  resolve(id,value){const c=callbacks.get(id);if(c){callbacks.delete(id);c.resolve(value)}},
  reject(id,text){const c=callbacks.get(id);if(c){callbacks.delete(id);c.reject(Error(text))}},
  notification(code,data){const c=current?.characteristics.get(code);if(c){const bytes=decode(data);c.value=new DataView(bytes.buffer);c.listener?.({target:c})}},
  disconnected(){if(current){current.gatt.connected=false;current.disconnectListener?.()}},
 };
 const bluetooth={async requestDevice(options={}){
  const info=await call('scan',{all:!!options.scanAll,direct:!!options.direct,target:options.targetName||''});
  const d={name:info.name,characteristics:new Map(),addEventListener(name,listener){if(name==='gattserverdisconnected')this.disconnectListener=listener}};
  d.gatt={connected:false,async connect(){current=d;const found=await call('connect',{address:info.address});this.connected=true;d.characteristics.clear();
   for(const f of found){const props=f.properties;const c={uuid:f.uuid,properties:{write:!!(props&8),writeWithoutResponse:!!(props&4),notify:!!(props&16),indicate:!!(props&32)},addEventListener(name,listener){if(name==='characteristicvaluechanged')this.listener=listener},async startNotifications(){await call('subscribe',{code:f.code});return this},writeValueWithResponse(bytes){return call('write',{code:f.code,data:encode(bytes),response:true})},writeValueWithoutResponse(bytes){return call('write',{code:f.code,data:encode(bytes),response:false})}};d.characteristics.set(f.code,c);}
   return {getPrimaryService:async()=>({getCharacteristics:async()=>Array.from(d.characteristics.values())}),disconnect:()=>this.disconnect()};
  },disconnect(){this.connected=false;call('disconnect').catch(()=>{});}};return d;
 }};
 Object.defineProperty(navigator,'bluetooth',{value:bluetooth,configurable:true});
})();
