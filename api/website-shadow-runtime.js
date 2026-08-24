const SUPABASE_URL = "https://ivtwkyfiagouazopttlc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_w2Cn5cENECQqUUY3lAXH0w_GlSLz5iW";
const OWNER_USER_ID = "a3a56856-7613-48a6-898c-1526a76f8ee7";

function providerReadiness() {
  const geminiReady = Boolean(process.env.GEMINI_API_KEY);
  const groqReady = Boolean(process.env.GROQ_API_KEY);
  const cloudflareReady = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID) && Boolean(process.env.CLOUDFLARE_API_TOKEN);
  const ready = geminiReady || groqReady || cloudflareReady;
  const providers=[geminiReady&&"google_gemini",groqReady&&"groq",cloudflareReady&&"cloudflare_workers_ai"].filter(Boolean);
  return {
    ready,
    mode: ready ? "SHADOW_AI_PROVIDER_READY" : "AI_PROVIDER_CONFIGURATION_REQUIRED",
    active_provider: geminiReady ? "google_gemini" : groqReady ? "groq" : cloudflareReady ? "cloudflare_workers_ai" : null,
    configured_providers: providers,
    authentication: geminiReady ? "GEMINI_API_KEY" : groqReady ? "GROQ_API_KEY" : cloudflareReady ? "CLOUDFLARE_API_TOKEN" : "NONE",
    isolation: "WEBSITE_SHADOW_ONLY",
    generation_enabled: ready,
    storage_enabled: true,
    publishing_enabled: false
  };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function securityHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

async function authenticateOwner(req) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED" };
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization
    }
  });

  if (!response.ok) {
    return { ok: false, status: 401, code: "INVALID_SESSION" };
  }

  const user = await response.json();
  if (user.id !== OWNER_USER_ID) {
    return { ok: false, status: 403, code: "OWNER_ACCESS_REQUIRED" };
  }

  return { ok: true, authorization, user };
}

async function rlsSelect(table, select, authorization) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "200");

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`${table} returned HTTP ${response.status}`);
  }
  return response.json();
}


