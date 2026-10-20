package local.mglive.piledebug;
import java.util.Locale;
public final class ScanRules {
 public static boolean isPile(String name){return name!=null&&name.trim().toUpperCase(Locale.ROOT).matches("AY[A-Z0-9]{2}ARM269[A-Z0-9]{5}");}
 public static boolean matchesTarget(String target,String name){return target!=null&&!target.trim().isEmpty()&&name!=null&&target.trim().equalsIgnoreCase(name.trim());}
 public static boolean visible(String target,boolean all,String name){return target!=null&&!target.trim().isEmpty()?matchesTarget(target,name):all||isPile(name);}
}
