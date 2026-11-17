// Non-deploy purchase-readiness acceptance. Never visits a payment endpoint.
// Requires Node 22+ and CHROMIUM; uses actual Chromium CSS viewports via CDP.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

function checks() {
  const results=[], check=(name,pass)=>results.push({name,pass:!!pass});
  const text=document.body.textContent;
  const title=document.querySelector('#product-title');
  check('no horizontal overflow',document.documentElement.scrollWidth<=innerWidth+1);
  check('product heading visible',!!title&&title.getBoundingClientRect().width>0);
  const buttons=[...document.querySelectorAll('button')];
  check('checkout remains disabled',buttons.length===1&&buttons[0].disabled);
  check('no payment or personal-data form',!document.querySelector('form,input,textarea'));
  const links=[...document.querySelectorAll('a[href]')];
  check('only approved free-calculator link',links.length===1&&links[0].href==='https://flowmateworks-ux.github.io/ssulmo-life-tools/#tools');
  check('no runtime or external scripts',document.scripts.length===0);
  check('manual input and account requirements disclosed',text.includes('직접 입력')&&text.includes('Google 계정'));
  check('price is explicitly undecided',text.includes('정식 가격: 미정'));
  check('delivery and refund remain unconfirmed',text.includes('고객 사본 전달·환불 조건은 미확정'));
  check('no analytics or payment claim',document.querySelector('footer').textContent.includes('GA4 이벤트 및 결제 요청을 전송하지 않습니다'));
  const faq=document.querySelector('details'),summary=faq?.querySelector('summary');
  check('FAQ starts collapsed',!!faq&&!faq.open);
  summary?.click();
  check('FAQ expands on activation',!!faq?.open);
  summary?.focus();
  check('FAQ summary can receive keyboard focus',document.activeElement===summary);
  return {width:innerWidth,results};
}

const dir=mkdtempSync(join(tmpdir(),'ssulmo-readiness-'));
const source=readFileSync(resolve('qa/nondeploy-product-readiness.html'),'utf8');
const pagePath=join(dir,'readiness.html');writeFileSync(pagePath,source);
const profile=join(dir,'profile');
const binary=process.env.CHROMIUM||'chromium';
const child=spawn(binary,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='',ws,seq=0;
child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-2000)});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pending=new Map();
try {
  let port;
  for(let n=0;n<100;n++){
    try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break}catch{}
    await delay(100);
  }
  assert.ok(port,'Chromium did not expose CDP: '+stderr);
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const target=targets.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
  assert.ok(target,'CDP page missing');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  ws.addEventListener('message',e=>{
    const msg=JSON.parse(e.data),p=pending.get(msg.id);
    if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result)}
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},15000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
  await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['http://*','https://*']});
  let count=0;
  for(const width of [320,390,1440]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
    await send('Page.navigate',{url:pathToFileURL(pagePath).href});
    let ready=false;
    for(let n=0;n<100;n++){
      const state=await send('Runtime.evaluate',{expression:"document.readyState==='complete'&&!!document.querySelector('#product-title')",returnByValue:true});
      if(state.result?.value){ready=true;break}await delay(50);
    }
    assert.ok(ready,'Readiness page not loaded');
    const r=await send('Runtime.evaluate',{expression:'('+checks.toString()+')()',returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));
    const data=r.result?.value;
    assert.equal(data?.width,width,'CSS viewport differs from claimed width');
    assert.equal(data.results.length,13);
    for(const test of data.results)console.log((test.pass?'PASS':'FAIL')+' readiness '+width+'px '+test.name);
    assert.ok(data.results.every(x=>x.pass),'Readiness acceptance failed at '+width);
    count+=data.results.length;
  }
  console.log('READINESS_QA_SUMMARY PASS '+count+' FAIL 0; offline HTML acceptance only, not purchase/GA4/iPhone proof');
} finally {
  for(const p of pending.values())clearTimeout(p.timer);
  if(ws)ws.close();
  child.kill('SIGKILL');
  await delay(100);
  rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
