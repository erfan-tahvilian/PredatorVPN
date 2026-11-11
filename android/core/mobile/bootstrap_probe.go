// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "errors"
 "net"
 "net/http"
 "strings"
 "time"
)

// classifyBootstrapFailure counts errors without exposing proxy credentials or URLs.
func classifyBootstrapFailure(err error) string {
 if err==nil{return "none"}
 if errors.Is(err,context.DeadlineExceeded){return "timeout"}
 var nerr net.Error
 if errors.As(err,&nerr)&&nerr.Timeout(){return "timeout"}
 var dns *net.DNSError
 if errors.As(err,&dns){return "dns"}
 msg:=strings.ToLower(err.Error())
 if strings.Contains(msg,"certificate")||strings.Contains(msg,"tls:")||strings.Contains(msg,"handshake"){return "tls"}
 var op *net.OpError
 if errors.As(err,&op){return "dial"}
 return "other"
}

// probeBootstrapNode checks actual Guardian reachability through one temporary
// VLESS/SOCKS connection, without a bearer token, cookies or account changes.
func (b *Backend) probeBootstrapNode(ctx context.Context, node bootstrapNode) (int, error) {
 port,err:=freeBootstrapPort()
 if err!=nil{return 0,err}
 engine,err:=startBootstrapBox(node,port)
 if err!=nil{return 0,err}
 defer engine.Close()
 client:=b.bootstrapClient(port)
 client.Jar=nil
 defer client.CloseIdleConnections()
 probeCtx,cancel:=context.WithTimeout(ctx,6*time.Second)
 defer cancel()
 _,_,status,err:=b.fetchUsing(probeCtx,client,"https://vpn.mozilla.org/api/v1/fpn/status",http.MethodGet,nil,http.Header{})
 if err!=nil{return 0,err}
 return status,nil
}

// testSubscriptionConnectivity is an opt-in diagnostic, not a login or VPN.
// It never sends account tokens to subscription nodes and always closes sockets.
func (b *Backend) testSubscriptionConnectivity(ctx context.Context)(any,error){
 // Explicit diagnostics may test configured sources without enabling a
 // persistent automatic fallback or modifying user preferences.
 b.mu.Lock()
 settings:=copyObject(b.settings)
 b.mu.Unlock()
 b.bootstrapMu.Lock()
 defer b.bootstrapMu.Unlock()
 ctx,cancel:=context.WithTimeout(ctx,40*time.Second)
 defer cancel()
 sources:=bootstrapSourcesFromSettings(settings)
 bundled:=parseBootstrapNodes(b.host.BootstrapNodes())
 stats:=object{"sources":len(sources),"sourcesLoaded":0,"sourceFetchFailures":0,"compatibleNodes":0,"nodeAttempts":0,"nodeErrors":0,"failureTypes":object{"timeout":0,"dns":0,"tls":0,"dial":0,"other":0},"regionalBlocks":0,"bundledCompatible":len(bundled),"reachedGuardian":false}
 tried:=make(map[string]bool)
 attempts:=0
 tryNode:=func(node bootstrapNode, origin string)(bool){
  if tried[node.raw]||attempts>=8||ctx.Err()!=nil{return false}
  tried[node.raw]=true
  attempts++
  stats["nodeAttempts"]=attempts
  code,err:=b.probeBootstrapNode(ctx,node)
  if err!=nil{
   stats["nodeErrors"]=stats["nodeErrors"].(int)+1
   kind:=classifyBootstrapFailure(err)
   failures:=stats["failureTypes"].(object)
   failures[kind]=failures[kind].(int)+1
   return false
  }
  if code==http.StatusUnavailableForLegalReasons{stats["regionalBlocks"]=stats["regionalBlocks"].(int)+1}
  if code>0&&code!=http.StatusUnavailableForLegalReasons&&code<500 {
   stats["reachedGuardian"]=true
   stats["source"]=origin
   stats["guardianHTTPStatus"]=code
   return true
  }
  return false
 }
 // The diagnostic uses exactly the same prioritization as HTTP-451 recovery.
 // Check a small number of configured nodes, then bundled recovery candidates.
 catalog:=make([][]bootstrapNode,0,len(sources))
 fromSubscription:=make(map[string]bool)
 for i,source:=range sources {
  if ctx.Err()!=nil||i>=3{break}
  nodes,err:=b.fetchBootstrapNodes(ctx,source)
  if err!=nil{stats["sourceFetchFailures"]=stats["sourceFetchFailures"].(int)+1;continue}
  stats["sourcesLoaded"]=stats["sourcesLoaded"].(int)+1
  stats["compatibleNodes"]=stats["compatibleNodes"].(int)+len(nodes)
  catalog=append(catalog,nodes)
  for _,node:=range nodes{fromSubscription[node.raw]=true}
 }
 for _,node:=range prioritizeBootstrapNodes(catalog,bundled){
  if attempts>=8||ctx.Err()!=nil{break}
  origin:="bundled"
  if fromSubscription[node.raw]{origin="subscription"}
  if tryNode(node,origin){return stats,nil}
 }
 // Keep technical error text free of node URLs, credentials and account data.
 if ctx.Err()!=nil {stats["status"]="timed_out"} else {stats["status"]="unreachable"}
 if len(sources)==0 && len(bundled)==0{return stats,errors.New("No subscription sources or compatible bundled nodes")}
 if attempts==0{return stats,errors.New("No supported VLESS Reality/gRPC, TCP or WS nodes could be tested")}
 return stats,nil
}
