import{R as d}from"./index-BLfvFpai.js";const f=9e4;async function g(o,c,e){var a,s;const t=Date.now(),r=new AbortController,u=setTimeout(()=>r.abort(),e.timeoutMs??f),m=()=>r.abort();(a=e.signal)==null||a.addEventListener("abort",m);try{const i=await d({messages:c,model:o.ref,signal:r.signal});return{ref:o.ref,label:o.label,ok:!0,text:i.text,ms:Date.now()-t}}catch(i){const n=r.signal.aborted;return{ref:o.ref,label:o.label,ok:!1,error:n?`timed out after ${Math.round((e.timeoutMs??f)/1e3)}s`:i instanceof Error?i.message:String(i),ms:Date.now()-t}}finally{clearTimeout(u),(s=e.signal)==null||s.removeEventListener("abort",m)}}async function b(o,c,e={}){const t=[];e.system&&t.push({role:"system",content:e.system}),t.push({role:"user",content:o});let r=0;return await Promise.all(c.map(async m=>{var s;const a=await g(m,t,e);return a.ok&&(r+=1,a.place=r),(s=e.onResult)==null||s.call(e,a),a}))}async function h(o,c,e){const t=c.filter(n=>n.ok&&n.text);if(t.length<2)return{verdict:"Need at least two answers to compare.",ranking:[]};const r=t.map((n,l)=>String.fromCharCode(65+l)),u=t.map((n,l)=>`### Answer ${r[l]}
${n.text}`).join(`

`);let s=(await d({messages:[{role:"system",content:"You are judging answers to the same question. Be specific and terse. Rank them best to worst, give one sentence of justification each, and name the single best. Judge only the text — you do not know who wrote what."},{role:"user",content:`Question:
${o}

${u}

Rank them.`}],model:e})).text;t.forEach((n,l)=>{s=s.replace(new RegExp(`Answer ${r[l]}\\b`,"g"),n.label)});const i=[];for(const n of t)s.indexOf(n.label)>=0&&i.push(n.label);return{verdict:s,ranking:i}}export{h as j,b as r};
