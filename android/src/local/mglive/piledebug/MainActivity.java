package local.mglive.piledebug;

import android.Manifest;
import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.location.LocationManager;
import android.webkit.*;
import android.widget.*;
import android.util.Base64;
import org.json.*;
import java.util.*;
import java.io.*;

public final class MainActivity extends Activity {
 private WebView web; private final Handler ui=new Handler(Looper.getMainLooper());
 private BluetoothAdapter adapter; private BluetoothGatt gatt;
 private final Map<String,BluetoothGattCharacteristic> chars=new HashMap<>();
 private final Map<String,BluetoothDevice> devices=new LinkedHashMap<>();
 private final Map<String,String> scanNames=new LinkedHashMap<>(); private final Map<String,Integer> scanRssi=new HashMap<>();
 private boolean scanAll=false,scanDirect=false; private String scanTarget="";
 private final List<String> addresses=new ArrayList<>(); private ArrayAdapter<String> rows; private AlertDialog picker;
 private final ArrayDeque<Runnable> operations=new ArrayDeque<>(); private final ArrayDeque<Integer> queuedIds=new ArrayDeque<>();
 private ScanCallback scanner; private int scanId=-1, connectId=-1, operationId=-1; private String operationKind="", operationCode="";
 private boolean loaded=false; private String exportText=""; private Runnable operationTimeout;
 private static final UUID SERVICE=UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb"), CCCD=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
 @Override public void onCreate(Bundle state){
  boolean dark=(getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES;
  setTheme(dark?android.R.style.Theme_Material_NoActionBar:android.R.style.Theme_Material_Light_NoActionBar);super.onCreate(state);
  int background=dark?0xff101114:0xfff4f5f7;
  getWindow().setStatusBarColor(background);getWindow().setNavigationBarColor(background);
  getWindow().getDecorView().setSystemUiVisibility(dark?0:android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  BluetoothManager manager=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);adapter=manager==null?null:manager.getAdapter();
  web=new WebView(this);web.setBackgroundColor(background);setContentView(web);
  web.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  web.addJavascriptInterface(new Bridge(),"AndroidBLE");
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
   @Override public void onPageFinished(WebView view,String url){loaded=true;}
  });web.loadUrl("file:///android_asset/index.html");
 }
 private void js(String script){if(loaded)web.evaluateJavascript(script,null);}
 private void result(int id,Object value){if(id<0)return;String json=value==null?"null":value instanceof JSONObject||value instanceof JSONArray?value.toString():JSONObject.quote(String.valueOf(value));js("window.NativeBLE.resolve("+id+","+json+")");}
 private void error(int id,String text){if(id>=0)js("window.NativeBLE.reject("+id+","+JSONObject.quote(text)+")");}
 public final class Bridge {
  @JavascriptInterface public void call(String action,int id,String input){ui.post(()->{try{dispatch(action,id,new JSONObject(input));}catch(Exception e){error(id,"蓝牙操作失败："+e.getMessage());}});}
  @JavascriptInterface public void exportLog(String text){ui.post(()->{exportText=text;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("text/plain");i.putExtra(Intent.EXTRA_TITLE,"mg-pile-debug.log");try{startActivityForResult(i,12);}catch(Exception e){Toast.makeText(MainActivity.this,"无法打开文件保存器",Toast.LENGTH_LONG).show();}});}
 }
 private void dispatch(String action,int id,JSONObject arg)throws Exception{
  if((action.equals("subscribe")||action.equals("write"))&&operationId>=0){operations.add(()->{try{dispatch(action,id,arg);}catch(Exception e){error(id,e.getMessage());drainOperation();}});queuedIds.add(id);return;}
  switch(action){
   case "scan": if(scanId>=0||connectId>=0){error(id,"已有连接操作正在进行");return;} scanId=id;scanAll=arg.optBoolean("all");scanDirect=arg.optBoolean("direct");scanTarget=arg.optString("target").trim();if(scanDirect&&scanTarget.isEmpty()){finishScanError("请先输入完整设备编号");return;}beginScan();break;
   case "connect": connect(id,arg.getString("address"));break;
   case "subscribe": subscribe(id,arg.getString("code"));break;
   case "write": write(id,arg.getString("code"),Base64.decode(arg.getString("data"),Base64.NO_WRAP),arg.optBoolean("response",true));break;
   case "disconnect":closeGatt("已断开连接");result(id,null);break;
   default:error(id,"未知操作");
  }
 }
 private void beginScan(){
  try{beginScanChecked();}catch(Exception e){finishScanError("扫描无法开始："+e.getMessage());}
 }
 private void beginScanChecked(){
  if(adapter==null){finishScanError("手机没有可用蓝牙适配器");return;}
  String[] permissions=Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
  for(String p:permissions)if(checkSelfPermission(p)!=PackageManager.PERMISSION_GRANTED){requestPermissions(permissions,10);return;}
  if(!adapter.isEnabled()){startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE),11);return;}
  if(Build.VERSION.SDK_INT<31){LocationManager lm=(LocationManager)getSystemService(LOCATION_SERVICE);if(lm!=null&&!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)&&!lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)){finishScanError("Android 11 及以下需要开启系统定位才能扫描 BLE；开启后重试");return;}}
  devices.clear();scanNames.clear();scanRssi.clear();addresses.clear();rows=new ArrayAdapter<>(this,android.R.layout.simple_list_item_1,new ArrayList<String>());
  ListView list=new ListView(this);list.setAdapter(rows);
  LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);
  if(scanDirect){TextView hint=new TextView(this);hint.setPadding(30,30,30,30);hint.setText("正在搜索 "+scanTarget+"\n找到后会自动连接，请靠近自己的充电桩。");content.addView(hint);}else{CheckBox toggle=new CheckBox(this);toggle.setText("搜索全部蓝牙设备");toggle.setChecked(scanAll);toggle.setOnCheckedChangeListener((v,checked)->{scanAll=checked;rebuildScanRows();});content.addView(toggle);content.addView(list,new LinearLayout.LayoutParams(-1,600));}
  picker=new AlertDialog.Builder(this).setTitle(scanDirect?"按设备编号连接":"选择自己的充电桩 · 扫描中").setView(content).setNegativeButton("取消",(d,w)->finishScanError("已取消设备选择")).create();
  picker.setOnCancelListener(d->finishScanError("已取消设备选择"));
  list.setOnItemClickListener((p,v,pos,item)->selectScanned(addresses.get(pos)));
  picker.show();
  final int scanSession=scanId;
  scanner=new ScanCallback(){@Override public void onScanResult(int type,ScanResult r){ui.post(()->{
   if(scanId!=scanSession||scanner==null||picker==null)return;BluetoothDevice d=r.getDevice();String address=d.getAddress();
   String name=r.getScanRecord()==null?null:r.getScanRecord().getDeviceName();if(name==null)name=d.getName();if(name==null)name=scanNames.get(address);
   boolean changed=!devices.containsKey(address)||!Objects.equals(name,scanNames.get(address));devices.put(address,d);scanNames.put(address,name);scanRssi.put(address,r.getRssi());
   if(scanDirect&&ScanRules.matchesTarget(scanTarget,name)){selectScanned(address);return;}if(changed)rebuildScanRows();
  });}@Override public void onScanFailed(int code){ui.post(()->{if(scanId==scanSession)finishScanError("扫描失败，错误码 "+code);});}};
  adapter.getBluetoothLeScanner().startScan(null,new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scanner);
  final int id=scanId;ui.postDelayed(()->{if(scanId==id&&picker!=null){stopScan();if(scanDirect){finishScanError("未找到编号 "+scanTarget+"；请核对完整蓝牙名称，或使用搜索并选择");return;}picker.setTitle(addresses.isEmpty()?"未发现匹配设备 · 可开启搜索全部":"扫描完成 · 请选择自己的桩");}},15000);
 }
 private void rebuildScanRows(){if(rows==null)return;rows.clear();addresses.clear();for(String address:devices.keySet()){String name=scanNames.get(address);if(ScanRules.visible(scanTarget,scanAll,name)){addresses.add(address);rows.add((name==null?"未命名设备":name)+"\n"+address+" · "+scanRssi.get(address)+" dBm");}}}
 private void selectScanned(String address){stopScan();int id=scanId;scanId=-1;if(picker!=null){picker.dismiss();picker=null;}try{JSONObject obj=new JSONObject();String name=scanNames.get(address);obj.put("name",name==null?"未命名设备":name);obj.put("address",address);result(id,obj);}catch(Exception e){error(id,e.getMessage());}}
 private void stopScan(){if(scanner!=null){try{adapter.getBluetoothLeScanner().stopScan(scanner);}catch(Exception ignored){}scanner=null;}}
 private void finishScanError(String text){stopScan();int id=scanId;scanId=-1;if(picker!=null){picker.dismiss();picker=null;}error(id,text);}
 @Override public void onRequestPermissionsResult(int request,String[] names,int[] grants){super.onRequestPermissionsResult(request,names,grants);if(request==10&&scanId>=0){if(grants.length==0){finishScanError("已取消蓝牙权限申请");return;}for(int g:grants)if(g!=PackageManager.PERMISSION_GRANTED){finishScanError("需要蓝牙附近设备权限才能连接充电桩");return;}beginScan();}}
 @Override protected void onActivityResult(int request,int status,Intent data){super.onActivityResult(request,status,data);if(request==11&&scanId>=0){if(status==RESULT_OK)beginScan();else finishScanError("请开启蓝牙后重试");}
  if(request==12){try{if(status==RESULT_OK&&data!=null&&data.getData()!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out!=null)out.write(exportText.getBytes("UTF-8"));}Toast.makeText(this,"日志已保存",Toast.LENGTH_SHORT).show();}}catch(Exception e){Toast.makeText(this,"保存日志失败",Toast.LENGTH_LONG).show();}finally{exportText="";}}
 }
 private void connect(int id,String address){
  closeGatt("切换蓝牙连接");connectId=id;gatt=adapter.getRemoteDevice(address).connectGatt(this,false,callback,BluetoothDevice.TRANSPORT_LE);
  final BluetoothGatt target=gatt;ui.postDelayed(()->{if(gatt==target&&connectId==id){error(connectId,"连接超时，请靠近充电桩重试");connectId=-1;closeGatt("连接超时");}},30000);
 }
 private final BluetoothGattCallback callback=new BluetoothGattCallback(){
  @Override public void onConnectionStateChange(BluetoothGatt g,int status,int state){ui.post(()->{if(g!=gatt)return;if(status==0&&state==BluetoothProfile.STATE_CONNECTED){if(!g.requestMtu(100))g.discoverServices();ui.postDelayed(()->{if(g==gatt&&connectId>=0)g.discoverServices();},1500);}else if(state==BluetoothProfile.STATE_DISCONNECTED||status!=0){error(connectId,"连接断开，状态码 "+status);connectId=-1;closeGatt("蓝牙已断开，状态码 "+status);}});}
  @Override public void onMtuChanged(BluetoothGatt g,int mtu,int status){ui.post(()->{if(g==gatt&&connectId>=0)g.discoverServices();});}
  @Override public void onServicesDiscovered(BluetoothGatt g,int status){ui.post(()->{if(g!=gatt||connectId<0)return;try{
   if(status!=0)throw new Exception("发现服务失败 "+status);BluetoothGattService service=g.getService(SERVICE);if(service==null)throw new Exception("未找到 FFF0 服务，该桩协议暂不支持");
   JSONArray arr=new JSONArray();chars.clear();for(BluetoothGattCharacteristic c:service.getCharacteristics()){String code=c.getUuid().toString().substring(4,8);chars.put(code,c);JSONObject obj=new JSONObject();obj.put("code",code);obj.put("uuid",c.getUuid().toString());obj.put("properties",c.getProperties());arr.put(obj);}
   if(!chars.containsKey("fff3")||!chars.containsKey("fff4"))throw new Exception("缺少 FFF3/FFF4 特征");int id=connectId;connectId=-1;result(id,arr);
  }catch(Exception e){error(connectId,e.getMessage());connectId=-1;closeGatt(e.getMessage());}});}
  @Override public void onDescriptorWrite(BluetoothGatt g,BluetoothGattDescriptor d,int status){ui.post(()->{if(g==gatt&&operationKind.equals("subscribe")&&d.getCharacteristic().getUuid().toString().substring(4,8).equals(operationCode))completeOperation(status);});}
  @Override public void onCharacteristicWrite(BluetoothGatt g,BluetoothGattCharacteristic c,int status){ui.post(()->{if(g==gatt&&operationKind.equals("write")&&c.getUuid().toString().substring(4,8).equals(operationCode))completeOperation(status);});}
  @Override public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic c){notifyBytes(g,c,c.getValue());}
  @Override public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic c,byte[] value){notifyBytes(g,c,value);}
 };
 private void notifyBytes(BluetoothGatt g,BluetoothGattCharacteristic c,byte[] value){if(value==null)return;final byte[] copy=value.clone();final String code=c.getUuid().toString().substring(4,8);ui.post(()->{if(g==gatt)js("window.NativeBLE.notification("+JSONObject.quote(code)+","+JSONObject.quote(Base64.encodeToString(copy,Base64.NO_WRAP))+")");});}
 private boolean beginOperation(int id,String kind,String code){if(gatt==null){error(id,"没有蓝牙连接");return false;}if(operationId>=0){error(id,"已有 GATT 操作等待完成");return false;}operationId=id;operationKind=kind;operationCode=code;operationTimeout=()->{if(operationId==id){error(id,"GATT 操作超时，请重新连接");operationId=-1;closeGatt("GATT 操作超时");}};ui.postDelayed(operationTimeout,10000);return true;}
 private void drainOperation(){if(operationId<0&&!operations.isEmpty()){Runnable next=operations.poll();queuedIds.poll();next.run();}}
 private void completeOperation(int status){int id=operationId;String kind=operationKind,code=operationCode;operationId=-1;operationKind="";ui.removeCallbacks(operationTimeout);if(status==0){result(id,null);drainOperation();}else{error(id,"安卓 GATT "+kind+"/"+code.toUpperCase()+" 失败，状态码 "+status+" (0x"+Integer.toHexString(status)+")");if(kind.equals("write"))drainOperation();else closeGatt("GATT 通知订阅失败");}}
 private void subscribe(int id,String code)throws Exception{
  BluetoothGattCharacteristic c=chars.get(code);if(c==null){error(id,"未找到通知特征 "+code);return;}BluetoothGattDescriptor d=c.getDescriptor(CCCD);if(d==null){error(id,"没有通知描述符 "+code);return;}if(!beginOperation(id,"subscribe",code))return;
  if(!gatt.setCharacteristicNotification(c,true)){completeOperation(-1);return;}
  byte[] value=(c.getProperties()&BluetoothGattCharacteristic.PROPERTY_NOTIFY)!=0?BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE:BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
  boolean ok;if(Build.VERSION.SDK_INT>=33)ok=gatt.writeDescriptor(d,value)==BluetoothStatusCodes.SUCCESS;else{d.setValue(value);ok=gatt.writeDescriptor(d);}if(!ok)completeOperation(-1);
 }
 private void write(int id,String code,byte[] bytes,boolean response)throws Exception{
  if(!code.equals("fff3")&&!code.equals("fff6")){error(id,"不允许写入此特征");return;}if(bytes.length>20){error(id,"数据长度超过本工具允许范围");return;}
  BluetoothGattCharacteristic c=chars.get(code);if(c==null){error(id,"未找到写入特征 "+code);return;}if(!beginOperation(id,"write",code))return;
  int type=response?BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT:BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;boolean ok;
  if(Build.VERSION.SDK_INT>=33)ok=gatt.writeCharacteristic(c,bytes,type)==BluetoothStatusCodes.SUCCESS;else{c.setWriteType(type);c.setValue(bytes);ok=gatt.writeCharacteristic(c);}if(!ok)completeOperation(-1);
 }
 private void closeGatt(String reason){
  while(!queuedIds.isEmpty())error(queuedIds.poll(),reason);operations.clear();
  if(operationTimeout!=null)ui.removeCallbacks(operationTimeout);if(operationId>=0){error(operationId,reason);operationId=-1;}operationKind="";
  if(connectId>=0){error(connectId,reason);connectId=-1;}
  BluetoothGatt old=gatt;gatt=null;chars.clear();if(old!=null){try{old.disconnect();old.close();}catch(Exception ignored){}js("window.NativeBLE.disconnected()");}
 }
 @Override protected void onStop(){super.onStop();if(scanId<0)closeGatt("应用进入后台，蓝牙连接已关闭");}
 @Override protected void onDestroy(){finishScanError("应用已关闭");closeGatt("应用已关闭");loaded=false;web.removeJavascriptInterface("AndroidBLE");web.destroy();super.onDestroy();}
}
