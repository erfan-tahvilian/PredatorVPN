// SPDX-License-Identifier: GPL-3.0-or-later
// Fake Android platform bridge ONLY for native-scale renderer geometry tests.
const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('FoxAndroid',{
 getLocationSort:()=> 'ping-asc',
 request:()=> {}
});
