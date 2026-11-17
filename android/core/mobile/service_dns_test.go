// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "errors"
 "net"
 "net/netip"
 "strings"
 "testing"
)

func TestServiceDNSRecoveryBeforeHTTPSRequest(t *testing.T) {
 attempts:=[]string{}
 var peer net.Conn
 direct:=func(ctx context.Context, network,address string)(net.Conn,error){
  attempts=append(attempts,address)
  if strings.Contains(address,"vpn.mozilla.org") {
   return nil,&net.DNSError{Err:"i/o timeout",Name:"vpn.mozilla.org",IsTemporary:true,IsTimeout:true}
  }
  a,b:=net.Pipe();peer=b;return a,nil
 }
 consulted:=0
 lookup:=func(_ context.Context,host string)([]netip.Addr,error){
  consulted++
  if host!="vpn.mozilla.org"{t.Fatalf("wrong DNS hostname %s",host)}
  return []netip.Addr{netip.MustParseAddr("1.2.3.4")},nil
 }
 conn,err:=dialProviderService(context.Background(),"tcp","vpn.mozilla.org:443",direct,lookup,true)
 if err!=nil{t.Fatal(err)}
 conn.Close();peer.Close()
 if consulted!=1||len(attempts)!=2||attempts[1]!="1.2.3.4:443"{t.Fatalf("recovery path=%v lookups=%d",attempts,consulted)}
}

func TestServiceDNSNeverChangesErrorsWhenNotEligible(t *testing.T){
 dnsError:=&net.DNSError{Err:"no such host",Name:"vpn.mozilla.org",IsNotFound:true}
 attempts:=0;lookup:=0
 direct:=func(context.Context,string,string)(net.Conn,error){attempts++;return nil,dnsError}
 resolve:=func(context.Context,string)([]netip.Addr,error){lookup++;return []netip.Addr{netip.MustParseAddr("1.2.3.4")},nil}
 for _,tc:=range []struct{address string;enabled bool}{
  {"vpn.mozilla.org:443",false},
  {"malicious.example:443",true},
  {"1.1.1.1:443",true},
  {"vpn.mozilla.org:443",true},
 } {
  _,err:=dialProviderService(context.Background(),"tcp",tc.address,direct,resolve,tc.enabled)
  if !errors.Is(err,dnsError){t.Fatalf("changed original error for %s: %v",tc.address,err)}
 }
 if attempts!=4||lookup!=0{t.Fatalf("unsafe retry attempts=%d encrypted queries=%d",attempts,lookup)}
 for _,host:=range []string{"vpn.mozilla.org.evil.test","anything.mozilla.org","evil.com",""}{
  if serviceDNSRecoveryTarget(host){t.Fatalf("Unexpected third-party hostname %s",host)}
 }
 for _,host:=range []string{"vpn.mozilla.org","firefox.settings.services.mozilla.com","api.accounts.firefox.com"}{
  if !serviceDNSRecoveryTarget(host){t.Fatalf("Official provider not supported %s",host)}
 }
}

func TestServiceDNSRespectsCancellation(t *testing.T){
 ctx,cancel:=context.WithCancel(context.Background());cancel()
 calls:=0
 dial:=func(context.Context,string,string)(net.Conn,error){calls++;return nil,context.Canceled}
 lookup:=func(context.Context,string)([]netip.Addr,error){t.Fatal("Canceled request used DNS recovery");return nil,nil}
 _,err:=dialProviderService(ctx,"tcp","vpn.mozilla.org:443",dial,lookup,true)
 if !errors.Is(err,context.Canceled)||calls!=1{t.Fatalf("Unexpected canceled result %v calls=%d",err,calls)}
}

func TestSubscriptionUpgradeRemovesFormerRepoFeed(t *testing.T){
 const other="https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/top100.txt"
 settings:=defaults()
 if urls:=list(settings,"bootstrapSubUrls");len(urls)!=1||urls[0]!=other{t.Fatalf("Wrong defaults: %v",urls)}
 cases:=[]struct{input []any;want []any}{
  {[]any{removedBootstrapSubscription,other},[]any{other}},
  {[]any{removedBootstrapMirror},[]any{other}},
  {[]any{removedBootstrapSubscription},[]any{other}},
  {[]any{},[]any{}},
  {[]any{removedBootstrapSubscription,"https://example.org/custom",other},[]any{"https://example.org/custom",other}},
 }
 for _,c:=range cases {
  item:=defaults();item["bootstrapSubUrls"]=c.input
  if err:=validate(item);err!=nil{t.Fatal(err)}
  got:=list(item,"bootstrapSubUrls")
  if len(got)!=len(c.want){t.Fatalf("migrated %v, expected %v",got,c.want)}
  for i:=range got {if got[i]!=c.want[i] {t.Fatalf("migrated %v, expected %v",got,c.want)}}
 }
 legacy:=defaults();delete(legacy,"bootstrapSubUrls");legacy["bootstrapSubUrl"]=removedBootstrapSubscription
 if err:=validate(legacy);err!=nil{t.Fatal(err)}
 urls:=list(legacy,"bootstrapSubUrls")
 if len(urls)!=1||urls[0]!=other{t.Fatalf("Legacy URL remained: %v",urls)}
}