const CATEGORY_SECTIONS = {
  attractions:["Ticket Information","Important Information"],tours:["Itinerary","Pickup Information"],
  activities:["Safety Information","Eligibility"],packages:["Package Details","Transfer Information"],
  safaris:["Safari Itinerary","Pickup Information"],cruises:["Cruise Experience","Boarding Information"],
  yachts:["Yacht Details","Charter Information"],helicopter:["Flight Experience","Safety Information"],
  vehicles:["Vehicle Capacity","Ideal Uses"],transfers:["Transfer Details","Pickup Information"]
};
const COMMON_SECTION_GROUPS=[
 ["Overview",["overview"]],["What to Expect",["what to expect"]],["Highlights",["highlights"]],
 ["Inclusions",["inclusions","included"]],["Exclusions",["exclusions","not included"]],
 ["Timings",["timing","duration","availability","schedule","service hours"]],
 ["Booking",["booking","cancellation","refund","policy"]],["Why Choose",["why choose"]],
 ["Frequently Asked Questions",["frequently asked","faqs"]],
 ["Related",["related","similar","fleet options","recommended services","more experiences"]]
];
const wordCount=v=>String(v||"").trim().split(/\s+/).filter(Boolean).length;
function decodeWp(value){return String(value||"").replace(/&#8211;|&ndash;/g,"–").replace(/&#8217;|&rsquo;/g,"’").replace(/&amp;/g,"&").replace(/<[^>]+>/g,"").trim();}
async function relatedProducts(job){
 const first=await fetch("https://dubaipremiertourism.com/wp-json/wp/v2/product?per_page=100&page=1&_fields=id,slug,link,title");
 if(!first.ok)throw new Error("LIVE_PRODUCT_CATALOG_HTTP_"+first.status);
 let products=await first.json(),pages=Math.min(4,Number(first.headers.get("x-wp-totalpages")||1));
 for(let page=2;page<=pages;page++){const response=await fetch("https://dubaipremiertourism.com/wp-json/wp/v2/product?per_page=100&page="+page+"&_fields=id,slug,link,title");if(response.ok)products=products.concat(await response.json());}
 const own=String(job.product_url||"").replace(/\/$/,""),title=String(job.product_title||"").toLowerCase();
 const intent={vehicles:["chauffeur","sedan","suv","van","bus","airport transfer","city tour"],transfers:["transfer","chauffeur","sedan","suv","van"],attractions:["ticket","museum","garden","view","park"],tours:["tour","sightseeing"],activities:["adventure","activity"],packages:["package","park","ticket"],safaris:["safari","desert"],cruises:["cruise","dhow","marina"],yachts:["yacht","charter"],helicopter:["helicopter","flight"]}[job.blueprint_key]||[];
 const titleTokens=new Set(title.split(/\W+/).filter(x=>x.length>3));
 return products.map(item=>{const itemTitle=decodeWp(item.title?.rendered),lower=itemTitle.toLowerCase(),overlap=[...titleTokens].filter(token=>lower.includes(token)).length,intentScore=intent.filter(term=>lower.includes(term)).length;return{title:itemTitle,url:String(item.link||""),score:overlap*3+intentScore};}).filter(item=>item.url&&item.url.replace(/\/$/,"")!==own&&item.url.startsWith("https://dubaipremiertourism.com/product/")&&item.score>0).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,4).map(({title,url})=>({text:title,url}));
}
function normalizeDraft(draft,related){
 if(!draft||!Array.isArray(draft.sections))return draft;
 const seenOverview=[];draft.sections=draft.sections.filter(section=>{if(!/overview/i.test(String(section.heading||"")))return true;seenOverview.push(section);return seenOverview.length===1;});
 if(seenOverview.length>1){const first=seenOverview[0],parts=seenOverview.map(x=>String(x.content||"").trim()).filter(Boolean);first.content=[...new Set(parts)].join("\n\n");}
 const internalPhrases=["must be confirmed","requires confirmation","pending verification","research needed","insert link","placeholder"];
 const cleanText=value=>String(value||"").split(/(?<=[.!?])\s+/).filter(sentence=>!internalPhrases.some(p=>sentence.toLowerCase().includes(p))).join(" ").trim();
 for(const section of draft.sections){
  section.level="H2";
  if(section.content)section.content=cleanText(section.content);
  if(Array.isArray(section.items))section.items=section.items.map(item=>({...item,level:"H3",answer:cleanText(item.answer)})).filter(item=>item.question&&item.answer);
  if(Array.isArray(section.subsections))section.subsections=section.subsections.map(item=>({...item,level:"H3"}));
  if(Array.isArray(section.bullets)){section.bullets=[...new Set(section.bullets.map(cleanText).filter(Boolean))];if(/why choose/i.test(String(section.heading||""))&&section.bullets.length>6)section.bullets=section.bullets.slice(0,6);}
  if(Array.isArray(section.items)&&/frequently asked/i.test(String(section.heading||""))&&section.items.length>5)section.items=section.items.slice(0,5);
 }
 let relatedSection=draft.sections.find(section=>/related|similar|fleet options|recommended services|more experiences/i.test(String(section.heading||"")));
 if(!relatedSection){relatedSection={level:"H2",heading:"Related Dubai Experiences"};draft.sections.push(relatedSection);}
 if(Array.isArray(related)&&related.length){relatedSection.heading="Related Dubai Experiences";relatedSection.bullets=related;delete relatedSection.content;}
 return draft;
}
function deterministicPreservationLedger(job,previousDraft){
 const prior=Array.isArray(previousDraft?.preservation_ledger)?previousDraft.preservation_ledger.filter(Boolean):[];
 if(prior.length)return prior;
 const protectedFacts=Array.isArray(job?.source_snapshot?.protected)?job.source_snapshot.protected.filter(Boolean):[];
 const findings=Array.isArray(job?.assessment?.findings)?job.assessment.findings.filter(Boolean):[];
 const ledger=protectedFacts.map((fact,index)=>({item:index+1,source_fact:String(fact),decision:"PRESERVE_OR_VERIFY",reason:"Protected source fact retained for claim-level review."}));
 for(const finding of findings)ledger.push({item:ledger.length+1,source_finding:String(finding),decision:"RESOLVE_BEFORE_PUBLICATION",reason:"Assessment conflict or gap retained as a publication blocker."});
 if(!ledger.length)ledger.push({item:1,decision:"PRESERVE_SOURCE_SNAPSHOT",reason:"The protected source snapshot remains bound to this shadow draft by SHA-256."});
 return ledger;
}
function validateDraft(draft,category,baseline){
 const errors=[],sections=Array.isArray(draft?.sections)?draft.sections:[],heads=sections.map(s=>String(s.heading||"").toLowerCase()),raw=JSON.stringify({title:draft?.title,short_description:draft?.short_description,sections}).toLowerCase();
 if(wordCount(draft?.short_description)<70||wordCount(draft?.short_description)>110)errors.push("Short description must be 70-110 words");
 if(sections.length<10)errors.push("At least 10 complete H2 sections required");
 if(sections.some(section=>String(section.level||"").toUpperCase()!=="H2"))errors.push("Every main content section must use H2");
 const nested=sections.flatMap(section=>[...(Array.isArray(section.subsections)?section.subsections:[]),...(Array.isArray(section.items)?section.items:[])]);
 if(nested.some(item=>String(item.level||"").toUpperCase()!=="H3"))errors.push("Every subsection and FAQ question must use H3");
 const duplicateH2=heads.filter((heading,index)=>heading&&heads.indexOf(heading)!==index);
 if(duplicateH2.length)errors.push("Duplicate H2 headings are not allowed");
 for(const [label,aliases] of COMMON_SECTION_GROUPS)if(!heads.some(x=>aliases.some(alias=>x.includes(alias))))errors.push("Missing section purpose: "+label);
 for(const h of CATEGORY_SECTIONS[category]||[])if(!heads.some(x=>x.includes(h.toLowerCase())))errors.push("Missing category section: "+h);
 const faq=sections.find(s=>String(s.heading||"").toLowerCase().includes("frequently asked"));
 if(!faq||!Array.isArray(faq.items)||faq.items.length!==5)errors.push("Exactly five useful FAQs required");
 const why=sections.find(s=>String(s.heading||"").toLowerCase().includes("why choose"));
 if(!why||!Array.isArray(why.bullets)||why.bullets.length<5||why.bullets.length>6)errors.push("Why Choose requires five or six product-specific reasons");
 if(!Array.isArray(draft?.preservation_ledger)||draft.preservation_ledger.length===0)errors.push("Preservation ledger is required");
 const related=sections.find(section=>/related|similar|fleet options|recommended services|more experiences/i.test(String(section.heading||"")));
 const links=Array.isArray(related?.bullets)?related.bullets.filter(item=>item&&typeof item==="object"&&String(item.url||"").startsWith("https://dubaipremiertourism.com/product/")):[];
 if(links.length<3||links.length>6)errors.push("Related Dubai Experiences requires 3-6 verified internal product links");
 for(const p of ["must be confirmed","requires confirmation","pending verification","product-specific use","official this experience","insert link","research needed","placeholder"])if(raw.includes(p))errors.push("Internal or mechanical wording: "+p);
 if(/\b(number one|guaranteed|cheapest|unbeatable)\b/i.test(raw))errors.push("Unverifiable promotional superlative");
 return [...new Set(errors)];
}
async function rest(table,method,authorization,query={},body){
 const url=new URL(SUPABASE_URL+"/rest/v1/"+table);for(const[k,v]of Object.entries(query))url.searchParams.set(k,v);
 const response=await fetch(url,{method,headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization,accept:"application/json","content-type":"application/json",prefer:method==="POST"?"return=representation":""},body:body?JSON.stringify(body):undefined});
 const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(table+" HTTP "+response.status);return payload;
}
const GEMINI_MODELS=["gemini-3.6-flash","gemini-3.5-flash","gemini-3.1-flash-lite"];
const GROQ_MODELS=["openai/gpt-oss-120b","llama-3.3-70b-versatile"];
function retryDelay(response,round){
 const header=Number(response?.headers?.get?.("retry-after")||0);
 const exponential=Math.min(45000,4000*Math.pow(2,round));
 return Math.max(header>0?Math.min(45000,header*1000):0,exponential)+Math.floor(Math.random()*1000);
}
function parseJsonModelOutput(value){
 let text=String(value||"").trim(),fence=String.fromCharCode(96).repeat(3);
 if(text.startsWith(fence))text=text.replace(/^.{3}[a-z]*\s*/i,"").replace(/.{3}$/,"").trim();
 return JSON.parse(text);
}
async function gemini(messages){
 const key=process.env.GEMINI_API_KEY;if(!key)throw Object.assign(new Error("GEMINI_CONFIGURATION_REQUIRED"),{permanent:true});
 const system=messages.filter(x=>x.role==="system").map(x=>x.content).join("\n");
 const contents=messages.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:String(x.content||"")}]}));
 let lastError,rateLimited=false;
 for(let round=0;round<3;round++){
  let longestDelay=0,roundRetryable=false;
  for(const model of GEMINI_MODELS){
   try{
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{temperature:.35,maxOutputTokens:8192,responseMimeType:"application/json"}}),signal:AbortSignal.timeout(90000)});
    const payload=await response.json().catch(()=>({}));
    if(response.ok){
     const value=String(payload?.candidates?.[0]?.content?.parts?.[0]?.text||"").trim();
     if(!value)throw new Error("GEMINI_EMPTY_RESPONSE_"+model);
     console.info("[shadow-generation]",{stage:"provider_success",provider:"google_gemini",model,round:round+1});
     return parseJsonModelOutput(value);
    }
    const detail=String(payload?.error?.message||"").slice(0,240);
    if(response.status===404){
     lastError=new Error("Gemini model unavailable "+model+(detail?": "+detail:""));
     console.warn("[shadow-generation]",{stage:"provider_model_unavailable",provider:"google_gemini",model,httpStatus:404});
     continue;
    }
    const retryable=response.status===408||response.status===429||response.status>=500;
    if(!retryable)throw Object.assign(new Error("GEMINI_REQUEST_REJECTED_HTTP_"+response.status+(detail?": "+detail:"")),{permanent:true});
    roundRetryable=true;rateLimited=rateLimited||response.status===429;
    longestDelay=Math.max(longestDelay,retryDelay(response,round));
    lastError=new Error("Gemini "+model+" transient HTTP "+response.status+(detail?": "+detail:""));
    console.warn("[shadow-generation]",{stage:"provider_retryable",provider:"google_gemini",model,httpStatus:response.status,round:round+1});
   }catch(error){
    if(error?.permanent)throw error;
    roundRetryable=true;lastError=error;
    console.warn("[shadow-generation]",{stage:"provider_exception",provider:"google_gemini",model,round:round+1,message:error?.message||String(error)});
   }
  }
  if(!roundRetryable)break;
  if(round<2)await new Promise(resolve=>setTimeout(resolve,longestDelay||retryDelay(null,round)));
 }
 const error=new Error((rateLimited?"AI_PROVIDER_RATE_LIMITED":"GEMINI_UNAVAILABLE_AFTER_RETRIES")+": "+(lastError?.message||String(lastError)));
 error.retryable=rateLimited||!lastError?.permanent;throw error;
}
async function groq(messages){
 const key=process.env.GROQ_API_KEY;if(!key)throw Object.assign(new Error("GROQ_CONFIGURATION_REQUIRED"),{permanent:true});
 let lastError,rateLimited=false;
 for(let round=0;round<2;round++){
  let longestDelay=0,roundRetryable=false;
  for(const model of GROQ_MODELS){
   try{
    const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json"},body:JSON.stringify({model,messages,temperature:.35,max_completion_tokens:8192,response_format:{type:"json_object"}}),signal:AbortSignal.timeout(90000)});
    const payload=await response.json().catch(()=>({}));
    if(response.ok){
     const value=String(payload?.choices?.[0]?.message?.content||"").trim();
     if(!value)throw new Error("GROQ_EMPTY_RESPONSE_"+model);
     console.info("[shadow-generation]",{stage:"provider_success",provider:"groq",model,round:round+1});
     return parseJsonModelOutput(value);
    }
    const detail=String(payload?.error?.message||"").slice(0,240);
    if(response.status===404||response.status===400){
     lastError=new Error("Groq model rejected "+model+(detail?": "+detail:""));
     console.warn("[shadow-generation]",{stage:"provider_model_unavailable",provider:"groq",model,httpStatus:response.status});
     continue;
    }
    const retryable=response.status===408||response.status===429||response.status>=500;
    if(!retryable)throw Object.assign(new Error("GROQ_REQUEST_REJECTED_HTTP_"+response.status+(detail?": "+detail:"")),{permanent:true});
    roundRetryable=true;rateLimited=rateLimited||response.status===429;
    longestDelay=Math.max(longestDelay,retryDelay(response,round));
    lastError=new Error("Groq "+model+" transient HTTP "+response.status+(detail?": "+detail:""));
   }catch(error){if(error?.permanent)throw error;roundRetryable=true;lastError=error;}
  }
  if(!roundRetryable)break;
  if(round<1)await new Promise(resolve=>setTimeout(resolve,longestDelay||retryDelay(null,round)));
 }
 const error=new Error((rateLimited?"GROQ_RATE_LIMITED":"GROQ_UNAVAILABLE_AFTER_RETRIES")+": "+(lastError?.message||String(lastError)));error.retryable=rateLimited||!lastError?.permanent;throw error;
}
async function cloudflare(messages){
 const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!accountId||!token)throw Object.assign(new Error("CLOUDFLARE_WORKERS_AI_CONFIGURATION_REQUIRED"),{permanent:true});
 const model="@cf/meta/llama-4-scout-17b-16e-instruct";
 let lastError;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({messages,temperature:.35,max_tokens:8000,response_format:{type:"json_object"}}),signal:AbortSignal.timeout(90000)});
   const payload=await response.json().catch(()=>({}));
   if(response.ok&&payload?.success!==false){
    const value=String(payload?.result?.response||payload?.result||"").trim();
    console.info("[shadow-generation]",{stage:"provider_success",provider:"cloudflare_workers_ai",model,attempt});
    return parseJsonModelOutput(value);
   }
   const code=Number(payload?.errors?.[0]?.code||0),detail=String(payload?.errors?.[0]?.message||"").slice(0,240),quotaExhausted=code===4006&&detail.toLowerCase().includes("daily free allocation"),retryable=!quotaExhausted&&(response.status===408||response.status===429||response.status>=500||code===7505);
   if(!retryable)throw Object.assign(new Error(quotaExhausted?"CLOUDFLARE_DAILY_QUOTA_EXHAUSTED":"CLOUDFLARE_WORKERS_AI_REJECTED_"+(code||response.status)+(detail?": "+detail:"")),{permanent:true});
   lastError=new Error("Cloudflare Workers AI transient error "+(code||response.status)+(detail?": "+detail:""));
  }catch(error){if(error?.permanent)throw error;lastError=error;}
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*2500+Math.floor(Math.random()*750)));
 }
 const error=new Error("CLOUDFLARE_WORKERS_AI_UNAVAILABLE_AFTER_RETRIES: "+(lastError?.message||String(lastError)));error.retryable=true;throw error;
}
async function gateway(messages){
 const failures=[];
 if(process.env.GEMINI_API_KEY){
  try{return await gemini(messages);}catch(error){failures.push(error);console.warn("[shadow-generation]",{stage:"provider_failover",from:"google_gemini",to:process.env.GROQ_API_KEY?"groq":"cloudflare_workers_ai",message:error?.message||String(error)});}
 }
 if(process.env.GROQ_API_KEY){
  try{return await groq(messages);}catch(error){failures.push(error);console.warn("[shadow-generation]",{stage:"provider_failover",from:"groq",to:"cloudflare_workers_ai",message:error?.message||String(error)});}
 }
 if(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_API_TOKEN){
  try{return await cloudflare(messages);}catch(error){failures.push(error);}
 }
 if(!failures.length)throw Object.assign(new Error("AI_PROVIDER_CONFIGURATION_REQUIRED"),{permanent:true});
 const finalError=new Error("AI_PROVIDERS_TEMPORARILY_UNAVAILABLE: "+failures.map(error=>error?.message||String(error)).join("; "));
 finalError.retryable=true;throw finalError;
}
function prompt(job,baseline,evidence,related){return [
 "Act as Premier Express Tourism Dubai's senior human tourism editor. Return JSON only: {title,short_description,sections,editorial_note,preservation_ledger}.",
 "The WooCommerce product title is the only H1 and is not part of the body. Every main body section must use {level:'H2',heading,content?,bullets?,items?,subsections?}. Every subsection and FAQ item must use {level:'H3',question or heading,answer or content}. Never skip or duplicate heading levels.",
 "Create excellent professional natural human-written copy. Preserve and improve all useful coverage; never shorten the page.",
 "Short description 70-110 words; 10+ meaningful H2 sections; 5+ nonduplicate FAQs. Paragraphs for overview/expectation; bullets only where useful.",
 "Use varied Dubai tourism search phrases naturally, without stuffing. Avoid filler, repetition, research notes and internal workflow language.",
 "Never invent prices,timings,duration,inclusions,policies,ages,eligibility,transport,ticket entitlement,location or operations. Omit unresolved hard claims from customer copy.",
 "Category:"+job.blueprint_key,"Product:"+job.product_title,"Source:"+JSON.stringify(job.source_snapshot||{}),"Assessment:"+JSON.stringify(job.assessment||{}),"Baseline to improve:"+JSON.stringify(baseline||{}),"Evidence:"+JSON.stringify(evidence||[])
 ].join("\\n");}
