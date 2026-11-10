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
