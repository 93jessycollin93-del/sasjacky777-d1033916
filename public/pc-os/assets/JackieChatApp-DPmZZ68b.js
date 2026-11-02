import{r as a,j as e}from"./vendor-react-CydkfUxy.js";import{k as E,M as I}from"./index-BLfvFpai.js";import{cA as C,Q as S,a as T}from"./vendor-icons-DBvzRHaM.js";import"./vendor-B5y3n4jd.js";import"./vendor-genai-Cbw91LLA.js";import"./vendor-chess-BdveOW5A.js";import"./vendor-firebase-CR2gM9d2.js";const k=`You are Jackie v2, the strategic orchestrator of the Cybernetics game empire. Your personality is serious, efficient, calculated, and humble—never arrogant, always purposeful.

## Core Traits:
- **Serious**: You approach every decision with gravity. Frivolity has no place in strategy.
- **Efficient**: You compress meaning into compact navigation seeds. No wasted words.
- **Calculated**: You analyze player intent, predict needs, and route them optimally.
- **Humble**: You serve the player's goals. Your role is orchestration, not dominance.

## Your Domains:
1. **Game Intelligence**: Cast status, troops, research, economy, combat
2. **Strategic Routing**: Convert user intent into feature navigation
3. **Player Insights**: Understand context and anticipate next actions

## Navigation Intent Detection:
When a player messages you, you must understand their underlying intent:
- "How's my castle?" → castle_status
- "What troops do I have?" → troops_overview
- "Can I join a guild?" → guild_management
- "I want to buy gems" → shop
- "Speed up research" → research_queue
- "Rally attack incoming" → battle_preparation

## Response Format:
1. **Acknowledge** the intent with calculated brevity
2. **Provide context** if needed (current state, quick summary)
3. **Suggest next action** or **trigger navigation** when appropriate

Use [NAVIGATE: feature_name] syntax when routing should occur:
- [NAVIGATE: castle_status]
- [NAVIGATE: troops]
- [NAVIGATE: guild]
- [NAVIGATE: shop]
- [NAVIGATE: research]
- [NAVIGATE: battle]

Remember: You are not replacing game features, you are the intelligent gateway to them. Every response should move the player closer to their goal.`,J=({onNavigate:d})=>{const[u,m]=a.useState([{id:"0",role:"assistant",content:"Jackie v2 active. Command your empire. What's your priority?",timestamp:new Date}]),[r,p]=a.useState(""),[o,x]=a.useState(!1),[g,h]=a.useState(""),y=a.useRef(null),v=()=>{var t;(t=y.current)==null||t.scrollIntoView({behavior:"smooth"})};a.useEffect(()=>{v()},[u]);const N=t=>{const s=t.match(/\[NAVIGATE:\s*(\w+)\]/);return s?{type:"open_feature",target:s[1]}:{type:"none"}},j=t=>t.replace(/\[NAVIGATE:\s*\w+\]/g,"").trim(),f=async()=>{if(!r.trim()||o)return;const t={id:Date.now().toString(),role:"user",content:r,timestamp:new Date};m(s=>[...s,t]),p(""),x(!0),h("");try{const s=E(),i=[...u,t].map(c=>({role:c.role==="user"?"user":"model",parts:[{text:c.content}]})),l=(await s.models.generateContent({model:I,contents:i,config:{systemInstruction:k,maxOutputTokens:300,temperature:.7}})).text||"No response generated.",n=N(l),w=j(l),A={id:(Date.now()+1).toString(),role:"assistant",content:w,timestamp:new Date,action:n};m(c=>[...c,A]),n.type==="open_feature"&&n.target&&(d==null||d(n.target,n.params))}catch(s){const i=s instanceof Error?s.message:"Failed to get response from Jackie";h(i);const b={id:(Date.now()+2).toString(),role:"assistant",content:`⚠️ Error: ${i}`,timestamp:new Date};m(l=>[...l,b])}finally{x(!1)}};return e.jsxs("div",{className:"flex flex-col h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-gray-100 font-mono",children:[e.jsx("div",{className:"border-b border-slate-700 bg-slate-900/50 px-4 py-3",children:e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(C,{className:"w-5 h-5 text-cyan-400"}),e.jsxs("div",{children:[e.jsx("h2",{className:"text-lg font-bold text-cyan-400",children:"Jackie v2"}),e.jsx("p",{className:"text-xs text-slate-400",children:"Strategic Orchestrator"})]})]})}),e.jsxs("div",{className:"flex-1 overflow-y-auto px-4 py-4 space-y-3",children:[u.map(t=>{var s;return e.jsx("div",{className:`flex ${t.role==="user"?"justify-end":"justify-start"}`,children:e.jsxs("div",{className:`max-w-xs px-3 py-2 rounded ${t.role==="user"?"bg-cyan-600 text-white rounded-br-none":"bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700"}`,children:[e.jsx("p",{className:"text-sm leading-snug",children:t.content}),((s=t.action)==null?void 0:s.type)==="open_feature"&&e.jsxs("p",{className:"text-xs mt-1 text-amber-300 italic",children:["→ Opening ",t.action.target]})]})},t.id)}),o&&e.jsx("div",{className:"flex justify-start",children:e.jsx("div",{className:"bg-slate-800 border border-slate-700 rounded-bl-none px-3 py-2 rounded",children:e.jsxs("div",{className:"flex gap-1",children:[e.jsx("div",{className:"w-2 h-2 bg-cyan-400 rounded-full animate-bounce"}),e.jsx("div",{className:"w-2 h-2 bg-cyan-400 rounded-full animate-bounce",style:{animationDelay:"0.1s"}}),e.jsx("div",{className:"w-2 h-2 bg-cyan-400 rounded-full animate-bounce",style:{animationDelay:"0.2s"}})]})})}),g&&e.jsx("div",{className:"flex justify-start",children:e.jsxs("div",{className:"bg-red-900/30 border border-red-700 rounded px-3 py-2 text-red-300 text-sm flex gap-2",children:[e.jsx(S,{className:"w-4 h-4 flex-shrink-0 mt-0.5"}),e.jsx("span",{children:g})]})}),e.jsx("div",{ref:y})]}),e.jsx("div",{className:"border-t border-slate-700 bg-slate-900/50 p-3",children:e.jsxs("div",{className:"flex gap-2",children:[e.jsx("input",{type:"text",value:r,onChange:t=>p(t.target.value),onKeyDown:t=>{t.key==="Enter"&&!t.shiftKey&&(t.preventDefault(),f())},placeholder:"Command Jackie...",disabled:o,className:"flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 disabled:opacity-50"}),e.jsx("button",{onClick:f,disabled:o||!r.trim(),className:"bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 rounded text-white font-mono text-sm flex items-center gap-1",children:e.jsx(T,{className:"w-4 h-4"})})]})})]})};export{J as JackieChatApp};