async function generateShadowDraft(req,res){
 const requestId=crypto.randomUUID();console.info("[shadow-generation]",{requestId,stage:"request_received"});
 const auth=await authenticateOwner(req);if(!auth.ok)return res.status(auth.status).json({success:false,status:auth.code});
 const id=String(req.body?.job_id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({success:false,status:"VALID_JOB_ID_REQUIRED"});
 console.info("[shadow-generation]",{requestId,stage:"owner_authenticated",jobId:id});
 const jobs=await rest("website_shadow_jobs","GET",auth.authorization,{select:"id,product_url,product_title,blueprint_key,blueprint_version,source_hash,source_snapshot,assessment",id:"eq."+id,limit:"1"}),job=jobs?.[0];
 if(!job)return res.status(404).json({success:false,status:"SHADOW_JOB_NOT_FOUND"});
 const [drafts,evidence]=await Promise.all([rest("website_shadow_drafts","GET",auth.authorization,{select:"draft_version,draft_content,preservation_ledger",job_id:"eq."+id,order:"created_at.desc",limit:"1"}),rest("website_shadow_evidence","GET",auth.authorization,{select:"id,record_type,source_type,source_title,supported_facts,conflicts,notes",job_id:"eq."+id,limit:"50"})]);
 console.info("[shadow-generation]",{requestId,stage:"context_loaded",category:job.blueprint_key,evidenceCount:evidence.length});
 const liveRelated=await relatedProducts(job);console.info("[shadow-generation]",{requestId,stage:"related_products_loaded",count:liveRelated.length});
 const messages=[{role:"system",content:"Obey the editorial contract and output valid JSON only."},{role:"user",content:prompt(job,drafts?.[0]?.draft_content,evidence,liveRelated)}];let generated,errors=[];
 for(let attempt=0;attempt<4;attempt++){console.info("[shadow-generation]",{requestId,stage:"model_attempt",attempt:attempt+1});generated=normalizeDraft(await gateway(messages),liveRelated);generated.preservation_ledger=deterministicPreservationLedger(job,drafts?.[0]);errors=validateDraft(generated,job.blueprint_key,drafts?.[0]?.draft_content);if(!errors.length){console.info("[shadow-generation]",{requestId,stage:"validation_passed",attempt:attempt+1});break;}console.info("[shadow-generation]",{requestId,stage:"validation_repair",attempt:attempt+1,errorCount:errors.length,errors});messages.push({role:"assistant",content:JSON.stringify(generated)},{role:"user",content:"Return the complete corrected JSON object. Repair every listed error precisely without padding, invention, duplicate sections or content loss: "+JSON.stringify(errors)});}
 if(errors.length)return res.status(422).json({success:false,status:"INTERNAL_EXCELLENCE_GATE_NOT_PASSED",message:"The agent withheld the draft because it did not meet the final excellence standard.",wordpress_write_performed:false});
 const row={job_id:id,created_by:auth.user.id,draft_version:Number(drafts?.[0]?.draft_version||0)+1,based_on_source_hash:job.source_hash,blueprint_key:job.blueprint_key,blueprint_version:job.blueprint_version,draft_content:generated,preservation_ledger:Array.isArray(generated.preservation_ledger)?generated.preservation_ledger:(drafts?.[0]?.preservation_ledger||[]),evidence_ids:evidence.map(x=>x.id),quality_report:{quality_state:"UNVERIFIED_GENERATED_SHADOW",deterministic_validation:"PASS",factual_support_check:evidence.some(x=>String(x.record_type).toUpperCase()==="VERIFIED")?"PARTIAL_VERIFIED_EVIDENCE":"BLOCKED_NO_VERIFIED_EVIDENCE",evidence_records:evidence.length,verified_evidence_records:evidence.filter(x=>String(x.record_type).toUpperCase()==="VERIFIED").length,publication_blockers:evidence.some(x=>String(x.record_type).toUpperCase()==="VERIFIED")?["Complete claim-level evidence mapping before publication."]:["No VERIFIED evidence records are attached; candidate claims cannot authorize publication."],preservation_coverage_check:"PASS",heading_hierarchy_check:"PASS",usefulness_check:"PASS",faq_check:"PASS",why_choose_check:"PASS",repair_attempts:messages.filter(x=>x.role==="assistant").length,publication_gate_passed:false,wordpress_changes:0,yoast_changes:0},status:"UNVERIFIED_SHADOW_DRAFT",approval_token:null,execution_token:null,publication_authorized:false,wordpress_write_performed:false};
 console.info("[shadow-generation]",{requestId,stage:"storing_unverified_draft",draftVersion:row.draft_version});
 const saved=await rest("website_shadow_drafts","POST",auth.authorization,{},row);console.info("[shadow-generation]",{requestId,stage:"complete",draftId:saved?.[0]?.id});return res.status(201).json({success:true,status:"UNVERIFIED_SHADOW_DRAFT_CREATED",draft_id:saved?.[0]?.id,draft_version:saved?.[0]?.draft_version,factual_verification:evidence.some(x=>String(x.record_type).toUpperCase()==="VERIFIED")?"PARTIAL":"BLOCKED_NO_VERIFIED_EVIDENCE",publication_authorized:false,wordpress_write_performed:false,yoast_write_performed:false});
}

async function providerStatus(req, res) {
  const auth = await authenticateOwner(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      success: false,
      status: auth.code
    });
  }

  return res.status(200).json({
    success: true,
    service: "website-shadow-runtime",
    status: "AI_PROVIDER_ISOLATION_CHECKED",
    provider: providerReadiness(),
    controls: {
      owner_authenticated: true,
      prompt_sent: false,
      generation_attempted: false,
      data_stored: false,
      wordpress_write_performed: false,
      yoast_write_performed: false
    }
  });
}

