// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "crypto/x509"
 "errors"
 "net"
 "net/http"
 "net/url"
 "strings"
 "time"
)

// Only these HTTPS origins are eligible for Firefox Accounts network recovery.
// The temporary proxy retains normal X.509 validation and the canonical host.
func firefoxAccountRecoveryTarget(address string) bool {
 u,err:=url.Parse(address)
 if err!=nil || u.Scheme!="https" || u.Port()!="" || u.User!=nil {return false}
 host:=strings.ToLower(u.Hostname())
 return host=="api.accounts.firefox.com" || host=="accounts.firefox.com"
}

// Never treat an expired parent context, HTTP error, or a canceled operation
// as permission to submit a second account request.
func recoverableFirefoxTransportError(ctx context.Context,err error) bool {
 if err==nil || ctx.Err()!=nil {return false}
 // An invalid HTTPS certificate is a security failure, never a network retry.
 var certUnknown x509.UnknownAuthorityError
 if errors.As(err,&certUnknown){return false}
 var certInvalid x509.CertificateInvalidError
 if errors.As(err,&certInvalid){return false}
 var certHostname x509.HostnameError
 if errors.As(err,&certHostname){return false}
 if errors.Is(err,context.DeadlineExceeded){return true}
 var netErr net.Error
 if errors.As(err,&netErr) && netErr.Timeout(){return true}
 var dnsErr *net.DNSError
 if errors.As(err,&dnsErr){return true}
 var opErr *net.OpError
 return errors.As(err,&opErr)
}

// A read-only request can be retried on an alternate route. A POST cannot.
func firefoxReadOnlyMethod(method string) bool {
 return method == http.MethodGet || method == http.MethodHead
}

// The connectivity test must never carry account cookies or credentials.
// Any completed HTTP response (except an explicit regional block) means
// that direct TLS transport reached Firefox Accounts; 406 is not login success.
func (b *Backend) firefoxDirectReachable(ctx context.Context) (bool,error) {
 probeCtx,cancel:=context.WithTimeout(ctx,5*time.Second)
 defer cancel()
 probe:=&http.Client{
  Transport:b.client.Transport,
  Timeout:5*time.Second,
  CheckRedirect:func(*http.Request,[]*http.Request)error{return http.ErrUseLastResponse},
 }
 _,_,status,err:=b.fetchUsing(probeCtx,probe,
  "https://api.accounts.firefox.com/",http.MethodGet,nil,http.Header{})
 if err!=nil{return false,err}
 return status!=http.StatusUnavailableForLegalReasons,nil
}

// Challenge pages must use the same temporary egress as the login that
// triggered HTTP 406; otherwise carrier blocks can recur mid-verification.
// Its cookie jar is isolated until verification has actually succeeded.
func (b *Backend) newFirefoxChallengeSolver(jar http.CookieJar) *Backend {
 enabled,node:=b.accountProxyState()
 return &Backend{
  client:&http.Client{Transport:b.client.Transport,Jar:jar,Timeout:b.client.Timeout,CheckRedirect:b.client.CheckRedirect},
  roots:b.roots,
  host:b.host,
  settings:object{"subscriptionsEnabled":enabled,"accountRecoveryEnabled":enabled},
  fxaProxyNode:node,
 }
}

func (b *Backend) accountProxyState() (bool,*bootstrapNode) {
 b.mu.Lock()
 defer b.mu.Unlock()
 enabled:=yes(b.settings,"subscriptionsEnabled") && yes(b.settings,"accountRecoveryEnabled")
 if !enabled || b.fxaProxyNode==nil {return enabled,nil}
 node:=*b.fxaProxyNode
 return true,&node
}
func (b *Backend) resetAccountProxy() {
 b.mu.Lock()
 b.fxaProxyNode=nil
 b.mu.Unlock()
}

func (b *Backend) fetchViaFirefoxNode(ctx context.Context,node bootstrapNode,address,method string,body []byte,headers http.Header)([]byte,http.Header,int,error){
 port,err:=freeBootstrapPort()
 if err!=nil{return nil,nil,0,err}
 engine,err:=startBootstrapBox(node,port)
 if err!=nil{return nil,nil,0,err}
 defer engine.Close()
 client:=b.bootstrapClient(port)
 defer client.CloseIdleConnections()
 attempt,stop:=context.WithTimeout(ctx,10*time.Second)
 defer stop()
 return b.fetchUsing(attempt,client,address,method,body,headers)
}

// A TLS-verified, unauthenticated preflight checks a candidate before a
// credential-bearing POST. No account request is retried across multiple
// proxy endpoints: a timed-out POST might already have reached Firefox.
func (b *Backend) retryFirefoxViaSubscription(ctx context.Context,address,method string,body []byte,headers http.Header)([]byte,http.Header,int,error){
 b.bootstrapMu.Lock()
 defer b.bootstrapMu.Unlock()
 ctx,stop:=context.WithTimeout(ctx,50*time.Second)
 defer stop()
 sources:=b.bootstrapSources()
 catalog:=make([][]bootstrapNode,0,len(sources))
 for _,source:=range sources {
  if ctx.Err()!=nil {break}
  nodes,err:=b.fetchBootstrapNodes(ctx,source)
  if err==nil {catalog=append(catalog,nodes)}
 }
 for _,node:=range prioritizeBootstrapNodes(catalog,parseBootstrapNodes(b.host.BootstrapNodes())){
  if ctx.Err()!=nil {break}
  port,err:=freeBootstrapPort()
  if err!=nil{continue}
  engine,err:=startBootstrapBox(node,port)
  if err!=nil{continue}
  client:=b.bootstrapClient(port)
  // Root request sends no password, token, cookie, or account ID.
  client.Jar=nil
  probeCtx,cancelProbe:=context.WithTimeout(ctx,5*time.Second)
  _,_,status,probeErr:=b.fetchUsing(probeCtx,client,"https://api.accounts.firefox.com/",http.MethodGet,nil,http.Header{})
  cancelProbe()
  if probeErr!=nil || status==http.StatusUnavailableForLegalReasons || status>=500 {
   client.CloseIdleConnections()
   engine.Close()
   continue
  }
  // A verified route is selected. Send the original request at most once.
  // Use the normal account cookie jar, with no TLS verification bypass.
  client.Jar=b.client.Jar
  requestCtx,cancelRequest:=context.WithTimeout(ctx,10*time.Second)
  data,h,code,requestErr:=b.fetchUsing(requestCtx,client,address,method,body,headers)
  cancelRequest()
  client.CloseIdleConnections()
  engine.Close()
  if requestErr==nil {
   b.mu.Lock()
   selected:=node
   b.fxaProxyNode=&selected
   b.mu.Unlock()
  }
  return data,h,code,requestErr
 }
 return nil,nil,0,errors.New("Firefox Accounts is unreachable through the configured subscription nodes. Check network access or try another source")
}
