"use strict";
const f=new Intl.NumberFormat("ko-KR");
const money=n=>f.format(Math.round(n))+"원";
const num=id=>{const el=document.getElementById(id);const v=Number(el?.value);return Number.isFinite(v)?Math.min(1e12,Math.max(0,v)):0};
const text=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
// 비배포 QA: 계산기별 독립 검증. 입력을 임의 절단하거나 잘못된 결과를 표시하지 않습니다.
const groups={salary:["pay","living","saving","invest","extra"],fixed:["rent","phone","insurance","subs","other"],savings:["goal","saved","monthly"],subscription:["cut","duration"]};
const MAX=Number.MAX_SAFE_INTEGER;
function readGroup(name){
  const values={};
  for(const id of groups[name]){
    const el=document.getElementById(id),raw=el?.value?.trim()??"";
    if(raw==="")return {error:"빈칸 없이 금액을 입력해 주세요."};
    const value=Number(raw);
    if(!Number.isSafeInteger(value)||value<0)return {error:"0 이상의 안전한 정수 금액을 입력해 주세요."};
    if(id==="duration"&&(value<1||value>1200))return {error:"기간은 1~1200개월의 정수로 입력해 주세요."};
    values[id]=value;
  }
  return {values};
}
function safeSum(values){let total=0;for(const v of values){total+=v;if(!Number.isSafeInteger(total))return null;}return total;}
function groupError(name,message){
  const card=document.getElementById(name);
  if(!card)return;
  let notice=card.querySelector(".calculator-error");
  if(!notice){notice=document.createElement("p");notice.className="calculator-error";notice.setAttribute("role","status");notice.setAttribute("aria-live","polite");notice.style.color="#a32b2b";notice.style.fontWeight="600";card.querySelector(".fields")?.appendChild(notice);}
  notice.textContent=message||"";
  card.querySelectorAll('input[type="number"]').forEach(el=>el.setAttribute("aria-invalid",message?"true":"false"));
}
function update(){
  const salary=readGroup("salary");
  if(salary.error){groupError("salary",salary.error);text("salaryResult","계산할 수 없습니다");text("salaryDetails","입력값을 확인해 주세요.");}
  else{
    const {pay,living,saving,invest,extra}=salary.values;
    const parts=[living,saving,invest,extra],used=safeSum(parts),remaining=pay-used;
    if(used===null||!Number.isSafeInteger(remaining)){groupError("salary","합계가 안전한 계산 범위를 초과했습니다.");text("salaryResult","계산할 수 없습니다");text("salaryDetails","입력값을 확인해 주세요.");}
    else{
      groupError("salary","");
      text("salaryLabel",remaining<0?"월급을 초과한 금액":"아직 배분하지 않은 금액");
      text("salaryResult",money(Math.abs(remaining)));
      text("salaryDetails","배분 합계 "+money(used)+" · 월급 대비 "+(pay>0?(used/pay*100).toFixed(1):"0")+"%");
      document.getElementById("salary")?.querySelector(".output")?.classList.toggle("is-negative",remaining<0);
      const bar=document.getElementById("distribution");
      if(bar){const denominator=Math.max(pay,used,1),colors=["#2c8278","#b5a9e9","#f2bd81","#86adca"];bar.replaceChildren(...parts.map((v,i)=>{const s=document.createElement("span");s.style.width=(v/denominator*100)+"%";s.style.background=colors[i];return s}));bar.setAttribute("aria-label","생활비 "+money(living)+", 저축 "+money(saving)+", 투자 "+money(invest)+", 기타 "+money(extra));}
    }
  }
  const fixed=readGroup("fixed");
  if(fixed.error){groupError("fixed",fixed.error);text("costResult","계산할 수 없습니다");text("yearResult","입력값을 확인해 주세요.");}
  else{
    const sum=safeSum(Object.values(fixed.values)),annual=sum===null?null:sum*12;
    if(annual===null||!Number.isSafeInteger(annual)){groupError("fixed","연간 합계가 안전한 계산 범위를 초과했습니다.");text("costResult","계산할 수 없습니다");text("yearResult","입력값을 확인해 주세요.");}
    else{groupError("fixed","");text("costResult",money(sum));text("yearResult","1년이면 "+money(annual));}
  }
  const savings=readGroup("savings");
  if(savings.error){groupError("savings",savings.error);text("saveResult","계산할 수 없습니다");text("saveDetail","입력값을 확인해 주세요.");}
  else{
    groupError("savings","");
    const {goal,saved,monthly}=savings.values,due=Math.max(0,goal-saved);
    text("saveResult",due===0?"목표 달성":monthly===0?"월 저축액을 입력해 주세요":f.format(Math.ceil(due/monthly))+"개월");
    text("saveDetail","추가 필요 금액 "+money(due));
  }
  const subscription=readGroup("subscription");
  if(subscription.error){groupError("subscription",subscription.error);text("cutResult","계산할 수 없습니다");}
  else{
    const {cut,duration}=subscription.values,total=cut*duration;
    if(!Number.isSafeInteger(total)){groupError("subscription","누적 절약액이 안전한 계산 범위를 초과했습니다.");text("cutResult","계산할 수 없습니다");}
    else{groupError("subscription","");text("cutResult",money(total));}
  }
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
