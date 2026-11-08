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
  const original=html.replace(/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?[^"]+"><\/script>/,'')
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
    const salaryEvents=window.dataLayer.filter(x=>x[0]==='event'&&x[1]==='calculator_used'&&x[2]?.calculator_type==='salary');
    check('salary event at most once',salaryEvents.length<=1);
    const out=document.createElement('pre');out.id='qa-results';out.textContent=JSON.stringify(results);document.body.append(out);
  });
  </script>`;
  const page=original.replace('</body>',`<script>${js.replaceAll('</script>','<\\/script>')}</script>${tests}</body>`);
  const path=join(tmp,'test.html');writeFileSync(path,page);
  const binary=process.env.CHROMIUM||'chromium';
  const r=spawnSync(binary,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--virtual-time-budget=2000','--dump-dom',pathToFileURL(path).href],{encoding:'utf8',timeout:20000});
  if(r.error)throw r.error;
  const match=r.stdout.match(/<pre id="qa-results">([^<]+)<\/pre>/);
  assert.ok(match,'Chromium did not return QA results; stderr: '+r.stderr.slice(0,500));
  const results=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.equal(results.length,14,'Expected exactly 14 browser checks');
  for(const test of results)console.log((test.pass?'PASS':'FAIL')+' '+test.name);
  assert.ok(results.every(x=>x.pass),'Browser DOM regression failed');
}finally{rmSync(tmp,{recursive:true,force:true});}
