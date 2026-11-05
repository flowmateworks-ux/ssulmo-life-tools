"use strict";
const f=new Intl.NumberFormat("ko-KR");
const money=n=>f.format(Math.round(n))+"원";
const num=id=>{const el=document.getElementById(id);const v=Number(el?.value);return Number.isFinite(v)?Math.min(1e12,Math.max(0,v)):0};
const text=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
function update(){
const pay=num("pay"),living=num("living"),saving=num("saving"),invest=num("invest"),extra=num("extra");
const parts=[living,saving,invest,extra],used=parts.reduce((a,b)=>a+b,0),remaining=pay-used;
text("salaryLabel",remaining<0?"월급을 초과한 금액":"아직 배분하지 않은 금액");
text("salaryResult",money(Math.abs(remaining)));
text("salaryDetails","배분 합계 "+money(used)+" · 월급 대비 "+(pay>0?(used/pay*100).toFixed(1):"0")+"%");
const output=document.getElementById("salary")?.querySelector(".output");
output?.classList.toggle("is-negative",remaining<0);
const bar=document.getElementById("distribution");
if(bar){const denominator=Math.max(pay,used,1);const colors=["#2c8278","#b5a9e9","#f2bd81","#86adca"];
bar.replaceChildren(...parts.map((v,i)=>{const s=document.createElement("span");s.style.width=(v/denominator*100)+"%";s.style.background=colors[i];return s}));bar.setAttribute("aria-label","생활비 "+money(living)+", 저축 "+money(saving)+", 투자 "+money(invest)+", 기타 "+money(extra))}
const fixed=["rent","phone","insurance","subs","other"].reduce((a,id)=>a+num(id),0);
text("costResult",money(fixed));text("yearResult","1년이면 "+money(fixed*12));
const due=Math.max(0,num("goal")-num("saved")),monthly=num("monthly");
text("saveResult",due===0?"목표 달성":monthly===0?"월 저축액을 입력해 주세요":f.format(Math.ceil(due/monthly))+"개월");
text("saveDetail","추가 필요 금액 "+money(due));
const durationEl=document.getElementById("duration");
const duration=Number(durationEl?.value);
text("cutResult",durationEl?.value?.trim()!==""&&Number.isInteger(duration)&&duration>0&&duration<=1200?money(num("cut")*duration):"기간을 1~1200개월로 입력해 주세요");
}
document.querySelectorAll('input[type="number"]').forEach(el=>el.addEventListener("input",update));
text("year",new Date().getFullYear());update();
// 사용자가 계산기를 처음 조작했는지만 기록합니다. 입력한 금액은 전송하지 않습니다.
const calculatorGroups={salary:["pay","living","saving","invest","extra"],fixed:["rent","phone","insurance","subs","other"],savings:["goal","saved","monthly"],subscription:["cut","duration"]};
Object.entries(calculatorGroups).forEach(([name,ids])=>{
  let tracked=false;
  ids.forEach(id=>document.getElementById(id)?.addEventListener("input",()=>{
    if(tracked)return;
    const current=document.getElementById(id);
    if(!current||current.value.trim()==="")return;
    const value=Number(current.value);
    if(!Number.isFinite(value)||value<0||value>1e12)return;
    if(name==="subscription"){
      const cutEl=document.getElementById("cut");
      const durationEl=document.getElementById("duration");
      if(!cutEl||!durationEl||cutEl.value.trim()===""||durationEl.value.trim()==="")return;
      const cut=Number(cutEl.value),duration=Number(durationEl.value);
      if(!Number.isFinite(cut)||cut<0||cut>1e12||!Number.isInteger(duration)||duration<1||duration>1200)return;
    }
    if(typeof window.gtag!=="function")return;
    tracked=true;
    window.gtag("event","calculator_used",{calculator_type:name});
  }));
});