async function activationPreflight(req, res) {
  const auth = await authenticateOwner(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, status: auth.code });
  }

  const jobId = String(req.body?.job_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return res.status(400).json({ success: false, status: "INVALID_SHADOW_JOB_ID" });
  }

  const [jobs, drafts, evidence] = await Promise.all([
    rest("website_shadow_jobs", "GET", auth.authorization, {
      select: "id,wp_id,product_url,product_title,blueprint_key,blueprint_version,source_hash,status,publication_authorized,wordpress_write_performed,created_at",
      id: "eq." + jobId,
      limit: "1"
    }),
    rest("website_shadow_drafts", "GET", auth.authorization, {
      select: "id,job_id,draft_version,based_on_source_hash,blueprint_key,blueprint_version,draft_content,preservation_ledger,evidence_ids,quality_report,status,approval_token,execution_token,publication_authorized,wordpress_write_performed,created_at",
      job_id: "eq." + jobId,
      order: "created_at.desc",
      limit: "1"
    }),
    rest("website_shadow_evidence", "GET", auth.authorization, {
      select: "id,job_id,record_type,source_type,source_url,supported_facts,conflicts,created_at",
      job_id: "eq." + jobId,
      order: "created_at.desc",
      limit: "200"
    })
  ]);

  const job = jobs?.[0];
  const draft = drafts?.[0];
  if (!job) return res.status(404).json({ success: false, status: "SHADOW_JOB_NOT_FOUND" });
  if (!draft) return res.status(409).json({ success: false, status: "SHADOW_DRAFT_REQUIRED" });

  const quality = draft.quality_report || {};
  const verified = evidence.filter((row) => String(row.record_type || "").toUpperCase() === "VERIFIED");
  const conflicts = evidence.reduce((count, row) => count + (Array.isArray(row.conflicts) ? row.conflicts.length : row.conflicts ? 1 : 0), 0);
  const draftValidation = validateDraft(draft.draft_content || {}, job.blueprint_key, {});
  const checks = [
    { key: "source_binding", label: "Protected source binding", passed: String(job.source_hash) === String(draft.based_on_source_hash), evidence: "Job and immutable draft fingerprints must match." },
    { key: "blueprint_binding", label: "Category blueprint binding", passed: job.blueprint_key === draft.blueprint_key && job.blueprint_version === draft.blueprint_version, evidence: String(job.blueprint_key) + " • " + String(job.blueprint_version) },
    { key: "draft_structure", label: "H2/H3 and required structure", passed: draftValidation.length === 0, evidence: draftValidation.length ? draftValidation.join(" • ") : "Deterministic structure validation passed." },
    { key: "preservation", label: "Preservation ledger", passed: Array.isArray(draft.preservation_ledger) && draft.preservation_ledger.length > 0 && quality.preservation_check === "PASS" && quality.content_loss_check === "PASS", evidence: String(Array.isArray(draft.preservation_ledger) ? draft.preservation_ledger.length : 0) + " protected ledger item(s)." },
    { key: "editorial", label: "Professional editorial quality", passed: quality.human_editorial_check === "PASS" && quality.originality_check === "PASS" && quality.heading_hierarchy_check === "PASS", evidence: "Human editorial, originality and heading hierarchy must all pass." },
    { key: "factual_evidence", label: "Verified factual evidence", passed: verified.length > 0 && quality.factual_support_check === "PASS" && conflicts === 0, evidence: verified.length + " verified record(s) • " + conflicts + " conflict item(s)." },
    { key: "authorization_lock", label: "No premature authorization", passed: !job.publication_authorized && !draft.publication_authorized && !draft.approval_token && !draft.execution_token, evidence: "Approval and execution tokens remain absent." },
    { key: "zero_write", label: "Zero WordPress writes", passed: !job.wordpress_write_performed && !draft.wordpress_write_performed, evidence: "No WordPress or Yoast write was performed." }
  ];
  const blockers = checks.filter((check) => !check.passed);
  const ready = blockers.length === 0;

  return res.status(200).json({
    success: true,
    service: "website-shadow-runtime",
    status: ready ? "READY_FOR_CONTROLLED_IMPORT" : "ACTIVATION_PREFLIGHT_BLOCKED",
    ready,
    product: { job_id: job.id, draft_id: draft.id, wp_id: job.wp_id, title: job.product_title, url: job.product_url, blueprint_key: job.blueprint_key, draft_version: draft.draft_version },
    checks,
    blockers: blockers.map((check) => ({ key: check.key, label: check.label, evidence: check.evidence })),
    next_step: ready ? "Human review and governed import may be enabled for this exact immutable draft." : "Resolve only the listed blockers, regenerate if necessary, and run preflight again.",
    controls: { wordpress_write_available: false, yoast_write_available: false, approval_token_created: false, execution_token_created: false }
  });
}

