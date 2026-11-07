// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Safe account-provider rejection diagnostics. Never capture a request body,
// URL, authorization value, session token, cookie, or Set-Cookie header.
const HEADERS={
  'x-request-id':/^[a-zA-Z0-9_.:\-]{1,100}$/,
  'x-correlation-id':/^[a-zA-Z0-9_.:\-]{1,100}$/,
  'cf-ray':/^[a-zA-Z0-9_.:\-]{1,100}$/,
  'x-served-by':/^[a-zA-Z0-9_.,;:\- ]{1,100}$/,
  'x-cache':/^[a-zA-Z0-9_.,;:\- ]{1,100}$/,
  'server':/^[a-zA-Z0-9_./\- ]{1,80}$/
};
function responseDiagnostic(response){
  if(!response||typeof response.status!=='number')return null;
  const details={status:response.status};
  for(const [key,pattern] of Object.entries(HEADERS)){
    const value=response.headers?.get?.(key);
    if(typeof value==='string'&&pattern.test(value))details[key]=value;
  }
  return Object.freeze(details);
}
function diagnosticLine(details){
  if(!details||!Number.isInteger(details.status))return '';
  const fields=['HTTP '+details.status];
  for(const key of Object.keys(HEADERS)){
    const value=details[key];
    if(typeof value==='string'&&HEADERS[key].test(value))
      fields.push(key+'='+value);
  }
  return fields.join(' ');
}
module.exports={responseDiagnostic,diagnosticLine};
