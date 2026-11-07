// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const crypto=require('node:crypto');
const AUTHORIZER='https://api.accounts.firefox.com/v1/oauth/authorization';
const TOKEN_URL='https://oauth.accounts.firefox.com/v1/token';
const CLIENT='5882386c6d801776';
const SCOPE='profile https://identity.mozilla.com/apps/vpn';
async function exchangeSessionWithOAuthCode(http,sessionToken,signHawk){
  const verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const state=crypto.randomBytes(24).toString('base64url');
  const body=JSON.stringify({
    client_id:CLIENT,response_type:'code',scope:SCOPE,state,access_type:'offline',
    code_challenge:challenge,code_challenge_method:'S256'
  });
  // Only expose a safe endpoint label/status when the provider rejects a grant.
  // Never attach a session token, authorization code, verifier or response body.
  let authorization;
  try{
    authorization=(await http.json(AUTHORIZER,{
      method:'POST',body,authorization:signHawk('POST',AUTHORIZER,sessionToken,body)
    })).data;
  }catch(error){
    if(error?.status!==406)throw error;
    const rejected=Error('Mozilla rejected OAuth authorization (HTTP 406); no authorization code was issued.');
    rejected.status=406;
    rejected.code='FXA_OAUTH_AUTHORIZATION_REJECTED';
    rejected.loginStage='oauth-authorization';
    rejected.diagnostic=error.diagnostic||null;
    throw rejected;
  }
  if(typeof authorization?.code!=='string'||!authorization.code||
      authorization.code.length>2048||authorization.state!==state)
    throw Error('The account provider returned an invalid OAuth authorization response.');
  const tokenBody=JSON.stringify({
    client_id:CLIENT,grant_type:'authorization_code',
    code:authorization.code,code_verifier:verifier
  });
  let result;
  try{
    result=(await http.json(TOKEN_URL,{method:'POST',body:tokenBody})).data;
  }catch(error){
    if(error?.status!==406)throw error;
    const rejected=Error('Mozilla rejected OAuth authorization-code exchange (HTTP 406) after issuing an authorization code.');
    rejected.status=406;
    rejected.code='FXA_OAUTH_TOKEN_EXCHANGE_REJECTED';
    rejected.loginStage='oauth-code-exchange';
    rejected.diagnostic=error.diagnostic||null;
    throw rejected;
  }
  if(typeof result?.access_token!=='string'||!result.access_token)
    throw Error('The account provider did not return an OAuth access token.');
  return result;
}
module.exports={exchangeSessionWithOAuthCode,AUTHORIZER,TOKEN_URL};
