// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestChallengeJSONArguments(t *testing.T) {
	script := `init([],"old","/_fs-ch-test"); init ( [{"ty":"clientmetrics","data":{"items":[[1,2]],"text":"brackets ] and escaped \" quotes"}}], "token", "/_fs-ch-test", true);`
	tasks, token, err := parseChallengeInit(script, "/_fs-ch-test")
	if err != nil || len(tasks) != 1 || token != "token" {
		t.Fatalf("nested challenge rejected: %v", err)
	}
	for _, invalid := range []string{`init([],"t","/_fs-ch-test")`, `init([{"ty":"pow"}],"t","/other")`, `init([runUntrustedCode()],"t","/_fs-ch-test")`, `init([{"ty":"pow"}],"t","/_fs-ch-test" + runUntrustedCode())`} {
		if _, _, err := parseChallengeInit(invalid, "/_fs-ch-test"); err == nil {
			t.Fatal("invalid challenge accepted")
		}
	}
}

func TestAccountChallengeKeepsUserAgentAndFreshCookies(t *testing.T) {
	b := NewBackend(&testHost{}, "{}")
	site, _ := url.Parse("https://accounts.firefox.com/")
	b.client.Jar.SetCookies(site, []*http.Cookie{{Name: "stale", Value: "clearance", Path: "/"}})
	var agents []string
	b.client.Transport = exitRoundTripper(func(r *http.Request) (*http.Response, error) {
		agents = append(agents, r.UserAgent())
		if _, err := r.Cookie("stale"); err == nil {
			t.Fatal("Stale challenge cookies reached the fresh solver")
		}
		response := &http.Response{StatusCode: 200, Header: make(http.Header), Request: r}
		body := "{}"
		switch {
		case r.URL.Hostname() == "api.accounts.firefox.com":
			if r.Method == "POST" {
				cookie, err := r.Cookie("clearance")
				if err != nil || cookie.Value != "accepted" {
					t.Fatal("verification cookie not installed on API host")
				}
				body = `{"ok":true}`
			}
		case r.URL.Path == "/":
			body = `<title>Client Challenge</title>/_fs-ch-test`
		case strings.HasSuffix(r.URL.Path, "script.js"):
			body = `init ([{"ty":"clientmetrics","data":{"nested":[[1,2]]}}], "token", "/_fs-ch-test", true)`
		case strings.HasSuffix(r.URL.Path, "fst-post-back"):
			body = `{"status":"success"}`
			response.Header.Set("Set-Cookie", "clearance=accepted; Domain=firefox.com; Path=/; HttpOnly")
		default:
			t.Fatal("Unexpected verification request")
		}
		response.Body = io.NopCloser(strings.NewReader(body))
		return response, nil
	})
	if err := b.challenge(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := b.fetch(context.Background(), "https://api.accounts.firefox.com/v1/account/login", "POST", []byte("{}"), nil); err != nil {
		t.Fatal(err)
	}
	for _, agent := range agents {
		if agent != accountAgent {
			t.Fatal("Account user agent changed during verification")
		}
	}
}

func TestFirefoxOnlyTreatsGenuine406AsChallenge(t *testing.T) {
 addr:="https://api.accounts.firefox.com/v1/account/login"
 for _,tc:=range []struct{status int;body,addr string;want bool}{
  {406,"",addr,true},
  {406,"   ",addr,true},
  {406,"<html>Client Challenge /_fs-ch-example</html>",addr,true},
  {406,`{"message":"Account rejected","errno":123}`,addr,false},
  {406,"Provider rejection",addr,false},
  {406,"", "https://vpn.mozilla.org/api/v1/fpn/token",false},
  {401,"",addr,false},
 }{
  got:=shouldSolveFirefoxChallenge(tc.status,[]byte(tc.body),tc.addr)
  if got!=tc.want{t.Errorf("status %d expected challenge=%v got %v",tc.status,tc.want,got)}
 }
}

func TestStructured406NeverReplaysAccountPassword(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 posts:=0
 b.client.Transport=exitRoundTripper(func(req *http.Request)(*http.Response,error){
  if req.Method!=http.MethodPost {t.Fatal("unexpected challenge probe")}
  posts++
  return &http.Response{StatusCode:406,Header:http.Header{},
   Body:io.NopCloser(strings.NewReader(`{"message":"Account rejected","errno":123}`)),
   Request:req},nil
 })
 _,_,err:=b.jsonRequest(context.Background(),"https://api.accounts.firefox.com/v1/account/login",
   http.MethodPost,object{"authPW":"sensitive"},"")
 var service *serviceError
 if !errors.As(err,&service)||service.status!=406 {t.Fatalf("expected original provider rejection: %v",err)}
 if posts!=1 {t.Fatalf("password request sent %d times",posts)}
}

func TestChallengeSuccessWithoutCookieIsNotAccepted(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 b.client.Transport=exitRoundTripper(func(req *http.Request)(*http.Response,error){
  body:="{}"
  switch {
   case req.URL.Hostname()=="api.accounts.firefox.com": body="{}"
   case req.URL.Path=="/": body="<title>Client Challenge</title>/_fs-ch-test"
   case strings.HasSuffix(req.URL.Path,"script.js"): body=`init ([{"ty":"clientmetrics","data":{}}], "token", "/_fs-ch-test", true)`
   case strings.HasSuffix(req.URL.Path,"fst-post-back"): body=`{"status":"success"}`
   default: t.Fatal("unexpected request")
  }
  return &http.Response{StatusCode:200,Header:http.Header{},Request:req,
   Body:io.NopCloser(strings.NewReader(body))},nil
 })
 err:=b.challenge(context.Background())
 if err==nil||!strings.Contains(err.Error(),"without a verification cookie"){
  t.Fatalf("missing challenge cookie was accepted: %v",err)
 }
}

func TestNativeImageCaptchaUsesHumanAnswerAndInstallsCookie(t *testing.T) {
 host:=&testHost{captchaAnswer:" aB42 "}
 b:=NewBackend(host,"{}")
 image:="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLafAAAAABJRU5ErkJggg=="
 postbacks:=0
 b.client.Transport=exitRoundTripper(func(req *http.Request)(*http.Response,error){
  body:="{}"
  header:=http.Header{}
  switch {
   case req.URL.Hostname()=="api.accounts.firefox.com": body="{}"
   case req.URL.Path=="/": body="<title>Client Challenge</title>/_fs-ch-test"
   case strings.HasSuffix(req.URL.Path,"script.js"):
    body=`init ([{"ty":"captcha","data":{"image_b64":"`+image+`"}}], "token", "/_fs-ch-test", true)`
   case strings.HasSuffix(req.URL.Path,"fst-post-back"):
    var posted object
    raw,err:=io.ReadAll(req.Body)
    if err!=nil||json.Unmarshal(raw,&posted)!=nil{t.Fatal("invalid captcha answer body")}
    answers:=list(posted,"data")
    if len(answers)!=1 {t.Fatal("missing human answer")}
    reply,_:=answers[0].(map[string]any)
    if str(reply,"ty")!="captcha"||str(reply,"answer")!="aB42"{t.Fatal("wrong captcha response")}
    postbacks++
    body=`{"status":"success"}`
    header.Set("Set-Cookie","clearance=valid; Domain=firefox.com; Path=/; HttpOnly")
   default: t.Fatal("unexpected verification request")
  }
  return &http.Response{StatusCode:200,Header:header,Body:io.NopCloser(strings.NewReader(body)),Request:req},nil
 })
 if err:=b.challenge(context.Background());err!=nil{t.Fatal(err)}
 if postbacks!=1 {t.Fatalf("CAPTCHA postback count %d",postbacks)}
 if !validCaptchaImage(image) || validCaptchaImage("data:text/html;base64,"+strings.Repeat("A",40)) {
  t.Fatal("unsafe CAPTCHA images accepted")
 }
}
