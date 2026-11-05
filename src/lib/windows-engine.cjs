// SPDX-License-Identifier: GPL-3.0-or-later
// Windows sing-box lifecycle supervision. Never print raw engine output:
// packet errors can contain destination addresses or other private traffic.
const {spawn}=require('node:child_process');
class WindowsEngine {
  constructor({executable,configPath,cwd,log,onUnexpectedStop,spawnFn=spawn,timeoutMs=15000}){
    Object.assign(this,{executable,configPath,cwd,log,onUnexpectedStop,spawnFn,timeoutMs});
    this.child=null;this.stopping=false;this.warned=false;
  }
  start(){
    this.stopping=false;this.warned=false;
    return new Promise((resolve,reject)=>{
      let child;
      try {child=this.spawnFn(this.executable,['run','-c',this.configPath],{cwd:this.cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});}
      catch {reject(Error('Unable to start the Windows tunnel engine.'));return;}
      this.child=child;
      let settled=false,unexpectedReported=false;
      const reportUnexpected=()=>{if(this.stopping||unexpectedReported)return;unexpectedReported=true;this.onUnexpectedStop();};
      const complete=(error)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        if(error)reject(error);else resolve();
      };
      const timer=setTimeout(()=>{
        this.stopping=true;
        child.kill();
        complete(Error('The Windows tunnel engine did not become ready.'));
      },this.timeoutMs);
      child.once('error',()=>{
        if(!settled)complete(Error('Unable to start the Windows tunnel engine.'));
        else reportUnexpected();
      });
      child.once('exit',code=>{
        if(this.child===child)this.child=null;
        if(!settled)complete(Error('Windows tunnel engine stopped ('+code+').'));
        else reportUnexpected();
      });
      const processLine=line=>{
        if(/sing-box started/i.test(line))complete();
        if(/\bFATAL\b/i.test(line))this.log('warn','Windows tunnel engine reported a fatal error; monitoring process health.');
        else if(/\bERROR\b/i.test(line)&&!this.warned){
          this.warned=true;
          this.log('warn','Windows tunnel engine reported a packet or route error; the connection is being monitored.');
        }
      };
      for(const stream of [child.stdout,child.stderr]){
        let partial='';
        stream.on('data',chunk=>{
          partial=(partial+chunk.toString('utf8')).slice(-8192);
          const lines=partial.split(/\r?\n/);
          partial=(lines.pop()||'').slice(-2048);
          for(const line of lines)processLine(line);
        });
      }
    });
  }
  async stop(){
    this.stopping=true;
    const child=this.child;this.child=null;
    if(!child)return;
    await new Promise(resolve=>{
      let done=false;
      let timer;
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
      child.once('exit',finish);
      timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish();},5000);
      try{if(!child.kill())finish();}catch{finish();}
    });
  }
}
module.exports={WindowsEngine};
