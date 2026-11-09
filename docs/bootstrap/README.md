# Bootstrap proxy (HTTP 451)

Guardian API can return HTTP 451 from restricted regions. Fastly data edges may still work. Bootstrap loads a subscription, probes SOCKS5 nodes, uses the first that can reach `vpn.mozilla.org`, obtains a pass, then clears the temporary upstream and continues with the normal Predator tunnel.

## Sources

1. Primary: `https://config.blackpredator.dpdns.org/sub/...` (see `DEFAULT_SUB_URL` in `src/lib/bootstrap-proxy.cjs`)
2. Mirror: `docs/bootstrap/working-nodes.txt` on GitHub raw (refreshed by workflow)

## Limits

Pure-JS path only uses **SOCKS5** lines. VLESS/VMess need a temporary local sing-box process (not enabled by default).

## Test

```powershell
node -e "require('./src/lib/bootstrap-proxy.cjs').resolveBootstrapUpstream({log:(l,m)=>console.log(l,m)}).then(r=>console.log(r.node)).catch(e=>console.error(e))"
```
