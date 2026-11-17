// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "crypto/tls"
 "errors"
 "fmt"
 "net"
 "net/http"
 "net/netip"
 "strings"
 "time"
)

type protectedDial func(context.Context,string,string)(net.Conn,error)
type secureDNSLookup func(context.Context,string)([]netip.Addr,error)

// Only official provider control-plane hosts are eligible for alternate DNS.
// The HTTP request still uses the original HTTPS hostname, so the normal
// certificate and hostname verification cannot be skipped or weakened.
func serviceDNSRecoveryTarget(host string) bool {
 switch strings.ToLower(strings.TrimSuffix(host,".")) {
 case "vpn.mozilla.org","firefox.settings.services.mozilla.com",
      "api.accounts.firefox.com","accounts.firefox.com","oauth.accounts.firefox.com":
  return true
 }
 return false
}
func serviceDNSRecoverable(err error) bool {
 if err==nil {return false}
 var dnsErr *net.DNSError
 if errors.As(err,&dnsErr){return !dnsErr.IsNotFound}
 return errors.Is(err,context.DeadlineExceeded)
}

// Recovery occurs during TCP dialing, before any HTTPS request (including
// state-changing POSTs) can be sent. No HTTP operation is replayed.
func dialProviderService(ctx context.Context,network,address string,direct protectedDial,resolve secureDNSLookup,allowed bool)(net.Conn,error){
 host,port,err:=net.SplitHostPort(address)
 if err!=nil||net.ParseIP(host)!=nil||!allowed{return direct(ctx,network,address)}
 initial,cancel:=context.WithTimeout(ctx,5*time.Second)
 conn,firstErr:=direct(initial,network,address)
 timedOut:=errors.Is(initial.Err(),context.DeadlineExceeded)
 cancel()
 if firstErr==nil||ctx.Err()!=nil||(!timedOut&&!serviceDNSRecoverable(firstErr)){return conn,firstErr}
 lookupCtx,stopLookup:=context.WithTimeout(ctx,7*time.Second)
 addresses,lookupErr:=resolve(lookupCtx,host)
 stopLookup()
 if lookupErr!=nil||len(addresses)==0 {
  return nil,fmt.Errorf("Network DNS lookup failed; encrypted DNS recovery unavailable: %w",firstErr)
 }
 var last error
 for _,ip:=range addresses {
  if !ip.IsValid()||!ip.IsGlobalUnicast()||ip.IsPrivate(){continue}
  attempt,stop:=context.WithTimeout(ctx,4*time.Second)
  conn,last=direct(attempt,network,net.JoinHostPort(ip.String(),port))
  stop()
  if last==nil{return conn,nil}
  if ctx.Err()!=nil{return nil,ctx.Err()}
 }
 if last!=nil{return nil,fmt.Errorf("Provider service could not be reached after secure DNS recovery: %w",last)}
 return nil,fmt.Errorf("No usable encrypted DNS address for provider: %w",firstErr)
}

func (b *Backend) dialProvider(ctx context.Context,network,address string)(net.Conn,error){
 host,_,err:=net.SplitHostPort(address)
 if err!=nil{return b.dialer.DialContext(ctx,network,address)}
 b.mu.Lock()
 provider:=str(b.settings,"doh")
 custom:=str(b.settings,"customDns")
 b.mu.Unlock()
 allowed:=serviceDNSRecoveryTarget(host)&&custom==""&&provider!="off"
 resolve:=func(ctx context.Context,target string)([]netip.Addr,error){
  // Pinned-IP DNS-over-HTTPS: never use the broken system resolver to
  // contact the recovery servers. Protect the socket from VPN re-entry.
  transport:=&http.Transport{
   Proxy:nil,
   DialContext:b.dialer.DialContext,
   TLSClientConfig:&tls.Config{RootCAs:b.roots,MinVersion:tls.VersionTLS12},
   TLSHandshakeTimeout:4*time.Second,
   ForceAttemptHTTP2:true,
  }
  defer transport.CloseIdleConnections()
  client:=&http.Client{Transport:transport,Timeout:7*time.Second,CheckRedirect:func(*http.Request,[]*http.Request)error{return http.ErrUseLastResponse}}
  return encryptedEdges(ctx,target,provider,client)
 }
 return dialProviderService(ctx,network,address,b.dialer.DialContext,resolve,allowed)
}
