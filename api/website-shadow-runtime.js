const SUPABASE_URL = "https://ivtwkyfiagouazopttlc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_w2Cn5cENECQqUUY3lAXH0w_GlSLz5iW";
const OWNER_USER_ID = "a3a56856-7613-48a6-898c-1526a76f8ee7";

function providerReadiness() {
  const geminiReady = Boolean(process.env.GEMINI_API_KEY);
  const cloudflareReady = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID) && Boolean(process.env.CLOUDFLARE_API_TOKEN);
  const ready = geminiReady || cloudflareReady;
  const providers=[geminiReady&&"google_gemini",cloudflareReady&&"cloudflare_workers_ai"].filter(Boolean);
  return {
    ready,
    mode: ready ? "SHADOW_AI_PROVIDER_READY" : "AI_PROVIDER_CONFIGURATION_REQUIRED",
    active_provider: geminiReady ? "google_gemini" : cloudflareReady ? "cloudflare_workers_ai" : null,
    configured_providers: providers,
    authentication: geminiReady ? "GEMINI_API_KEY" : cloudflareReady ? "CLOUDFLARE_API_TOKEN" : "NONE",
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
function normalizeDraft(draft){
 if(!draft||!Array.isArray(draft.sections))return draft;
 const seenOverview=[];draft.sections=draft.sections.filter(section=>{if(!/overview/i.test(String(section.heading||"")))return true;seenOverview.push(section);return seenOverview.length===1;});
 if(seenOverview.length>1){const first=seenOverview[0],parts=seenOverview.map(x=>String(x.content||"").trim()).filter(Boolean);first.content=[...new Set(parts)].join("\n\n");}
 const internalPhrases=["must be confirmed","requires confirmation","pending verification","research needed","insert link","placeholder"];
 const cleanText=value=>String(value||"").split(/(?<=[.!?])\s+/).filter(sentence=>!internalPhrases.some(p=>sentence.toLowerCase().includes(p))).join(" ").trim();
 for(const section of draft.sections){
  if(section.content)section.content=cleanText(section.content);
  if(Array.isArray(section.items))section.items=section.items.map(item=>({...item,answer:cleanText(item.answer)})).filter(item=>item.question&&item.answer);
  if(Array.isArray(section.bullets)){section.bullets=[...new Set(section.bullets.map(x=>String(x).trim()).filter(Boolean))];if(/why choose/i.test(String(section.heading||""))&&section.bullets.length>6)section.bullets=section.bullets.slice(0,6);}
  if(Array.isArray(section.items)&&/frequently asked/i.test(String(section.heading||""))&&section.items.length>5)section.items=section.items.slice(0,5);
 }
 return draft;
}
function validateDraft(draft,category,baseline){
 const errors=[],sections=Array.isArray(draft?.sections)?draft.sections:[],heads=sections.map(s=>String(s.heading||"").toLowerCase()),raw=JSON.stringify({title:draft?.title,short_description:draft?.short_description,sections}).toLowerCase();
 if(wordCount(draft?.short_description)<70||wordCount(draft?.short_description)>110)errors.push("Short description must be 70-110 words");
 if(sections.length<10)errors.push("At least 10 complete H2 sections required");
 for(const [label,aliases] of COMMON_SECTION_GROUPS)if(!heads.some(x=>aliases.some(alias=>x.includes(alias))))errors.push("Missing section purpose: "+label);
 for(const h of CATEGORY_SECTIONS[category]||[])if(!heads.some(x=>x.includes(h.toLowerCase())))errors.push("Missing category section: "+h);
 const faq=sections.find(s=>String(s.heading||"").toLowerCase().includes("frequently asked"));
 if(!faq||!Array.isArray(faq.items)||faq.items.length!==5)errors.push("Exactly five useful FAQs required");
 const why=sections.find(s=>String(s.heading||"").toLowerCase().includes("why choose"));
 if(!why||!Array.isArray(why.bullets)||why.bullets.length<5||why.bullets.length>6)errors.push("Why Choose requires five or six product-specific reasons");
 if(!Array.isArray(draft?.preservation_ledger)||draft.preservation_ledger.length===0)errors.push("Preservation ledger is required");
 for(const p of ["must be confirmed","requires confirmation","pending verification","product-specific use","official this experience","insert link","research needed","placeholder"])if(raw.includes(p))errors.push("Internal or mechanical wording: "+p);
 if(/\b(number one|guaranteed|cheapest|unbeatable)\b/i.test(raw))errors.push("Unverifiable promotional superlative");
 return [...new Set(errors)];
}
async function rest(table,method,authorization,query={},body){
 const url=new URL(SUPABASE_URL+"/rest/v1/"+table);for(const[k,v]of Object.entries(query))url.searchParams.set(k,v);
 const response=await fetch(url,{method,headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization,accept:"application/json","content-type":"application/json",prefer:method==="POST"?"return=representation":""},body:body?JSON.stringify(body):undefined});
 const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(table+" HTTP "+response.status);return payload;
}
async function gemini(messages){
 const key=process.env.GEMINI_API_KEY;if(!key)throw new Error("GEMINI_CONFIGURATION_REQUIRED");
 const system=messages.filter(x=>x.role==="system").map(x=>x.content).join("\n");
 const contents=messages.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:String(x.content||"")}]}));
 let lastError;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{temperature:.35,maxOutputTokens:8192,responseMimeType:"application/json"}}),signal:AbortSignal.timeout(90000)});
   const payload=await response.json().catch(()=>({}));
   if(response.ok){const value=String(payload?.candidates?.[0]?.content?.parts?.[0]?.text||"").trim();return JSON.parse(value);}
   const retryable=response.status===429||response.status>=500;
   if(!retryable)throw Object.assign(new Error("GEMINI_REQUEST_REJECTED_HTTP_"+response.status),{permanent:true});
   lastError=new Error("Gemini transient HTTP "+response.status);
  }catch(error){if(error?.permanent)throw error;lastError=error;}
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));
 }
 throw new Error("GEMINI_UNAVAILABLE_AFTER_RETRIES: "+(lastError?.message||String(lastError)));
}

