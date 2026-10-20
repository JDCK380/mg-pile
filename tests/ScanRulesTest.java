import local.mglive.piledebug.ScanRules;
public class ScanRulesTest {
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[] args){
  check(ScanRules.isPile("AY12ARM269A1B2C"));check(ScanRules.isPile("ayabarm26901234"));
  check(!ScanRules.isPile("AY12ARM269A1B2"));check(!ScanRules.isPile("AY12ARM269A1B2CD"));check(!ScanRules.isPile("AY12ARM269A1B-C"));check(!ScanRules.isPile(null));check(!ScanRules.isPile("HEADPHONES"));
  check(ScanRules.visible("",true,null));check(!ScanRules.visible("",false,"HEADPHONES"));check(ScanRules.visible("",false,"AY12ARM269A1B2C"));
  check(ScanRules.matchesTarget(" ay12arm269a1b2c ","AY12ARM269A1B2C"));check(!ScanRules.matchesTarget("ARM269","AY12ARM269A1B2C"));check(!ScanRules.matchesTarget("",null));
  check(!ScanRules.visible("AY12ARM269A1B2C",true,"HEADPHONES"));
  System.out.println("Scan rules passed: exact pattern, full name direct connection, all-devices toggle, unnamed devices and case-insensitive match.");
 }
}
