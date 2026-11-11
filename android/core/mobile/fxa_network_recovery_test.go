// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "errors"
 "net"
 "net/http"
 "io"
 "strings"
 "testing"
)

func TestFirefoxAccountRecoveryTargetIsStrict(t *testing.T) {
 for _,target:=range []string{
  "https://api.accounts.firefox.com/v1/account/login",
  "https://api.accounts.firefox.com/v1/oauth/token",
  "https://accounts.firefox.com/",
 }{
  if !firefoxAccountRecoveryTarget(target){t.Errorf("rejected official account endpoint %s",target)}
 }
 for _,target:=range []string{
  "http://api.accounts.firefox.com/v1/account/login",
  "https://api.accounts.firefox.com:444/v1/account/login",
  "https://evil.api.accounts.firefox.com/v1/account/login",
  "https://user:pass@api.accounts.firefox.com/v1/account/login",
  "https://vpn.mozilla.org/api/v1/fpn/token",
  "https://api.accounts.firefox.com.evil.test/v1/account/login",
 }{
  if firefoxAccountRecoveryTarget(target){t.Errorf("unsafe account proxy target accepted %s",target)}
 }
}

func TestFirefoxTransportRecoveryNeverRetriesCancelledParent(t *testing.T) {
 alive:=context.Background()
 if !recoverableFirefoxTransportError(alive,context.DeadlineExceeded){t.Fatal("timeout not classified")}
 if !recoverableFirefoxTransportError(alive,&net.DNSError{Err:"no such host",Name:"test.invalid"}){t.Fatal("DNS failure not classified")}
 if recoverableFirefoxTransportError(alive,nil){t.Fatal("no error should not trigger recovery")}
 closed,cancel:=context.WithCancel(alive)
 cancel()
 if recoverableFirefoxTransportError(closed,context.DeadlineExceeded){t.Fatal("canceled parent retried")}
 if recoverableFirefoxTransportError(alive,errors.New("HTTP 401")){t.Fatal("HTTP/service error retried")}
}

func TestFirefoxAuthRecoveryOptInAndSessionReset(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 if enabled,_:=b.accountProxyState();enabled{t.Fatal("auth proxy enabled by default")}
 b.mu.Lock()
 b.settings["subscriptionsEnabled"]=true
 b.settings["accountRecoveryEnabled"]=true
 b.fxaProxyNode=&bootstrapNode{raw:"private-node",outbound:object{}}
 b.mu.Unlock()
 enabled,node:=b.accountProxyState()
 if !enabled||node==nil||node.raw!="private-node"{t.Fatal("opt-in session not tracked")}
 b.resetAccountProxy()
 _,node=b.accountProxyState()
 if node!=nil{t.Fatal("temporary session not released")}
 b.mu.Lock()
 b.settings["subscriptionsEnabled"]=false
 b.mu.Unlock()
 if enabled,_=b.accountProxyState();enabled{t.Fatal("account recovery must require subscriptions")}
}

func TestFirefoxLoginNoImplicitProxyAfterDirectTimeout(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 b.client.Transport=exitRoundTripper(func(*http.Request)(*http.Response,error){
  return nil,context.DeadlineExceeded
 })
 _,_,_,err:=b.fetch(context.Background(),"https://api.accounts.firefox.com/v1/account/login","POST",[]byte("{}"),nil)
 if err==nil||!errors.Is(err,context.DeadlineExceeded) {
  t.Fatalf("direct errors must remain unchanged without explicit consent: %v",err)
 }
 if strings.Contains(err.Error(),"private-node"){t.Fatal("node identity leaked")}
}


func TestFirefoxConsentedPOSTNeverReplayedAfterTimeout(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 b.mu.Lock()
 b.settings["subscriptionsEnabled"]=true
 b.settings["accountRecoveryEnabled"]=true
 b.mu.Unlock()
 preflight,posts:=0,0
 b.client.Transport=exitRoundTripper(func(req *http.Request)(*http.Response,error){
  if req.Method==http.MethodGet {
   preflight++
   if req.URL.Hostname()!="api.accounts.firefox.com" || req.URL.Path!="/" {
    t.Fatal("unexpected preflight target")
   }
   if req.Header.Get("Authorization")!="" || req.Header.Get("Cookie")!="" {
    t.Fatal("preflight included account credentials")
   }
   return &http.Response{StatusCode:200,Header:http.Header{},Body:io.NopCloser(strings.NewReader("{}")),Request:req},nil
  }
  posts++
  return nil,context.DeadlineExceeded
 })
 _,_,_,err:=b.fetch(context.Background(),"https://api.accounts.firefox.com/v1/account/login",http.MethodPost,[]byte(`{"authPW":"sensitive"}`),nil)
 if err==nil || !errors.Is(err,context.DeadlineExceeded){t.Fatalf("lost original failure: %v",err)}
 if preflight!=1 || posts!=1 {t.Fatalf("unexpected request replay: preflight=%d posts=%d",preflight,posts)}
}

func TestFirefoxPreflightHTTP406IsNotAuthenticationSuccess(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 b.client.Transport=exitRoundTripper(func(req *http.Request)(*http.Response,error){
  if req.Method!=http.MethodGet {t.Fatal("preflight sent a state-changing method")}
  return &http.Response{StatusCode:406,Header:http.Header{},Body:io.NopCloser(strings.NewReader("challenge")),Request:req},nil
 })
 reachable,err:=b.firefoxDirectReachable(context.Background())
 if err!=nil || !reachable {t.Fatalf("HTTP 406 should only prove transport reachable: %v",err)}
}

func TestFirefoxPreflightHTTP451TriggersAlternateRouteSelection(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 b.client.Transport=exitRoundTripper(func(req *http.Request)(*http.Response,error){
  return &http.Response{StatusCode:451,Header:http.Header{},Body:io.NopCloser(strings.NewReader("")),Request:req},nil
 })
 reachable,err:=b.firefoxDirectReachable(context.Background())
 if err!=nil || reachable {t.Fatalf("HTTP 451 should mark direct route blocked: %v",err)}
}

func TestFirefoxReadOnlyMethods(t *testing.T) {
 if !firefoxReadOnlyMethod(http.MethodGet) || !firefoxReadOnlyMethod(http.MethodHead) ||
    firefoxReadOnlyMethod(http.MethodPost) || firefoxReadOnlyMethod(http.MethodPatch) || firefoxReadOnlyMethod(http.MethodDelete) {
  t.Fatal("non-idempotent requests must never be replayed automatically")
 }
}
