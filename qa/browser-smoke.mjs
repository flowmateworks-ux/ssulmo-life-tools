// Non-deploy QA: run from repository root with Node 22+ and Chromium installed.
// node qa/browser-smoke.mjs
// Tests the REAL index.html and app.js in a headless Chromium DOM; no mock DOM.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve('.');
const html=readFileSync(join(root,'index.html'),'utf8');
const js=readFileSync(join(root,'app.js'),'utf8');
const tmp=mkdtempSync(join(tmpdir(),'ssulmo-dom-'));
try {
  // Local inline JS avoids external GA4/network calls and verifies actual app.js behavior.
  const original=html.replace(/<script\b[^>]*src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?[^"]+"[^>]*><\/script>/,'')
    .replace(/<script src="app\.js" defer><\/script>/,'');
    const tests=`<script>
  window.addEventListener('load',()=>{
    const results=[];
    function check(name,condition){results.push({name,pass:!!condition});}
    function change(id,value){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
    check('initial salary finite',!document.getElementById('salaryResult').textContent.includes('∞'));
    change('pay','1e308');
    check('salary huge rejected',document.getElementById('salaryResult').textContent==='계산할 수 없습니다');
    check('salary bar cleared',document.getElementById('distribution').children.length===0);
    check('salary invalid aria',document.getElementById('pay').getAttribute('aria-invalid')==='true');
    check('GA4 not queued before library load',window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used').length===0);
    window.ga4LibraryLoaded=true; // deterministic local load signal; NOT server collection proof
    change('pay','2800000');
    check('salary restored',document.getElementById('salaryResult').textContent.includes('원'));
    check('salary bar restored',document.getElementById('distribution').children.length===4);
    change('living','2900000');
    check('salary overspend style set',document.querySelector('#salary .output').classList.contains('is-negative'));
    change('living','-1');
    check('salary invalid clears overspend style',!document.querySelector('#salary .output').classList.contains('is-negative'));
    change('living','1200000');
    check('salary valid clears invalid state',document.getElementById('living').getAttribute('aria-invalid')==='false');
    window.ga4LibraryLoaded=false; // exercise real 500ms retry path independently of salary
    change('rent','');
    check('fixed blank rejected',document.getElementById('costResult').textContent==='계산할 수 없습니다');
    change('rent','0');
    check('fixed zero restored',document.getElementById('costResult').textContent.includes('원'));
    check('fixed event withheld while GA4 library unavailable',window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used'&&x[2]?.calculator_type==='fixed').length===0);
    change('cut','9007199254740991');
    check('subscription multiplication overflow rejected',document.getElementById('cutResult').textContent==='계산할 수 없습니다');
    check('savings unaffected',document.getElementById('saveResult').textContent==='18개월');
    // Additional real-DOM acceptance: boundary and recovery across all four calculators.
    change('pay','0');
    change('living','0');change('saving','0');change('invest','0');change('extra','0');
    check('salary zero denominator explained',document.getElementById('salaryDetails').textContent.includes('비율 산출 불가'));
    change('monthly','0');
    check('savings zero deposit explained',document.getElementById('saveResult').textContent.includes('달성 시점을 계산할 수 없습니다'));
    change('monthly','500000');
    check('savings zero deposit recovery',document.getElementById('saveResult').textContent==='18개월');
    change('cut','15000');change('duration','0');
    check('subscription invalid duration rejected',document.getElementById('cutResult').textContent==='계산할 수 없습니다'&&document.getElementById('duration').getAttribute('aria-invalid')==='true');
    change('duration','12');
    check('subscription duration recovery',document.getElementById('cutResult').textContent==='180,000원'&&document.getElementById('duration').getAttribute('aria-invalid')==='false');
    change('duration','0'); // invalidate a pending event while GA4 is unavailable
    check('subscription invalidation clears result',document.getElementById('cutResult').textContent==='계산할 수 없습니다');
    const salaryEvents=window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used'&&x[2]?.calculator_type==='salary');
    check('salary event exactly once (queued, not GA4 delivery)',salaryEvents.length===1 && salaryEvents.every(x=>Object.keys(x[2]||{}).join(',')==='calculator_type'));
    window.ga4LibraryLoaded=true;
    setTimeout(()=>{
      const fixedEvents=window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used'&&x[2]?.calculator_type==='fixed');
      check('fixed delayed retry queues exactly once (not GA4 delivery)',fixedEvents.length===1&&Object.keys(fixedEvents[0][2]||{}).join(',')==='calculator_type');
      const subscriptionEvents=()=>window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used'&&x[2]?.calculator_type==='subscription');
      check('invalidated delayed subscription not queued',subscriptionEvents().length===0);
      change('duration','12');
      check('subscription recovery queues exactly once',subscriptionEvents().length===1);
      change('duration','12');
      check('subscription repeated input not re-counted',subscriptionEvents().length===1);
      const out=document.createElement('pre');out.id='qa-results';out.textContent=JSON.stringify(results);document.body.append(out);
    },700);
  });
  </script>`;
  const page=original.replace('</body>',`<script>${js.replaceAll('</script>','<\\/script>')}</script>${tests}</body>`);
  const path=join(tmp,'test.html');writeFileSync(path,page);
  const binary=process.env.CHROMIUM||'chromium';
  const r=spawnSync(binary,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--virtual-time-budget=2000','--dump-dom',pathToFileURL(path).href],{encoding:'utf8',timeout:60000});
  if(r.error)throw r.error;
  const match=r.stdout.match(/<pre id="qa-results">([^<]+)<\/pre>/);
  if (!match) {
    console.error('CHROMIUM_DIAGNOSTICS '+JSON.stringify({binary,args:['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--virtual-time-budget=2000','--dump-dom'],status:r.status,signal:r.signal,stderrTail:r.stderr.slice(-4000),stdoutTail:r.stdout.slice(-4000),stdoutLength:r.stdout.length}));
  }
  assert.ok(match,'Chromium did not return QA results; inspect CHROMIUM_DIAGNOSTICS above');
  const results=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.equal(results.length,26,'Expected exactly 26 browser checks');
  for(const test of results)console.log((test.pass?'PASS':'FAIL')+' '+test.name);
  assert.ok(results.every(x=>x.pass),'Browser DOM regression failed');

  // Independent narrow-viewport DOM and keyboard/accessibility checks.
  // Inline the real stylesheet: the temporary HTML is outside the repository.
  const css=readFileSync(join(root,'style.css'),'utf8');
  const mobileChecks=`<script>
  window.addEventListener('load',()=>{
    const checks=[];
    const check=(name,pass)=>checks.push({name,pass:!!pass});
    const width=window.innerWidth;
    check('narrow viewport applied',width>=480&&width<=520);
    check('no horizontal page overflow',document.documentElement.scrollWidth<=width+1);
    const inputs=[...document.querySelectorAll('.tool-card input')];
    check('all calculator inputs have explicit labels',inputs.length>=10&&inputs.every(el=>!!document.querySelector('label[for="'+el.id+'"]')));
    const skip=document.querySelector('a.skip-link');
    skip.focus();
    check('skip link keyboard focusable',document.activeElement===skip&&document.querySelector(skip.getAttribute('href'))!==null);
    const links=[...document.querySelectorAll('a[href^="#"]')];
    check('all in-page navigation targets exist',links.every(a=>a.getAttribute('href').length>1&&document.getElementById(a.getAttribute('href').slice(1))));
    const pay=document.getElementById('pay');pay.focus();pay.value='2700000';
    pay.dispatchEvent(new Event('input',{bubbles:true}));
    check('keyboard-focusable calculator recalculates',document.activeElement===pay&&document.getElementById('salaryResult').textContent.includes('원'));
    const pre=document.createElement('pre');pre.id='mobile-qa-results';pre.textContent=JSON.stringify({width,checks});document.body.append(pre);
  });
  <\/script>`;
  const mobileHtml=original.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
    .replace('</body>',`<script>${js.replaceAll('</script>','<\\/script>')}</script>${mobileChecks}</body>`);
  const mobilePath=join(tmp,'mobile.html');writeFileSync(mobilePath,mobileHtml);
  const mobile=spawnSync(binary,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--window-size=500,844','--force-device-scale-factor=1','--virtual-time-budget=2000','--dump-dom',pathToFileURL(mobilePath).href],{encoding:'utf8',timeout:60000});
  if(mobile.error)throw mobile.error;
  const mobileMatch=mobile.stdout.match(new RegExp('<pre id="mobile-qa-results">([^<]+)</pre>'));
  if(!mobileMatch)console.error('MOBILE_DIAGNOSTICS '+JSON.stringify({status:mobile.status,stderrTail:mobile.stderr.slice(-2000),stdoutTail:mobile.stdout.slice(-2000)}));
  assert.ok(mobileMatch,'Narrow viewport QA did not return results');
  const mobileResult=JSON.parse(mobileMatch[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  for(const test of mobileResult.checks)console.log((test.pass?'PASS':'FAIL')+' mobile '+test.name);
  assert.equal(mobileResult.checks.length,6,'Expected 6 narrow viewport checks');
  assert.ok(mobileResult.checks.every(x=>x.pass),'Narrow viewport/keyboard QA failed');

}finally{rmSync(tmp,{recursive:true,force:true});}


// Product survey canonical event dedup: REAL product.html in headless Chromium.
// These are dataLayer queue assertions only, NOT GA4 server-collection evidence.
const surveyTmp=mkdtempSync(join(tmpdir(),'ssulmo-survey-'));
try{
  const productHtml=readFileSync(join(root,'product.html'),'utf8');
  const surveyCss=readFileSync(join(root,'style.css'),'utf8');
  const surveyChecks=[
    '<script>',
    "window.addEventListener('load',()=>{",
    "const results=[];const check=(name,ok)=>results.push({name,pass:!!ok});",
    "const buttons=[...document.querySelectorAll('#price-options button[data-price]')];",
    "const events=()=>window.dataLayer.filter(x=>x[0]==='event');",
    "const canonical=()=>events().filter(x=>x[1]==='product_price_interest');",
    "check('survey four options present',buttons.length===4);",
    "check('survey initial aria-pressed false',buttons.every(b=>b.getAttribute('aria-pressed')==='false'));",
    "buttons[0].click();check('survey first choice one canonical event',canonical().length===1);",
    "buttons[0].click();check('survey duplicate click not re-counted',canonical().length===1);",
    "buttons[1].click();check('survey changed choice emits second event',canonical().length===2);",
    "check('survey no redundant interest_* events',events().every(x=>x[1]==='product_price_interest'));",
    "check('survey payload only two selected prices',JSON.stringify(canonical().map(x=>x[2].price_preference))===JSON.stringify(['3900','7900']));",
    "check('survey exactly one aria-pressed option',buttons.filter(b=>b.getAttribute('aria-pressed')==='true').length===1&&buttons[1].getAttribute('aria-pressed')==='true');",
    "check('survey response not mistaken for order',document.getElementById('survey-result').textContent.includes('주문이나 예약이 접수된 것은 아닙니다'));",
    "check('survey 500px no horizontal overflow',document.documentElement.scrollWidth<=window.innerWidth+1);",
    "const pre=document.createElement('pre');pre.id='survey-qa-results';pre.textContent=JSON.stringify(results);document.body.append(pre);",
    "});",
    '</script>'
  ].join('\n');
  const surveyPage=productHtml
    .replace(/<script\b[^>]*src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?[^"]+"[^>]*><\/script>/,'')
    .replace('<link rel="stylesheet" href="style.css">','<style>'+surveyCss+'</style>')
    .replace('</body>',surveyChecks+'</body>');
  const surveyPath=join(surveyTmp,'survey.html');
  writeFileSync(surveyPath,surveyPage);
  const browser=process.env.CHROMIUM||'chromium';
  const run=spawnSync(browser,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--window-size=500,844','--force-device-scale-factor=1','--virtual-time-budget=2000','--dump-dom',pathToFileURL(surveyPath).href],{encoding:'utf8',timeout:60000});
  if(run.error)throw run.error;
  const match=run.stdout.match(/<pre id="survey-qa-results">([^<]+)<\/pre>/);
  if(!match)console.error('SURVEY_DIAGNOSTICS '+JSON.stringify({status:run.status,stderrTail:run.stderr.slice(-2000),stdoutTail:run.stdout.slice(-2000)}));
  assert.ok(match,'Product survey Chromium did not return DOM QA results');
  const results=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  for(const test of results)console.log((test.pass?'PASS':'FAIL')+' survey '+test.name);
  assert.equal(results.length,10,'Expected exactly 10 product survey checks');
  assert.ok(results.every(x=>x.pass),'Product survey real-DOM regression failed');
}finally{rmSync(surveyTmp,{recursive:true,force:true});}


// Isolated fake-data PoC: independent real-Chromium regression (non-deploy).
// Distinct from the 42 production-calculator checks and from Google Sheets QA.
{
  function pocRunner(){
    const results=[];
    const check=(name,ok)=>results.push({name,pass:!!ok});
    const $=id=>document.getElementById(id);
    const count=()=>document.querySelectorAll('#allRows tr').length;
    const visible=el=>{const r=el.getBoundingClientRect();return getComputedStyle(el).display!=='none'&&r.width>0&&r.height>0;};
    check('responsive device label',window.innerWidth>=320&&$('deviceLabel').textContent.includes(window.innerWidth<=720?'모바일':'PC'));
    check('reset button visible',visible($('reset')));
    check('no horizontal overflow',document.documentElement.scrollWidth<=window.innerWidth+1);
    if(window.innerHeight<600){
      $('add').click();
      const dialog=document.querySelector('.modal');
      const rect=dialog.getBoundingClientRect();
      check('short mobile viewport keeps dialog on screen',rect.top>=-1&&rect.bottom<=window.innerHeight+1);
      check('short mobile viewport can scroll dialog actions',dialog.scrollHeight>dialog.clientHeight&&getComputedStyle(dialog).overflowY==='auto');
      $('cancel').click();
    }

    // Accessibility QA: computed CSS colors in the actual Chromium DOM.
    // WCAG AA normal-sized text contrast threshold is 4.5:1.
    const luminance=color=>{
      const rgb=color.match(/[\d.]+/g)?.slice(0,3).map(Number);
      if(!rgb||rgb.length!==3)return NaN;
      const linear=rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});
      return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
    };
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
    const cssColor=sel=>getComputedStyle(document.querySelector(sel)).color;
    const cssBg=sel=>getComputedStyle(document.querySelector(sel)).backgroundColor;
    const white='rgb(255, 255, 255)';
    const normalText=['.card:not(.highlight) .small','.card:not(.highlight) .hint','.panel .meta','.transaction .detail','th','.budget-values'];
    check('small secondary labels meet 4.5:1 contrast',normalText.every(sel=>contrast(cssColor(sel),white)>=4.5)&&contrast(cssColor('.demo'),cssBg('html'))>=4.5&&contrast(cssColor('.side-note'),cssBg('.side-note'))>=4.5);
    check('highlight and device labels meet 4.5:1 contrast',contrast(cssColor('.card.highlight .hint'),cssBg('.card.highlight'))>=4.5&&contrast(cssColor('.device'),cssBg('.device'))>=4.5);
    check('inactive mobile navigation meets 4.5:1 contrast',window.innerWidth>720||contrast(cssColor('.bottom-nav button:not(.active)'),cssBg('.bottom-nav'))>=4.5);

    check('initial six sample rows',count()===6);
    // Cross-month and markup safety: real DOM submission, not a static code assertion.
    $('add').click();
    $('txDate').value='2026-10-15';
    $('txAmount').value='777';
    $('txMemo').value='<img src=x onerror=alert(1)>';
    $('txForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('other-month transaction appears in all rows',count()===7);
    check('other-month expense excluded from November',$('expense').textContent==='86,900원');
    check('other-month budget remains unchanged',$('remain').textContent==='713,100원');
    check('markup memo is displayed literally',$('allRows').textContent.includes('<img src=x onerror=alert(1)>'));
    check('markup memo cannot inject image elements',!$('allRows').querySelector('img')&&!$('recentRows').querySelector('img'));
    $('reset').click();
    check('cross-month safety test resets cleanly',count()===6);
    $('add').click();
    $('txAmount').value='1234';
    $('txMemo').value='    ';
    $('txForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('whitespace-only memo rejected',count()===6);
    check('invalid memo explained',!!$('txMemo').validationMessage);
    $('txMemo').value='  QA memo  ';
    $('txMemo').dispatchEvent(new Event('input',{bubbles:true}));
    check('editing clears custom validation',$('txMemo').validationMessage==='');
    $('txForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('valid transaction saved',count()===7);
    check('memo trimmed', $('allRows').textContent.includes('QA memo')&&!$('allRows').textContent.includes('  QA memo  '));
    check('modal closes after save',!$('modalBackdrop').classList.contains('open'));
    $('add').focus();$('add').click();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check('Escape restores opener focus',document.activeElement===$('add')&&!$('modalBackdrop').classList.contains('open'));
    $('reset').click();
    check('reset restores six rows',count()===6);
    check('reset restores monthly expense',$('expense').textContent==='86,900원');
    check('investment option mirrors Sheets type',$('txType').querySelector('option[value="투자"]')!==null);
    $('add').click();
    $('txType').value='투자';$('txAmount').value='1200';$('txMemo').value='QA-invest';
    $('txForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('investment transaction added',count()===7&&$('allRows').textContent.includes('QA-invest'));
    check('investment monthly subtotal',$('investments').textContent==='투자 1,200원');
    check('investment does not inflate expense',$('expense').textContent==='86,900원');
    check('investment does not inflate income',$('income').textContent==='2,800,000원');
    check('investment does not inflate savings',$('savings').textContent==='300,000원');
    $('reset').click();
    check('reset clears investment subtotal',$('investments').textContent==='투자 0원');
    check('reset clears investment test row',count()===6);
    $('add').click();
    $('txMemo').value='가'.repeat(40);
    $('txAmount').value='5000';
    $('txForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    check('long unbroken memo saved',count()===7&&$('recentRows').textContent.includes('가'.repeat(40)));
    check('long unbroken memo does not overflow page',document.documentElement.scrollWidth<=window.innerWidth+1);
    $('reset').click();
    const pre=document.createElement('pre');pre.id='poc-qa-results';pre.textContent=JSON.stringify({width:window.innerWidth,results});document.body.append(pre);
  }
  // Chrome headless clamps --window-size=320 to 500 CSS pixels. Use CDP
  // device emulation to verify the real 320px viewport instead of mislabelling 500px.
  async function runPoc320WithCdp(browser,pocPath){
    const profile=mkdtempSync(join(tmpdir(),'ssulmo-cdp-'));
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const child=spawn(browser,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
    let stderr='',ws;
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000);});
    try{
      let port;
      for(let i=0;i<100;i++){
        try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port)break;}catch{}
        await sleep(100);
      }
      assert.ok(port,'CDP port unavailable: '+stderr);
      const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
      const page=pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl);
      assert.ok(page,'CDP page target unavailable');
      ws=new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
      let seq=0;
      const pending=new Map();
      ws.addEventListener('message',event=>{
        const msg=JSON.parse(event.data);
        if(msg.id&&pending.has(msg.id)){
          const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
          msg.error?reject(Error(JSON.stringify(msg.error))):resolve(msg.result);
        }
      });
      const send=(method,params={})=>new Promise((resolve,reject)=>{
        const id=++seq;pending.set(id,{resolve,reject});
        ws.send(JSON.stringify({id,method,params}));
      });
      await send('Emulation.setDeviceMetricsOverride',{width:320,height:480,deviceScaleFactor:1,mobile:true});
      await send('Page.navigate',{url:pathToFileURL(pocPath).href});
      for(let i=0;i<100;i++){
        const response=await send('Runtime.evaluate',{expression:"({width:window.innerWidth,raw:document.getElementById('poc-qa-results')?.textContent||''})",returnByValue:true});
        const data=response.result?.value;
        if(data?.raw)return JSON.parse(data.raw);
        await sleep(100);
      }
      throw Error('320px CDP DOM results missing; '+stderr);
    }finally{
      if(ws)ws.close();
      child.kill('SIGKILL');
      try{rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}
    }
  }
  const pocSource=readFileSync(join(root,'qa/poc/ssulmo-responsive-poc-20261112.html'),'utf8');
  const pocTmp=mkdtempSync(join(tmpdir(),'ssulmo-poc-'));
  try{
    const pocPath=join(pocTmp,'poc.html');
    writeFileSync(pocPath,pocSource.replace('</body>','<script>('+pocRunner.toString()+')();</script></body>'));
    let count=0;
    for(const width of [320,500,1440]){
      const browser=process.env.CHROMIUM||'chromium';
      let data;
      if(width===320){
        data=await runPoc320WithCdp(browser,pocPath);
      }else{
        const args=['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--window-size='+width+',900','--force-device-scale-factor=1','--virtual-time-budget=2000','--dump-dom',pathToFileURL(pocPath).href];
        const run=spawnSync(browser,args,{encoding:'utf8',timeout:60000});
        if(run.error)throw run.error;
        const match=run.stdout.match(/<pre id="poc-qa-results">([^<]+)<\/pre>/);
        if(!match)console.error('POC_CHROMIUM_DIAGNOSTICS '+JSON.stringify({width,status:run.status,stderrTail:run.stderr.slice(-1500),stdoutTail:run.stdout.slice(-1500)}));
        assert.ok(match,'PoC Chromium did not return DOM results');
        data=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
      }
      console.log('POC_VIEWPORT requested='+width+' actual='+data.width);
      assert.equal(data.width,width,'Actual Chromium CSS viewport must match the claimed QA width');
      assert.equal(data.results.length,width===320?34:32,'Expected PoC checks for this viewport');
      for(const t of data.results)console.log((t.pass?'PASS':'FAIL')+' poc '+width+'px '+t.name);
      count+=data.results.length;
      assert.ok(data.results.every(t=>t.pass),'PoC browser regression failed at '+width+'px');
    }
    assert.equal(count,98,'Expected 98 PoC checks across 320/500/1440px');
    console.log('POC_QA_SUMMARY PASS '+count+' FAIL 0');
  }finally{rmSync(pocTmp,{recursive:true,force:true});}
}
