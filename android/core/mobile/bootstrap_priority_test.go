// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "errors"
 "net"
 "reflect"
 "testing"
)

func TestBootstrapPrioritizesWorkingOfflineBeforeStaleOnline(t *testing.T) {
 n:=func(id string)bootstrapNode{return bootstrapNode{raw:id,outbound:object{"tag":"bootstrap"}}}
 sources:=[][]bootstrapNode{{n("a1"),n("a2"),n("a3"),n("a4")},{n("b1"),n("b2"),n("b3")}}
 bundled:=[]bootstrapNode{n("a1"),n("offline1"),n("offline2")}
 got:=prioritizeBootstrapNodes(sources,bundled)
 actual:=make([]string,len(got))
 for i,node:=range got{actual[i]=node.raw}
 expected:=[]string{"a1","a2","b1","b2","offline1","offline2","a3","a4","b3"}
 if !reflect.DeepEqual(actual,expected){t.Fatalf("unexpected fallback order: %v",actual)}
}

func TestBootstrapPrioritizationBoundsAndNoDuplicates(t *testing.T){
 src:=make([]bootstrapNode,bootstrapNodeLimit+10)
 for i:=range src{src[i]=bootstrapNode{raw:string(rune('a'+i)),outbound:object{}}}
 got:=prioritizeBootstrapNodes([][]bootstrapNode{src},nil)
 if len(got)>bootstrapNodeLimit{t.Fatalf("too many bootstrap attempts: %d",len(got))}
 unique:=map[string]bool{}
 for _,node:=range got{
  if unique[node.raw]{t.Fatalf("duplicate node %s",node.raw)}
  unique[node.raw]=true
 }
}

func TestBootstrapDiagnosticsClassifyWithoutLeakingErrors(t *testing.T){
 for _,tc:=range []struct{err error;want string}{
  {context.DeadlineExceeded,"timeout"},
  {&net.DNSError{Err:"no such host",Name:"private.invalid"},"dns"},
  {errors.New("remote TLS: handshake failure with private user"),"tls"},
  {&net.OpError{Op:"dial",Net:"tcp",Err:errors.New("refused")},"dial"},
  {errors.New("private credentials must never be shown"),"other"},
  {nil,"none"},
 }{
  if got:=classifyBootstrapFailure(tc.err);got!=tc.want{t.Fatalf("expected %s, got %s",tc.want,got)}
 }
}