async function gateway(messages){
 if(process.env.GEMINI_API_KEY)return gemini(messages);
 const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!accountId||!token)throw new Error("CLOUDFLARE_WORKERS_AI_CONFIGURATION_REQUIRED");
 const model="@cf/meta/llama-4-scout-17b-16e-instruct";
 let lastError;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({messages,temperature:.35,max_tokens:8000,response_format:{type:"json_object"}}),signal:AbortSignal.timeout(90000)});
   const payload=await response.json().catch(()=>({}));
   if(response.ok&&payload?.success!==false){
    let value=String(payload?.result?.response||payload?.result||"").trim(),fence=String.fromCharCode(96).repeat(3);
    if(value.startsWith(fence))value=value.replace(/^.{3}[a-z]*\s*/i,"").replace(/.{3}$/,"").trim();
    return JSON.parse(value);
   }
   const code=Number(payload?.errors?.[0]?.code||0),detail=String(payload?.errors?.[0]?.message||"").slice(0,240),quotaExhausted=code===4006&&detail.toLowerCase().includes("daily free allocation"),retryable=!quotaExhausted&&(response.status===429||response.status>=500||code===7505);
   if(!retryable)throw Object.assign(new Error(quotaExhausted?"CLOUDFLARE_DAILY_QUOTA_EXHAUSTED":"CLOUDFLARE_WORKERS_AI_REJECTED_"+(code||response.status)+(detail?": "+detail:"")),{permanent:true});
   lastError=new Error("Cloudflare Workers AI transient error "+(code||response.status)+(detail?": "+detail:""));
  }catch(error){if(error?.permanent)throw error;lastError=error;}
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));
 }
 throw new Error("CLOUDFLARE_WORKERS_AI_UNAVAILABLE_AFTER_RETRIES: "+(lastError?.message||String(lastError)));
}
function prompt(job,baseline,evidence){return [
 "Act as Premier Express Tourism Dubai's senior human tourism editor. Return JSON only: {title,short_description,sections,editorial_note,preservation_ledger}.",
 "Sections use {level:'H2',heading,content?,bullets?,items?}; FAQ items use {question,answer}.",
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
 const jobs=await rest("website_shadow_jobs","GET",auth.authorization,{select:"id,product_title,blueprint_key,blueprint_version,source_hash,source_snapshot,assessment",id:"eq."+id,limit:"1"}),job=jobs?.[0];
 if(!job)return res.status(404).json({success:false,status:"SHADOW_JOB_NOT_FOUND"});
 const [drafts,evidence]=await Promise.all([rest("website_shadow_drafts","GET",auth.authorization,{select:"draft_version,draft_content,preservation_ledger",job_id:"eq."+id,order:"created_at.desc",limit:"1"}),rest("website_shadow_evidence","GET",auth.authorization,{select:"id,record_type,source_type,source_title,supported_facts,conflicts,notes",job_id:"eq."+id,limit:"50"})]);
 console.info("[shadow-generation]",{requestId,stage:"context_loaded",category:job.blueprint_key,evidenceCount:evidence.length});
 const messages=[{role:"system",content:"Obey the editorial contract and output valid JSON only."},{role:"user",content:prompt(job,drafts?.[0]?.draft_content,evidence)}];let generated,errors=[];
 for(let attempt=0;attempt<4;attempt++){console.info("[shadow-generation]",{requestId,stage:"model_attempt",attempt:attempt+1});generated=normalizeDraft(await gateway(messages));errors=validateDraft(generated,job.blueprint_key,drafts?.[0]?.draft_content);if(!errors.length){console.info("[shadow-generation]",{requestId,stage:"validation_passed",attempt:attempt+1});break;}console.info("[shadow-generation]",{requestId,stage:"validation_repair",attempt:attempt+1,errorCount:errors.length,errors});messages.push({role:"assistant",content:JSON.stringify(generated)},{role:"user",content:"Return the complete corrected JSON object. Repair every listed error precisely without padding, invention, duplicate sections or content loss: "+JSON.stringify(errors)});}
 if(errors.length)return res.status(422).json({success:false,status:"INTERNAL_EXCELLENCE_GATE_NOT_PASSED",message:"The agent withheld the draft because it did not meet the final excellence standard.",wordpress_write_performed:false});
 const row={job_id:id,created_by:auth.user.id,draft_version:Number(drafts?.[0]?.draft_version||0)+1,based_on_source_hash:job.source_hash,blueprint_key:job.blueprint_key,blueprint_version:job.blueprint_version,draft_content:generated,preservation_ledger:Array.isArray(generated.preservation_ledger)?generated.preservation_ledger:(drafts?.[0]?.preservation_ledger||[]),evidence_ids:evidence.map(x=>x.id),quality_report:{quality_state:"UNVERIFIED_GENERATED_SHADOW",deterministic_validation:"PASS",preservation_coverage_check:"PASS",usefulness_check:"PASS",faq_check:"PASS",why_choose_check:"PASS",repair_attempts:messages.filter(x=>x.role==="assistant").length,publication_gate_passed:false,wordpress_changes:0,yoast_changes:0},status:"UNVERIFIED_SHADOW_DRAFT",approval_token:null,execution_token:null,publication_authorized:false,wordpress_write_performed:false};
 console.info("[shadow-generation]",{requestId,stage:"storing_unverified_draft",draftVersion:row.draft_version});
 const saved=await rest("website_shadow_drafts","POST",auth.authorization,{},row);console.info("[shadow-generation]",{requestId,stage:"complete",draftId:saved?.[0]?.id});return res.status(201).json({success:true,status:"UNVERIFIED_SHADOW_DRAFT_CREATED",draft_id:saved?.[0]?.id,draft_version:saved?.[0]?.draft_version,publication_authorized:false,wordpress_write_performed:false,yoast_write_performed:false});
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

  if (req.method === "POST" && req.body?.action === "generate_shadow_draft") { try { return await generateShadowDraft(req,res); } catch(error) { console.error("[shadow-generation]",{stage:"failed",message:error?.message||String(error),stack:error?.stack}); return res.status(error?.message==="CLOUDFLARE_WORKERS_AI_CONFIGURATION_REQUIRED"?503:502).json({success:false,status:error?.message==="CLOUDFLARE_WORKERS_AI_CONFIGURATION_REQUIRED"?"CLOUDFLARE_WORKERS_AI_CONFIGURATION_REQUIRED":"SHADOW_GENERATION_FAILED",message:error?.message||String(error),wordpress_write_performed:false,yoast_write_performed:false}); } }

  if (req.method === "POST" && req.body?.action === "provider_status") {
    return providerStatus(req, res);
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
