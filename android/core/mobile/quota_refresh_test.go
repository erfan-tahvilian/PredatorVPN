// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "context"
 "io"
 "net/http"
 "strings"
 "testing"
)

type quotaRefreshRoundTripper struct {
 quotaBlocked bool
}
func (r quotaRefreshRoundTripper) RoundTrip(req *http.Request) (*http.Response,error){
 if strings.HasSuffix(req.URL.Path,"/status"){
  return &http.Response{StatusCode:200,Header:http.Header{},Body:io.NopCloser(strings.NewReader(`{"limited_bandwidth":true,"maxBytes":1000,"uid":"test"}`))},nil
 }
 if strings.HasSuffix(req.URL.Path,"/token"){
  if r.quotaBlocked{
   return &http.Response{StatusCode:451,Header:http.Header{},Body:io.NopCloser(strings.NewReader(`{"message":"Not available in this region"}`))},nil
  }
  headers:=http.Header{}
  headers.Set("x-quota-limit","1000")
  headers.Set("x-quota-remaining","410")
  headers.Set("x-quota-reset","2030")
  return &http.Response{StatusCode:200,Header:headers,Body:io.NopCloser(strings.NewReader(`{"token":"fixture-pass"}`))},nil
 }
 return &http.Response{StatusCode:404,Header:http.Header{},Body:io.NopCloser(strings.NewReader(`{"message":"not found"}`))},nil
}
func TestAllowanceRefreshDoesNotSilentlyConsume451AsSuccess(t *testing.T){
 b:=NewBackend(&testHost{},"{}")
 if err:=b.addAccount(fixtureAuth("quota@example.com","secret"));err!=nil{t.Fatal(err)}
 b.client=&http.Client{Transport:quotaRefreshRoundTripper{quotaBlocked:true}}
 // Do not update the visible quota to an unknown value if the actual quota request is blocked.
 result,err:=b.refreshProfile(context.Background())
 if err==nil||!strings.Contains(err.Error(),"Could not refresh data remaining"){
  t.Fatalf("missing quota error; got result=%v error=%v",result,err)
 }
 b.mu.Lock()
 q:=copyObject(b.quota)
 b.mu.Unlock()
 if q!=nil&&str(q,"remaining")!=""{t.Fatalf("stale quota unexpectedly written %v",q)}
}
func TestAllowanceRefreshRecordsCompleteQuota(t *testing.T){
 b:=NewBackend(&testHost{},"{}")
 if err:=b.addAccount(fixtureAuth("quota@example.com","secret"));err!=nil{t.Fatal(err)}
 b.client=&http.Client{Transport:quotaRefreshRoundTripper{}}
 result,err:=b.refreshProfile(context.Background())
 if err!=nil{t.Fatal(err)}
 d,ok:=result.(map[string]any)
 if !ok||d["quotaRemaining"]!="410"{t.Fatalf("unexpected response %v",result)}
 b.mu.Lock()
 remaining:=str(b.quota,"remaining")
 b.mu.Unlock()
 if remaining!="410"{t.Fatalf("quota was not refreshed; remaining=%q",remaining)}
}
