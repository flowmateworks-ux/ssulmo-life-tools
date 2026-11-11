// Non-deploy QA: run from repository root with Node 22+ and Chromium installed.
// node qa/browser-smoke.mjs
// Tests the REAL index.html and app.js in a headless Chromium DOM; no mock DOM.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
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
    change('rent','');
    check('fixed blank rejected',document.getElementById('costResult').textContent==='계산할 수 없습니다');
    change('rent','0');
    check('fixed zero restored',document.getElementById('costResult').textContent.includes('원'));
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
    const salaryEvents=window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used'&&x[2]?.calculator_type==='salary');
    check('salary event exactly once (queued, not GA4 delivery)',salaryEvents.length===1 && salaryEvents.every(x=>Object.keys(x[2]||{}).join(',')==='calculator_type'));
    const out=document.createElement('pre');out.id='qa-results';out.textContent=JSON.stringify(results);document.body.append(out);
  });
  </script>`;
  const page=original.replace('</body>',`<script>${js.replaceAll('</script>','<\\/script>')}</script>${tests}</body>`);
  const path=join(tmp,'test.html');writeFileSync(path,page);
  const binary=process.env.CHROMIUM||'chromium';
  const r=spawnSync(binary,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--virtual-time-budget=2000','--dump-dom',pathToFileURL(path).href],{encoding:'utf8',timeout:20000});
  if(r.error)throw r.error;
  const match=r.stdout.match(/<pre id="qa-results">([^<]+)<\/pre>/);
  if (!match) {
    console.error('CHROMIUM_DIAGNOSTICS '+JSON.stringify({binary,args:['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--virtual-time-budget=2000','--dump-dom'],status:r.status,signal:r.signal,stderrTail:r.stderr.slice(-4000),stdoutTail:r.stdout.slice(-4000),stdoutLength:r.stdout.length}));
  }
  assert.ok(match,'Chromium did not return QA results; inspect CHROMIUM_DIAGNOSTICS above');
  const results=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.equal(results.length,20,'Expected exactly 20 browser checks');
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
  const mobile=spawnSync(binary,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--window-size=500,844','--force-device-scale-factor=1','--virtual-time-budget=2000','--dump-dom',pathToFileURL(mobilePath).href],{encoding:'utf8',timeout:20000});
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
  const run=spawnSync(browser,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--window-size=500,844','--force-device-scale-factor=1','--virtual-time-budget=2000','--dump-dom',pathToFileURL(surveyPath).href],{encoding:'utf8',timeout:20000});
  if(run.error)throw run.error;
  const match=run.stdout.match(/<pre id="survey-qa-results">([^<]+)<\/pre>/);
  if(!match)console.error('SURVEY_DIAGNOSTICS '+JSON.stringify({status:run.status,stderrTail:run.stderr.slice(-2000),stdoutTail:run.stdout.slice(-2000)}));
  assert.ok(match,'Product survey Chromium did not return DOM QA results');
  const results=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  for(const test of results)console.log((test.pass?'PASS':'FAIL')+' survey '+test.name);
  assert.equal(results.length,10,'Expected exactly 10 product survey checks');
  assert.ok(results.every(x=>x.pass),'Product survey real-DOM regression failed');
}finally{rmSync(surveyTmp,{recursive:true,force:true});}
