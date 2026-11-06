// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseWebChannel,ORIGIN}=require('../src/lib/fxa-webchannel-protocol.cjs');
const state='state-'+('x'.repeat(32));
const wrapped=(command,data)=>({id:'account_updates',message:{messageId:123,command,data}});
test('Native OAuth WebChannel returns only an authorization code after strict state and origin validation',()=>{
 const data={code:'a'.repeat(64),state,redirect:'urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel',scope:'profile'};
 const result=parseWebChannel(ORIGIN,wrapped('fxaccounts:oauth_login',data),state);
 assert.deepEqual(result,{kind:'oauth-code',code:data.code,state});
 assert.equal(parseWebChannel('https://example.invalid',wrapped('fxaccounts:oauth_login',data),state),null);
 assert.equal(parseWebChannel(ORIGIN,wrapped('fxaccounts:oauth_login',data),'wrong-state-value'),null);
 assert.equal(parseWebChannel(ORIGIN,wrapped('fxaccounts:oauth_login',{...data,code:'x'}),state),null);
 assert.equal(parseWebChannel(ORIGIN,wrapped('fxaccounts:oauth_login',{...data,redirect:'https://attacker.invalid/'}),state),null);
});
test('Protocol recognizes status/link requests without reporting an authenticated account',()=>{
 assert.deepEqual(parseWebChannel(ORIGIN,wrapped('fxaccounts:fxa_status',null),state),{
  kind:'query',id:'account_updates',messageId:123,command:'fxaccounts:fxa_status'
 });
 assert.equal(parseWebChannel(ORIGIN,wrapped('fxaccounts:can_link_account',null),state).kind,'query');
 assert.equal(parseWebChannel(ORIGIN,wrapped('arbitrary-command',{}),state),null);
});
test('Legacy WebChannel session token is not misclassified as a completed OAuth login',()=>{
 const result=parseWebChannel(ORIGIN,wrapped('fxaccounts:login',{email:'person@example.invalid',sessionToken:'ab'.repeat(32)}),state);
 assert.deepEqual(result,{kind:'legacy-session',sessionToken:'ab'.repeat(32)});
 assert.equal(parseWebChannel(ORIGIN,wrapped('fxaccounts:login',{token:'invalid'}),state),null);
 assert.equal(parseWebChannel(ORIGIN,'not-json',state),null);
 assert.equal(parseWebChannel(ORIGIN,{},state),null);
});
