// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "errors"
 "net/http"
 "time"
)

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
 stats:=object{"sources":len(sources),"sourcesLoaded":0,"sourceFetchFailures":0,"compatibleNodes":0,"nodeAttempts":0,"nodeErrors":0,"regionalBlocks":0,"bundledCompatible":len(bundled),"reachedGuardian":false}
 tried:=make(map[string]bool)
 attempts:=0
 tryNode:=func(node bootstrapNode, origin string)(bool){
  if tried[node.raw]||attempts>=8||ctx.Err()!=nil{return false}
  tried[node.raw]=true
  attempts++
  stats["nodeAttempts"]=attempts
  code,err:=b.probeBootstrapNode(ctx,node)
  if err!=nil{stats["nodeErrors"]=stats["nodeErrors"].(int)+1;return false}
  if code==http.StatusUnavailableForLegalReasons{stats["regionalBlocks"]=stats["regionalBlocks"].(int)+1}
  if code>0&&code!=http.StatusUnavailableForLegalReasons&&code<500 {
   stats["reachedGuardian"]=true
   stats["source"]=origin
   stats["guardianHTTPStatus"]=code
   return true
  }
  return false
 }
 // Prefer the user's configured URLs. Test no more than three compatible nodes
 // from each source to keep the test responsive on restricted mobile networks.
 for i,source:=range sources {
  if ctx.Err()!=nil||attempts>=8||i>=3{break}
  nodes,err:=b.fetchBootstrapNodes(ctx,source)
  if err!=nil{stats["sourceFetchFailures"]=stats["sourceFetchFailures"].(int)+1;continue}
  stats["sourcesLoaded"]=stats["sourcesLoaded"].(int)+1
  stats["compatibleNodes"]=stats["compatibleNodes"].(int)+len(nodes)
  attempted:=0
  for _,node:=range nodes{
   if attempted>=3||attempts>=8||ctx.Err()!=nil{break}
   if tried[node.raw]{continue}
   attempted++
   if tryNode(node,"subscription"){return stats,nil}
  }
 }
 // A bundled set avoids dependency on GitHub Raw when it is blocked.
 bundledTried:=0
 for _,node:=range bundled{
  if bundledTried>=4||attempts>=8||ctx.Err()!=nil{break}
  if tried[node.raw]{continue}
  bundledTried++
  if tryNode(node,"bundled"){return stats,nil}
 }
 // Keep technical error text free of node URLs, credentials and account data.
 if ctx.Err()!=nil {stats["status"]="timed_out"} else {stats["status"]="unreachable"}
 if len(sources)==0 && len(bundled)==0{return stats,errors.New("No subscription sources or compatible bundled nodes")}
 if attempts==0{return stats,errors.New("No supported VLESS Reality/gRPC, TCP or WS nodes could be tested")}
 return stats,nil
}
