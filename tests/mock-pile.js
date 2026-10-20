function mockReceive(code,a){
 if(code==='fff6'){receive('fff5',new Uint8Array([0x55]));return} // No fabricated successful VIN response.
 const cmd=a[1],p=a.slice(8);if(cmd===0xb4)mock.status=6;if(cmd===0xb6)mock.status=8;if(cmd===0xa0)mock.light=p[0]===1;if(cmd===0xb2)mock.volume=p[0];if(cmd===0xb3){mock.mode=p[0];mock.schedule=Array.from(p.slice(1))}
 let payload=[0];if(cmd===0xb1){payload=new Uint8Array(59);payload.set(new TextEncoder().encode('DEMO-OWN-PILE'));payload[41]=mock.light?1:0;payload[46]=mock.mode;payload.set(mock.schedule,47);payload[51]=mock.volume;payload[58]=mock.status}
 const reply=P.frame(cmd,payload,0xaa);receive('fff4',reply.slice(0,5));receive('fff4',reply.slice(5));
}
