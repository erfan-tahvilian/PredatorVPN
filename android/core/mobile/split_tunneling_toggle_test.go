// SPDX-License-Identifier: GPL-3.0-or-later
package mobile

import (
 "encoding/json"
 "testing"
)

func TestSplitTunnelingOffDisablesPackageExclusionsWithoutLosingSelection(t *testing.T) {
 b:=NewBackend(&testHost{},"{}")
 b.mu.Lock()
 b.settings["splitTunnelingEnabled"]=false
 b.settings["excludedApps"]=[]any{"com.android.chrome"}
 b.settings["splitMode"]="include"
 b.mu.Unlock()
 var config struct { Inbounds []struct {Exclude []string `json:"exclude_package"`} `json:"inbounds"` }
 if err:=json.Unmarshal([]byte(b.EngineConfig()),&config);err!=nil {t.Fatal(err)}
 if len(config.Inbounds)==0 || len(config.Inbounds[0].Exclude)!=0 {t.Fatalf("split off must omit app filters: %+v",config.Inbounds)}
 b.mu.Lock()
 selected:=list(b.settings,"excludedApps")
 b.mu.Unlock()
 if len(selected)!=1 || selected[0]!="com.android.chrome" {t.Fatalf("app selection lost when split disabled: %v",selected)}
 b.mu.Lock()
 b.settings["splitTunnelingEnabled"]=true
 b.mu.Unlock()
 if err:=json.Unmarshal([]byte(b.EngineConfig()),&config);err!=nil {t.Fatal(err)}
 if len(config.Inbounds[0].Exclude)!=1 || config.Inbounds[0].Exclude[0]!="com.android.chrome" {t.Fatalf("split on must restore app filters: %+v",config.Inbounds)}
}