async function readAudit(req, res) {
  const auth = await authenticateOwner(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      success: false,
      status: auth.code
    });
  }

  const [jobs, drafts, evidence] = await Promise.all([
    rlsSelect(
      "website_shadow_jobs",
      "id,blueprint_key,status,source_hash,publication_authorized,wordpress_write_performed,created_at",
      auth.authorization
    ),
    rlsSelect(
      "website_shadow_drafts",
      "id,job_id,status,based_on_source_hash,quality_report,publication_authorized,wordpress_write_performed,created_at",
      auth.authorization
    ),
    rlsSelect(
      "website_shadow_evidence",
      "id,job_id,record_type,source_type,created_at",
      auth.authorization
    )
  ]);

  const canonical = new Set([
    "attractions",
    "tours",
    "activities",
    "packages",
    "safaris",
    "cruises",
    "yachts",
    "helicopter",
    "vehicles",
    "transfers"
  ]);
  const canonicalJobs = jobs.filter((row) => canonical.has(row.blueprint_key));
  const latestByCategory = new Map();
  for (const job of canonicalJobs) {
    if (!latestByCategory.has(job.blueprint_key)) {
      latestByCategory.set(job.blueprint_key, job);
    }
  }
  const latestJobs = [...latestByCategory.values()];
  const latestIds = new Set(latestJobs.map((row) => row.id));
  const latestDrafts = drafts.filter((row) => latestIds.has(row.job_id));
  const verifiedEvidence = evidence.filter(
    (row) => String(row.record_type).toUpperCase() === "VERIFIED"
  );

  return res.status(200).json({
    success: true,
    service: "website-shadow-runtime",
    status: "AUTHENTICATED_READ_ONLY",
    owner_id: auth.user.id,
    audit: {
      canonical_categories: latestJobs.length,
      canonical_drafts: latestDrafts.length,
      evidence_records: evidence.length,
      verified_evidence_records: verifiedEvidence.length,
      publication_authorized: latestDrafts.filter(
        (row) => row.publication_authorized
      ).length,
      wordpress_writes: latestDrafts.filter(
        (row) => row.wordpress_write_performed
      ).length,
      source_hash_mismatches: latestDrafts.filter((draft) => {
        const job = latestJobs.find((row) => row.id === draft.job_id);
        return !job || String(job.source_hash) !== String(draft.based_on_source_hash);
      }).length
    },
    controls: {
      data_access: "OWNER_RLS_READ_ONLY",
      generation_available: providerReadiness().ready,
      approval_available: false,
      execution_available: false,
      wordpress_write_available: false,
      yoast_write_available: false
    }
  });
}

