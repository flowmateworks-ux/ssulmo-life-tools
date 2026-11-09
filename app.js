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
    if(raw==="")return {error:"빈칸 없이 금액을 입력해 주세요.",field:id};
    const value=Number(raw);
    if(!Number.isSafeInteger(value)||value<0)return {error:"0 이상의 안전한 정수 금액을 입력해 주세요.",field:id};
    if(id==="duration"&&(value<1||value>1200))return {error:"기간은 1~1200개월의 정수로 입력해 주세요.",field:id};
    values[id]=value;
  }
  return {values};
}
function safeSum(values){let total=0;for(const v of values){total+=v;if(!Number.isSafeInteger(total))return null;}return total;}
function groupError(name,message){
  const card=document.getElementById(name);
  if(!card)return;
  // 이전 초과 배분 상태가 입력 오류 화면에 남지 않도록 초기화합니다.
  if(name==="salary"&&message)card.querySelector(".output")?.classList.remove("is-negative");
  let notice=card.querySelector(".calculator-error");
  if(!notice){notice=document.createElement("p");notice.className="calculator-error";notice.setAttribute("role","status");notice.setAttribute("aria-live","polite");notice.style.color="#a32b2b";notice.style.fontWeight="600";card.querySelector(".fields")?.appendChild(notice);}
  notice.textContent=message||"";
  // 각 필드를 독립 검증해 여러 입력 오류도 모두 표시합니다.
  card.querySelectorAll('input[type="number"]').forEach(el=>{
    const raw=el.value.trim(),value=Number(raw);
    const invalid=Boolean(message)&&(raw===""||!Number.isSafeInteger(value)||value<0||(el.id==="duration"&&(value<1||value>1200)));
    el.setAttribute("aria-invalid",invalid?"true":"false");
  });
}
function update(){
  const salary=readGroup("salary");
  if(salary.error){groupError("salary",salary.error);text("salaryLabel","입력 오류");text("salaryResult","계산할 수 없습니다");text("salaryDetails","입력값을 확인해 주세요.");const bar=document.getElementById("distribution");if(bar){bar.replaceChildren();bar.setAttribute("aria-label","입력 오류로 배분 그래프를 표시할 수 없습니다.");}}
  else{
    const {pay,living,saving,invest,extra}=salary.values;
    const parts=[living,saving,invest,extra],used=safeSum(parts),remaining=pay-used;
    if(used===null||!Number.isSafeInteger(remaining)){groupError("salary","합계가 안전한 계산 범위를 초과했습니다.");text("salaryLabel","계산 범위 초과");text("salaryResult","계산할 수 없습니다");text("salaryDetails","입력값을 확인해 주세요.");const bar=document.getElementById("distribution");if(bar){bar.replaceChildren();bar.setAttribute("aria-label","계산 범위 초과로 배분 그래프를 표시할 수 없습니다.");}}
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
// 최초 유효 입력은 GA4 로딩이 늦어도 최대 30초간 대기 후 한 번만 전송합니다.
// 금액·개인정보는 이벤트에 포함하지 않습니다. 미전송 시 추후 재입력으로 다시 시도할 수 있습니다.
const calculatorGroups={salary:["pay","living","saving","invest","extra"],fixed:["rent","phone","insurance","subs","other"],savings:["goal","saved","monthly"],subscription:["cut","duration"]};
Object.entries(calculatorGroups).forEach(([name,ids])=>{
  let tracked=false,pending=false,retryTimer=null,deadline=0;
  const valid=()=>{
    const result=readGroup(name);
    if(result.error)return false;
    if(name==="salary"){
      const {pay,living,saving,invest,extra}=result.values;
      const used=safeSum([living,saving,invest,extra]);
      return used!==null&&Number.isSafeInteger(pay-used);
    }
    if(name==="fixed"){
      const sum=safeSum(Object.values(result.values));
      return sum!==null&&Number.isSafeInteger(sum*12);
    }
    if(name==="subscription"){
      const {cut,duration}=result.values;
      return Number.isSafeInteger(cut*duration);
    }
    return true;
  };
  const flush=()=>{
    if(tracked||!pending)return;
    if(!valid()){pending=false;clearInterval(retryTimer);retryTimer=null;return;}
    if(typeof window.gtag!=="function")return;
    try{
      window.gtag("event","calculator_used",{calculator_type:name});
      tracked=true;pending=false;clearInterval(retryTimer);retryTimer=null;
    }catch(_error){/* 다음 재시도 또는 사용자 입력에서 복구 */}
  };
  ids.forEach(id=>document.getElementById(id)?.addEventListener("input",()=>{
    if(tracked)return;
    if(!valid()){pending=false;clearInterval(retryTimer);retryTimer=null;return;}
    pending=true;flush();
    if(!tracked&&retryTimer===null){
      deadline=Date.now()+30000;
      retryTimer=setInterval(()=>{
        flush();
        if(!tracked&&Date.now()>=deadline){clearInterval(retryTimer);retryTimer=null;pending=false;}
      },500);
    }
  }));
});