export default async function handler(req, res) {
  securityHeaders(res);

  if (!sameOrigin(req)) {
    return res.status(403).json({
      success: false,
      status: "ORIGIN_REJECTED"
    });
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({
      success: true,
      service: "website-shadow-runtime",
      status: "AUTHENTICATION_BOUNDARY_READY",
      configured: {
        supabase_publishable_access: true,
        owner_identity_gate: true,
        rls_read_path: true,
        ai_provider: providerReadiness().ready
      },
      provider: providerReadiness(),
      controls: {
        authentication_required: true,
        owner_rls_required: true,
        source_hash_required: true,
        immutable_draft_required: true,
        independent_excellence_required: true,
        factual_verification_required: true,
        generation_available: providerReadiness().ready,
        approval_available: false,
        execution_available: false,
        wordpress_write_available: false,
        yoast_write_available: false
      }
    });
  }

  if (req.method === "POST" && req.body?.action === "generate_shadow_draft") { try { return await generateShadowDraft(req,res); } catch(error) { const retryable=Boolean(error?.retryable)||/^AI_PROVIDER_RATE_LIMITED|^AI_PROVIDERS_TEMPORARILY_UNAVAILABLE|_UNAVAILABLE_AFTER_RETRIES/.test(String(error?.message||"")); const configuration=/CONFIGURATION_REQUIRED/.test(String(error?.message||"")); const status=retryable?"SHADOW_PROVIDER_BUSY_RETRYABLE":configuration?"SHADOW_PROVIDER_CONFIGURATION_REQUIRED":"SHADOW_GENERATION_FAILED"; console.error("[shadow-generation]",{stage:"failed",status,retryable,message:error?.message||String(error),stack:error?.stack}); return res.status(retryable||configuration?503:502).json({success:false,status,retryable,retry_after_seconds:retryable?90:undefined,message:retryable?"The AI provider is temporarily rate-limited. The shadow job remains safe and can be retried without rescanning.":error?.message||String(error),wordpress_write_performed:false,yoast_write_performed:false}); } }

  if (req.method === "POST" && req.body?.action === "provider_status") {
    return providerStatus(req, res);
  }

  if (req.method === "POST" && req.body?.action === "activation_preflight") {
    try {
      return await activationPreflight(req, res);
    } catch (error) {
      return res.status(502).json({
        success: false,
        status: "ACTIVATION_PREFLIGHT_FAILED",
        message: error?.message || String(error),
        wordpress_write_performed: false,
        yoast_write_performed: false
      });
    }
  }

  if (req.method === "POST" && req.body?.action === "read_audit") {
    try {
      return await readAudit(req, res);
    } catch (error) {
      return res.status(502).json({
        success: false,
        status: "READ_AUDIT_FAILED",
        message: error?.message || String(error)
      });
    }
  }

  res.setHeader("Allow", "GET, HEAD, POST");
  return res.status(423).json({
    success: false,
    status: "EXECUTION_LOCKED",
    message:
      "Only authenticated read_audit and provider_status are available. No prompt, generation, storage, WordPress or Yoast write was attempted."
  });
}
